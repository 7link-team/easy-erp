// Run after performance.py, on its synthetic database only.
// Usage: node scripts/performance-browser.mjs build-artifacts/tmp/performance-xxx/100000
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = fs.realpathSync(path.resolve(process.argv[2] || ""));
if (
  !directory.startsWith(path.join(root, "build-artifacts", "tmp", "performance-")) ||
  !fs.existsSync(path.join(directory, "results.json")) ||
  !fs.existsSync(path.join(directory, "..", "metadata.json"))
) {
  throw new Error("Expected a completed synthetic performance.py dataset");
}
const port = Number(process.env.ERP_PERF_PORT || 4297);
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("hex");
const digest = createHash("sha256").update(token).digest("hex");
// Seed a short-lived test session for the existing synthetic administrator.
// This measures authenticated UI readiness; it does not benchmark login.
const sql = `
import sqlite3,sys,time
db=sqlite3.connect(sys.argv[1])
actor=db.execute("SELECT id FROM users WHERE username='perf_admin'").fetchone()[0]
now=int(time.time()*1000)
db.execute('INSERT INTO sessions VALUES (?,?,?,?,?)',(sys.argv[2],actor,now+3600000,now,3600))
db.commit()
db.close()
`;
execFileSync(
  "python3",
  ["-c", sql, path.join(directory, "inventory.sqlite"), digest],
  { windowsHide: true },
);
const browser = await chromium.launch();
const results = [];
let server;
async function stop() {
  if (!server) return;
  const owned = server;
  server = undefined;
  if (owned.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => owned.kill("SIGKILL"), 3000);
    owned.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    owned.kill("SIGTERM");
  });
}
try {
  for (const route of ["sales", "invoice", "finance"]) {
    await new Promise((resolve, reject) => {
      const check = net.createServer();
      check.once("error", reject);
      check.listen(port, "127.0.0.1", () => check.close(resolve));
    });
    const log = fs.openSync(path.join(directory, "browser-server.log"), "a");
    server = spawn(
      path.join(root, "target/release/easy-erp-server"),
      ["--data-dir", directory, "--bind", `127.0.0.1:${port}`],
      { stdio: ["ignore", log, log], windowsHide: true },
    );
    fs.closeSync(log);
    const startupDeadline = performance.now() + 600_000;
    let ready = false;
    while (performance.now() < startupDeadline) {
      if (server.exitCode !== null) throw new Error("Owned server exited");
      try {
        if (
          (
            await fetch(`${origin}/api/status`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready)
      throw new Error("Owned server did not finish startup within 10 minutes");
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies([
      {
        name: "erp_session",
        value: token,
        url: origin,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const started = performance.now();
    const requests = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/"))
        requests.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
          headers_ms: Math.round(performance.now() - started),
        });
    });
    let outcome = "ready";
    let message = "";
    try {
      await page.goto(`/#/${route}`, { timeout: 10000 });
      if (route === "invoice") {
        await page
          .getByRole("combobox", { name: "客户 必填", exact: true })
          .click({ timeout: 10000 });
        await page
          .locator('[role="option"][data-value="customer-000002"]')
          .waitFor({ timeout: 45000 });
      } else if (route === "sales") {
        await page
          .getByRole("table", { name: "销售单据列表" })
          .locator("tbody tr")
          .first()
          .waitFor({ timeout: 45000 });
      } else {
        await page
          .locator("#finance-debts tbody tr")
          .first()
          .waitFor({ timeout: 45000 });
      }
    } catch (error) {
      outcome = "timeout_or_error";
      message = error.message.split("\n").slice(0, 3).join(" ");
    }
    const elapsed = Math.round(performance.now() - started);
    await page.screenshot({
      path: path.join(directory, `browser-${route}.png`),
    });
    results.push({
      route,
      outcome,
      elapsed_ms: elapsed,
      message,
      errors,
      requests,
    });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
    await stop();
  }
} finally {
  await stop();
  await browser.close();
  fs.writeFileSync(
    path.join(directory, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.execute('DELETE FROM sessions WHERE id=?',(sys.argv[2],));db.commit();db.close()",
      path.join(directory, "inventory.sqlite"),
      digest,
    ],
    { windowsHide: true },
  );
}
