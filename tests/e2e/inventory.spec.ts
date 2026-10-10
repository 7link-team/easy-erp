import { chooseSelect } from "./controls";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.describe.serial("真实主机与浏览器的库存闭环", () => {
  test("首次初始化 → 物料 → 入库 → 出库 → 记录 → 清点 → 作废", async ({
    page,
  }) => {
    const initialized = (await (await page.request.get("/api/status")).json())
      .initialized;
    await page.goto("/");
    await expect(page.getByLabel("主机设置码", { exact: false })).toHaveCount(
      0,
    );
    if (!initialized)
      await page.getByLabel("管理员姓名", { exact: false }).fill("王厂长");
    await page.getByLabel("登录账号", { exact: false }).fill("manager");
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Factory-test-2026");
    await page
      .getByRole("button", {
        name: initialized ? "登录" : "设置并登录",
        exact: true,
      })
      .click();
    await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "物料", exact: true })
      .click();
    await page.getByRole("button", { name: "添加物料", exact: true }).click();
    await page.getByLabel("物料名称", { exact: false }).fill("镀锌螺丝");
    await page.getByLabel("规格", { exact: false }).fill("M6 × 20 mm");
    await chooseSelect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: "物料类型 选填", exact: true }),
      "原材料",
    );
    await page.getByRole("button", { name: "保存物料" }).click();
    await expect(
      page.getByRole("cell", { name: /^镀锌螺丝 M6/ }),
    ).toBeVisible();

    await page.getByRole("row").filter({ hasText: "镀锌螺丝" }).getByRole("button", { name: "入库", exact: true }).click();
    await page.getByLabel("入库数量", { exact: false }).fill("100");
    await page.getByRole("button", { name: "确认入库" }).click();
    await expect(
      page.getByRole("heading", { name: "入库已完成" }),
    ).toBeVisible();
    await expect(page.getByText("本次操作完成后的库存：100 个")).toBeVisible();
    await expect(page.getByText("预计", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "返回工作台" }).click();
    await page.getByRole("button", { name: /我要出库/ }).click();
    await page.getByRole("button", { name: /镀锌螺丝.*点击添加/ }).click();
    await page.getByLabel("出库数量", { exact: false }).fill("120");
    await page.getByRole("button", { name: "确认出库" }).click();
    await expect(page.getByRole("alert")).toContainText("当前库存 100");
    await page.getByLabel("出库数量", { exact: false }).fill("20");
    await page
      .getByRole("textbox", { name: "领用人 选填", exact: true })
      .fill("张师傅");
    await page.getByRole("button", { name: "确认出库" }).click();
    await expect(page.getByText("本次操作完成后的库存：80 个")).toBeVisible();

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "记录", exact: true })
      .click();
    await page.getByRole("button", { name: /领用出库.*镀锌螺丝/ }).click();
    await expect(page.getByRole("dialog")).toContainText("张师傅");
    await page.getByText("录错了？作废这笔记录").click();
    await page
      .getByLabel("作废原因", { exact: false })
      .fill("测试纠错：这次未实际领用");
    await page.getByRole("button", { name: "确认作废并调整库存" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "清点", exact: true })
      .click();
    await page.getByRole("button", { name: "开始清点", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("当前库存 100 个");
    await page.getByRole("checkbox", { name: /镀锌螺丝/ }).check();
    await page.getByRole("button", { name: "开始清点 1 种物料" }).click();
    const countRow = page.getByRole("button", { name: /正在清点.*镀锌螺丝/ });
    await expect(countRow).toContainText("清点前 100 个");
    await expect(countRow).toContainText("实点 未填写");
    await page.getByRole("button", { name: /正在清点.*镀锌螺丝/ }).click();
    await page.getByLabel(/镀锌螺丝 · 实际数量/).fill("98");
    await page.getByRole("button", { name: "保存清点数量" }).click();
    await expect(countRow).toContainText("实点 98 个");
    await expect(countRow).toContainText("少 2 个");
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(countRow.getByText("清点前 100 个")).toBeInViewport();
    await expect(countRow.getByText("实点 98 个")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/stocktake-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: /正在清点.*镀锌螺丝/ }).click();
    await page
      .getByLabel("差异原因", { exact: false })
      .fill("现场少了 2 个，厂长确认");
    await page.getByRole("button", { name: "确认并更新库存" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "物料", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "98 个", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/inventory-desktop.png",
      fullPage: true,
    });
  });

  test("并发出库不超卖、重复请求只入账一次、工人不能越权", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await page.getByLabel("登录账号", { exact: false }).fill("manager");
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Factory-test-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();
    const headers = { "X-ERP-Request": "1" };
    const created = await page.request.post("/api/items", {
      headers,
      data: { name: "并发测试成品", kind: "成品", unit: "件", precision: 0 },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    const receipt = {
      request_id: crypto.randomUUID(),
      kind: "receipt",
      lines: [{ item_id: id, quantity: "10" }],
    };
    const first = await page.request.post("/api/movements", {
      headers,
      data: receipt,
    });
    expect(first.ok()).toBeTruthy();
    const repeated = await page.request.post("/api/movements", {
      headers,
      data: receipt,
    });
    expect(await repeated.json()).toEqual(await first.json());
    const results = await Promise.all(
      [1, 2].map(() =>
        page.request.post("/api/movements", {
          headers,
          data: {
            request_id: crypto.randomUUID(),
            kind: "issue",
            lines: [{ item_id: id, quantity: "8" }],
          },
        }),
      ),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
    const stock = await (
      await page.request.get("/api/items?q=并发测试成品")
    ).json();
    expect(stock.items[0].balance).toBe(2000);

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "人员" })
      .click();
    await page.getByRole("button", { name: "添加人员账号" }).click();
    await page.getByLabel("姓名", { exact: false }).fill("张师傅");
    await page.getByLabel("登录账号", { exact: false }).fill("worker");
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Worker-test-2026");
    await page.getByRole("button", { name: "保存账号" }).click();
    await expect(
      page.getByRole("cell", { name: "张师傅", exact: true }),
    ).toBeVisible();
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4289",
      viewport: { width: 375, height: 812 },
    });
    const worker = await context.newPage();
    await worker.goto("/");
    await worker.getByLabel("登录账号", { exact: false }).fill("worker");
    await worker
      .getByLabel("登录密码", { exact: false })
      .fill("Worker-test-2026");
    await worker.getByRole("button", { name: "登录", exact: true }).click();
    await expect(worker.getByRole("heading", { name: /张师傅/ })).toBeVisible();
    await expect(
      worker.getByRole("button", { name: "人员" }),
    ).toHaveCount(0);
    const forbidden = await worker.request.post("/api/items", {
      headers,
      data: { name: "不能新增", kind: "其他", unit: "个", precision: 0 },
    });
    expect(forbidden.status()).toBe(403);
    await worker.screenshot({
      path: "test-results/worker-mobile.png",
      fullPage: true,
    });
    expect(
      await worker.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await context.close();
  });

  test("CSV 预览导入 → Excel 导出 → 完整备份 → 变更 → 恢复并撤销旧会话", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("登录账号", { exact: false }).fill("manager");
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Factory-test-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "备份" })
      .click();
    await page.getByLabel("选择表格文件", { exact: false }).setInputFiles({
      name: "物料.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "物料编码,物料名称,规格,类型,单位,小数位数,条码,最低库存\n000123,称重原料,A型,原材料,公斤,3,001234567,1.500\n",
        "utf8",
      ),
    });
    await page.getByRole("button", { name: "预览并检查文件" }).click();
    await expect(
      page.getByText("文件检查通过。确认后才会保存到库存电脑。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认导入 1 行" }).click();
    await expect(page.getByText("已导入 1 行数据。")).toBeVisible();
    await chooseSelect(
      page.getByLabel("导入内容", { exact: false }),
      "opening",
    );
    await page.getByLabel("选择表格文件", { exact: false }).setInputFiles({
      name: "期初.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "物料编码,第一次使用时的库存数量\n000123,12.250\n",
        "utf8",
      ),
    });
    await page.getByRole("button", { name: "预览并检查文件" }).click();
    await expect(
      page.getByText("文件检查通过。确认后才会保存到库存电脑。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认导入 1 行" }).click();
    await expect(
      page.getByRole("button", { name: "确认导入 1 行" }),
    ).toHaveCount(0);
    const stock = await (await page.request.get("/api/items?q=000123")).json();
    expect(stock.items[0].code).toBe("000123");
    expect(stock.items[0].barcode).toBe("001234567");
    expect(stock.items[0].balance).toBe(12250);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "导出物料及库存 · Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const path = await download.path();
    expect(readFileSync(path!).subarray(0, 2).toString()).toBe("PK");

    await page.getByRole("button", { name: "立即备份全部数据" }).click();
    await expect(page.getByText("完整备份已生成。")).toBeVisible();
    const backups = await (await page.request.get("/api/backups")).json();
    const backup = backups.items[0].name;
    expect(backup).toMatch(/\.zip$/);
    const archive = await page.request.get(`/api/backups/${backup}`);
    expect(archive.headers()["content-type"]).toBe("application/zip");
    expect((await archive.body()).subarray(0, 2).toString()).toBe("PK");
    const changed = await page.request.post("/api/movements", {
      headers: { "X-ERP-Request": "1" },
      data: {
        request_id: crypto.randomUUID(),
        kind: "issue",
        lines: [{ item_id: stock.items[0].id, quantity: "2.125" }],
      },
    });
    expect(changed.ok()).toBeTruthy();
    expect(
      (await (await page.request.get("/api/items?q=000123")).json()).items[0]
        .balance,
    ).toBe(10125);
    await page
      .getByRole("button", { name: `恢复备份 ${backup}`, exact: true })
      .click();
    await page.getByLabel("恢复确认", { exact: false }).fill("恢复全部数据");
    await page.getByRole("button", { name: "恢复全部数据并退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录库存管理" }),
    ).toBeVisible();
    expect((await page.request.get("/api/items")).status()).toBe(401);
    await page.getByLabel("登录账号", { exact: false }).fill("manager");
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Factory-test-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();
    expect(
      (await (await page.request.get("/api/items?q=000123")).json()).items[0]
        .balance,
    ).toBe(12250);
    const audit = await (await page.request.get("/api/audit")).json();
    expect(
      audit.items.some(
        (row: { action: string }) => row.action === "恢复全部数据",
      ),
    ).toBeTruthy();
  });
});
