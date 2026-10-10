import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  const status = await (await page.request.get("/api/status")).json();
  if (!status.initialized) {
    const setup = await page.request.post("/api/setup", {
      headers: { "X-ERP-Request": "1" },
      data: {
        username: "manager",
        password: "Factory-test-2026",
        name: "王管理员",
      },
    });
    expect(setup.ok()).toBeTruthy();
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "登录库存管理" }),
  ).toBeVisible();
  await page.getByLabel("登录账号", { exact: false }).fill("manager");
  await page.getByLabel("登录密码", { exact: false }).fill("Factory-test-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("深浅主题和三档字号可切换并在刷新后保留", async ({ page }) => {
  await login(page);
  await expect(
    page.getByRole("button", { name: "中号字（默认）", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const sizes: number[] = [];
  for (const name of ["小号字", "中号字（默认）", "大号字"]) {
    await page.getByRole("button", { name, exact: true }).click();
    sizes.push(
      await page
        .locator("main h1")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
  }
  expect(sizes[0]).toBeLessThan(sizes[1]);
  expect(sizes[1]).toBeLessThan(sizes[2]);
  await page.getByRole("button", { name: "切换到深色界面" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "大号字", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "切换到浅色界面" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  const paper = await page
    .locator("html")
    .evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--paper-2").trim(),
    );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    paper,
  );
  await page.getByRole("button", { name: "切换到浅色界面" }).click();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "小号字", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "sm");
  await page.reload();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "小号字", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("侧栏标题固定，工作台开单入口与其他操作统一排列", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.getByRole("button", { name: "大号字", exact: true }).click();
  const brand = page.locator(".sidebar .brand");
  const titlePosition = (await brand.boundingBox())!.y;
  const menu = page.getByRole("navigation", { name: "主要导航" });
  await menu.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect((await brand.boundingBox())!.y).toBe(titlePosition);
  await expect(brand).toBeInViewport();
  await expect(
    menu.getByRole("button", { name: "备份", exact: true }),
  ).toBeInViewport();
  const actions = page.locator(".task-grid").getByRole("button");
  await expect(actions).toHaveCount(4);
  const desktop = await actions.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  expect(new Set(desktop).size).toBe(1);
  await page.setViewportSize({ width: 320, height: 568 });
  const mobile = await actions.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  expect(mobile[0]).toBe(mobile[1]);
  expect(mobile[2]).toBe(mobile[3]);
  expect(mobile[2]).toBeGreaterThan(mobile[0]);
  await fits(page);
  await page.getByRole("button", { name: /开单发货/ }).click();
  await expect(
    page.getByRole("heading", { name: "新建单据", exact: true }),
  ).toBeVisible();
});

test("收发多物料局部滚动，确认按钮始终可见", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  for (let i = 0; i < 9; i++) {
    const response = await page.request.post("/api/items", {
      headers: { "X-ERP-Request": "1" },
      data: { name: `滚动验收${i}`, kind: "原材料", unit: "个", precision: 0 },
    });
    expect(response.ok()).toBeTruthy();
    const created = await response.json();
    const receipt = await page.request.post("/api/movements", {
      headers: { "X-ERP-Request": "1" },
      data: {
        request_id: crypto.randomUUID(),
        kind: "receipt",
        lines: [{ item_id: created.id, quantity: "1" }],
      },
    });
    expect(receipt.ok()).toBeTruthy();
  }
  for (const direction of ["入库", "出库"]) {
    await page.goto("/");
    await page
      .getByRole("button", { name: new RegExp(`我要${direction}`) })
      .click();
    for (let i = 0; i < 9; i++) {
      await page.getByRole("button", { name: "添加一行", exact: true }).click();
      await page.getByLabel("查找要收发的物料").fill(`滚动验收${i}`);
      await page
        .getByRole("button", { name: `选择滚动验收${i}`, exact: true })
        .click();
    }
    const confirm = page.getByRole("button", {
      name: `确认${direction}`,
      exact: true,
    });
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1024, height: 600 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      for (const bottom of [false, true]) {
        await page.evaluate((bottom) => {
          for (const el of document.querySelectorAll("main, .document-fields"))
            el.scrollTop = bottom ? el.scrollHeight : 0;
        }, bottom);
        await expect(confirm).toBeInViewport({ ratio: 1 });
        const box = (await confirm.boundingBox())!;
        if (viewport.width <= 760)
          expect(box.y + box.height).toBeLessThanOrEqual(
            (await page.locator(".sidebar").boundingBox())!.y,
          );
        await fits(page);
      }
      await page.screenshot({
        path: `test-results/movement-${direction}-${viewport.width}.png`,
      });
    }
    await confirm.click();
    await expect(page.getByRole("alert").first()).toHaveText("请填写此项。");
    await expect(
      page.getByLabel(`${direction}数量`, { exact: false }).first(),
    ).toBeInViewport();
  }
});

test("工作台经营展示带与库存指标按原型分区且悬停可读", async ({ page }) => {
  await login(page);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const summary = page.getByRole("region", { name: "本月经营概况" });
    await expect(summary).toBeVisible();
    const band = await summary.evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(band).toContain("radial-gradient");
    expect(band).toContain("linear-gradient");
    await expect(summary.locator(".business-figure")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    const cards = page.locator(".home-ledger").getByRole("link");
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      await page.mouse.move(0, 0);
      await expect(card).not.toHaveClass(/(^|\s)button(\s|$)/);
      await expect(card).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const ink = await card
        .locator(":scope > strong")
        .evaluate((el) => getComputedStyle(el).color);
      await card.hover();
      await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(card.locator(":scope > strong")).toHaveCSS("color", ink);
    }
    await page.screenshot({
      path: `test-results/summary-colors-${width}.png`,
      fullPage: true,
    });
    await fits(page);
  }
});

