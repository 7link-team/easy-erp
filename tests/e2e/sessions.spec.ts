import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

test("填写表单时交互自动续期，闲置页面不保活", async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized) {
    expect(
      (
        await page.request.post("/api/setup", {
          headers: { "X-ERP-Request": "1" },
          data: {
            username: "manager",
            password: "Factory-test-2026",
            name: "王厂长",
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: false }).fill("manager");
  await page.getByLabel("登录密码", { exact: false }).fill("Factory-test-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("link", { name: /我要入库/ }).click();
  const input = page.getByRole("textbox", { name: "来源 选填", exact: true });
  await input.fill("正在填写的收货单");
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "erp_session",
  )!;
  const key = createHash("sha256").update(cookie.value).digest("hex");
  const db = join(process.env.ERP_E2E_DATA!, "inventory.sqlite");
  const sql = (query: string) =>
    execFileSync("sqlite3", [db, ".timeout 5000", query], {
      encoding: "utf8",
    }).trim();
  const originalExpiry = Date.now() + 120_000;
  sql(`UPDATE sessions SET expires_at=${originalExpiry} WHERE id='${key}'`);
  await page.clock.install();
  await page.clock.fastForward(6 * 60_000);
  expect(Number(sql(`SELECT expires_at FROM sessions WHERE id='${key}'`))).toBe(
    originalExpiry,
  );
  await input.press("End");
  await expect
    .poll(() =>
      Number(sql(`SELECT expires_at FROM sessions WHERE id='${key}'`)),
    )
    .toBeGreaterThan(originalExpiry);
  await expect(input).toHaveValue("正在填写的收货单");
});

test("登录按活动续期，节流写入，过期或退出后不复活", async ({ request }) => {
  const headers = { "X-ERP-Request": "1" };
  const credentials = { username: "manager", password: "Factory-test-2026" };
  if (!(await (await request.get("/api/status")).json()).initialized) {
    expect(
      (
        await request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "王厂长" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const db = join(process.env.ERP_E2E_DATA!, "inventory.sqlite");
  const sql = (query: string) =>
    execFileSync("sqlite3", [db, ".timeout 5000", query], {
      encoding: "utf8",
    }).trim();
  for (const remember of [false, true]) {
    const login = await request.post("/api/login", {
      headers,
      data: { ...credentials, remember },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const key = createHash("sha256").update(token).digest("hex");
    const age = remember ? 30 * 86400 : 8 * 3600;
    expect(login.headers()["set-cookie"]).toContain(`Max-Age=${age}`);
    expect(sql(`SELECT idle_seconds FROM sessions WHERE id='${key}'`)).toBe(
      String(age),
    );
    // Advance this test session close to expiry without waiting hours.
    sql(
      `UPDATE sessions SET expires_at=${Date.now() + 120_000} WHERE id='${key}'`,
    );
    const renewed = await request.get("/api/me");
    expect(renewed.status()).toBe(200);
    expect(renewed.headers()["set-cookie"]).toContain(`Max-Age=${age}`);
    expect(renewed.headers()["set-cookie"]).toContain("HttpOnly");
    const expires = Number(
      sql(`SELECT expires_at FROM sessions WHERE id='${key}'`),
    );
    expect(expires).toBeGreaterThan(Date.now() + age * 1000 - 5000);
    expect(
      (await request.get("/api/me")).headers()["set-cookie"],
    ).toBeUndefined();
    expect(
      Number(sql(`SELECT expires_at FROM sessions WHERE id='${key}'`)),
    ).toBe(expires);
    sql(
      `UPDATE sessions SET expires_at=${Date.now() - 1000} WHERE id='${key}'`,
    );
    expect((await request.get("/api/me")).status()).toBe(401);
    expect(
      Number(sql(`SELECT expires_at FROM sessions WHERE id='${key}'`)),
    ).toBeLessThan(Date.now());
  }
  const login = await request.post("/api/login", {
    headers,
    data: { ...credentials, remember: true },
  });
  const { token } = await login.json();
  await request.post("/api/logout", { headers, data: {} });
  const revoked = await request.get("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(revoked.status()).toBe(401);
  expect(revoked.headers()["set-cookie"]).toBeUndefined();
});
