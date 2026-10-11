import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };
const tag = () => `批量-${randomUUID().slice(0, 8)}`;
async function post(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api${path}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function table(
  request: APIRequestContext,
  mode: string,
  rows: string[][],
) {
  const response = await request.get(`/api/templates/${mode}?format=csv`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const heading = (await response.text()).trimStart().trimEnd();
  rows = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, heading.split(",").length - row.length)).fill(""),
  ]);
  return Buffer.from(
    heading +
      "\n" +
      rows
        .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
        .join("\n") +
      "\n",
  );
}
async function preview(
  request: APIRequestContext,
  mode: string,
  rows: string[][],
) {
  const response = await request.post(`/api/imports/${mode}/preview`, {
    headers,
    multipart: {
      file: {
        name: "资料.csv",
        mimeType: "text/csv",
        buffer: await table(request, mode, rows),
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function catalog(request: APIRequestContext) {
  return (await (await request.get("/api/sales/catalog")).json()).items as {
    id: string;
    name: string;
    kind: string;
    active: boolean;
    version: number;
    data: Record<string, unknown>;
  }[];
}
async function options(request: APIRequestContext) {
  return (await (await request.get("/api/material-options")).json()).items as {
    name: string;
    field: string;
  }[];
}
test.beforeEach(async ({ page }) => {
  if (!(await (await page.request.get("/api/status")).json()).initialized)
    await post(page.request, "/setup", { ...credentials, name: "管理员" });
  await post(page.request, "/login", credentials);
});

test("八类资料模板、预览不保存、原子导入、重复确认和CSV/Excel导出", async ({
  page,
}) => {
  const prefix = tag();
  const department = await post(page.request, "/sales/catalog", {
    kind: "department",
    name: `${prefix}-部门`,
  });
  const cases: [string, string[]][] = [
    [
      "customer",
      [`${prefix}-客户`, "联系人", "00123456", "地址", "启用", "7", "备注"],
    ],
    ["type", [`${prefix}-单据类型`, "否", "启用", "3", "不计款"]],
    ["account", [`${prefix}-账户`, "银行", "停用", "4", "备注"]],
    ["department", [`${prefix}-新部门`, "负责人", "启用", "2", "备注"]],
    [
      "salesperson",
      [`${prefix}-业务员`, department.name, "00123", "启用", "1", "备注"],
    ],
    ["spec", [`${prefix}-规格`, "启用", "0", ""]],
    ["kind", [`${prefix}-分类`, "启用", "0", ""]],
    ["unit", [prefix, "启用", "0", ""]],
  ];
  for (const [mode, row] of cases) {
    const before = await preview(page.request, mode, [row]);
    expect(before.errors).toEqual([]);
    expect(
      [...(await catalog(page.request)), ...(await options(page.request))].some(
        (r) => r.name === row[0],
      ),
    ).toBe(false);
    const [first, repeated] = await Promise.all([
      post(page.request, `/imports/${before.id}/commit`, {}),
      post(page.request, `/imports/${before.id}/commit`, {}),
    ]);
    expect(first).toEqual({ ok: true, count: 1 });
    expect(repeated).toEqual(first);
    const saved = [
      ...(await catalog(page.request)),
      ...(await options(page.request)),
    ].filter((r) => r.name === row[0]);
    expect(saved).toHaveLength(1);
    if (mode === "salesperson")
      expect(
        (saved[0] as { data: Record<string, unknown> }).data.department_id,
      ).toBe(department.id);
    if (mode === "customer")
      expect((saved[0] as { data: Record<string, unknown> }).data.phone).toBe(
        "00123456",
      );
    if (mode === "type")
      expect(
        (saved[0] as { data: Record<string, unknown> }).data.billable,
      ).toBe(false);
    const duplicate = await preview(page.request, mode, [row]);
    expect(duplicate.errors[0]).toContain("已存在");
    const rejected = await page.request.post(
      `/api/imports/${duplicate.id}/commit`,
      { headers, data: {} },
    );
    expect(rejected.status()).toBe(400);
    for (const format of ["csv", "xlsx"]) {
      const output = await page.request.get(
        `/api/export/${mode}?format=${format}`,
      );
      expect(output.ok()).toBe(true);
      expect(output.headers()["content-disposition"]).toMatch(
        new RegExp(`${mode}-\\d{8}\\.${format}`),
      );
      if (format === "csv") expect(await output.text()).toContain(row[0]);
      else {
        const recheck = await page.request.post(
          `/api/imports/${mode}/preview`,
          {
            headers,
            multipart: {
              file: {
                name: "导出.xlsx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                buffer: await output.body(),
              },
            },
          },
        );
        expect(recheck.ok(), await recheck.text()).toBe(true);
        expect((await recheck.json()).rows).toContainEqual(row);
      }
    }
  }
});

test("资料导入拒绝文件内重复、错误计款/状态/排序、非法单位和缺失部门", async ({
  page,
}) => {
  const name = tag();
  const cases: [string, string[][], string][] = [
    [
      "customer",
      [
        [name, "", "", "", "", "", ""],
        [` ${name.toUpperCase()} `, "", "", "", "", "", ""],
      ],
      "第 3 行",
    ],
    ["type", [[name, "", "启用", "0", ""]], "是"],
    ["account", [[name, "错误", "0", ""]], "启用"],
    ["department", [[name, "", "启用", "10000", ""]], "0–9999"],
    ["unit", [["超长计量单位".repeat(5)]], "16"],
    ["salesperson", [[name, "不存在的部门", "", "启用", "", ""]], "部门"],
    ["spec", [[name], [name.toUpperCase()]], "第 3 行"],
  ];
  for (const [mode, rows, error] of cases) {
    const result = await preview(page.request, mode, rows);
    expect(result.errors.join(" ")).toContain(error);
  }
  expect(
    [...(await catalog(page.request)), ...(await options(page.request))].some(
      (r) => r.name === name,
    ),
  ).toBe(false);
});

test("确认时竞争重复和部门停用整批回滚，旧资料与历史单据不变", async ({
  page,
}) => {
  const name = tag();
  const customer = await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: `${name}-旧客户`,
    data: { phone: "001" },
  });
  const item = await post(page.request, "/items", {
    name,
    kind: "成品",
    unit: "个",
  });
  const sale = await post(page.request, "/sales/commands", {
    request_id: randomUUID(),
    action: "save",
    input: {
      type_id: "sale",
      customer_id: customer.id,
      business_date: "2026-10-10",
      lines: [{ item_id: item.id, quantity: "1", price: "10" }],
    },
  });
  const rows = [`${name}-第一`, `${name}-冲突`].map((n) => [
    n,
    "",
    "",
    "",
    "启用",
    "",
    "",
  ]);
  const plan = await preview(page.request, "customer", rows);
  expect(plan.errors).toEqual([]);
  await post(page.request, "/sales/catalog", {
    kind: "customer",
    name: rows[1][0],
  });
  const conflict = await page.request.post(`/api/imports/${plan.id}/commit`, {
    headers,
    data: {},
  });
  expect(conflict.ok()).toBe(false);
  expect((await conflict.json()).error).toContain("整批尚未导入");
  expect((await catalog(page.request)).some((r) => r.name === rows[0][0])).toBe(
    false,
  );
  const original = (await catalog(page.request)).find(
    (r) => r.id === customer.id,
  )!;
  expect(original.data.phone).toBe("001");
  const detail = await (await page.request.get(`/api/sales/${sale.id}`)).json();
  expect(detail.customer.name).toBe(customer.name);
  const department = await post(page.request, "/sales/catalog", {
    kind: "department",
    name: `${name}-部门`,
  });
  const staff = await preview(page.request, "salesperson", [
    [name, department.name, "", "启用", "", ""],
  ]);
  expect(staff.errors).toEqual([]);
  await post(page.request, "/sales/catalog", { ...department, active: false });
  expect(
    (
      await page.request.post(`/api/imports/${staff.id}/commit`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(false);
  expect(
    (await catalog(page.request)).some(
      (r) => r.kind === "salesperson" && r.name === name,
    ),
  ).toBe(false);
});

test("资料批量接口按模块权限授权，预览绑定创建人，确认重新检查权限", async ({
  page,
  browser,
}) => {
  const roleName = tag();
  const role = await post(page.request, "/roles", {
    name: roleName,
    permissions: ["customers.read", "customers.create"],
  });
  const contexts = [];
  const usernames: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const username = `import_${randomUUID().slice(0, 8)}`;
      usernames.push(username);
      await post(page.request, "/users", {
        username,
        name: username,
        password: "Import-test-2026",
        role: role.id,
      });
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:4289",
      });
      contexts.push(context);
      await post(context.request, "/login", {
        username,
        password: "Import-test-2026",
      });
    }
    const request = contexts[0].request;
    const mode = "customer";
    const plan = await preview(request, mode, [
      [tag(), "", "", "", "启用", "", ""],
    ]);
    expect(plan.errors).toEqual([]);
    expect(
      (
        await contexts[1].request.post(`/api/imports/${plan.id}/commit`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(403);
    for (const forbidden of [
      "account",
      "type",
      "department",
      "salesperson",
      "spec",
      "kind",
      "unit",
      "items",
      "opening",
    ]) {
      expect((await request.get(`/api/templates/${forbidden}`)).status()).toBe(
        403,
      );
      expect((await request.get(`/api/export/${forbidden}`)).status()).toBe(
        403,
      );
      expect(
        (
          await request.post(`/api/imports/${forbidden}/preview`, {
            headers,
            multipart: {
              file: {
                name: "a.csv",
                mimeType: "text/csv",
                buffer: Buffer.from("名称\na"),
              },
            },
          })
        ).status(),
      ).toBe(403);
    }
    const inactive = await preview(request, "customer", [
      [tag(), "", "", "", "停用", "", ""],
    ]);
    expect(inactive.errors).not.toEqual([]);
    await post(request, `/imports/${plan.id}/commit`, {});
    const pending = await preview(request, "customer", [
      [tag(), "", "", "", "启用", "", ""],
    ]);
    await post(page.request, "/roles", {
      ...role,
      name: roleName,
      version: 1,
      permissions: ["customers.read"],
    });
    // Role changes revoke sessions; log in again with reduced permissions.
    const username = usernames[0];
    await post(request, "/login", { username, password: "Import-test-2026" });
    expect(
      (
        await request.post(`/api/imports/${pending.id}/commit`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect((await request.get("/api/export/customer?format=csv")).ok()).toBe(
      true,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("客户导入弹窗可取消，保存后刷新；筛选与ID定位导出一致，CSV公式按文本处理", async ({
  page,
}) => {
  const name = tag();
  const phone = `00${Date.now()}`;
  await page.goto("/#/customers");
  await page.getByRole("button", { name: "导入客户", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "导入客户", exact: true });
  const buffer = await table(page.request, "customer", [
    [name, "=1+1", phone, "地址", "启用", "0", ""],
  ]);
  await dialog
    .getByLabel("选择表格文件", { exact: false })
    .setInputFiles({ name: "客户.csv", mimeType: "text/csv", buffer });
  await dialog.getByRole("button", { name: "预览并检查文件" }).click();
  await expect(
    dialog.getByText("文件检查通过。确认后才会保存到库存电脑。"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect((await catalog(page.request)).some((r) => r.name === name)).toBe(
    false,
  );
  await page.getByRole("button", { name: "导入客户", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "导入客户", exact: true });
  await dialog
    .getByLabel("选择表格文件", { exact: false })
    .setInputFiles({ name: "客户.csv", mimeType: "text/csv", buffer });
  await dialog.getByRole("button", { name: "预览并检查文件" }).click();
  await expect(
    dialog.getByRole("button", { name: "确认导入 1 行" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(
    dialog.getByRole("button", { name: "确认导入 1 行" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "确认导入 1 行" }).click();
  await expect(dialog.getByText("已导入 1 行数据。")).toBeVisible();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "搜索客户", exact: true })
    .fill(phone);
  await expect(
    page.getByRole("table", { name: "客户列表" }).locator("tbody tr"),
  ).toHaveCount(1);
  let href = (await page
    .getByRole("link", { name: "导出 CSV", exact: true })
    .getAttribute("href"))!;
  let csv = await (await page.request.get(href)).text();
  expect(csv).toContain(name);
  expect(csv).toContain("'=1+1");
  expect(csv.trim().split("\n")).toHaveLength(2);
  const customer = (await catalog(page.request)).find((r) => r.name === name)!;
  await page.goto(
    `/?customer_focus=${customer.id}&customer_q=不匹配#/customers`,
  );
  href = (await page
    .getByRole("link", { name: "导出 CSV", exact: true })
    .getAttribute("href"))!;
  csv = await (await page.request.get(href)).text();
  expect(csv).toContain(name);
  expect(csv.trim().split("\n")).toHaveLength(2);
});

test("基础资料导入随当前字典切换，单位导入后只刷新候选列表", async ({
  page,
}) => {
  const name = tag();
  await page.goto("/#/catalog");
  await page.getByRole("tab", { name: "计量单位", exact: true }).click();
  await page.getByRole("button", { name: "导入计量单位", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "导入计量单位",
    exact: true,
  });
  await expect(
    dialog.getByRole("link", { name: "下载 CSV 模板" }),
  ).toHaveAttribute("href", "/api/templates/unit?format=csv");
  await dialog.getByLabel("选择表格文件", { exact: false }).setInputFiles({
    name: "单位.csv",
    mimeType: "text/csv",
    buffer: await table(page.request, "unit", [[name]]),
  });
  await dialog.getByRole("button", { name: "预览并检查文件" }).click();
  await dialog.getByRole("button", { name: "确认导入 1 行" }).click();
  await expect(dialog.getByText("已导入 1 行数据。")).toBeVisible();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("table", { name: "计量单位列表" })).toContainText(
    name,
  );
  await expect(
    page.getByRole("link", { name: "导出 CSV", exact: true }),
  ).toHaveAttribute("href", "/api/export/unit?format=csv");
});

test("业务员预览绑定部门身份，改名后复用旧名称不能悄悄更换归属", async ({
  page,
}) => {
  const name = tag();
  const department = await post(page.request, "/sales/catalog", {
    kind: "department",
    name: `${name}-部门`,
  });
  const plan = await preview(page.request, "salesperson", [
    [name, department.name, "", "启用", "0", ""],
  ]);
  expect(plan.errors).toEqual([]);
  await post(page.request, "/sales/catalog", {
    ...department,
    name: `${name}-部门改名`,
  });
  await post(page.request, "/sales/catalog", {
    kind: "department",
    name: department.name,
  });
  const response = await page.request.post(`/api/imports/${plan.id}/commit`, {
    headers,
    data: {},
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("部门已变更");
  expect(
    (await catalog(page.request)).some(
      (r) => r.kind === "salesperson" && r.name === name,
    ),
  ).toBe(false);
});
