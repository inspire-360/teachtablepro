const http = require("node:http");
const path = require("node:path");
const { loadEnvFile } = require("./apps/api/runtime/load-env");

loadEnvFile();
process.env.TEACHTABLE_ROOT_DIR ||= __dirname;

const { createTeachTableRequestListener } = require("./apps/api/runtime/http-app");
const { ensureDatabase } = require("./apps/api/runtime/storage");

const PORT = process.env.PORT || 4178;
const requestListener = createTeachTableRequestListener({
  staticDir: path.join(__dirname, "apps", "web"),
});

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
