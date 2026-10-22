import { test, expect, type Page } from "@playwright/test";

const initial = {
  webhook: "****",
  webhook_set: true,
  format: "xlsx",
  hour: 18,
  minute: 30,
  periods: ["day"],
  last_error: "",
};
async function start(page: Page, overrides: Partial<typeof initial> = {}) {
  const headers = { "X-ERP-Request": "1" };
  const credentials = { username: "manager", password: "Factory-test-2026" };
  if (!(await (await page.request.get("/api/status")).json()).initialized) {
    expect(
      (
        await page.request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "管理员" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (
      await page.request.post("/api/login", { headers, data: credentials })
    ).ok(),
  ).toBeTruthy();
  let schedule = { ...initial, ...overrides };
  const saved: Record<string, unknown>[] = [];
  const generated: Record<string, unknown>[] = [];
  let failSave = false;
  let failGenerate = false;
  let items: { name: string; key: string; size: number; created_at: number }[] =
    [];
  await page.route("**/api/report-schedule", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saved.push(body);
      if (failSave)
        return route.fulfill({
          status: 400,
          json: { error: "地址保存失败，请重试" },
        });
      const webhookSet =
        body.webhook === "****" ? schedule.webhook_set : !!body.webhook;
      schedule = {
        ...body,
        webhook_set: webhookSet,
        webhook: webhookSet ? "****" : "",
        last_error: "",
      };
    }
    await route.fulfill({ json: schedule });
  });
  await page.route("**/api/reports", async (route) => {
    if (route.request().method() === "POST") {
      generated.push(route.request().postDataJSON());
      if (failGenerate)
        return route.fulfill({
          status: 500,
          json: { error: "报告生成失败，请重试" },
        });
      items = [
        {
          name: "月报-2026-10-01.pdf",
          key: "reports/2026/10/月报-2026-10-01.pdf",
          size: 2048,
          created_at: 1790812800000,
        },
      ];
      return route.fulfill({ json: { name: items[0].name } });
    }
    await route.fulfill({ json: { items } });
  });
  await page.goto("/#/reports");
  const section = page.getByRole("region", { name: "周期报告", exact: true });
  await expect(
    section.getByRole("button", { name: "保存周期报告设置" }),
  ).toBeVisible();
  return {
    section,
    saved,
    generated,
    failSave: (value: boolean) => {
      failSave = value;
    },
    failGenerate: (value: boolean) => {
      failGenerate = value;
    },
  };
}

for (const state of [
  { webhook: "", webhook_set: false, periods: ["day"] },
  { webhook: "****", webhook_set: true, periods: [] },
]) {
  test(`不投递状态：${state.webhook_set ? "未选周期" : "未设置地址"}`, async ({
    page,
  }) => {
    const { section } = await start(page, state);
    await expect(
      section.getByText("当前设置不会投递", { exact: false }),
    ).toBeVisible();
  });
}

test("留空保留已有地址，只发送约定字段，关闭时清空周期", async ({ page }) => {
  const { section, saved } = await start(page);
  const input = section.getByLabel("企业微信群机器人地址 选填", {
    exact: true,
  });
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveAttribute("placeholder", "****");
  await expect(
    section.getByText(
      "地址已设置，留空提交即保留原值；清除请点旁边的清除按钮。",
    ),
  ).toBeVisible();
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect(section.getByText("周期报告设置已保存。")).toBeVisible();
  expect(saved[0]).toEqual({
    webhook: "****",
    format: "xlsx",
    hour: 18,
    minute: 30,
    periods: ["day"],
  });
  await section
    .getByRole("checkbox", { name: "开启周期报告投递", exact: true })
    .uncheck();
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1].periods).toEqual([]);
});

test("显式清除地址，保存后不再显示掩码", async ({ page }) => {
  const { section, saved } = await start(page);
  await section.getByRole("button", { name: "清除地址", exact: true }).click();
  await expect(
    section.getByText("已标记清除地址", { exact: false }),
  ).toBeVisible();
  expect(saved).toHaveLength(0);
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect(section.getByText("周期报告设置已保存。")).toBeVisible();
  expect(saved[0].webhook).toBe("");
  await expect(
    section.getByLabel("企业微信群机器人地址 选填", { exact: true }),
  ).toHaveAttribute("placeholder", "请输入企业微信群机器人地址");
  await expect(
    section.getByText("当前设置不会投递", { exact: false }),
  ).toBeVisible();
});

test("周期末日文案、多选、时间、PDF 提示和最近错误", async ({ page }) => {
  const { section, saved } = await start(page, {
    last_error: "报告投递失败：缺少中文字体",
  });
  await expect(section.getByRole("alert")).toContainText(
    "报告投递失败：缺少中文字体",
  );
  for (const name of [
    "每天",
    "每周最后一天",
    "每月最后一天",
    "每季度最后一天",
    "每年最后一天",
  ]) {
    await section.getByRole("checkbox", { name, exact: true }).check();
  }
  await expect(
    section.getByRole("checkbox", { name: "每周", exact: true }),
  ).toHaveCount(0);
  await section
    .getByLabel("投递时间（本地时间） 必填", { exact: true })
    .fill("23:59");
  await section
    .getByRole("combobox", { name: "投递格式", exact: true })
    .click();
  await page.getByRole("option", { name: "PDF", exact: true }).click();
  await expect(
    section.getByText("需要库存主机上装有中文字体，否则会提示失败", {
      exact: true,
    }),
  ).toBeVisible();
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toEqual({
    webhook: "****",
    format: "pdf",
    hour: 23,
    minute: 59,
    periods: ["day", "week", "month", "quarter", "year"],
  });
});

