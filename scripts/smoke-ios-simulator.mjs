import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const app = process.argv[2];
if (!app?.endsWith(".app")) throw new Error("Pass the built simulator .app path.");
const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], {
  encoding: "utf8", timeout: 240_000, killSignal: "SIGKILL",
});
const devices = JSON.parse(simctl("list", "devices", "available", "--json"));
const device = Object.entries(devices.devices)
  .filter(([runtime]) => runtime.includes("iOS"))
  .flatMap(([, values]) => values)
  .find((value) => value.isAvailable && value.name.startsWith("iPhone"));
if (!device) throw new Error("No available iPhone simulator runtime.");
const { udid } = device;
const bundle = "com.aspeed.easy-erp";
mkdirSync("simulator-evidence", { recursive: true });
let consoleProcess;
try {
  console.log(`Booting ${device.name}`);
  if (device.state !== "Booted") simctl("boot", udid);
  simctl("bootstatus", udid, "-b");
  console.log("Installing simulator application");
  simctl("install", udid, app);
  const log = openSync("simulator-evidence/console.log", "w");
  consoleProcess = spawn("xcrun", ["simctl", "launch", "--console", udid, bundle], {
    stdio: ["ignore", log, log],
    env: { ...process.env, SIMCTL_CHILD_RUST_BACKTRACE: "1" },
  });
  closeSync(log);
  console.log("Waiting for application startup");
  await new Promise((resolve) => setTimeout(resolve, 20000));
  simctl("io", udid, "screenshot", "simulator-evidence/launch.png");
  // A crashed process cannot be terminated successfully: fail the smoke check.
  simctl("terminate", udid, bundle);
  console.log(`Simulator install and launch passed: ${device.name}`);
} finally {
  consoleProcess?.kill("SIGKILL");
  try {
    writeFileSync("simulator-evidence/system.log", simctl("spawn", udid, "log", "show", "--last", "3m", "--style", "compact", "--predicate", 'process == "库存管理"'));
    const reports = join(homedir(), "Library/Logs/DiagnosticReports");
    for (const name of readdirSync(reports)) {
      if (name.includes("库存管理") || name.includes("easy-erp"))
        copyFileSync(join(reports, name), join("simulator-evidence", name));
    }
  } catch (error) { console.warn(`Diagnostics: ${error.message}`); }
  try { simctl("shutdown", udid); } catch { /* Preserve the original failure. */ }
}
