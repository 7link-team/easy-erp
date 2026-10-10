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

test("客户档案账款按客户ID汇总，退货/草稿/作废口径及补收返回对账", async ({
  page,
}, testInfo) => {
  const tag = `客户往来-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M8");
  await movement(page.request, material.id, "receipt", "30");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
    data: { contact: "李经理", phone: "13800000000", address: "客户仓库" },
  });
  const empty = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: `${tag}-未开单`,
  });
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    business_date: "2026-10-10",
    lines: [{ item_id: material.id, quantity: "4", price: "50" }],
  };
  let sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: { ...input, initial_payment: { account_id: "cash", amount: "50" } },
  });
  sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "return",
    sale_id: sale.id,
    version: sale.version,
    reason: "退回一件",
    business_date: "2026-10-10",
    lines: [{ item_id: material.id, quantity: "1" }],
  });
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input,
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
    reason: "取消",
    business_date: "2026-10-10",
  });
  const renamed = `${tag}-新名称`;
  await post(page.request, "/sales/catalog", { ...customer, name: renamed });
  await page.goto("/#/customers");
  const row = page
    .getByRole("table", { name: "客户列表" })
    .getByRole("row")
    .filter({ hasText: renamed });
  await expect(row.locator('[data-label="应收合计"]')).toHaveText("¥150.00");
  await expect(row.locator('[data-label="净实收"]')).toHaveText("¥50.00");
  await expect(row.locator('[data-label="欠款"]')).toHaveText("¥100.00");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: empty.name })
      .locator('[data-label="欠款"]'),
  ).toHaveText("¥0.00");
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("customer-balances-mobile.png"),
  });
  await row.getByRole("button", { name: "对账", exact: true }).click();
  const ledger = page.getByRole("dialog", { name: `${renamed} · 单据对账` });
  await expect(ledger).toContainText("欠款 ¥100.00");
  const debtCell = ledger
    .getByRole("row")
    .filter({ hasText: sale.number })
    .locator('[data-label="欠款"]');
  await expect(debtCell).toHaveText("¥100.00");
  const debtBox = await debtCell.boundingBox();
  expect(debtBox!.x).toBeGreaterThanOrEqual(0);
  expect(debtBox!.x + debtBox!.width).toBeLessThanOrEqual(320);
  await expect(
    ledger.getByText("左右滚动表格可查看全部列；键盘可用左右方向键。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(ledger).toBeVisible();
  await ledger.getByRole("button", { name: sale.number, exact: true }).click();
  await expect(ledger).toHaveCount(0);
  await page.getByRole("button", { name: "登记收款", exact: true }).click();
  const pay = page.getByRole("dialog", { name: "登记收款", exact: true });
  await pay.getByLabel("金额 必填", { exact: true }).fill("25");
  await chooseSelect(pay.getByLabel("收款账户 必填", { exact: true }), "cash");
  await pay.getByLabel("操作原因 必填", { exact: true }).fill("客户对账补收");
  await pay.getByRole("button", { name: "登记收款", exact: true }).click();
  await expect(pay).toHaveCount(0);
  await page.getByRole("button", { name: "返回客户对账", exact: true }).click();
  await expect(ledger).toBeVisible();
  await expect(ledger).toContainText("欠款 ¥75.00");
  await ledger.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(row.locator('[data-label="净实收"]')).toHaveText("¥75.00");
  await expect(row.locator('[data-label="欠款"]')).toHaveText("¥75.00");
});

test("客户账款仅财务权限可见，汇总权限不扩大单据权限", async ({
  page,
  browser,
}) => {
  const tag = `客户权限-${randomUUID().slice(0, 8)}`;
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "10");
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      customer_id: customer.id,
      type_id: "sale",
      business_date: "2026-10-10",
      lines: [{ item_id: material.id, quantity: "1", price: "123" }],
    },
  });
  for (const scope of ["contacts", "finance", "own"] as const) {
    const permissions = [
      "customers.read",
      ...(scope === "contacts" ? [] : ["finance.read"]),
      ...(scope === "own" ? ["sales.read"] : []),
    ];
    const role = await post(page.request, "/roles", {
      name: `${tag}-${scope}`,
      permissions,
    });
    const username = `customer_${randomUUID().slice(0, 8)}`;
    await post(page.request, "/users", {
      username,
      name: username,
      password: "Customer-test-2026",
      role: role.id,
    });
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4289",
    });
    try {
      await post(context.request, "/login", {
        username,
        password: "Customer-test-2026",
      });
      const other = await context.newPage();
      await other.goto("/#/customers");
      const row = other.getByRole("row").filter({ hasText: tag });
      if (scope === "contacts") {
        await expect(row.locator('[data-label="欠款"]')).toHaveCount(0);
        expect((await context.request.get("/api/sales/finance")).status()).toBe(
          403,
        );
      } else {
        await expect(row.locator('[data-label="欠款"]')).toHaveText("¥123.00");
        if (scope === "finance") {
          await expect(
            row.getByRole("button", { name: /对账|本人单据/ }),
          ).toHaveCount(0);
          expect((await context.request.get("/api/sales")).status()).toBe(403);
        } else {
          await row
            .getByRole("button", { name: "本人单据", exact: true })
            .click();
          const ledger = other.getByRole("dialog");
          await expect(ledger).toContainText("当前角色仅可查看本人开出的单据");
          await expect(ledger).toContainText("暂无可查看的单据");
        }
      }
      expect(
        (await context.request.get("/api/export/sales?format=csv")).status(),
      ).toBe(403);
    } finally {
      await context.close();
    }
  }
});

test("单据导出覆盖全部筛选结果，金额和日期与列表一致，CSV防公式注入", async ({
  page,
}) => {
  const tag = `销售导出-${randomUUID().slice(0, 8)}`;
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: `=${tag}`,
  });
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "10");
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    business_date: "2026-10-09",
    lines: [{ item_id: material.id, quantity: "1", price: "10.01" }],
  };
  const draft = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input,
  });
  const sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      ...input,
      business_date: "2026-10-10",
      initial_payment: { account_id: "cash", amount: "0.01" },
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
    reason: "取消",
    business_date: "2026-10-10",
  });
  await page.goto("/#/sales");
  await page.getByLabel("搜索销售单").fill(tag);
  await expect(
    page.getByRole("table", { name: "销售单据列表" }).locator("tbody tr"),
  ).toHaveCount(3);
  const response = await page.request.get(
    (await page
      .getByRole("link", { name: "导出 CSV", exact: true })
      .getAttribute("href"))!,
  );
  expect(response.ok()).toBeTruthy();
  const csv = await response.text();
  expect(csv).toContain(`'=${tag}`);
  expect(csv).toContain(draft.number);
  expect(csv).toContain(voided.number);
  const line = csv
    .split("\n")
    .find((row) => row.startsWith(sale.number))!
    .trim()
    .split(",");
  expect(line.slice(9, 13)).toEqual(["10.01", "10.01", "0.01", "10.00"]);
  const draftLine = csv
    .split("\n")
    .find((row) => row.startsWith(draft.number))!
    .trim()
    .split(",");
  expect(draftLine.slice(9, 13)).toEqual(["10.01", "0.00", "0.00", "0.00"]);
  await page.getByLabel("业务日期从").fill("2026-10-10");
  await expect(
    page.getByRole("table", { name: "销售单据列表" }).locator("tbody tr"),
  ).toHaveCount(1);
  const filtered = await page.request.get(
    (await page
      .getByRole("link", { name: "导出 CSV", exact: true })
      .getAttribute("href"))!,
  );
  expect(await filtered.text()).toContain(sale.number);
  expect(await filtered.text()).not.toContain(draft.number);
  const xlsx = await page.request.get(
    `/api/export/sales?format=xlsx&customer_id=${customer.id}&status=posted`,
  );
  expect(xlsx.ok()).toBeTruthy();
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  for (let i = 0; i < 50; i++) {
    await post(page.request, "/sales/commands", {
      request_id: randomUUID(),
      action: "save",
      input,
    });
  }
  const scope = `customer_id=${customer.id}&status=draft`;
  const firstPage = await (
    await page.request.get(`/api/sales?${scope}`)
  ).json();
  expect(firstPage.total).toBe(51);
  expect(firstPage.items).toHaveLength(50);
  const allDrafts = await page.request.get(
    `/api/export/sales?format=csv&${scope}`,
  );
  expect((await allDrafts.text()).trim().split("\n")).toHaveLength(52);
  expect(await allDrafts.text()).toContain(draft.number);
  expect(
    (
      await page.request.get("/api/export/sales?from=2026-10-11&to=2026-10-10")
    ).status(),
  ).toBe(400);
});

