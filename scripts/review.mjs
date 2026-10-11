import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:8912/prototype.html';
const SCREENS = ['workbench','inventory','invoice','doclist','docdetail','customers','returns',
  'movement','stocktake','records','finance','accounts','perf','basedata','system','backup','tokens'];
const issues = [];
const b = await chromium.launch();

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const out = { overflow: null, tiny: [], unlabeled: [], lowContrast: [], clipped: [] };
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.overflow = de.scrollWidth + '>' + de.clientWidth;
    const vis = el => el.offsetParent !== null || el === document.body;
    // 图标按钮无可访问名
    document.querySelectorAll('button, a[href]').forEach(el => {
      if (!vis(el)) return;
      const txt = (el.innerText || '').trim();
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || txt;
      if (!name) out.unlabeled.push(el.className || el.tagName);
    });
    // 输入控件无 label
    document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
      if (!vis(el)) return;
      const has = el.labels?.length || el.getAttribute('aria-label') || el.closest('label');
      if (!has) out.unlabeled.push('input#' + (el.id || el.name || '?'));
    });
    // 过小字号
    document.querySelectorAll('body *').forEach(el => {
      if (!vis(el) || !el.firstChild || el.firstChild.nodeType !== 3) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 10.5) out.tiny.push(Math.round(fs * 10) / 10 + 'px: ' + el.textContent.trim().slice(0, 18));
    });
    // 文本被裁切
    document.querySelectorAll('td, th, .t-main, .btn, .tag, .nav-item').forEach(el => {
      if (!vis(el)) return;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible')
        out.clipped.push((el.textContent || '').trim().slice(0, 20));
    });
    return out;
  });
  if (r.overflow) issues.push(`${label} 横向溢出 ${r.overflow}`);
  [...new Set(r.unlabeled)].forEach(x => issues.push(`${label} 无可访问名: ${x}`));
  [...new Set(r.tiny)].slice(0, 4).forEach(x => issues.push(`${label} 字号过小 ${x}`));
  [...new Set(r.clipped)].slice(0, 4).forEach(x => issues.push(`${label} 文本裁切 "${x}"`));
}

for (const [w, h, tag] of [[1440, 980, 'PC'], [1180, 820, 'PC窄'], [390, 844, '手机']]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', e => errs.push('JS: ' + e.message));
  for (const s of SCREENS) {
    await page.goto(`${BASE}#${s}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(220);
    await audit(page, `${tag}/${s}`);
  }
  // 深色 + 大字号组合
  await page.goto(`${BASE}#workbench`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.dataset.size = 'lg'; });
  await page.waitForTimeout(260);
  await audit(page, `${tag}/深色+大字`);
  errs.forEach(e => issues.push(`${tag} 控制台: ${e.slice(0, 110)}`));
  await page.close();
}
console.log(issues.length ? issues.join('\n') : '无问题');
console.log('--- 合计 ' + issues.length + ' 项 ---');
if (issues.length) process.exitCode = 1;
await b.close();
