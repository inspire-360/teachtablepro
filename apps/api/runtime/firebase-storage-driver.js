const { createEmptyDatabase } = require("./empty-data");
const { getProjectId } = require("./firebase-auth");

const DEFAULT_DATABASE_OBJECT = "runtime/teachtable-db.json";

let storageFile;

function readFirebaseEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function readFirebaseConfig() {
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || "{}");
  } catch {
    return {};
  }
}

function resolveBucketName() {
  return readFirebaseEnvValue(
    "TEACHTABLE_STORAGE_BUCKET",
    "TEACHTABLE_FIREBASE_STORAGE_BUCKET",
    "FIREBASE_STORAGE_BUCKET",
  ) || readFirebaseConfig().storageBucket || `${getProjectId()}.firebasestorage.app`;
}

function resolveDatabaseObjectPath() {
  return readFirebaseEnvValue("TEACHTABLE_STORAGE_OBJECT") || DEFAULT_DATABASE_OBJECT;
}

function buildInitializationOptions() {
  const options = {};
  const bucketName = resolveBucketName();
  const projectId = getProjectId();

  if (bucketName) {
    options.storageBucket = bucketName;
  }

  if (projectId) {
    options.projectId = projectId;
  }

  return options;
}

function getDatabaseFile() {
  if (storageFile) {
    return storageFile;
  }

  const { getApp, getApps, initializeApp } = require("firebase-admin/app");
  const { getStorage } = require("firebase-admin/storage");
  const app = getApps().length > 0 ? getApp() : initializeApp(buildInitializationOptions());
  const bucketName = resolveBucketName();

  storageFile = getStorage(app).bucket(bucketName).file(resolveDatabaseObjectPath());
  return storageFile;
}

function wrapStorageError(action, error) {
  const reason = error instanceof Error ? error.message : String(error);

  return new Error(
    `Firebase Storage database ${action} failed. `
    + "Ensure Cloud Storage is enabled for this project and the storage bucket config is correct. "
    + `Reason: ${reason}`,
  );
}

async function ensureFirebaseStorageDatabase() {
  const file = getDatabaseFile();

  try {
    const [exists] = await file.exists();
    if (!exists) {
      await file.save(JSON.stringify(createEmptyDatabase(), null, 2), {
        resumable: false,
        contentType: "application/json; charset=utf-8",
        metadata: {
          cacheControl: "no-store",
        },
      });
    }
  } catch (error) {
    throw wrapStorageError("initialization", error);
  }
}

async function readFirebaseStorageDatabase() {
  const file = getDatabaseFile();

  try {
    await ensureFirebaseStorageDatabase();
    const [buffer] = await file.download();
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Firebase Storage database contains invalid JSON.");
    }

    throw wrapStorageError("read", error);
  }
}

async function replaceFirebaseStorageDatabase(database) {
  const file = getDatabaseFile();

  try {
    await file.save(JSON.stringify(database, null, 2), {
      resumable: false,
      contentType: "application/json; charset=utf-8",
      metadata: {
        cacheControl: "no-store",
      },
    });
  } catch (error) {
    throw wrapStorageError("write", error);
  }
}

module.exports = {
  ensureFirebaseStorageDatabase,
  readFirebaseStorageDatabase,
  replaceFirebaseStorageDatabase,
};
