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
  // A marker row makes the restore provable. Without it the 401 only shows that
  // some database was swapped in, so restoring the wrong archive — the safety
  // snapshot taken moments earlier, say — would look identical.
  expect(
    (
      await request.post("/api/items", {
        headers,
        data: { name: "ZIP标记物料", kind: "成品", unit: "个" },
      })
    ).ok(),
  ).toBeTruthy();
  const created = await request.post("/api/backups", { headers, data: {} });
  expect(created.ok()).toBeTruthy();
  const { name, path } = await created.json();
  expect(name).toMatch(/\.zip$/);
  const legacy = name.replace(/\.zip$/, ".erpbackup");
  const directory = join(process.env.ERP_E2E_DATA!, "backups");
  // Restore creates a safety backup and runs retention, so keep the fixture
  // outside the managed directory when testing each extension independently.
  const fixture = join(process.env.ERP_E2E_DATA!, "extension-fixture.zip");
  copyFileSync(path, fixture);
  copyFileSync(path, join(directory, legacy));
  const list = await (await request.get("/api/backups")).json();
  expect(list.items.map((item: { name: string }) => item.name)).toEqual(
    expect.arrayContaining([name, legacy]),
  );
  for (const file of [name, legacy]) {
    copyFileSync(fixture, file === name ? path : join(directory, file));
    // Added after the archive, so a correct restore must remove it again.
    expect(
      (
        await request.post("/api/items", {
          headers,
          data: { name: `备份后新增-${file}`, kind: "成品", unit: "个" },
        })
      ).ok(),
    ).toBeTruthy();
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
    // Prove the requested archive is the one that came back.
    expect(
      (await (await request.get("/api/items?q=ZIP标记物料")).json()).total,
    ).toBe(1);
    expect(
      (
        await (
          await request.get(`/api/items?q=${encodeURIComponent(`备份后新增-${file}`)}`)
        ).json()
      ).total,
    ).toBe(0);
  }
});
