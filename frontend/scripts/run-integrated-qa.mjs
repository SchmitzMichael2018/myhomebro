import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const frontendRoot = fileURLToPath(new URL("../", import.meta.url));

const host = process.env.QA_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.QA_BACKEND_PORT || "8000";
const backendOrigin = `http://${host}:${backendPort}`;
const python = process.env.PYTHON || "python";
const specs = process.argv.slice(2);
const playwrightArgs = specs.length
  ? specs
  : ["intake-estimate-agreement-flow.spec.js"];
const reuseExistingBackend = /^(1|true|yes)$/i.test(process.env.QA_REUSE_BACKEND || "");

let backendProcess = null;
const backendEnv = {
  DJANGO_SETTINGS_MODULE: "core.settings_local_qa",
  DEBUG: "True",
  LOAD_LOCAL_ENV: "true",
  VITE_API_BASE_URL: backendOrigin,
  VITE_GOOGLE_MAPS_API_KEY: "",
  GOOGLE_MAPS_API_KEY: "",
  GOOGLE_PLACES_API_KEY: "",
  QA_INTEGRATED_RUN: "1",
};

function spawnCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio || "inherit",
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
  });
  return child;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, options);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function probeBackend() {
  try {
    const response = await fetch(`${backendOrigin}/admin/login/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        state: "redirect",
        location: response.headers.get("location") || "",
        status: response.status,
      };
    }
    if (response.status > 0 && response.status < 500) {
      return { state: "healthy", status: response.status };
    }
    return { state: "unhealthy", status: response.status };
  } catch {
    return { state: "down" };
  }
}

async function waitForBackend() {
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.QA_BACKEND_HEALTH_TIMEOUT_MS || 120000);
  while (Date.now() - startedAt < timeoutMs) {
    const probe = await probeBackend();
    if (probe.state === "healthy") return;
    if (probe.state === "redirect") {
      throw new Error(
        `Backend at ${backendOrigin} is redirecting to ${probe.location || "HTTPS"}. ` +
          "Stop the existing server or run Django with core.settings_local_qa."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Django backend did not become healthy at ${backendOrigin}/admin/login/ within ${timeoutMs}ms.`
  );
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(backendProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
  } else {
    backendProcess.kill("SIGTERM");
  }
}

process.on("exit", stopBackend);
process.on("SIGINT", () => {
  stopBackend();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopBackend();
  process.exit(143);
});

async function main() {
  console.log("[integrated-qa] Seeding local QA data...");
  await run(python, ["backend/manage.py", "seed_qa_environment"], {
    env: backendEnv,
  });

  const initialProbe = await probeBackend();
  if (initialProbe.state === "healthy" && reuseExistingBackend) {
    console.log(`[integrated-qa] Reusing healthy backend at ${backendOrigin}.`);
  } else if (initialProbe.state === "healthy") {
    throw new Error(
      `Backend is already running at ${backendOrigin}. Stop it so this runner can own the QA lifecycle, ` +
        "or set QA_REUSE_BACKEND=true to reuse it intentionally."
    );
  } else if (initialProbe.state === "redirect") {
    throw new Error(
      `Backend at ${backendOrigin} is redirecting to ${initialProbe.location || "HTTPS"}. ` +
        "Stop the existing server or run Django with core.settings_local_qa."
    );
  } else {
    console.log(`[integrated-qa] Starting Django backend at ${backendOrigin}...`);
    backendProcess = spawnCommand(
      python,
      ["backend/manage.py", "runserver", `${host}:${backendPort}`, "--noreload", "--nothreading"],
      {
        stdio: "inherit",
        env: backendEnv,
      }
    );
    await waitForBackend();
  }

  console.log(`[integrated-qa] Running Playwright specs: ${playwrightArgs.join(" ")}`);
  await run(
    "npx",
    [
      "playwright",
      "test",
      ...playwrightArgs,
      "--project=chromium",
      "--reporter=line",
      "--retries=0",
      "--workers=1",
      "--timeout=30000",
    ],
    {
      cwd: frontendRoot,
      env: backendEnv,
    }
  );
}

main()
  .catch((error) => {
    console.error(`[integrated-qa] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(stopBackend);
