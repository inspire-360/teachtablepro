const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { loadEnvFile } = require("./apps/api/runtime/load-env");

loadEnvFile();

const { authenticateApiRequest, getProjectId } = require("./apps/api/runtime/firebase-auth");
const { buildTimetableCsv } = require("./apps/api/runtime/csv-export");
const { generateTimetablePdfBuffer } = require("./apps/api/runtime/pdf-export");
const {
  applyMutation,
  claimLockOnDb,
  createByResource,
  deleteByResource,
  joinOrHeartbeat,
  listByResource,
  pruneCollaboration,
  releaseLockOnDb,
  runAutoSchedule,
  runValidation,
  updateByResource,
  updateSettings,
} = require("./apps/api/runtime/db-service");
const {
  buildActivityPayload,
  buildBootstrapPayload,
  buildCsvPayload,
  buildPdfPayload,
  getGroupSuggestions,
  listEntitiesForView,
} = require("./apps/api/runtime/selectors");
const {
  CSV_OUTPUT_DIR,
  PDF_OUTPUT_DIR,
  ROOT_DIR,
  ensureDatabase,
  readDatabase,
  withDatabase,
} = require("./apps/api/runtime/storage");

const PORT = process.env.PORT || 4178;
const STATIC_DIR = path.join(ROOT_DIR, "apps", "web");
const RESOURCE_NAMES = new Set(["teachers", "rooms", "subjects", "sections", "enrollments", "instructionalGroups"]);
const PUBLIC_API_PATHS = new Set(["/api/health"]);

