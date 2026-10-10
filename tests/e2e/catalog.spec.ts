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
  await page.getByLabel("搜索物料", { exact: false }).fill(itemName);
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
