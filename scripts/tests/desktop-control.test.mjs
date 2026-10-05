import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

test(
  "native update control rejects browsers, backs up and drains the server",
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "easy-erp-update-%20-库存-"),
    );
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
      base = await start();
      const status = await (await fetch(base + "/api/status")).json();
      assert.equal(status.initialized, true);
      assert.equal(status.instance_id, identity.instance_id);
      const items = await (
        await fetch(base + "/api/items", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(items.items[0].name, "更新保留物料");
    } finally {
      if (child?.exitCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
