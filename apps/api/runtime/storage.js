const fs = require("node:fs/promises");
const path = require("node:path");
const { createEmptyDatabase } = require("./empty-data");

const ROOT_DIR = path.resolve(process.env.TEACHTABLE_ROOT_DIR || process.cwd());
const DATA_DIR = path.join(ROOT_DIR, "data");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const PDF_OUTPUT_DIR = path.join(OUTPUT_DIR, "pdf");
const CSV_OUTPUT_DIR = path.join(OUTPUT_DIR, "csv");
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const TMP_PDF_DIR = path.join(TMP_DIR, "pdfs");
const DB_FILE = path.join(DATA_DIR, "teachtable-db.json");
const IS_CLOUD_FUNCTIONS_RUNTIME = Boolean(
  process.env.K_SERVICE
  || process.env.FUNCTION_TARGET
  || process.env.GOOGLE_CLOUD_PROJECT,
);
const STORAGE_DRIVER = (
  process.env.TEACHTABLE_STORAGE_DRIVER
  || (process.env.DATABASE_URL ? "prisma" : IS_CLOUD_FUNCTIONS_RUNTIME ? "firebase_storage" : "json")
).toLowerCase();

let queue = Promise.resolve();

let prismaDriver;
let firebaseStorageDriver;

function getPrismaDriver() {
  if (!prismaDriver) {
    prismaDriver = require("./prisma-driver");
  }

  return prismaDriver;
}

function getFirebaseStorageDriver() {
  if (!firebaseStorageDriver) {
    firebaseStorageDriver = require("./firebase-storage-driver");
  }

  return firebaseStorageDriver;
}

async function ensureRuntimeDirs() {
  if (STORAGE_DRIVER !== "json") {
    return;
  }

  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(PDF_OUTPUT_DIR, { recursive: true }),
    fs.mkdir(CSV_OUTPUT_DIR, { recursive: true }),
    fs.mkdir(TMP_PDF_DIR, { recursive: true }),
  ]);
}

async function ensureDatabase() {
  await ensureRuntimeDirs();
  if (STORAGE_DRIVER === "prisma") {
    await getPrismaDriver().ensurePrismaDatabase();
    return;
  }

  if (STORAGE_DRIVER === "firebase_storage") {
    await getFirebaseStorageDriver().ensureFirebaseStorageDatabase();
    return;
  }

  try {
    await fs.access(DB_FILE);
  } catch {
    await writeDatabase(createEmptyDatabase());
  }
}

async function readDatabase() {
  await ensureDatabase();
  if (STORAGE_DRIVER === "prisma") {
    return getPrismaDriver().readPrismaDatabase();
  }

  if (STORAGE_DRIVER === "firebase_storage") {
    return getFirebaseStorageDriver().readFirebaseStorageDatabase();
  }

  const raw = await fs.readFile(DB_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeDatabase(database) {
  await ensureRuntimeDirs();
  if (STORAGE_DRIVER === "prisma") {
    await getPrismaDriver().replacePrismaDatabase(database);
    return;
  }

  if (STORAGE_DRIVER === "firebase_storage") {
    await getFirebaseStorageDriver().replaceFirebaseStorageDatabase(database);
    return;
  }

  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(database, null, 2), "utf8");
  await fs.rename(tempFile, DB_FILE);
}

async function withDatabase(mutator) {
  const operation = queue.then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    await writeDatabase(database);
    return result;
  });

  queue = operation.catch(() => undefined);
  return operation;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  OUTPUT_DIR,
  PDF_OUTPUT_DIR,
  CSV_OUTPUT_DIR,
  TMP_PDF_DIR,
  DB_FILE,
  ensureRuntimeDirs,
  ensureDatabase,
  readDatabase,
  writeDatabase,
  withDatabase,
  STORAGE_DRIVER,
};
