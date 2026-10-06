import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

test(
  "native update control rejects browsers, backs up and drains the server",
  { timeout: 60000 },
  async () => {
    let directory = await mkdtemp(join(tmpdir(), "easy-erp-update-%20-库存-"));
    const originalDirectory = directory;
    const migratedDirectory = `${directory}-EasyErp`;
    const token = randomBytes(32).toString("hex");
    let child;
    let exited;
    async function start() {
      child = spawn(
        resolve(
          `target/debug/easy-erp-server${process.platform === "win32" ? ".exe" : ""}`,
        ),
        ["--data-dir", directory, "--bind", "127.0.0.1:0"],
        {
          env: {
            ...process.env,
            ERP_DESKTOP_CONTROL_TOKEN: token,
            NO_COLOR: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      exited = once(child, "exit");
      let logs = "";
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Server startup timed out: ${logs}`)),
          20000,
        );
        const data = (chunk) => {
          logs += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
          const match = logs.match(/address=127\.0\.0\.1:(\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(`http://127.0.0.1:${match[1]}`);
          }
        };
        child.stdout.on("data", data);
        child.stderr.on("data", data);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited ${code}: ${logs}`));
        });
      });
    }
    try {
      let base = await start();
      const post = (path, body, headers = {}) =>
        fetch(base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ERP-Request": "1",
            ...headers,
          },
          body: JSON.stringify(body),
        });
      const identity = await (await fetch(base + "/api/status")).json();
      const backupOnly = () =>
        promisify(execFile)(
          resolve(
            `target/debug/easy-erp-server${process.platform === "win32" ? ".exe" : ""}`,
          ),
          ["--backup-only", "--data-dir", directory],
        );
      await assert.rejects(backupOnly, /已有服务运行/);
      const migrate = () =>
        promisify(execFile)(
          resolve(
            `target/debug/easy-erp-server${process.platform === "win32" ? ".exe" : ""}`,
          ),
          ["--data-dir", directory, "--migrate-data-to", migratedDirectory],
        );
      await assert.rejects(migrate, /已有服务运行/);
      const setup = await post("/api/setup", {
        username: "manager",
        password: "Update-test-2026",
        name: "更新验收",
      });
      assert.equal(setup.status, 200);
      const login = await post("/api/login", {
        username: "manager",
        password: "Update-test-2026",
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const item = await post(
        "/api/items",
        { name: "更新保留物料", kind: "原材料", unit: "个", precision: 0 },
        { Cookie: cookie },
      );
      assert.equal(item.status, 200);
      for (const headers of [
        {},
        { Cookie: cookie },
        { Authorization: `Bearer ${"0".repeat(64)}` },
      ]) {
        const denied = await post("/api/desktop/prepare-update", {}, headers);
        assert.equal(denied.status, 403);
      }
      // A failed backup must leave the running service available and unchanged.
      await writeFile(
        join(directory, "backups"),
        "block backup directory creation",
      );
      const failed = await post(
        "/api/desktop/prepare-update",
        {},
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(failed.status, 500);
      assert.equal((await fetch(base + "/api/status")).status, 200);
      await rm(join(directory, "backups"));
      const result = await post(
        "/api/desktop/prepare-update",
        {},
        { Authorization: `Bearer ${token}` },
      );
      assert.equal(result.status, 200);
      const backup = await result.json();
      assert.equal(backup.instance_id, identity.instance_id);
      assert.ok(
        (await readdir(join(directory, "backups"))).some((name) =>
          name.endsWith(".zip"),
        ),
      );
      const [code] = await exited;
      assert.equal(code, 0);
      const beforeOffline = await readdir(join(directory, "backups"));
      const offline = await backupOnly();
      const archived = JSON.parse(offline.stdout.trim());
      assert.ok(archived.name.endsWith(".zip"));
      assert.equal(
        (await readdir(join(directory, "backups"))).length,
        beforeOffline.length + 1,
      );
      await mkdir(migratedDirectory);
      await writeFile(
        join(migratedDirectory, "sentinel"),
        "preserve this directory",
      );
      await assert.rejects(migrate, /目标数据目录已存在/);
      assert.equal(
        await readFile(join(migratedDirectory, "sentinel"), "utf8"),
        "preserve this directory",
      );
      await rm(migratedDirectory, { recursive: true });
      await migrate();
      await assert.rejects(readdir(originalDirectory), { code: "ENOENT" });
      directory = migratedDirectory;
      assert.ok(
        (await readdir(join(directory, "backups"))).includes(archived.name),
      );
      base = await start();
      const status = await (await fetch(base + "/api/status")).json();
      assert.equal(status.initialized, true);
      assert.equal(status.instance_id, identity.instance_id);
      const items = await (
        await fetch(base + "/api/items", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(items.items[0].name, "更新保留物料");
      const getBackups = async () =>
        (
          await fetch(base + "/api/backups", { headers: { Cookie: cookie } })
        ).json();
      assert.deepEqual((await getBackups()).schedule, { keep_days: 7 });
      const saveRetention = (keep_days) =>
        fetch(base + "/api/backups/schedule", {
          method: "PUT",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            "X-ERP-Request": "1",
          },
          body: JSON.stringify({ keep_days }),
        });
      for (const invalid of [0, 366, 1.5])
        assert.equal((await saveRetention(invalid)).ok, false);
      const oldFile = join(directory, "backups", "backup-expired.zip");
      const recentFile = join(directory, "backups", "backup-recent.zip");
      const archive = join(directory, "backups", archived.name);
      await copyFile(archive, oldFile);
      await copyFile(archive, recentFile);
      const daysAgo = (days) => new Date(Date.now() - days * 86400000);
      await utimes(oldFile, daysAgo(8), daysAgo(8));
      await utimes(recentFile, daysAgo(2), daysAgo(2));
      assert.equal(
        (await post("/api/backups", {}, { Cookie: cookie })).status,
        200,
      );
      await assert.rejects(readFile(oldFile), { code: "ENOENT" });
      assert.ok((await readFile(recentFile)).length);
      assert.equal((await saveRetention(1)).status, 200);
      assert.deepEqual((await getBackups()).schedule, { keep_days: 1 });
      assert.equal(
        (await post("/api/backups", {}, { Cookie: cookie })).status,
        200,
      );
      await assert.rejects(readFile(recentFile), { code: "ENOENT" });
      assert.ok((await getBackups()).items.length >= 1);
    } finally {
      if (child?.exitCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      await rm(originalDirectory, { recursive: true, force: true });
      await rm(migratedDirectory, { recursive: true, force: true });
    }
  },
);
