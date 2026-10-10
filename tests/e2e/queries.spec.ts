import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./controls";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api${path}`, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function item(
  request: APIRequestContext,
  name: string,
  spec: string,
  minimum = "",
) {
  return post(request, "/items", {
    name,
    spec,
    unit: "个",
    kind: "成品",
    minimum: minimum || null,
  });
}
async function movement(
  request: APIRequestContext,
  item_id: string,
  kind: string,
  quantity: string,
  note = "",
) {
  return post(request, "/movements", {
    request_id: randomUUID(),
    kind,
    note,
    lines: [{ item_id, quantity }],
  });
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("物料规格搜索、四种状态计数、排序、筛选导出及停用恢复", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `查询-${randomUUID().slice(0, 8)}`;
  const spec = `M%_${tag}`;
  const a = await item(page.request, `${tag}-低库存`, spec, "3");
  const b = await item(page.request, `${tag}-正常`, spec);
  const c = await item(page.request, `${tag}-清零`, spec);
  const d = await item(page.request, `${tag}-停用`, spec);
  await movement(page.request, a.id, "receipt", "2");
  await movement(page.request, b.id, "receipt", "10");
  await movement(page.request, d.id, "receipt", "1");
  await movement(page.request, d.id, "issue", "1");
  expect(
    (await page.request.delete(`/api/items/${d.id}`, { headers })).ok(),
  ).toBeTruthy();
  const result = await (
    await page.request.get(
      `/api/items?q=${encodeURIComponent(spec)}&sort=stock_asc`,
    )
  ).json();
  expect(result.counts).toEqual({ active: 3, low: 1, zero: 1, archived: 1 });
  expect(result.items.map((v: { id: string }) => v.id)).toEqual([
    c.id,
    a.id,
    b.id,
  ]);
  expect((await page.request.get("/api/items?status=unknown")).status()).toBe(
    400,
  );
  expect((await page.request.get("/api/items?sort=bad")).status()).toBe(400);
  await page.goto("/#/inventory");
  await page.getByLabel("搜索物料", { exact: true }).fill(spec);
  await expect(page.getByRole("row").filter({ hasText: a.id })).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: a.name ?? `${tag}-低库存` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "已清零", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "物料库存" }).locator("tbody tr"),
  ).toHaveCount(1);
  await expect(page.getByRole("table", { name: "物料库存" })).toContainText(
    `${tag}-清零`,
  );
  const exportLink = page.getByRole("link", { name: "导出 CSV", exact: true });
  const csv = await page.request.get((await exportLink.getAttribute("href"))!);
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain(`${tag}-清零`);
  expect(await csv.text()).not.toContain(`${tag}-正常`);
  await page.getByRole("button", { name: "已停用", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "已停用", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("搜索物料", { exact: true })).toHaveValue(spec);
  const row = page.getByRole("row").filter({ hasText: `${tag}-停用` });
  await expect(
    row.getByRole("button", { name: "入库", exact: true }),
  ).toHaveCount(0);
  const archived = (
    await (
      await page.request.get(
        `/api/items?q=${encodeURIComponent(spec)}&status=archived`,
      )
    ).json()
  ).items[0];
  const viewer = `query_${randomUUID().slice(0, 8)}`;
  await post(page.request, "/users", {
    username: viewer,
    name: viewer,
    password: "Viewer-test-2026",
    role: "viewer",
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username: viewer,
      password: "Viewer-test-2026",
    });
    expect(
      (
        await context.request.post(`/api/items/${d.id}/restore`, {
          headers,
          data: { version: archived.version },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("inventory-filter-mobile.png"),
  });
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认启用", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/items/${d.id}/restore`, {
        headers,
        data: { version: archived.version },
      })
    ).status(),
  ).toBe(409);
  await page.getByRole("button", { name: "全部在用", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: `${tag}-停用` }),
  ).toBeVisible();
  await chooseSelect(
    page.getByRole("combobox", { name: "物料排序", exact: true }),
    "stock_desc",
  );
  await expect(
    page.getByRole("table", { name: "物料库存" }).locator("tbody tr").first(),
  ).toContainText(`${tag}-正常`);
});

