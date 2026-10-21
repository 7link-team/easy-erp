import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chooseSelect } from "./controls";

interface StorageConfig {
  source: string;
  editable: boolean;
  backend: string;
  s3: {
    bucket: string;
    region: string;
    endpoint: string;
    prefix: string;
    path_style: boolean;
    allow_http: boolean;
    secret_set: boolean;
  };
}

const headers = { "X-ERP-Request": "1" };
const credentials = { username: "manager", password: "Factory-test-2026" };

const config = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  source: "file",
  editable: true,
  backend: "s3",
  s3: {
    bucket: "factory-erp",
    region: "oss-cn-hangzhou",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    prefix: "easy-erp",
    path_style: true,
    allow_http: false,
    secret_set: false,
    ...overrides.s3,
  },
  ...overrides,
});

async function login(page: Page) {
  if (!(await (await page.request.get("/api/status")).json()).initialized) {
    expect(
      (
        await page.request.post("/api/setup", {
          headers,
          data: { ...credentials, name: "存储设置管理员" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (
      await page.request.post("/api/login", { headers, data: credentials })
    ).ok(),
  ).toBeTruthy();
}

/** Serves GET /api/storage and records every PUT body sent to it. */
async function mockStorage(
  page: Page,
  value: StorageConfig,
  put: { status: number; json: unknown } = { status: 200, json: value },
) {
  const puts: { backend: string; s3: Record<string, unknown> }[] = [];
  await page.route("**/api/storage", async (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      await route.fulfill({ status: put.status, json: put.json });
      return;
    }
    await route.fulfill({ json: value });
  });
  return puts;
}

async function openStorage(page: Page) {
  await page.goto("/#/settings");
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "文件存储", exact: true }),
  });
  await expect(
    section.getByRole("heading", { name: "文件存储" }),
  ).toBeVisible();
  return section;
}

test("环境变量配置时文件存储表单只读并说明原因", async ({ page }) => {
  await login(page);
  await mockStorage(page, config({ source: "env", editable: false }));
  const section = await openStorage(page);
  await expect(
    section.getByText(
      "当前由环境变量配置，如需在界面修改请移除 ERP_S3_* 环境变量。",
    ),
  ).toBeVisible();
  await expect(
    section.getByRole("combobox", { name: "存储后端" }),
  ).toBeDisabled();
  await expect(section.getByLabel("桶名 Bucket")).toBeDisabled();
  await expect(section.getByLabel("区域 Region")).toBeDisabled();
  await expect(section.getByLabel("访问地址 Endpoint")).toBeDisabled();
  await expect(section.getByLabel("Secret Access Key")).toBeDisabled();
  await expect(
    section.getByRole("checkbox", { name: "使用 path-style 寻址" }),
  ).toBeDisabled();
  // Read-only means there is nothing to submit.
  await expect(
    section.getByRole("button", { name: "保存文件存储设置" }),
  ).toHaveCount(0);
});

test("阿里云 OSS 预设关闭 path-style 并给出 endpoint 占位示例", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const puts = await mockStorage(page, config({ backend: "local" }));
  const section = await openStorage(page);
  // S3 fields appear only once the S3 backend is chosen.
  await expect(section.getByLabel("桶名 Bucket")).toHaveCount(0);
  await chooseSelect(section.getByRole("combobox", { name: "存储后端" }), "s3");
  await expect(section.getByLabel("桶名 Bucket")).toBeVisible();

  const pathStyle = section.getByRole("checkbox", {
    name: "使用 path-style 寻址",
  });
  await expect(pathStyle).toHaveAttribute("data-state", "checked");
  await chooseSelect(
    section.getByRole("combobox", { name: "服务商预设" }),
    "aliyun",
  );
  await expect(pathStyle).toHaveAttribute("data-state", "unchecked");
  await expect(
    section.getByRole("checkbox", { name: "允许 HTTP 明文连接" }),
  ).toHaveAttribute("data-state", "unchecked");
  await expect(section.getByLabel("访问地址 Endpoint")).toHaveAttribute(
    "placeholder",
    "https://oss-cn-hangzhou.aliyuncs.com",
  );
  await expect(section.getByLabel("区域 Region")).toHaveAttribute(
    "placeholder",
    "oss-cn-hangzhou",
  );

  // MinIO is the opposite pair, so the preset must actually drive both switches.
  await chooseSelect(
    section.getByRole("combobox", { name: "服务商预设" }),
    "minio",
  );
  await expect(pathStyle).toHaveAttribute("data-state", "checked");
  await expect(
    section.getByRole("checkbox", { name: "允许 HTTP 明文连接" }),
  ).toHaveAttribute("data-state", "checked");

  await expect(section).toContainText("不会自动迁移");
  // Both protection layers must be visible before anyone types a bucket name
  // here, and neither may be stated alone. Per-object ACLs only cover what
  // this app writes; only a private bucket holds for everything else.
  await expect(section).toContainText("单独设为私有对象");
  await expect(section).toContainText("即使存储桶本身是公开的");
  await expect(section).toContainText("如果桶是公开可读的，保存会被拒绝");
  await expect(section).toContainText("桶级私有");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  // The server refuses the bucket root, so an empty subdirectory must never
  // leave the browser.
  await expect(section).toContainText("不能直接使用桶根目录");
  const prefix = section.getByLabel("存储子目录 Prefix");
  await prefix.fill("");
  await section.getByRole("button", { name: "保存文件存储设置" }).click();
  await expect(prefix).toHaveAttribute("aria-invalid", "true");
  expect(puts).toHaveLength(0);
  // Several levels stay acceptable.
  await prefix.fill("easy-erp/一号厂");
  await expect(prefix).not.toHaveAttribute("aria-invalid", "true");
});

