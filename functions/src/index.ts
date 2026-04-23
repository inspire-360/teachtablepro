import path from "node:path";

import {setGlobalOptions} from "firebase-functions/v2";
import {type Request, onRequest} from "firebase-functions/v2/https";
import type {Response} from "express";
// @ts-expect-error Runtime files are generated into ../runtime during build.
import httpApp = require("../runtime/http-app.js");

process.env.TEACHTABLE_ROOT_DIR ||= path.resolve(__dirname, "..");
if (!process.env.TEACHTABLE_STORAGE_DRIVER && !process.env.DATABASE_URL) {
  process.env.TEACHTABLE_STORAGE_DRIVER = "firebase_storage";
}

const {createTeachTableRequestListener} = httpApp as {
  createTeachTableRequestListener: (
    options?: {enableStatic?: boolean; staticDir?: string}
  ) => (request: Request, response: Response) => Promise<void>;
};

setGlobalOptions({
  region: "asia-southeast1",
  maxInstances: 1,
  concurrency: 1,
  memory: "1GiB",
});

const handler = createTeachTableRequestListener({enableStatic: false});

export const teachtableApi = onRequest(
  {
    cors: true,
    timeoutSeconds: 60,
  },
  async (request, response) => {
    await handler(request, response);
  },
);
