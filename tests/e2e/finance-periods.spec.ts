import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chooseSelect } from "./controls";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(request: APIRequestContext, path: string, data: object) {
  const r = await request.post(`/api${path}`, { headers, data });
  expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
  return r.json();
}
const finance = async (r: APIRequestContext, period = "all") =>
  (await r.get(`/api/sales/finance?performance_period=${period}`)).json();
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
async function fixture(r: APIRequestContext) {
  const tag = `月账-${randomUUID().slice(0, 8)}`;
  const baseline = await finance(r);
  const today = baseline.monthly.to as string;
  const item = await post(r, "/items", { name: tag, kind: tag, unit: "个" });
  await post(r, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "1000" }],
  });
  const customer = await post(r, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const department = await post(r, "/sales/catalog", {
    kind: "department",
    name: tag,
    data: { contact: "部门负责人" },
  });
  const salesperson = await post(r, "/sales/catalog", {
    kind: "salesperson",
    name: `${tag}-甲`,
    data: { department_id: department.id },
  });
  const colleague = await post(r, "/sales/catalog", {
    kind: "salesperson",
    name: `${tag}-乙`,
    data: { department_id: department.id },
  });
  const account = await post(r, "/sales/catalog", {
    kind: "account",
    name: tag,
  });
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    department_id: department.id,
    salesperson_id: salesperson.id,
    business_date: today,
    lines: [{ item_id: item.id, quantity: "10", price: "10" }],
  };
  return {
    tag,
    today,
    baseline,
    item,
    customer,
    department,
    salesperson,
    colleague,
    account,
    input,
  };
}
const command = (r: APIRequestContext, data: object) =>
  post(r, "/sales/commands", {
    request_id: randomUUID(),
    reason: "月度统计验收",
    ...data,
  });
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("本月本季本年按单据日期统计，账户月度净收独立按现金业务日期", async ({
  page,
}) => {
  const r = page.request,
    f = await fixture(r);
  const previousMonth = shift(f.baseline.monthly.from, -1);
  const previousYear = `${Number(f.today.slice(0, 4)) - 1}-12-31`;
  const dates = [
    [f.today, 10],
    [f.baseline.monthly.from, 11],
    [previousMonth, 13],
    [previousYear, 17],
    [shift(f.today, 1), 19],
  ] as const;
  const sales = [];
  for (const [date, price] of dates)
    sales.push(
      await command(r, {
        action: "confirm",
        input: {
          ...f.input,
          business_date: date,
          lines: [{ item_id: f.item.id, quantity: "1", price: String(price) }],
        },
      }),
    );
  await command(r, { action: "save", input: f.input });
  let voided = await command(r, { action: "confirm", input: f.input });
  await command(r, {
    action: "void",
    sale_id: voided.id,
    version: voided.version,
  });
  const [year, month] = f.today.split("-").map(Number);
  const starts: Record<string, string | null> = {
    month: `${year}-${String(month).padStart(2, "0")}-01`,
    quarter: `${year}-${String(Math.ceil(month / 3) * 3 - 2).padStart(2, "0")}-01`,
    year: `${year}-01-01`,
    all: null,
  };
  for (const period of ["month", "quarter", "year", "all"]) {
    const report = await finance(r, period);
    expect(report.period.from).toBe(starts[period]);
    expect(report.period.to).toBe(period === "all" ? null : f.today);
    const included = dates.filter(
      ([day]) =>
        period === "all" || (day >= report.period.from && day <= f.today),
    );
    const row = report.performance.find(
      (x: { salesperson_id: string }) => x.salesperson_id === f.salesperson.id,
    );
    expect(row.count).toBe(included.length);
    expect(row.due).toBe(
      included.reduce((sum, [, price]) => sum + price * 100, 0),
    );
    expect(report.monthly.departments[f.department.id]).toBe(2100);
    expect(report.monthly.salespeople[f.salesperson.id]).toBe(2100);
    expect(report.monthly.categories[f.tag.toLowerCase()]).toBe(2100);
  }
  await command(r, {
    action: "pay",
    sale_id: sales[0].id,
    version: sales[0].version,
    business_date: f.today,
    account_id: f.account.id,
    amount: "5",
  });
  await command(r, {
    action: "pay",
    sale_id: sales[3].id,
    version: sales[3].version,
    business_date: f.today,
    account_id: f.account.id,
    amount: "7",
  });
  let report = await finance(r, "month");
  expect(report.monthly.accounts[f.account.id]).toBe(1200);
  expect(
    report.performance.find(
      (x: { salesperson_id: string }) => x.salesperson_id === f.salesperson.id,
    ).paid,
  ).toBe(500);
  const paid = await (await r.get(`/api/sales/${sales[0].id}`)).json();
  await command(r, {
    action: "refund",
    sale_id: paid.id,
    version: paid.version,
    business_date: f.today,
    account_id: f.account.id,
    amount: "2",
  });
  report = await finance(r);
  expect(report.monthly.accounts[f.account.id]).toBe(1000);
  const bad = await r.get("/api/sales/finance?performance_period=invalid");
  expect(bad.status()).toBe(400);
  const moved = await post(r, "/sales/catalog", {
    kind: "department",
    name: `${f.tag}-调任部门`,
  });
  await post(r, "/sales/catalog", {
    ...f.salesperson,
    name: `${f.tag}-改名业务员`,
    data: { department_id: moved.id },
  });
  report = await finance(r, "month");
  expect(report.monthly.departments[f.department.id]).toBe(2100);
  expect(report.monthly.departments[moved.id]).toBeUndefined();
  expect(
    report.performance.find(
      (x: { salesperson_id: string }) => x.salesperson_id === f.salesperson.id,
    ).department_id,
  ).toBe(f.department.id);
  expect(
    report.performance_choices.filter(
      (x: { salesperson_id: string }) => x.salesperson_id === f.salesperson.id,
    ),
  ).toHaveLength(2);
});

