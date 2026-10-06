import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const app = process.argv[2];
if (!app?.endsWith(".app")) throw new Error("Pass the built simulator .app path.");
const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], {
  encoding: "utf8", timeout: 240_000, killSignal: "SIGKILL",
  env: { ...process.env, SIMCTL_CHILD_RUST_BACKTRACE: "1" },
});
const devices = JSON.parse(simctl("list", "devices", "available", "--json"));
const device = Object.entries(devices.devices)
  .filter(([runtime]) => runtime.includes("iOS"))
  .flatMap(([, values]) => values)
  .find((value) => value.isAvailable && value.name.startsWith("iPhone"));
if (!device) throw new Error("No available iPhone simulator runtime.");
const { udid } = device;
const bundle = "com.aspeed.easy-erp";
const logPredicate = 'process == "EasyERP" OR process == "库存管理" OR eventMessage CONTAINS[c] "easy-erp" OR eventMessage CONTAINS[c] "panic"';
mkdirSync("simulator-evidence", { recursive: true });
let systemLogProcess;
try {
  console.log(`Booting ${device.name}`);
  if (device.state !== "Booted") simctl("boot", udid);
  simctl("bootstatus", udid, "-b");
  console.log("Installing simulator application");
  simctl("install", udid, app);
  const systemLog = openSync("simulator-evidence/live-system.log", "w");
  systemLogProcess = spawn("xcrun", ["simctl", "spawn", udid, "log", "stream", "--level", "debug", "--style", "compact", "--predicate", logPredicate], {
    stdio: ["ignore", systemLog, systemLog],
  });
  closeSync(systemLog);
  // Wait for simctl to confirm launch before starting the survival timer.
  // On a busy runner, --console can still be waiting to launch after 20s.
  const launch = simctl("launch", udid, bundle);
  writeFileSync("simulator-evidence/console.log", launch);
  if (!launch.includes(`${bundle}: `)) throw new Error("Simulator did not confirm application launch.");
  console.log("Application launched; checking it stays running");
  await new Promise((resolve) => setTimeout(resolve, 20000));
  simctl("io", udid, "screenshot", "simulator-evidence/launch.png");
  // A crashed process cannot be terminated successfully: fail the smoke check.
  simctl("terminate", udid, bundle);
  console.log(`Simulator install and launch passed: ${device.name}`);
} finally {
  systemLogProcess?.kill("SIGKILL");
  try {
    writeFileSync("simulator-evidence/system.log", simctl("spawn", udid, "log", "show", "--last", "5m", "--info", "--debug", "--style", "compact", "--predicate", logPredicate));
    const reportDirectories = [
      join(homedir(), "Library/Logs/DiagnosticReports"),
      join(homedir(), "Library/Developer/CoreSimulator/Devices", udid, "data/Library/Logs/CrashReporter"),
    ];
    for (const reports of reportDirectories) {
      if (!existsSync(reports)) continue;
      for (const name of readdirSync(reports, { recursive: true })) {
        if (/\.(ips|crash)$/.test(name))
          copyFileSync(join(reports, name), join("simulator-evidence", name.replaceAll("/", "_")));
      }
    }
  } catch (error) { console.warn(`Diagnostics: ${error.message}`); }
  try { simctl("shutdown", udid); } catch { /* Preserve the original failure. */ }
}