test("新地址保存失败保留输入，重试后掩码，刷新不丢草稿", async ({ page }) => {
  const mock = await start(page);
  const input = mock.section.getByLabel("企业微信群机器人地址 选填", {
    exact: true,
  });
  const address = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test";
  await input.fill(address);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue(address);
  mock.failSave(true);
  await mock.section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect(mock.section.getByRole("alert")).toContainText("地址保存失败");
  await expect(input).toHaveValue(address);
  mock.failSave(false);
  await mock.section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect(mock.section.getByText("周期报告设置已保存。")).toBeVisible();
  expect(mock.saved[1].webhook).toBe(address);
  await expect(input).toHaveValue("");
  await page.reload();
  await expect(input).toHaveAttribute("placeholder", "****");
});

test("立即生成失败可重试，刷新归档及下载，390px 无溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await start(page);
  await expect(mock.section.getByText("暂无已归档报告。")).toBeVisible();
  await mock.section
    .getByRole("combobox", { name: "生成周期", exact: true })
    .click();
  await page.getByRole("option", { name: "月报", exact: true }).click();
  await mock.section
    .getByRole("combobox", { name: "生成格式", exact: true })
    .click();
  await page.getByRole("option", { name: "PDF", exact: true }).click();
  await expect(
    mock.section.getByText("需要库存主机上装有中文字体，否则会提示失败", {
      exact: true,
    }),
  ).toBeVisible();
  await mock.section
    .getByLabel("报告日期 必填", { exact: true })
    .fill("2026-10-22");
  mock.failGenerate(true);
  await mock.section.getByRole("button", { name: "立即生成报告" }).click();
  await expect(mock.section.getByRole("alert")).toContainText("报告生成失败");
  mock.failGenerate(false);
  await mock.section.getByRole("button", { name: "立即生成报告" }).click();
  const download = mock.section.getByRole("button", {
    name: "下载报告 月报-2026-10-01.pdf",
    exact: true,
  });
  await expect(download).toBeVisible();
  expect(mock.generated[1]).toEqual({
    period: "month",
    date: "2026-10-22",
    format: "pdf",
  });
  // A refusal has to be readable and a success has to be announced: this was a
  // plain <a download>, which says nothing either way, so both a 403 and a
  // finished download looked like a button that did nothing.
  let refuse = true;
  const asked: string[] = [];
  await page.route("**/api/reports/*", (route) => {
    asked.push(decodeURIComponent(new URL(route.request().url()).pathname));
    return refuse
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "这个操作只能在库存主机本机进行。" }),
        })
      : route.fulfill({ status: 200, body: "report" });
  });
  await download.click();
  await expect(
    mock.section.getByText("这个操作只能在库存主机本机进行。"),
  ).toBeVisible();
  refuse = false;
  const saved = page.waitForEvent("download");
  await download.click();
  expect((await saved).suggestedFilename()).toBe("月报-2026-10-01.pdf");
  await expect(
    mock.section.getByText("已下载 月报-2026-10-01.pdf。"),
  ).toBeVisible();
  expect(asked).toEqual([
    "/api/reports/月报-2026-10-01.pdf",
    "/api/reports/月报-2026-10-01.pdf",
  ]);
  await page.unroute("**/api/reports/*");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("report-schedule-mobile.png"),
    fullPage: true,
  });
});

test("报告独立导航、面包屑与返回，备份页不再包含周期报告", async ({ page }) => {
  await start(page);
  await expect(
    page.getByRole("heading", { name: "报告", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "面包屑" })).toHaveText(
    "工作台报告",
  );
  const nav = page.getByRole("navigation", { name: "主要导航" });
  const stock = nav.getByRole("group", { name: "库存", exact: true });
  await expect(stock.getByRole("link")).toHaveText([
    "物料",
    "出入库",
    "清点",
    "记录",
    "汇总",
    "报告",
  ]);
  await expect(
    stock.getByRole("link", { name: "报告", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "备份", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "备份", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "周期报告", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("link", { name: "报告", exact: true }).click();
  await expect(page).toHaveURL(/#\/reports$/);
  await page
    .locator(".topbar")
    .getByRole("button", { name: "返回上一页", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/settings$/);
});

test("原生时间补零、空值校验与零点保存，企业微信说明", async ({ page }) => {
  const { section, saved } = await start(page, { hour: 8, minute: 5 });
  const time = section.getByLabel("投递时间（本地时间） 必填", { exact: true });
  await expect(time).toHaveAttribute("type", "time");
  await expect(time).toHaveValue("08:05");
  await expect(
    section.getByText("目前只支持企业微信群机器人", { exact: false }),
  ).toContainText("企业微信群 →「群机器人」→ 添加后复制");
  await time.fill("");
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect(time).toHaveAttribute("aria-invalid", "true");
  expect(saved).toHaveLength(0);
  await time.fill("00:00");
  await section.getByRole("button", { name: "保存周期报告设置" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ hour: 0, minute: 0 });
  await expect(time).toHaveValue("00:00");
});

test("非管理员不能查看报告菜单或直达页面", async ({ page }) => {
  await start(page);
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), role: "staff" },
    });
  });
  await page.reload();
  await expect(
    page.getByText("当前角色没有此页面的查看权限，请联系管理员。"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("link", { name: "报告", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "周期报告", exact: true }),
  ).toHaveCount(0);
});
