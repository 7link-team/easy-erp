import { chromium } from '@playwright/test';
const B='http://127.0.0.1:8912/prototype.html';
const bad=[];
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:980}});
p.on('pageerror',e=>bad.push('JS: '+e.message));
p.on('console',m=>m.type()==='error'&&bad.push('console: '+m.text()));

await p.goto(B+'#docdetail',{waitUntil:'networkidle'});
// 弹窗：打开 / 焦点进入 / Esc 关闭 / 焦点归还
for (const id of ['pay','refund','amend','void']) {
  await p.click(`.screen.is-active [data-open="${id}"]`);
  await p.waitForTimeout(220);
  const open = await p.isVisible(`#m-${id} .modal`);
  const focusIn = await p.evaluate(i=>document.getElementById('m-'+i).contains(document.activeElement), id);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const closed = await p.isHidden(`#m-${id}`);
  const scrollOk = await p.evaluate(()=>document.body.style.overflow==='');
  if(!open) bad.push(`弹窗 ${id} 打不开`);
  if(!focusIn) bad.push(`弹窗 ${id} 焦点没进去`);
  if(!closed) bad.push(`弹窗 ${id} Esc 关不掉`);
  if(!scrollOk) bad.push(`弹窗 ${id} 关闭后没解锁滚动`);
}
// 轻提示
await p.click('.screen.is-active [data-open="pay"]'); await p.waitForTimeout(150);
await p.click('#m-pay [data-toast]'); await p.waitForTimeout(250);
if(!(await p.isVisible('.toast'))) bad.push('轻提示没出现');

// 可输入下拉：打字 → 出现新增 → 回车选中 → 标记待入库
await p.goto(B+'#invoice',{waitUntil:'networkidle'});
await p.fill('#f3','寄卖单'); await p.waitForTimeout(220);
if(!(await p.isVisible('.combo-new'))) bad.push('ComboBox 新值没出现「新增」');
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
if(!(await p.isVisible('.pending'))) bad.push('ComboBox 新值没标记「保存后加入清单」');
await p.fill('#f3','销'); await p.waitForTimeout(200);
if(!(await p.isVisible('.combo-opt mark'))) bad.push('ComboBox 搜索没高亮');
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
if(await p.isVisible('.combo-pop:not([hidden])')) bad.push('ComboBox Esc 关不掉');

// 物料选择器：开 → 搜条码 → 选 0 库存给出拒绝提示
await p.click('#addline'); await p.waitForTimeout(200);
if(!(await p.isVisible('#pickpop'))) bad.push('物料选择器打不开');
await p.fill('#pickq','6901234500131'); await p.waitForTimeout(220);
const n = await p.locator('#pickpop .picker-opt:visible').count();
if(n!==1) bad.push(`条码搜索应命中 1 条，实际 ${n}`);
await p.click('#pickpop .picker-opt:visible'); await p.waitForTimeout(250);
const t = await p.locator('.toast').last().innerText().catch(()=>'');
if(!t.includes('库存为 0')) bad.push('0 库存物料没有被拒绝');

// 权限：切换身份后菜单增减
await p.goto(B+'#workbench',{waitUntil:'networkidle'});
const cnt = async v => { await p.selectOption('#role',v); await p.waitForTimeout(200);
  return p.locator('.nav-item:visible').count(); };
const a=await cnt('admin'), s=await cnt('sales'), w=await cnt('warehouse');
if(!(a>s && a>w)) bad.push(`权限菜单没增减 管理员${a} 开单员${s} 仓管${w}`);
// 开单员不该看到财务
await p.selectOption('#role','sales'); await p.waitForTimeout(200);
if(await p.isVisible('[data-go="finance"]')) bad.push('开单员不应看到「收款」');
if(await p.isVisible('[data-go="basedata"]')) bad.push('开单员不应看到「基础资料」');

// 字号档位真的生效
await p.selectOption('#role','admin'); await p.waitForTimeout(150);
const fs = async v => { await p.click(`.size-switch [data-size="${v}"]`); await p.waitForTimeout(220);
  return p.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('tbody td')).fontSize)); };
const sm=await fs('sm'), md=await fs('md'), lg=await fs('lg');
if(!(sm<md && md<lg)) bad.push(`字号档位无效 ${sm}/${md}/${lg}`);

console.log(bad.length?bad.join('\n'):'交互全部通过');
console.log('--- 合计 '+bad.length+' 项 ---');
if (bad.length) process.exitCode = 1;
await b.close();