test("统一控件尺寸、中文行内校验、下拉键盘操作", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "物料", exact: true })
    .click();
  await page.getByRole("button", { name: "添加物料", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存物料", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("请填写此项。");
  await page.getByLabel("物料名称", { exact: false }).fill("统一控件验收");
  const type = page.getByRole("combobox", {
    name: "物料类型 选填",
    exact: true,
  });
  await type.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(type).toBeFocused();
  // 控件高取自设计令牌 --h-control（随字号档位与触屏变化），不写死像素
  const controlHeight = async () =>
    parseFloat(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--h-control")
          .trim(),
      ),
    );
  const desktopHeight = await controlHeight();
  for (const locator of [
    page.getByRole("dialog").getByLabel("规格", { exact: false }),
    type,
    dialog.getByRole("button", { name: "保存物料", exact: true }),
  ]) {
    expect((await locator.boundingBox())!.height).toBe(desktopHeight);
  }
  await page.screenshot({ path: "test-results/unified-controls-desktop.png" });
  await page.setViewportSize({ width: 375, height: 667 });
  // 窄屏触控目标必须更高，且不低于 44px
  const mobileHeight = await controlHeight();
  expect(mobileHeight).toBeGreaterThanOrEqual(44);
  expect((await type.boundingBox())!.height).toBe(mobileHeight);
  await type.click();
  await expect(
    page.getByRole("option", { name: "原材料", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/unified-controls-mobile.png" });
  await page.getByRole("option", { name: "原材料", exact: true }).click();
  await fits(page);
});

test("桌面打开链接调用原生命令，失败时明确提示且可以重试", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.evaluate(() => {
    (window as any).__TAURI__ = {
      core: {
        invoke: async () => {
          throw new Error("默认浏览器启动失败");
        },
      },
    };
  });
  await page
    .getByRole("button", { name: "在 Web 中打开", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "打开", exact: true }).first().click();
  await expect(dialog.getByRole("alert")).toContainText("默认浏览器启动失败");
  await page.evaluate(() => {
    (window as any).__TAURI__.core.invoke = async (
      command: string,
      args: unknown,
    ) => {
      (window as any).__lastNativeCall = { command, args };
    };
  });
  await dialog.getByRole("link", { name: "打开", exact: true }).first().click();
  await expect(dialog.getByRole("status")).toHaveText(
    "已交给系统默认浏览器打开。",
  );
  const call = await page.evaluate(() => (window as any).__lastNativeCall);
  expect(call.command).toBe("open_web_address");
  expect(call.args.address).toMatch(
    /^http:\/\/127\.0\.0\.1:4289\/#\/browser-login\/[a-f0-9]{64}$/,
  );
  const freshBrowser = await browser.newContext();
  try {
    const opened = await freshBrowser.newPage();
    await opened.goto(call.args.address);
    await expect(opened.getByRole("navigation")).toBeVisible();
    expect(opened.url()).not.toContain("browser-login");
  } finally {
    await freshBrowser.close();
  }
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("Web 地址选择与中文文件选择器", async ({ page }) => {
  const unauthorized = await page.request.get("/api/web-addresses");
  expect(unauthorized.status()).toBe(401);
  await login(page);
  const addresses = await page.request.get("/api/web-addresses");
  expect(addresses.ok()).toBeTruthy();
  expect(await addresses.json()).toEqual({
    items: [{ ip: "127.0.0.1", local: true }],
    port: 4289,
  });
  await page.route("**/api/web-addresses", (route) =>
    route.fulfill({
      json: {
        items: [
          { ip: "127.0.0.1", local: true },
          { ip: "192.168.1.10", local: false },
          { ip: "10.0.0.10", local: false },
        ],
        port: 4289,
      },
    }),
  );
  await page
    .getByRole("button", { name: "在 Web 中打开", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".web-address")).toHaveCount(3);
  await expect(
    dialog.getByRole("link", { name: "打开", exact: true }).nth(1),
  ).toHaveAttribute("href", "http://192.168.1.10:4289/");
  const popupReady = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "打开", exact: true }).first().click();
  const popup = await popupReady;
  await popup.waitForLoadState();
  expect(new URL(popup.url()).origin).toBe("http://127.0.0.1:4289");
  await popup.close();
  await page.setViewportSize({ width: 375, height: 667 });
  await fits(page);
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/web-address-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "备份", exact: true })
    .click();
  await expect(page.getByText("未选择文件", { exact: true })).toBeVisible();
  await expect(page.getByText("选择文件", { exact: true })).toBeVisible();
  await page.getByLabel("选择表格文件", { exact: false }).setInputFiles({
    name: "库存导入验收.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("物料编码,物料名称\n"),
  });
  await expect(page.locator(".file-picker-name")).toHaveText(
    "库存导入验收.csv",
  );
  await page.getByLabel("选择表格文件", { exact: false }).setInputFiles([]);
  await expect(page.locator(".file-picker-name")).toHaveText("未选择文件");
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
  { width: 800, height: 480 },
  { width: 375, height: 667 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
]) {
  test(`所有页面、弹窗与帮助在 ${viewport.width}×${viewport.height} 下可操作`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await login(page);
    for (const name of [
      "工作台",
      "物料",
      "开单",
      "单据",
      "客户",
      "退货",
      "出入库",
      "基础资料",
      "收款",
      "账户",
      "业绩",
      "记录",
      "清点",
      "人员",
      "备份",
      "关于",
    ]) {
      if (
        viewport.width <= 760 &&
        [
          "单据",
          "客户",
          "退货",
          "出入库",
          "账户",
          "业绩",
          "基础资料",
          "记录",
          "清点",
          "人员",
          "备份",
          "关于",
        ].includes(name)
      ) {
        await page.getByRole("button", { name: "更多", exact: true }).click();
      }
      if (name === "关于")
        await page.getByRole("button", { name, exact: true }).click();
      else
        await page
          .getByRole("navigation")
          .getByRole("button", { name, exact: true })
          .click();
      await expect(page.locator("main h1:visible")).toBeVisible();
      await fits(page);
      if (name === "收款") {
        await expect(
          page.getByRole("tablist", { name: "财务栏目", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("region", { name: "客户欠款", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("region", { name: "账户流水", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole("combobox", { name: "筛选账户", exact: false }),
        ).toBeVisible();
        await fits(page);
        await page
          .getByRole("region", { name: "部门业绩", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole("table", { name: "业绩归属汇总" }),
        ).toBeVisible();
        await fits(page);
      }
      if (name === "记录") {
        const tab = page.getByRole("tab", { name: "出入库记录", exact: true });
        await tab.focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          page.getByRole("tab", { name: "操作记录", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tabpanel")).toBeVisible();
      }
      if (name === "开单") {
        if (viewport.width <= 760)
          await page.getByRole("button", { name: "更多", exact: true }).click();
        await page
          .getByRole("navigation")
          .getByRole("button", { name: "基础资料", exact: true })
          .click();
        const configTabs = page.getByRole("tablist", {
          name: "销售配置栏目",
          exact: true,
        });
        await configTabs
          .getByRole("tab", { name: "业务员", exact: true })
          .click();
        await expect(
          configTabs.getByRole("tab", { name: "业务员", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await page
          .getByRole("button", { name: "新增业务员", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "新增业务员",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("combobox", { name: "所属部门 必填", exact: true }),
        ).toBeVisible();
        await dialog
          .getByLabel("业务员名称", { exact: false })
          .fill("缺部门验证");
        await dialog
          .getByRole("button", { name: "保存配置", exact: true })
          .click();
        await expect(
          dialog.getByRole("combobox", { name: "所属部门 必填", exact: true }),
        ).toHaveAttribute("aria-invalid", "true");
        await expect(dialog.getByRole("alert")).toHaveText("请选择此项。");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }
      if (name === "库存") {
        await page
          .getByRole("button", { name: "添加物料", exact: true })
          .click();
        const modal = page.getByRole("dialog");
        await expect(modal).toBeVisible();
        await page
          .getByLabel("物料名称", { exact: false })
          .fill("长名称显示验收".repeat(10));
        await page.getByLabel("关于物料类型", { exact: true }).click();
        await expect(page.getByRole("note")).toBeInViewport();
        await page.getByText("更多选项：物料编码、条码").click();
        await page
          .getByLabel("条码 选填", { exact: true })
          .fill("0123456789".repeat(10));
        await page
          .getByRole("button", { name: "保存物料", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole("button", { name: "保存物料", exact: true }),
        ).toBeInViewport();
        await expect(
          page.getByRole("button", { name: "关闭", exact: true }),
        ).toBeInViewport();
        expect(
          await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBeTruthy();
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await expect(modal).toHaveCount(0);
      }
      if (name === "人员") {
        if (viewport.width === 375) {
          const table = page
            .getByRole("region", { name: "人员账号" })
            .getByRole("region", {
              name: "可横向滚动的数据表格",
            });
          await expect(table).toBeVisible();
          await table.focus();
          await page.keyboard.press("ArrowRight");
          await expect
            .poll(() => table.evaluate((el) => el.scrollLeft))
            .toBeGreaterThan(0);
        }
        await page.getByRole("button", { name: "添加人员账号" }).click();
        await page
          .getByRole("button", { name: "保存账号" })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole("button", { name: "保存账号" }),
        ).toBeInViewport();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "工作台", exact: true })
      .click();
    for (const action of ["我要入库", "我要出库"]) {
      await page.getByRole("button", { name: new RegExp(action) }).click();
      await fits(page);
      await page.getByLabel(/关于(来源|领用人)/).click();
      await expect(page.getByRole("note")).toBeInViewport();
      await page.getByRole("button", { name: "返回", exact: true }).click();
    }
    await page.screenshot({
      path: `test-results/ui-${viewport.width}.png`,
      fullPage: true,
    });
    expect(pageErrors).toEqual([]);
  });
}

test("手机底部导航固定、更多入口、返回保护与刷新定位", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const nav = page.getByRole("navigation", { name: "主要导航" });
  await expect(nav.getByRole("button")).toHaveCount(5);
  expect((await nav.boundingBox())!.height).toBeLessThan(80);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(nav).toBeInViewport();
  await nav.getByRole("button", { name: "更多", exact: true }).click();
  await page
    .getByRole("navigation", { name: "更多功能" })
    .getByRole("button", { name: "备份" })
    .click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.reload();
  await expect(page.locator("main h1")).toContainText("备份");
  await nav.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: /我要入库/ }).click();
  await page
    .getByRole("textbox", { name: "来源 选填", exact: true })
    .fill("保留的草稿");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "来源 选填", exact: true }),
  ).toHaveValue("保留的草稿");
  await expect(page).toHaveURL(/#\/in$/);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认离开", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/home$/);
});

test("手机物料列表不横滑即可入库，底栏不遮挡操作", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page);
  await page.screenshot({ path: "test-results/app-home-mobile.png" });
  const itemName = `手机物料操作验收-${Date.now()}`;
  const created = await page.request.post("/api/items", {
    headers: { "X-ERP-Request": "1" },
    data: {
      name: itemName,
      kind: "原材料",
      unit: "个",
      precision: 0,
    },
  });
  expect(created.ok()).toBeTruthy();
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "物料", exact: true })
    .click();
  const searchResults = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/items" &&
      new URL(response.url()).searchParams.get("q") === itemName &&
      response.request().method() === "GET",
  );
  await page.getByLabel("搜索物料", { exact: true }).fill(itemName);
  await searchResults;
  const row = page.getByRole("row").filter({ hasText: itemName });
  await expect(row).toBeVisible();
  expect(
    await page
      .getByRole("table", { name: "物料库存" })
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await row
    .getByRole("button", { name: "入库", exact: true })
    .scrollIntoViewIfNeeded();
  const action = (await row
    .getByRole("button", { name: "入库", exact: true })
    .boundingBox())!;
  const bar = (await page.locator(".sidebar").boundingBox())!;
  expect(action.y + action.height).toBeLessThanOrEqual(bar.y);
  await page.screenshot({ path: "test-results/app-inventory-mobile.png" });
  await row.getByRole("button", { name: "入库", exact: true }).click();
  await page.getByLabel("入库数量", { exact: false }).fill("2");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "入库已完成" })).toBeVisible();
  await expect(page.getByText("本次操作完成后的库存：2 个")).toBeVisible();
});

test("全站栏目选中样式一致、侧栏分区与普通页面打印", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const navigation = page.getByRole("navigation", { name: "主要导航" });
  await expect(navigation.getByRole("group", { name: "概览" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "设置" })).toBeVisible();
  await expect(
    navigation
      .getByRole("group", { name: "销售" })
      .getByRole("button", { name: "开单", exact: true }),
  ).toBeVisible();
  await expect(
    navigation
      .getByRole("group", { name: "设置" })
      .getByRole("button", { name: "备份", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const styles = [];
    for (const [route, label] of [
      ["records", "出入库记录"],
      ["sales", "单据列表"],
    ]) {
      await page.goto(`/#/${route}`);
      const tab = page.getByRole("tab", { name: label, exact: true });
      await expect(tab).toHaveAttribute("aria-selected", "true");
      styles.push(
        await tab.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            color: style.color,
            border: style.borderBottomColor,
            thickness: style.borderBottomWidth,
            font: style.fontSize,
            radius: style.borderRadius,
            height: style.minHeight,
          };
        }),
      );
      await fits(page);
      await page.screenshot({
        path: testInfo.outputPath(`${route}-tabs-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto("/#/catalog");
    const config = page.getByRole("tablist", {
      name: "销售配置栏目",
      exact: true,
    });
    const selected = config.getByRole("tab", { selected: true });
    expect(styles[1]).toEqual(styles[0]);
    // Dictionary navigation follows the prototype: a side list on desktop,
    // horizontal choices on mobile, not the ordinary underline tab style.
    await expect(config).toHaveAttribute(
      "aria-orientation",
      width > 760 ? "vertical" : "horizontal",
    );
    const sideBox = await page.locator(".dictionary-side").boundingBox();
    const contentBox = await page.locator(".dictionary-main").boundingBox();
    expect(sideBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    if (width > 760) {
      expect(sideBox!.width).toBe(208);
      expect(contentBox!.x - sideBox!.x - sideBox!.width).toBe(16);
      expect(contentBox!.y).toBe(sideBox!.y);
    } else {
      expect(contentBox!.y).toBeGreaterThanOrEqual(
        sideBox!.y + sideBox!.height,
      );
    }
    await expect(
      page.getByRole("table", { name: "单据类型列表" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新增单据类型", exact: true }),
    ).toBeVisible();
    await selected.focus();
    await page.keyboard.press("End");
    await expect(
      config.getByRole("tab", { name: "公司信息", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: testInfo.outputPath(`config-tabs-${width}.png`),
      fullPage: true,
    });
    await fits(page);
  }
  // Loading the sales print CSS must not make an ordinary page print blank.
  await page.goto("/#/inventory");
  await page.getByRole("heading", { name: "物料", exact: true }).waitFor();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#root")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
});

test("普通开单人的配置栏目只提供客户并能快速建档", async ({
  page,
  browser,
}) => {
  await login(page);
  const username = `ui_worker_${Date.now()}`;
  const response = await page.request.post("/api/users", {
    headers: { "X-ERP-Request": "1" },
    data: {
      username,
      name: "界面开单人",
      password: "Worker-test-2026",
      role: "worker",
      can_out: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const context = await browser.newContext();
  try {
    const worker = await context.newPage();
    await worker.request.post("/api/login", {
      headers: { "X-ERP-Request": "1" },
      data: { username, password: "Worker-test-2026" },
    });
    await worker.goto("/#/finance");
    await expect(
      worker.getByText("当前角色没有此页面的查看权限，请联系管理员。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      worker
        .getByRole("navigation")
        .getByRole("button", { name: "收款", exact: true }),
    ).toHaveCount(0);
    expect((await worker.request.get("/api/sales/finance")).status()).toBe(403);
    await worker.goto("/#/sales");
    await expect(
      worker.getByRole("tab", { name: "收款与欠款", exact: true }),
    ).toHaveCount(0);
    await worker.goto("/#/customers");
    const config = worker.getByRole("tablist", {
      name: "销售配置栏目",
      exact: true,
    });
    await expect(config).toBeHidden();
    await expect(worker.locator("main h1")).toBeVisible();
    await worker.getByRole("button", { name: "新增客户", exact: true }).click();
    const dialog = worker.getByRole("dialog", {
      name: "新增客户",
      exact: true,
    });
    const name = `界面客户-${Date.now()}`;
    await dialog.getByLabel("客户名称", { exact: false }).fill(name);
    await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(worker.getByText(name, { exact: true })).toBeVisible();
    await worker.goto("/#/sales");
    await worker.getByRole("button", { name: "新建单据", exact: true }).click();
    await worker
      .getByRole("combobox", { name: "客户 必填", exact: true })
      .click();
    await expect(
      worker.getByRole("option", { name: "新增客户", exact: true }),
    ).toBeVisible();
    await worker.keyboard.press("Escape");
    await worker
      .getByRole("combobox", { name: "业绩部门", exact: false })
      .click();
    await expect(
      worker.getByRole("option", { name: "新增部门", exact: true }),
    ).toHaveCount(0);
    await worker.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("长表单弹窗标题与操作区常显，取消不保存", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/#/inventory");
  for (const viewport of [
    { width: 1280, height: 600 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "添加物料", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const heading = dialog.locator(".modal-heading");
    const footer = dialog.locator(".form-footer");
    const titleY = (await heading.boundingBox())!.y;
    await expect(footer).toBeInViewport({ ratio: 1 });
    await dialog.locator(".modal-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect((await heading.boundingBox())!.y).toBe(titleY);
    await expect(footer).toBeInViewport({ ratio: 1 });
    await fits(page);
    await page.screenshot({
      path: testInfo.outputPath(`sticky-modal-${viewport.width}.png`),
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});
