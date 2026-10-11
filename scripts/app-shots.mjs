import { chromium, expect } from '@playwright/test';
const B = process.env.ERP_URL || 'http://127.0.0.1:5173';
const username = process.env.ERP_USERNAME;
const password = process.env.ERP_PASSWORD;
if (!username || !password) throw new Error('请设置 ERP_USERNAME 和 ERP_PASSWORD，使用专用验收账号。');
const D = 'design-system/v2/shots/app-';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('JS: ' + e.message));
p.on('console', m => m.type() === 'error' && !m.text().includes('401') && errs.push('console: ' + m.text()));

try {
await p.goto(B, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.screenshot({ path: D + 'login.png' });

await p.getByLabel('登录账号', { exact: false }).fill(username);
await p.getByLabel('登录密码', { exact: false }).fill(password);
await p.getByRole('button', { name: '登录', exact: true }).click();
await expect(p.getByRole('navigation', { name: '主要导航' })).toBeVisible();
await p.goto(B + '/#/home', { waitUntil: 'networkidle' });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.screenshot({ path: D + 'home.png' });

for (const [hash, name] of [['inventory','inventory'],['sales','sales'],['records','records'],['catalog','catalog'],['settings','settings']]) {
  await p.goto(`${B}/#/${hash}`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await expect(p.locator('main h1')).toBeVisible();
  await p.screenshot({ path: `${D}${name}.png` });
}
// 深色 + 大字
await p.goto(`${B}/#/home`, { waitUntil: 'networkidle' });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.getByLabel('切换到深色界面').click();
await p.getByLabel('大号字', { exact: true }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: D + 'dark-large.png' });

// 手机
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(`${B}/#/home`, { waitUntil: 'networkidle' });
await m.reload({ waitUntil: 'networkidle' });
await m.waitForTimeout(900);
await m.screenshot({ path: D + 'mobile-home.png' });
await m.goto(`${B}/#/inventory`, { waitUntil: 'networkidle' });
await m.reload({ waitUntil: 'networkidle' });
await m.waitForTimeout(900);
await m.screenshot({ path: D + 'mobile-inventory.png' });

console.log(errs.length ? errs.join('\n') : '无控制台错误');
if (errs.length) process.exitCode = 1;
} finally {
await b.close();
}
