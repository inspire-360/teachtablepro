import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const cwd = process.cwd();
const outputDir = path.join(cwd, "tmp", "browser-audit");
await mkdir(outputDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const auditPort = Number(process.env.BROWSER_AUDIT_PORT || process.env.PORT || 4178);
const forceServer = process.env.BROWSER_AUDIT_FORCE_SERVER === "1";
const appUrl = process.env.BROWSER_AUDIT_URL || `http://127.0.0.1:${auditPort}/`;
const email = process.env.BROWSER_AUDIT_EMAIL || process.env.SMOKE_EMAIL || "";
const password = process.env.BROWSER_AUDIT_PASSWORD || process.env.SMOKE_PASSWORD || "";
const cdpPort = 9580 + Math.floor(Math.random() * 40);
const profileDir = path.join(outputDir, `edge-profile-${timestamp}`);
const screenshotPath = path.join(outputDir, `browser-audit-${timestamp}.png`);
const statePath = path.join(outputDir, `browser-audit-${timestamp}.json`);
const domPath = path.join(outputDir, `browser-audit-${timestamp}.dom.html`);
const serverOutPath = path.join(outputDir, `browser-audit-server-${timestamp}.stdout.log`);
const serverErrPath = path.join(outputDir, `browser-audit-server-${timestamp}.stderr.log`);
const edgeOutPath = path.join(outputDir, `browser-audit-edge-${timestamp}.stdout.log`);
const edgeErrPath = path.join(outputDir, `browser-audit-edge-${timestamp}.stderr.log`);

const edgeCandidates = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));

if (!edgePath) {
  throw new Error("Microsoft Edge not found.");
}

function pipeToLog(stream, filePath) {
  const log = createWriteStream(filePath, { flags: "a" });
  stream?.pipe(log);
  return log;
}

