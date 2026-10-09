import { test, expect } from "@playwright/test";

test("自动备份仅配置保留天数，支持手机并保存验证结果", async ({ page }) => {
  const headers = { "X-ERP-Request": "1" };
  const credentials = { username: "manager", password: "Factory-test-2026" };
  if (!(await (await page.request.get("/api/status")).json()).initialized) {
    expect((await page.request.post("/api/setup", { headers, data: { ...credentials, name: "管理员" } })).ok()).toBeTruthy();
  }
  expect((await page.request.post("/api/login", { headers, data: credentials })).ok()).toBeTruthy();
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "数据与备份", exact: true })).toBeVisible();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "自动备份", exact: true }) });
  await expect(section.locator("input")).toHaveCount(1);
  await expect(section.getByRole("combobox")).toHaveCount(0);
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  const days = section.getByLabel("保留天数");
  await expect(days).toHaveValue("7");
  await expect(section).toContainText("每小时自动备份一次");
  for (const value of ["0", "366", "1.5"]) {
    await days.fill(value);
    await section.getByRole("button", { name: "保存设置" }).click();
    await expect(days).toHaveAttribute("aria-invalid", "true");
  }
  await days.fill("14");
  await section.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("备份保留天数已保存。", { exact: true })).toBeVisible();
  await page.reload();
  await expect(days).toHaveValue("14");
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(days).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "tmp/backup-policy-mobile.png", fullPage: true });
});