test("物料页导入弹窗预览不写入、取消安全、确认后列表刷新", async ({ page }) => {
  const tag = `导入入口-${randomUUID().slice(0, 8)}`;
  const csv = `物料编码,物料名称,规格,类型,单位,小数位数,条码,最低库存\n${tag},${tag},M6,成品,个,3,,2\n`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "导入物料", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "导入物料", exact: true });
  await modal.getByLabel("选择表格文件 必填", { exact: true }).setInputFiles({
    name: "materials.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await modal
    .getByRole("button", { name: "预览并检查文件", exact: true })
    .click();
  await expect(modal).toContainText("文件检查通过");
  expect(
    (
      await (
        await page.request.get(`/api/items?q=${encodeURIComponent(tag)}`)
      ).json()
    ).total,
  ).toBe(0);
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "导入物料", exact: true }).click();
  modal = page.getByRole("dialog", { name: "导入物料", exact: true });
  await modal.getByLabel("选择表格文件 必填", { exact: true }).setInputFiles({
    name: "materials.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await modal
    .getByRole("button", { name: "预览并检查文件", exact: true })
    .click();
  const commit = modal.getByRole("button", {
    name: "确认导入 1 行",
    exact: true,
  });
  await expect(commit).toBeEnabled();
  const box = await commit.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await commit.click();
  await expect(modal).toContainText("已导入 1 行数据。");
  await modal.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("table", { name: "物料库存" })).toContainText(
    tag,
  );
  expect(
    (
      await (
        await page.request.get(`/api/items?q=${encodeURIComponent(tag)}`)
      ).json()
    ).total,
  ).toBe(1);
});

