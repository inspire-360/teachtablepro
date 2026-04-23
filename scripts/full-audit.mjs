import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(cwd, "tmp", "full-audit", timestamp);
await mkdir(outputDir, { recursive: true });

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function runCommand(label, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const stdoutPath = path.join(outputDir, `${label}.stdout.log`);
  const stderrPath = path.join(outputDir, `${label}.stderr.log`);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.echoStderr !== false) {
        process.stderr.write(text);
      }
    });

    child.stdin?.on("error", () => {
      // Ignore stdin errors for commands that exit before consuming input.
    });

    if (typeof options.stdinText === "string") {
      child.stdin?.end(options.stdinText);
    }

    child.on("close", async (code) => {
      await Promise.all([
        writeFile(stdoutPath, stdout, "utf8"),
        writeFile(stderrPath, stderr, "utf8"),
      ]);

      resolve({
        label,
        ok: code === 0,
        exitCode: code ?? 1,
        startedAt,
        endedAt: new Date().toISOString(),
        stdoutPath,
        stderrPath,
        stdout,
        stderr,
      });
    });
  });
}

function npmInvocation(args) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
    };
  }

  return {
    command: "npm",
    args,
  };
}

async function collectFiles(targetPath) {
  const entries = await readDirSafe(targetPath);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".codex-smoke", "tmp", "lib", "generated"].includes(entry.name)) {
        continue;
      }
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (!/\.(js|mjs)$/i.test(entry.name)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function readDirSafe(targetPath) {
  const { readdir } = await import("node:fs/promises");
  return readdir(targetPath, { withFileTypes: true });
}

function shouldParseAsModule(filePath, source) {
  const normalized = toPosixPath(filePath);
  if (normalized.endsWith(".mjs")) {
    return true;
  }
  if (normalized.includes("/apps/web/")) {
    return true;
  }
  return /^\s*(import|export)\s/m.test(source);
}

async function runSyntaxAudit() {
  const targets = [
    path.join(cwd, "apps"),
    path.join(cwd, "scripts"),
    path.join(cwd, "server.js"),
  ];
  const files = [];

  for (const target of targets) {
    const stat = await statSafe(target);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...await collectFiles(target));
    } else {
      files.push(target);
    }
  }

  const errors = [];
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    const isModule = shouldParseAsModule(filePath, source);
    const result = isModule
      ? await runCommand(`syntax-${files.indexOf(filePath)}`, process.execPath, ["--check", "--input-type=module"], {
        stdinText: source,
        echoStderr: false,
      })
      : await runCommand(`syntax-${files.indexOf(filePath)}`, process.execPath, ["--check", filePath], {
        echoStderr: false,
      });

    if (!result.ok) {
      errors.push({
        file: filePath,
        message: (result.stderr || result.stdout || "Unknown syntax error").trim(),
      });
    }
  }

  const reportPath = path.join(outputDir, "syntax-audit.json");
  const report = {
    checkedFileCount: files.length,
    errorCount: errors.length,
    errors,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  if (errors.length > 0) {
    for (const issue of errors) {
      console.error(`[syntax] ${issue.file}: ${issue.message}`);
    }
  } else {
    console.log(`[syntax] checked ${files.length} files with no syntax errors`);
  }

  return {
    label: "syntax",
    ok: errors.length === 0,
    exitCode: errors.length === 0 ? 0 : 1,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    reportPath,
    checkedFileCount: files.length,
    errorCount: errors.length,
  };
}

async function statSafe(targetPath) {
  const { stat } = await import("node:fs/promises");
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

async function runBrowserAudit() {
  const browserPort = 4300 + Math.floor(Math.random() * 200);
  const result = await runCommand("browser-audit", process.execPath, ["scripts/browser-audit.mjs"], {
    env: {
      BROWSER_AUDIT_FORCE_SERVER: "1",
      BROWSER_AUDIT_PORT: String(browserPort),
    },
  });

  let parsed = null;
  try {
    const stdout = await readFile(result.stdoutPath, "utf8");
    parsed = JSON.parse(stdout.trim().split(/\r?\n(?=\{)/).pop() || "{}");
  } catch {
    parsed = null;
  }

  return {
    ...result,
    summary: parsed?.summary || null,
    browserReportPath: parsed?.statePath || "",
    appUrl: parsed?.appUrl || `http://127.0.0.1:${browserPort}/`,
    startup: parsed?.startup || null,
  };
}

const report = {
  startedAt: new Date().toISOString(),
  outputDir,
  tasks: {},
};

{
  const invocation = npmInvocation(["run", "build"]);
  report.tasks.build = await runCommand("build", invocation.command, invocation.args);
}
{
  const invocation = npmInvocation(["test"]);
  report.tasks.tests = await runCommand("tests", invocation.command, invocation.args);
}
{
  const invocation = npmInvocation(["--prefix", "functions", "run", "build"]);
  report.tasks.functionsBuild = await runCommand("functions-build", invocation.command, invocation.args);
}
{
  const invocation = npmInvocation(["--prefix", "functions", "run", "lint"]);
  report.tasks.functionsLint = await runCommand("functions-lint", invocation.command, invocation.args);
}
report.tasks.syntax = await runSyntaxAudit();
report.tasks.browser = await runBrowserAudit();

report.success = Object.values(report.tasks).every((task) => task.ok);
report.endedAt = new Date().toISOString();

const reportPath = path.join(outputDir, "full-audit-report.json");
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("\nFull audit summary");
for (const [name, task] of Object.entries(report.tasks)) {
  console.log(`- ${name}: ${task.ok ? "ok" : `failed (exit ${task.exitCode})`}`);
}
console.log(`- report: ${reportPath}`);

process.exit(report.success ? 0 : 1);
