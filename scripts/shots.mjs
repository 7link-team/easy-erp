import { chromium } from '@playwright/test';
const B='http://127.0.0.1:8912/prototype.html';
const D='design-system/v2/shots/';
const b=await chromium.launch();

async function shot(name,{w=1440,h=980,hash='workbench',act,dark,size}={}) {
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
  await p.goto(B+'#'+hash,{waitUntil:'networkidle'});
  if(dark) await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  if(size) await p.evaluate(s=>document.documentElement.dataset.size=s,size);
  await p.waitForTimeout(350);
  if(act) await act(p);
  await p.waitForTimeout(450);
  await p.screenshot({path:D+name+'.png'});
  await p.close();
}
await shot('d-modal-pay',{hash:'docdetail',act:async p=>p.locator('.screen.is-active [data-open="pay"]').first().click()});
await shot('d-modal-void',{hash:'docdetail',act:async p=>p.click('.screen.is-active [data-open="void"]')});
await shot('d-combo',{hash:'invoice',h:900,act:async p=>{await p.fill('#f3','寄卖单');}});
await shot('d-picker',{hash:'invoice',h:1060,act:async p=>{await p.click('#addline');await p.fill('#pickq','螺');}});
await shot('d-dark',{hash:'workbench',dark:true,h:1040});
await shot('d-large',{hash:'doclist',size:'lg',h:1000});
await shot('d-role-sales',{hash:'workbench',h:1040,act:async p=>p.selectOption('#role','sales')});
await shot('m-detail',{w:390,h:900,hash:'docdetail'});
await shot('m-modal',{w:390,h:900,hash:'docdetail',act:async p=>p.locator('.screen.is-active [data-open="pay"]').first().click()});
await shot('m-basedata',{w:390,h:900,hash:'basedata'});
console.log('shots done');
await b.close();
