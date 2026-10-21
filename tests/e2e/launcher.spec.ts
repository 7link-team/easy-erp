import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Options = {
  mode?: string;
  serverUrl?: string;
  databaseConfigured?: boolean;
};

// The launcher is served by Tauri rather than the dev server, so it is loaded
// straight off disk behind a fake window.__TAURI__, the same way
// desktop-recovery.spec.ts loads it.
async function start(page: Page, options: Options = {}) {
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
  await page.addInitScript((options: Options) => {
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
          if (state.failures?.[command]) throw state.failures[command];
          if (command === "connection_settings")
            return {
              mode: options.mode ?? "",
              server_url: options.serverUrl ?? "",
              autostart: false,
              database_configured:
                state.databaseConfigured ?? options.databaseConfigured ?? false,
            };
          if (command === "start_local") {
            state.databaseConfigured = true;
            if (state.failLocalAfterSetup)
              throw "数据库已配置，但本机服务启动失败";
          }
          return state.results?.[command] ?? null;
        },
      },
    };
  }, options);
  await page.goto("http://desktop.test/");
  await expect(page.locator("#maintenance")).toBeEnabled();
}

// The legacy single-page form still lives in #direct-entry and repeats several
// of the stepper's labels, so every lookup is scoped to one of the two.
const wizard = (page: Page) => page.locator("#setup");
const steps = (page: Page) =>
  page.getByRole("navigation", { name: "初始化步骤" }).getByRole("listitem");

const calls = (page: Page, command: string) =>
  page.evaluate(
    (command) =>
      (window as any).nativeCalls.filter((c: any) => c.command === command),
    command,
  );

// Nothing may be written before the last step submits. Reading preferences and
// showing the window are what the launcher already does on every start.
const readOnly = [
  "connection_settings",
  "show_launcher",
  "recovery_select_backup",
];
const quiet = async (page: Page) =>
  expect(
    await page.evaluate(
      (readOnly) =>
        (window as any).nativeCalls
          .map((call: any) => call.command)
          .filter((command: string) => !readOnly.includes(command)),
      readOnly,
    ),
  ).toEqual([]);

async function fillMysql(page: Page) {
  await wizard(page).getByLabel("MySQL 主机").fill("mysql.internal");
  await wizard(page).getByLabel("数据库名称").fill("inventory");
  await wizard(page).getByLabel("数据库用户名").fill("inventory");
  await wizard(page).getByLabel("数据库密码").fill("local-test-password");
  await wizard(page).getByLabel("使用 TLS 加密连接").check();
}

test("未配置时显示步骤器", async ({ page }) => {
  await start(page, { databaseConfigured: false });
  await expect(page.locator("#setup")).toBeVisible();
  await expect(page.locator("#direct-entry")).toBeHidden();
});

test("已配置过的启动不再显示初始化选择，进入时沿用原库", async ({ page }) => {
  await start(page, { databaseConfigured: true });
  await expect(page.locator("#setup")).toBeHidden();
  await expect(page.locator("#direct-entry")).toBeVisible();
  await expect(page.locator("#database-saved")).toBeVisible();
  await page.locator("#local").click();
  expect((await calls(page, "start_local"))[0].args.database).toBeUndefined();
});