test("分类使用历史快照和实际分摊，改分类与修订不倒填旧单，退货作废正确抵减", async ({
  page,
}) => {
  const r = page.request,
    f = await fixture(r);
  const input = { ...f.input, discount_rate: "90", rounding: "1" };
  let sale = await command(r, { action: "confirm", input });
  expect(sale.lines[0].kind).toBe(f.tag);
  expect(sale.due).toBe(8900);
  const item = (await (await r.get(`/api/items?ids=${f.item.id}`)).json())
    .items[0];
  const changed = await r.put(`/api/items/${f.item.id}`, {
    headers,
    data: { ...item, kind: `${f.tag}-新分类`, minimum: null },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  sale = await command(r, {
    action: "revise",
    sale_id: sale.id,
    version: sale.version,
    input: {
      ...input,
      lines: [{ item_id: f.item.id, quantity: "10", price: "11" }],
    },
  });
  expect(sale.lines[0].kind).toBe(f.tag);
  sale = await command(r, {
    action: "return",
    sale_id: sale.id,
    version: sale.version,
    business_date: f.today,
    lines: [{ item_id: f.item.id, quantity: "4" }],
  });
  expect(sale.due).toBe(5880);
  let report = await finance(r);
  expect(report.monthly.categories[f.tag.toLowerCase()]).toBe(5880);
  expect(
    report.monthly.categories[`${f.tag}-新分类`.toLowerCase()],
  ).toBeUndefined();
  let legacy = await command(r, {
    action: "confirm",
    input: {
      ...f.input,
      lines: [{ item_id: f.item.id, quantity: "3", price: "7" }],
    },
  });
  // A real pre-snapshot document has no kind field; do not infer it from current items.
  execFileSync("python3", [
    "-c",
    "import sqlite3,sys,os; c=sqlite3.connect(os.path.join(sys.argv[1],'inventory.sqlite')); c.execute(\"UPDATE sales SET data=json_remove(data,'$.lines[0].kind') WHERE id=?\",(sys.argv[2],)); c.commit(); c.close()",
    process.env.ERP_E2E_DATA!,
    legacy.id,
  ]);
  legacy = await command(r, {
    action: "revise",
    sale_id: legacy.id,
    version: legacy.version,
    input: {
      ...f.input,
      lines: [{ item_id: f.item.id, quantity: "3", price: "7" }],
      note: "旧单仍未记录分类",
    },
  });
  expect(legacy.lines[0].kind).toBeUndefined();
  report = await finance(r);
  expect(report.monthly.unclassified).toBe(
    f.baseline.monthly.unclassified + 2100,
  );
  const option = (
    await (await r.get("/api/material-options")).json()
  ).items.find(
    (o: { field: string; name: string }) =>
      o.field === "kind" && o.name === f.tag,
  );
  await post(r, "/material-options", { ...option, name: `${f.tag}-改名` });
  expect((await finance(r)).monthly.categories[f.tag.toLowerCase()]).toBe(5880);
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "物料分类", exact: true }).click();
  await expect(
    page.getByText(
      `历史分类“${f.tag.toLowerCase()}”：¥58.80（当前候选清单中已无此名称）`,
      { exact: true },
    ),
  ).toBeVisible();
  await command(r, { action: "void", sale_id: sale.id, version: sale.version });
  expect(
    (await finance(r)).monthly.categories[f.tag.toLowerCase()],
  ).toBeUndefined();
});

