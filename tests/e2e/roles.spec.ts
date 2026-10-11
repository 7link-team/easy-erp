import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./controls";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api${path}`, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function role(request: APIRequestContext, permissions: string[]) {
  return post(request, "/roles", {
    name: `验收角色-${randomUUID().slice(0, 8)}`,
    permissions,
  });
}
async function account(request: APIRequestContext, role: string) {
  const username = `role_${randomUUID().slice(0, 8)}`;
  const user = await post(request, "/users", {
    username,
    name: username,
    password: "Role-test-2026",
    role,
  });
  return { ...user, password: "Role-test-2026" };
}
test.beforeEach(async ({ request, page }) => {
  if (!(await (await request.get("/api/status")).json()).initialized)
    await post(request, "/setup", { ...credentials, name: "管理员" });
  await post(request, "/login", credentials);
  await post(page.request, "/login", credentials);
});

test("角色弹窗维护、账号分配和模块 CRUD 在界面与 API 一致", async ({
  page,
  request,
  browser,
}) => {
  await page.goto("/#/users");
  await page.getByRole("button", { name: "新增角色", exact: true }).click();
  const name = `物料维护-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("角色名称", { exact: false }).fill(name);
  await page.getByRole("checkbox", { name: "物料：新增", exact: true }).check();
  await page.getByRole("checkbox", { name: "物料：修改", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "物料：查看", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const roles = await (await request.get("/api/roles")).json();
  const created = roles.roles.find((r: { name: string }) => r.name === name);
  await page.getByRole("button", { name: "添加人员账号", exact: true }).click();
  const username = `ui_${randomUUID().slice(0, 8)}`;
  await page.getByLabel("姓名 必填", { exact: true }).fill("物料维护员");
  await page.getByLabel("登录账号", { exact: false }).fill(username);
  await page.getByLabel("登录密码", { exact: false }).fill("Role-test-2026");
  await chooseSelect(page.getByLabel("角色 必填", { exact: true }), created.id);
  await expect(
    page.getByRole("checkbox", { name: "允许此账号登录", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "人员账号" })
      .getByRole("row")
      .filter({ hasText: username }),
  ).toContainText(name);
  await expect(
    page.getByRole("button", { name: `删除角色：${name}` }),
  ).toBeDisabled();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    const worker = await context.newPage();
    await post(context.request, "/login", {
      username,
      password: "Role-test-2026",
    });
    await worker.goto("http://127.0.0.1:4289/#/inventory");
    await expect(
      worker.getByRole("button", { name: "添加物料", exact: true }),
    ).toBeVisible();
    await expect(
      worker
        .getByRole("navigation")
        .getByRole("link", { name: "人员", exact: true }),
    ).toHaveCount(0);
    const item = await post(context.request, "/items", {
      name: `权限物料-${username}`,
      unit: "个",
      kind: "成品",
    });
    const items = await (await context.request.get("/api/items")).json();
    const detail = items.items.find((i: { id: string }) => i.id === item.id);
    expect(
      (
        await context.request.put(`/api/items/${item.id}`, {
          headers,
          data: { ...detail, minimum: "", name: `已修改-${username}` },
        })
      ).ok(),
    ).toBeTruthy();
    await worker.reload();
    const row = worker
      .getByRole("row")
      .filter({ hasText: `已修改-${username}` });
    await expect(
      row.getByRole("button", { name: `修改已修改-${username}` }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "删除", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await context.request.delete(`/api/items/${item.id}`, { headers })
      ).status(),
    ).toBe(403);
    expect((await context.request.get("/api/users")).status()).toBe(403);
    expect((await context.request.get("/api/roles")).status()).toBe(403);
    expect((await context.request.get("/api/documents")).status()).toBe(403);
    await page.getByRole("button", { name: `修改角色：${name}` }).click();
    await page
      .getByRole("checkbox", { name: "物料：修改", exact: true })
      .uncheck();
    await page.getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await context.request.get("/api/me")).status()).toBe(401);
    const login = await post(context.request, "/login", {
      username,
      password: "Role-test-2026",
    });
    expect(login.user.permissions).not.toContain("items.update");
    expect(
      (
        await context.request.put(`/api/items/${item.id}`, {
          headers,
          data: { ...detail, minimum: "", name: "越权改名" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
});

test("管理员保护、权限依赖、角色删除与并发编辑保护", async ({ request }) => {
  for (const body of [
    { id: "admin", name: "越权", permissions: [], version: 1 },
    { name: "未知权限", permissions: ["admin"] },
    { name: "缺少查看", permissions: ["items.update"] },
  ]) {
    expect(
      (await request.post("/api/roles", { headers, data: body })).status(),
    ).toBe(400);
  }
  expect((await request.delete("/api/roles/admin", { headers })).status()).toBe(
    400,
  );
  const admin = (await (await request.get("/api/users")).json()).find(
    (u: { role: string }) => u.role === "admin",
  );
  expect(
    (
      await request.put(`/api/users/${admin.id}`, {
        headers,
        data: { name: admin.name, role: "viewer", active: true },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.put(`/api/users/${admin.id}`, {
        headers,
        data: { name: admin.name, role: "admin", active: false },
      })
    ).status(),
  ).toBe(400);
  const unused = await role(request, []);
  await post(request, "/roles", {
    id: unused.id,
    name: `改名-${unused.id}`,
    version: 1,
    permissions: ["items.read"],
  });
  expect(
    (
      await request.post("/api/roles", {
        headers,
        data: { id: unused.id, name: "过期覆盖", version: 1, permissions: [] },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await request.delete(`/api/roles/${unused.id}`, { headers })).ok(),
  ).toBeTruthy();
  const used = await role(request, ["items.read"]);
  await account(request, used.id);
  expect(
    (await request.delete(`/api/roles/${used.id}`, { headers })).status(),
  ).toBe(409);
});

test("单据范围与收退款权限独立，作废退款不能绕过授权", async ({
  request,
  playwright,
}) => {
  const item = await post(request, "/items", {
    name: `权限库存-${randomUUID()}`,
    unit: "个",
    kind: "成品",
  });
  await post(request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "10" }],
  });
  const customer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: `权限客户-${randomUUID()}`,
  });
  const command = (client: APIRequestContext, data: Record<string, unknown>) =>
    post(client, "/sales/commands", {
      request_id: randomUUID(),
      reason: "权限验收",
      business_date: "2026-10-10",
      ...data,
    });
  let sale = await command(request, {
    action: "confirm",
    input: {
      type_id: "sale",
      customer_id: customer.id,
      business_date: "2026-10-10",
      discount_rate: "100",
      rounding: "0",
      lines: [{ item_id: item.id, quantity: "1", price: "10" }],
    },
  });
  const ownRole = await role(request, [
    "sales.read",
    "sales.pay",
    "accounts.read",
  ]);
  const own = await account(request, ownRole.id);
  const client = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(client, "/login", own);
    expect((await client.get(`/api/sales/${sale.id}`)).status()).toBe(403);
    const broad = await role(request, [
      "sales.read",
      "sales.all",
      "sales.pay",
      "sales.void",
      "accounts.read",
    ]);
    const cashier = await account(request, broad.id);
    await post(client, "/login", cashier);
    sale = await command(client, {
      action: "pay",
      sale_id: sale.id,
      version: sale.version,
      account_id: "cash",
      amount: "5",
    });
    for (const action of ["refund", "correct", "void"]) {
      expect(
        (
          await client.post("/api/sales/commands", {
            headers,
            data: {
              request_id: randomUUID(),
              action,
              sale_id: sale.id,
              version: sale.version,
              account_id: "cash",
              amount: "1",
              reason: "禁止绕过",
              business_date: "2026-10-10",
            },
          })
        ).status(),
      ).toBe(403);
    }
    const unchanged = await (await request.get(`/api/sales/${sale.id}`)).json();
    expect(unchanged.status).toBe("posted");
    expect(unchanged.paid).toBe(500);
    expect(unchanged.version).toBe(sale.version);
    expect(
      (await (await request.get(`/api/items?ids=${item.id}`)).json()).items[0]
        .balance,
    ).toBe(9000);
    const empty = await role(request, []);
    const nobody = await account(request, empty.id);
    await post(client, "/login", nobody);
    for (const path of [
      "/items",
      "/stocktakes",
      "/documents",
      "/sales",
      "/sales/finance",
    ])
      expect((await client.get(`/api${path}`)).status()).toBe(403);
    expect(
      (await (await client.get("/api/sales/catalog")).json()).items,
    ).toEqual([]);
  } finally {
    await client.dispose();
  }
});

test("账号内弹窗新增角色保留已填资料，手机权限表单操作常显", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/users");
  await page.getByRole("button", { name: "添加人员账号", exact: true }).click();
  await page.getByLabel("姓名 必填", { exact: true }).fill("嵌套新增验收");
  const username = `nested_${randomUUID().slice(0, 8)}`;
  await page.getByLabel("登录账号", { exact: false }).fill(username);
  await page.getByLabel("登录密码", { exact: false }).fill("Role-test-2026");
  await page.getByLabel("角色 必填", { exact: true }).click();
  await page.getByRole("option", { name: "新增角色", exact: true }).click();
  await page
    .getByLabel("角色名称", { exact: false })
    .fill(`嵌套角色-${username}`);
  await page.getByRole("checkbox", { name: "物料：查看", exact: true }).check();
  const save = page.getByRole("button", { name: "保存角色", exact: true });
  await expect(save).toBeInViewport({ ratio: 1 });
  await page
    .getByRole("checkbox", { name: "资金账户：查看", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport({ ratio: 1 });
  await save.click();
  await expect(page.getByLabel("姓名 必填", { exact: true })).toHaveValue(
    "嵌套新增验收",
  );
  await expect(page.getByLabel("角色 必填", { exact: true })).toContainText(
    `嵌套角色-${username}`,
  );
  await page.getByRole("button", { name: "保存账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("完整备份恢复自定义角色、账号关联与原权限", async ({
  request,
  playwright,
}) => {
  const original = await role(request, ["items.read", "items.create"]);
  const member = await account(request, original.id);
  const backup = await post(request, "/backups", {});
  await post(request, "/roles", {
    id: original.id,
    name: `恢复前修改-${original.id}`,
    permissions: [],
    version: 1,
  });
  await post(request, "/backups/restore", {
    name: backup.name,
    confirmation: "恢复全部数据",
  });
  expect((await request.get("/api/me")).status()).toBe(401);
  await post(request, "/login", credentials);
  const restored = (await (await request.get("/api/roles")).json()).roles.find(
    (r: { id: string }) => r.id === original.id,
  );
  expect(restored.permissions).toEqual(["items.create", "items.read"]);
  const client = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    const login = await post(client, "/login", member);
    expect(login.user.role).toBe(original.id);
    expect(login.user.permissions).toEqual(restored.permissions);
    await post(client, "/items", {
      name: `恢复权限-${randomUUID()}`,
      unit: "个",
      kind: "成品",
    });
    expect((await client.get("/api/sales/finance")).status()).toBe(403);
  } finally {
    await client.dispose();
  }
});

test("清点填写与确认分权，资料维护权限不能跨模块使用", async ({
  request,
  playwright,
}) => {
  const item = await post(request, "/items", {
    name: `清点分权-${randomUUID()}`,
    unit: "个",
    kind: "成品",
  });
  const stocktake = await post(request, "/stocktakes", { item_ids: [item.id] });
  const counterRole = await role(request, [
    "stocktake.read",
    "stocktake.count",
  ]);
  const counter = await account(request, counterRole.id);
  const client = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(client, "/login", counter);
    expect((await client.get("/api/stocktakes")).ok()).toBeTruthy();
    expect(
      (
        await client.put(`/api/stocktakes/${stocktake.id}/counts`, {
          headers,
          data: { lines: [{ item_id: item.id, quantity: "2" }] },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await client.post(`/api/stocktakes/${stocktake.id}/finish`, {
          headers,
          data: { confirm: true, reason: "清点差异" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.post("/api/stocktakes", {
          headers,
          data: { item_ids: [item.id] },
        })
      ).status(),
    ).toBe(403);
    const supervisorRole = await role(request, [
      "stocktake.read",
      "stocktake.finish",
    ]);
    await post(client, "/login", await account(request, supervisorRole.id));
    expect(
      (
        await client.put(`/api/stocktakes/${stocktake.id}/counts`, {
          headers,
          data: { lines: [{ item_id: item.id, quantity: "99" }] },
        })
      ).status(),
    ).toBe(403);
    await post(client, `/stocktakes/${stocktake.id}/finish`, {
      confirm: true,
      reason: "核实实际清点为2",
    });
    expect(
      (await (await request.get(`/api/items?ids=${item.id}`)).json()).items[0]
        .balance,
    ).toBe(2000);
    const customerRole = await role(request, [
      "customers.read",
      "customers.create",
    ]);
    await post(client, "/login", await account(request, customerRole.id));
    const customer = await post(client, "/sales/catalog", {
      kind: "customer",
      name: `分权客户-${randomUUID()}`,
    });
    for (const body of [
      { ...customer, active: false },
      { kind: "customer", name: `停用建档-${randomUUID()}`, active: false },
      { kind: "account", name: `禁止账户-${randomUUID()}` },
      { kind: "department", name: `禁止部门-${randomUUID()}` },
    ]) {
      expect(
        (
          await client.post("/api/sales/catalog", { headers, data: body })
        ).status(),
      ).toBe(403);
    }
    expect(
      (
        await client.post("/api/material-options", {
          headers,
          data: { field: "spec", name: "禁止新增" },
        })
      ).status(),
    ).toBe(403);
    const dictionaryRole = await role(request, [
      "options.read",
      "options.create",
    ]);
    await post(client, "/login", await account(request, dictionaryRole.id));
    const option = await post(client, "/material-options", {
      field: "spec",
      name: `可建字典-${randomUUID()}`,
    });
    expect(
      (
        await client.delete(`/api/material-options/${option.id}?version=1`, {
          headers,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await client.dispose();
  }
});
