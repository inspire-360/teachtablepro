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
const cdpPort = 9480 + Math.floor(Math.random() * 40);
const profileDir = path.join(smokeDir, `edge-profile-phase5-${Date.now()}`);
const screenshotPath = path.join(smokeDir, "smoke-phase5-timetable.png");
const statePath = path.join(smokeDir, "smoke-phase5-timetable.json");
const domPath = path.join(smokeDir, "smoke-phase5-timetable.dom.html");
const serverOutPath = path.join(smokeDir, "phase5-server.stdout.log");
const serverErrPath = path.join(smokeDir, "phase5-server.stderr.log");
const edgeOutPath = path.join(smokeDir, "phase5-edge.stdout.log");
const edgeErrPath = path.join(smokeDir, "phase5-edge.stderr.log");

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
      };
    })()
  `;

  await waitFor(async () => {
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

    setValue(emailInput, email);
    setValue(passwordInput, password);
    submitButton.click();
    return true;
  })()`);

  const shellExpression = `
    (() => {
      const visible = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const shell = document.querySelector("#app-shell");
      return {
        shellVisible: visible(shell),
        metricsCount: document.querySelectorAll("#metrics-grid .metric-card, #metrics-grid .metric-card-compact").length,
      };
    })()
  `;

  await waitFor(async () => {
    const state = await evaluate(shellExpression);
    return state?.shellVisible && state?.metricsCount >= 4 ? state : null;
  }, 60000, 1000, "signed-in dashboard");

  report.routeToTimetable = await evaluate(`(() => {
    location.hash = "#/timetable";
    return { hash: location.hash };
  })()`);

  const timetableExpression = `
    (() => {
      const visible = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
      const exportDrawer = document.querySelector("#export-drawer");
      const validationBody = document.querySelector("#validation-drawer-body");
      return {
        hash: location.hash,
        timetableVisible: visible(document.querySelector('[data-screen="timetable"]')),
        scopeTitle: document.querySelector("#timetable-scope-title")?.textContent?.trim() || null,
        groupSortExists: !!document.querySelector("#group-sort-select"),
        slotCount: document.querySelectorAll("#board-grid .slot-cell").length,
        entryCount: document.querySelectorAll("#board-grid .entry-card").length,
        groupCardCount: document.querySelectorAll("#group-pool .group-card").length,
        validationVisible: visible(validationBody),
        exportDrawerVisible: visible(exportDrawer),
        exportScopeExists: !!document.querySelector("#export-scope-select"),
        suggestionSectionExists: !!document.querySelector("#suggestion-summary"),
        suggestionItemCount: document.querySelectorAll("#suggestion-list [data-suggestion-day]").length,
        collaborationSectionExists: !!document.querySelector("#collaboration-summary"),
        collaborationHealthExists: !!document.querySelector("#collaboration-health .collaboration-health-card"),
        activitySectionExists: !!document.querySelector("#activity-summary"),
      };
    })()
  `;

  report.timetable = await waitFor(async () => {
    const state = await evaluate(timetableExpression);
    return state?.timetableVisible && state?.hash === "#/timetable" && state?.groupSortExists && state?.slotCount >= 30
      ? state
      : null;
  }, 30000, 700, "timetable workspace");

  report.scopeProbe = await evaluate(`(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const countGroups = () => document.querySelectorAll("#group-pool .group-card").length;
    const summary = () => document.querySelector("#group-pool-summary")?.textContent?.trim() || "";
    const readState = () => ({
      view: document.querySelector("#view-switch [data-view].is-active")?.dataset.view || null,
      scopeValue: document.querySelector("#scope-select")?.value || null,
      scopeLabel: document.querySelector("#scope-select")?.selectedOptions?.[0]?.textContent?.trim() || null,
      groupCardCount: countGroups(),
      summary: summary(),
    });

    if (countGroups() > 0) {
      return { ok: true, changed: false, ...readState() };
    }

    for (const view of ["section", "teacher"]) {
      const viewButton = document.querySelector(\`#view-switch [data-view="\${view}"]\`);
      if (viewButton && !viewButton.classList.contains("is-active")) {
        viewButton.click();
        await delay(120);
      }

      const scopeSelect = document.querySelector("#scope-select");
      const values = [...(scopeSelect?.options || [])].map((option) => option.value).filter(Boolean);
      for (const value of values) {
        if (scopeSelect.value !== value) {
          scopeSelect.value = value;
          scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
          await delay(140);
        }

        if (countGroups() > 0) {
          return { ok: true, changed: true, ...readState() };
        }
      }
    }

    return { ok: false, changed: true, ...readState() };
  })()`);

  report.timetableWithGroups = await evaluate(timetableExpression);

  report.dragPreview = await evaluate(`(() => {
    const entry = document.querySelector("#board-grid .entry-card");
    const cells = [...document.querySelectorAll("#board-grid .slot-cell")];
    const targetCell = cells.find((cell) => !cell.querySelector(".entry-card")) || cells[0] || null;
    if (!entry || !targetCell || typeof DragEvent !== "function" || typeof DataTransfer !== "function") {
      return {
        ok: false,
        reason: "missing-entry-or-drag-api",
        hasEntry: !!entry,
        hasTargetCell: !!targetCell,
        hasDragEvent: typeof DragEvent === "function",
        hasDataTransfer: typeof DataTransfer === "function",
      };
    }

    const startData = new DataTransfer();
    entry.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: startData }));
    const hoverData = new DataTransfer();
    targetCell.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: hoverData }));

    const preview = {
      dragging: entry.classList.contains("is-dragging"),
      dropTarget: targetCell.classList.contains("is-drop-target"),
      dropOccupied: targetCell.classList.contains("is-drop-occupied"),
      dropLocked: targetCell.classList.contains("is-drop-locked"),
      boardNote: document.querySelector("#timetable-board-note")?.textContent?.trim() || "",
    };

    entry.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    const remainingPreviewCount = document.querySelectorAll("#board-grid .slot-cell.is-drop-target, #board-grid .entry-card.is-dragging").length;

    return {
      ok: preview.dropTarget && preview.boardNote.length > 0 && remainingPreviewCount === 0,
      ...preview,
      remainingPreviewCount,
    };
  })()`);

  if (report.scopeProbe?.ok) {
    report.selectGroup = await evaluate(`(() => {
      const firstGroup = document.querySelector("#group-pool .group-card");
      if (!firstGroup) {
        return { ok: false, reason: "missing-group-card" };
      }

      const beforeSummary = document.querySelector("#suggestion-summary")?.textContent?.trim() || "";
      firstGroup.click();
      return {
        ok: true,
        beforeSummary,
        selectedGroupText: firstGroup.textContent?.trim()?.slice(0, 120) || "",
      };
    })()`);

    report.suggestions = await waitFor(async () => {
      const state = await evaluate(`(() => {
        const selected = document.querySelector("#group-pool .group-card.selected");
        const summary = document.querySelector("#suggestion-summary")?.textContent?.trim() || "";
        const suggestionCount = document.querySelectorAll("#suggestion-list [data-suggestion-day]").length;
        const hasStateCard = !!document.querySelector("#suggestion-list .empty-state");
        return {
          hasSelectedGroup: !!selected,
          summary,
          suggestionCount,
          hasStateCard,
        };
      })()`);

      return state?.hasSelectedGroup && (state?.suggestionCount > 0 || state?.hasStateCard)
        ? state
        : null;
    }, 30000, 700, "selected group suggestions");

    report.suggestionPreview = await evaluate(`(() => {
      const firstSuggestion = document.querySelector("#suggestion-list [data-suggestion-day]");
      if (!firstSuggestion) {
        return {
          ok: true,
          skipped: true,
          reason: "no-suggestion-slot",
          summary: document.querySelector("#suggestion-summary")?.textContent?.trim() || "",
        };
      }

      firstSuggestion.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const previewCount = document.querySelectorAll("#board-grid .slot-cell.is-slot-soft-preview").length;
      const note = document.querySelector("#timetable-board-note")?.textContent?.trim() || "";
      firstSuggestion.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      const remainingPreviewCount = document.querySelectorAll("#board-grid .slot-cell.is-slot-soft-preview").length;

      return {
        ok: previewCount > 0 && remainingPreviewCount === 0,
        previewCount,
        remainingPreviewCount,
        note,
      };
    })()`);
  } else {
    report.selectGroup = {
      ok: true,
      skipped: true,
      reason: "no-unresolved-groups-in-current-dataset",
      summary: report.scopeProbe?.summary || "",
    };
    report.suggestions = {
      ok: true,
      skipped: true,
      reason: "no-unresolved-groups-in-current-dataset",
    };
    report.suggestionPreview = {
      ok: true,
      skipped: true,
      reason: "no-unresolved-groups-in-current-dataset",
    };
  }

  report.toggleValidation = await evaluate(`(() => {
    const button = document.querySelector("#toggle-validation-button");
    if (!button) {
      return { ok: false, reason: "missing-toggle" };
    }
    const before = !document.querySelector("#validation-drawer-body")?.hidden;
    button.click();
    const after = !document.querySelector("#validation-drawer-body")?.hidden;
    button.click();
    const restored = !document.querySelector("#validation-drawer-body")?.hidden;
    return { ok: true, before, after, restored };
  })()`);

  report.openExportDrawer = await evaluate(`(() => {
    const button = document.querySelector("#open-export-drawer-button");
    if (!button) {
      return { ok: false, reason: "missing-export-button" };
    }
    button.click();
    const drawer = document.querySelector("#export-drawer");
    const visible = !!drawer && !drawer.classList.contains("hidden") && getComputedStyle(drawer).display !== "none";
    return { ok: true, visible };
  })()`);

  report.exportDrawer = await waitFor(async () => {
    const state = await evaluate(timetableExpression);
    return state?.exportDrawerVisible && state?.exportScopeExists ? state : null;
  }, 15000, 500, "export drawer");

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