test("可按部门和业务员查业绩，零业绩、期间切换和手机刷新保留选择", async ({
  page,
}) => {
  const f = await fixture(page.request);
  await command(page.request, { action: "confirm", input: f.input });
  await page.goto("/#/performance");
  await page
    .getByRole("group", { name: "业绩期间" })
    .getByRole("button", { name: "本月", exact: true })
    .click();
  const department = page.getByRole("combobox", {
    name: "业绩部门",
    exact: false,
  });
  await chooseSelect(department, f.department.id);
  const person = page.getByRole("combobox", {
    name: "业绩业务员",
    exact: false,
  });
  await chooseSelect(person, f.salesperson.id);
  const table = page.getByRole("table", { name: "业绩归属汇总" });
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("¥100.00");
  await expect(table).toContainText(f.salesperson.name);
  await expect(page).toHaveURL(
    new RegExp(`performance_person=${f.salesperson.id}`),
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(person).toContainText(f.salesperson.name);
  await expect(department).toContainText(f.department.name);
  await chooseSelect(person, f.colleague.id);
  await expect(table).toContainText("当前期间和业务员没有有效计款单据。");
  await expect(table.locator("tfoot")).toContainText("¥0.00");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "业务员", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: f.salesperson.name });
  await expect(row.locator('[data-label="本月业绩"]')).toHaveText("¥100.00");
});

test("跨部门同名业务员可区分，调任前后按同一身份汇总且不混账", async ({
  page,
}) => {
  const r = page.request;
  const f = await fixture(r);
  await command(r, { action: "confirm", input: f.input });
  const otherDepartment = await post(r, "/sales/catalog", {
    kind: "department",
    name: `${f.tag}-另一部门`,
  });
  const otherPerson = await post(r, "/sales/catalog", {
    kind: "salesperson",
    name: f.salesperson.name,
    data: { department_id: otherDepartment.id },
  });
  await command(r, {
    action: "confirm",
    input: {
      ...f.input,
      department_id: otherDepartment.id,
      salesperson_id: otherPerson.id,
      lines: [{ item_id: f.item.id, quantity: "2", price: "10" }],
    },
  });
  const movedDepartment = await post(r, "/sales/catalog", {
    kind: "department",
    name: `${f.tag}-调任部门`,
  });
  await post(r, "/sales/catalog", {
    ...f.salesperson,
    data: { department_id: movedDepartment.id },
  });
  await command(r, {
    action: "confirm",
    input: {
      ...f.input,
      department_id: movedDepartment.id,
      lines: [{ item_id: f.item.id, quantity: "3", price: "10" }],
    },
  });
  await page.goto("/#/performance");
  const person = page.getByRole("combobox", {
    name: "业绩业务员",
    exact: false,
  });
  await person.click();
  const option = (id: string) =>
    page.locator(`[role="option"][data-value="${id}"]`);
  const names = [f.department.name, movedDepartment.name].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  await expect(option(f.salesperson.id)).toHaveText(
    `${f.salesperson.name} · ${names.join(" / ")}`,
  );
  await expect(option(otherPerson.id)).toHaveText(
    `${f.salesperson.name} · ${otherDepartment.name}`,
  );
  await option(f.salesperson.id).click();
  const table = page.getByRole("table", { name: "业绩归属汇总" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("tfoot")).toContainText("¥130.00");
  await chooseSelect(person, otherPerson.id);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("tfoot")).toContainText("¥20.00");
  await chooseSelect(
    page.getByRole("combobox", { name: "业绩部门", exact: false }),
    f.department.id,
  );
  await chooseSelect(person, f.salesperson.id);
  await expect(person).toHaveText(f.salesperson.name);
  await expect(table.locator("tfoot")).toContainText("¥100.00");
});

