import { test, expect, type Page } from "@playwright/test";

async function start(
  page: Page,
  mobile = false,
  automaticUpdate?: { version: string; cached?: boolean; ready?: boolean },
) {
  await page.addInitScript(
    ({ mobile, automaticUpdate }) => {
      (window as any).__installed = false;
      (window as any).__automaticUpdate = automaticUpdate;
      (window as any).__automaticChecks = 0;
      (window as any).__TAURI__ = {
        core: {
          invoke: async (command: string, args: any) => {
            if (command === "update_info")
              return {
                version: "0.1.0",
                enabled: !mobile,
                mobile,
                channel:
                  sessionStorage.getItem("test_update_channel") || "stable",
              };
            if (command === "set_update_channel") {
              sessionStorage.setItem("test_update_channel", args.channel);
              return;
            }
            if (command === "mobile_disconnect") {
              (window as any).__disconnected = true;
              return;
            }
            if (command === "check_update") {
              if (args.automatic) {
                (window as any).__automaticChecks++;
                return (window as any).__automaticUpdate ?? { skipped: true };
              }
              return {
                enabled: true,
                version:
                  sessionStorage.getItem("test_update_channel") === "preview"
                    ? "0.3.0-beta.1"
                    : "0.2.0",
                notes: "更新验收",
              };
            }
            if (command === "download_update") {
              window.dispatchEvent(
                new CustomEvent("erp:update-progress", {
                  detail: { downloaded: 100, total: 100 },
                }),
              );
              return;
            }
            if (command === "install_update") {
              (window as any).__installed = true;
              throw new Error("安装失败测试，库存服务已恢复");
            }
          },
        },
      };
    },
    { mobile, automaticUpdate },
  );
  const status = await (await page.request.get("/api/status")).json();
  if (!status.initialized)
    await page.request.post("/api/setup", {
      headers: { "X-ERP-Request": "1" },
      data: {
        username: "manager",
        password: "Factory-test-2026",
        name: "更新验收管理员",
      },
    });
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: false }).fill("manager");
  await page.getByLabel("登录密码", { exact: false }).fill("Factory-test-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: /^(主要导航|更多功能)$/ }),
  ).toBeVisible();
}

