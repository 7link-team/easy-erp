import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function launcher(
  page: Page,
  mode = "local",
  failStart = true,
  databaseConfigured = true,
) {
  await page.route("http://desktop.test/**", (route) => {
    const name =
      new URL(route.request().url()).pathname.slice(1) || "index.html";
    const allowed = ["index.html", "app.js", "style.css"];
    if (!allowed.includes(name)) return route.abort();
    return route.fulfill({
      body: readFileSync(resolve("desktop/ui", name)),
      contentType: name.endsWith("js")
        ? "text/javascript"
        : name.endsWith("css")
          ? "text/css"
          : "text/html",
    });
  });
  await page.addInitScript(
    ({ mode, failStart, databaseConfigured }) => {
      const state = window as any;
      state.nativeCalls = [];
      state.nativeListeners = {};
      state.__TAURI__ = {
        event: {
          listen: async (name: string, callback: unknown) => {
            state.nativeListeners[name] = callback;
          },
        },
        core: {
          invoke: async (command: string, args: any) => {
            state.nativeCalls.push({ command, args });
            if (command === "connection_settings")
              return {
                mode,
                server_url: "http://remote.test:4280",
                autostart: false,
                database_configured:
                  state.databaseConfigured ?? databaseConfigured,
              };
            if (command === "start_local" && state.failLocalAfterSetup) {
              state.databaseConfigured = true;
              throw "数据库已配置，但本机服务启动失败";
            }
            if (command === "resume_last" && failStart)
              throw "本机服务启动失败：数据库损坏";
            if (command === "recovery_list" && state.listFailure)
              throw state.listFailure;
            if (command === "recovery_list")
              return {
                data_dir: "/fixture/local",
                backups_dir: "/fixture/local/backups",
                remote_mode: mode === "remote",
                items: [
                  {
                    name: "snapshot.zip",
                    path: "/fixture/local/backups/snapshot.zip",
                    size: 4096,
                    snapshot_at: Date.UTC(2026, 9, 12, 2),
                  },
                  {
                    name: "broken.zip",
                    path: "/fixture/local/backups/broken.zip",
                    size: 8,
                    created_at: Date.UTC(2026, 9, 12, 2),
                    metadata_error: true,
                  },
                ],
              };
            if (command === "recovery_select_backup")
              return "/fixture/external/photos.zip";
            if (command === "recovery_execute")
              return new Promise((resolve, reject) => {
                state.completeRecovery = resolve;
                state.failRecovery = reject;
              });
          },
        },
      };
    },
    { mode, failStart, databaseConfigured },
  );
  await page.goto("http://desktop.test/");
  await expect(page.locator("#maintenance")).toBeEnabled();
}

