import { test, expect, type Page } from "@playwright/test";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };

async function login(page: Page) {
  if (!(await (await page.request.get("/api/status")).json()).initialized) {
    expect(
      (
        await page.request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "管理员" },
        })
      ).ok(),
    ).toBe(true);
  }
  expect(
    (
      await page.request.post("/api/login", { headers, data: credentials })
    ).ok(),
  ).toBe(true);
}

function backup(index: number) {
  return {
    name: `snapshot-${String(index).padStart(2, "0")}.zip`,
    created_at: Date.UTC(2026, 9, 14) - index * 3600000,
    snapshot_at: Date.UTC(2026, 9, 14) - index * 3600000,
    size: 4096,
    source: "manual",
    photo_count: index,
    path: `/fixture/backups/snapshot-${String(index).padStart(2, "0")}.zip`,
    metadata_error: false,
  };
}

test("备份翻页、末页恢复选择、生成后回首页和列表收缩均正确", async ({
  page,
}) => {
  await login(page);
  let items = Array.from({ length: 23 }, (_, index) => backup(index));
  let nextBackup = 99;
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() === "POST") {
      items = [backup(nextBackup++), ...items];
      return route.fulfill({ json: items[0] });
    }
    return route.fulfill({
      json: {
        items,
        schedule: { keep_days: 7 },
        last_success: "",
        last_error: "",
      },
    });
  });
  await page.goto("/#/settings");
  const rows = page
    .getByRole("table", { name: "备份记录" })
    .locator("tbody tr");
  const pager = page.getByRole("navigation", { name: "备份记录分页" });
  await expect(rows).toHaveCount(10);
  await expect(pager).toContainText("第 1 / 3 页");
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("snapshot-10.zip");
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(rows).toHaveCount(3);
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(
    rows.last().getByRole("link", { name: "下载完整备份 snapshot-22.zip" }),
  ).toHaveAttribute("href", "/api/backups/snapshot-22.zip");
  await rows
    .last()
    .getByRole("button", { name: "恢复备份 snapshot-22.zip" })
    .click();
  const dialog = page.getByRole("dialog");
  const selectedTime = await page.evaluate(
    (timestamp) =>
      new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(timestamp),
    backup(22).snapshot_at,
  );
  await expect(dialog).toContainText(`将恢复到 ${selectedTime} 的备份。`);
  await expect(dialog).toContainText("系统会先备份当前数据");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(pager).toContainText("第 3 / 3 页");

  // A retention refresh can remove the page that is currently displayed.
  items = items.slice(0, 10);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(pager).toContainText("第 1 / 1 页");
  await expect(rows).toHaveCount(10);
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await page.getByRole("button", { name: "立即备份全部数据" }).click();
  await expect(pager).toContainText("第 1 / 2 页");
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "立即备份全部数据" }).click();
  await expect(pager).toContainText("第 1 / 2 页");
  await expect(rows.first()).toContainText("snapshot-100.zip");
  await expect(rows).toHaveCount(10);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(pager).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
  }
});

test("空备份显示维护指引，网页版不显示桌面操作按钮", async ({ page }) => {
  await login(page);
  await page.route("**/api/backups", (route) =>
    route.fulfill({
      json: {
        items: [],
        schedule: { keep_days: 7 },
        last_success: "",
        last_error: "",
      },
    }),
  );
  await page.goto("/#/settings");
  await expect(
    page.getByText("暂无完整备份，可点击“立即备份全部数据”生成。"),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "备份记录分页" }),
  ).toHaveCount(0);
  const maintenance = page.locator("section").filter({
    has: page.getByRole("heading", { name: "本机数据维护", exact: true }),
  });
  await expect(maintenance).toContainText("清空数据（不含备份数据）");
  await expect(maintenance).toContainText("不会清空当前连接的远程库存电脑");
  await expect(maintenance.getByRole("button")).toHaveCount(0);
});

test("桌面备份页只打开维护入口，失败显示原因并允许重试", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => {
    const state = window as any;
    state.maintenanceCalls = [];
    state.failMaintenance = true;
    state.__TAURI__ = {
      core: {
        invoke: async (command: string) => {
          if (command === "update_info")
            return { version: "0.2.1", enabled: false, mobile: false };
          state.maintenanceCalls.push(command);
          if (command === "open_data_maintenance" && state.failMaintenance)
            throw new Error("找不到本机数据维护窗口，请重启桌面版。");
        },
      },
    };
  });
  await page.goto("/#/settings");
  const button = page.getByRole("button", {
    name: "打开本机数据维护",
    exact: true,
  });
  await button.click();
  await expect(page.getByRole("alert")).toContainText(
    "找不到本机数据维护窗口，请重启桌面版。",
  );
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    (window as any).failMaintenance = false;
  });
  await button.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).maintenanceCalls))
    .toEqual(["open_data_maintenance", "open_data_maintenance"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
