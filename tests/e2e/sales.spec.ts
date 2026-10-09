import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chooseSelect } from "./controls";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
const date = "2026-10-09";
async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(`/api${path}`, { headers, data });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function command(
  request: APIRequestContext,
  data: Record<string, unknown>,
) {
  return post(request, "/sales/commands", {
    request_id: randomUUID(),
    reason: "验收操作",
    business_date: date,
    ...data,
  });
}
async function fixture(request: APIRequestContext, stock = "100") {
  const suffix = randomUUID().slice(0, 8);
  const item = await post(request, "/items", {
    name: `销售物料-${suffix}`,
    kind: "成品",
    unit: "公斤",
  });
  await post(request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: stock }],
  });
  const customer = await post(request, "/sales/catalog", {
    kind: "customer",
    name: `客户-${suffix}`,
    data: { phone: "13800000000", contact: "客户经办人", address: "示例仓库" },
  });
  const input = {
    customer_id: customer.id,
    type_id: "sale",
    business_date: date,
    note: "测试单据",
    discount_rate: "100",
    rounding: "0",
    lines: [{ item_id: item.id, quantity: "10", price: "100" }],
  };
  return { item: { ...item, name: `销售物料-${suffix}` }, customer, input };
}
async function balance(request: APIRequestContext, id: string) {
  return (
    await (await request.get(`/api/items?q=${encodeURIComponent(id)}`)).json()
  ).items;
}
async function itemBalance(request: APIRequestContext, name: string) {
  return (
    await (await request.get(`/api/items?q=${encodeURIComponent(name)}`)).json()
  ).items[0].balance;
}
test.beforeEach(async ({ request, page }) => {
  if (!(await (await request.get("/api/status")).json()).initialized)
    await post(request, "/setup", { ...credentials, name: "管理员" });
  await post(request, "/login", credentials);
  await post(page.request, "/login", credentials);
});

test("整单事务、重复提交、库存不足、清点锁定与并发不超卖", async ({
  request,
}) => {
  const { item, input } = await fixture(request, "10");
  const missing = await post(request, "/items", {
    name: `缺货-${randomUUID().slice(0, 8)}`,
    kind: "成品",
    unit: "个",
  });
  let r = await request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      action: "confirm",
      input: {
        ...input,
        lines: [
          { item_id: item.id, quantity: "1", price: "1" },
          { item_id: missing.id, quantity: "1", price: "1" },
        ],
      },
    },
  });
  expect(r.status()).toBe(409);
  expect(await itemBalance(request, item.name)).toBe(10000);
  const counted = await post(request, "/stocktakes", {
    item_ids: [item.id],
    note: "销售锁定验收",
  });
  r = await request.post("/api/sales/commands", {
    headers,
    data: { request_id: randomUUID(), action: "confirm", input },
  });
  expect(r.status()).toBe(409);
  await post(request, `/stocktakes/${counted.id}/finish`, { confirm: false });
  const payload = {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      ...input,
      lines: [{ item_id: item.id, quantity: "8", price: "1" }],
    },
  };
  const outcomes = await Promise.all([
    request.post("/api/sales/commands", { headers, data: payload }),
    request.post("/api/sales/commands", {
      headers,
      data: { ...payload, request_id: randomUUID() },
    }),
  ]);
  expect(outcomes.map((r) => r.status()).sort()).toEqual([200, 409]);
  const win = outcomes.find((r) => r.status() === 200)!;
  const sale = await win.json();
  const winningPayload = outcomes[0].status() === 200 ? payload : undefined;
  if (winningPayload) {
    const replay = await post(request, "/sales/commands", winningPayload);
    expect(replay.id).toBe(sale.id);
  }
  expect(await itemBalance(request, item.name)).toBe(2000);
  const linked = (
    await (await request.get("/api/documents")).json()
  ).items.find((d: { kind: string }) => d.kind === "sales");
  expect(
    (
      await request.post(`/api/documents/${linked.id}/void`, {
        headers,
        data: { reason: "禁止绕过" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/movements", {
        headers,
        data: {
          request_id: randomUUID(),
          kind: "return_in",
          reference_id: linked.id,
          note: "禁止绕过",
          lines: [{ item_id: item.id, quantity: "1" }],
        },
      })
    ).status(),
  ).toBe(409);
});

