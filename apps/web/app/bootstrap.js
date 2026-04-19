export async function bootstrapApplication({ start, onFatalError } = {}) {
  if (typeof start !== "function") {
    throw new Error("bootstrapApplication ต้องได้รับฟังก์ชัน start");
  }

  try {
    return await start();
  } catch (error) {
    globalThis.__TEACHTABLE_REPORT_STARTUP_ISSUE__?.(
      error instanceof Error ? error.message : String(error || "TeachTable failed to start."),
    );

    if (typeof onFatalError === "function") {
      onFatalError(error);
      return null;
    }

    throw error;
  }
}
