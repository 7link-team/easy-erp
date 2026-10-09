import { test, expect } from "@playwright/test";

test("误建物料删除确认、保留审计；历史库存和普通账号不能删除", async ({
  page,
  playwright,
}) => {
  const headers = { "X-ERP-Request": "1" };
  const password = "Factory-test-2026";
  const status = await (await page.request.get("/api/status")).json();
  if (!status.initialized)
    await page.request.post("/api/setup", {
      headers,
      data: { username: "manager", name: "管理员", password },
    });
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: false }).fill("manager");
  await page.getByLabel("登录密码", { exact: false }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const create = async (name: string) => {
    const response = await page.request.post("/api/items", {
      headers,
      data: { name, spec: "M6", kind: "其他", unit: "个", precision: 0 },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).id;
  };
  const id = await create("误建删除验收");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "库存", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "误建删除验收" });
  await row.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除物料" });
  await expect(dialog).toContainText("误建删除验收");
  await expect(dialog).toContainText("M6");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  const audit = await (await page.request.get("/api/audit")).json();
  expect(
    audit.items.some((a: any) => a.action === "删除物料" && a.object_id === id),
  ).toBeTruthy();

  const historical = await create("历史不可删除验收");
  const move = async (kind: string) =>
    page.request.post("/api/movements", {
      headers,
      data: {
        request_id: crypto.randomUUID(),
        kind,
        lines: [{ item_id: historical, quantity: "1" }],
      },
    });
  expect((await move("receipt")).ok()).toBeTruthy();
  expect(
    (
      await page.request.delete(`/api/items/${historical}/permanent`, {
        headers,
      })
    ).status(),
  ).toBe(409);
  expect((await move("issue")).ok()).toBeTruthy();
  expect(
    (
      await page.request.delete(`/api/items/${historical}/permanent`, {
        headers,
      })
    ).status(),
  ).toBe(409);
  const counted = await create("清点不可删除验收");
  await page.request.post("/api/stocktakes", {
    headers,
    data: { item_ids: [counted] },
  });
  expect(
    (
      await page.request.delete(`/api/items/${counted}/permanent`, { headers })
    ).status(),
  ).toBe(409);
  await page.request.post("/api/users", {
    headers,
    data: {
      username: "delete_worker",
      name: "操作员",
      password,
      role: "worker",
      can_in: true,
      can_out: true,
      can_count: false,
    },
  });
  await page.reload();
  const historicalRow = page
    .getByRole("row")
    .filter({ hasText: "历史不可删除验收" });
  await expect(
    historicalRow.getByRole("button", { name: "删除", exact: true }),
  ).toHaveCount(0);
  await historicalRow
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认停用", exact: true })
    .click();
  await expect(historicalRow).toHaveCount(0);
  const worker = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:4289",
  });
  try {
    expect(
      (
        await worker.post("/api/login", {
          headers,
          data: { username: "delete_worker", password },
        })
      ).ok(),
    ).toBeTruthy();
    const untouched = await create("越权删除保护");
    expect(
      (
        await worker.delete(`/api/items/${untouched}/permanent`, { headers })
      ).status(),
    ).toBe(403);
  } finally {
    await worker.dispose();
  }
});
