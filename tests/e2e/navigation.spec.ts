import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api${path}`, {
    headers: { "X-ERP-Request": "1" },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("14项业务菜单名称顺序、退货合并单据、开单直达及关于入口", async ({
  page,
}) => {
  await page.goto("/#/home");
  const nav = page.getByRole("navigation", { name: "主要导航" });
  await expect(nav.locator(".nav-item:visible")).toHaveText([
    "工作台",
    "开单",
    "单据",
    "客户",
    "物料",
    "出入库",
    "清点",
    "记录",
    "收款",
    "账户",
    "业绩",
    "基础资料",
    "人员",
    "备份",
  ]);
  await expect(
    nav.getByRole("button", { name: "退货", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "版本", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "规范", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "开单", exact: true }).click();
  await expect(page).toHaveURL(/#\/invoice$/);
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toBeVisible();
  await page.getByLabel("备注 选填", { exact: true }).fill("导航取消后仍保留");
  const before = page.url();
  await nav.getByRole("button", { name: "单据", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(page.url()).toBe(before);
  await expect(page.getByLabel("备注 选填", { exact: true })).toHaveValue(
    "导航取消后仍保留",
  );
  await nav.getByRole("button", { name: "单据", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/sales$/);
  await expect(
    page.getByRole("heading", { name: "单据", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建单据", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "版本", exact: true }),
  ).toBeVisible();
  await page.goto("/#/invoice");
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toBeVisible();
});

test("财务三个菜单定位同页分区、保留筛选、刷新与返回定位", async ({ page }) => {
  await page.goto("/#/accounts");
  const nav = page.getByRole("navigation", { name: "主要导航" });
  const accounts = page.getByRole("region", { name: "账户流水", exact: true });
  await expect(accounts).toBeFocused();
  await expect(
    nav.getByRole("button", { name: "账户", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const from = accounts.getByLabel("开始日期", { exact: false });
  await from.fill("2026-10-01");
  await page
    .locator(".finance-panel")
    .evaluate((el) => el.setAttribute("data-preserved", "yes"));
  await nav.getByRole("button", { name: "业绩", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "部门业绩", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".finance-panel")).toHaveAttribute(
    "data-preserved",
    "yes",
  );
  await expect(from).toHaveValue("2026-10-01");
  await nav.getByRole("button", { name: "收款", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "客户欠款", exact: true }),
  ).toBeFocused();
  await nav.getByRole("button", { name: "账户", exact: true }).click();
  await expect(accounts).toBeFocused();
  await expect(from).toHaveValue("2026-10-01");
  await page.reload();
  await expect(accounts).toBeFocused();
  await nav.getByRole("button", { name: "业绩", exact: true }).click();
  await page.goBack();
  await expect(accounts).toBeFocused();
  await expect(
    page.getByRole("tablist", { name: "财务栏目", exact: true }),
  ).toHaveCount(0);
});

test("出入库独立入口复用收发表单，手机更多和关于可达", async ({ page }) => {
  await page.goto("/#/movement");
  await expect(
    page.getByRole("heading", { name: "出入库", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "入库", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/in$/);
  await page.getByLabel("来源 选填", { exact: true }).fill("从出入库进入");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByLabel("来源 选填", { exact: true })).toHaveValue(
    "从出入库进入",
  );
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/movement$/);
  await page.setViewportSize({ width: 320, height: 568 });
  for (const name of ["单据", "出入库", "账户", "业绩"]) {
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page
      .getByRole("navigation", { name: "更多功能" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "主要导航" }),
    ).toBeInViewport();
  }
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "更多功能" })
      .getByRole("button", { name: "退货", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关于", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "版本", exact: true }),
  ).toBeVisible();
});

test("单据尾列查看、编辑草稿、修订及只读权限，手机操作无需横滑", async ({
  page,
  browser,
}) => {
  const tag = `操作列-${randomUUID().slice(0, 8)}`;
  const item = await post(page.request, "/items", {
    name: tag,
    kind: "成品",
    unit: "个",
  });
  await post(page.request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "10" }],
  });
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const input = {
    type_id: "sale",
    customer_id: customer.id,
    business_date: "2026-10-10",
    lines: [{ item_id: item.id, quantity: "1", price: "10" }],
  };
  const draft = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input,
  });
  const sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input,
  });
  await page.goto(`/?sales_q=${encodeURIComponent(tag)}#/sales`);
  const table = page.getByRole("table", { name: "销售单据列表", exact: true });
  await expect(
    table.getByRole("columnheader", { name: "单据类型", exact: true }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader").last()).toHaveText("操作");
  const row = table.getByRole("row").filter({ hasText: sale.number });
  await expect(row.locator(".sale-list-type")).toHaveText(sale.type_name);
  await row.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.locator(".sale-detail")).toContainText(sale.number);
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await row.getByRole("button", { name: "修订", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "修订单据", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回单据", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await table
    .getByRole("row")
    .filter({ hasText: draft.number })
    .getByRole("button", { name: "编辑草稿", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "编辑草稿", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回单据", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(row.locator(".sale-list-type")).toBeVisible();
  const action = row.getByRole("button", { name: "查看", exact: true });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await action.click();
  await expect(page.locator(".sale-detail")).toContainText(sale.number);
  const role = await post(page.request, "/roles", {
    name: tag,
    permissions: ["sales.read", "sales.all"],
  });
  const username = `read_${randomUUID().slice(0, 8)}`;
  await post(page.request, "/users", {
    username,
    name: tag,
    password: "Readonly-2026",
    role: role.id,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username,
      password: "Readonly-2026",
    });
    const p = await context.newPage();
    await p.goto(
      `http://127.0.0.1:4289/?sales_q=${encodeURIComponent(tag)}#/sales`,
    );
    await expect(
      p
        .locator(".document-row-actions")
        .getByRole("button", { name: "查看", exact: true }),
    ).toHaveCount(2);
    await expect(
      p.getByRole("button", { name: "编辑草稿", exact: true }),
    ).toHaveCount(0);
    await expect(
      p.getByRole("button", { name: "修订", exact: true }),
    ).toHaveCount(0);
    await expect(
      p
        .getByRole("navigation")
        .getByRole("button", { name: "开单", exact: true }),
    ).toHaveCount(0);
    await p.goto("http://127.0.0.1:4289/#/invoice");
    await expect(p.getByRole("alert")).toContainText("没有此页面的查看权限");
  } finally {
    await context.close();
  }
});

test("退货筛选后搜索单据和工作台链接进入单据列表，返回恢复原筛选", async ({
  page,
}) => {
  const tag = `记录跳转-${randomUUID().slice(0, 8)}`;
  const item = await post(page.request, "/items", {
    name: tag,
    kind: "成品",
    unit: "件",
  });
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const sales = [];
  for (let i = 0; i < 7; i++)
    sales.push(
      await post(page.request, "/sales/commands", {
        request_id: randomUUID(),
        action: "save",
        input: {
          customer_id: customer.id,
          type_id: "sale",
          business_date: "2026-10-10",
          lines: [{ item_id: item.id, quantity: "1", price: "10" }],
        },
      }),
    );
  await page.goto("/?sales_records=return#/sales");
  const records = page.getByRole("group", { name: "单据记录筛选" });
  const search = async (value: string) => {
    await page
      .getByRole("button", { name: "全局搜索物料、单号或客户", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await dialog.getByRole("searchbox").fill(value);
    return dialog.getByRole("region", { name: "单据搜索结果", exact: true });
  };
  const results = await search(tag);
  const all = results.getByRole("link", {
    name: "查看全部匹配单据 →",
    exact: true,
  });
  await expect(all).toBeVisible();
  expect(await all.getAttribute("href")).not.toContain("sales_records=");
  await all.click();
  await expect(
    records.getByRole("button", { name: "单据", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("table", { name: "销售单据列表" }).locator("tbody tr"),
  ).toHaveCount(7);
  await page.goBack();
  await expect(
    records.getByRole("button", { name: "退货记录", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const single = await search(sales[0].number);
  await single.getByRole("link").click();
  await expect(page.locator(".sale-detail")).toContainText(sales[0].number);
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(
    records.getByRole("button", { name: "单据", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/?sales_records=void#/home");
  await page
    .getByRole("link", { name: "查看今日全部单据 →", exact: true })
    .click();
  await expect(
    records.getByRole("button", { name: "单据", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/?returns_action=void#/returns");
  await expect(page.locator(".workspace-title")).toHaveText("单据");
  await expect(
    records.getByRole("button", { name: "作废记录", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