test("本机服务走完四步，MySQL 与 S3 一次性提交，中途不落盘也不走 HTTP", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await start(page, { databaseConfigured: false });
  await expect(steps(page)).toHaveText([
    "1. 运行模式",
    "2. 数据库",
    "3. 文件存储",
    "4. 确认",
  ]);
  await expect(steps(page).nth(0).getByRole("button")).toHaveAttribute(
    "aria-current",
    "step",
  );

  await page.getByRole("button", { name: "下一步" }).click();
  await expect(wizard(page).getByLabel("数据库类型")).toHaveValue("sqlite");
  await expect(page.locator("#setup-mysql")).toBeHidden();
  await wizard(page).getByLabel("数据库类型").selectOption("mysql");
  await expect(page.locator("#setup-mysql")).toBeVisible();
  // Incomplete MySQL details must not advance the stepper.
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(steps(page).nth(1).getByRole("button")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await fillMysql(page);
  await page.getByRole("button", { name: "下一步" }).click();

  await wizard(page).getByLabel("存储方式").selectOption("s3");
  await expect(page.locator("#setup-s3")).toContainText(
    "附件与备份都会以私有对象写入这个存储桶，不会公开可读。",
  );
  await wizard(page).getByLabel("MinIO / 自建").check();
  await expect(wizard(page).getByLabel("访问地址 Endpoint")).toHaveValue(
    "http://192.168.1.20:9000",
  );
  await expect(
    wizard(page).getByLabel("使用路径寻址 Path Style"),
  ).toBeChecked();
  await expect(wizard(page).getByLabel("允许明文 HTTP 连接")).toBeChecked();
  await expect(wizard(page).getByLabel("路径前缀")).toHaveValue("easy-erp");
  await wizard(page).getByLabel("存储桶 Bucket").fill("inventory-files");
  await wizard(page).getByLabel("Access Key ID").fill("minio-key");
  await wizard(page).getByLabel("Secret Access Key").fill("minio-secret");
  await page.getByRole("button", { name: "下一步" }).click();

  await expect(page.locator("#setup-summary")).toContainText("mysql.internal");
  await expect(page.locator("#setup-summary")).toContainText("inventory-files");
  await quiet(page);

  await page.getByRole("button", { name: "完成配置" }).click();
  expect(await calls(page, "start_local")).toEqual([
    {
      command: "start_local",
      args: {
        database: {
          kind: "mysql",
          host: "mysql.internal",
          port: 3306,
          database: "inventory",
          username: "inventory",
          password: "local-test-password",
          tls: true,
        },
        storage: {
          backend: "s3",
          s3: {
            bucket: "inventory-files",
            region: "us-east-1",
            endpoint: "http://192.168.1.20:9000",
            prefix: "easy-erp",
            access_key_id: "minio-key",
            secret_access_key: "minio-secret",
            path_style: true,
            allow_http: true,
          },
        },
      },
    },
  ]);
  await expect(page.locator("#setup")).toBeHidden();
  // Everything reached the backend over IPC; the page itself is the only HTTP.
  expect(
    requests.filter(
      (url) =>
        !["index.html", "app.js", "style.css", ""].includes(
          new URL(url).pathname.slice(1),
        ),
    ),
  ).toEqual([]);
});

test("SQLite 与本地目录提交最简配置", async ({ page }) => {
  await start(page, { databaseConfigured: false });
  for (const name of ["下一步", "下一步", "下一步", "完成配置"])
    await page.getByRole("button", { name, exact: true }).click();
  expect((await calls(page, "start_local"))[0].args).toEqual({
    database: { kind: "sqlite" },
    storage: { backend: "local", s3: null },
  });
});

test("配置已保存但服务启动失败时，重试直接沿用原配置且不回显密码", async ({
  page,
}) => {
  await start(page, { databaseConfigured: false });
  await page.evaluate(() => {
    (window as any).failLocalAfterSetup = true;
  });
  await page.getByRole("button", { name: "下一步" }).click();
  await wizard(page).getByLabel("数据库类型").selectOption("mysql");
  await fillMysql(page);
  for (const name of ["下一步", "下一步", "完成配置"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("#status")).toHaveText(
    "数据库已配置，但本机服务启动失败",
  );
  // The saved configuration survives the failure, so the stepper steps aside.
  await expect(page.locator("#setup")).toBeHidden();
  await expect(page.locator("#database-saved")).toBeVisible();
  await expect(page.locator("#setup-mysql-password")).toHaveValue("");

  await page.evaluate(() => {
    (window as any).failLocalAfterSetup = false;
  });
  await page.locator("#local").click();
  const attempts = await calls(page, "start_local");
  expect(attempts[0].args.database).toEqual({
    kind: "mysql",
    host: "mysql.internal",
    port: 3306,
    database: "inventory",
    username: "inventory",
    password: "local-test-password",
    tls: true,
  });
  expect(attempts[1].args.database).toBeUndefined();
  await expect(page.locator("#status")).toHaveText("");
});

test("仅客户端只有两步，完成后调用 connect_host", async ({ page }) => {
  await start(page, { databaseConfigured: false });
  await wizard(page).getByLabel("仅作为客户端", { exact: false }).check();
  await expect(steps(page)).toHaveText(["1. 运行模式", "2. 确认"]);
  await wizard(page)
    .getByLabel("库存电脑地址")
    .fill("http://192.168.1.20:4280");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.locator("#setup-summary")).toContainText(
    "http://192.168.1.20:4280",
  );
  await quiet(page);
  await page.getByRole("button", { name: "完成配置" }).click();
  expect(await calls(page, "connect_host")).toEqual([
    { command: "connect_host", args: { address: "http://192.168.1.20:4280" } },
  ]);
});

