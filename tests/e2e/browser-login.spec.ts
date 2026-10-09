import { test, expect } from "@playwright/test";

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };

test.beforeEach(async ({ request }) => {
  const status = await (await request.get("/api/status")).json();
  if (!status.initialized) {
    expect(
      (
        await request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "自动登录验收" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (
      await request.post("/api/login", {
        headers,
        data: { ...credentials, remember: true },
      })
    ).ok(),
  ).toBeTruthy();
});

test("桌面打开后独立浏览器自动登录，清除凭证，不能重复兑换", async ({
  request,
  browser,
}) => {
  const issued = await request.post("/api/browser-login", {
    headers,
    data: { target: "http://127.0.0.1:4289" },
  });
  expect(issued.ok()).toBeTruthy();
  const { ticket } = await issued.json();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4289/#/browser-login/${ticket}`);
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("heading", { name: /的工作台/ })).toBeVisible();
    expect(page.url()).not.toContain(ticket);
    const user = await (
      await context.request.get("http://127.0.0.1:4289/api/me")
    ).json();
    expect(user.username).toBe(credentials.username);
    const session = (await context.cookies()).find(
      (c) => c.name === "erp_session",
    )!;
    expect(session.httpOnly).toBeTruthy();
    expect(session.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400);
    expect(
      (
        await request.post("/api/browser-login/consume", {
          headers,
          data: { ticket },
        })
      ).status(),
    ).toBe(400);
    await page.reload();
    await expect(page.getByRole("navigation")).toBeVisible();
    await context.request.post("http://127.0.0.1:4289/api/logout", {
      headers,
      data: {},
    });
    expect(
      (await context.request.get("http://127.0.0.1:4289/api/me")).status(),
    ).toBe(401);
    expect((await request.get("/api/me")).ok()).toBeTruthy();
  } finally {
    await context.close();
  }
});

test("原会话退出、超时、目标不匹配均不能兑换", async ({ request }) => {
  const issue = async () => {
    const response = await request.post("/api/browser-login", {
      headers,
      data: { target: "http://127.0.0.1:4289" },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).ticket;
  };
  const revoked = await issue();
  await request.post("/api/logout", { headers, data: {} });
  expect(
    (
      await request.post("/api/browser-login/consume", {
        headers,
        data: { ticket: revoked },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/browser-login", {
        headers,
        data: { target: "http://127.0.0.1:4289" },
      })
    ).status(),
  ).toBe(401);
  await request.post("/api/login", { headers, data: credentials });
  expect(
    (
      await request.post("/api/browser-login", {
        headers,
        data: { target: "https://example.com" },
      })
    ).status(),
  ).toBe(400);
  const wrongHost = await issue();
  expect(
    (
      await request.post("/api/browser-login/consume", {
        headers: { ...headers, Host: "localhost:4289" },
        data: { ticket: wrongHost },
      })
    ).status(),
  ).toBe(400);
  const expired = await issue();
  await new Promise((resolve) => setTimeout(resolve, 30_100));
  expect(
    (
      await request.post("/api/browser-login/consume", {
        headers,
        data: { ticket: expired },
      })
    ).status(),
  ).toBe(400);
});
