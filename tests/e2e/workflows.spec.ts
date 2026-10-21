import { chooseSelect } from "./controls";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const headers = { "X-ERP-Request": "1" };
const password = "Factory-test-2026";

test("物料分页前后切换与搜索重置页码", async ({ page }) => {
  const rows = Array.from(
    { length: 52 },
    (_, i) => `PAGE-${i},翻页验收${String(i).padStart(2, "0")},,其他,个,0,,`,
  );
  const previewResponse = await page.request.post(
    "/api/imports/items/preview",
    {
      headers,
      multipart: {
        file: {
          name: "分页.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "物料编码,物料名称,规格,类型,单位,小数位数,条码,最低库存\n" +
              rows.join("\n") +
              "\n",
          ),
        },
      },
    },
  );
  expect(previewResponse.ok()).toBeTruthy();
  const preview = await previewResponse.json();
  expect(preview.errors).toHaveLength(0);
  expect(
    (
      await page.request.post(`/api/imports/${preview.id}/commit`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBeTruthy();
  await navigate(page, "物料");
  const inventorySearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/items" &&
      url.searchParams.get("q") === "翻页验收" &&
      url.searchParams.get("page") === "1"
    );
  });
  await page.getByLabel("搜索物料", { exact: true }).fill("翻页验收");
  await inventorySearch;
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByLabel("搜索物料", { exact: true }).fill("翻页验收00");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator(".pagination")).toContainText("第 1 页");
  await navigate(page, "清点");
  await page.getByRole("button", { name: "开始清点", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const searchedMaterials = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/items" &&
      url.searchParams.get("q") === "翻页验收" &&
      url.searchParams.get("page") === "1"
    );
  });
  await page.getByLabel("查找清点物料", { exact: false }).fill("翻页验收");
  await searchedMaterials;
  await expect(dialog.locator(".selection-list")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(dialog.locator(".selection-list [role=checkbox]")).toHaveCount(
    50,
  );
  await dialog.locator(".selection-list [role=checkbox]").first().check();
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(dialog.locator(".selection-list [role=checkbox]")).toHaveCount(
    2,
  );
  await dialog.locator(".selection-list [role=checkbox]").first().check();
  await expect(dialog.locator(".pagination")).toContainText("已选 2 种");
  await dialog.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(dialog.locator(".selection-list [role=checkbox]")).toHaveCount(
    50,
  );
  await expect(
    dialog.locator(".selection-list [role=checkbox]").first(),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
});
const navigate = (page: Page, name: string) =>
  page.getByRole("navigation", { name: /^(主要导航|更多功能)$/ }).getByRole("link", { name, exact: true }).click();

test("断网提交保留表单，重试成功且只入账一次", async ({ page }) => {
  const created = await page.request.post("/api/items", {
    headers,
    data: { name: "网络恢复验收", kind: "其他", unit: "个", precision: 0 },
  });
  expect(created.ok()).toBeTruthy();
  await page.getByRole("link", { name: /我要入库/ }).click();
  await page.getByRole("button", { name: "添加一行", exact: true }).click();
  await page.getByLabel("查找要收发的物料").fill("网络恢复验收");
  await page
    .getByRole("button", { name: "选择网络恢复验收", exact: true })
    .click();
  await page.getByLabel(/入库数量/).fill("3");
  await page.route("**/api/movements", (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("已填写内容保留");
  await expect(page.getByLabel(/入库数量/)).toHaveValue("3");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "入库已完成" })).toBeVisible();
  expect(
    (await (await page.request.get("/api/items?q=网络恢复验收")).json())
      .items[0].balance,
  ).toBe(3000);
});

