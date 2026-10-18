import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(r: APIRequestContext, path: string, data: object) {
  const response = await r.post(`/api${path}`, {
    headers,
    data:
      path === "/sales/commands" ? { reason: "性能回归验证", ...data } : data,
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
test.beforeEach(async ({ request }) => {
  if (!(await (await request.get("/api/status")).json()).initialized)
    await post(request, "/setup", { ...credentials, name: "管理员" });
  await post(request, "/login", credentials);
});

test("账户流水分页保持完整筛选金额，导出包含跨页退款，财务权限可单独使用", async ({
  request,
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const tag = randomUUID().slice(0, 8);
  const customer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: `分页客户-${tag}`,
  });
  const account = await post(request, "/sales/catalog", {
    kind: "account",
    name: `分页账户-${tag}`,
  });
  const item = await post(request, "/items", {
    name: `分页物料-${tag}`,
    kind: "测试",
    unit: "个",
  });
  await post(request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "1" }],
  });
  let sale = await post(request, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      type_id: "sale",
      customer_id: customer.id,
      business_date: "2026-10-01",
      lines: [{ item_id: item.id, quantity: "1", price: "100" }],
    },
  });
  for (let i = 0; i < 52; i++) {
    sale = await post(request, "/sales/commands", {
      request_id: randomUUID(),
      action: "pay",
      sale_id: sale.id,
      version: sale.version,
      account_id: account.id,
      amount: "1",
      business_date: "2026-10-01",
      note: `第${i + 1}笔`,
    });
  }
  sale = await post(request, "/sales/commands", {
    request_id: randomUUID(),
    action: "refund",
    sale_id: sale.id,
    version: sale.version,
    account_id: account.id,
    amount: "2",
    business_date: "2026-10-02",
    note: "跨日退款",
  });
  const path = `/api/sales/cash?account_id=${account.id}`;
  const first = await (await request.get(`${path}&page=1`)).json();
  const second = await (await request.get(`${path}&page=2`)).json();
  expect(first.items).toHaveLength(50);
  expect(second.items).toHaveLength(3);
  expect(
    new Set([...first.items, ...second.items].map((r: { id: string }) => r.id))
      .size,
  ).toBe(53);
  expect(first.total).toBe(53);
  expect(first.net).toBe(5000);
  expect(first.accounts).toEqual(second.accounts);
  expect(first.accounts[0]).toMatchObject({
    received: 5200,
    refunded: 200,
    net: 5000,
  });
  expect((await (await request.get(`${path}&page=999`)).json()).page).toBe(2);
  const dated = await (
    await request.get(`${path}&from=2026-10-02&to=2026-10-02`)
  ).json();
  expect(dated.total).toBe(1);
  expect(dated.net).toBe(-200);
  expect(
    (await request.get(`${path}&from=2026-10-03&to=2026-10-01`)).status(),
  ).toBe(400);
  const legacy = await (
    await request.get(`/api/sales/finance?q=${account.id}`)
  ).json();
  const summary = await (
    await request.get(`/api/sales/finance?q=${account.id}&entries=false`)
  ).json();
  expect(legacy.entries).toHaveLength(53);
  expect(summary.entries).toHaveLength(0);
  for (const key of ["due", "paid", "debt", "accounts"])
    expect(summary[key]).toEqual(legacy[key]);
  const customerBalance = summary.customers.find(
    (r: { id: string }) => r.id === customer.id,
  );
  expect(customerBalance).toMatchObject({
    due: sale.due,
    paid: sale.paid,
    debt: sale.debt,
  });
  const role = await post(request, "/roles", {
    name: `财务只读-${tag}`,
    permissions: ["finance.read"],
  });
  await post(request, "/users", {
    username: `perf_${tag}`,
    name: "财务只读",
    password: "Perf-test-2026",
    role: role.id,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username: `perf_${tag}`,
      password: "Perf-test-2026",
    });
    expect((await context.request.get(path)).ok()).toBe(true);
    const exported = await context.request.get(
      `/api/export/cash?format=csv&account_id=${account.id}`,
    );
    expect(exported.ok()).toBe(true);
    const csv = await exported.text();
    expect(csv.trim().split(/\r?\n/)).toHaveLength(54);
    expect(csv).toContain("-2.00");
    expect(csv).not.toContain("'-2.00");
    expect(
      (await context.request.get("/api/export/sales?format=csv")).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
  const anonymous = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    expect((await anonymous.request.get(path)).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  await post(page.request, "/login", credentials);
  await page.goto(`/?finance_account=${account.id}#/accounts`);
  const section = page.getByRole("region", { name: "账户流水", exact: true });
  const pager = section.getByRole("navigation", { name: "账户流水分页" });
  await expect(pager).toContainText("共 53 条");
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(pager).toContainText("第 2 页");
  await expect(
    section.getByText("筛选净收款：¥50.00", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(pager).toContainText("第 2 页");
});

test("轻量候选不计算删除资格，管理引用统计仍含已修订客户", async ({
  request,
}) => {
  const tag = randomUUID().slice(0, 8);
  const oldCustomer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: `历史-${tag}`,
  });
  const nextCustomer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: `当前-${tag}`,
  });
  const item = await post(request, "/items", {
    name: `引用-${tag}`,
    kind: "测试",
    unit: "个",
  });
  const input = {
    type_id: "sale",
    customer_id: oldCustomer.id,
    business_date: "2026-10-01",
    lines: [{ item_id: item.id, quantity: "1", price: "10" }],
  };
  let sale = await post(request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input,
  });
  sale = await post(request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    sale_id: sale.id,
    version: sale.version,
    input: { ...input, customer_id: nextCustomer.id },
  });
  const light = await (
    await request.get(`/api/sales/catalog?options=true&kind=customer&q=${tag}`)
  ).json();
  expect(light.items).toHaveLength(2);
  for (const row of light.items)
    expect(row).toMatchObject({ can_delete: false, usage_count: null });
  const managed = await (
    await request.get(`/api/sales/catalog?kind=customer&q=${tag}`)
  ).json();
  for (const row of managed.items)
    expect(row).toMatchObject({ can_delete: false, usage_count: 1 });
  expect(
    (
      await request.delete(
        `/api/sales/catalog/${oldCustomer.id}?version=${oldCustomer.version}`,
        { headers },
      )
    ).status(),
  ).toBe(409);
});

