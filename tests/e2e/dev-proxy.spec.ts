import { test, expect } from "@playwright/test";
import { createServer, loadConfigFromFile } from "vite";
import type { AddressInfo } from "node:net";

test("开发代理支持浏览器登录并拒绝外部来源", async ({ page, baseURL }) => {
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
  const loaded = await loadConfigFromFile({
    command: "serve",
    mode: "development",
  });
  if (!loaded) throw new Error("Vite configuration missing");
  const proxy = loaded.config.server?.proxy?.["/api"];
  if (!proxy) throw new Error("API proxy missing");
  // Only redirect the backend to the isolated E2E service; retain proxy semantics.
  const server = await createServer({
    ...loaded.config,
    configFile: false,
    server: {
      ...loaded.config.server,
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: {
        "/api":
          typeof proxy === "string" ? baseURL! : { ...proxy, target: baseURL },
      },
    },
  });
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
    await page.goto(origin);
    await page.getByLabel("登录账号", { exact: false }).fill("manager");
    await page.getByLabel("登录密码", { exact: false }).fill("wrong-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "账号或密码不正确，请检查后重试。",
    );
    await page
      .getByLabel("登录密码", { exact: false })
      .fill("Factory-test-2026");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "主要导航" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("navigation", { name: "主要导航" }),
    ).toBeVisible();
    const rejected = await page.request.post(`${origin}/api/logout`, {
      headers: { "X-ERP-Request": "1", Origin: "https://untrusted.example" },
      data: {},
    });
    expect(rejected.status()).toBe(403);
    expect(await rejected.text()).toContain("不允许此来源发起操作");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "登录库存管理" }),
    ).toBeVisible();
  } finally {
    await server.close();
  }
});
