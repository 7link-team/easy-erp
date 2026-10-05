import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const app = process.argv[2];
if (!app?.endsWith(".app")) throw new Error("Pass the built simulator .app path.");
const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], {
  encoding: "utf8", timeout: 240_000,
});
const devices = JSON.parse(simctl("list", "devices", "available", "--json"));
const device = Object.entries(devices.devices)
  .filter(([runtime]) => runtime.includes("iOS"))
  .flatMap(([, values]) => values)
  .find((value) => value.isAvailable && value.name.startsWith("iPhone"));
if (!device) throw new Error("No available iPhone simulator runtime.");
const { udid } = device;
const bundle = "com.aspeed.easy-erp";
try {
  if (device.state !== "Booted") simctl("boot", udid);
  simctl("bootstatus", udid, "-b");
  simctl("install", udid, app);
  console.log(simctl("launch", udid, bundle));
  await new Promise((resolve) => setTimeout(resolve, 8000));
  mkdirSync("simulator-evidence", { recursive: true });
  simctl("io", udid, "screenshot", "simulator-evidence/launch.png");
  // A crashed process cannot be terminated successfully: fail the smoke check.
  simctl("terminate", udid, bundle);
  console.log(`Simulator install and launch passed: ${device.name}`);
} finally {
  try { simctl("shutdown", udid); } catch { /* Preserve the original failure. */ }
}
