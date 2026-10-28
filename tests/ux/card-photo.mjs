// Card photo enlargement and "keep my place" checks: node tests/ux/card-photo.mjs [outdir]
// Needs the seeded local app from README.md. Exits non-zero on any failure.
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {sessionCookie} from './fake-auth.mjs';
const base=process.env.APP_URL||'http://localhost:3100',out=process.argv[2]||'/tmp/tb-ux/card-photo';mkdirSync(out,{recursive:true});
const failures=[],check=(ok,what)=>{console.log(`${ok?'ok  ':'FAIL'} ${what}`);if(!ok)failures.push(what);};
const browser=await chromium.launch();
for(const [name,vp] of [['m',{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}],['d',{width:1440,height:700}]]){
  const ctx=await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:vp.isMobile,hasTouch:vp.hasTouch,deviceScaleFactor:vp.deviceScaleFactor||1});
  const c=sessionCookie(1);await ctx.addCookies([{name:c.name,value:c.value,url:base}]);
  const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>m.type()==='error'&&errs.push(m.text()));
  await page.goto(`${base}/app?view=collection`);await page.waitForLoadState('networkidle');
  const cards=page.locator('.item-card'),card=cards.nth(Math.min(5,await cards.count()-1));
  await card.scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,40));await page.waitForTimeout(300);
  const y0=await page.evaluate(()=>window.scrollY),url0=page.url(),cardName=await card.locator('h2').innerText();
  check(y0>200,`${name}: list scrolled before opening (${y0}px)`);
  // Tap where a finger would land, so whatever is on top at that point receives it.
  const tap=async locator=>{const box=await locator.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;if(vp.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);};
  const photoButton=card.getByRole('button',{name:new RegExp(`^Enlarge photo of ${cardName}`)});
  check(await photoButton.count()===1,`${name}: card photo is a labelled button`);
  // 1. Tapping the photo opens it large, not the item detail.
  await tap(card.locator('.card-image .item-photo'));await page.waitForTimeout(500);
  const viewer=page.locator('dialog.photo-viewer-modal[open]');
  check(await viewer.count()===1,`${name}: tapping the photo opens the photo viewer`);
  check(await page.locator('dialog.item-modal[open]').count()===0,`${name}: tapping the photo does not open the item detail`);
  const cardSrc=await card.locator('.card-image .item-photo').getAttribute('src'),bigSrc=await viewer.locator('.item-photo').getAttribute('src').catch(()=>null);
  check(cardSrc&&cardSrc===bigSrc,`${name}: viewer shows the card's photo`);
  const fit=await viewer.locator('.item-photo').evaluate(img=>{const r=img.getBoundingClientRect();return {w:r.width,h:r.height,fit:getComputedStyle(img).objectFit};}).catch(()=>null);
  check(fit&&fit.fit==='contain'&&fit.w>=Math.min(vp.width*0.9,1000),`${name}: photo is shown uncropped and large (${JSON.stringify(fit)})`);
  await page.screenshot({path:`${out}/${name}-viewer.png`});
  // 2. Every way of closing returns to the same place in the list, with focus back on the photo.
  for(const how of ['close','escape','back']){
    if(await viewer.count()===0){await tap(photoButton);await page.waitForTimeout(500);}
    if(how==='close')await tap(viewer.getByRole('button',{name:'Close'}));
    else if(how==='escape')await page.keyboard.press('Escape');
    else await page.goBack();
    await page.waitForTimeout(500);
    const state=await page.evaluate(()=>({y:window.scrollY,open:document.querySelectorAll('dialog[open]').length,focus:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName}));
    check(state.open===0,`${name}/${how}: viewer closed`);
    check(Math.abs(state.y-y0)<=2,`${name}/${how}: scroll position kept (${y0} → ${state.y})`);
    check(page.url()===url0,`${name}/${how}: still on the same view (${page.url()})`);
    check(state.focus?.startsWith('Enlarge photo of'),`${name}/${how}: focus returns to the photo (${state.focus})`);
  }
  // 3. From the enlarged photo you can go on to the item.
  await tap(photoButton);await page.waitForTimeout(500);
  await tap(viewer.getByRole('button',{name:'View details'}));await page.waitForTimeout(900);
  check(await page.locator('dialog.item-modal[open]').count()===1&&await viewer.count()===0,`${name}: "View details" swaps the photo for the item detail`);
  // 4. The detail's own photo enlarges too, and closing it returns to the detail.
  const detail=page.locator('dialog.item-modal[open]');
  await tap(detail.getByRole('button',{name:new RegExp(`^Enlarge photo of ${cardName}`)}));await page.waitForTimeout(500);
  check(await viewer.count()===1,`${name}: the detail photo opens the photo viewer`);
  await page.keyboard.press('Escape');await page.waitForTimeout(500);
  check(await viewer.count()===0&&await detail.count()===1,`${name}: closing it returns to the detail`);
  await page.goBack();await page.waitForTimeout(600);
  check(await page.locator('dialog[open]').count()===0&&Math.abs(await page.evaluate(()=>window.scrollY)-y0)<=2,`${name}: Back from the detail returns to the same place in the list`);
  // 5. The rest of the card still opens the detail.
  await tap(card.locator('h2'));await page.waitForTimeout(800);
  check(await detail.count()===1,`${name}: tapping the card text opens the item detail`);
  await page.goBack();await page.waitForTimeout(600);
  // 6. A slow refresh deep in the list (closing a rating form refreshes the group) keeps the list and your place.
  const last=cards.last();await last.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
  const y1=await page.evaluate(()=>window.scrollY);
  await tap(last.locator('h2'));await page.waitForTimeout(800);
  await detail.getByRole('button',{name:/^Rate it/}).click();await page.waitForTimeout(800);
  await page.route(/\/api\/groups\/[^/]+\/items/,async route=>{await new Promise(done=>setTimeout(done,1500));await route.continue();});
  await page.keyboard.press('Escape');await page.waitForTimeout(700);
  const mid=await page.evaluate(()=>({y:window.scrollY,skeleton:!!document.querySelector('.skeleton-grid')}));
  check(!mid.skeleton,`${name}: list stays on screen while it refreshes`);
  await page.waitForTimeout(2000);await page.unroute(/\/api\/groups\/[^/]+\/items/);
  await page.locator('dialog[open]').getByRole('button',{name:'Close'}).click().catch(()=>{});await page.waitForTimeout(800);
  const y2=await page.evaluate(()=>window.scrollY);
  check(y1>vp.height&&Math.abs(y2-y1)<=2,`${name}: deep scroll position kept through a slow refresh (${y1} → ${mid.y} → ${y2})`);
  if(name==='d'){
    // 7. A bookmark saved while a refresh is in flight survives that refresh's older snapshot.
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
    const first=cards.first(),bookmark=first.locator('.save-item');
    const before=await bookmark.getAttribute('aria-pressed');
    await tap(first.locator('h2'));await page.waitForTimeout(800);
    await detail.getByRole('button',{name:/^Rate it/}).click();await page.waitForTimeout(800);
    await page.route(/\/api\/groups\/[^/]+\/feed/,async route=>{await new Promise(done=>setTimeout(done,2500));await route.continue();});
    await page.keyboard.press('Escape');await page.waitForTimeout(400);
    await page.locator('dialog[open]').getByRole('button',{name:'Close'}).click().catch(()=>{});await page.waitForTimeout(300);
    await bookmark.click();await page.waitForTimeout(3500);await page.unroute(/\/api\/groups\/[^/]+\/feed/);
    check(await bookmark.getAttribute('aria-pressed')!==before,`${name}: bookmark saved during a refresh stays saved (${before} → ${await bookmark.getAttribute('aria-pressed')})`);
    await bookmark.click();await page.waitForTimeout(800);
    // 8. Group settings show the saved name, not the one from before the refresh.
    await page.goto(`${base}/app?view=settings`);await page.waitForLoadState('networkidle');
    const field=page.getByLabel('Group name'),original=await field.inputValue();
    await field.fill(`${original} test`);await page.getByRole('button',{name:'Save name'}).click();await page.waitForTimeout(1500);
    check(await field.inputValue()===`${original} test`,`${name}: group name field keeps the saved name (${await field.inputValue()})`);
    await field.fill(original);await page.getByRole('button',{name:'Save name'}).click();await page.waitForTimeout(1500);
  }
  check(errs.length===0,`${name}: no console errors ${JSON.stringify(errs.slice(0,3))}`);
  await page.screenshot({path:`${out}/${name}-list.png`});
  await ctx.close();
}
await browser.close();
if(failures.length){console.log(`\n${failures.length} failed`);process.exit(1);}
console.log('\nall card photo checks passed');
