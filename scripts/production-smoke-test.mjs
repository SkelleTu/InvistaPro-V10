import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 5123);
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "0".repeat(64),
  SESSION_SECRET: process.env.SESSION_SECRET || "smoke-test-session-secret",
};

const child = spawn(process.execPath, ["dist/index.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", d => { stdout += d.toString(); if (stdout.length > 20000) stdout = stdout.slice(-20000); });
child.stderr.on("data", d => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });

const started = Date.now();
let ok = false;
let lastError = null;

try {
  while (Date.now() - started < 45000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.text();
      if (response.status === 200 || response.status === 503) {
        console.log(JSON.stringify({
          healthStatus: response.status,
          healthBody: body.slice(0, 4000),
          bootMs: Date.now() - started
        }, null, 2));
        ok = true;
        break;
      }
      lastError = new Error(`unexpected HTTP status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ok) throw lastError || new Error("server did not expose /health within 45 seconds");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 2500));
  if (child.exitCode === null) child.kill("SIGKILL");
  console.log("----- SERVER STDOUT (tail) -----");
  console.log(stdout.slice(-8000));
  console.log("----- SERVER STDERR (tail) -----");
  console.log(stderr.slice(-8000));
}

console.log("SMOKE TEST: PASS");
