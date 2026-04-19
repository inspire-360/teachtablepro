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
const cdpPort = 9440 + Math.floor(Math.random() * 40);
const profileDir = path.join(smokeDir, `edge-profile-phase4-${Date.now()}`);
const screenshotPath = path.join(smokeDir, "smoke-phase4-catalog.png");
const statePath = path.join(smokeDir, "smoke-phase4-catalog.json");
const domPath = path.join(smokeDir, "smoke-phase4-catalog.dom.html");
const serverOutPath = path.join(smokeDir, "phase4-server.stdout.log");
const serverErrPath = path.join(smokeDir, "phase4-server.stderr.log");
const edgeOutPath = path.join(smokeDir, "phase4-edge.stdout.log");
const edgeErrPath = path.join(smokeDir, "phase4-edge.stderr.log");

const email = process.env.SMOKE_EMAIL || "";
const password = process.env.SMOKE_PASSWORD || "";
if (!email || !password) {
  throw new Error("Missing smoke credentials.");
}

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
    // ignore cleanup errors
  }
}

let serverProc = null;
let edgeProc = null;
let ws = null;
let serverStartedHere = false;

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
    "--window-size=1480,2200",
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
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1480,
    height: 2200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: appUrl });

  const authStateExpression = `
    (() => {
      const visible = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const auth = document.querySelector("#auth-screen");
      const boot = document.querySelector("#boot-screen");
      return {
        href: location.href,
        authVisible: visible(auth),
        bootVisible: visible(boot),
        hasEmailInput: !!document.querySelector("#auth-email-input"),
        hasPasswordInput: !!document.querySelector("#auth-password-input"),
        emailButtonDisabled: !!document.querySelector("#email-login-button")?.disabled,
        authError: document.querySelector("#auth-error-message")?.textContent?.trim() || null,
      };
    })()
  `;

  report.beforeLogin = await waitFor(async () => {
    const state = await evaluate(authStateExpression);
    return state?.authVisible && !state?.bootVisible && state?.hasEmailInput && state?.hasPasswordInput && !state?.emailButtonDisabled
      ? state
      : null;
  }, 30000, 500, "email login form");

  await evaluate(`(async () => {
    const email = ${JSON.stringify(email)};
    const password = ${JSON.stringify(password)};
    const emailInput = document.querySelector("#auth-email-input");
    const passwordInput = document.querySelector("#auth-password-input");
    const submitButton = document.querySelector("#email-login-button");
    const setValue = (input, value) => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    if (!emailInput || !passwordInput || !submitButton) {
      return { ok: false, reason: "missing-auth-controls" };
    }

    setValue(emailInput, email);
    setValue(passwordInput, password);
    submitButton.click();
    return { ok: true };
  })()`);

  const dashboardExpression = `
    (() => {
      const visible = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const shell = document.querySelector("#app-shell");
      return {
        href: location.href,
        shellVisible: visible(shell),
        metricsCount: document.querySelectorAll("#metrics-grid .metric-card, #metrics-grid .metric-card-compact").length,
        pageTitle: document.querySelector("#page-title")?.textContent?.trim() || null,
        userEmail: document.querySelector("#user-email")?.textContent?.trim() || null,
      };
    })()
  `;

  report.dashboard = await waitFor(async () => {
    const state = await evaluate(dashboardExpression);
    return state?.shellVisible && state?.metricsCount >= 4 ? state : null;
  }, 60000, 1000, "signed-in dashboard");

  report.catalogRoute = await evaluate(`(() => {
    location.hash = "#/catalog/teachers";
    return { hash: location.hash };
  })()`);

  const catalogExpression = `
    (() => {
      const visible = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const catalogScreen = document.querySelector('[data-screen="catalog"]');
      return {
        href: location.href,
        hash: location.hash,
        catalogVisible: visible(catalogScreen),
        navCount: document.querySelectorAll("#catalog-nav [data-catalog-type]").length,
        readinessCount: document.querySelectorAll(".readiness-badge").length,
        moduleTitle: document.querySelector("#catalog-module-title")?.textContent?.trim() || null,
        summary: document.querySelector("#catalog-summary")?.textContent?.trim() || null,
        headers: [...document.querySelectorAll("#catalog-head th")].map((node) => node.textContent.trim()),
        activeNav: document.querySelector("#catalog-nav .catalog-nav-item.is-active strong")?.textContent?.trim() || null,
      };
    })()
  `;

  report.catalogTeachers = await waitFor(async () => {
    const state = await evaluate(catalogExpression);
    return state?.catalogVisible && state?.hash === "#/catalog/teachers" && state?.navCount >= 6 && state?.readinessCount > 0
      ? state
      : null;
  }, 30000, 600, "catalog teachers module");

  report.catalogSwitch = await evaluate(`(() => {
    const button = document.querySelector('#catalog-nav [data-catalog-type="instructionalGroups"]');
    if (!button) {
      return { ok: false, reason: "missing-instructional-groups-button" };
    }
    button.click();
    return { ok: true, hash: location.hash };
  })()`);

  report.catalogInstructionalGroups = await waitFor(async () => {
    const state = await evaluate(catalogExpression);
    return state?.catalogVisible
      && state?.hash === "#/catalog/instructionalGroups"
      && state?.activeNav
      && state?.readinessCount > 0
      ? state
      : null;
  }, 30000, 600, "catalog instructional groups module");

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

  report.success = true;
  report.endedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (error) {
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
