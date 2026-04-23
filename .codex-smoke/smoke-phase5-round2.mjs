import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const cwd = process.cwd();
const smokeDir = path.join(cwd, ".codex-smoke");
await mkdir(smokeDir, { recursive: true });

const appUrl = process.env.SMOKE_APP_URL || "http://127.0.0.1:4178/";
const cdpPort = 9500 + Math.floor(Math.random() * 40);
const profileDir = path.join(smokeDir, `edge-profile-phase5-round2-${Date.now()}`);
const screenshotPath = path.join(smokeDir, "smoke-phase5-round2.png");
const statePath = path.join(smokeDir, "smoke-phase5-round2.json");
const domPath = path.join(smokeDir, "smoke-phase5-round2.dom.html");
const serverOutPath = path.join(smokeDir, "phase5-round2-server.stdout.log");
const serverErrPath = path.join(smokeDir, "phase5-round2-server.stderr.log");
const edgeOutPath = path.join(smokeDir, "phase5-round2-edge.stdout.log");
const edgeErrPath = path.join(smokeDir, "phase5-round2-edge.stderr.log");

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
    // Ignore cleanup failures.
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

  async function navigateTo(hash, label) {
    await evaluate(`(() => {
      location.hash = ${JSON.stringify(hash)};
      return location.hash;
    })()`);

    return waitFor(async () => {
      const state = await evaluate(`(() => {
        const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
        return {
          hash: location.hash,
          screen: document.querySelector('.screen:not(.hidden)')?.dataset.screen || null,
          appVisible: visible(document.querySelector("#app-shell")),
        };
      })()`);
      return state?.hash === hash && state?.appVisible ? state : null;
    }, 25000, 400, label);
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 2200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: appUrl });

  const snapshotExpression = `
    (() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const boot = document.querySelector("#boot-screen");
      const auth = document.querySelector("#auth-screen");
      const shell = document.querySelector("#app-shell");
      return {
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        authVisible: visible(auth),
        bootVisible: visible(boot),
        shellVisible: visible(shell),
        hasEmailInput: !!document.querySelector("#auth-email-input"),
        hasPasswordInput: !!document.querySelector("#auth-password-input"),
        emailButtonDisabled: !!document.querySelector("#email-login-button")?.disabled,
        authError: document.querySelector("#auth-error-message")?.textContent?.trim() || null,
        bodySample: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 600),
      };
    })()
  `;

  try {
    report.beforeLogin = await waitFor(async () => {
      const state = await evaluate(snapshotExpression);
      return state?.authVisible && !state?.bootVisible && state?.hasEmailInput && state?.hasPasswordInput && !state?.emailButtonDisabled
        ? state
        : null;
    }, 45000, 500, "email login form");
  } catch (error) {
    report.beforeLogin = await evaluate(snapshotExpression).catch(() => null);
    report.runtimeExceptions = runtimeExceptions;
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

  await evaluate(`(() => {
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

    setValue(emailInput, email);
    setValue(passwordInput, password);
    submitButton.click();
    return true;
  })()`);

  report.dashboard = await waitFor(async () => {
    const state = await evaluate(`(() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      return {
        shellVisible: visible(document.querySelector("#app-shell")),
        metricsCount: document.querySelectorAll("#metrics-grid .metric-card, #metrics-grid .metric-card-compact").length,
        pageTitle: document.querySelector("#page-title")?.textContent?.trim() || "",
      };
    })()`);
    return state?.shellVisible && state?.metricsCount >= 4 ? state : null;
  }, 60000, 1000, "signed-in dashboard");

  report.catalogRoute = await navigateTo("#/catalog/enrollments", "catalog enrollments");

  report.enrollmentCatalog = await waitFor(async () => {
    const state = await evaluate(`(() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      return {
        catalogVisible: visible(document.querySelector('.screen[data-screen="catalog"]')),
        hash: location.hash,
        activeCatalog: document.querySelector("#catalog-nav .catalog-nav-item.is-active")?.dataset.catalogType || null,
        rowCount: document.querySelectorAll("#catalog-body tr").length,
        copyNextYearCount: document.querySelectorAll('#catalog-body [data-action="copy-next-year"]').length,
        summary: document.querySelector("#catalog-summary")?.textContent?.trim() || "",
      };
    })()`);
    return state?.catalogVisible && state?.hash === "#/catalog/enrollments" && state?.activeCatalog === "enrollments"
      ? state
      : null;
  }, 30000, 600, "enrollment catalog");

  report.openEnrollmentModal = await evaluate(`(() => {
    const addButton = document.querySelector("#add-record-button");
    addButton?.click();
    return { clicked: !!addButton };
  })()`);

  report.enrollmentModal = await waitFor(async () => {
    const state = await evaluate(`(() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const selectedPanel = document.querySelector('[data-enrollment-scope-panel="selected"]');
      const sharedPanel = document.querySelector('[data-enrollment-delivery-panel="shared"]');
      const splitPanel = document.querySelector('[data-enrollment-delivery-panel="split"]');
      return {
        modalVisible: visible(document.querySelector("#modal")),
        title: document.querySelector("#modal-title")?.textContent?.trim() || "",
        hasScopeMode: !!document.querySelector('select[name="sectionScopeMode"]'),
        hasDeliveryTemplate: !!document.querySelector('select[name="deliveryTemplate"]'),
        hasLeadTeacher: !!document.querySelector('select[name="leadTeacherId"]'),
        hasPreferredRoom: !!document.querySelector('select[name="preferredRoomId"]'),
        targetSectionCount: document.querySelectorAll('input[name="targetSectionIds"]').length,
        copyButtonCount: document.querySelectorAll('#catalog-body [data-action="copy-next-year"]').length,
        selectedPanelVisible: visible(selectedPanel),
        sharedPanelVisible: visible(sharedPanel),
        splitPanelVisible: visible(splitPanel),
      };
    })()`);
    return state?.modalVisible && state?.hasScopeMode && state?.hasDeliveryTemplate ? state : null;
  }, 20000, 400, "enrollment modal");

  report.enrollmentModalModes = await evaluate(`(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    const scopeSelect = document.querySelector('select[name="sectionScopeMode"]');
    const deliverySelect = document.querySelector('select[name="deliveryTemplate"]');
    const selectedPanel = document.querySelector('[data-enrollment-scope-panel="selected"]');
    const sharedPanel = document.querySelector('[data-enrollment-delivery-panel="shared"]');
    const splitPanel = document.querySelector('[data-enrollment-delivery-panel="split"]');

    if (!scopeSelect || !deliverySelect) {
      return { ok: false, reason: "missing-controls" };
    }

    scopeSelect.value = "SELECTED_SECTIONS";
    scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(120);

    deliverySelect.value = "SPLIT_GROUP";
    deliverySelect.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(120);

    return {
      ok: true,
      scopeMode: scopeSelect.value,
      deliveryTemplate: deliverySelect.value,
      selectedPanelVisible: visible(selectedPanel),
      sharedPanelVisible: visible(sharedPanel),
      splitPanelVisible: visible(splitPanel),
      splitRowCount: document.querySelectorAll(".split-group-row").length,
    };
  })()`);

  await evaluate(`(() => {
    document.querySelector("#modal-close-button")?.click();
    return true;
  })()`);

  report.timetableRoute = await navigateTo("#/timetable", "timetable workspace");

  report.timetable = await waitFor(async () => {
    const state = await evaluate(`(() => {
      const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      return {
        timetableVisible: visible(document.querySelector('.screen[data-screen="timetable"]')),
        hash: location.hash,
        periodHeadCount: document.querySelectorAll("#board-head .board-period-head").length,
        dayLabelCount: document.querySelectorAll("#board-grid .day-label").length,
        slotCount: document.querySelectorAll("#board-grid .slot-cell").length,
        entryCount: document.querySelectorAll("#board-grid .entry-card").length,
        groupPreviewCount: document.querySelectorAll("#group-pool [data-group-preview]").length,
        entryPreviewCount: document.querySelectorAll("#board-grid [data-entry-preview]").length,
      };
    })()`);
    return state?.timetableVisible
      && state?.hash === "#/timetable"
      && state?.periodHeadCount === 6
      && state?.dayLabelCount === 5
      && state?.slotCount >= 30
      ? state
      : null;
  }, 30000, 700, "timetable board");

  report.previewModal = await evaluate(`(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    const groupPreviewButton = document.querySelector("#group-pool [data-group-preview]");
    const entryPreviewButton = document.querySelector("#board-grid [data-entry-preview]");
    const trigger = groupPreviewButton || entryPreviewButton;
    const source = groupPreviewButton ? "group" : entryPreviewButton ? "entry" : "none";

    if (!trigger) {
      return { ok: false, reason: "missing-preview-trigger" };
    }

    trigger.click();
    await delay(600);

    const modal = document.querySelector("#preview-modal");
    const result = {
      ok: visible(modal),
      source,
      title: document.querySelector("#preview-modal-title")?.textContent?.trim() || "",
      caption: document.querySelector("#preview-modal-caption")?.textContent?.trim() || "",
      metaCardCount: document.querySelectorAll("#preview-modal .preview-meta-card").length,
      detailPanelCount: document.querySelectorAll("#preview-modal .preview-detail-panel").length,
    };

    document.querySelector("#preview-modal-close-button")?.click();
    await delay(120);
    result.closed = !visible(modal);
    return result;
  })()`);

  report.exportsViaButton = await evaluate(`(() => {
    const button = document.querySelector("#go-to-exports-button");
    button?.click();
    const screens = [...document.querySelectorAll(".screen[data-screen]")].map((screen) => ({
      screen: screen.dataset.screen,
      hidden: screen.hidden,
      hasHiddenClass: screen.classList.contains("hidden"),
      display: getComputedStyle(screen).display,
    }));
    return {
      clicked: !!button,
      hash: location.hash,
      activeScreen: document.querySelector(".screen:not(.hidden)")?.dataset.screen || null,
      exportsVisible: !!document.querySelector('.screen[data-screen="exports"]') && !document.querySelector('.screen[data-screen="exports"]').classList.contains("hidden"),
      timetableVisible: !!document.querySelector('.screen[data-screen="timetable"]') && !document.querySelector('.screen[data-screen="timetable"]').classList.contains("hidden"),
      dashboardVisible: !!document.querySelector('.screen[data-screen="dashboard"]') && !document.querySelector('.screen[data-screen="dashboard"]').classList.contains("hidden"),
      pageTitle: document.querySelector("#page-title")?.textContent?.trim() || "",
      screens,
    };
  })()`);

  const readExportsStateExpression = `(() => {
    const visible = (el) => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    const screenStates = [...document.querySelectorAll(".screen[data-screen]")].map((screen) => ({
      screen: screen.dataset.screen,
      hidden: screen.hidden,
      hasHiddenClass: screen.classList.contains("hidden"),
      display: getComputedStyle(screen).display,
    }));
    return {
      exportsVisible: visible(document.querySelector('.screen[data-screen="exports"]')),
      timetableVisible: visible(document.querySelector('.screen[data-screen="timetable"]')),
      dashboardVisible: visible(document.querySelector('.screen[data-screen="dashboard"]')),
      activeScreen: document.querySelector(".screen:not(.hidden)")?.dataset.screen || null,
      hash: location.hash,
      previewCount: document.querySelectorAll("#export-preview-list .exports-preview-item").length,
      hasViewSwitch: !!document.querySelector("#exports-view-switch"),
      hasScopeSelect: !!document.querySelector("#exports-scope-select"),
      hasExportScopeSelect: !!document.querySelector("#export-scope-select"),
      hasCsv: !!document.querySelector("#export-csv-button"),
      hasPdf: !!document.querySelector("#export-pdf-button"),
      hasPrint: !!document.querySelector("#print-button"),
      note: document.querySelector("#export-page-note")?.textContent?.trim() || "",
      pageTitle: document.querySelector("#page-title")?.textContent?.trim() || "",
      renderError: globalThis.__TEACHTABLE_LAST_RENDER_ERROR__ || "",
      screenStates,
    };
  })()`;

  try {
    report.exports = await waitFor(async () => {
      const state = await evaluate(readExportsStateExpression);
      return state?.exportsVisible
        && !state?.timetableVisible
        && state?.hash === "#/exports"
        && state?.hasViewSwitch
        && state?.hasScopeSelect
        && state?.hasExportScopeSelect
        && state?.hasCsv
        && state?.hasPdf
        && state?.hasPrint
        ? state
        : null;
    }, 30000, 700, "exports screen");
  } catch (error) {
    report.exports = await evaluate(readExportsStateExpression).catch(() => null);
    report.exportsFallback = await evaluate(`(() => {
      location.hash = "#/exports";
      return {
        hash: location.hash,
        activeScreen: document.querySelector(".screen:not(.hidden)")?.dataset.screen || null,
      };
    })()`).catch(() => null);
    throw error;
  }

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
  report.success = false;
  report.runtimeExceptions = runtimeExceptions;
  report.error = {
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
  report.endedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(report, null, 2), "utf8");
  console.error(error);
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