async function canLoad(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(fn, timeoutMs, intervalMs, label) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  const suffix = lastError ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function killTree(proc) {
  if (!proc?.pid) {
    return;
  }

  try {
    execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
  } catch {
    // Ignore cleanup failures.
  }
}

function argToText(arg = {}) {
  if (Object.prototype.hasOwnProperty.call(arg, "value")) {
    return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
  }
  return arg.description || arg.unserializableValue || arg.type || "";
}

let serverProc = null;
let edgeProc = null;
let ws = null;
let serverStartedHere = false;

const requestMap = new Map();
const runtimeExceptions = [];
const consoleEntries = [];
const browserLogEntries = [];
const networkFailures = [];
const httpErrors = [];

const report = {
  success: false,
  appUrl,
  screenshotPath,
  statePath,
  domPath,
  startedAt: new Date().toISOString(),
  loginAttempted: false,
  credentialsProvided: Boolean(email && password),
};

try {
  if (forceServer || !(await canLoad(appUrl))) {
    serverProc = spawn(process.execPath, ["server.js"], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(auditPort),
      },
    });
    pipeToLog(serverProc.stdout, serverOutPath);
    pipeToLog(serverProc.stderr, serverErrPath);
    serverStartedHere = true;
  }

  await waitFor(() => canLoad(appUrl), 25000, 500, "TeachTable server");

  const edgeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1500,2200",
    appUrl,
  ];
  edgeProc = spawn(edgePath, edgeArgs, { cwd, windowsHide: true });
  pipeToLog(edgeProc.stdout, edgeOutPath);
  pipeToLog(edgeProc.stderr, edgeErrPath);

  const cdpBases = [`http://127.0.0.1:${cdpPort}`, `http://localhost:${cdpPort}`, `http://[::1]:${cdpPort}`];

  async function fetchJson(pathname) {
    let lastError = null;
    for (const base of cdpBases) {
      try {
        const response = await fetch(`${base}${pathname}`);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Failed to fetch ${pathname}`);
  }

  await waitFor(async () => {
    try {
      const version = await fetchJson("/json/version");
      return version?.Browser ? version : null;
    } catch {
      return null;
    }
  }, 20000, 300, "Edge DevTools");

  const target = await waitFor(async () => {
    const targets = await fetchJson("/json/list");
    return targets.find((entry) => entry.type === "page" && entry.url && (entry.url.startsWith(appUrl) || entry.url === "about:blank"))
      || targets.find((entry) => entry.type === "page")
      || null;
  }, 15000, 300, "a page target");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening CDP websocket")), 10000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`CDP websocket error: ${event.message || "unknown error"}`));
    }, { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", async (event) => {
    const text = typeof event.data === "string"
      ? event.data
      : Buffer.isBuffer(event.data)
        ? event.data.toString("utf8")
        : Buffer.from(await event.data.arrayBuffer()).toString("utf8");

    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails || {};
      runtimeExceptions.push({
        text: details.text || "",
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
        url: details.url || details.stackTrace?.callFrames?.[0]?.url || "",
      });
      return;
    }

    if (message.method === "Runtime.consoleAPICalled") {
      const params = message.params || {};
      const frame = params.stackTrace?.callFrames?.[0] || {};
      consoleEntries.push({
        type: params.type || "log",
        text: (params.args || []).map(argToText).filter(Boolean).join(" "),
        url: frame.url || "",
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      });
      return;
    }

    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry || {};
      browserLogEntries.push({
        level: entry.level || "",
        source: entry.source || "",
        text: entry.text || "",
        url: entry.url || "",
        lineNumber: entry.lineNumber,
      });
      return;
    }

    if (message.method === "Network.requestWillBeSent") {
      requestMap.set(message.params?.requestId, message.params?.request?.url || "");
      return;
    }

    if (message.method === "Network.loadingFailed") {
      networkFailures.push({
        url: requestMap.get(message.params?.requestId) || "",
        errorText: message.params?.errorText || "",
        type: message.params?.type || "",
        canceled: Boolean(message.params?.canceled),
        blockedReason: message.params?.blockedReason || "",
      });
      return;
    }

    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      if (response?.status >= 400) {
        httpErrors.push({
          url: response.url || requestMap.get(message.params?.requestId) || "",
          status: response.status,
          statusText: response.statusText || "",
          mimeType: response.mimeType || "",
        });
      }
      return;
    }

    if (!message.id) {
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }
    entry.resolve(message.result || {});
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15000);

      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result?.result?.value;
  }

  async function snapshot(label = "") {
    return evaluate(`(() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const firebaseConfig = window.__TEACHTABLE_CONFIG__?.firebase || {};
      const missingKeys = ["apiKey", "authDomain", "projectId", "appId"].filter((key) => !firebaseConfig[key]);
      return {
        label: ${JSON.stringify(label)},
        href: location.href,
        hash: location.hash,
        title: document.title,
        readyState: document.readyState,
        startupError: window.__TEACHTABLE_STARTUP_ERROR__ || "",
        authVisible: visible(document.querySelector("#auth-screen")),
        bootVisible: visible(document.querySelector("#boot-screen")),
        shellVisible: visible(document.querySelector("#app-shell")),
        activeScreen: document.querySelector('.screen:not(.hidden)')?.dataset.screen || null,
        authStatusChip: document.querySelector("#auth-status-chip")?.textContent?.trim() || "",
        authError: document.querySelector("#auth-error-message")?.textContent?.trim() || "",
        googleDisabled: !!document.querySelector("#google-signin-button")?.disabled,
        emailDisabled: !!document.querySelector("#email-login-button")?.disabled,
        emailInputDisabled: !!document.querySelector("#auth-email-input")?.disabled,
        passwordInputDisabled: !!document.querySelector("#auth-password-input")?.disabled,
        metricsCount: document.querySelectorAll("#metrics-grid .metric-card, #metrics-grid .metric-card-compact").length,
        pageTitle: document.querySelector("#page-title")?.textContent?.trim() || "",
        configReady: missingKeys.length === 0,
        missingKeys,
      };
    })()`);
  }

  async function navigateToHash(hashValue, label, expectedScreen) {
    await evaluate(`(() => {
      location.hash = ${JSON.stringify(hashValue)};
      return location.hash;
    })()`);

    return waitFor(async () => {
      const state = await snapshot(label);
      if (state.hash !== hashValue) {
        return null;
      }
      if (expectedScreen && state.activeScreen !== expectedScreen) {
        return null;
      }
      return state.shellVisible ? state : null;
    }, 30000, 500, label);
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 2200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: appUrl });

  report.startup = await waitFor(async () => {
    const state = await snapshot("startup");
    return state.readyState === "complete" && (state.authVisible || state.shellVisible || state.startupError)
      ? state
      : null;
  }, 45000, 500, "startup state");

  if (report.startup.authVisible && report.startup.configReady && email && password && !report.startup.emailDisabled) {
    report.loginAttempted = true;
    await evaluate(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      setValue("#auth-email-input", ${JSON.stringify(email)});
      setValue("#auth-password-input", ${JSON.stringify(password)});
      document.querySelector("#email-login-button")?.click();
      return true;
    })()`);

    report.afterLogin = await waitFor(async () => {
      const state = await snapshot("after-login");
      if (state.shellVisible && state.metricsCount >= 0) {
        return state;
      }
      if (state.authVisible && state.authError) {
        return state;
      }
      return null;
    }, 60000, 1000, "auth result");
  } else {
    report.afterLogin = report.startup;
  }

  if (report.afterLogin.shellVisible) {
    report.routes = {
      dashboard: await snapshot("dashboard"),
      catalog: await navigateToHash("#/catalog/enrollments", "catalog", "catalog"),
      timetable: await navigateToHash("#/timetable", "timetable", "timetable"),
      exports: await navigateToHash("#/exports", "exports", "exports"),
    };
  }

  const domHtml = await evaluate("document.documentElement.outerHTML");
  if (typeof domHtml === "string") {
    await writeFile(domPath, domHtml, "utf8");
  }

  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  report.runtimeExceptions = runtimeExceptions;
  report.consoleWarnings = consoleEntries.filter((entry) => entry.type === "warning");
  report.consoleErrors = consoleEntries.filter((entry) => entry.type === "error" || entry.type === "assert");
  report.browserLogWarnings = browserLogEntries.filter((entry) => entry.level === "warning");
  report.browserLogErrors = browserLogEntries.filter((entry) => entry.level === "error");
  report.networkFailures = networkFailures.filter((entry) => !entry.canceled);
  report.httpErrors = httpErrors.filter((entry) => entry.status >= 400);
  report.summary = {
    runtimeExceptionCount: report.runtimeExceptions.length,
    consoleWarningCount: report.consoleWarnings.length + report.browserLogWarnings.length,
    consoleErrorCount: report.consoleErrors.length + report.browserLogErrors.length,
    networkFailureCount: report.networkFailures.length,
    httpErrorCount: report.httpErrors.length,
  };

  const hasBlockingAuthIssue = Boolean(report.afterLogin?.authVisible && report.afterLogin?.authError);
  const hasBlockingBrowserIssue = report.runtimeExceptions.length > 0 || report.consoleErrors.length > 0 || report.browserLogErrors.length > 0;
  report.success = !hasBlockingAuthIssue && !hasBlockingBrowserIssue;
  report.endedAt = new Date().toISOString();

  await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 2);
} catch (error) {
  report.success = false;
  report.runtimeExceptions = runtimeExceptions;
  report.consoleWarnings = consoleEntries.filter((entry) => entry.type === "warning");
  report.consoleErrors = consoleEntries.filter((entry) => entry.type === "error" || entry.type === "assert");
  report.browserLogWarnings = browserLogEntries.filter((entry) => entry.level === "warning");
  report.browserLogErrors = browserLogEntries.filter((entry) => entry.level === "error");
  report.networkFailures = networkFailures.filter((entry) => !entry.canceled);
  report.httpErrors = httpErrors.filter((entry) => entry.status >= 400);
  report.error = {
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
  report.endedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    // Ignore websocket cleanup issues.
  }
  killTree(edgeProc);
  if (serverStartedHere) {
    killTree(serverProc);
  }
}