test("客户示例、分账户补收、更正冲销、修订退款、部分退货及作废", async ({
  request,
}) => {
  const { item, input } = await fixture(request, "200");
  const secondName = `纸-${randomUUID().slice(0, 8)}`;
  const second = await post(request, "/items", {
    name: secondName,
    kind: "成品",
    unit: "公斤",
  });
  await post(request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: second.id, quantity: "100" }],
  });
  const bank = await post(request, "/sales/catalog", {
    kind: "account",
    name: `银行卡-${randomUUID().slice(0, 8)}`,
  });
  const original = {
    ...input,
    rounding: "50",
    lines: [
      { item_id: item.id, quantity: "100", price: "80" },
      { item_id: second.id, quantity: "20.5", price: "100" },
    ],
  };
  let sale = await command(request, { action: "confirm", input: original });
  expect([sale.subtotal, sale.total, sale.debt]).toEqual([
    1005000, 1000000, 1000000,
  ]);
  const payPayload = {
    request_id: randomUUID(),
    sale_id: sale.id,
    version: sale.version,
    action: "pay",
    amount: "5000",
    account_id: "cash",
    business_date: date,
    reason: "首次收款",
  };
  sale = await post(request, "/sales/commands", payPayload);
  await post(request, "/sales/commands", payPayload);
  expect([sale.paid, sale.debt]).toEqual([500000, 500000]);
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "pay",
    amount: "5000",
    account_id: bank.id,
  });
  expect(sale.debt).toBe(0);
  const originalCash = sale.payments.find(
    (p: { account_id: string }) => p.account_id === "cash",
  );
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "correct",
    cash_id: originalCash.id,
    amount: "5000",
    account_id: bank.id,
  });
  expect(sale.paid).toBe(1000000);
  expect(
    sale.payments.some(
      (p: { reversal_of: string }) => p.reversal_of === originalCash.id,
    ),
  ).toBe(true);
  const unchanged = await itemBalance(request, item.name);
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "revise",
    input: { ...original, rounding: "100" },
    account_id: bank.id,
  });
  expect(sale.due).toBe(995000);
  expect(sale.paid).toBe(995000);
  expect(await itemBalance(request, item.name)).toBe(unchanged);
  const currentVersion = sale.version;
  const conflict = await request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      sale_id: sale.id,
      version: currentVersion - 1,
      action: "void",
      reason: "冲突",
    },
  });
  expect(conflict.status()).toBe(409);
  const previous = await (
    await request.get(`/api/sales/${sale.id}/revisions/${currentVersion}`)
  ).json();
  expect(previous.before.paid).toBe(1000000);
  expect(previous.after.paid).toBe(995000);
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "return",
    lines: [{ item_id: second.id, quantity: "0.5" }],
    account_id: bank.id,
  });
  expect(await itemBalance(request, secondName)).toBe(80000);
  expect(sale.paid).toBe(sale.due);
  expect(sale.returned[second.id].quantity).toBe(500);
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "void",
    account_id: bank.id,
  });
  expect([sale.status, sale.due, sale.paid, sale.debt]).toEqual([
    "voided",
    0,
    0,
    0,
  ]);
  expect(await itemBalance(request, item.name)).toBe(200000);
  expect(await itemBalance(request, secondName)).toBe(100000);
  const finance = await (await request.get("/api/sales/finance")).json();
  const account = finance.accounts.find(
    (a: { id: string }) => a.id === bank.id,
  );
  expect(account.net).toBe(0);
});

