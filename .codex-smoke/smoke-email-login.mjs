import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const cwd = process.cwd();
const smokeDir = path.join(cwd, ".codex-smoke");
await mkdir(smokeDir, { recursive: true });

const appUrl = "http://127.0.0.1:4178/";
const cdpPort = 9390 + Math.floor(Math.random() * 50);
const profileDir = path.join(smokeDir, `edge-profile-login-${Date.now()}`);
const screenshotPath = path.join(smokeDir, "smoke-email-login.png");
const statePath = path.join(smokeDir, "smoke-email-login.json");
const domPath = path.join(smokeDir, "smoke-email-login.dom.html");
const serverOutPath = path.join(smokeDir, "server.stdout.log");
const serverErrPath = path.join(smokeDir, "server.stderr.log");
const edgeOutPath = path.join(smokeDir, "edge.stdout.log");
const edgeErrPath = path.join(smokeDir, "edge.stderr.log");

const email = process.env.SMOKE_EMAIL || "";
const password = process.env.SMOKE_PASSWORD || "";
if (!email || !password) throw new Error("Missing smoke credentials.");

const edgeCandidates = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const edgePath = edgeCandidates.find(candidate => existsSync(candidate));
if (!edgePath) throw new Error("Microsoft Edge not found.");

function pipeToLog(stream, filePath) {
  const log = createWriteStream(filePath, { flags: "a" });
  stream?.pipe(log);
  return log;
}

async function canLoad(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.ok || res.status < 500;
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
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const suffix = lastError ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function killTree(proc) {
  if (!proc?.pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
  } catch {
    // ignore cleanup errors
  }
}

let serverProc = null;
let edgeProc = null;
let ws = null;
let serverStartedHere = false;
const runtimeExceptions = [];

const report = {
  success: false,
  appUrl,
  screenshotPath,
  statePath,
  domPath,
  startedAt: new Date().toISOString(),
};

try {
  if (!(await canLoad(appUrl))) {
    serverProc = spawn(process.execPath, ["server.js"], { cwd, windowsHide: true });
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
    "--window-size=1440,2200",
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
        const res = await fetch(`${base}${pathname}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
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
    return targets.find(entry => entry.type === "page" && entry.url && (entry.url.startsWith(appUrl) || entry.url === "about:blank"))
      || targets.find(entry => entry.type === "page")
      || null;
  }, 15000, 300, "a page target");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening CDP websocket")), 10000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", event => {
      clearTimeout(timer);
      reject(new Error(`CDP websocket error: ${event.message || "unknown error"}`));
    }, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", async event => {
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
        stack: (details.stackTrace?.callFrames || []).slice(0, 6).map(frame => ({
          functionName: frame.functionName,
          url: frame.url,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })),
      });
      return;
    }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 2200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: appUrl });

  const snapshotExpression = `
    (() => {
      const visible = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const boot = document.querySelector("#boot-screen");
      const auth = document.querySelector("#auth-screen");
      const shell = document.querySelector("#app-shell");
      const authError = document.querySelector("#auth-error-message");
      return {
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        bootVisible: visible(boot),
        authVisible: visible(auth),
        shellVisible: visible(shell),
        hasEmailInput: !!document.querySelector("#auth-email-input"),
        hasPasswordInput: !!document.querySelector("#auth-password-input"),
        emailButtonDisabled: !!document.querySelector("#email-login-button")?.disabled,
        metricsCount: document.querySelectorAll("#metrics-grid .metric-card, #metrics-grid .metric-card-compact").length,
        pageTitle: document.querySelector("#page-title, .hero-copy h3, .hero-copy h1, h1, h2")?.textContent?.trim() || null,
        userEmail: document.querySelector("#user-email")?.textContent?.trim() || null,
        authError: authError?.textContent?.trim() || null,
        bodySample: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 600)
      };
    })()
  `;

  try {
    report.beforeLogin = await waitFor(async () => {
      const state = await evaluate(snapshotExpression);
      return state?.authVisible && !state?.bootVisible && state?.hasEmailInput && state?.hasPasswordInput && !state?.emailButtonDisabled
        ? state
        : null;
    }, 30000, 500, "visible email login form");
  } catch (error) {
    report.beforeLogin = await evaluate(snapshotExpression).catch(() => null);
    const debugDomHtml = await evaluate("document.documentElement.outerHTML").catch(() => null);
    if (typeof debugDomHtml === "string") {
      await writeFile(domPath, debugDomHtml, "utf8");
    }
    const debugShot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true,
    }).catch(() => null);
    if (debugShot?.data) {
      await writeFile(screenshotPath, Buffer.from(debugShot.data, "base64"));
    }
    throw error;
  }

  await delay(500);

  report.loginAttempt = await evaluate(`(async () => {
    const email = ${JSON.stringify('smoke_test@chpschool.ac.th')};
    const password = ${JSON.stringify('@SmokeTest-Teachtable2026')};
    const emailInput = document.querySelector("#auth-email-input");
    const passwordInput = document.querySelector("#auth-password-input");
    const button = document.querySelector("#email-login-button");
    const setValue = (input, value) => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (!emailInput || !passwordInput || !button) {
      return { ok: false, reason: "missing-auth-controls" };
    }
    setValue(emailInput, email);
    setValue(passwordInput, password);
    button.click();
    return { ok: true, buttonText: button.textContent?.trim() || null };
  })()`);

  const deadline = Date.now() + 60000;
  let finalState = null;
  let authErrorSeenAt = 0;

  while (Date.now() < deadline) {
    const state = await evaluate(snapshotExpression);
    if (state?.shellVisible && !state?.authVisible && state?.metricsCount >= 4) {
      finalState = state;
      report.success = true;
      break;
    }
    if (state?.authVisible && state?.authError) {
      if (!authErrorSeenAt) authErrorSeenAt = Date.now();
      if (Date.now() - authErrorSeenAt > 3000) {
        finalState = state;
        break;
      }
    } else {
      authErrorSeenAt = 0;
    }
    await delay(1000);
  }

  if (!finalState) {
    finalState = await evaluate(snapshotExpression);
  }

  report.afterLogin = finalState;
  report.runtimeExceptions = runtimeExceptions;
  const domHtml = await evaluate("document.documentElement.outerHTML");
  if (typeof domHtml === "string") {
    await writeFile(domPath, domHtml, "utf8");
  }

  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
  report.endedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 2);
} catch (error) {
  report.runtimeExceptions = runtimeExceptions;
  report.error = error.message;
  report.endedAt = new Date().toISOString();
  try {
    await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch {
    // ignore cleanup errors
  }
  killTree(edgeProc);
  if (serverStartedHere) {
    killTree(serverProc);
  }
}
