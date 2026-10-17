import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { chooseSelect } from "./controls";

test("服务器首次数据库表单支持MySQL错误重试，再选择SQLite并创建管理员", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-setup-ui-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address() as { port: number };
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ERP_SERVER_MODE: "true",
    ERP_SETUP_TOKEN: "setup-ui-test-token-2026",
  };
  delete env.ERP_DATABASE_URL;
  const child = spawn(
    resolve(
      `target/debug/easy-erp-server${process.platform === "win32" ? ".exe" : ""}`,
    ),
    ["--data-dir", dir, "--bind", `127.0.0.1:${address.port}`],
    { env, stdio: "ignore", windowsHide: true },
  );
  try {
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(`${base}/api/status`)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "服务器首次初始化" }),
    ).toBeVisible();
    await page
      .getByLabel("初始化口令 必填", { exact: true })
      .fill("setup-ui-test-token-2026");
    await chooseSelect(
      page.getByRole("combobox", { name: "数据库类型 必填", exact: true }),
      "mysql",
    );
    await page.getByLabel("MySQL 主机 必填", { exact: true }).fill("127.0.0.1");
    await page.getByLabel("MySQL 端口 必填", { exact: true }).fill("1");
    await page.getByLabel("数据库名称 必填", { exact: true }).fill("inventory");
    await page
      .getByLabel("数据库用户名 必填", { exact: true })
      .fill("inventory");
    await page
      .getByLabel("数据库密码 选填", { exact: true })
      .fill("not-in-page-errors");
    await page.getByRole("button", { name: "保存并初始化数据库" }).click();
    await expect(
      page.getByText(
        "无法连接 MySQL，请检查连接信息、数据库是否存在及账号权限。",
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByLabel("MySQL 主机 必填", { exact: true }),
    ).toHaveValue("127.0.0.1");
    await chooseSelect(
      page.getByRole("combobox", { name: "数据库类型 必填", exact: true }),
      "sqlite",
    );
    await page.getByRole("button", { name: "保存并初始化数据库" }).click();
    await expect(page.getByRole("button", { name: "设置并登录" })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByLabel("初始化口令 必填", { exact: true }),
    ).toHaveValue("setup-ui-test-token-2026");
    await page
      .getByLabel("管理员姓名 必填", { exact: true })
      .fill("初始化验收");
    await page.getByLabel("登录账号 必填", { exact: true }).fill("setup-test");
    await page
      .getByLabel("登录密码 必填", { exact: true })
      .fill("Setup-browser-2026");
    await page.getByRole("button", { name: "设置并登录", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/api/status`)).json())
            .initialized,
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "设置并登录", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: resolve("build-artifacts/tmp/database-setup-admin.png"),
    });
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null)
      await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});