test("单据状态与收款状态分开、日期筛选、刷新保留与权限范围", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `单据筛选-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "20");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    business_date: "2026-10-09",
    lines: [{ item_id: material.id, quantity: "1", price: "25" }],
  };
  const draft = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input,
  });
  const posted = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      ...input,
      business_date: "2026-10-10",
      initial_payment: { account_id: "cash", amount: "5" },
    },
  });
  const voided = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input,
  });
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "void",
    sale_id: voided.id,
    version: voided.version,
    reason: "筛选验收",
    business_date: "2026-10-10",
  });
  const result = await (
    await page.request.get(
      `/api/sales?q=${encodeURIComponent(tag)}&status=posted`,
    )
  ).json();
  expect(result.counts).toEqual({ all: 3, draft: 1, posted: 1, voided: 1 });
  expect(result.total).toBe(1);
  expect(result.items[0].id).toBe(posted.id);
  expect(
    (
      await page.request.get("/api/sales?from=2026-10-11&to=2026-10-10")
    ).status(),
  ).toBe(400);
  expect((await page.request.get("/api/sales?status=wrong")).status()).toBe(
    400,
  );
  await page.goto("/#/sales");
  await page.getByLabel("搜索销售单").fill(tag);
  const table = page.getByRole("table", { name: "销售单据列表" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await page
    .getByRole("group", { name: "单据状态筛选" })
    .getByRole("button", { name: "草稿", exact: true })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText(draft.number);
  await expect(table).toContainText("未记账");
  await page
    .getByRole("group", { name: "单据状态筛选" })
    .getByRole("button", { name: "全部", exact: true })
    .click();
  await page.getByLabel("业务日期从").fill("2026-10-10");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText(posted.number);
  await expect(table.locator('[data-label="收款状态"]')).toHaveText("部分收款");
  await page.reload();
  await expect(page.getByLabel("业务日期从")).toHaveValue("2026-10-10");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("sales-filter-mobile.png"),
  });
  const username = `scope_${randomUUID().slice(0, 8)}`;
  await post(page.request, "/users", {
    username,
    name: username,
    password: "Scope-test-2026",
    role: "worker",
    can_in: false,
    can_out: true,
    can_count: false,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username,
      password: "Scope-test-2026",
    });
    const own = await (
      await context.request.get(`/api/sales?q=${encodeURIComponent(tag)}`)
    ).json();
    expect(own.items).toEqual([]);
    expect(own.total).toBe(0);
    expect(own.counts).toEqual({ all: 0, draft: 0, posted: 0, voided: 0 });
  } finally {
    await context.close();
  }
});

test("出入库与审计搜索、类型筛选和CSV导出一致，普通账号不泄漏他人记录", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `流水查询-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M20");
  await movement(page.request, material.id, "receipt", "10", tag);
  await movement(page.request, material.id, "issue", "2", tag);
  await page.goto("/#/records");
  await page.getByLabel("搜索记录").fill(tag);
  const table = page.getByRole("table", { name: "出入库记录列表" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("group", { name: "记录类型" })
    .getByRole("button", { name: "出库", exact: true })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("−2 个");
  await expect(table).toContainText("结存 8 个");
  const csv = await page.request.get(
    (await page.getByRole("link", { name: "导出 CSV" }).getAttribute("href"))!,
  );
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain("issue");
  expect(await csv.text()).not.toContain("receipt");
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("records-filter-mobile.png"),
  });
  await page
    .getByRole("button", { name: new RegExp(`领用出库 ${tag}`) })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "本次操作完成后的库存：8 个",
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: "操作记录", exact: true }).click();
  await chooseSelect(
    page.getByRole("combobox", { name: "筛选操作类型" }),
    "新增物料",
  );
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  const auditCSV = await page.request.get(
    (await page.getByRole("link", { name: "导出 CSV" }).getAttribute("href"))!,
  );
  expect(auditCSV.ok(), await auditCSV.text()).toBeTruthy();
  // Audit export identifies the matching object by ID; details remain in the audit view.
  expect(await auditCSV.text()).toContain(material.id);
  expect((await auditCSV.text()).trim().split("\n")).toHaveLength(2);
  expect(await auditCSV.text()).toContain("新增物料");
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "操作记录", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("combobox", { name: "筛选操作类型" }),
  ).toHaveAttribute("data-value", "新增物料");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  const username = `record_${randomUUID().slice(0, 8)}`;
  await post(page.request, "/users", {
    username,
    name: username,
    password: "Record-test-2026",
    role: "worker",
    can_in: true,
    can_out: false,
    can_count: false,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username,
      password: "Record-test-2026",
    });
    const docs = await (
      await context.request.get(`/api/documents?q=${encodeURIComponent(tag)}`)
    ).json();
    expect(docs.items).toEqual([]);
    expect(docs.total).toBe(0);
    const audits = await (
      await context.request.get(`/api/audit?q=${encodeURIComponent(tag)}`)
    ).json();
    expect(audits.items).toEqual([]);
    expect(audits.total).toBe(0);
    expect(
      (
        await context.request.get(
          `/api/export/documents?format=csv&q=${encodeURIComponent(tag)}`,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
});
