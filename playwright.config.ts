import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir =
  process.env.ERP_E2E_DATA ?? mkdtempSync(join(tmpdir(), "easy-erp-e2e-"));
process.env.ERP_E2E_DATA = dataDir;

const browser =
  process.env.ERP_E2E_BROWSER === "webkit" ? "webkit" : "chromium";
const artifacts = join("build-artifacts", "playwright", browser);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The suite drives a debounced, networked list UI through a debug-profile
  // server. On an unloaded machine a test takes 11-15s; under load it doubles,
  // so the old 45s cap and Playwright's 5s default expect budget left no
  // headroom on slow CI runners and reported timeouts as wrong row counts.
  // Waiting longer costs nothing while tests pass and weakens no assertion.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: join(artifacts, "results"),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: join(artifacts, "report") }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4289",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects:
    process.env.ERP_E2E_BROWSER === "webkit"
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `target/debug/easy-erp-server${process.platform === "win32" ? ".exe" : ""} --data-dir "${dataDir}" --bind 127.0.0.1:4289`,
    url: "http://127.0.0.1:4289/api/status",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