async function freezeClock(page: Page) {
  const time = new Date("2026-10-12T01:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

test("缓存的新版本等连续空闲后提示，键盘鼠标触摸都会重新计时", async ({
  page,
}) => {
  await freezeClock(page);
  await start(page, false, { version: "0.2.0", cached: true });
  const dialog = page.getByRole("dialog", { name: "应用更新", exact: true });
  await expect(dialog).toHaveCount(0);
  for (const event of [
    "keydown",
    "pointermove",
    "pointerdown",
    "wheel",
    "touchstart",
    "touchmove",
  ]) {
    await page.clock.fastForward(29_000);
    await expect(dialog).toHaveCount(0);
    await page.evaluate(
      (event) => window.dispatchEvent(new Event(event)),
      event,
    );
  }
  await page.clock.fastForward(29_000);
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(dialog).toContainText("发现新版本 0.2.0");
});

test("有未提交内容时发现的更新在操作结束后补提示，不再联网检查", async ({
  page,
}) => {
  await freezeClock(page);
  await start(page);
  // Let React's lazy route/Suspense timers finish before freezing the idle clock.
  await page.clock.resume();
  await page.getByRole("link", { name: /我要入库/ }).click();
  const note = page.getByLabel("备注或原因", { exact: false });
  await note.fill("等待操作结束再更新");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.evaluate(() => {
    (window as any).__automaticUpdate = { version: "0.2.0" };
  });
  await page.clock.fastForward(60 * 60_000);
  await expect
    .poll(() => page.evaluate(() => (window as any).__automaticChecks))
    .toBe(2);
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(note).toHaveValue("等待操作结束再更新");
  await note.fill("");
  await page.clock.fastForward(29_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The idle timer resets on every tick that still sees unsaved content, and
  // the form clears that flag from a React effect, so one late tick moves the
  // whole thirty seconds. Carrying on well past the threshold keeps this about
  // the behaviour — nothing before the wait, a prompt after it — rather than
  // about which side of a one-second margin a tick landed on.
  await page.clock.fastForward(15_000);
  await expect(
    page.getByRole("dialog", { name: "应用更新", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__automaticChecks)).toBe(2);
});

test("隐藏窗口恢复及其他对话框关闭后重新等待空闲", async ({ page }) => {
  await freezeClock(page);
  await start(page, false, { version: "0.2.0" });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(29_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "test-existing-dialog";
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.clock.fastForward(60_000);
  await expect(
    page.getByRole("dialog", { name: "应用更新", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    document.getElementById("test-existing-dialog")!.remove(),
  );
  await page.clock.fastForward(29_000);
  await expect(
    page.getByRole("dialog", { name: "应用更新", exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(
    page.getByRole("dialog", { name: "应用更新", exact: true }),
  ).toBeVisible();
});

test("稍后不重复提示同一版本，下一版本仍会在空闲时提示", async ({ page }) => {
  await freezeClock(page);
  await start(page, false, { version: "0.2.0" });
  await page.clock.fastForward(31_000);
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__automaticUpdate = { version: "0.2.0", cached: true };
  });
  await page.clock.fastForward(60 * 60_000);
  await expect
    .poll(() => page.evaluate(() => (window as any).__automaticChecks))
    .toBe(2);
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__automaticUpdate = { version: "0.3.0" };
  });
  await page.clock.fastForward(60 * 60_000);
  await expect
    .poll(() => page.evaluate(() => (window as any).__automaticChecks))
    .toBe(3);
  await page.clock.fastForward(2_000);
  await expect(
    page.getByRole("dialog", { name: "应用更新", exact: true }),
  ).toContainText("发现新版本 0.3.0");
});

test("手动立即打开缓存更新，已下载状态跨自动检查时段保留", async ({ page }) => {
  await freezeClock(page);
  await start(page, false, { version: "0.2.0", cached: true, ready: true });
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.clock.fastForward(2 * 60 * 60_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__automaticChecks)).toBe(1);
});

test("后台检查未完成时手动打开，不发起并发检查或再次自动弹窗", async ({
  page,
}) => {
  await freezeClock(page);
  await start(page);
  await page.evaluate(() => {
    const original = (window as any).__TAURI__.core.invoke;
    (window as any).__pendingChecks = 0;
    (window as any).__TAURI__.core.invoke = (command: string, args: any) => {
      if (command === "check_update") {
        (window as any).__pendingChecks++;
        return new Promise((resolve) => {
          (window as any).__finishCheck = resolve;
        });
      }
      return original(command, args);
    };
  });
  await page.clock.fastForward(60 * 60_000);
  await expect
    .poll(() => page.evaluate(() => (window as any).__pendingChecks))
    .toBe(1);
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("正在检查新版本");
  await page.evaluate(() =>
    (window as any).__finishCheck({ version: "0.2.0" }),
  );
  await expect(page.getByRole("dialog")).toContainText("发现新版本 0.2.0");
  expect(await page.evaluate(() => (window as any).__pendingChecks)).toBe(1);
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("应用更新下载、取消安装和安装失败反馈", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await expect(page.getByText("发现新版本 0.2.0")).toBeVisible();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(
    page.getByText("下载完成，签名验证通过。可以稍后安装。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "安装并重启", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "安装更新并重启？",
    exact: true,
  });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__installed)).toBe(false);
  await page.getByRole("button", { name: "安装并重启", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "备份并安装更新", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("库存服务已恢复");
  expect(await page.evaluate(() => (window as any).__installed)).toBe(true);
});

test("未提交的入库内容阻止应用更新安装", async ({ page }) => {
  await start(page);
  await page.request.post("/api/items", {
    headers: { "X-ERP-Request": "1" },
    data: { name: "更新保护物料", kind: "原材料", unit: "个", precision: 0 },
  });
  await page.getByRole("link", { name: /我要入库/ }).click();
  await page.getByRole("button", { name: "添加一行", exact: true }).click();
  await page.getByLabel("查找要收发的物料").fill("更新保护物料");
  await page
    .getByRole("button", { name: "选择更新保护物料", exact: true })
    .click();
  await page.getByLabel("入库数量", { exact: false }).fill("3");
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.getByRole("button", { name: "安装并重启", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("还有未提交的收发内容");
  expect(await page.evaluate(() => (window as any).__installed)).toBe(false);
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await expect(page.getByLabel("入库数量", { exact: false })).toHaveValue("3");
});

test("手机连接设置可用，320px 顶栏不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await start(page, true);
  await expect(
    page.getByRole("button", { name: "连接设置", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "连接设置", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__disconnected)).toBe(true);
});

test("库存服务升级提示刷新，不丢失未提交内容", async ({ page }) => {
  let version = "0.1.0";
  let checks = 0;
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), version } });
    checks++;
  });
  await start(page);
  await expect.poll(() => checks).toBeGreaterThanOrEqual(2);
  await page.getByRole("link", { name: /我要入库/ }).click();
  await page
    .getByLabel("备注或原因", { exact: false })
    .fill("升级时保留的内容");
  version = "0.2.0";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".service-update")).toContainText(
    "库存服务已更新至 0.2.0",
  );
  await page
    .locator(".service-update")
    .getByRole("button", { name: "刷新页面" })
    .click();
  await expect(page.locator(".service-update")).toContainText("请先完成或取消");
  await expect(page.getByLabel("备注或原因", { exact: false })).toHaveValue(
    "升级时保留的内容",
  );
});