test("草稿不扣库存、自定义类型快照、不计款、修改数量和失败回滚", async ({
  request,
}) => {
  const { item, input } = await fixture(request, "20");
  const typ = await post(request, "/sales/catalog", {
    kind: "type",
    name: `赠送-${randomUUID().slice(0, 8)}`,
    data: { billable: false, sort: 4 },
  });
  const sample = {
    ...input,
    type_id: typ.id,
    lines: [{ item_id: item.id, quantity: "1.2500", price: "" }],
  };
  let sale = await command(request, { action: "save", input: sample });
  expect(sale.status).toBe("draft");
  expect(await itemBalance(request, item.name)).toBe(20000);
  const renamed = await post(request, "/sales/catalog", {
    ...typ,
    name: `改名-${randomUUID().slice(0, 8)}`,
    data: { billable: true },
  });
  sale = await command(request, {
    action: "confirm",
    sale_id: sale.id,
    version: sale.version,
    input: sample,
  });
  expect(sale.type_name).toBe(typ.name);
  expect(sale.billable).toBe(false);
  expect(sale.due).toBe(0);
  expect(await itemBalance(request, item.name)).toBe(18750);
  sale = await command(request, {
    action: "revise",
    sale_id: sale.id,
    version: sale.version,
    input: {
      ...sample,
      lines: [{ item_id: item.id, quantity: "2.125", price: "" }],
    },
  });
  expect(await itemBalance(request, item.name)).toBe(17875);
  const fail = await request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      action: "revise",
      sale_id: sale.id,
      version: sale.version,
      reason: "库存不足",
      input: {
        ...sample,
        lines: [{ item_id: item.id, quantity: "21", price: "" }],
      },
    },
  });
  expect(fail.status()).toBe(409);
  expect(await itemBalance(request, item.name)).toBe(17875);
  const latest = await (await request.get(`/api/sales/${sale.id}`)).json();
  expect(latest.version).toBe(sale.version);
  await post(request, "/sales/catalog", { ...renamed, active: false });
  const newFail = await request.post("/api/sales/commands", {
    headers,
    data: { request_id: randomUUID(), action: "confirm", input: sample },
  });
  expect(newFail.status()).toBe(400);
});

test("普通开单人与最高权限隔离，附件不越权，优惠不可绕过", async ({
  request,
  playwright,
}) => {
  const { item, input } = await fixture(request);
  const suffix = randomUUID().slice(0, 8);
  await post(request, "/users", {
    username: `sales_${suffix}`,
    name: "开单人",
    password: "Worker-test-2026",
    role: "worker",
    can_in: false,
    can_out: true,
    can_count: false,
  });
  const worker = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(worker, "/login", {
      username: `sales_${suffix}`,
      password: "Worker-test-2026",
    });
    const own = await command(worker, { action: "confirm", input });
    expect((await worker.get("/api/sales/finance")).status()).toBe(403);
    expect(
      (await worker.get(`/api/sales/${own.id}/revisions/1`)).status(),
    ).toBe(403);
    expect(
      (
        await worker.post("/api/sales/commands", {
          headers,
          data: {
            request_id: randomUUID(),
            action: "revise",
            sale_id: own.id,
            version: own.version,
            reason: "越权",
            input,
          },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await worker.post("/api/sales/commands", {
          headers,
          data: {
            request_id: randomUUID(),
            action: "confirm",
            input: { ...input, discount_rate: "90" },
          },
        })
      ).status(),
    ).toBe(403);
    const adminSale = await command(request, { action: "confirm", input });
    expect((await worker.get(`/api/sales/${adminSale.id}`)).status()).toBe(403);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
      "base64",
    );
    const bad = await worker.post(`/api/sales/${own.id}/attachments`, {
      headers,
      multipart: {
        file: {
          name: "bad.png",
          mimeType: "image/png",
          buffer: Buffer.from("not an image"),
        },
      },
    });
    expect(bad.status()).toBe(400);
    const attachment = await request.post(
      `/api/sales/${adminSale.id}/attachments`,
      {
        headers,
        multipart: {
          file: { name: "签字.png", mimeType: "image/png", buffer: png },
        },
      },
    );
    expect(attachment.ok(), await attachment.text()).toBeTruthy();
    const { id } = await attachment.json();
    expect((await worker.get(`/api/sales/attachments/${id}`)).status()).toBe(
      403,
    );
    expect(
      (
        await worker.delete(`/api/sales/attachments/${id}`, { headers })
      ).status(),
    ).toBe(403);
    const catalog = await (await worker.get("/api/sales/catalog")).json();
    expect(
      catalog.items.every((c: { kind: string }) => c.kind !== "account"),
    ).toBe(true);
  } finally {
    await worker.dispose();
  }
});

