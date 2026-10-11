import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("服务身份与本地数据目录一致，嵌入页面不依赖外部 Web 目录", async ({
  request,
}) => {
  const response = await request.get("/api/status");
  expect(response.ok()).toBeTruthy();
  const status = await response.json();
  const expected = readFileSync(
    join(process.env.ERP_E2E_DATA!, "instance-id"),
    "utf8",
  ).trim();
  expect(status.instance_id).toBe(expected);
  expect(status.instance_id).toMatch(/^[0-9a-f-]{36}$/);
  const page = await request.get("/");
  expect(page.headers()["content-type"]).toContain("text/html");
  expect(await page.text()).toContain('id="root"');
  const deepLink = await request.get("/inventory");
  expect(deepLink.headers()["content-type"]).toContain("text/html");
  expect((await request.get("/api/does-not-exist")).status()).toBe(404);
});
