import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((done, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", done);
  });
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("无法分配测试端口");
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

test("服务重启保留身份，同一数据目录拒绝第二个服务", async ({ request }) => {
  const dir = mkdtempSync(join(tmpdir(), "easy-erp-lifecycle-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const binary = resolve("target/debug/easy-erp-server");
  const launch = (bindPort = port) =>
    spawn(binary, ["--data-dir", dir, "--bind", `127.0.0.1:${bindPort}`], {
      cwd: dir,
      stdio: "pipe",
    });
  const waitReady = async () => {
    await expect
      .poll(async () => {
        try {
          return (
            await request.get(`${base}/api/status`, { timeout: 1_000 })
          ).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    return (await request.get(`${base}/api/status`)).json();
  };
  let server = launch();
  try {
    const first = await waitReady();
    const duplicate = launch(await freePort());
    try {
      let error = "";
      duplicate.stderr?.on("data", (chunk) => {
        error += String(chunk);
      });
      await expect.poll(() => duplicate.exitCode).toBe(1);
      expect(error).toContain("该数据目录已有服务运行");
      expect((await waitReady()).instance_id).toBe(first.instance_id);
    } finally {
      await stop(duplicate);
    }
    await stop(server);
    expect(server.exitCode).toBe(0);
    server = launch();
    expect((await waitReady()).instance_id).toBe(first.instance_id);
    expect(await (await request.get(`${base}/`)).text()).toContain('id="root"');
  } finally {
    await stop(server);
  }
});