test("保存失败时原样显示服务端中文错误并保留已填内容", async ({ page }) => {
  await login(page);
  const message = "无法连接对象存储：桶 factory-erp 不存在或密钥无权访问。";
  await mockStorage(
    page,
    config({ s3: { ...config().s3, path_style: false } }),
    {
      status: 400,
      json: { error: message },
    },
  );
  const section = await openStorage(page);
  await section.getByLabel("桶名 Bucket").fill("factory-erp-new");
  await section.getByLabel("Access Key ID").fill("AKIAEXAMPLE");
  await section.getByLabel("Secret Access Key").fill("secret-example");
  await section.getByRole("button", { name: "保存文件存储设置" }).click();
  await expect(section.getByText(message, { exact: true })).toBeVisible();
  // The typed values survive the failure so the operator can correct one field.
  await expect(section.getByLabel("桶名 Bucket")).toHaveValue(
    "factory-erp-new",
  );
  await expect(section.getByLabel("Access Key ID")).toHaveValue("AKIAEXAMPLE");
  await expect(section.getByLabel("Secret Access Key")).toHaveValue(
    "secret-example",
  );
});

test("已设置密钥时留空提交表示不修改密钥", async ({ page }) => {
  await login(page);
  const puts = await mockStorage(
    page,
    config({ s3: { ...config().s3, secret_set: true, path_style: false } }),
  );
  const section = await openStorage(page);
  await expect(
    section.getByText("不修改密钥请留空。", { exact: false }),
  ).toBeVisible();
  const secret = section.getByLabel("Secret Access Key");
  await expect(secret).toHaveValue("");
  // Blank keys must not be blocked by client-side validation here.
  await section.getByLabel("存储子目录 Prefix").fill("easy-erp-2026");
  await section.getByRole("button", { name: "保存文件存储设置" }).click();
  await expect(page.getByText("文件存储设置已保存。")).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0].backend).toBe("s3");
  expect(puts[0].s3.prefix).toBe("easy-erp-2026");
  expect(puts[0].s3.secret_access_key).toBeFalsy();
  expect(puts[0].s3.access_key_id).toBeFalsy();
  // secret_set is a read-only flag; the server rejects unknown fields.
  expect(puts[0].s3).not.toHaveProperty("secret_set");
});

test("恢复确认弹窗显示备份内的数据库主机与对象存储桶", async ({ page }) => {
  await login(page);
  await mockStorage(page, config({ backend: "local" }));
  const snapshot = Date.now();
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            name: "backup-20260101-000000.zip",
            created_at: snapshot,
            size: 4096,
            snapshot_at: snapshot,
            source: "manual",
            photo_count: 2,
            path: "/data/backups/backup-20260101-000000.zip",
            metadata_error: false,
          },
        ],
        schedule: { keep_days: 7 },
        last_success: "",
        last_error: "",
      },
    });
  });
  await page.route("**/api/backups/restore/preview", async (route) => {
    await route.fulfill({
      json: {
        incoming_database_host: "mysql-a.factory.lan",
        incoming_bucket: "factory-a-archive",
      },
    });
  });
  // A real restore would overwrite the e2e database, so this test never
  // confirms; it stops at the two confirmation surfaces.
  await page.goto("/#/settings");
  await page
    .getByRole("button", { name: /^恢复备份 backup-20260101-000000\.zip$/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("恢复后即将生效的目标")).toBeVisible();
  await expect(dialog.getByText("mysql-a.factory.lan")).toBeVisible();
  await expect(dialog.getByText("factory-a-archive")).toBeVisible();
  await expect(dialog).toContainText("完整备份包含数据库与存储凭据");

  await dialog.getByLabel("恢复确认").fill("恢复全部数据");
  await dialog.getByRole("button", { name: "恢复全部数据并退出登录" }).click();
  const confirm = page.getByRole("dialog").filter({
    has: page.getByText("再次确认覆盖全部数据？"),
  });
  await expect(confirm).toContainText("mysql-a.factory.lan");
  await expect(confirm).toContainText("factory-a-archive");
  await confirm.getByRole("button", { name: "取消" }).click();

  // The backup section warns that the archive carries credentials.
  await expect(
    page.getByText("备份包含数据库与存储凭据，请当作敏感文件保管。", {
      exact: false,
    }),
  ).toBeVisible();
});

