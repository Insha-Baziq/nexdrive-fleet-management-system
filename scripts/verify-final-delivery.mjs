import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredEnvironment = [
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "TIGRIS_BUCKET",
  "TIGRIS_ACCESS_KEY_ID",
  "TIGRIS_SECRET_ACCESS_KEY",
];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length) {
  throw new Error("Final regression requires .env.local values for: " + missingEnvironment.join(", "));
}

const origin = new URL(process.env.BETTER_AUTH_URL);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!localHosts.has(origin.hostname) || origin.port !== "3000") {
  throw new Error("Final regression only targets a local NexDrive server at http://127.0.0.1:3000. No fixtures were created.");
}

for (const route of ["/login", "/platform/login"]) {
  const response = await fetch(new URL(route, origin));
  if (response.status !== 200) {
    throw new Error("Read-only preflight failed for " + route + " (HTTP " + response.status + "). No fixtures were created.");
  }
  await response.arrayBuffer();
}

const suites = [
  { name: "Completed Phase One tickets 01-30", script: "verify-completed-regression.mjs" },
  { name: "Public organization onboarding", script: "verify-onboarding-temporary.mjs" },
  { name: "Email templates and safe delivery", script: "verify-email.mjs", reactServer: true },
  { name: "Account password recovery", script: "verify-password-recovery-temporary.mjs", reactServer: true },
  { name: "Invitation delivery and acceptance", script: "verify-invitation-delivery-temporary.mjs", reactServer: true },
  { name: "Driver password reset", script: "verify-driver-password-reset-temporary.mjs", reactServer: true },
  { name: "Profile and password settings", script: "verify-profile-settings-temporary.mjs" },
  { name: "Personal account documents", script: "verify-user-documents-temporary.mjs", reactServer: true },
  { name: "Organization company settings", script: "verify-company-settings-temporary.mjs" },
  { name: "Vehicle CSV and XLSX import", script: "verify-vehicle-import-temporary.mjs" },
  { name: "Driver CSV and XLSX import", script: "verify-driver-import-temporary.mjs" },
  { name: "Vehicle inspection history", script: "verify-vehicle-inspections-temporary.mjs" },
  { name: "Platform administration", script: "verify-platform-administration-temporary.mjs", reactServer: true },
  { name: "English and French interface and upload copy", script: "verify-work25-french-copy-temporary.mjs", reactServer: true },
];

const throttleState = path.join(os.tmpdir(), "nexdrive-final-regression-" + randomUUID() + ".json");
let failedSuite = null;

try {
  process.stdout.write("NexDrive final regression target: " + origin.origin + "\n");
  process.stdout.write("The suites create temporary database records and private storage objects, then clean them up.\n");

  for (const suite of suites) {
    process.stdout.write("\n=== " + suite.name + " ===\n");
    const nodeArguments = ["--env-file=.env.local"];
    if (suite.script !== "verify-completed-regression.mjs") {
      nodeArguments.push("--import", "./scripts/verify-auth-throttle.mjs");
      if (suite.reactServer) nodeArguments.push("--conditions=react-server", "--import", "tsx");
    }
    nodeArguments.push("scripts/" + suite.script);

    const result = spawnSync(process.execPath, nodeArguments, {
      cwd: webRoot,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        NEXDRIVE_VERIFY_AUTH_THROTTLE_STATE: throttleState,
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      failedSuite = suite.name;
      process.exitCode = result.status ?? 1;
      process.stderr.write("Final regression stopped at: " + failedSuite + ".\n");
      break;
    }
  }
} finally {
  fs.rmSync(throttleState, { force: true });
}

if (!failedSuite && !process.exitCode) {
  process.stdout.write("\nAll final delivery regression suites passed.\n");
}