test("部门负责人可编辑，旧接口和旧模板兼容且新表格往返保留", async ({
  page,
}) => {
  const r = page.request,
    f = await fixture(r);
  const oldData = { ...f.department.data };
  delete oldData.contact;
  let department = await post(r, "/sales/catalog", {
    ...f.department,
    data: oldData,
  });
  expect(department.data.contact).toBe("部门负责人");
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "部门", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: f.department.name });
  await row.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByLabel("负责人", { exact: false }).fill("新负责人");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(row.locator('[data-label="负责人"]')).toHaveText("新负责人");
  expect(
    await (await r.get("/api/export/department?format=csv")).text(),
  ).toContain(`${f.tag},新负责人,启用,0,`);
  for (const csv of [
    `部门名称,状态,排序,备注\n${f.tag}-旧,启用,0,旧表\n`,
    `部门名称,负责人,状态,排序,备注\n${f.tag}-新,导入负责人,启用,0,新表\n`,
  ]) {
    const response = await r.post("/api/imports/department/preview", {
      headers,
      multipart: {
        file: {
          name: "部门.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const plan = await response.json();
    expect(plan.errors).toEqual([]);
    await post(r, `/imports/${plan.id}/commit`, {});
  }
  const catalog = (await (await r.get("/api/sales/catalog")).json()).items;
  expect(
    catalog.find((c: { name: string }) => c.name === `${f.tag}-新`).data
      .contact,
  ).toBe("导入负责人");
});

test("资料查看权限不披露月度金额，财务只读账号可独立筛选业务员", async ({
  page,
  browser,
}) => {
  const f = await fixture(page.request);
  await command(page.request, { action: "confirm", input: f.input });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    for (const [permissions, financeAllowed] of [
      [["catalog.read", "options.read", "accounts.read"], false],
      [["finance.read"], true],
    ] as const) {
      const name = randomUUID().slice(0, 8);
      const role = await post(page.request, "/roles", { name, permissions });
      await post(page.request, "/users", {
        username: name,
        name,
        password: "Finance-test-2026",
        role: role.id,
      });
      await post(context.request, "/login", {
        username: name,
        password: "Finance-test-2026",
      });
      expect(
        (
          await context.request.get(
            "/api/sales/finance?performance_period=month",
          )
        ).status(),
      ).toBe(financeAllowed ? 200 : 403);
      const p = await context.newPage();
      if (financeAllowed) {
        await p.goto("/#/performance");
        await chooseSelect(
          p.getByRole("combobox", { name: "业绩业务员", exact: false }),
          f.salesperson.id,
        );
        await expect(
          p.getByRole("table", { name: "业绩归属汇总" }),
        ).toContainText(f.salesperson.name);
      } else {
        await p.goto("/#/catalog");
        await p.getByRole("tab", { name: "部门", exact: true }).click();
        await expect(
          p.getByRole("columnheader", { name: "本月业绩", exact: true }),
        ).toHaveCount(0);
      }
      await p.close();
    }
  } finally {
    await context.close();
  }
});

test("账户汇总与流水使用相同期间，零流水账户可查，非法日期不显示误导金额", async ({
  page,
}) => {
  const r = page.request,
    f = await fixture(r);
  let sale = await command(r, { action: "confirm", input: f.input });
  sale = await command(r, {
    action: "pay",
    sale_id: sale.id,
    version: sale.version,
    business_date: shift(f.baseline.monthly.from, -1),
    account_id: f.account.id,
    amount: "5",
  });
  await command(r, {
    action: "pay",
    sale_id: sale.id,
    version: sale.version,
    business_date: f.today,
    account_id: f.account.id,
    amount: "7",
  });
  const zero = await post(r, "/sales/catalog", {
    kind: "account",
    name: `${f.tag}-无流水`,
  });
  await page.goto("/#/accounts");
  const periods = page.getByRole("group", { name: "账户期间" });
  await periods.getByRole("button", { name: "本月", exact: true }).click();
  await chooseSelect(
    page.getByRole("combobox", { name: "筛选账户", exact: false }),
    f.account.id,
  );
  const table = page.getByRole("table", { name: "账户汇总", exact: true });
  await expect(table).toContainText("¥7.00");
  await expect(
    page.getByText("筛选净收款：¥7.00", { exact: true }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出对账 CSV", exact: true }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain('"7.00"');
  expect(csv).not.toContain('"5.00"');
  await page
    .getByLabel("结束日期", { exact: false })
    .fill(shift(f.baseline.monthly.from, -1));
  await expect(page.getByRole("alert")).toContainText(
    "开始日期不能晚于结束日期",
  );
  await expect(table).toHaveCount(0);
  await periods.getByRole("button", { name: "本月", exact: true }).click();
  await page.reload();
  await expect(table).toContainText("¥7.00");
  await periods.getByRole("button", { name: "全部日期", exact: true }).click();
  await expect(table).toContainText("¥12.00");
  await table.getByRole("button", { name: "查看流水", exact: true }).click();
  await expect(page.locator("#finance-cash-entries")).toBeFocused();
  await chooseSelect(
    page.getByRole("combobox", { name: "筛选账户", exact: false }),
    zero.id,
  );
  await expect(table).toContainText("¥0.00");
  await expect(table).toContainText(zero.name);
});
