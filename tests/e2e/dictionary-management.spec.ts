import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
const tag = () => `字典-${randomUUID().slice(0, 8)}`;
async function post(request: APIRequestContext, path: string, data: object) {
  const r = await request.post("/api" + path, { headers, data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function list(request: APIRequestContext) {
  return (await (await request.get("/api/material-options")).json()).items as {
    id: string;
    field: string;
    name: string;
    version: number;
    active: boolean;
    sort: number;
    note: string;
    source: string;
    last_used_at: number | null;
    usage_count: number | null;
  }[];
}
async function catalog(request: APIRequestContext, kind: string) {
  return (
    (await (await request.get("/api/sales/catalog")).json()).items as {
      id: string;
      name: string;
      kind: string;
      version: number;
      data: { sort: number; account_type?: string };
    }[]
  )
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.data.sort - b.data.sort || a.name.localeCompare(b.name));
}
async function preview(request: APIRequestContext, mode: string, csv: string) {
  const r = await request.post(`/api/imports/${mode}/preview`, {
    headers,
    multipart: {
      file: {
        name: "字典.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("候选状态、来源与最近使用真实记录，改名停用和删除不回写物料", async ({
  page,
}) => {
  const name = tag();
  const option = await post(page.request, "/material-options", {
    field: "spec",
    name,
    sort: 7,
    note: "说明",
  });
  let row = (await list(page.request)).find((r) => r.id === option.id)!;
  expect(row).toMatchObject({
    active: true,
    sort: 7,
    note: "说明",
    source: "manual",
    last_used_at: null,
    usage_count: 0,
  });
  const item = await post(page.request, "/items", {
    name,
    kind: `分类-${name}`,
    unit: "个",
    spec: name,
  });
  row = (await list(page.request)).find((r) => r.id === option.id)!;
  expect(row.usage_count).toBe(1);
  expect(row.last_used_at).toBeGreaterThan(0);
  const automatic = (await list(page.request)).find(
    (r) => r.name === `分类-${name}`,
  )!;
  expect(automatic.source).toBe("auto");
  expect(automatic.usage_count).toBe(1);
  await post(page.request, "/material-options", { ...row, active: false });
  const stopped = (await list(page.request)).find((r) => r.id === option.id)!;
  expect(stopped.last_used_at).toBe(row.last_used_at);
  const denied = await page.request.post("/api/items", {
    headers,
    data: { name: `拒绝-${name}`, kind: "其他", unit: "个", spec: name },
  });
  expect(denied.status()).toBe(400);
  expect((await denied.json()).error).toContain("已停用");
  const items = (
    await (await page.request.get(`/api/items?ids=${item.id}`)).json()
  ).items;
  const edit = await page.request.put(`/api/items/${item.id}`, {
    headers,
    data: { ...items[0], name: `更名-${name}`, minimum: null },
  });
  expect(edit.ok(), await edit.text()).toBe(true);
  // Omitting the new fields in an old client must preserve metadata.
  await post(page.request, "/material-options", {
    id: stopped.id,
    field: "spec",
    name: `${name}-新`,
    version: stopped.version,
  });
  const renamed = (await list(page.request)).find((r) => r.id === option.id)!;
  expect(renamed).toMatchObject({
    active: false,
    sort: 7,
    note: "说明",
    source: "manual",
    usage_count: 0,
  });
  expect(
    (await (await page.request.get(`/api/items?ids=${item.id}`)).json())
      .items[0].spec,
  ).toBe(name);
  expect(
    (
      await page.request.delete(
        `/api/material-options/${renamed.id}?version=${renamed.version}`,
        { headers },
      )
    ).ok(),
  ).toBe(true);
  expect(
    (await (await page.request.get(`/api/items?ids=${item.id}`)).json())
      .items[0].spec,
  ).toBe(name);
});

test("候选与账户新旧模板兼容，元数据导出和账户类型保存完整", async ({
  page,
}) => {
  const name = tag();
  for (const [mode, csv] of [
    ["spec", `规格值\n${name}-旧\n`],
    ["spec", `规格值,状态,排序,说明\n${name}-新,停用,8,导入说明\n`],
    ["account", `收款账户,状态,排序,备注\n${name}-旧账户,启用,2,旧表格\n`],
    [
      "account",
      `收款账户,账户类型,状态,排序,备注\n${name}-新账户,银行,启用,3,新表格\n`,
    ],
  ]) {
    const plan = await preview(page.request, mode, csv);
    expect(plan.errors).toEqual([]);
    await post(page.request, `/imports/${plan.id}/commit`, {});
  }
  const row = (await list(page.request)).find((r) => r.name === `${name}-新`)!;
  expect(row).toMatchObject({
    active: false,
    sort: 8,
    note: "导入说明",
    source: "import",
    last_used_at: null,
    usage_count: 0,
  });
  expect(
    (await list(page.request)).find((r) => r.name === `${name}-旧`),
  ).toMatchObject({ active: true, sort: 0, note: "", source: "import" });
  const csv = await (
    await page.request.get("/api/export/spec?format=csv")
  ).text();
  expect(csv).toContain(`${name}-新,停用,8,导入说明`);
  const account = (await catalog(page.request, "account")).find(
    (r) => r.name === `${name}-新账户`,
  )!;
  expect(account.data.account_type).toBe("银行");
  const oldData = { ...account.data };
  delete oldData.account_type;
  await post(page.request, "/sales/catalog", { ...account, data: oldData });
  expect(
    (await catalog(page.request, "account")).find((r) => r.id === account.id)!
      .data.account_type,
  ).toBe("银行");
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "收款账户", exact: true }).click();
  const tr = page.getByRole("row").filter({ hasText: `${name}-新账户` });
  await expect(tr).toContainText("银行");
  await tr.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByLabel("账户类型", { exact: false }).fill("对公银行");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(tr).toContainText("对公银行");
});

test("字典排序核对完整清单及版本，过期/重复/跨类别请求不改变顺序", async ({
  page,
}) => {
  const name = tag();
  for (const n of ["甲", "乙", "丙"])
    await post(page.request, "/material-options", {
      field: "unit",
      name: `${name}${n}`,
    });
  let rows = (await list(page.request)).filter((r) => r.field === "unit");
  const entries = rows.map(({ id, version }) => ({ id, version })).reverse();
  await post(page.request, "/catalog-order", { kind: "unit", entries });
  let sorted = (await list(page.request)).filter((r) => r.field === "unit");
  expect(sorted.map((r) => r.id)).toEqual(entries.map((r) => r.id));
  for (const invalid of [
    entries,
    entries.slice(1),
    [...entries.slice(0, -1), entries[0]],
  ])
    expect(
      (
        await page.request.post("/api/catalog-order", {
          headers,
          data: { kind: "unit", entries: invalid },
        })
      ).status(),
    ).toBe(409);
  expect(
    (await list(page.request))
      .filter((r) => r.field === "unit")
      .map((r) => r.id),
  ).toEqual(sorted.map((r) => r.id));
  for (const kind of ["type", "department", "salesperson", "account"]) {
    if (kind === "department")
      await post(page.request, "/sales/catalog", { kind, name });
    if (kind === "salesperson") {
      const department = (await catalog(page.request, "department")).find(
        (r) => r.name === name,
      )!;
      await post(page.request, "/sales/catalog", {
        kind,
        name,
        data: { department_id: department.id },
      });
    }
    const before = await catalog(page.request, kind);
    const order = before.map(({ id, version }) => ({ id, version })).reverse();
    await post(page.request, "/catalog-order", { kind, entries: order });
    expect((await catalog(page.request, kind)).map((r) => r.id)).toEqual(
      order.map((r) => r.id),
    );
  }
  const conflict = await page.request.post("/api/catalog-order", {
    headers,
    data: {
      kind: "account",
      entries: sorted.map(({ id, version }) => ({ id, version })),
    },
  });
  expect(conflict.status()).toBe(409);
});

test("字典拖拽、键盘上移下移和手机按钮可用，停用后物料表单不再提示", async ({
  page,
}) => {
  const name = tag();
  for (let i = 0; i < 3; i++)
    await post(page.request, "/material-options", {
      field: "spec",
      name: `${name}-${i}`,
      sort: 9990 + i,
    });
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "常用规格", exact: true }).click();
  let rows = page
    .getByRole("table", { name: "常用规格列表" })
    .locator("tbody tr");
  const first = rows.filter({ hasText: `${name}-0` });
  const third = rows.filter({ hasText: `${name}-2` });
  await first
    .getByRole("button", { name: `下移${name}-0`, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    first.getByRole("button", { name: `上移${name}-0`, exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("status").filter({ hasText: `已将“${name}-0”` }),
  ).toBeVisible();
  await third.locator(".dictionary-grip").dragTo(first);
  await expect
    .poll(async () =>
      (await list(page.request))
        .filter((r) => r.field === "spec" && r.name.startsWith(name))
        .map((r) => r.name),
    )
    .toEqual([`${name}-1`, `${name}-2`, `${name}-0`]);
  await page.setViewportSize({ width: 320, height: 568 });
  await third
    .getByRole("button", { name: `上移${name}-2`, exact: true })
    .click();
  await expect
    .poll(async () =>
      (await list(page.request))
        .filter((r) => r.field === "spec" && r.name.startsWith(name))
        .map((r) => r.name),
    )
    .toEqual([`${name}-2`, `${name}-1`, `${name}-0`]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await third.getByRole("button", { name: "停用", exact: true }).click();
  await expect(
    third.getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "添加物料", exact: true }).click();
  await page
    .getByRole("combobox", { name: "规格 选填", exact: true })
    .fill(name);
  await expect(
    page.getByRole("option", { name: `${name}-2`, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: `${name}-1`, exact: true }),
  ).toBeVisible();
});

test("候选与排序权限独立，只有资料权限的账号不读取物料引用数", async ({
  page,
  browser,
}) => {
  const name = tag();
  const role = await post(page.request, "/roles", {
    name,
    permissions: ["options.read", "options.create"],
  });
  const username = `dict_${randomUUID().slice(0, 8)}`;
  await post(page.request, "/users", {
    username,
    name,
    password: "Dictionary-test-2026",
    role: role.id,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    await post(context.request, "/login", {
      username,
      password: "Dictionary-test-2026",
    });
    const created = await post(context.request, "/material-options", {
      field: "spec",
      name,
    });
    const rows = await list(context.request);
    expect(rows.every((r) => r.usage_count === null)).toBe(true);
    const row = rows.find((r) => r.id === created.id)!;
    expect(
      (
        await context.request.post("/api/material-options", {
          headers,
          data: { ...row, active: false },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post("/api/catalog-order", {
          headers,
          data: {
            kind: "spec",
            entries: rows.filter((r) => r.field === "spec"),
          },
        })
      ).status(),
    ).toBe(403);
    const p = await context.newPage();
    await p.goto("/#/catalog");
    await expect(
      p.getByRole("button", { name: `下移${name}`, exact: true }),
    ).toHaveCount(0);
    const itemRole = await post(page.request, "/roles", {
      name: `${name}-物料查看`,
      permissions: ["items.read"],
    });
    const itemUsername = `item_${randomUUID().slice(0, 8)}`;
    await post(page.request, "/users", {
      username: itemUsername,
      name: `${name}-物料查看`,
      password: "Dictionary-test-2026",
      role: itemRole.id,
    });
    await post(context.request, "/login", {
      username: itemUsername,
      password: "Dictionary-test-2026",
    });
    const suggestions = await list(context.request);
    expect(suggestions.find((r) => r.id === created.id)).toMatchObject({
      name,
      field: "spec",
      active: true,
    });
    for (const suggestion of suggestions)
      expect(Object.keys(suggestion).sort()).toEqual(
        ["id", "field", "name", "version", "active"].sort(),
      );
  } finally {
    await context.close();
  }
});

// Use a real prior schema backup and restore through the production staging path.
test("候选管理完整备份恢复，旧五列备份升级不伪造来源时间且保留ID版本", async ({
  page,
}) => {
  const name = tag();
  const created = await post(page.request, "/material-options", {
    field: "spec",
    name,
    sort: 5,
    note: "恢复说明",
    active: false,
  });
  const original = (await list(page.request)).find((r) => r.id === created.id)!;
  const backup = await post(page.request, "/backups", {});
  await post(page.request, "/material-options", {
    ...original,
    note: "被改过",
  });
  await post(page.request, "/backups/restore", {
    name: backup.name,
    confirmation: "恢复全部数据",
  });
  await post(page.request, "/login", credentials);
  expect((await list(page.request)).find((r) => r.id === created.id)).toEqual(
    original,
  );
  const root = process.env.ERP_E2E_DATA!;
  const filename = `legacy-options-${randomUUID()}.zip`;
  execFileSync("python3", [
    "-c",
    `import sys,os,sqlite3,zipfile,tempfile,json,hashlib
root,filename=sys.argv[1:]
with tempfile.TemporaryDirectory() as temp:
 path=os.path.join(temp,'old.sqlite'); source=sqlite3.connect(os.path.join(root,'inventory.sqlite')); dest=sqlite3.connect(path); source.backup(dest); source.close()
 for column in ['active','sort','note','source','last_used_at']: dest.execute('ALTER TABLE material_options DROP COLUMN '+column)
 dest.execute("DELETE FROM seaql_migrations WHERE version='material_options_meta_v1'"); dest.commit()
 schema=[r[0] for r in dest.execute("SELECT version FROM seaql_migrations WHERE version <> 'session_idle_v1' ORDER BY version")]; dest.close(); data=open(path,'rb').read()
 with zipfile.ZipFile(os.path.join(root,'backups',filename),'w') as z: z.writestr('inventory.sqlite',data); z.writestr('manifest.json',json.dumps(dict(format=1,created_at=0,sha256=hashlib.sha256(data).hexdigest(),schema=schema)))
`,
    root,
    filename,
  ]);
  await post(page.request, "/backups/restore", {
    name: filename,
    confirmation: "恢复全部数据",
  });
  await post(page.request, "/login", credentials);
  const restored = (await list(page.request)).find((r) => r.id === created.id)!;
  expect(restored).toMatchObject({
    id: original.id,
    name: original.name,
    version: original.version,
    active: true,
    sort: 0,
    note: "",
    source: "",
    last_used_at: null,
  });
});
