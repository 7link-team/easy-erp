/* 真应用的对比度与溢出抽查：深浅主题 × 三档字号 × 桌面/手机 */
import { chromium, expect } from '@playwright/test';
const B = process.env.ERP_URL || 'http://127.0.0.1:5173';
const username = process.env.ERP_USERNAME;
const password = process.env.ERP_PASSWORD;
if (!username || !password) throw new Error('请设置 ERP_USERNAME 和 ERP_PASSWORD，使用专用验收账号。');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 980 } });
const p = await ctx.newPage();
const bad = [];
p.on('pageerror', e => bad.push('JS: ' + e.message));
p.on('console', m => m.type() === 'error' && !m.text().includes('401') && bad.push('console: ' + m.text()));
try {
await p.goto(B);
await p.getByLabel('登录账号', { exact: false }).fill(username);
await p.getByLabel('登录密码', { exact: false }).fill(password);
await p.getByRole('button', { name: '登录', exact: true }).click();
await expect(p.getByRole('navigation', { name: '主要导航' })).toBeVisible();

const probe = () => p.evaluate(() => {
  const lum = (c) => {
    const [r, g, bl] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  /* 兼容 rgb()/rgba() 与 color(srgb r g b)：后者分量是 0–1，要换算成 0–255 */
  const parse = (s) => {
    const n = (s.match(/[\d.]+/g) || []).map(Number);
    const v = n.slice(0, 3);
    return [...(s.startsWith('color(') ? v.map(x => x * 255) : v), n[3] ?? 1];
  };
  const blend = (f, g) => f.slice(0, 3).map((v, i) => v * f[3] + g[i] * (1 - f[3]));
  /* 渐变 / 图片底无法用单色算对比度，整支链路上出现就跳过，交给人眼看 */
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      if (+cs.opacity !== 1) return null;
      const bg = parse(cs.backgroundColor);
      layers.push(bg);
      if (bg[3] === 1) break;
    }
    return layers.reverse().reduce((g, f) => blend(f, g), [255, 255, 255]);
  };
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.offsetParent === null) return;
    const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!t) return;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 10.5) out.push({ k: 'tiny', v: fs, s: el.textContent.trim().slice(0, 16) });
    const f = parse(cs.color), g = bgOf(el);
    if (!g) return;
    const ink = blend(f, g);
    const r = (Math.max(lum(ink), lum(g)) + 0.05) / (Math.min(lum(ink), lum(g)) + 0.05);
    const big = fs >= 24 || (fs >= 18.666 && +cs.fontWeight >= 700);
    if (r < (big ? 3 : 4.5))
      out.push({
        k: 'contrast',
        v: Math.round(r * 100) / 100,
        s: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${cs.color} on rgb(${g.map(Math.round)}) 「${el.textContent.trim().slice(0, 12)}」`,
      });
  });
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push({ k: 'overflow', v: de.scrollWidth, s: '' });
  return out;
});

for (const [w, h, tag] of [[1440, 980, 'PC'], [390, 844, '手机']]) {
  await p.setViewportSize({ width: w, height: h });
  for (const theme of ['light', 'dark'])
    for (const size of ['sm', 'md', 'lg'])
      for (const page of ['home', 'inventory', 'records', 'catalog', 'settings']) {
        await p.goto(`${B}/#/${page}`, { waitUntil: 'networkidle' });
        await p.reload({ waitUntil: 'networkidle' });
        await expect(p.getByRole('navigation', { name: '主要导航' })).toBeVisible();
        await expect(p.locator('main h1')).toBeVisible();
        await p.evaluate(([t, s]) => { document.documentElement.dataset.theme = t; document.documentElement.dataset.size = s; }, [theme, size]);
        await p.waitForTimeout(260);
        for (const i of await probe())
          bad.push(`${tag}/${theme}/${size}/${page} ${i.k} ${i.v} ${i.s}`);
      }
}
const uniq = [...new Set(bad)];
console.log(uniq.length ? uniq.slice(0, 40).join('\n') : '无问题');
console.log('--- 合计 ' + uniq.length + ' 项 ---');
console.log('抽查范围：5 个页面；渐变、图片及整体透明度背景需另行人工检查。');
if (uniq.length) process.exitCode = 1;
} finally {
await b.close();
}