test.beforeEach(async ({ page }) => {
  const status = await (await page.request.get("/api/status")).json();
  if (!status.initialized) {
    expect(
      (
        await page.request.post("/api/setup", {
          headers,
          data: {
            username: "manager",
            password,
            name: "验收管理员",
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (
      await page.request.post("/api/login", {
        headers,
        data: { username: "manager", password },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: /^(主要导航|更多功能)$/ })).toBeVisible();
});

test("物料新增、重复编码校验、修改、搜索、类型与低库存筛选", async ({
  page,
}) => {
  await navigate(page, "物料");
  await page.getByRole("button", { name: "添加物料", exact: true }).click();
  await page.getByLabel("物料名称", { exact: false }).fill("验收专用物料");
  await chooseSelect(page.getByLabel("物料类型 选填", { exact: true }), "成品");
  await page.getByLabel("最低库存提醒", { exact: false }).fill("5");
  await page.getByText("更多选项：物料编码、条码").click();
  await page.getByLabel("物料编码 选填", { exact: true }).fill("UI-ACCEPT");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("搜索物料", { exact: true }).fill("UI-ACCEPT");
  await expect(page.getByRole("cell", { name: /^验收专用物料/ })).toBeVisible();
  await page
    .getByRole("button", { name: "修改验收专用物料", exact: true })
    .click();
  await page.getByLabel("规格 选填", { exact: true }).fill("新版规格");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("cell", { name: /新版规格/ })).toBeVisible();
  await chooseSelect(page.getByLabel("筛选物料类型"), "原材料");
  await expect(
    page.getByText("没有符合筛选条件的物料，请调整搜索或状态。"),
  ).toBeVisible();
  await chooseSelect(page.getByLabel("筛选物料类型"), "成品");
  await page.getByRole("button", { name: "低库存", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "库存不足", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加物料", exact: true }).click();
  await page.getByLabel("物料名称", { exact: false }).fill("重复编码不应保存");
  await page.getByText("更多选项：物料编码、条码").click();
  await page.getByLabel("物料编码 选填", { exact: true }).fill("UI-ACCEPT");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "编码",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

test("全部收发用途、数量限制、移除物料、连续登记、记录和操作审计", async ({
  page,
}) => {
  // Eight complete stock flows plus ledger and audit checks share this budget.
  test.setTimeout(90_000);
  const added = await page.request.post("/api/items", {
    headers,
    data: { name: "收发用途验收", kind: "原材料", unit: "公斤", precision: 2 },
  });
  expect(added.ok()).toBeTruthy();
  const { id } = await added.json();
  let balance = 0;
  for (const [kind, amount, delta] of [
    ["opening", "10.00", 10000],
    ["receipt", "2.50", 2500],
    ["finished", "1.00", 1000],
    ["return_in", "1.00", 1000],
    ["issue", "1.00", -1000],
    ["shipment", "1.00", -1000],
    ["return_out", "1.00", -1000],
    ["scrap", "0.50", -500],
  ] as const) {
    const incoming = delta > 0;
    await navigate(page, "工作台");
    await page
      .getByRole("link", { name: incoming ? /我要入库/ : /我要出库/ })
      .click();
    const results = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/items" &&
        url.searchParams.get("q") === "收发用途验收"
      );
    });
    await page.getByRole("button", { name: "添加一行", exact: true }).click();
    await page.getByLabel("查找要收发的物料").fill("收发用途验收");
    await results;
    await expect(
      page.getByRole("button", { name: "选择收发用途验收", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "选择收发用途验收", exact: true })
      .click();
    await page.getByRole("button", { name: "移除收发用途验收" }).click();
    await expect(
      page.getByText("点击“添加一行”，选择物料后填写本次数量。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加一行", exact: true }).click();
    await page.getByLabel("查找要收发的物料").fill("收发用途验收");
    await page
      .getByRole("button", { name: "选择收发用途验收", exact: true })
      .click();
    await chooseSelect(page.getByLabel("用途 必填", { exact: true }), kind);
    await page
      .getByLabel("备注或原因", { exact: false })
      .fill("验收原因：核对实际库存收发");
    const quantity = page.getByLabel(incoming ? /入库数量/ : /出库数量/);
    if (kind === "opening") {
      await quantity.fill("1.234");
      await page.getByRole("button", { name: "确认入库", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await quantity.fill(amount);
    await page
      .getByRole("button", {
        name: incoming ? "确认入库" : "确认出库",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: incoming ? "入库已完成" : "出库已完成",
      }),
    ).toBeVisible();
    balance += delta;
    const stock = await (
      await page.request.get("/api/items?q=收发用途验收")
    ).json();
    expect(stock.items[0].balance).toBe(balance);
    await page
      .getByRole("button", {
        name: incoming ? "继续入库" : "继续出库",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("点击“添加一行”，选择物料后填写本次数量。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加一行", exact: true }).click();
    await page.getByLabel("查找要收发的物料").fill("收发用途验收");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "移除空行", exact: true }).click();
  }
  const docs = await (await page.request.get("/api/documents")).json();
  expect(
    docs.items.filter((d: { lines: { item_id: string }[] }) =>
      d.lines.some((l) => l.item_id === id),
    ),
  ).toHaveLength(8);
  await navigate(page, "出入库");
  await page.getByRole("button", { name: /报损.*收发用途验收/ }).click();
  await expect(page.getByRole("dialog")).toContainText("验收原因");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await navigate(page, "记录");
  await expect(page.getByRole("table")).toContainText("报损");
  await page.getByText("查看详情", { exact: true }).first().click();
  await expect(page.locator(".audit-detail").first()).toBeVisible();
});

test("清点锁定阻止收发，取消后恢复收发", async ({ page }) => {
  const response = await page.request.post("/api/items", {
    headers,
    data: { name: "清点取消验收", kind: "其他", unit: "个", precision: 0 },
  });
  const { id } = await response.json();
  await navigate(page, "清点");
  await page.getByRole("button", { name: "开始清点", exact: true }).click();
  await page.getByRole("checkbox", { name: /清点取消验收/ }).check();
  await page.getByRole("button", { name: "开始清点 1 种物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const blocked = await page.request.post("/api/movements", {
    headers,
    data: {
      request_id: crypto.randomUUID(),
      kind: "receipt",
      lines: [{ item_id: id, quantity: "1" }],
    },
  });
  expect(blocked.status()).toBe(409);
  await page.getByRole("button", { name: /正在清点.*清点取消验收/ }).click();
  await page.getByRole("button", { name: "取消清点，恢复收发" }).click();
  await expect(
    page.getByRole("button", { name: /已取消.*清点取消验收/ }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/movements", {
        headers,
        data: {
          request_id: crypto.randomUUID(),
          kind: "receipt",
          lines: [{ item_id: id, quantity: "1" }],
        },
      })
    ).ok(),
  ).toBeTruthy();
});

test("备份计划保存、模板与所有导出下载、错误导入不写入、恢复取消", async ({
  page,
}) => {
  await navigate(page, "备份");
  await expect(
    page.getByText("每小时自动备份一次", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("保留天数", { exact: false }).fill("14");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    page.getByText("备份保留天数已保存。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("保留天数", { exact: false })).toHaveValue("14");
  for (const name of [
    "下载 Excel 模板",
    "下载 CSV 模板",
    "导出物料及库存 · Excel",
    "导出物料及库存 · CSV",
    "导出出入库记录",
    "导出操作记录",
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name, exact: true }).click();
    const file = await download;
    expect(await file.failure()).toBeNull();
    expect(readFileSync((await file.path())!).length).toBeGreaterThan(20);
  }
  await page.getByLabel("选择表格文件", { exact: false }).setInputFiles({
    name: "错误.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "物料编码,物料名称,规格,类型,单位,小数位数,条码,最低库存\nINVALID-UI,错误导入验收,,其他,个,9,,\n",
    ),
  });
  await page.getByRole("button", { name: "预览并检查文件" }).click();
  await expect(page.getByRole("alert")).toContainText("尚未导入任何数据");
  await expect(
    page.getByRole("button", { name: "确认导入 1 行" }),
  ).toBeDisabled();
  expect(
    (await (await page.request.get("/api/items?q=INVALID-UI")).json()).total,
  ).toBe(0);
  await page.getByRole("button", { name: "立即备份全部数据" }).click();
  await expect(page.getByText("完整备份已生成。")).toBeVisible();
  // The archive download was only ever asserted as an href, so nothing caught
  // it arriving empty or not at all. The exports above are covered; this is
  // the one that restores a whole ledger.
  const archive = page.waitForEvent("download");
  await page
    .getByRole("link", { name: /^下载完整备份 / })
    .first()
    .click();
  const file = await archive;
  expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  expect(readFileSync((await file.path())!).length).toBeGreaterThan(20);
  // In the packaged shell the engine shows nothing once the host picks the
  // destination, so the shell reports where the file landed and the pages have
  // to surface it; the browser never fires this, so drive it directly.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("erp:download-finished", {
        detail: { path: "/Users/factory/Downloads/snapshot.zip", success: true },
      }),
    ),
  );
  const landed = page.getByRole("status").filter({ hasText: "下载完成" });
  await expect(landed).toContainText("snapshot.zip");
  await landed.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(landed).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("erp:download-finished", { detail: { success: false } }),
    ),
  );
  await expect(page.getByRole("status").filter({ hasText: "下载失败" })).toBeVisible();
  await page
    .getByRole("button", { name: /^恢复备份 / })
    .first()
    .click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await page.request.get("/api/me")).status()).toBe(200);
});