test("恢复模式选备份后执行恢复并重启", async ({ page }) => {
  await start(page, { databaseConfigured: false });
  await page.evaluate(() => {
    (window as any).results = {
      recovery_select_backup: "/fixture/external/snapshot.zip",
    };
  });
  await wizard(page).getByLabel("从备份恢复", { exact: false }).check();
  await expect(steps(page)).toHaveText(["1. 运行模式", "2. 确认"]);
  await page
    .getByRole("button", { name: "选择备份文件（ZIP / 旧版）" })
    .click();
  await expect(page.locator("#setup-backup")).toContainText("snapshot.zip");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "完成配置" }).click();
  expect(await calls(page, "recovery_execute")).toEqual([
    {
      command: "recovery_execute",
      args: {
        action: "restore",
        confirmation: "恢复全部数据",
        backup: "/fixture/external/snapshot.zip",
        restart: true,
      },
    },
  ]);
});

test("步骤列表可回退，窄窗口不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 680 });
  await start(page, { databaseConfigured: false });
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(steps(page).nth(2).getByRole("button")).toHaveAttribute(
    "aria-current",
    "step",
  );
  // Steps ahead of the current one stay unreachable.
  await expect(steps(page).nth(3).getByRole("button")).toBeDisabled();
  await steps(page).nth(0).getByRole("button").click();
  await expect(steps(page).nth(0).getByRole("button")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByRole("group", { name: "运行模式" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("连接已有库存电脑会带着填写的地址调用 connect_host", async ({ page }) => {
  await start(page, { databaseConfigured: true });
  await page
    .locator("#direct-entry")
    .getByLabel("库存电脑地址")
    .fill("http://192.168.1.20:4280");
  await page.getByRole("button", { name: "保存连接并进入" }).click();
  expect(await calls(page, "connect_host")).toEqual([
    { command: "connect_host", args: { address: "http://192.168.1.20:4280" } },
  ]);
});

const REMOTE = "http://192.168.1.20:4280";

test("重进当前的本机不弹确认，一次点击就进入", async ({ page }) => {
  await start(page, { mode: "local", databaseConfigured: true });
  await page.locator("#local").click();
  await expect(page.locator("#switch")).toBeHidden();
  expect(await calls(page, "start_local")).toHaveLength(1);
});

test("重进当前的远程主机不弹确认", async ({ page }) => {
  await start(page, {
    mode: "remote",
    serverUrl: REMOTE,
    databaseConfigured: true,
  });
  await expect(
    page.locator("#direct-entry").getByLabel("库存电脑地址"),
  ).toHaveValue(REMOTE);
  await page.getByRole("button", { name: "保存连接并进入" }).click();
  await expect(page.locator("#switch")).toBeHidden();
  expect(await calls(page, "connect_host")).toHaveLength(1);
});

test("从本机切到远程要确认，文案写明两端，取消不发任何调用", async ({
  page,
}) => {
  await start(page, { mode: "local", databaseConfigured: true });
  await page.locator("#direct-entry").getByLabel("库存电脑地址").fill(REMOTE);
  await page.getByRole("button", { name: "保存连接并进入" }).click();

  const dialog = page.locator("#switch");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#switch-detail")).toHaveText(
    `当前连接：本机 → 将要连接：${REMOTE}`,
  );
  await expect(dialog).toContainText("录入的单据会进那一台的账本");
  await expect(page.locator("#switch-cancel")).toBeFocused();
  expect(await calls(page, "connect_host")).toHaveLength(0);

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#direct-entry")).toBeVisible();
  expect(await calls(page, "connect_host")).toHaveLength(0);

  await page.getByRole("button", { name: "保存连接并进入" }).click();
  await page.getByRole("button", { name: "确认切换" }).click();
  expect(await calls(page, "connect_host")).toEqual([
    { command: "connect_host", args: { address: REMOTE } },
  ]);
});

test("从远程切回本机要确认，文案里的本机一端不是空字符串", async ({ page }) => {
  await start(page, {
    mode: "remote",
    serverUrl: REMOTE,
    databaseConfigured: true,
  });
  await page.locator("#local").click();
  await expect(page.locator("#switch")).toBeVisible();
  await expect(page.locator("#switch-detail")).toHaveText(
    `当前连接：${REMOTE} → 将要连接：本机`,
  );
  expect(await calls(page, "start_local")).toHaveLength(0);

  // Escape is the same answer as 取消.
  await page.keyboard.press("Escape");
  await expect(page.locator("#switch")).toBeHidden();
  expect(await calls(page, "start_local")).toHaveLength(0);

  await page.locator("#local").click();
  await page.getByRole("button", { name: "确认切换" }).click();
  expect(await calls(page, "start_local")).toHaveLength(1);
});

test("首次运行的步骤器不弹切换确认", async ({ page }) => {
  await start(page, { databaseConfigured: false });
  for (const name of ["下一步", "下一步", "下一步", "完成配置"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("#switch")).toBeHidden();
  expect(await calls(page, "start_local")).toHaveLength(1);
});
