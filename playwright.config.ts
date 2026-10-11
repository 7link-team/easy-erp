import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir =
  process.env.ERP_E2E_DATA ?? mkdtempSync(join(tmpdir(), "easy-erp-e2e-"));
process.env.ERP_E2E_DATA = dataDir;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"], ["html", { open: "never" }]],
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
    timeout: 30_000,
  },
});
