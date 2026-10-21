import { test, expect } from "@playwright/test";

test("基础资料与更多弹窗视觉检查", async ({ page }, testInfo) => {
  const headers = { "X-ERP-Request": "1" };
  const credentials = { username: "manager", password: "Factory-test-2026" };
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await page.request.post("/api/setup", {
      headers,
      data: { ...credentials, name: "管理员" },
    });
  await page.request.post("/api/login", { headers, data: credentials });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/catalog");
    await expect(
      page.getByRole("heading", { name: "单据类型", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`catalog-${width}.png`),
      fullPage: true,
    });
    const tabs = page.getByRole("tablist", { name: "销售配置栏目" });
    const catalogTop = async () =>
      (await page.locator(".catalog-page").boundingBox())!.y;
    const initialTop = (await tabs.boundingBox())!.y - (await catalogTop());
    for (const name of [
      "收款账户",
      "部门",
      "业务员",
      "物料分类",
      "计量单位",
      "常用规格",
      "入库小组",
      "公司信息",
      "开单与打印设置",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        Math.abs(
          (await tabs.boundingBox())!.y - (await catalogTop()) - initialTop,
        ),
      ).toBeLessThanOrEqual(1);
    }
    const controls = page.locator(".catalog-print-fields [role=combobox]");
    const first = (await controls.nth(0).boundingBox())!;
    const second = (await controls.nth(1).boundingBox())!;
    if (width === 1440) {
      expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
      expect(second.x).toBeGreaterThan(first.x + first.width);
    } else {
      expect(second.y).toBeGreaterThan(first.y + first.height);
      expect(second.x).toBe(first.x);
    }
    await page.screenshot({
      path: testInfo.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
    if (width < 760) {
      await page.getByRole("button", { name: "更多", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "更多与账户" });
      const menu = dialog.getByRole("navigation", { name: "更多功能" });
      for (const name of ["销售", "库存", "财务", "设置"])
        await expect(
          menu.getByRole("group", { name, exact: true }),
        ).toBeVisible();
      await expect(
        menu.getByRole("link", { name: "基础资料", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      for (const size of ["sm", "md", "lg"]) {
        await page.evaluate(
          (size) => (document.documentElement.dataset.size = size),
          size,
        );
        for (const link of await menu.getByRole("link").all()) {
          await expect(link).toHaveAccessibleName(/.+/);
          const box = (await link.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.evaluate(() => (document.documentElement.dataset.size = "md"));
      await page.screenshot({ path: testInfo.outputPath(`more-${width}.png`) });
      await dialog.getByRole("button", { name: "关闭", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "退出登录", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("button", { name: "关闭", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "更多", exact: true }),
      ).toBeFocused();
    }
  }
});