test("稍后更新后可从独立页面继续，下载状态跨页面保留", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "检查应用更新", exact: true }).click();
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "版本", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主要导航", exact: true })
    .getByRole("link", { name: "工作台", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await page.getByRole("button", { name: "安装并重启", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
});

test("更新页面检查失败可重试，离开页面不弹出旧提示", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const original = (window as any).__TAURI__.core.invoke;
    let failed = false;
    (window as any).__TAURI__.core.invoke = async (
      command: string,
      args: any,
    ) => {
      if (command === "check_update" && !args.automatic && !failed) {
        failed = true;
        throw new Error("网络连接失败，请重试");
      }
      return original(command, args);
    };
  });
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("网络连接失败");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下载更新", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主要导航", exact: true })
    .getByRole("link", { name: "工作台", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("手机更多菜单可进入更新页面，窄屏与横屏不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page, true);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "关于", exact: true })
    .click();
  await expect(
    page.getByText("移动端请通过原安装渠道更新。", { exact: false }),
  ).toBeVisible();
  for (const size of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath("update-mobile.png"),
    fullPage: true,
  });
});

test("Web 更新页显示服务版本和刷新入口", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    delete (window as any).__TAURI__;
  });
  // The native bridge is removed before the next application mount.
  await page.addInitScript(() => {
    delete (window as any).__TAURI__;
  });
  await page.goto("/#/updates");
  await page.reload();
  await expect(
    page.getByText("当前库存服务版本", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新页面", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载更新", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("update-web.png"),
    fullPage: true,
  });
});

test("下载切换直连时显示提示、重置进度并可完成", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const original = (window as any).__TAURI__.core.invoke;
    (window as any).__TAURI__.core.invoke = async (
      command: string,
      args: any,
    ) => {
      if (command === "download_update")
        return new Promise((resolve) => {
          (window as any).__finishDownload = resolve;
        });
      return original(command, args);
    };
  });
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("erp:update-progress", {
        detail: { downloaded: 0, fallback: true },
      }),
    ),
  );
  await expect(
    page.getByText("代理下载未成功，已自动切换到 GitHub 直连。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("已下载 0.0 MB", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__finishDownload());
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
});

test("显示实际检查线路、回退结果，切换页面后保留", async ({ page }) => {
  await start(page);
  await page.getByRole("link", { name: "关于", exact: true }).click();
  const routes = page.getByRole("region", { name: "更新网络线路" });
  await expect(routes).toContainText("本次打开尚未检查");
  await page.evaluate(() => {
    const original = (window as any).__TAURI__.core.invoke;
    (window as any).__TAURI__.core.invoke = async (
      command: string,
      args: any,
    ) => {
      if (command !== "check_update") return original(command, args);
      window.dispatchEvent(
        new CustomEvent("erp:update-route", {
          detail: {
            operation: "check",
            status: { source: "proxy", state: "connecting", fallback: false },
          },
        }),
      );
      await new Promise((resolve) => {
        (window as any).__finishCheck = resolve;
      });
      window.dispatchEvent(
        new CustomEvent("erp:update-route", {
          detail: {
            operation: "check",
            status: { source: "github", state: "success", fallback: true },
          },
        }),
      );
      return { current: true, enabled: true };
    };
  });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(routes).toContainText("gh-proxy.com 代理 · 正在连接");
  await page.evaluate(() => (window as any).__finishCheck());
  await expect(routes).toContainText("GitHub 直连 · 已完成（已自动切换线路）");
  await expect(routes).toContainText("本次打开尚未下载");
  await page
    .getByRole("navigation", { name: "主要导航", exact: true })
    .getByRole("link", { name: "工作台", exact: true })
    .click();
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await expect(routes).toContainText("GitHub 直连 · 已完成（已自动切换线路）");
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("更新渠道默认稳定，取消切换保持原值，确认后保存并重新检查", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("link", { name: "关于", exact: true }).click();
  const channel = page.getByRole("combobox", { name: "更新渠道", exact: true });
  await expect(channel).toContainText("稳定版");
  await channel.click();
  await page
    .getByRole("option", { name: "测试版（Beta / RC）", exact: true })
    .click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(channel).toContainText("稳定版");
  await channel.click();
  await page
    .getByRole("option", { name: "测试版（Beta / RC）", exact: true })
    .click();
  await page.getByRole("button", { name: "确认切换", exact: true }).click();
  await expect(channel).toContainText("测试版");
  await expect(
    page.getByRole("heading", { name: "发现新版本 0.3.0-beta.1" }),
  ).toBeVisible();
  await page.reload();
  await expect(channel).toContainText("测试版");
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("切换渠道清除已下载的包，保存失败保持原渠道", async ({ page }) => {
  await start(page);
  await page.getByRole("link", { name: "关于", exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toBeVisible();
  const channel = page.getByRole("combobox", { name: "更新渠道", exact: true });
  await channel.click();
  await page
    .getByRole("option", { name: "测试版（Beta / RC）", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("清除已下载的更新包");
  await page.getByRole("button", { name: "确认切换", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "安装并重启", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "发现新版本 0.3.0-beta.1" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = (window as any).__TAURI__.core.invoke;
    (window as any).__TAURI__.core.invoke = (command: string, args: any) => {
      if (command === "set_update_channel") throw new Error("保存失败测试");
      return original(command, args);
    };
  });
  await channel.click();
  await page
    .getByRole("option", { name: "稳定版（推荐）", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("保存失败测试");
  await expect(channel).toContainText("测试版");
});
