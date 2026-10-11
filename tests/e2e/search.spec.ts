import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
const credentials = { username: "manager", password: "Factory-test-2026" };
const headers = { "X-ERP-Request": "1" };
async function post(request: APIRequestContext, path: string, data: object) {
  const r = await request.post(`/api${path}`, { headers, data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function fixture(request: APIRequestContext) {
  const tag = `全局-${randomUUID().slice(0, 8)}`;
  const items = [];
  for (const spec of ["第一规格", "第二规格"])
    items.push(
      await post(request, "/items", {
        name: tag,
        spec,
        kind: "成品",
        unit: "个",
      }),
    );
  const customer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: tag,
    data: { contact: `联系人-${tag}`, phone: "123456789", address: "测试地址" },
  });
  const sale = await post(request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input: {
      type_id: "sale",
      customer_id: customer.id,
      business_date: "2026-10-10",
      lines: [{ item_id: items[0].id, quantity: "1", price: "10" }],
    },
  });
  return { tag, items, customer, sale };
}
async function search(page: Page, query: string) {
  await page
    .getByRole("button", { name: "全局搜索物料、单号或客户", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await dialog.getByRole("searchbox").fill(query);
  return dialog;
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("全局搜索按ID定位物料和客户，同页跳转、刷新与清除筛选，导出不混入同名物料", async ({
  page,
}) => {
  const { tag, items, customer } = await fixture(page.request);
  await page.goto("/#/inventory");
  let dialog = await search(page, tag);
  const group = dialog.getByRole("region", { name: "物料搜索结果" });
  await expect(group.getByRole("link")).toHaveCount(2);
  await group.getByRole("link").filter({ hasText: "第二规格" }).click();
  await expect(page).toHaveURL(new RegExp(`inventory_item=${items[1].id}`));
  const rows = page.locator(".inventory-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("第二规格");
  const exportLink = page.getByRole("link", { name: "导出 CSV", exact: true });
  const csv = await (
    await page.request.get((await exportLink.getAttribute("href"))!)
  ).text();
  expect(csv).toContain("第二规格");
  expect(csv).not.toContain("第一规格");
  await page.reload();
  await expect(rows).toHaveCount(1);
  dialog = await search(page, tag);
  await dialog
    .getByRole("region", { name: "物料搜索结果" })
    .getByRole("link")
    .filter({ hasText: "第一规格" })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("第一规格");
  await page.goBack();
  await expect(rows).toContainText("第二规格");
  await page.getByRole("button", { name: "查看全部物料", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "搜索物料", exact: true })
    .fill(tag);
  await expect(rows).toHaveCount(2);
  dialog = await search(page, tag);
  await dialog
    .getByRole("region", { name: "客户搜索结果" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(new RegExp(`customer_focus=${customer.id}`));
  const customers = page
    .getByRole("table", { name: "客户列表" })
    .locator("tbody tr");
  await expect(customers).toHaveCount(1);
  await expect(customers).toContainText(customer.name);
  await page.reload();
  await expect(customers).toHaveCount(1);
  await page
    .getByRole("searchbox", { name: "搜索客户", exact: true })
    .fill(`联系人-${tag}`);
  await expect(customers).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has("customer_focus")).toBe(false);
});

test("全局搜索打开单据，取消离开保留已填表单和URL，确认后同页跳转并支持新标签", async ({
  page,
  context,
}) => {
  const { tag, sale } = await fixture(page.request);
  await page.goto("/#/sales");
  await page.getByRole("button", { name: "新建单据", exact: true }).click();
  await page.getByLabel("备注 选填", { exact: true }).fill("不能丢的内容");
  const before = page.url();
  let dialog = await search(page, sale.number);
  const link = dialog
    .getByRole("region", { name: "单据搜索结果" })
    .getByRole("link");
  await expect(link).toContainText(sale.number);
  const address = (await link.getAttribute("href"))!;
  await link.click();
  await page
    .getByRole("dialog", { name: "离开当前页面？" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(page.url()).toBe(before);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByLabel("备注 选填", { exact: true })).toHaveValue(
    "不能丢的内容",
  );
  dialog = await search(page, sale.number);
  await dialog
    .getByRole("region", { name: "单据搜索结果" })
    .getByRole("link")
    .click();
  await page
    .getByRole("dialog", { name: "离开当前页面？" })
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await expect(page.locator(".sale-detail")).toContainText(sale.number);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".sale-detail")).toContainText(sale.number);
  const p = await context.newPage();
  await p.goto(address);
  await expect(p.locator(".sale-detail")).toContainText(tag);
  await p.close();
});

test("客户搜索覆盖名称联系人电话和全部结果，预览上限不截断真实总数", async ({
  page,
}) => {
  const tag = `搜索批次-${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 52; i++)
    await post(page.request, "/sales/catalog", {
      kind: "customer",
      name: `${tag}-${String(i).padStart(2, "0")}`,
      data: {
        contact: `AbC-${tag}`,
        phone: `65800000${String(i).padStart(2, "0")}`,
      },
    });
  const result = await (
    await page.request.get(
      `/api/sales/catalog?kind=customer&q=${encodeURIComponent(`abc-${tag}`)}`,
    )
  ).json();
  expect(result.total).toBe(52);
  expect(result.items).toHaveLength(50);
  const phoneResult = await (
    await page.request.get("/api/sales/catalog?kind=customer&q=6580000051")
  ).json();
  expect(phoneResult.total).toBe(1);
  expect(phoneResult.items[0].name).toBe(`${tag}-51`);
  expect(
    result.items.every((v: { kind: string }) => v.kind === "customer"),
  ).toBe(true);
  expect(
    (
      await page.request.get(`/api/sales/catalog?q=${"x".repeat(101)}`)
    ).status(),
  ).toBe(400);
  await page.goto("/#/customers");
  let dialog = await search(page, tag);
  const group = dialog.getByRole("region", { name: "客户搜索结果" });
  await expect(group.getByRole("heading")).toContainText("52");
  await expect(group.locator("li")).toHaveCount(6);
  await group
    .getByRole("link", { name: "查看全部匹配客户 →", exact: true })
    .click();
  const rows = page
    .getByRole("table", { name: "客户列表" })
    .locator("tbody tr");
  await expect(rows).toHaveCount(52);
  await page
    .getByRole("searchbox", { name: "搜索客户", exact: true })
    .fill("AbC-" + tag);
  await expect(rows).toHaveCount(52);
  dialog = await search(page, `${tag}-51`);
  await dialog
    .getByRole("region", { name: "客户搜索结果" })
    .getByRole("link")
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(`${tag}-51`);
});

test("全局搜索权限不扩大本人单据范围，不查询无权模块", async ({
  page,
  browser,
}) => {
  const { tag, items, customer, sale } = await fixture(page.request);
  await post(page.request, "/sales/catalog", {
    kind: "account",
    name: `${tag}-private`,
  });
  for (const permissions of [
    [
      "sales.read",
      "sales.create",
      "items.read",
      "customers.read",
      "catalog.read",
    ],
    ["customers.read"],
    ["stocktake.read"],
  ]) {
    const role = await post(page.request, "/roles", {
      name: randomUUID(),
      permissions,
    });
    const username = `search_${randomUUID().slice(0, 8)}`;
    await post(page.request, "/users", {
      username,
      name: username,
      password: "Search-test-2026",
      role: role.id,
    });
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4289",
    });
    try {
      await post(context.request, "/login", {
        username,
        password: "Search-test-2026",
      });
      const hidden = await (
        await context.request.get(
          `/api/sales/catalog?kind=account&q=${encodeURIComponent(tag)}`,
        )
      ).json();
      expect(hidden).toEqual({ items: [], total: 0 });
      let own;
      if (permissions.includes("sales.create"))
        own = await post(context.request, "/sales/commands", {
          request_id: randomUUID(),
          action: "save",
          input: {
            type_id: "sale",
            customer_id: customer.id,
            business_date: "2026-10-10",
            lines: [{ item_id: items[0].id, quantity: "1", price: "1" }],
          },
        });
      const p = await context.newPage();
      await p.goto("/#/home");
      await expect(p.getByRole("heading", { name: /的工作台/ })).toBeVisible();
      const requests: string[] = [];
      p.on("request", (r) => {
        if (r.url().includes("/api/")) requests.push(r.url());
      });
      if (!own && !permissions.includes("customers.read")) {
        await expect(
          p.getByRole("button", { name: "全局搜索物料、单号或客户" }),
        ).toHaveCount(0);
        continue;
      }
      const d = await search(p, tag);
      if (own) {
        const group = d.getByRole("region", { name: "单据搜索结果" });
        await expect(group.getByRole("link")).toHaveCount(1);
        await expect(group).toContainText(own.number);
        await expect(group).not.toContainText(sale.number);
        await expect(
          d.getByRole("region", { name: "客户搜索结果" }).getByRole("link"),
        ).toHaveCount(1);
      } else {
        await expect(
          d.getByRole("region", { name: "单据搜索结果" }),
        ).toHaveCount(0);
        await expect(
          d.getByRole("region", { name: "客户搜索结果" }).getByRole("link"),
        ).toHaveCount(1);
      }
      if (!permissions.includes("items.read")) {
        expect(requests.some((v) => v.includes("/api/items?"))).toBe(false);
        expect(requests.some((v) => v.includes("/api/sales?q="))).toBe(false);
      }
    } finally {
      await context.close();
    }
  }
});

test("全局搜索取消慢响应、清空及错误恢复，键盘和手机显示可用", async ({
  page,
}, testInfo) => {
  const { tag } = await fixture(page.request);
  await page.goto("/#/home");
  await expect(
    page.getByRole("button", { name: "全局搜索物料、单号或客户", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  const input = dialog.getByRole("searchbox");
  await expect(input).toBeFocused();
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  await page.route("**/api/items?q=slow-search&sort=name", async (route) => {
    started();
    await pending;
    await route.fulfill({ json: { items: [], total: 0 } }).catch(() => {});
  });
  await input.fill("slow-search");
  await entered;
  await input.fill(tag);
  const items = dialog.getByRole("region", { name: "物料搜索结果" });
  await expect(items.getByRole("link")).toHaveCount(2);
  release();
  await expect(items.getByRole("link")).toHaveCount(2);
  await input.fill("");
  await expect(dialog.getByRole("region")).toHaveCount(0);
  await page.route("**/api/items?*", (route) =>
    route.fulfill({ status: 503, json: { error: "测试物料查询失败" } }),
  );
  await input.fill(tag);
  await expect(items.getByRole("alert")).toContainText("测试物料查询失败");
  await expect(
    dialog.getByRole("region", { name: "客户搜索结果" }).getByRole("link"),
  ).toHaveCount(1);
  await page.unroute("**/api/items?*");
  await dialog.getByRole("button", { name: "重新搜索物料" }).click();
  await expect(items.getByRole("link")).toHaveCount(2);
  await input.focus();
  await page.keyboard.press("ArrowDown");
  await expect(items.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(input).toBeFocused();
  for (const width of [1440, 1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(dialog).toBeInViewport();
    await dialog.screenshot({
      path: testInfo.outputPath(`search-${width}.png`),
    });
  }
  await input.fill("找不到-" + randomUUID());
  await expect(dialog.getByText("没有匹配的物料。")).toBeVisible();
  await expect(dialog.getByText("没有匹配的单据。")).toBeVisible();
  await expect(dialog.getByText("没有匹配的客户。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "全局搜索物料、单号或客户" }),
  ).toBeVisible();
});
