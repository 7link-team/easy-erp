import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./controls";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await page.request.post("/api/setup", {
      headers,
      data: { ...credentials, name: "管理员" },
    });
  await page.request.post("/api/login", { headers, data: credentials });
});

test("物料成本统计与售价带入、手改和草稿价格保持独立", async ({ page }) => {
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const name = `价格-${randomUUID().slice(0, 8)}`;
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "添加物料", exact: true }).click();
  await page
    .getByRole("textbox", { name: "物料名称 必填", exact: true })
    .fill(name);
  await page
    .getByRole("textbox", { name: "成本价（元） 选填", exact: true })
    .fill("2.3456");
  await page
    .getByRole("textbox", { name: "售价（元） 选填", exact: true })
    .fill("8.1234");
  await page.getByRole("button", { name: "保存物料", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const getItem = async () =>
    (await (await page.request.get(`/api/items?q=${name}`)).json()).items[0];
  let item = await getItem();
  expect(item.cost_price).toBe(23456);
  expect(item.sale_price).toBe(81234);
  await post("/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "3.125" }],
  });
  const valuation = await (
    await page.request.get(`/api/items?q=${name}`)
  ).json();
  expect(valuation.inventory_value).toBe("7.33");
  expect(valuation.items[0].inventory_value).toBe("7.33");
  const customer = await post("/sales/catalog", {
    kind: "customer",
    name: `${name}-客户`,
    data: {},
  });
  await page.goto("/#/invoice");
  await chooseSelect(
    page.getByRole("combobox", { name: "客户 必填", exact: true }),
    customer.id,
  );
  await chooseSelect(
    page.getByRole("combobox", { name: "结算方式 必填", exact: true }),
    "unpaid",
  );
  await page.getByRole("button", { name: "添加一行", exact: true }).click();
  await page.getByLabel("开单查找物料").fill(name);
  await page.getByRole("button", { name: `选择${name}`, exact: true }).click();
  const price = page.getByLabel(`${name} 单价`, { exact: false });
  await expect(price).toHaveValue("8.1234");
  await price.fill("9.50");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sales/commands") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const sale = await response.json();
  expect(sale.lines[0].price).toBe(95000);
  expect(JSON.stringify(sale)).not.toContain("cost_price");
  item = await getItem();
  const update = async (cost: string, selling: string) => {
    item = await getItem();
    const result = await page.request.put(`/api/items/${item.id}`, {
      headers,
      data: { ...item, minimum: null, cost_price: cost, sale_price: selling },
    });
    expect(result.ok(), await result.text()).toBeTruthy();
  };
  await update("999", "12");
  await page.goto(`/?sale_open=${sale.id}&sale_edit=1#/sales`);
  await expect(price).toHaveValue("9.5");
  for (const selling of ["", "0"]) {
    await update("999", selling);
    await page.goto(`/?price_case=${selling || "empty"}#/invoice`);
    await page.getByRole("button", { name: "添加一行", exact: true }).click();
    await page.getByLabel("开单查找物料").fill(name);
    await page
      .getByRole("button", { name: `选择${name}`, exact: true })
      .click();
    await expect(price).toHaveValue("");
  }
  await update("", "");
  const missing = await (await page.request.get(`/api/items?q=${name}`)).json();
  expect(missing.inventory_value).toBe("0.00");
  expect(missing.unpriced_items).toBe(1);
  expect(missing.items[0].cost_price).toBeNull();
  for (const value of ["-1", "1.00001", "1e3"]) {
    const invalid = await page.request.post("/api/items", {
      headers,
      data: { name, kind: "成品", unit: "个", cost_price: value },
    });
    expect(invalid.status()).toBe(400);
  }
});

test("基础资料独立地址、刷新、面包屑与浏览器前进后退", async ({ page }) => {
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "单据类型", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("tab", { name: "收款账户", exact: true }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "开单与打印设置", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/settings$/);
  const breadcrumbs = page.getByRole("navigation", { name: "面包屑" });
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
    "开单与打印设置",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "默认结算方式 选填", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "公司信息", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/company$/);
  await page.goBack();
  await expect(
    page.getByRole("combobox", { name: "默认结算方式 选填", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText(
    "公司信息",
  );
  await breadcrumbs
    .getByRole("link", { name: "基础资料", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/catalog$/);
});

test("库存金额涵盖筛选范围全部分页，旧客户端编辑保留价格", async ({ page }) => {
  const prefix = `金额分页-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];
  for (let i = 0; i < 51; i++) {
    const response = await page.request.post("/api/items", {
      headers,
      data: {
        name: `${prefix}-${i}`,
        kind: "成品",
        unit: "个",
        cost_price: "1.2345",
        sale_price: "5",
      },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).id);
  }
  const receipt = await page.request.post("/api/movements", {
    headers,
    data: {
      request_id: randomUUID(),
      kind: "receipt",
      lines: ids.map((id) => ({ item_id: id, quantity: "2" })),
    },
  });
  expect(receipt.ok(), await receipt.text()).toBeTruthy();
  const second = await (
    await page.request.get(`/api/items?q=${prefix}&page=2`)
  ).json();
  expect(second.items).toHaveLength(1);
  expect(second.total).toBe(51);
  expect(second.inventory_value).toBe("125.97");
  const { cost_price, sale_price, ...legacy } = second.items[0];
  const edited = await page.request.put(`/api/items/${legacy.id}`, {
    headers,
    data: { ...legacy, minimum: null, spec: "旧客户端修改" },
  });
  expect(edited.ok()).toBeTruthy();
  const result = await (
    await page.request.get(`/api/items?ids=${legacy.id}`)
  ).json();
  expect(result.items[0].cost_price).toBe(cost_price);
  expect(result.items[0].sale_price).toBe(sale_price);
});

test("直接打开设置地址仍遵守基础资料查看权限", async ({
  page,
  browser,
  baseURL,
}) => {
  const roleResponse = await page.request.post("/api/roles", {
    headers,
    data: {
      name: `仅候选-${randomUUID().slice(0, 8)}`,
      permissions: ["options.read"],
    },
  });
  expect(roleResponse.ok()).toBeTruthy();
  const role = await roleResponse.json();
  const username = `prices_${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/users", {
    headers,
    data: {
      username,
      name: "仅候选",
      password: "Role-test-2026",
      role: role.id,
    },
  });
  expect(created.ok()).toBeTruthy();
  const context = await browser.newContext({ baseURL });
  try {
    const login = await context.request.post("/api/login", {
      headers,
      data: { username, password: "Role-test-2026" },
    });
    expect(login.ok()).toBeTruthy();
    const restricted = await context.newPage();
    await restricted.goto("/#/catalog/settings");
    await expect(
      restricted.getByText("没有查看此栏目的权限。", { exact: true }),
    ).toBeVisible();
    await expect(
      restricted.getByRole("combobox", {
        name: "默认结算方式 选填",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
