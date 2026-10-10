import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(
  request: APIRequestContext,
  path: string,
  data: object,
  method = "POST",
) {
  const r = await request.fetch(`/api${path}`, { method, headers, data });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return r.json();
}
const overview = async (request: APIRequestContext, suffix = "") =>
  (await request.get(`/api/dashboard${suffix}`)).json();
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
async function material(request: APIRequestContext, name: string) {
  return post(request, "/items", {
    name,
    unit: "个",
    spec: "M8",
    kind: "成品",
    minimum: "3",
  });
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("工作台真实月度账款、每日金额、业绩、60天提醒与今日类型完整计数", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = `工作台-${randomUUID().slice(0, 8)}`;
  const baseline = await overview(page.request);
  const m = await material(page.request, tag);
  await post(page.request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: m.id, quantity: "100" }],
  });
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const department = await post(page.request, "/sales/catalog", {
    kind: "department",
    name: tag,
  });
  const salesperson = await post(page.request, "/sales/catalog", {
    kind: "salesperson",
    name: tag,
    data: { department_id: department.id },
  });
  const sample = await post(page.request, "/sales/catalog", {
    kind: "type",
    name: `${tag}-样品`,
    data: { billable: false },
  });
  const create = async (
    date: string,
    price: string,
    extra: object = {},
    action = "confirm",
  ) =>
    post(page.request, "/sales/commands", {
      request_id: randomUUID(),
      action,
      input: {
        customer_id: customer.id,
        type_id: "sale",
        business_date: date,
        department_id: department.id,
        salesperson_id: salesperson.id,
        lines: [{ item_id: m.id, quantity: "1", price }],
        ...extra,
      },
    });
  let sale = await create(baseline.today, "50", {
    lines: [{ item_id: m.id, quantity: "4", price: "50" }],
    initial_payment: { account_id: "cash", amount: "50" },
  });
  sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "return",
    sale_id: sale.id,
    version: sale.version,
    business_date: baseline.today,
    reason: "抵减欠款",
    lines: [{ item_id: m.id, quantity: "1" }],
  });
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "pay",
    sale_id: sale.id,
    version: sale.version,
    business_date: baseline.today,
    reason: "补收",
    account_id: "cash",
    amount: "25",
  });
  await create(baseline.today, "999", {}, "save");
  const cancelled = await create(baseline.today, "888");
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "void",
    sale_id: cancelled.id,
    version: cancelled.version,
    reason: "作废不计账",
  });
  await create(baseline.previous_start, "11", {
    initial_payment: { account_id: "cash", amount: "5" },
  });
  await create(addDays(baseline.today, -61), "13");
  await create(addDays(baseline.today, -60), "19");
  await create(addDays(baseline.today, 1), "17");
  for (let i = 0; i < 52; i++)
    await create(baseline.today, "0", { type_id: sample.id });
  const data = await overview(page.request);
  expect(data.finance.due - baseline.finance.due).toBe(15000);
  expect(data.finance.paid - baseline.finance.paid).toBe(7500);
  expect(data.finance.debt - baseline.finance.debt).toBe(7500);
  expect(data.finance.comparison_due - baseline.finance.comparison_due).toBe(
    1100,
  );
  expect(data.finance.daily).toHaveLength(30);
  expect(
    data.finance.daily.at(-1).due - baseline.finance.daily.at(-1).due,
  ).toBe(15000);
  expect(data.finance.daily[0].date).toBe(addDays(data.today, -29));
  expect(data.aged_debt.count - baseline.aged_debt.count).toBe(1);
  expect(data.aged_debt.debt - baseline.aged_debt.debt).toBe(1300);
  expect(
    data.performance.items.find(
      (p: { salesperson: string }) => p.salesperson === tag,
    )?.due,
  ).toBe(15000);
  expect(data.sales.all_count - baseline.sales.all_count).toBe(55);
  expect(data.sales.due - baseline.sales.due).toBe(15000);
  const filtered = await overview(page.request, `?type_id=${sample.id}`);
  expect(filtered.sales.total).toBe(52);
  expect(filtered.sales.items).toHaveLength(6);
  expect(filtered.sales.due).toBe(0);
  expect(filtered.sales.paid).toBe(0);
  await page.goto("/#/home");
  await expect(
    page.getByRole("region", { name: "本月经营概况" }),
  ).toContainText("本月单据当前应收");
  await page.getByRole("button", { name: "查看每日金额", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "每日应收明细" }).getByRole("listitem"),
  ).toHaveCount(30);
  await page.getByRole("button", { name: "收起每日金额", exact: true }).click();
  await page
    .getByRole("group", { name: "今日单据类型" })
    .getByRole("button", { name: new RegExp(sample.name) })
    .click();
  await expect(
    page.getByRole("table", { name: "今日销售单据" }).locator("tbody tr"),
  ).toHaveCount(6);
  await expect(
    page.getByText("本日合计 · 52 张有效单据", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("group", { name: "今日单据类型" })
      .getByRole("button", { name: new RegExp(sample.name) }),
  ).toHaveAttribute("aria-pressed", "true");
  const detailLink = page
    .getByRole("table", { name: "今日销售单据" })
    .getByRole("link")
    .first();
  const destination = await detailLink.getAttribute("href");
  expect(destination).toContain("sale_open=");
  const otherPage = await page.context().newPage();
  await otherPage.goto(destination!);
  await expect(
    otherPage.getByRole("button", { name: "返回列表", exact: true }),
  ).toBeVisible();
  await otherPage.close();
  await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1280, 390, 320])
    for (const theme of ["light", "dark"])
      for (const size of ["sm", "md", "lg"]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(
          ([theme, size]) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.size = size;
          },
          [theme, size],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        if (width <= 760) {
          expect(
            await page.evaluate(
              () => document.documentElement.scrollHeight <= innerHeight,
            ),
          ).toBeTruthy();
        }
        if (size === "md")
          await page.screenshot({
            path: `tmp/dashboard-${testInfo.project.name}-${width}-${theme}.png`,
            fullPage: true,
          });
      }
  expect(errors).toEqual([]);
  await page
    .getByRole("table", { name: "今日销售单据" })
    .getByRole("link")
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "返回列表", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "返回列表", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "修订单据", exact: true }).click();
  await page.getByLabel("备注 选填", { exact: true }).fill("保留未提交内容");
  const savedUrl = page.url();
  const home = page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "工作台", exact: true });
  await home.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(page.url()).toBe(savedUrl);
  await expect(page.getByLabel("备注 选填", { exact: true })).toHaveValue(
    "保留未提交内容",
  );
  await home.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  expect(new URL(page.url()).searchParams.has("sale_open")).toBeFalsy();
  await page
    .getByRole("table", { name: "今日销售单据" })
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("sale_open")).toBeFalsy();
  await page.goto("/#/home");
  await page
    .locator(".home-ledger")
    .getByRole("link", { name: /库存不足/ })
    .click();
  await expect(
    page.getByRole("button", { name: "低库存", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("工作台清点以完成时间归月、活跃物料去重，未确认和取消不计入", async ({
  page,
}) => {
  const tag = `清点概况-${randomUUID().slice(0, 8)}`;
  const baseline = await overview(page.request);
  const a = await material(page.request, `${tag}-重复`),
    b = await material(page.request, `${tag}-上月`),
    c = await material(page.request, `${tag}-未确认`);
  const sql = (query: string) =>
    execFileSync(
      "sqlite3",
      [
        join(process.env.ERP_E2E_DATA!, "inventory.sqlite"),
        ".timeout 5000",
        query,
      ],
      { encoding: "utf8" },
    );
  const count = async (iid: string, quantity: string, complete = true) => {
    const start = await post(page.request, "/stocktakes", { item_ids: [iid] });
    await post(
      page.request,
      `/stocktakes/${start.id}/counts`,
      { lines: [{ item_id: iid, quantity }] },
      "PUT",
    );
    if (complete)
      await post(page.request, `/stocktakes/${start.id}/finish`, {
        confirm: true,
        reason: "清点验收",
      });
    return start.id;
  };
  const first = await count(a.id, "2");
  sql(`UPDATE stocktakes SET created_at=1 WHERE id='${first}'`);
  await count(a.id, "2");
  const previous = await count(b.id, "1");
  const boundary = new Date(`${baseline.month_start}T00:00:00`).getTime();
  sql(
    `UPDATE documents SET created_at=${boundary - 1} WHERE reference_id='${previous}'`,
  );
  const pending = await count(c.id, "1", false);
  let result = await overview(page.request);
  expect(result.stocktake.counted - baseline.stocktake.counted).toBe(1);
  expect(result.stocktake.differences - baseline.stocktake.differences).toBe(1);
  expect(result.inventory.total - baseline.inventory.total).toBe(3);
  await post(page.request, `/stocktakes/${pending}/finish`, {
    confirm: false,
    reason: "取消不算完成",
  });
  result = await overview(page.request);
  expect(result.stocktake.counted - baseline.stocktake.counted).toBe(1);
  // Confirming exactly on the first midnight includes it in this month.
  sql(
    `UPDATE documents SET created_at=${boundary} WHERE reference_id='${previous}'`,
  );
  result = await overview(page.request);
  expect(result.stocktake.counted - baseline.stocktake.counted).toBe(2);
  const archived = await material(page.request, `${tag}-停用`);
  await count(archived.id, "0");
  await post(page.request, `/items/${archived.id}`, {}, "DELETE");
  result = await overview(page.request);
  expect(result.stocktake.counted - baseline.stocktake.counted).toBe(2);
  expect(result.inventory.total - baseline.inventory.total).toBe(3);
});

test("工作台模块权限与本人单据范围互不扩大", async ({ page, browser }) => {
  const base = await overview(page.request);
  for (const permissions of [
    [],
    ["finance.read"],
    [
      "sales.read",
      "sales.create",
      "sales.confirm",
      "items.read",
      "customers.read",
      "catalog.read",
      "records.read",
    ],
  ]) {
    const tag = `dashboard_${randomUUID().slice(0, 8)}`;
    const role = await post(page.request, "/roles", { name: tag, permissions });
    await post(page.request, "/users", {
      username: tag,
      name: tag,
      password: "Dashboard-test-2026",
      role: role.id,
    });
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4289",
    });
    try {
      await post(context.request, "/login", {
        username: tag,
        password: "Dashboard-test-2026",
      });
      if (permissions.includes("sales.create")) {
        const m = await material(page.request, tag);
        await post(page.request, "/movements", {
          request_id: randomUUID(),
          kind: "receipt",
          lines: [{ item_id: m.id, quantity: "2" }],
        });
        const customer = await post(page.request, "/sales/catalog", {
          kind: "customer",
          name: tag,
        });
        await post(context.request, "/sales/commands", {
          request_id: randomUUID(),
          action: "confirm",
          input: {
            customer_id: customer.id,
            type_id: "sale",
            business_date: base.today,
            lines: [{ item_id: m.id, quantity: "1", price: "10" }],
          },
        });
      }
      const result = await overview(context.request);
      expect(!!result.finance).toBe(permissions.includes("finance.read"));
      expect(!!result.sales).toBe(permissions.includes("sales.read"));
      expect(!!result.inventory).toBe(permissions.includes("items.read"));
      expect(result.stocktake).toBeUndefined();
      if (result.sales) {
        expect(result.sales.total).toBe(1);
        expect(result.sales.all).toBe(false);
        expect(result.records.total).toBe(1);
      }
      const p = await context.newPage();
      await p.goto("/#/home");
      await expect(
        p.getByRole("heading", { name: `${tag}的工作台` }),
      ).toBeVisible();
      if (!result.finance)
        await expect(
          p.getByRole("region", { name: "本月经营概况" }),
        ).toHaveCount(0);
      if (result.sales)
        await expect(
          p.getByRole("heading", { name: "本人今日单据", exact: true }),
        ).toBeVisible();
      else
        await expect(
          p.getByRole("table", { name: "今日销售单据" }),
        ).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

test("工作台汇总失败不显示虚假的零数据，刷新后恢复", async ({ page }) => {
  await page.route("**/api/dashboard?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试服务暂时不可用" }),
    }),
  );
  await page.goto("/#/home");
  await expect(page.getByRole("alert")).toContainText("测试服务暂时不可用");
  await expect(
    page.getByText("今日单据未加载，请刷新重试。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("今天还没有单据。", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".home-ledger-cell")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /我要入库/ })).toBeVisible();
  await page.unroute("**/api/dashboard?**");
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "本月经营概况" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("工作台初次汇总加载期间不让新增展示带移走正在点击的快捷入口", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard?**", async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto("/#/home");
  await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /我要入库/ })).toHaveCount(0);
  release();
  await page.getByRole("button", { name: /我要入库/ }).click();
  await expect(page.getByLabel("来源 选填", { exact: true })).toBeVisible();
});
