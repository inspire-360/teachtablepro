import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const sourceRuntimeDir = path.join(repoRoot, "apps", "api", "runtime");
const targetRuntimeDir = path.join(repoRoot, "functions", "runtime");
const rootEnvPath = path.join(repoRoot, ".env");
const functionsEnvPath = path.join(repoRoot, "functions", ".env");

const ENV_MAPPINGS = [
  ["FIREBASE_PROJECT_ID", "TEACHTABLE_FIREBASE_PROJECT_ID"],
  ["FIREBASE_WEB_API_KEY", "TEACHTABLE_FIREBASE_WEB_API_KEY"],
  ["FIREBASE_AUTH_DOMAIN", "TEACHTABLE_FIREBASE_AUTH_DOMAIN"],
  ["FIREBASE_DATABASE_URL", "TEACHTABLE_FIREBASE_DATABASE_URL"],
  ["FIREBASE_STORAGE_BUCKET", "TEACHTABLE_FIREBASE_STORAGE_BUCKET"],
  ["FIREBASE_MESSAGING_SENDER_ID", "TEACHTABLE_FIREBASE_MESSAGING_SENDER_ID"],
  ["FIREBASE_APP_ID", "TEACHTABLE_FIREBASE_APP_ID"],
];

function formatEnvValue(value) {
  return JSON.stringify(String(value ?? ""));
}

async function parseEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const values = {};

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      values[key] = value;
    }

    return values;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function syncRuntimeDirectory() {
  await fs.rm(targetRuntimeDir, { recursive: true, force: true });
  await fs.cp(sourceRuntimeDir, targetRuntimeDir, { recursive: true });
}

async function syncFunctionsEnvFile() {
  const rootEnv = await parseEnvFile(rootEnvPath);
  if (!rootEnv) {
    return;
  }

  const existingFunctionsEnv = await parseEnvFile(functionsEnvPath) || {};
  const nextEnv = { ...existingFunctionsEnv };

  for (const [sourceKey, targetKey] of ENV_MAPPINGS) {
    if (sourceKey in rootEnv) {
      nextEnv[targetKey] = rootEnv[sourceKey];
    }
  }

  const lines = [
    "# Generated from ../.env by functions/scripts/sync-runtime.mjs",
    ...Object.entries(nextEnv)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => `${key}=${formatEnvValue(value)}`),
  ];

  await fs.writeFile(functionsEnvPath, `${lines.join("\n")}\n`, "utf8");
}

await syncRuntimeDirectory();
await syncFunctionsEnvFile();