test("查看员权限、角色更改、停用、重置密码与退出登录", async ({
  page,
  browser,
}) => {
  await navigate(page, "人员");
  await page.getByRole("button", { name: "添加人员账号" }).click();
  await page.getByLabel("姓名 必填", { exact: true }).fill("权限验收员");
  await page.getByLabel("登录账号", { exact: false }).fill("ui_viewer");
  await page.getByLabel("登录密码", { exact: false }).fill("Viewer-test-2026");
  await chooseSelect(page.getByLabel("角色 必填", { exact: true }), "viewer");
  await expect(
    page.getByRole("checkbox", { name: "入库", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存账号" }).click();
  const row = page.getByRole("row").filter({ hasText: "ui_viewer" });
  await expect(row).toContainText("查看员");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  const viewer = await context.newPage();
  try {
    await viewer.goto("/");
    await viewer.getByLabel("登录账号", { exact: false }).fill("ui_viewer");
    await viewer
      .getByLabel("登录密码", { exact: false })
      .fill("Viewer-test-2026");
    await viewer.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      viewer.getByRole("heading", { name: /权限验收员/ }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("button", {
        name: /我要入库|我要出库|人员|清点/,
      }),
    ).toHaveCount(0);
    expect(
      (
        await viewer.request.post("/api/movements", {
          headers,
          data: { request_id: crypto.randomUUID(), kind: "receipt", lines: [] },
        })
      ).status(),
    ).toBe(403);
    await row.getByRole("button", { name: "编辑账号" }).click();
    await chooseSelect(
      page.getByLabel("角色 必填", { exact: true }),
      "worker-111",
    );
    await page.getByRole("checkbox", { name: "允许此账号登录" }).uncheck();
    await page
      .getByLabel("重置密码", { exact: false })
      .fill("Changed-test-2026");
    await page.getByRole("button", { name: "保存账号" }).click();
    await expect(row).toContainText("已停用");
    expect((await viewer.request.get("/api/me")).status()).toBe(401);
    expect(
      (
        await viewer.request.post("/api/login", {
          headers,
          data: { username: "ui_viewer", password: "Changed-test-2026" },
        })
      ).status(),
    ).toBe(401);
    await row.getByRole("button", { name: "编辑账号" }).click();
    await page.getByRole("checkbox", { name: "允许此账号登录" }).check();
    await page.getByRole("button", { name: "保存账号" }).click();
    await expect(row).toContainText("操作员");
    expect(
      (
        await viewer.request.post("/api/login", {
          headers,
          data: { username: "ui_viewer", password: "Viewer-test-2026" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await viewer.request.post("/api/login", {
          headers,
          data: { username: "ui_viewer", password: "Changed-test-2026" },
        })
      ).status(),
    ).toBe(200);
    await viewer.reload();
    await expect(viewer.getByRole("link", { name: /我要入库/ })).toBeVisible();
    await viewer.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(
      viewer.getByRole("heading", { name: "登录库存管理" }),
    ).toBeVisible();
    expect((await viewer.request.get("/api/me")).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test("未经办过业务的账号可删除，有记录的只能停用，管理员两者都不行", async ({
  page,
  browser,
}) => {
  // Creating accounts through the form is covered above; this case is about
  // what may be deleted, so the fixtures go in through the API.
  const create = async (name: string, username: string, canIn: boolean) =>
    page.request.post("/api/users", {
      headers,
      data: { username, name, password, role: "worker", can_in: canIn },
    });
  expect((await create("建错的账号", "ui_spare", false)).status()).toBe(200);
  expect((await create("经办过的账号", "ui_worked", true)).status()).toBe(200);

  const item = await page.request.post("/api/items", {
    headers,
    data: { name: "删除验收料", kind: "原材料", unit: "个", precision: 0 },
  });
  // Its own context: page.request shares the page's cookie jar, so logging in
  // as the worker here would sign the administrator out of the page under test.
  const worked = await browser.newContext();
  try {
    expect(
      (
        await worked.request.post("/api/login", {
          headers,
          data: { username: "ui_worked", password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await worked.request.post("/api/movements", {
          headers,
          data: {
            request_id: crypto.randomUUID(),
            kind: "receipt",
            lines: [{ item_id: (await item.json()).id, quantity: "1" }],
          },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await worked.close();
  }

  await navigate(page, "人员");
  const confirm = page.getByRole("dialog", {
    name: "删除人员账号",
    exact: true,
  });

  // Never worked: the row goes, and the login goes with it.
  const spare = page.getByRole("row").filter({ hasText: "ui_spare" });
  await spare.getByRole("button", { name: /^删除账号：/ }).click();
  await confirm.getByRole("button", { name: "删除账号", exact: true }).click();
  await expect(spare).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/login", {
        headers,
        data: { username: "ui_spare", password },
      })
    ).status(),
  ).toBe(401);

  // Worked: refused with the reason, and the account stays as it was.
  const worker = page.getByRole("row").filter({ hasText: "ui_worked" });
  await worker.getByRole("button", { name: /^删除账号：/ }).click();
  await confirm.getByRole("button", { name: "删除账号", exact: true }).click();
  await expect(confirm).toContainText("已有出入库记录");
  await expect(confirm).toContainText("请改用停用登录");
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(worker).toBeVisible();
  // Isolated for the same reason: a successful login through page.request
  // would replace the administrator's session on the page under test.
  const still = await browser.newContext();
  try {
    expect(
      (
        await still.request.post("/api/login", {
          headers,
          data: { username: "ui_worked", password },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await still.close();
  }

  // The administrator is offered neither route, and the endpoint says so too.
  const list = await page.request.get("/api/users");
  expect(list.status(), await list.text()).toBe(200);
  const accounts = (await list.json()) as {
    id: string;
    username: string;
    role: string;
  }[];
  const admin = accounts.find((u) => u.role === "admin")!;
  const refused = await page.request.delete(`/api/users/${admin.id}`, {
    headers,
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("管理员账号不能删除");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: admin.username })
      .getByRole("button", { name: /^删除账号：/ }),
  ).toHaveCount(0);
});