test("不含性能索引的旧备份能恢复，损坏备份拒绝且保留当前数据", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const before = await post(request, "/items", {
    name: `恢复前-${randomUUID()}`,
    kind: "测试",
    unit: "个",
  });
  const backup = await post(request, "/backups", {});
  const directory = join(process.env.ERP_E2E_DATA!, "backups");
  execFileSync("python3", [
    "-c",
    `
import sys,zipfile,tempfile,sqlite3,json,hashlib,pathlib
folder=pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory() as tmp:
 with zipfile.ZipFile(sys.argv[2]) as z:
  manifest=json.loads(z.read('manifest.json')); z.extract('inventory.sqlite',tmp)
 dbpath=pathlib.Path(tmp)/'inventory.sqlite'; db=sqlite3.connect(dbpath)
 for row in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('sales_ordered','sales_owner_ordered','sales_customer_ordered','sales_status_ordered','sales_business_date','sales_reporting','returns_parent','cash_balances','cash_account_totals','cash_ordered','cash_account_ordered','cash_business_date','audit_ordered','audit_owner_ordered','audit_actions','audit_owner_actions')").fetchall(): db.execute('DROP INDEX '+row[0])
 db.execute("DELETE FROM seaql_migrations WHERE version='query_indexes_v1'");db.commit();db.close()
 manifest['sha256']=hashlib.sha256(dbpath.read_bytes()).hexdigest()
 for filename,valid in [('legacy-performance.zip',True),('corrupt-performance.zip',False)]:
  copy=dict(manifest)
  if not valid: copy['sha256']='0'*64
  with zipfile.ZipFile(folder/filename,'w') as z:
   z.writestr('manifest.json',json.dumps(copy));z.write(dbpath,'inventory.sqlite')
 db=sqlite3.connect(dbpath)
 db.execute("INSERT INTO sales VALUES ('','bad','bad','posted',1,0,'{}')");db.commit();db.close()
 manifest['sha256']=hashlib.sha256(dbpath.read_bytes()).hexdigest()
 with zipfile.ZipFile(folder/'invalid-sale-performance.zip','w') as z:
  z.writestr('manifest.json',json.dumps(manifest));z.write(dbpath,'inventory.sqlite')
`,
    directory,
    backup.path,
  ]);
  const missing = await request.get("/api/backups/missing-performance.zip");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  const invalid = await request.post("/api/backups/restore", {
    headers,
    data: {
      name: "invalid-sale-performance.zip",
      confirmation: "恢复全部数据",
    },
  });
  expect(invalid.status()).toBe(400);
  expect(await invalid.text()).toContain("销售、收款或退货数据不一致");
  const rejected = await request.post("/api/backups/restore", {
    headers,
    data: { name: "corrupt-performance.zip", confirmation: "恢复全部数据" },
  });
  expect(rejected.status()).toBe(400);
  expect(
    (await (await request.get(`/api/items?ids=${before.id}`)).json()).items,
  ).toHaveLength(1);
  await post(request, "/backups/restore", {
    name: "legacy-performance.zip",
    confirmation: "恢复全部数据",
  });
  expect((await request.get("/api/me")).status()).toBe(401);
  await post(request, "/login", credentials);
  expect(
    (await (await request.get(`/api/items?ids=${before.id}`)).json()).items,
  ).toHaveLength(1);
  expect((await request.get("/api/sales/finance?entries=false")).ok()).toBe(
    true,
  );
  expect((await request.get("/api/dashboard")).ok()).toBe(true);
});
