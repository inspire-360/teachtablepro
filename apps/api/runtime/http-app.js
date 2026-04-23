const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const { authenticateApiRequest, getProjectId } = require("./firebase-auth");
const { buildTimetableCsv } = require("./csv-export");
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
} = require("./db-service");
const {
  buildActivityPayload,
  buildBootstrapPayload,
  buildCsvPayload,
  buildPdfPayload,
  getCurrentTimetable,
  getGroupSuggestions,
  listEntitiesForView,
} = require("./selectors");
const { ROOT_DIR, readDatabase, withDatabase } = require("./storage");

const RESOURCE_NAMES = new Set(["teachers", "rooms", "subjects", "sections", "enrollments", "instructionalGroups"]);
const PUBLIC_API_PATHS = new Set(["/api/health"]);

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

function readFirebaseEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function buildFirebaseWebConfig() {
  const projectId = getProjectId();

  return {
    apiKey: readFirebaseEnvValue("TEACHTABLE_FIREBASE_WEB_API_KEY", "FIREBASE_WEB_API_KEY"),
    authDomain: readFirebaseEnvValue("TEACHTABLE_FIREBASE_AUTH_DOMAIN", "FIREBASE_AUTH_DOMAIN")
      || `${projectId}.firebaseapp.com`,
    databaseURL: readFirebaseEnvValue("TEACHTABLE_FIREBASE_DATABASE_URL", "FIREBASE_DATABASE_URL")
      || `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
    projectId,
    storageBucket: readFirebaseEnvValue("TEACHTABLE_FIREBASE_STORAGE_BUCKET", "FIREBASE_STORAGE_BUCKET")
      || `${projectId}.firebasestorage.app`,
    messagingSenderId: readFirebaseEnvValue(
      "TEACHTABLE_FIREBASE_MESSAGING_SENDER_ID",
      "FIREBASE_MESSAGING_SENDER_ID",
    ) || "985169507159",
    appId: readFirebaseEnvValue("TEACHTABLE_FIREBASE_APP_ID", "FIREBASE_APP_ID") || "1:985169507159:web:32145ebaf1506ca3b70412",
  };
}

function writeHeaders(res, statusCode, headers = {}) {
  res.statusCode = statusCode;
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  writeHeaders(res, statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType, extraHeaders = {}) {
  writeHeaders(res, statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendBuffer(res, statusCode, body, contentType, extraHeaders = {}) {
  writeHeaders(res, statusCode, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    ...extraHeaders,
  });
  res.end(body);
}

function sendNoContent(res) {
  writeHeaders(res, 204);
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
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) {
      const rawBody = req.body.toString("utf8").trim();
      return rawBody ? JSON.parse(rawBody) : {};
    }

    if (typeof req.body === "string") {
      const rawBody = req.body.trim();
      return rawBody ? JSON.parse(rawBody) : {};
    }

    if (req.body && typeof req.body === "object") {
      return req.body;
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function buildAppConfigScript() {
  return `window.__TEACHTABLE_CONFIG__ = ${JSON.stringify({
    firebase: buildFirebaseWebConfig(),
    auth: {
      provider: "google-email",
      projectId: getProjectId(),
    },
  })};`;
}

function isPathInside(parentPath, childPath) {
  if (childPath === parentPath) {
    return true;
  }

  const relativePath = path.relative(parentPath, childPath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function serveStatic(res, staticDir, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedRoot = path.resolve(staticDir);
  const candidatePath = path.resolve(normalizedRoot, `.${requestedPath}`);

  if (!isPathInside(normalizedRoot, candidatePath)) {
    notFound(res);
    return;
  }

  try {
    const stat = await fs.stat(candidatePath);
    const resolvedPath = stat.isDirectory() ? path.join(candidatePath, "index.html") : candidatePath;
    const content = await fs.readFile(resolvedPath);
    const contentType = MIME_TYPES[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream";
    sendBuffer(res, 200, content, contentType);
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
  const { generateTimetablePdfBuffer } = require("./pdf-export");
  const options = normalizeExportOptions(searchParams, db);
  const payload = buildPdfPayload(db, options);
  const scopeSuffix = options.scope === "all" ? "all" : options.scope === "selected" ? "selected" : options.entityId;
  const buffer = Buffer.from(await generateTimetablePdfBuffer(payload));

  sendBuffer(res, 200, buffer, "application/pdf", {
    "Content-Disposition": `attachment; filename="teachtable-${options.view}-${scopeSuffix}.pdf"`,
  });
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

  if (
    pathname === "/api/timetables/current/collaboration/join"
    && req.method === "POST"
  ) {
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

  if (
    pathname === "/api/timetables/current/collaboration/heartbeat"
    && req.method === "POST"
  ) {
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

  if (
    pathname === "/api/timetables/current/collaboration/locks"
    && req.method === "POST"
  ) {
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

  if (
    segments[0] === "api"
    && segments[1] === "instructional-groups"
    && segments[3] === "suggestions"
    && req.method === "GET"
  ) {
    const db = await readDatabase();
    sendJson(res, 200, getGroupSuggestions(db, segments[2]));
    return;
  }

  if (pathname === "/api/exports/timetable.csv" && req.method === "GET") {
    const db = await readDatabase();
    const options = normalizeExportOptions(url.searchParams, db);
    const csv = buildTimetableCsv(buildCsvPayload(db, options));
    const scopeSuffix = options.scope === "all" ? "all" : options.scope === "selected" ? "selected" : options.entityId;

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

function applyCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

function createTeachTableRequestListener(options = {}) {
  const staticDir = options.staticDir || path.join(ROOT_DIR, "apps", "web");
  const enableStatic = options.enableStatic !== false;

  return async function requestListener(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    applyCorsHeaders(res);

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

      if (enableStatic) {
        await serveStatic(res, staticDir, url.pathname);
        return;
      }

      notFound(res);
    } catch (error) {
      console.error(error);
      sendError(res, error, 500);
    }
  };
}

module.exports = {
  buildAppConfigScript,
  buildFirebaseWebConfig,
  createTeachTableRequestListener,
};
