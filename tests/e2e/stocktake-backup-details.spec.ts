import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chooseSelect } from "./controls";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
async function post(r: APIRequestContext, path: string, data: object) {
  const response = await r.post(`/api${path}`, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const directory = () =>
  realpathSync(join(process.env.ERP_E2E_DATA!, "backups"));
const python = (script: string, ...args: string[]) =>
  execFileSync("python3", ["-c", script, ...args], { encoding: "utf8" });
test.beforeEach(async ({ page }) => {
  const r = page.request;
  if (!(await (await r.get("/api/status")).json()).initialized)
    await post(r, "/setup", { ...credentials, name: "管理员" });
  await post(r, "/login", credentials);
});

test("清点按真实分类筛选，删除候选后旧分类仍可查，跨页跨分类保留选择并排除锁定物料", async ({
  page,
}) => {
  const r = page.request,
    tag = randomUUID().slice(0, 8);
  const kind = `清点甲${tag}`,
    secondKind = `清点乙${tag}`;
  for (let i = 0; i < 52; i++)
    await post(r, "/items", {
      name: `${tag}-${String(i).padStart(2, "0")}`,
      kind,
      unit: "个",
    });
  const other = await post(r, "/items", {
    name: `${tag}-乙`,
    kind: secondKind,
    unit: "个",
  });
  const locked = await post(r, "/items", {
    name: `${tag}-锁定`,
    kind: secondKind,
    unit: "个",
  });
  const lock = await post(r, "/stocktakes", { item_ids: [locked.id] });
  const choices = (await (await r.get("/api/material-options")).json()).items;
  const option = choices.find(
    (o: { field: string; name: string }) =>
      o.field === "kind" && o.name === kind,
  );
  expect(
    (
      await r.delete(
        `/api/material-options/${option.id}?version=${option.version}`,
        { headers },
      )
    ).ok(),
  ).toBe(true);
  const firstPageItem = (
    await (
      await r.get(`/api/items?kind=${encodeURIComponent(kind)}&page=1`)
    ).json()
  ).items[0];
  const secondPageItem = (
    await (
      await r.get(`/api/items?kind=${encodeURIComponent(kind)}&page=2`)
    ).json()
  ).items[0];
  await page.goto("/#/stocktakes");
  await page.getByRole("button", { name: "开始清点", exact: true }).click();
  const d = page.getByRole("dialog"),
    select = d.getByRole("combobox", { name: "物料分类", exact: false });
  await chooseSelect(select, kind);
  await expect(d.getByRole("checkbox")).toHaveCount(50);
  await d
    .getByRole("checkbox", { name: firstPageItem.name, exact: false })
    .check();
  await d.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(d.getByRole("checkbox")).toHaveCount(2);
  await d
    .getByRole("checkbox", { name: secondPageItem.name, exact: false })
    .check();
  await chooseSelect(select, secondKind);
  await expect(d.getByRole("checkbox")).toHaveCount(1);
  await expect(d.locator(".pagination")).toContainText("第 1 页");
  await d.getByRole("checkbox", { name: `${tag}-乙`, exact: false }).check();
  await chooseSelect(select, kind);
  await expect(
    d.getByRole("checkbox", { name: firstPageItem.name, exact: false }),
  ).toBeChecked();
  await page.setViewportSize({ width: 320, height: 568 });
  const start = d.getByRole("button", {
    name: "开始清点 3 种物料",
    exact: true,
  });
  await expect(start).toBeInViewport();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/stocktakes") &&
      response.request().method() === "POST",
  );
  await start.click();
  const count = await (await created).json();
  const all = (await (await r.get("/api/stocktakes")).json()).items;
  const result = all.find((c: { id: string }) => c.id === count.id);
  expect(result.lines.map((l: { name: string }) => l.name).sort()).toEqual(
    [firstPageItem.name, secondPageItem.name, `${tag}-乙`].sort(),
  );
  expect(
    result.lines.some((l: { item_id: string }) => l.item_id === other.id),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await post(r, `/stocktakes/${count.id}/finish`, { confirm: false });
  await post(r, `/stocktakes/${lock.id}/finish`, { confirm: false });
});

test("备份展示真实快照时间、方式、图片和位置，旧清单与坏文件隔离且恢复兼容", async ({
  page,
}) => {
  const r = page.request,
    tag = randomUUID().slice(0, 8);
  const item = await post(r, "/items", {
    name: `凭证${tag}`,
    kind: "成品",
    unit: "个",
  });
  await post(r, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: item.id, quantity: "10" }],
  });
  const customer = await post(r, "/sales/catalog", {
    kind: "customer",
    name: tag,
  });
  const sale = await post(r, "/sales/commands", {
    request_id: randomUUID(),
    action: "confirm",
    input: {
      customer_id: customer.id,
      type_id: "sale",
      business_date: "2026-10-09",
      lines: [{ item_id: item.id, quantity: "1", price: "10" }],
    },
  });
  const before = await post(r, "/backups", {});
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  const upload = async () => {
    const response = await r.post(`/api/sales/${sale.id}/attachments`, {
      headers,
      multipart: {
        file: { name: "凭证.png", mimeType: "image/png", buffer: png },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const attachment = await upload();
  const backup = await post(r, "/backups", {});
  expect(backup.source).toBe("manual");
  expect(backup.photo_count).toBe(before.photo_count + 1);
  const actual = JSON.parse(
    python(
      `import zipfile,sqlite3,tempfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z, tempfile.TemporaryDirectory() as d:
 m=json.loads(z.read('manifest.json'));z.extract('inventory.sqlite',d)
 db=sqlite3.connect(d+'/inventory.sqlite');n=db.execute('select count(*) from sales_attachments').fetchone()[0];db.close()
 print(json.dumps({'manifest':m,'count':n}))`,
      join(directory(), backup.name),
    ),
  );
  expect(actual.count).toBe(backup.photo_count);
  expect(actual.manifest.photo_count).toBe(actual.count);
  expect(actual.manifest.created_at).toBe(backup.snapshot_at);
  expect(
    (
      await r.delete(`/api/sales/attachments/${attachment.id}`, { headers })
    ).ok(),
  ).toBe(true);
  await upload();
  const later = await post(r, "/backups", {});
  expect(later.photo_count).toBe(backup.photo_count + 1); // Deleted image bytes remain in backup history.
  const legacy = `backup-legacy-${tag}.zip`,
    corrupt = `backup-corrupt-${tag}.zip`,
    badDate = `backup-invalid-date-${tag}.zip`,
    aged = `backup-aged-${tag}.zip`;
  python(
    `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as old, zipfile.ZipFile(sys.argv[2],'w') as new:
 for name in old.namelist():
  data=old.read(name)
  if name=='manifest.json':
   m=json.loads(data);m.pop('source',None);m.pop('photo_count',None);data=json.dumps(m).encode()
  new.writestr(name,data)`,
    join(directory(), backup.name),
    join(directory(), legacy),
  );
  writeFileSync(join(directory(), corrupt), "not a zip archive");
  python(
    `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as old, zipfile.ZipFile(sys.argv[2],'w') as new:
 for name in old.namelist():
  data=old.read(name)
  if name=='manifest.json':
   m=json.loads(data);m['created_at']=9000000000000000000;data=json.dumps(m).encode()
  new.writestr(name,data)`,
    join(directory(), backup.name),
    join(directory(), badDate),
  );
  copyFileSync(join(directory(), backup.name), join(directory(), aged));
  utimesSync(
    join(directory(), aged),
    new Date("2020-01-01"),
    new Date("2020-01-01"),
  );
  const listed = (await (await r.get("/api/backups")).json()).items;
  const byName = (name: string) =>
    listed.find((b: { name: string }) => b.name === name);
  expect(byName(backup.name)).toMatchObject({
    photo_count: backup.photo_count,
    source: "manual",
    snapshot_at: backup.snapshot_at,
    metadata_error: false,
  });
  expect(byName(backup.name).path).toBe(join(directory(), backup.name));
  expect(byName(legacy)).toMatchObject({
    photo_count: null,
    source: null,
    snapshot_at: backup.snapshot_at,
    metadata_error: false,
  });
  expect(byName(corrupt).metadata_error).toBe(true);
  expect(byName(badDate)).toMatchObject({
    metadata_error: true,
    snapshot_at: null,
  });
  expect(byName(aged).snapshot_at).toBe(backup.snapshot_at);
  expect(byName(aged).created_at).toBe(new Date("2020-01-01").getTime());
  await page.goto("/#/settings");
  const table = page.getByRole("table", { name: "备份记录" });
  const row = table.getByRole("row").filter({ hasText: backup.name });
  await expect(row.locator('[data-label="凭证图片"]')).toHaveText(
    `${backup.photo_count} 张`,
  );
  await expect(row.locator('[data-label="方式"]')).toHaveText("手动");
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: legacy })
      .locator('[data-label="凭证图片"]'),
  ).toHaveText("未知");
  await expect(
    table.getByRole("row").filter({ hasText: corrupt }),
  ).toContainText("无法读取备份信息");
  await page.setViewportSize({ width: 320, height: 568 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    )
    .toBe(true);
  await table
    .getByRole("row")
    .filter({ hasText: corrupt })
    .getByRole("button", { name: `恢复备份 ${corrupt}`, exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "此备份生成时间未知，文件修改时间为",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await row
    .getByRole("button", { name: `恢复备份 ${backup.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await post(r, "/backups", {});
  expect(
    (await (await r.get("/api/backups")).json()).items.some(
      (b: { name: string }) => b.name === aged,
    ),
  ).toBe(false);
  await post(r, "/backups/restore", {
    name: legacy,
    confirmation: "恢复全部数据",
  });
  await post(r, "/login", credentials);
  const restored = (await (await r.get("/api/backups")).json()).items;
  expect(restored.some((b: { source: string }) => b.source === "restore")).toBe(
    true,
  );
  expect((await r.get(`/api/sales/attachments/${attachment.id}`)).ok()).toBe(
    true,
  );
});

test("自动与离线维护备份记录真实来源，管理员以外不能读取备份位置", async ({
  page,
  browser,
}) => {
  test.setTimeout(100_000);
  const r = page.request;
  const backup = await post(r, "/backups", {});
  const offline = mkdtempSync(join(tmpdir(), "erp-offline-metadata-"));
  python(
    "import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extract('inventory.sqlite',sys.argv[2])",
    join(directory(), backup.name),
    offline,
  );
  execFileSync(
    resolve("target/debug/easy-erp-server"),
    ["--data-dir", offline, "--backup-only"],
    { windowsHide: true },
  );
  const name = readdirSync(join(offline, "backups")).find((name) =>
    name.endsWith(".zip"),
  )!;
  expect(
    JSON.parse(
      python(
        "import zipfile,sys,json\nwith zipfile.ZipFile(sys.argv[1]) as z:print(z.read('manifest.json').decode())",
        join(offline, "backups", name),
      ),
    ).source,
  ).toBe("maintenance");
  const started = Date.now();
  python(
    "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute(\"update settings set value='0' where id='backup_last_success'\");c.commit();c.close()",
    join(process.env.ERP_E2E_DATA!, "inventory.sqlite"),
  );
  await expect
    .poll(
      async () =>
        (await (await r.get("/api/backups")).json()).items.some(
          (b: { source: string; snapshot_at: number }) =>
            b.source === "automatic" && b.snapshot_at >= started,
        ),
      { timeout: 70_000, intervals: [1000] },
    )
    .toBe(true);
  const username = `reader-${randomUUID().slice(0, 8)}`;
  await post(r, "/users", {
    username,
    name: username,
    password: "Reader-test-2026",
    role: "viewer",
    active: true,
  });
  const context = await browser.newContext();
  try {
    await post(context.request, "/login", {
      username,
      password: "Reader-test-2026",
    });
    expect((await context.request.get("/api/backups")).status()).toBe(403);
  } finally {
    await context.close();
  }
});

test("清点分类加载失败不显示旧分类候选，恢复查询后保留已选物料", async ({
  page,
}) => {
  const r = page.request,
    tag = randomUUID().slice(0, 8);
  const first = await post(r, "/items", {
    name: `甲${tag}`,
    kind: `甲类${tag}`,
    unit: "个",
  });
  await post(r, "/items", { name: `乙${tag}`, kind: `乙类${tag}`, unit: "个" });
  await page.goto("/#/stocktakes");
  await page.getByRole("button", { name: "开始清点", exact: true }).click();
  const d = page.getByRole("dialog"),
    select = d.getByRole("combobox", { name: "物料分类", exact: false });
  await chooseSelect(select, `甲类${tag}`);
  await d.getByRole("checkbox", { name: `甲${tag}`, exact: false }).check();
  await page.route("**/api/items?*", (route) =>
    new URL(route.request().url()).searchParams.get("kind") === `乙类${tag}`
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "分类查询暂不可用，请重试。" }),
        })
      : route.continue(),
  );
  await chooseSelect(select, `乙类${tag}`);
  await expect(d.getByRole("alert")).toContainText("分类查询暂不可用");
  await expect(d.getByRole("checkbox")).toHaveCount(0);
  await page.unroute("**/api/items?*");
  await chooseSelect(select, `甲类${tag}`);
  await expect(
    d.getByRole("checkbox", { name: `甲${tag}`, exact: false }),
  ).toBeChecked();
  const saved = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/stocktakes") &&
      res.request().method() === "POST",
  );
  await d
    .getByRole("button", { name: "开始清点 1 种物料", exact: true })
    .click();
  const sid = (await (await saved).json()).id;
  const row = (await (await r.get("/api/stocktakes")).json()).items.find(
    (x: { id: string }) => x.id === sid,
  );
  expect(row.lines.map((x: { item_id: string }) => x.item_id)).toEqual([
    first.id,
  ]);
  await post(r, `/stocktakes/${sid}/finish`, { confirm: false });
});