test("启动失败后可维护，精确确认且执行中锁住所有选项和关闭", async ({
  page,
}) => {
  await launcher(page);
  await expect(page.locator("#status")).toContainText("数据库损坏");
  await page.getByRole("button", { name: "本机数据维护", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("/fixture/local");
  await expect(dialog).toContainText("清空数据（不含备份数据）");
  await expect(dialog).toContainText("图片、账号与设置");
  const submit = page.locator("#recovery-submit");
  await expect(submit).toBeDisabled();
  await page.locator("#recovery-confirm").fill("清空全部数据 ");
  await expect(submit).toBeDisabled();
  await page.locator("#recovery-confirm").fill("清空全部数据");
  await submit.click();
  await expect(page.locator("#recovery-action")).toBeDisabled();
  await expect(page.locator("#recovery-close")).toBeDisabled();
  await expect(page.locator("#recovery-confirm")).toBeDisabled();
  await expect(page.locator("#recovery-restart")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).nativeCalls.filter(
      (call: any) => call.command === "recovery_execute",
    ),
  );
  expect(calls).toEqual([
    {
      command: "recovery_execute",
      args: {
        action: "reset",
        confirmation: "清空全部数据",
        backup: null,
        restart: false,
      },
    },
  ]);
  await page.evaluate(() =>
    (window as any).completeRecovery({ started: false }),
  );
  await expect(page.locator("#recovery-status")).toContainText("手动启动");
  await expect(submit).toBeDisabled();
  await page.locator("#recovery-close").click();
  await page.locator("#local").click();
  expect(
    await page.evaluate(() =>
      (window as any).nativeCalls.some(
        (call: any) => call.command === "start_local",
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "本机数据维护", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("#recovery-confirm")).toHaveValue("");
  await expect(page.locator("#recovery-action")).toBeEnabled();
});

test("远程连接时菜单进入维护只显示本机范围，选择ZIP恢复后立即启动", async ({
  page,
}) => {
  await launcher(page, "remote", false);
  await page.evaluate(() =>
    (window as any).nativeListeners["open-recovery"]({}),
  );
  await expect(page.locator("#recovery-remote")).toBeVisible();
  await expect(page.locator("#recovery-remote")).toContainText(
    "不影响远程主机",
  );
  await page.locator("#recovery-action").selectOption("restore");
  await page.locator("#recovery-confirm").fill("恢复全部数据");
  await expect(page.locator("#recovery-submit")).toBeDisabled();
  await page
    .locator("#recovery-backup")
    .selectOption("/fixture/local/backups/snapshot.zip");
  await expect(page.locator("#recovery-submit")).toBeEnabled();
  await page.locator("#recovery-pick").click();
  await expect(page.locator("#recovery-external")).toContainText(
    "/fixture/external/photos.zip",
  );
  await page.locator("#recovery-restart").check();
  await page.locator("#recovery-submit").click();
  expect(await page.evaluate(() => (window as any).nativeCalls.at(-1))).toEqual(
    {
      command: "recovery_execute",
      args: {
        action: "restore",
        confirmation: "恢复全部数据",
        backup: "/fixture/external/photos.zip",
        restart: true,
      },
    },
  );
  await page.evaluate(() =>
    (window as any).completeRecovery({
      started: true,
      warnings: ["请确认恢复后的图片"],
      previous_data: "/fixture/protected",
    }),
  );
  await expect(page.locator("#recovery-status")).toContainText("已启动");
  await expect(page.locator("#recovery-status")).toContainText(
    "/fixture/protected",
  );
});

test("单独清空备份说明不可恢复、业务不变，失败后可重试", async ({ page }) => {
  await launcher(page);
  await page.locator("#maintenance").click();
  await page.locator("#recovery-action").selectOption("clear-backups");
  await expect(page.locator("#recovery-description")).toContainText("不可恢复");
  await expect(page.locator("#recovery-description")).toContainText(
    "现有业务数据、图片、账号与设置不变",
  );
  await page.locator("#recovery-confirm").fill("清空全部备份");
  await page.locator("#recovery-submit").click();
  await page.evaluate(() =>
    (window as any).failRecovery("本机服务现已停止；可重试维护或手动启动"),
  );
  await expect(page.locator("#recovery-status")).toContainText("手动启动");
  await expect(page.locator("#recovery-submit")).toBeEnabled();
  await expect(page.locator("#recovery-close")).toBeEnabled();
  await page.locator("#recovery-action").selectOption("reset");
  await expect(page.locator("#recovery-confirm")).toHaveValue("");
  await expect(page.locator("#recovery-submit")).toBeDisabled();
});

test("备份时间易读，损坏元数据不妨碍清空，读取权限异常阻止操作", async ({
  page,
}) => {
  await launcher(page);
  await page.locator("#maintenance").click();
  const snapshotTime = await page.evaluate(() =>
    new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(Date.UTC(2026, 9, 12, 2)),
  );
  await expect(page.locator("#recovery-backup option").nth(1)).toHaveText(
    `snapshot.zip · ${snapshotTime}`,
  );
  await page.locator("#recovery-action").selectOption("restore");
  await page
    .locator("#recovery-backup")
    .selectOption("/fixture/local/backups/broken.zip");
  await expect(page.locator("#recovery-backup-detail")).toContainText(
    "备份元数据读取失败",
  );
  await expect(page.locator("#recovery-backup-detail")).not.toContainText(
    "true",
  );
  await page.locator("#recovery-action").selectOption("reset");
  await page.locator("#recovery-confirm").fill("清空全部数据");
  await expect(page.locator("#recovery-submit")).toBeEnabled();
  await page.evaluate(() => {
    (window as any).listFailure = "备份目录读取权限不足";
  });
  await page.locator("#recovery-refresh").click();
  await expect(page.locator("#recovery-status")).toContainText("权限不足");
  await expect(page.locator("#recovery-submit")).toBeDisabled();
});

test("窄屏维护对话框可键盘操作，标签与焦点不被遮挡", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await launcher(page);
  await page.locator("#maintenance").click();
  await expect(page.getByLabel("维护操作", { exact: true })).toBeFocused();
  await page.getByLabel("维护操作", { exact: true }).selectOption("restore");
  await page
    .getByLabel("选择本机备份", { exact: true })
    .selectOption("/fixture/local/backups/snapshot.zip");
  const confirmation = page.getByLabel("输入“恢复全部数据”确认", {
    exact: true,
  });
  await confirmation.fill("恢复全部数据");
  await expect(confirmation).toBeFocused();
  const layout = await confirmation.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const dialog = document.querySelector("dialog")!;
    const modal = dialog.getBoundingClientRect();
    return {
      focusedVisible: bounds.top >= modal.top && bounds.bottom <= modal.bottom,
      noModalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
      noPageOverflow:
        document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  expect(layout).toEqual({
    focusedVisible: true,
    noModalOverflow: true,
    noPageOverflow: true,
  });
  const restart = page.getByLabel("完成后立即启动本机库存管理", {
    exact: true,
  });
  // Safari follows macOS Full Keyboard Access for Tab-to-checkbox behavior.
  // Both engines must still support focus and keyboard activation.
  if (testInfo.project.name !== "webkit") {
    await page.keyboard.press("Tab");
    await expect(restart).toBeFocused();
  } else {
    await restart.focus();
  }
  await page.keyboard.press("Space");
  await expect(restart).toBeChecked();
  await page.screenshot({
    path: `/tmp/desktop-recovery-${testInfo.project.name}-narrow.png`,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#maintenance")).toBeFocused();
});

test("首次桌面启动可选SQLite或MySQL，校验表单并只通过IPC提交配置", async ({
  page,
}) => {
  await launcher(page, "", false, false);
  await expect(page.locator("#database-form")).toBeVisible();
  await expect(page.locator("#database-kind")).toHaveValue("sqlite");
  await page.locator("#database-kind").selectOption("mysql");
  await expect(page.locator("#mysql-fields")).toBeVisible();
  await page.locator("#local").click();
  expect(
    await page.evaluate(() =>
      (window as any).nativeCalls.filter(
        (c: any) => c.command === "start_local",
      ),
    ),
  ).toHaveLength(0);
  await page.locator("#mysql-host").fill("mysql.internal");
  await page.locator("#mysql-database").fill("inventory");
  await page.locator("#mysql-username").fill("inventory");
  await page.locator("#mysql-password").fill("local-test-password");
  await page.locator("#mysql-tls").check();
  await page.locator("#local").click();
  await expect(page.locator("#database-form")).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        (window as any).nativeCalls.find(
          (c: any) => c.command === "start_local",
        ).args.database,
    ),
  ).toEqual({
    kind: "mysql",
    host: "mysql.internal",
    port: 3306,
    database: "inventory",
    username: "inventory",
    password: "local-test-password",
    tls: true,
  });
  await expect(page.locator("#mysql-password")).toHaveValue("");
  await expect(page.locator("#database-saved")).toBeVisible();
  await page.locator("#local").click();
  const last = await page.evaluate(() =>
    (window as any).nativeCalls
      .filter((c: any) => c.command === "start_local")
      .at(-1),
  );
  expect(last.args.database).toBeUndefined();
});

test("已配置的桌面启动隐藏初始化选择并保留原库", async ({ page }) => {
  await launcher(page, "local", false, true);
  await expect(page.locator("#database-form")).toBeHidden();
  await expect(page.locator("#database-saved")).toBeVisible();
  await page.locator("#local").click();
  expect(
    await page.evaluate(
      () =>
        (window as any).nativeCalls.find(
          (c: any) => c.command === "start_local",
        ).args.database,
    ),
  ).toBeUndefined();
});

test("数据库配置已保存但服务启动失败时，重试直接沿用原配置", async ({
  page,
}) => {
  await launcher(page, "", false, false);
  await page.evaluate(() => {
    (window as any).failLocalAfterSetup = true;
  });
  await page.locator("#local").click();
  await expect(page.locator("#status")).toHaveText(
    "数据库已配置，但本机服务启动失败",
  );
  await expect(page.locator("#database-form")).toBeHidden();
  await expect(page.locator("#database-saved")).toBeVisible();
  await page.evaluate(() => {
    (window as any).failLocalAfterSetup = false;
  });
  await page.locator("#local").click();
  const calls = await page.evaluate(() =>
    (window as any).nativeCalls.filter(
      (call: any) => call.command === "start_local",
    ),
  );
  expect(calls[0].args.database).toEqual({ kind: "sqlite" });
  expect(calls[1].args.database).toBeUndefined();
  await expect(page.locator("#status")).toHaveText("");
});