test("真实界面多品类开单、收款、打印、手机版式与离开保护", async ({
  page,
  browserName,
}, testInfo) => {
  const { item, customer, input } = await fixture(page.request, "200");
  const department = await post(page.request, "/sales/catalog", {
    kind: "department",
    name: `开单部门-${randomUUID().slice(0, 8)}`,
  });
  const salesperson = await post(page.request, "/sales/catalog", {
    kind: "salesperson",
    name: `开单业务员-${randomUUID().slice(0, 8)}`,
    data: { department_id: department.id },
  });
  const secondName = `开单第二物料-${randomUUID().slice(0, 8)}`;
  const second = await post(page.request, "/items", {
    name: secondName,
    kind: "成品",
    unit: "公斤",
  });
  await post(page.request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: second.id, quantity: "100" }],
  });
  await page.goto("/#/sales");
  await expect(
    page.getByRole("heading", { name: "开单与收款", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建单据", exact: true }).click();
  await chooseSelect(
    page.getByRole("combobox", { name: "客户 必填", exact: true }),
    customer.id,
  );
  await expect(
    page.getByRole("combobox", { name: "部门业务员", exact: false }),
  ).toBeDisabled();
  await chooseSelect(
    page.getByRole("combobox", { name: "业绩部门", exact: false }),
    department.id,
  );
  await chooseSelect(
    page.getByRole("combobox", { name: "部门业务员", exact: false }),
    salesperson.id,
  );
  await page.getByLabel("开单查找物料").fill(item.name);
  await page
    .getByRole("button", { name: new RegExp(`${item.name} · 库存`) })
    .click();
  await page.getByLabel(`${item.name} 数量`, { exact: false }).fill("100");
  await page.getByLabel(`${item.name} 单价`, { exact: false }).fill("80");
  await page.getByLabel("开单查找物料").fill(secondName);
  await page
    .getByRole("button", { name: new RegExp(`${secondName} · 库存`) })
    .click();
  await page.getByLabel(`${secondName} 数量`, { exact: false }).fill("20.5");
  await page.getByLabel(`${secondName} 单价`, { exact: false }).fill("100");
  await page.getByLabel("抹零金额", { exact: false }).fill("50");
  await page.getByRole("button", { name: "返回单据", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "离开开单页面？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "确认开单并扣库存", exact: true })
    .click();
  await expect(
    page.getByText("当前应收：¥10,000.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登记收款", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("金额", { exact: false }).fill("5000");
  await chooseSelect(
    dialog.getByRole("combobox", { name: "收款账户 必填", exact: true }),
    "cash",
  );
  await dialog.getByLabel("操作原因", { exact: false }).fill("客户签收收款");
  await dialog.getByRole("button", { name: "登记收款", exact: true }).click();
  await expect(
    page.getByText("剩余欠款：¥5,000.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打印预览", exact: true }).click();
  await expect(page.locator(".sales-print-sheet")).toContainText(customer.name);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sales-print-tools")).toBeHidden();
  if (browserName === "chromium")
    await page.pdf({
      path: testInfo.outputPath("sales-a4.pdf"),
      format: "A4",
      preferCSSPageSize: true,
    });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  expect(await itemBalance(page.request, item.name)).toBe(100000);
  for (const size of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await expect(
      page.getByRole("button", { name: "打印预览", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`sales-${size.width}.png`),
      fullPage: true,
    });
  }
});

test("签字图片、资金与库存完整备份恢复，并兼容升级前备份", async ({
  request,
}) => {
  const { item, input } = await fixture(request);
  let sale = await command(request, { action: "confirm", input });
  sale = await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "pay",
    amount: "500",
    account_id: "cash",
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  const a = await request.post(`/api/sales/${sale.id}/attachments`, {
    headers,
    multipart: {
      file: { name: "签字.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(a.ok(), await a.text()).toBeTruthy();
  const attachment = await a.json();
  const second = await request.post(`/api/sales/${sale.id}/attachments`, {
    headers,
    multipart: {
      file: { name: "签字2.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(second.ok()).toBeTruthy();
  const third = await request.post(`/api/sales/${sale.id}/attachments`, {
    headers,
    multipart: {
      file: { name: "签字3.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(third.status()).toBe(400);
  const backup = await post(request, "/backups", {});
  await command(request, {
    sale_id: sale.id,
    version: sale.version,
    action: "void",
    account_id: "cash",
  });
  await post(request, "/backups/restore", {
    name: backup.name,
    confirmation: "恢复全部数据",
  });
  expect((await request.get("/api/me")).status()).toBe(401);
  await post(request, "/login", credentials);
  const restored = await (await request.get(`/api/sales/${sale.id}`)).json();
  expect([restored.status, restored.paid, restored.debt]).toEqual([
    "posted",
    50000,
    50000,
  ]);
  expect(await itemBalance(request, item.name)).toBe(90000);
  expect(
    await (await request.get(`/api/sales/attachments/${attachment.id}`)).body(),
  ).toEqual(png);
  const corrupted = "backup-corrupt-sales.zip";
  execFileSync("python3", [
    "-c",
    `import sys,os,zipfile,tempfile,sqlite3,json,hashlib
root,source,target,sid=sys.argv[1:]
with tempfile.TemporaryDirectory() as d:
 with zipfile.ZipFile(os.path.join(root,'backups',source)) as z:
  manifest=json.loads(z.read('manifest.json')); path=os.path.join(d,'db.sqlite'); open(path,'wb').write(z.read('inventory.sqlite'))
 db=sqlite3.connect(path); db.execute('UPDATE sales_cash SET amount=amount+9999999 WHERE sale_id=? AND amount>0',(sid,)); db.commit(); db.close()
 data=open(path,'rb').read(); manifest['sha256']=hashlib.sha256(data).hexdigest()
 with zipfile.ZipFile(os.path.join(root,'backups',target),'w') as z: z.writestr('inventory.sqlite',data); z.writestr('manifest.json',json.dumps(manifest))
`,
    process.env.ERP_E2E_DATA!,
    backup.name,
    corrupted,
    sale.id,
  ]);
  const rejected = await request.post("/api/backups/restore", {
    headers,
    data: { name: corrupted, confirmation: "恢复全部数据" },
  });
  expect(rejected.status()).toBe(400);
  expect((await (await request.get(`/api/sales/${sale.id}`)).json()).paid).toBe(
    50000,
  );
  expect(await itemBalance(request, item.name)).toBe(90000);
  // Produce a real pre-sales database/manifest without changing the live database.
  const legacy = "backup-legacy-sales.zip";
  execFileSync("python3", [
    "-c",
    `import sqlite3,sys,hashlib,json,zipfile,tempfile,os
root=sys.argv[1]
with tempfile.TemporaryDirectory() as d:
 src=sqlite3.connect(os.path.join(root,'inventory.sqlite')); dest=sqlite3.connect(os.path.join(d,'legacy.sqlite')); src.backup(dest); src.close()
 for (name,) in dest.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name='sales' OR name LIKE 'sales_%')").fetchall(): dest.execute('DROP TABLE '+name)
 dest.execute("DELETE FROM seaql_migrations WHERE version='sales_v1'"); dest.execute('UPDATE items SET precision=0'); dest.commit()
 schema=[r[0] for r in dest.execute("SELECT version FROM seaql_migrations WHERE version <> 'session_idle_v1' ORDER BY version")]; dest.close()
 data=open(os.path.join(d,'legacy.sqlite'),'rb').read()
 with zipfile.ZipFile(os.path.join(root,'backups',sys.argv[2]),'w') as z:
  z.writestr('inventory.sqlite',data); z.writestr('manifest.json',json.dumps(dict(format=1,created_at=0,sha256=hashlib.sha256(data).hexdigest(),schema=schema)))
`,
    process.env.ERP_E2E_DATA!,
    legacy,
  ]);
  await post(request, "/backups/restore", {
    name: legacy,
    confirmation: "恢复全部数据",
  });
  await post(request, "/login", credentials);
  expect((await request.get(`/api/sales/${sale.id}`)).status()).toBe(404);
  expect(await itemBalance(request, item.name)).toBe(90000);
  const stock = await (
    await request.get(`/api/items?q=${encodeURIComponent(item.name)}`)
  ).json();
  expect(stock.items[0].precision).toBe(3);
  await post(request, "/backups/restore", {
    name: backup.name,
    confirmation: "恢复全部数据",
  });
  await post(request, "/login", credentials);
  expect(
    (await request.get(`/api/sales/attachments/${attachment.id}`)).ok(),
  ).toBeTruthy();
});

test("长清单分页打印保留明细表头，草稿与重复打印不扣库存", async ({
  page,
  browserName,
}, testInfo) => {
  const { customer, item } = await fixture(page.request);
  const lines = [];
  for (let i = 0; i < 35; i++) {
    const material = await post(page.request, "/items", {
      name: `长清单-${i}-${randomUUID().slice(0, 8)}-客户可读规格及产品名称`,
      kind: "成品",
      unit: "个",
    });
    lines.push({ item_id: material.id, quantity: "1.25", price: "1.2345" });
  }
  const sale = await command(page.request, {
    action: "save",
    input: {
      customer_id: customer.id,
      type_id: "sale",
      business_date: date,
      discount_rate: "100",
      rounding: "0",
      lines,
      note: "长清单分页测试",
    },
  });
  await page.goto(`/?sale_print=${sale.id}#/sales`);
  await expect(
    page.getByRole("dialog", { name: "单据打印预览", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sales-print-sheet tbody tr")).toHaveCount(35);
  await expect(page.locator(".sales-print-sheet")).toContainText(
    "草稿 · 未扣库存",
  );
  await page.emulateMedia({ media: "print" });
  expect(
    await page
      .locator(".sales-print-sheet thead")
      .evaluate((e) => getComputedStyle(e).display),
  ).toBe("table-header-group");
  if (browserName === "chromium") {
    const pdf = await page.pdf({
      path: testInfo.outputPath("sales-multiple-pages.pdf"),
      format: "A4",
      preferCSSPageSize: true,
    });
    expect(
      (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
    ).toBeGreaterThanOrEqual(2);
  }
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => {
    (window as Window & { printCalls?: number }).printCalls = 0;
    window.print = () => {
      (window as unknown as { printCalls: number }).printCalls++;
    };
  });
  await page
    .getByRole("button", { name: "系统打印 / 保存 PDF", exact: true })
    .click();
  await page
    .getByRole("button", { name: "系统打印 / 保存 PDF", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { printCalls: number }).printCalls,
    ),
  ).toBe(2);
  expect(await itemBalance(page.request, item.name)).toBe(100000);
});

test("原生打印转到系统浏览器，自动登录并打开同一张单", async ({
  page,
  browser,
}) => {
  const { input } = await fixture(page.request);
  const sale = await command(page.request, { action: "confirm", input });
  await page.goto(`/?sale_print=${sale.id}#/sales`);
  await expect(page.locator(".sales-print-sheet")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args: { address?: string }) => {
          if (command === "open_web_address") {
            (window as Window & { printedAddress?: string }).printedAddress =
              args.address;
            return null;
          }
          return { enabled: false };
        },
      },
    };
  });
  // Trigger a render after installing the native bridge.
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  await page.getByRole("button", { name: "打印预览", exact: true }).click();
  await page
    .getByRole("button", { name: "在系统浏览器打印", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { printedAddress?: string }).printedAddress || "",
      ),
    )
    .toMatch(/^http:\/\/127\.0\.0\.1:4289/);
  const destination = await page.evaluate(
    () => (window as unknown as { printedAddress: string }).printedAddress,
  );
  const url = new URL(destination);
  expect(url.origin).toBe("http://127.0.0.1:4289");
  expect(url.searchParams.get("sale_print")).toBe(sale.id);
  expect(url.hash).toMatch(/^#\/browser-login\/[a-f0-9]{64}$/);
  const context = await browser.newContext();
  try {
    const external = await context.newPage();
    await external.goto(destination);
    await expect(
      external.getByRole("dialog", { name: "单据打印预览", exact: true }),
    ).toBeVisible();
    await expect(external.locator(".sales-print-sheet")).toContainText(
      sale.number,
    );
    expect(external.url()).not.toContain("browser-login");
  } finally {
    await context.close();
  }
});

test("部门业务员归属、跨部门校验、历史快照及业绩退货作废", async ({
  request,
  page,
}) => {
  const { item, input } = await fixture(request);
  const suffix = randomUUID().slice(0, 8);
  const department = await post(request, "/sales/catalog", {
    kind: "department",
    name: `销售一部-${suffix}`,
  });
  const other = await post(request, "/sales/catalog", {
    kind: "department",
    name: `销售二部-${suffix}`,
  });
  const salesperson = await post(request, "/sales/catalog", {
    kind: "salesperson",
    name: `小王-${suffix}`,
    data: { department_id: department.id },
  });
  const colleague = await post(request, "/sales/catalog", {
    kind: "salesperson",
    name: salesperson.name,
    data: { department_id: other.id },
  });
  const attributed = {
    ...input,
    department_id: department.id,
    salesperson_id: salesperson.id,
  };
  const invalid = await request.post("/api/sales/commands", {
    headers,
    data: {
      request_id: randomUUID(),
      action: "confirm",
      input: { ...attributed, salesperson_id: colleague.id },
    },
  });
  expect(invalid.status()).toBe(400);
  expect(await itemBalance(request, item.name)).toBe(100000);
  let sale = await command(request, { action: "confirm", input: attributed });
  expect(sale.department_name).toBe(department.name);
  expect(sale.salesperson_name).toBe(salesperson.name);
  expect(sale.actor_name).toBe("管理员");
  await page.goto("/#/sales");
  await page.getByLabel("搜索销售单").fill(department.name);
  await page.getByRole("button", { name: new RegExp(sale.number) }).click();
  await expect(
    page.getByText(`业绩归属：${department.name} → ${salesperson.name}`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打印预览", exact: true }).click();
  await expect(
    page.getByText(`业绩部门：${department.name}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`部门业务员：${salesperson.name}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  await post(request, "/sales/catalog", {
    ...department,
    name: `${department.name}-新名称`,
    active: false,
  });
  await post(request, "/sales/catalog", {
    ...salesperson,
    name: `${salesperson.name}-调任`,
    data: { department_id: other.id },
  });
  sale = await command(request, {
    action: "revise",
    sale_id: sale.id,
    version: sale.version,
    input: { ...attributed, note: "保留原归属" },
  });
  expect(sale.department_name).toBe(department.name);
  expect(sale.salesperson_name).toBe(salesperson.name);
  const fresh = await request.post("/api/sales/commands", {
    headers,
    data: { request_id: randomUUID(), action: "confirm", input: attributed },
  });
  expect(fresh.status()).toBe(400);
  sale = await command(request, {
    action: "revise",
    sale_id: sale.id,
    version: sale.version,
    input: { ...input, department_id: other.id, salesperson_id: colleague.id },
  });
  expect(await itemBalance(request, item.name)).toBe(90000);
  const revision = await (
    await request.get(`/api/sales/${sale.id}/revisions/${sale.version}`)
  ).json();
  expect(revision.before.department_id).toBe(department.id);
  expect(revision.after.department_id).toBe(other.id);
  sale = await command(request, {
    action: "pay",
    sale_id: sale.id,
    version: sale.version,
    account_id: "cash",
    amount: "50",
  });
  sale = await command(request, {
    action: "return",
    sale_id: sale.id,
    version: sale.version,
    lines: [{ item_id: item.id, quantity: "2" }],
  });
  let finance = await (await request.get("/api/sales/finance")).json();
  expect(
    finance.performance.find(
      (p: { salesperson_id: string }) => p.salesperson_id === colleague.id,
    ),
  ).toMatchObject({ count: 1, due: 80000, paid: 5000, debt: 75000 });
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page.getByRole("button", { name: "收款与欠款", exact: true }).click();
  const row = page
    .getByRole("table", { name: "业绩归属汇总" })
    .getByRole("row")
    .filter({ hasText: other.name });
  await expect(row).toContainText("¥800.00");
  sale = await command(request, {
    action: "void",
    sale_id: sale.id,
    version: sale.version,
    account_id: "cash",
  });
  finance = await (await request.get("/api/sales/finance")).json();
  expect(
    finance.performance.some(
      (p: { salesperson_id: string }) => p.salesperson_id === colleague.id,
    ),
  ).toBe(false);
  expect(await itemBalance(request, item.name)).toBe(100000);
});

test("账户筛选对账与 CSV 退款保持数值", async ({ request, page }) => {
  const { input } = await fixture(request);
  const account = await post(request, "/sales/catalog", {
    kind: "account",
    name: `对账-${randomUUID().slice(0, 8)}`,
  });
  let sale = await command(request, { action: "confirm", input });
  sale = await command(request, {
    action: "pay",
    sale_id: sale.id,
    version: sale.version,
    account_id: account.id,
    amount: "50",
  });
  await command(request, {
    action: "refund",
    sale_id: sale.id,
    version: sale.version,
    account_id: account.id,
    amount: "20",
  });
  await page.goto("/#/sales");
  await page.getByRole("button", { name: "收款与欠款", exact: true }).click();
  await chooseSelect(
    page.getByRole("combobox", { name: "筛选账户", exact: false }),
    account.id,
  );
  await expect(
    page.getByText("筛选净收款：¥30.00", { exact: true }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出对账 CSV", exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain('"-20.00"');
  expect(csv).not.toContain('"\'-20.00"');
  expect(csv).toContain('"50.00"');
});
