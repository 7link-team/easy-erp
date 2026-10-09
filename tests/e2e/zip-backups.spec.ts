import { test, expect } from "@playwright/test";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

test("ZIP 备份可下载恢复，旧后缀备份继续可用", async ({ request }) => {
  const headers = { "X-ERP-Request": "1" };
  const credentials = { username: "manager", password: "Factory-test-2026" };
  if (!(await (await request.get("/api/status")).json()).initialized) {
    expect(
      (
        await request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "管理员" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (await request.post("/api/login", { headers, data: credentials })).ok(),
  ).toBeTruthy();
  const created = await request.post("/api/backups", { headers, data: {} });
  expect(created.ok()).toBeTruthy();
  const { name } = await created.json();
  expect(name).toMatch(/\.zip$/);
  const legacy = name.replace(/\.zip$/, ".erpbackup");
  const directory = join(process.env.ERP_E2E_DATA!, "backups");
  // Restore creates a safety backup and runs retention, so keep the fixture
  // outside the managed directory when testing each extension independently.
  const fixture = join(process.env.ERP_E2E_DATA!, "extension-fixture.zip");
  copyFileSync(join(directory, name), fixture);
  copyFileSync(join(directory, name), join(directory, legacy));
  const list = await (await request.get("/api/backups")).json();
  expect(list.items.map((item: { name: string }) => item.name)).toEqual(
    expect.arrayContaining([name, legacy]),
  );
  for (const file of [name, legacy]) {
    copyFileSync(fixture, join(directory, file));
    const downloaded = await request.get(`/api/backups/${file}`);
    expect(downloaded.status()).toBe(200);
    expect(downloaded.headers()["content-type"]).toBe("application/zip");
    expect((await downloaded.body()).subarray(0, 2).toString()).toBe("PK");
    expect(
      (
        await request.post("/api/backups/restore", {
          headers,
          data: { name: file, confirmation: "恢复全部数据" },
        })
      ).ok(),
    ).toBeTruthy();
    expect((await request.get("/api/me")).status()).toBe(401);
    expect(
      (await request.post("/api/login", { headers, data: credentials })).ok(),
    ).toBeTruthy();
  }
});
