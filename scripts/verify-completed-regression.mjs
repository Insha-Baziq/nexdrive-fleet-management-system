import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  { tickets: "01", script: "verify-auth-temporary.mjs" },
  { tickets: "02", script: "verify-vehicles-temporary.mjs" },
  { tickets: "03", script: "verify-drivers-temporary.mjs" },
  { tickets: "04, 05, 06, 07", script: "verify-assignments-temporary.mjs" },
  { tickets: "08", script: "verify-vehicle-documents-temporary.mjs" },
  { tickets: "09", script: "verify-driver-documents-temporary.mjs" },
  { tickets: "10", script: "verify-driver-workspace-temporary.mjs" },
  { tickets: "11", script: "verify-driver-paperwork-temporary.mjs" },
  { tickets: "12", script: "verify-anomalies-temporary.mjs" },
  { tickets: "13", script: "verify-driver-anomaly-report-temporary.mjs" },
  { tickets: "14", script: "verify-fines-temporary.mjs" },
  { tickets: "15", script: "verify-fine-association-temporary.mjs" },
  { tickets: "16", script: "verify-claims-temporary.mjs" },
  { tickets: "17", script: "verify-claim-contacts-temporary.mjs" },
  { tickets: "18", script: "verify-claim-stages-temporary.mjs" },
  { tickets: "19", script: "verify-vehicle-mileage-history-temporary.mjs" },
  { tickets: "20", script: "verify-dashboard-counts-temporary.mjs" },
  { tickets: "21", script: "verify-in-app-alerts-temporary.mjs", args: ["--import", "tsx"] },
  { tickets: "22", script: "verify-insurance-events-temporary.mjs" },
  { tickets: "23", script: "verify-maintenance-temporary.mjs" },
  { tickets: "24", script: "verify-assignment-correction-temporary.mjs" },
  { tickets: "25", script: "verify-fine-steps-temporary.mjs" },
  { tickets: "26", script: "verify-fine-company-paid-temporary.mjs" },
  { tickets: "27", script: "verify-driver-mileage-entry-temporary.mjs" },
  { tickets: "28", script: "verify-record-archive-temporary.mjs" },
  { tickets: "Organization users", number: 29, script: "verify-organization-users-temporary.mjs" },
  { tickets: "Account memberships", number: 30, script: "verify-memberships-temporary.mjs" },
];
const requestedStart = process.argv.find((argument) => argument.startsWith("--from="))?.slice("--from=".length);
const requestedEnd = process.argv.find((argument) => argument.startsWith("--to="))?.slice("--to=".length);
const deploymentMode = process.argv.includes("--deployment");
const startTicket = requestedStart === undefined ? 1 : Number(requestedStart);
const endTicket = requestedEnd === undefined ? 30 : Number(requestedEnd);
if (!Number.isInteger(startTicket) || startTicket < 1 || startTicket > 30 ||
    !Number.isInteger(endTicket) || endTicket < startTicket || endTicket > 30) {
  throw new Error("Use --from=<first ticket> and --to=<last ticket> with values from 1 to 30.");
}
const selectedSuites = suites.filter((suite) => {
  const ticket = suite.number ?? Number(suite.tickets.split(",")[0].trim());
  return ticket >= startTicket && ticket <= endTicket;
});

const authThrottleState = path.join(os.tmpdir(), `nexdrive-auth-throttle-${randomUUID()}.json`);

try {
  for (const suite of selectedSuites) {
    process.stdout.write(`\n=== Tickets ${suite.tickets}: ${suite.script} ===\n`);
    const result = spawnSync(process.execPath, [
      "--env-file=.env.local",
      "--import", "./scripts/verify-auth-throttle.mjs",
      ...(suite.args ?? []),
      `scripts/${suite.script}`,
    ], {
      cwd: webRoot,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        NEXDRIVE_VERIFY_AUTH_THROTTLE_STATE: authThrottleState,
        ...(deploymentMode ? { NEXDRIVE_VERIFY_DEPLOYMENT: "1" } : {}),
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stderr.write(`Regression stopped at tickets ${suite.tickets}.\n`);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  fs.rmSync(authThrottleState, { force: true });
}
if (!process.exitCode) process.stdout.write("\nAll selected completed-ticket regression suites passed.\n");
