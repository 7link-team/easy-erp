import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const image = process.argv[2];
assert.ok(image, "Pass the server image to verify");
const name = `inventory-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const token = randomUUID();
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
let base;
async function ready(configured) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`${base}/api/status`);
      const value = await response.json();
      if (response.ok && value.database_configured === configured) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Server did not reach expected database state");
}
async function post(path, data, cookie = "") {
  const response = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ERP-Request": "1",
      "X-ERP-Setup-Token": token,
      Cookie: cookie,
    },
    body: JSON.stringify(data),
  });
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${await response.clone().text()}`,
  );
  return response;
}
try {
  docker("volume", "create", volume);
  docker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::4280",
    "-v",
    `${volume}:/data`,
    "-e",
    `ERP_SETUP_TOKEN=${token}`,
    image,
  );
  base = `http://${docker("port", name, "4280/tcp")}`;
  await ready(false);
  const html = await (await fetch(base)).text();
  assert.match(html, /<script[^>]+src="([^"]+)"/);
  const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
  assert.equal((await fetch(new URL(script, base))).status, 200);
  const denied = await fetch(`${base}/api/database/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ERP-Request": "1" },
    body: '{"kind":"sqlite"}',
  });
  assert.equal(denied.status, 403);
  await post("/database/setup", { kind: "sqlite" });
  await ready(true);
  await post("/setup", {
    username: "smoke-admin",
    password: "Container-smoke-2026",
    name: "Container check",
  });
  const login = await post("/login", {
    username: "smoke-admin",
    password: "Container-smoke-2026",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  await post(
    "/items",
    { name: "Persistent item", kind: "成品", unit: "件" },
    cookie,
  );
  docker("restart", name);
  const status = await ready(true);
  assert.equal(status.initialized, true);
  const again = await post("/login", {
    username: "smoke-admin",
    password: "Container-smoke-2026",
  });
  const response = await fetch(`${base}/api/items?q=Persistent`, {
    headers: { Cookie: again.headers.get("set-cookie").split(";")[0] },
  });
  assert.match(await response.text(), /Persistent item/);
  console.log(
    "PASS: embedded web, protected setup, administrator login and persistent data after container restart",
  );
} catch (error) {
  try {
    console.error(docker("logs", name));
  } catch {}
  throw error;
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
  try {
    docker("volume", "rm", volume);
  } catch {}
}
