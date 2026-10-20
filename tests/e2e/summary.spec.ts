import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./controls";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };

async function post(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api${path}`, { headers, data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("期间汇总逐款列出数量金额并合计，按小组与方向分别统计，作废不计入，可导出图片", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const spec = `7.5×${tag}`;
  const groups = [`甲组-${tag}`, `乙组-${tag}`];
  for (const name of groups)
    await post(page.request, "/material-options", { field: "team", name });
  const bolt = await post(page.request, "/items", {
    name: `螺丝-${tag}`,
    spec,
    kind: "成品",
    unit: "个",
    precision: 0,
    cost_price: "10",
  });
  const washer = await post(page.request, "/items", {
    name: `垫片-${tag}`,
    spec: `3.0×${tag}`,
    kind: "成品",
    unit: "个",
    precision: 0,
    cost_price: "2.5",
  });
  const unpriced = await post(page.request, "/items", {
    name: `未定价-${tag}`,
    spec: `9.9×${tag}`,
    kind: "成品",
    unit: "个",
    precision: 0,
  });
  const receipt = (item: string, quantity: string, team: string) =>
    post(page.request, "/movements", {
      request_id: randomUUID(),
      kind: "receipt",
      team,
      lines: [{ item_id: item, quantity }],
    });
  // 甲组 produced 5 bolts worth ¥50; 乙组 4 washers worth ¥10.
  await receipt(bolt.id, "2", groups[0]);
  await receipt(bolt.id, "3", groups[0]);
  await receipt(washer.id, "4", groups[1]);
  await receipt(unpriced.id, "7", groups[1]);

  // A group only describes where incoming goods came from.
  const outgoing = await page.request.post("/api/movements", {
    headers,
    data: {
      request_id: randomUUID(),
      kind: "issue",
      team: groups[0],
      lines: [{ item_id: bolt.id, quantity: "1" }],
    },
  });
  expect(outgoing.status()).toBe(400);
  expect(await outgoing.text()).toContain("只有入库记录可以选择小组");
  // Two bolts issued, so the period has something to report in both
  // directions and the stock snapshot differs from what came in.
  await post(page.request, "/movements", {
    request_id: randomUUID(),
    kind: "issue",
    person: "车间",
    lines: [{ item_id: bolt.id, quantity: "2" }],
  });

  const summary = async (query: string) =>
    (await page.request.get(`/api/documents/summary?${query}`)).json();
  const scoped = `q=${encodeURIComponent(tag)}`;
  // Every direction at once is the default, and the two are reported side by
  // side rather than added together: line quantities are unsigned magnitudes.
  let totals = await summary(scoped);
  expect(totals.in_value).toBe("60.00");
  expect(totals.out_value).toBe("20.00");
  expect(totals.unpriced_items).toBe(1);
  expect(
    totals.materials.map(
      (m: {
        name: string;
        cost_price: number | null;
        in_quantity: number;
        in_value: string;
        out_quantity: number;
        out_value: string;
      }) => [
        m.name,
        m.cost_price,
        m.in_quantity,
        m.in_value,
        m.out_quantity,
        m.out_value,
      ],
    ),
  ).toEqual([
    [`螺丝-${tag}`, 100_000, 5000, "50.00", 2000, "20.00"],
    [`垫片-${tag}`, 25_000, 4000, "10.00", 0, "0.00"],
    [`未定价-${tag}`, null, 7000, "0.00", 0, "0.00"],
  ]);
  expect(
    totals.teams.map((t: { team: string; value: string }) => [t.team, t.value]),
  ).toEqual([
    [groups[0], "50.00"],
    [groups[1], "10.00"],
  ]);
  // The stock figure is a snapshot of what is on hand, not part of the period.
  expect(totals.stock_value).toBe("40.00");

  // Narrowing to one direction leaves the other column empty.
  totals = await summary(`kind=in&${scoped}`);
  expect([totals.in_value, totals.out_value]).toEqual(["60.00", "0.00"]);
  totals = await summary(`kind=out&${scoped}`);
  expect([totals.in_value, totals.out_value]).toEqual(["0.00", "20.00"]);
  expect(totals.materials).toHaveLength(1);

  // The keyword reaches the specification, which is how operators look a size up.
  totals = await summary(`q=${encodeURIComponent(spec)}`);
  expect(totals.in_value).toBe("50.00");
  expect(totals.materials).toHaveLength(1);
  // It also narrows the stock snapshot, the way the material list behaves.
  expect(totals.stock_value).toBe("30.00");

  totals = await summary(
    `kind=in&${scoped}&team=${encodeURIComponent(groups[1])}`,
  );
  expect(totals.in_value).toBe("10.00");

  // Local components, not toISOString: the period is local, and in a zone ahead
  // of UTC the UTC date is still yesterday.
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  const tomorrow = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  totals = await summary(`${scoped}&from=${tomorrow}`);
  expect(totals.materials).toHaveLength(0);
  // A period may also be given to the minute.
  totals = await summary(`${scoped}&from=${tomorrow}T08:30`);
  expect(totals.materials).toHaveLength(0);
  for (const bad of ["2026/10/01", "2026-10-01T8:30", "26-10-01"]) {
    const refused = await page.request.get(
      `/api/documents/summary?from=${encodeURIComponent(bad)}`,
    );
    expect(refused.status(), bad).toBe(400);
    expect(await refused.text()).toContain("日期请按");
  }
  expect(
    (await page.request.get("/api/documents/summary?kind=bogus")).status(),
  ).toBe(400);

  // Cancelling a record must remove both it and its reversal from the period.
  const voided = await receipt(bolt.id, "9", groups[0]);
  expect((await summary(scoped)).in_value).toBe("150.00");
  await post(page.request, `/documents/${voided.id}/void`, {
    reason: "汇总验收作废",
  });
  expect((await summary(scoped)).in_value).toBe("60.00");

  // The session from the API login is shared with the page context.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /^(主要导航|更多功能)$/ })
    .getByRole("link", { name: "汇总", exact: true })
    .click();
  await page.getByLabel("搜索汇总").fill(tag);
  const rows = page
    .getByRole("table", { name: "汇总列表" })
    .locator("tbody tr");
  await expect(rows).toHaveCount(3);
  // Direction is a chip group, like the other list pages.
  const direction = page.getByRole("group", { name: "统计方向", exact: true });
  await expect(
    direction.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const figures = page.getByLabel("汇总金额", { exact: true });
  await expect(figures).toContainText("入库成本总额");
  await expect(figures).toContainText("¥60.00");
  await expect(figures).toContainText("当前库存成本总额");
  await expect(page.getByText("未设置成本价", { exact: false })).toBeVisible();
  // The period defaults to this month, to the minute.
  await expect(page.getByLabel("开始时间", { exact: false })).toHaveValue(
    /^\d{4}-\d{2}-01T00:00$/,
  );

  // A resource keeps its last data when its path goes away, so the sales block
  // has to follow the direction rather than whatever was last loaded.
  await direction.getByRole("button", { name: "入库", exact: true }).click();
  await expect(figures).not.toContainText("销售总额");
  await expect(page.getByRole("table", { name: "销售汇总列表" })).toHaveCount(
    0,
  );
  await direction.getByRole("button", { name: "全部", exact: true }).click();

  // One menu, one page: the summary keeps its own address.
  expect(new URL(page.url()).hash).toBe("#/summary");

  await page.getByRole("button", { name: "导出图片", exact: true }).click();
  const picture = page.getByRole("dialog", { name: /汇总图片$/ });
  await expect(picture.getByRole("img")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await expect(
    picture.getByRole("link", { name: "保存图片", exact: true }),
  ).toHaveAttribute("download", /\.png$/);
});

test("销售汇总按客户给出金额与合计，期间之外的单据不计入", async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const buyer = async (name: string) =>
    post(page.request, "/sales/catalog", { kind: "customer", name });
  const first = await buyer(`大客户-${tag}`);
  const second = await buyer(`小客户-${tag}`);
  const goods = await post(page.request, "/items", {
    name: `销售物料-${tag}`,
    spec: `S-${tag}`,
    kind: "成品",
    unit: "个",
    precision: 0,
    cost_price: "1",
  });
  await post(page.request, "/movements", {
    request_id: randomUUID(),
    kind: "receipt",
    lines: [{ item_id: goods.id, quantity: "100" }],
  });
  const sell = (customer: string, price: string, date: string) =>
    post(page.request, "/sales/commands", {
      request_id: randomUUID(),
      action: "confirm",
      input: {
        customer_id: customer,
        type_id: "sale",
        business_date: date,
        lines: [{ item_id: goods.id, quantity: "1", price }],
      },
    });
  await sell(first.id, "30", "2026-03-10");
  await sell(first.id, "20", "2026-03-11");
  await sell(second.id, "5", "2026-03-12");
  // Outside the period below, so it must not reach the total.
  await sell(second.id, "999", "2026-04-01");

  const summary = async (query: string) =>
    (await page.request.get(`/api/sales/summary?${query}`)).json();
  const inside = await summary(
    `q=${encodeURIComponent(tag)}&from=2026-03-01&to=2026-03-31`,
  );
  expect(inside.total_amount).toBe("55.00");
  expect(inside.count).toBe(3);
  expect(
    inside.customers.map(
      (c: { name: string; count: number; amount: string }) => [
        c.name,
        c.count,
        c.amount,
      ],
    ),
  ).toEqual([
    [`大客户-${tag}`, 2, "50.00"],
    [`小客户-${tag}`, 1, "5.00"],
  ]);
  // Widening the period picks the excluded document back up.
  expect(
    (
      await summary(
        `q=${encodeURIComponent(tag)}&from=2026-03-01&to=2026-04-30`,
      )
    ).total_amount,
  ).toBe("1054.00");

  // The application keeps its query before the hash route.
  await page.goto(
    "/?summary_kind=sales&summary_from=2026-03-01&summary_to=2026-03-31#/summary",
  );
  await page.getByLabel("搜索汇总").fill(tag);
  const rows = page
    .getByRole("table", { name: "汇总列表" })
    .locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("¥55.00")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "销售额" }),
  ).toBeVisible();
});

test("入库小组可在基础资料里维护，汇总筛选建好后才出现，入库表单可挑选", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const group = `丙组-${tag}`;
  await page.goto("/#/catalog");
  // The summary filter still only renders once a group exists; the stock-in
  // form now offers the field either way, and is covered by the case below.
  await page.getByRole("tab", { name: "入库小组", exact: true }).click();
  await page.getByRole("button", { name: "新增入库小组", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新增入库小组",
    exact: true,
  });
  await dialog.getByLabel("选项名称", { exact: false }).fill(group);
  await dialog.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "入库小组列表" }).locator("tbody tr"),
  ).toContainText([group]);

  await page.goto("/#/summary");
  // The summary filters groups with chips, the way the other list pages filter.
  const groups = page.getByRole("group", { name: "入库小组", exact: true });
  const chip = groups.getByRole("button", { name: group, exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  // The stock-in form goes last: choosing a group marks it unsaved, and the
  // navigation guard would then hold a hash navigation behind its own dialog.
  await page.goto("/#/in");
  const selector = page.getByRole("combobox", { name: "小组", exact: false });
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByRole("option", { name: group, exact: true }).click();
  await expect(selector).toHaveValue(group);
});

test("入库表单直接输入新小组即登记，基础资料与汇总筛选随后可见", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const group = `丁组-${tag}`;
  const name = `登记料-${tag}`;
  await post(page.request, "/items", {
    name,
    spec: `1.1×${tag}`,
    kind: "成品",
    unit: "个",
    precision: 0,
  });

  // Offered even with no group on record: the first incoming record should not
  // have to detour through the catalog, which is what hiding the field did.
  await page.goto("/#/in");
  const selector = page.getByRole("combobox", { name: "小组", exact: false });
  await expect(selector).toBeVisible();
  await selector.fill(group);
  await page.getByRole("button", { name: "添加一行", exact: true }).click();
  await page.getByLabel("查找要收发的物料").fill(name);
  await page
    .getByRole("button", { name: `选择${name}`, exact: true })
    .click();
  await page.getByLabel("入库数量", { exact: false }).fill("2");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "入库已完成" })).toBeVisible();

  // Registered as a maintainable option, not just left as free text on the
  // document: it has to reach the catalog list and the summary filter.
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "入库小组", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "入库小组列表" }).locator("tbody tr"),
  ).toContainText([group]);

  await page.goto("/#/summary");
  await expect(
    page
      .getByRole("group", { name: "入库小组", exact: true })
      .getByRole("button", { name: group, exact: true }),
  ).toBeVisible();
});