test("SQLite 本地备份的空目标说明是「不指向」而不是「保持当前设置」", async ({
  page,
}) => {
  await login(page);
  await mockStorage(page, config({ backend: "local" }));
  const snapshot = Date.now();
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            name: "backup-local.zip",
            created_at: snapshot,
            size: 1024,
            snapshot_at: snapshot,
            source: "manual",
            photo_count: 0,
            path: "/data/backups/backup-local.zip",
            metadata_error: false,
          },
        ],
        schedule: { keep_days: 7 },
        last_success: "",
        last_error: "",
      },
    });
  });
  await page.route("**/api/backups/restore/preview", async (route) => {
    await route.fulfill({
      json: { incoming_database_host: "", incoming_bucket: "" },
    });
  });
  await page.goto("/#/settings");
  await page
    .getByRole("button", { name: /^恢复备份 backup-local\.zip$/ })
    .click();
  const dialog = page.getByRole("dialog");
  // Each absence has its own meaning, so each gets its own sentence, and
  // neither may claim the backup keeps whatever this machine is using now.
  await expect(
    dialog.getByText("这份备份不指向远程数据库（本地 SQLite）"),
  ).toBeVisible();
  await expect(
    dialog.getByText("这份备份不指向对象存储（本地文件）"),
  ).toBeVisible();
  await expect(dialog.getByText("保持当前设置")).toHaveCount(0);
});

test("留空密钥时服务端沿用已存密钥（真服务端，不 mock /api/storage）", async ({
  page,
}) => {
  await login(page);
  // An operator's earlier configuration, written the way the server writes it.
  // The backend stays local so seeding cannot move the live file storage, and
  // the keys are what the blank submit below must inherit.
  const file = join(process.env.ERP_E2E_DATA!, "storage.json");
  const previous = existsSync(file) ? readFileSync(file) : undefined;
  writeFileSync(
    file,
    JSON.stringify({
      backend: "local",
      s3: {
        bucket: "seeded-bucket",
        region: "us-east-1",
        endpoint: "",
        prefix: "easy-erp",
        access_key_id: "seeded-id",
        secret_access_key: "seeded-secret",
        path_style: false,
        allow_http: false,
      },
    }),
  );
  try {
    const section = await openStorage(page);
    // The seeded source is "file", not "env", so the form is editable.
    await expect(
      section.getByRole("combobox", { name: "存储后端" }),
    ).toBeEnabled();
    await chooseSelect(
      section.getByRole("combobox", { name: "存储后端" }),
      "s3",
    );
    // The S3 fields carry the seeded values, and secret_set is true because the
    // seeded file holds a secret, so both key fields are optional.
    await expect(section.getByLabel("桶名 Bucket")).toHaveValue(
      "seeded-bucket",
    );
    await expect(
      section.getByText("不修改密钥请留空。", { exact: false }),
    ).toBeVisible();
    await expect(section.getByLabel("Secret Access Key")).toHaveValue("");
    // A scheme the server rejects, so validate() fails on the endpoint rule
    // without any network call. Reaching that rule at all is the point: the
    // missing-keys rule runs first, so passing it proves the server merged the
    // stored pair instead of seeing two empty strings.
    await section.getByLabel("访问地址 Endpoint").fill("ftp://example.com");
    await section.getByRole("button", { name: "保存文件存储设置" }).click();
    const error = section.getByRole("alert");
    await expect(error).toContainText(
      "S3 endpoint 须为 http:// 或 https:// 地址。",
    );
    await expect(error).not.toContainText("请填写 S3 桶名");
  } finally {
    if (previous) writeFileSync(file, previous);
    else rmSync(file, { force: true });
  }
});

interface ScheduleShape {
  keep_days: number;
  automatic: boolean;
  interval_hours: number;
}

/**
 * Serves GET /api/backups with a mutable schedule and records every
 * PUT /api/backups/schedule, optionally failing it with a server error.
 */