const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_WEB_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${getProjectId()}.firebaseapp.com`,
  databaseURL:
    process.env.FIREBASE_DATABASE_URL
    || `https://${getProjectId()}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  projectId: getProjectId(),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${getProjectId()}.firebasestorage.app`,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "985169507159",
  appId: process.env.FIREBASE_APP_ID || "1:985169507159:web:32145ebaf1506ca3b70412",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function sendError(res, error, statusCode = 400) {
  sendJson(res, statusCode, {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
}

function notFound(res) {
  sendJson(res, 404, { ok: false, message: "The requested endpoint could not be found." });
}

function unauthorized(res, message) {
  sendJson(res, 401, {
    ok: false,
    code: "UNAUTHENTICATED",
    message: message || "Please sign in before using TeachTable.",
  });
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function buildAppConfigScript() {
  return `window.__TEACHTABLE_CONFIG__ = ${JSON.stringify({
    firebase: FIREBASE_WEB_CONFIG,
    auth: {
      provider: "google-email",
      projectId: getProjectId(),
    },
  })};`;
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = path.join(STATIC_DIR, safePath);

  if (!filePath.startsWith(STATIC_DIR)) {
    notFound(res);
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const resolvedPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const content = await fs.readFile(resolvedPath);
    const contentType = MIME_TYPES[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    notFound(res);
  }
}

function parseEntityIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeExportOptions(searchParams, db) {
  const view = searchParams.get("view") === "teacher" ? "teacher" : "section";
  const scope = searchParams.get("scope") === "all"
    ? "all"
    : searchParams.get("scope") === "selected"
      ? "selected"
      : "current";
  const available = listEntitiesForView(db, view);
  const fallbackId = available[0]?.id || "";
  const entityId = searchParams.get("entityId") || fallbackId;
  const entityIds = parseEntityIds(searchParams.get("entityIds"));
  return {
    view,
    scope,
    entityId,
    entityIds,
  };
}

function getActorFromRequest(req, providedDisplayName = "") {
  const auth = req.auth || {};
  return {
    userId: auth.uid || "",
    displayName: String(providedDisplayName || "").trim() || auth.name || auth.email || "TeachTable user",
  };
}

async function handlePdfExport(res, db, searchParams) {
  const options = normalizeExportOptions(searchParams, db);
  const payload = buildPdfPayload(db, options);
  const scopeSuffix = options.scope === "all" ? "all" : options.scope === "selected" ? "selected" : options.entityId;
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const outputPath = path.join(PDF_OUTPUT_DIR, `teachtable-${options.view}-${scopeSuffix}-${stamp}.pdf`);
  const buffer = Buffer.from(await generateTimetablePdfBuffer(payload));
  await fs.writeFile(outputPath, buffer);
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="teachtable-${options.view}-${scopeSuffix}.pdf"`,
    "Content-Length": buffer.length,
  });
  res.end(buffer);
}

async function ensureAuthorized(req, res, pathname) {
  if (PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }

  const result = await authenticateApiRequest(req);
  if (!result.ok) {
    unauthorized(res, result.message);
    return false;
  }

  req.auth = result.user;
  return true;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const segments = pathname.split("/").filter(Boolean);

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, status: "ready" });
    return;
  }

  if (!(await ensureAuthorized(req, res, pathname))) {
    return;
  }

  if (pathname === "/api/bootstrap" && req.method === "GET") {
    const db = await readDatabase();
    pruneCollaboration(db);
    sendJson(res, 200, buildBootstrapPayload(db));
    return;
  }

  if (pathname === "/api/dashboard/summary" && req.method === "GET") {
    const db = await readDatabase();
    sendJson(res, 200, buildBootstrapPayload(db).dashboard);
    return;
  }

  if (segments[0] === "api" && RESOURCE_NAMES.has(segments[1])) {
    const resource = segments[1];
    if (segments.length === 2 && req.method === "GET") {
      const db = await readDatabase();
      sendJson(res, 200, listByResource(db, resource));
      return;
    }

    if (segments.length === 2 && req.method === "POST") {
      const body = await parseJsonBody(req);
      const created = await withDatabase(async (db) => createByResource(db, resource, body));
      sendJson(res, 201, created);
      return;
    }

    if (segments.length === 3 && req.method === "PATCH") {
      const body = await parseJsonBody(req);
      const updated = await withDatabase(async (db) => updateByResource(db, resource, segments[2], body));
      sendJson(res, 200, updated);
      return;
    }

    if (segments.length === 3 && req.method === "DELETE") {
      const deleted = await withDatabase(async (db) => deleteByResource(db, resource, segments[2]));
      sendJson(res, 200, deleted);
      return;
    }
  }

  if (pathname === "/api/settings" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const settings = await withDatabase(async (db) => updateSettings(db, body));
    sendJson(res, 200, settings);
    return;
  }

  if (pathname === "/api/timetables/current" && req.method === "GET") {
    const db = await readDatabase();
    sendJson(res, 200, getCurrentTimetable(db));
    return;
  }

  if (pathname === "/api/timetables/current/validate" && req.method === "POST") {
    const validation = await withDatabase(async (db) => runValidation(db));
    sendJson(res, 200, validation);
    return;
  }

  if (pathname === "/api/timetables/current/auto-schedule" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const actor = getActorFromRequest(req, body.actorDisplayName);
    const result = await withDatabase(async (db) =>
      runAutoSchedule(db, {
        forceRebuild: Boolean(body.forceRebuild),
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
      }),
    );
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/timetables/current/mutations" && req.method === "PATCH") {
    const body = await parseJsonBody(req);
    const actor = getActorFromRequest(req, body.actorDisplayName);
    const result = await withDatabase(async (db) =>
      applyMutation(db, {
        ...body,
        timetableId: "tt-current",
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
      }),
    );
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/timetables/current/collaboration/join" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const actor = getActorFromRequest(req, body.displayName);
    const presences = await withDatabase(async (db) =>
      joinOrHeartbeat(db, {
        ...body,
        userId: actor.userId,
        displayName: actor.displayName,
      }),
    );
    sendJson(res, 200, { ok: true, presences });
    return;
  }

  if (pathname === "/api/timetables/current/collaboration/heartbeat" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const actor = getActorFromRequest(req, body.displayName);
    const presences = await withDatabase(async (db) =>
      joinOrHeartbeat(db, {
        ...body,
        userId: actor.userId,
        displayName: actor.displayName,
      }),
    );
    sendJson(res, 200, { ok: true, presences });
    return;
  }

  if (pathname === "/api/timetables/current/collaboration/locks" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const actor = getActorFromRequest(req, body.displayName);
    const result = await withDatabase(async (db) =>
      claimLockOnDb(db, {
        ...body,
        userId: actor.userId,
        displayName: actor.displayName,
      }),
    );
    sendJson(res, 200, result);
    return;
  }

  if (
    segments[0] === "api"
    && segments[1] === "timetables"
    && segments[2] === "current"
    && segments[3] === "collaboration"
    && segments[4] === "locks"
    && req.method === "DELETE"
  ) {
    const lockId = decodeURIComponent(segments[5] || "");
    const userId = req.auth?.uid || "";
    const locks = await withDatabase(async (db) => releaseLockOnDb(db, lockId, userId));
    sendJson(res, 200, { ok: true, locks });
    return;
  }

  if (pathname === "/api/timetables/current/activity" && req.method === "GET") {
    const db = await readDatabase();
    pruneCollaboration(db);
    sendJson(res, 200, buildActivityPayload(db));
    return;
  }

  if (segments[0] === "api" && segments[1] === "instructional-groups" && segments[3] === "suggestions" && req.method === "GET") {
    const db = await readDatabase();
    sendJson(res, 200, getGroupSuggestions(db, segments[2]));
    return;
  }

  if (pathname === "/api/exports/timetable.csv" && req.method === "GET") {
    const db = await readDatabase();
    const options = normalizeExportOptions(url.searchParams, db);
    const csv = buildTimetableCsv(buildCsvPayload(db, options));
    const scopeSuffix = options.scope === "all" ? "all" : options.scope === "selected" ? "selected" : options.entityId;
    const csvPath = path.join(CSV_OUTPUT_DIR, `teachtable-${options.view}-${scopeSuffix}.csv`);
    await fs.writeFile(csvPath, csv, "utf8");
    sendText(res, 200, csv, "text/csv; charset=utf-8", {
      "Content-Disposition": `attachment; filename="teachtable-${options.view}-${scopeSuffix}.csv"`,
    });
    return;
  }

  if (pathname === "/api/exports/timetable.pdf" && req.method === "GET") {
    const db = await readDatabase();
    await handlePdfExport(res, db, url.searchParams);
    return;
  }

  notFound(res);
}

async function requestListener(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  try {
    if (url.pathname === "/app-config.js") {
      sendText(
        res,
        200,
        buildAppConfigScript(),
        "application/javascript; charset=utf-8",
        { "Cache-Control": "no-store" },
      );
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
}

async function main() {
  await ensureDatabase();
  const server = http.createServer(requestListener);
  server.listen(PORT, () => {
    console.log(`TeachTable is running at http://127.0.0.1:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
