import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./controls";
const headers = { "X-ERP-Request": "1" };
async function login(page: Page) {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    expect(
      (
        await page.request.post("/api/setup", {
          headers,
          data: {
            username: "manager",
            password: "Factory-test-2026",
            name: "王管理员",
          },
        })
      ).ok(),
    ).toBeTruthy();
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: false }).fill("manager");
  await page.getByLabel("登录密码", { exact: false }).fill("Factory-test-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

test("手输物料选项去重，候选改删不修改业务，单位记录保护与权限", async ({
  page,
  browser,
}) => {
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  const names = {
    spec: `M6-${suffix}`,
    kind: `耗材-${suffix}`,
    unit: `包${suffix}`,
  };
  for (const name of [`字典物料-${suffix}`, `字典重复-${suffix}`]) {
    await page.goto("/#/inventory");
    await page.getByRole("button", { name: "添加物料", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await page.setViewportSize({ width: 375, height: 667 });
    const specBox = await dialog
      .getByRole("combobox", { name: "规格 选填", exact: true })
      .boundingBox();
    const kindBox = await dialog
      .getByRole("combobox", { name: "物料类型 选填", exact: true })
      .boundingBox();
    expect(specBox).not.toBeNull();
    expect(kindBox).not.toBeNull();
    expect(kindBox!.y - specBox!.y - specBox!.height).toBeGreaterThanOrEqual(
      32,
    );
    await page.setViewportSize({ width: 1280, height: 800 });

    await dialog.getByLabel("物料名称", { exact: false }).fill(name);
    await dialog
      .getByLabel("规格", { exact: false })
      .fill(
        `  ${name.startsWith("字典重复") ? names.spec.toLowerCase() : names.spec}  `,
      );
    await dialog
      .getByRole("combobox", { name: "物料类型 选填", exact: true })
      .fill(names.kind);
    await dialog.getByLabel("基本单位", { exact: false }).fill(names.unit);
    await dialog.getByRole("button", { name: "保存物料", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const options = (
    await (await page.request.get("/api/material-options")).json()
  ).items;
  for (const [field, name] of Object.entries(names))
    expect(
      options.filter(
        (o: { field: string; name: string }) =>
          o.field === field && o.name === name,
      ),
    ).toHaveLength(1);
  const row = (
    await (
      await page.request.get(
        `/api/items?q=${encodeURIComponent(`字典物料-${suffix}`)}`,
      )
    ).json()
  ).items[0];
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "基础资料", exact: true })
    .click();
  await page.getByRole("tab", { name: "常用规格", exact: true }).click();
  const entry = page.getByRole("row").filter({ hasText: names.spec });
  await entry.getByRole("button", { name: "修改", exact: true }).click();
  await page
    .getByLabel("选项名称", { exact: false })
    .fill(`${names.spec}-修正`);
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  const renamed = page
    .getByRole("row")
    .filter({ hasText: `${names.spec}-修正` });
  await renamed.getByRole("button", { name: "删除候选", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除候选", exact: true })
    .click();
  await expect(renamed).toHaveCount(0);
  const unchanged = (
    await (
      await page.request.get(`/api/items?q=${encodeURIComponent(row.name)}`)
    ).json()
  ).items[0];
  expect(unchanged.spec).toBe(names.spec);
  expect(unchanged.unit).toBe(names.unit);
  expect(
    (
      await page.request.post("/api/movements", {
        headers,
        data: {
          request_id: randomUUID(),
          kind: "receipt",
          lines: [{ item_id: row.id, quantity: "5" }],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const current = (
    await (
      await page.request.get(`/api/items?q=${encodeURIComponent(row.name)}`)
    ).json()
  ).items[0];
  expect(
    (
      await page.request.put(`/api/items/${row.id}`, {
        headers,
        data: { ...current, unit: "箱", minimum: null },
      })
    ).status(),
  ).toBe(400);
  const username = `dict_${suffix}`;
  expect(
    (
      await page.request.post("/api/users", {
        headers,
        data: {
          username,
          name: "查看员",
          password: "Viewer-test-2026",
          role: "viewer",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  await viewer.goto("/");
  await viewer.getByLabel("登录账号", { exact: false }).fill(username);
  await viewer
    .getByLabel("登录密码", { exact: false })
    .fill("Viewer-test-2026");
  await viewer.getByRole("button", { name: "登录", exact: true }).click();
  await expect(viewer.getByRole("navigation")).toBeVisible();
  expect(
    (
      await viewer.request.post("/api/material-options", {
        headers,
        data: { field: "unit", name: "不能新增" },
      })
    ).status(),
  ).toBe(403);
  await ctx.close();
});

test("库存开单带入物料，单据类型手输新增去重并保留历史类型快照", async ({
  page,
}) => {
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  const itemName = `快捷开单-${suffix}`;
  const create = await page.request.post("/api/items", {
    headers,
    data: { name: itemName, kind: "成品", unit: "个" },
  });
  expect(create.ok()).toBeTruthy();
  const item = await create.json();
  expect(
    (
      await page.request.post("/api/movements", {
        headers,
        data: {
          request_id: randomUUID(),
          kind: "receipt",
          lines: [{ item_id: item.id, quantity: "10" }],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const c = await page.request.post("/api/sales/catalog", {
    headers,
    data: { kind: "customer", name: `直达客户-${suffix}`, data: {} },
  });
  expect(c.ok()).toBeTruthy();
  const customer = await c.json();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "客户", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/customers$/);
  await expect(page.getByText(customer.name, { exact: true })).toBeVisible();
  await page.goto("/#/inventory");
  await page
    .getByRole("searchbox", { name: "搜索物料", exact: true })
    .fill(itemName);
  const row = page.getByRole("row").filter({ hasText: itemName });
  await row.getByRole("button", { name: "开单出库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".sale-editor").getByText(itemName, { exact: true }),
  ).toBeVisible();
  await chooseSelect(
    page.getByRole("combobox", { name: "客户 必填", exact: true }),
    customer.id,
  );
  const typeName = `测试领用单-${suffix}`;
  await page
    .getByRole("combobox", { name: "单据类型 必填", exact: true })
    .fill(typeName);
  await chooseSelect(
    page.getByRole("combobox", { name: "新类型是否计款 必填", exact: true }),
    "false",
  );
  await page
    .getByRole("button", { name: "确认开单并扣库存", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toHaveCount(0);
  const catalog = (await (await page.request.get("/api/sales/catalog")).json())
    .items;
  const typ = catalog.find((o: { name: string }) => o.name === typeName);
  expect(typ.data.billable).toBe(false);
  const input = {
    customer_id: customer.id,
    type_id: "",
    type_name: ` ${typeName} `,
    business_date: "2026-10-09",
    lines: [{ item_id: item.id, quantity: "1", price: "0" }],
  };
  const second = await page.request.post("/api/sales/commands", {
    headers,
    data: { request_id: randomUUID(), action: "confirm", input },
  });
  expect(second.ok(), await second.text()).toBeTruthy();
  const sale = await second.json();
  expect(sale.type_id).toBe(typ.id);
  expect(
    (
      await page.request.post("/api/sales/catalog", {
        headers,
        data: { ...typ, name: `${typeName}-修正`, active: false },
      })
    ).ok(),
  ).toBeTruthy();
  const historical = await (
    await page.request.get(`/api/sales/${sale.id}`)
  ).json();
  expect(historical.type_name).toBe(typeName);
  const after = (
    await (await page.request.get(`/api/items?q=${itemName}`)).json()
  ).items[0];
  expect(after.balance).toBe(8000);
});

test("失败开单不留下新类型，备份恢复包含物料候选", async ({ page }) => {
  await login(page);
  const typeName = `回滚类型-${randomUUID().slice(0, 8)}`;
  const bad = await page.request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      action: "confirm",
      input: {
        customer_id: "不存在",
        type_id: "",
        type_name: typeName,
        type_billable: true,
        business_date: "2026-10-09",
        lines: [],
      },
    },
  });
  expect(bad.ok()).toBe(false);
  const catalog = (await (await page.request.get("/api/sales/catalog")).json())
    .items;
  expect(catalog.some((o: { name: string }) => o.name === typeName)).toBe(
    false,
  );
  const name = `备份单位${randomUUID().slice(0, 6)}`;
  expect(
    (
      await page.request.post("/api/material-options", {
        headers,
        data: { field: "unit", name },
      })
    ).ok(),
  ).toBeTruthy();
  const backup = await page.request.post("/api/backups", { headers, data: {} });
  expect(backup.ok()).toBeTruthy();
  const info = await backup.json();
  const before = (
    await (await page.request.get("/api/material-options")).json()
  ).items.find((o: { name: string }) => o.name === name);
  expect(
    (
      await page.request.delete(
        `/api/material-options/${before.id}?version=${before.version}`,
        { headers },
      )
    ).ok(),
  ).toBeTruthy();
  const restore = await page.request.post("/api/backups/restore", {
    headers,
    data: { name: info.name, confirmation: "恢复全部数据" },
  });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await page.request.post("/api/login", {
    headers,
    data: { username: "manager", password: "Factory-test-2026" },
  });
  expect(
    (await (await page.request.get("/api/material-options")).json()).items.some(
      (o: { name: string }) => o.name === name,
    ),
  ).toBe(true);
});

test("字典行内计款和启停、排序及删除保护保留历史单据", async ({ page }) => {
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  async function save(data: object) {
    const response = await page.request.post("/api/sales/catalog", {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const customer = await save({
    kind: "customer",
    name: `字典保护客户-${suffix}`,
  });
  const first = await save({
    kind: "type",
    name: `排序甲-${suffix}`,
    data: { billable: true, sort: 8000, note: "应收不追溯" },
  });
  const second = await save({
    kind: "type",
    name: `排序乙-${suffix}`,
    data: { billable: false, sort: 7000 },
  });
  const itemResponse = await page.request.post("/api/items", {
    headers,
    data: { name: `字典保护物料-${suffix}`, kind: "成品", unit: "个" },
  });
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
  expect(
    (
      await page.request.post("/api/movements", {
        headers,
        data: {
          request_id: randomUUID(),
          kind: "receipt",
          lines: [{ item_id: item.id, quantity: "10" }],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const saleResponse = await page.request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      action: "confirm",
      input: {
        type_id: first.id,
        customer_id: customer.id,
        business_date: "2026-10-10",
        lines: [{ item_id: item.id, quantity: "2", price: "12.5" }],
      },
    },
  });
  expect(saleResponse.ok(), await saleResponse.text()).toBeTruthy();
  const sale = await saleResponse.json();
  await page.goto("/#/catalog");
  const table = page.getByRole("table", { name: "单据类型列表" });
  const row = table.getByRole("row").filter({ hasText: first.name });
  const other = table.getByRole("row").filter({ hasText: second.name });
  await expect(row).toContainText("应收不追溯");
  const names = await table.locator("tbody .ledger-name").allTextContents();
  expect(names.indexOf(second.name)).toBeLessThan(names.indexOf(first.name));
  await expect(
    row.getByRole("button", { name: "删除", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await page.request.delete(`/api/sales/catalog/${first.id}?version=1`, {
        headers,
      })
    ).status(),
  ).toBe(409);
  await row.getByRole("switch", { name: `${first.name}计款` }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认修改", exact: true })
    .click();
  await expect(row.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  let historical = await (
    await page.request.get(`/api/sales/${sale.id}`)
  ).json();
  expect(historical.billable).toBe(true);
  expect(historical.due).toBe(2500);
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认停用", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  historical = await (await page.request.get(`/api/sales/${sale.id}`)).json();
  expect(historical.due).toBe(2500);
  const stale = await page.request.post("/api/sales/catalog", {
    headers,
    data: { ...first, active: true },
  });
  expect(stale.status()).toBe(409);
  await other.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除资料", exact: true })
    .click();
  await expect(other).toHaveCount(0);
  const invalid = await page.request.post("/api/sales/catalog", {
    headers,
    data: { kind: "department", name: "非法顺序", data: { sort: 1.5 } },
  });
  expect(invalid.status()).toBe(400);
  const department = await save({
    kind: "department",
    name: `被关联部门-${suffix}`,
  });
  await save({
    kind: "salesperson",
    name: `关联业务员-${suffix}`,
    data: { department_id: department.id },
  });
  expect(
    (
      await page.request.delete(
        `/api/sales/catalog/${department.id}?version=1`,
        { headers },
      )
    ).status(),
  ).toBe(409);
});

test("客户关联单据统计去重且保留历史客户引用，空客户显示零", async ({
  page,
}) => {
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`/api${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const first = await post("/sales/catalog", {
    kind: "customer",
    name: `关联甲-${suffix}`,
  });
  const next = await post("/sales/catalog", {
    kind: "customer",
    name: `关联乙-${suffix}`,
  });
  const empty = await post("/sales/catalog", {
    kind: "customer",
    name: `无单客户-${suffix}`,
  });
  const item = await post("/items", {
    name: `关联物料-${suffix}`,
    kind: "成品",
    unit: "个",
  });
  const input = {
    type_id: "sale",
    customer_id: first.id,
    business_date: "2026-10-10",
    lines: [{ item_id: item.id, quantity: "1", price: "25" }],
  };
  let sale = await post("/sales/commands", {
    action: "save",
    request_id: randomUUID(),
    input,
  });
  sale = await post("/sales/commands", {
    action: "save",
    request_id: randomUUID(),
    sale_id: sale.id,
    version: sale.version,
    input: { ...input, customer_id: next.id },
  });
  const catalog = (await (await page.request.get("/api/sales/catalog")).json())
    .items;
  for (const customer of [first, next]) {
    expect(
      catalog.find((c: { id: string }) => c.id === customer.id).usage_count,
    ).toBe(1);
    expect(
      (
        await page.request.delete(
          `/api/sales/catalog/${customer.id}?version=1`,
          { headers },
        )
      ).status(),
    ).toBe(409);
  }
  await page.goto("/#/customers");
  for (const [customer, count] of [
    [first, "1"],
    [next, "1"],
    [empty, "0"],
  ] as const) {
    const row = page.getByRole("row").filter({ hasText: customer.name });
    await expect(row.locator('[data-label="关联单据"]')).toHaveText(count);
  }
  await page.getByRole("button", { name: "新增客户", exact: true }).click();
  const label = page
    .getByRole("dialog")
    .locator("label")
    .filter({ hasText: "客户名称" });
  await expect(label.locator("..").locator(".field-required")).toHaveText("*");
  await expect(label.locator("..").locator(".field-required")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("dialog").getByLabel("客户名称 必填", { exact: true }),
  ).toHaveAttribute("required", "");
});