async function mockSchedule(
  page: Page,
  schedule: ScheduleShape,
  put?: { status: number; json: unknown },
) {
  const state = { schedule };
  const puts: ScheduleShape[] = [];
  await page.route("**/api/backups", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        items: [],
        schedule: state.schedule,
        last_success: "",
        last_error: "",
      },
    });
  });
  await page.route("**/api/backups/schedule", async (route) => {
    const body = route.request().postDataJSON();
    puts.push(body);
    if (put) {
      await route.fulfill({ status: put.status, json: put.json });
      return;
    }
    // Persist it the way the server would, so a reload reads it back.
    state.schedule = body;
    await route.fulfill({ json: { ok: true } });
  });
  return puts;
}

const scheduleSection = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: "自动备份", exact: true }),
  });

test("关闭自动备份后保存，重新载入仍是关闭", async ({ page }) => {
  await login(page);
  await mockStorage(page, config({ backend: "local" }));
  const puts = await mockSchedule(page, {
    keep_days: 7,
    automatic: true,
    interval_hours: 1,
  });
  await page.goto("/#/settings");
  const section = scheduleSection(page);
  const toggle = section.getByRole("checkbox", { name: "开启自动备份" });
  await expect(toggle).toHaveAttribute("data-state", "checked");
  await expect(section.getByLabel("自动备份间隔（小时）")).toHaveValue("1");

  // Clear the box before switching off: the field then unmounts while holding
  // nothing, and the server still validates interval_hours as 1-168, so what
  // gets sent must fall back to the default rather than 0.
  await section.getByLabel("自动备份间隔（小时）").fill("");
  await toggle.click();
  // Nothing left to schedule, so the interval disappears.
  await expect(section.getByLabel("自动备份间隔（小时）")).toHaveCount(0);
  await section.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("备份设置已保存。")).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0].automatic).toBe(false);
  expect(puts[0].keep_days).toBe(7);
  expect(puts[0].interval_hours).toBe(1);

  await page.reload();
  const reloaded = scheduleSection(page);
  await expect(
    reloaded.getByRole("checkbox", { name: "开启自动备份" }),
  ).toHaveAttribute("data-state", "unchecked");
  await expect(reloaded.getByLabel("自动备份间隔（小时）")).toHaveCount(0);
  await expect(reloaded).toContainText("已关闭自动备份");
  await expect(reloaded).toContainText("保留天数仍对已有备份生效");
});

test("自动备份间隔越界被前端挡住，服务端错误原样显示", async ({ page }) => {
  await login(page);
  await mockStorage(page, config({ backend: "local" }));
  const message = "自动备份间隔须为 1–168 小时。";
  const puts = await mockSchedule(
    page,
    { keep_days: 7, automatic: true, interval_hours: 1 },
    { status: 400, json: { error: message } },
  );
  await page.goto("/#/settings");
  const section = scheduleSection(page);
  const interval = section.getByLabel("自动备份间隔（小时）");

  // 1-168 is enforced in the browser first, so an out-of-range value never
  // reaches the server.
  for (const value of ["0", "169", "1.5"]) {
    await interval.fill(value);
    await section.getByRole("button", { name: "保存设置" }).click();
    await expect(interval).toHaveAttribute("aria-invalid", "true");
  }
  expect(puts).toHaveLength(0);

  // The server rule is the backstop, and its Chinese text is shown verbatim.
  await interval.fill("24");
  await section.getByRole("button", { name: "保存设置" }).click();
  expect(puts).toHaveLength(1);
  expect(puts[0].interval_hours).toBe(24);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});

test("S3 存储时推荐 24 小时间隔，本地存储不推荐", async ({ page }) => {
  await login(page);
  await mockSchedule(page, {
    keep_days: 7,
    automatic: true,
    interval_hours: 1,
  });
  const recommendation = "建议把间隔调到 24";
  const cost = "每次自动备份都会重写一个完整备份包";

  await mockStorage(page, config({ backend: "s3" }));
  await page.goto("/#/settings");
  await expect(scheduleSection(page)).toContainText(recommendation);
  // An interval of 1 still reads as 每小时, not 每 1 小时 — tests/e2e/
  // backup-policy.spec.ts asserts that exact phrase.
  await expect(scheduleSection(page)).toContainText("每小时自动备份一次");
  // The reason the knob exists is stated whatever the backend is.
  await expect(scheduleSection(page)).toContainText(cost);

  await page.unroute("**/api/storage");
  await mockStorage(page, config({ backend: "local" }));
  await page.reload();
  await expect(scheduleSection(page)).toContainText(cost);
  await expect(scheduleSection(page)).not.toContainText(recommendation);
});