test("物料搜索等待期间不允许操作旧结果，搜索完成后可修改", async ({ page }) => {
  const tag = `搜索切换-${randomUUID().slice(0, 8)}`;
  await item(page.request, tag, "M6");
  // Install before mounting the app so no native debounce timer survives the fake clock.
  await page.clock.install();
  await page.goto("/#/inventory");
  const edit = page.getByRole("button", { name: `修改${tag}`, exact: true });
  await expect(edit).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.getByLabel("搜索物料", { exact: true }).fill(tag);
  // The 200ms debounce timer is paused: stale rows must disappear before it fires.
  await expect(edit).toHaveCount(0);
  await page.clock.runFor(250);
  await page.clock.resume();
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("规格 选填", { exact: true })).toHaveValue("M6");
});

test("退货作废汇总保留历史应收和实际退款，原单往返保留筛选", async ({
  page,
}, testInfo) => {
  const tag = `退货汇总-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "10");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  let sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      customer_id: customer.id,
      type_id: "sale",
      business_date: "2026-10-10",
      lines: [{ item_id: material.id, quantity: "4", price: "50" }],
      initial_payment: { account_id: "cash", amount: "50" },
    },
  });
  const command = async (action: string, extra: object) => {
    sale = await post(page.request, "/sales/commands", {
      request_id: randomUUID(),
      sale_id: sale.id,
      version: sale.version,
      action,
      business_date: "2026-10-10",
      reason: `客户${action}`,
      ...extra,
    });
  };
  await command("return", {
    lines: [{ item_id: material.id, quantity: "1" }],
    reason: "先抵减欠款",
  });
  await command("pay", { account_id: "cash", amount: "100" });
  await command("return", {
    lines: [{ item_id: material.id, quantity: "1" }],
    account_id: "cash",
    reason: "已付清后再退货",
  });
  await command("void", { account_id: "cash", reason: "取消剩余部分" });
  await post(page.request, "/sales/catalog", {
    ...customer,
    name: `${tag}-改名`,
  });
  const path = `/api/sales/adjustments?q=${encodeURIComponent(tag)}`;
  const result = await (await page.request.get(path)).json();
  expect(result.total).toBe(3);
  expect(
    result.items.map(
      (r: { version: number; due_change: number; refund: number }) => [
        r.version,
        r.due_change,
        r.refund,
      ],
    ),
  ).toEqual([
    [5, -10000, 10000],
    [4, -5000, 5000],
    [2, -5000, 0],
  ]);
  for (const record of result.items) {
    expect(record.customer_name).toBe(tag);
    expect(record).not.toHaveProperty("before");
    expect(record).not.toHaveProperty("after");
    expect(record).not.toHaveProperty("command");
  }
  expect(
    (await (await page.request.get(`${path}&action=void`)).json()).total,
  ).toBe(1);
  expect((await page.request.get(`${path}&action=pay`)).status()).toBe(400);
  expect(
    (
      await (
        await page.request.get("/api/sales/adjustments?q=先抵减欠款")
      ).json()
    ).items.some((r: { sale_id: string }) => r.sale_id === sale.id),
  ).toBeTruthy();
  await page.goto("/#/home");
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "退货与作废", exact: true })
    .click();
  await page.getByLabel("搜索退货与作废", { exact: true }).fill(tag);
  const table = page.getByRole("table", { name: "退货与作废记录" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const debtReturn = table.getByRole("row").filter({ hasText: "先抵减欠款" });
  await expect(debtReturn.locator('[data-label="应收变化"]')).toHaveText(
    "−¥50.00",
  );
  await expect(debtReturn.locator('[data-label="实际退款"]')).toHaveText(
    "¥0.00",
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await debtReturn
      .locator('[data-label="实际退款"]')
      .boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `tmp/returns-${testInfo.project.name}-${width}.png`,
    });
  }
  await page
    .getByRole("group", { name: "退货与作废动作筛选" })
    .getByRole("button", { name: "退货", exact: true })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await debtReturn
    .getByRole("button", { name: sale.number, exact: true })
    .click();
  await expect(
    page.getByText("已作废", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "返回退货与作废", exact: true })
    .click();
  await expect(page.getByLabel("搜索退货与作废", { exact: true })).toHaveValue(
    tag,
  );
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await page.reload();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(
    page
      .getByRole("group", { name: "退货与作废动作筛选" })
      .getByRole("button", { name: "退货", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("退货作废汇总分页不会遗漏相同秒内多次退货，非计款退货金额为零", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tag = `退货分页-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "60");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const type = await post(page.request, "/sales/catalog", {
    kind: "type",
    name: tag,
    data: { billable: false },
  });
  let sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      customer_id: customer.id,
      type_id: type.id,
      business_date: "2026-10-10",
      lines: [{ item_id: material.id, quantity: "51", price: "0" }],
    },
  });
  for (let i = 0; i < 51; i++) {
    sale = await post(page.request, "/sales/commands", {
      request_id: randomUUID(),
      action: "return",
      sale_id: sale.id,
      version: sale.version,
      lines: [{ item_id: material.id, quantity: "1" }],
      reason: `分批退货${i + 1}`,
      business_date: "2026-10-10",
    });
  }
  const url = `/api/sales/adjustments?q=${encodeURIComponent(tag)}`;
  const first = await (await page.request.get(url)).json();
  const last = await (await page.request.get(`${url}&page=2`)).json();
  expect(first.total).toBe(51);
  expect(first.items).toHaveLength(50);
  expect(last.items).toHaveLength(1);
  const records = [...first.items, ...last.items];
  expect(new Set(records.map((r) => r.version)).size).toBe(51);
  expect(records.map((r) => r.version)).toEqual(
    Array.from({ length: 51 }, (_, i) => 52 - i),
  );
  for (const record of records) {
    expect(record.due_change).toBe(0);
    expect(record.refund).toBe(0);
  }
  await page.goto(`/?returns_q=${encodeURIComponent(tag)}#/returns`);
  const next = page.getByRole("button", { name: "下一页", exact: true });
  await expect(
    page.getByRole("table", { name: "退货与作废记录" }).locator("tbody tr"),
  ).toHaveCount(50);
  await next.click();
  await expect(
    page.getByRole("table", { name: "退货与作废记录" }).locator("tbody tr"),
  ).toHaveCount(1);
  await expect(next).toBeDisabled();
  await expect(
    page.getByText("共 51 条 · 第 2 页", { exact: true }),
  ).toBeVisible();
});

