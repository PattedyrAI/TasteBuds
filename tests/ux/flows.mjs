// End-to-end checks of the camera and sugar-free flows against the running app and its real API.
import {chromium} from '@playwright/test';
import {sessionCookie} from './fake-auth.mjs';
const base=process.env.APP_URL||'http://localhost:3100',results={};
const check=(name,ok,detail='')=>{results[name]={ok:!!ok,detail};console.log(ok?'PASS':'FAIL',name,detail);};
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
async function session(mobile){
  const ctx=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},permissions:['camera']});
  const c=sessionCookie(1);await ctx.addCookies([{name:c.name,value:c.value,url:base}]);
  const page=await ctx.newPage();await page.goto(base+'/app');await page.waitForLoadState('networkidle');return {ctx,page};
}
const api=(page,path)=>page.evaluate(p=>fetch(p).then(r=>r.json()),path);
const dialog=page=>page.locator('dialog[open]').last();
// Desktop: live camera viewfinder, shutter uploads a photo into the rating.
{const {ctx,page}=await session(false);
 await page.getByRole('button',{name:'Rate something'}).first().click();
 await dialog(page).getByRole('button',{name:'Take photo'}).click();
 await page.waitForSelector('dialog.camera-modal video',{timeout:5000});
 await page.waitForFunction(()=>document.querySelector('dialog.camera-modal video')?.videoWidth>0,null,{timeout:8000});
 await page.locator('dialog.camera-modal').getByRole('button',{name:'Take photo'}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog.camera-modal[open]')&&document.querySelector('dialog[open] .review-photo-tile img'),null,{timeout:15000}).then(()=>check('desktop camera captures and attaches a photo',true)).catch(e=>check('desktop camera captures and attaches a photo',false,String(e).slice(0,120)));
 // Click outside with a photo attached asks before discarding.
 await page.mouse.click(720,5);await page.waitForTimeout(300);
 check('outside click on a started rating asks first',await dialog(page).getByText('Discard this rating?').count()===1);
 await dialog(page).getByRole('button',{name:'Discard'}).click();await page.waitForTimeout(500);
 check('discard closes the rating',await page.locator('dialog[open]').count()===0);
 check('history stays in the app after discard',page.url().startsWith(base+'/app'));
 await ctx.close();}
// Phone: Take photo hands off to the native camera via a capture input.
{const {ctx,page}=await session(true);
 await page.getByRole('button',{name:/^rate$/i}).click();
 const [chooser]=await Promise.all([page.waitForEvent('filechooser',{timeout:5000}),dialog(page).getByRole('button',{name:'Take photo'}).click()]);
 const capture=await chooser.element().getAttribute('capture');
 check('phone Take photo opens the camera input',capture==='environment',`capture=${capture}`);
 await chooser.setFiles('/tmp/tb-ux/photos/p11.jpg');
 await page.waitForSelector('dialog[open] .review-photo-tile img',{timeout:15000}).then(()=>check('phone photo attaches',true)).catch(()=>check('phone photo attaches',false));
 await page.goBack();await page.waitForTimeout(300);
 check('phone back button asks before discarding a started rating',await dialog(page).getByText('Discard this rating?').count()===1);
 await dialog(page).getByRole('button',{name:'Discard'}).click();await page.waitForTimeout(500);
 check('phone back then discard closes and stays in app',await page.locator('dialog[open]').count()===0&&page.url().startsWith(base+'/app'));
 await ctx.close();}
// Sugar-free on an existing product: switches to the sibling, or creates the other version.
{const {ctx,page}=await session(false);
 const boot=await api(page,'/api/bootstrap'),gid=boot.groups[0].id;
 const items=await api(page,`/api/groups/${gid}/items?limit=200`);
 const find=(brand,name,sf)=>items.find(i=>i.brand===brand&&i.name===name&&(i.variant==='Sugarfree')===sf);
 const regular=find('Red Bull','Original',false),sugarfree=find('Red Bull','Original',true),mango=find('Monster','Mango Loco',false);
 const before=sugarfree.tastingCount;
 async function rateViaDetail(item,score){
  await page.goto(`${base}/app?item=${item.id}`);await page.waitForLoadState('networkidle');await page.waitForSelector('dialog[open] .score-panel');
  await dialog(page).getByRole('button',{name:/Rate it/}).click();await page.waitForTimeout(400);
  await dialog(page).locator('input[type=file]:not([capture])').setInputFiles('/tmp/tb-ux/photos/p11.jpg');await page.waitForSelector('dialog[open] .review-photo-tile img');
  await page.waitForFunction(()=>!document.querySelector('dialog[open] .inline-status'));const toggle=dialog(page).getByRole('switch',{name:/Sugar-free/});
  const enabled=await toggle.isEnabled();await dialog(page).locator('.switch-field').click();await page.waitForTimeout(300);
  const hint=await dialog(page).locator('p.hint[role=status]').textContent().catch(()=>'');
  await dialog(page).locator('input[type=number]').fill(String(score));
  await dialog(page).getByRole('button',{name:'Save rating'}).click();await page.waitForFunction(()=>!document.getElementById('rating-form'),null,{timeout:15000}).catch(async e=>{throw new Error('save did not close: '+await dialog(page).locator('.error, .hint').allTextContents().then(t=>t.join(' / ')));});
  return {enabled,hint};
 }
 const a=await rateViaDetail(regular,6.2);
 check('sugar-free switch is usable on an existing product',a.enabled);
 const afterItems=await api(page,`/api/groups/${gid}/items?limit=200`);
 check('switching to sugar-free moves the rating to the existing sugar-free item',afterItems.find(i=>i.id===sugarfree.id).tastingCount===before+1&&afterItems.find(i=>i.id===regular.id).tastingCount===regular.tastingCount,a.hint);
 const b=await rateViaDetail(mango,7.1);
 const created=(await api(page,`/api/groups/${gid}/items?limit=200`)).filter(i=>i.brand==='Monster'&&i.name==='Mango Loco');
 check('sugar-free without a sibling creates the sugar-free version',created.length===2&&created.some(i=>i.variant==='Sugarfree'&&i.tastingCount===1),b.hint);
 await ctx.close();}
// Review regressions (TKT-9324 round 1).
{const {ctx,page}=await session(false);
 const boot=await api(page,'/api/bootstrap'),gid=boot.groups[0].id;
 const items=await api(page,`/api/groups/${gid}/items?limit=200`);
 const mine=items.find(i=>i.myScore!=null);
 // Date-only edit asks before discarding.
 await page.goto(`${base}/app?view=mine`);await page.waitForLoadState('networkidle');
 await page.getByRole('button',{name:/^Edit your review/}).first().click();await page.waitForSelector('#rating-form');
 await dialog(page).locator('summary').click();await dialog(page).locator('input[type=date]').fill('2026-01-02');
 await dialog(page).getByRole('button',{name:'Close'}).click();await page.waitForTimeout(300);
 check('date-only edit asks before discarding',await dialog(page).getByText('Discard this rating?').count()===1);
 await dialog(page).getByRole('button',{name:'Discard'}).click();await page.waitForTimeout(500);
 // Rate again with a slow save, open the photo viewer meanwhile; afterwards one Back closes the item.
 let release;const gate=new Promise(r=>release=r);
 await page.route('**/api/ratings',async route=>{if(route.request().method()==='POST'){await gate;}await route.continue();});
 await page.goto(`${base}/app?item=${mine.itemId??mine.id}`);await page.waitForSelector('dialog[open] .score-panel');
 await dialog(page).getByRole('button',{name:/Rate it/}).click();await page.waitForSelector('#rating-form');
 await dialog(page).locator('input[type=file]:not([capture])').setInputFiles('/tmp/tb-ux/photos/p2.jpg');await page.waitForFunction(()=>!document.querySelector('dialog[open] .inline-status'));
 await dialog(page).getByRole('button',{name:'Save rating'}).click();await page.waitForTimeout(200);
 await dialog(page).getByRole('button',{name:/Enlarge photo 1/}).click();await page.waitForTimeout(300);
 release();await page.waitForFunction(()=>!document.getElementById('rating-form'),null,{timeout:15000});await page.waitForTimeout(600);
 const detailOpen=await page.locator('dialog[open] .score-panel').count();
 await page.goBack();await page.waitForTimeout(500);
 check('after a save replaces two dialogs, one Back closes the item',detailOpen===1&&await page.locator('dialog[open]').count()===0&&page.url().startsWith(base+'/app'));
 await page.unroute('**/api/ratings');await ctx.close();}
await browser.close();
const failed=Object.entries(results).filter(([,r])=>!r.ok);console.log(failed.length?`${failed.length} FAILED`:'ALL PASSED');process.exitCode=failed.length?1:0;
