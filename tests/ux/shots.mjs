// Quick screenshots of key screens: node tests/ux/shots.mjs <outdir>
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {sessionCookie} from './fake-auth.mjs';
const base=process.env.APP_URL||'http://localhost:3100',out=process.argv[2]||'/tmp/tb-ux/shots';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
for(const [name,vp] of [['m',{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}],['d',{width:1440,height:900}]]){
  const ctx=await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:vp.isMobile,hasTouch:vp.hasTouch,deviceScaleFactor:vp.deviceScaleFactor||1});
  const c=sessionCookie(1);await ctx.addCookies([{name:c.name,value:c.value,url:base}]);
  const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>m.type()==='error'&&errs.push(m.text()));
  for(const view of (process.env.VIEWS||'home,collection,feed,stats,mine').split(',')){await page.goto(`${base}/app${view==='home'?'':`?view=${view}`}`);await page.waitForLoadState('networkidle');await page.waitForTimeout(500);await page.screenshot({path:`${out}/${name}-${view}.png`,fullPage:!!process.env.FULL});}
  await page.goto(`${base}/app`);await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:/^rate$|rate something/i}).filter({visible:true}).first().click();await page.waitForTimeout(500);await page.screenshot({path:`${out}/${name}-rate.png`});
  await page.locator('dialog[open] input[type=file]:not([capture])').setInputFiles('/tmp/tb-ux/photos/p11.jpg');await page.waitForTimeout(1500);
  await page.locator('dialog[open]').getByRole('radio',{name:'Drink'}).check();await page.waitForTimeout(300);
  await page.locator('dialog[open]').getByRole('button',{name:'Energy drinks'}).click().catch(()=>{});await page.waitForTimeout(300);
  await page.screenshot({path:`${out}/${name}-rate-filled.png`});
  await page.keyboard.press('Escape');await page.waitForTimeout(400);await page.screenshot({path:`${out}/${name}-rate-discard.png`});
  await page.locator('dialog[open]').getByRole('button',{name:'Discard'}).click().catch(()=>{});await page.waitForTimeout(400);
  await page.goto(`${base}/app?view=collection`);await page.waitForLoadState('networkidle');await page.locator('.item-card .card-open-hit').first().click();await page.waitForTimeout(900);await page.screenshot({path:`${out}/${name}-item.png`});
  console.log(name,'errors',errs.slice(0,5));await ctx.close();
}
await browser.close();