test("退货作废汇总按原单归属隔离，未授权角色不能访问", async ({
  page,
  browser,
}) => {
  const tag = `退货权限-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M10");
  await movement(page.request, material.id, "receipt", "10");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    business_date: "2026-10-10",
    lines: [{ item_id: material.id, quantity: "1", price: "10" }],
  };
  const adminSale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input,
  });
  await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "void",
    sale_id: adminSale.id,
    version: adminSale.version,
    reason: "管理员单据",
  });
  for (const allowed of [true, false]) {
    const role = await post(page.request, "/roles", {
      name: `${tag}-${allowed}`,
      permissions: allowed
        ? [
            "sales.read",
            "sales.create",
            "sales.confirm",
            "items.read",
            "customers.read",
            "catalog.read",
          ]
        : ["customers.read"],
    });
    const username = `returns_${randomUUID().slice(0, 8)}`;
    await post(page.request, "/users", {
      username,
      name: username,
      password: "Returns-test-2026",
      role: role.id,
    });
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4289",
    });
    try {
      await post(context.request, "/login", {
        username,
        password: "Returns-test-2026",
      });
      if (allowed) {
        const own = await post(context.request, "/sales/commands", {
          request_id: randomUUID(),
          action: "confirm",
          input,
        });
        await post(page.request, "/sales/commands", {
          request_id: randomUUID(),
          action: "void",
          sale_id: own.id,
          version: own.version,
          reason: "管理员代作废本人单据",
        });
        const result = await (
          await context.request.get("/api/sales/adjustments")
        ).json();
        expect(result.total).toBe(1);
        expect(result.items[0].sale_id).toBe(own.id);
        expect(result.items[0].actor_name).toBe("管理员");
        expect(
          (await context.request.get(`/api/sales/${adminSale.id}`)).status(),
        ).toBe(403);
        const ownPage = await context.newPage();
        await ownPage.goto("/#/returns");
        await expect(
          ownPage.getByText(/当前仅显示本人开单的退货与作废/),
        ).toBeVisible();
        await expect(
          ownPage
            .getByRole("table", { name: "退货与作废记录" })
            .locator("tbody tr"),
        ).toHaveCount(1);
        await expect(
          ownPage.getByRole("button", { name: own.number, exact: true }),
        ).toBeVisible();
      } else {
        expect(
          (await context.request.get("/api/sales/adjustments")).status(),
        ).toBe(403);
        const other = await context.newPage();
        await other.goto("/#/returns");
        await expect(
          other.getByRole("table", { name: "退货与作废记录" }),
        ).toHaveCount(0);
        await expect(
          other
            .getByRole("navigation", { name: "主要导航" })
            .getByRole("button", { name: "退货与作废", exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test("筛选取消读取响应正文或收到无效JSON时不污染列表，后续查询能恢复", async ({
  page,
}) => {
  const tag = `正文取消-${randomUUID().slice(0, 8)}`;
  const material = await item(page.request, tag, "M8");
  await movement(page.request, material.id, "receipt", "2");
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      customer_id: customer.id,
      type_id: "sale",
      business_date: "2026-10-10",
      lines: [{ item_id: material.id, quantity: "1", price: "10" }],
    },
  });
  await page.addInitScript(() => {
    const original = Response.prototype.json;
    Response.prototype.json = async function () {
      if (new URL(this.url).searchParams.get("q") === "cancelled-body") {
        return new Promise((_, reject) => {
          (window as unknown as { rejectBody: () => void }).rejectBody = () =>
            reject(new DOMException("Cancelled body", "AbortError"));
        });
      }
      if (new URL(this.url).searchParams.get("q") === "late-body") {
        const data = await original.call(this);
        return new Promise((resolve) => {
          (window as unknown as { resolveBody: () => void }).resolveBody = () =>
            resolve(data);
        });
      }
      return original.call(this);
    };
  });
  await page.goto("/#/sales");
  const search = page.getByLabel("搜索销售单", { exact: true });
  const table = page.getByRole("table", { name: "销售单据列表" });
  for (const q of ["cancelled-body", "late-body"]) {
    await search.fill(q);
    await page.waitForFunction(
      (query) =>
        typeof (window as unknown as Record<string, unknown>)[
          query === "cancelled-body" ? "rejectBody" : "resolveBody"
        ] === "function",
      q,
    );
    const refreshed = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/sales" && url.searchParams.get("q") === tag;
    });
    await search.fill(tag);
    await refreshed;
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText(sale.number);
    await page.evaluate((query) => {
      (window as unknown as Record<string, () => void>)[
        query === "cancelled-body" ? "rejectBody" : "resolveBody"
      ]();
    }, q);
    // Wait for the released promise and a render opportunity before checking.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(table).toContainText(sale.number);
  }
  await page.route("**/api/sales?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "invalid-json")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "invalid",
      });
    else await route.continue();
  });
  await search.fill("invalid-json");
  await expect(page.getByRole("alert")).toContainText(
    "服务暂时无法完成操作，请稍后重试。",
  );
  await expect(
    page.getByRole("button", { name: "重新打开", exact: true }),
  ).toHaveCount(0);
  await search.fill(tag);
  await expect(table).toContainText(sale.number);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
