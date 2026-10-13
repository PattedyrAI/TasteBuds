// UX audit: drives the running app as a signed-in member and writes metrics + screenshots.
// Usage: node tests/ux/audit.mjs <label>   (needs fake-auth + app on APP_URL, see README in this folder)
import {chromium} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {sessionCookie} from './fake-auth.mjs';
const label=process.argv[2]||'run',base=process.env.APP_URL||'http://localhost:3100',out=`/tmp/tb-ux/${label}`;mkdirSync(out,{recursive:true});
const axe=readFileSync(process.env.AXE_PATH||'/tmp/tb-ux/node_modules/axe-core/axe.min.js','utf8');
const photo=process.env.UX_PHOTO||'/tmp/tb-ux/photos/p1.jpg';
const viewports={mobile:{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2},desktop:{width:1440,height:900,isMobile:false,hasTouch:false,deviceScaleFactor:1}};
// Screens are reached by visible text so the same script measures before and after a redesign.
const screens=[['home',/^(home)$/i],['collection',/^(collection|browse)$/i],['feed',/feed|activity/i],['stats',/our taste|stats|insights/i],['mine',/my reviews|mine|you/i],['settings',/settings/i]];
async function measure(page){
  await page.addScriptTag({content:axe});
  return page.evaluate(async(mobile)=>{
    const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}});
    const v=r.violations.map(x=>({id:x.id,impact:x.impact,n:x.nodes.length}));
    const visible=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return b.width>0&&b.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&b.bottom>0&&b.top<innerHeight*3;};
    const interactive=[...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[tabindex]:not([tabindex="-1"])')].filter(visible).filter(el=>!el.closest('[inert]'));
    const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);if(dialog)interactive.splice(0,interactive.length,...interactive.filter(el=>dialog.contains(el)));
    const min=mobile?44:24;
    const small=interactive.filter(el=>{const b=el.getBoundingClientRect();return (b.width<min||b.height<min)&&!(el.tagName==='INPUT'&&['checkbox','radio'].includes(el.type)&&el.closest('label'));}).map(el=>`${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,24)}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    const textEls=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
    const sizes=new Set(textEls.map(el=>getComputedStyle(el).fontSize)),colors=new Set(textEls.map(el=>getComputedStyle(el).color)),weights=new Set(textEls.map(el=>getComputedStyle(el).fontWeight));
    const aboveFold=interactive.filter(el=>el.getBoundingClientRect().top<innerHeight).length;
    const overflow=document.documentElement.scrollWidth>document.documentElement.clientWidth+1;
    const tinyEls=textEls.filter(el=>parseFloat(getComputedStyle(el).fontSize)<12),tiny=tinyEls.length,tinySample=[...new Set(tinyEls.map(el=>el.tagName.toLowerCase()+'.'+[...el.classList].join('.')+':'+getComputedStyle(el).fontSize))].slice(0,8);
    return {axe:v,axeSerious:v.filter(x=>x.impact==='serious'||x.impact==='critical').reduce((a,x)=>a+x.n,0),axeTotal:v.reduce((a,x)=>a+x.n,0),smallTargets:small.length,smallSample:small.slice(0,8),fontSizes:sizes.size,textColors:colors.size,fontWeights:weights.size,aboveFoldInteractive:aboveFold,horizontalOverflow:overflow,tinyText:tiny,tinySample,pageHeight:document.documentElement.scrollHeight};
  },page.viewportSize().width<600);
}
const dialogOpen=page=>page.evaluate(()=>!!document.querySelector('dialog[open]'));
async function dismissal(page,open,name,results){
  const ways={};
  for(const way of ['escape','backdrop','back','closeButton']){
    await open();await page.waitForTimeout(400);if(!await dialogOpen(page)){ways[way]='did-not-open';continue;}
    if(way==='escape')await page.keyboard.press('Escape');
    if(way==='backdrop'){const vp=page.viewportSize();await page.mouse.click(vp.width/2,6);}
    if(way==='back')await page.goBack().catch(()=>{});
    if(way==='closeButton')await page.locator('dialog[open]').last().getByRole('button',{name:/^close$/i}).first().click().catch(()=>{});
    await page.waitForTimeout(500);
    ways[way]=!(await dialogOpen(page));
    if(way==='back'&&!page.url().startsWith(base+'/app')){ways[way]='left-app';await page.goto(base+'/app');await page.waitForLoadState('networkidle');}
    while(await dialogOpen(page)){await page.keyboard.press('Escape');await page.waitForTimeout(200);if(await dialogOpen(page)){await page.locator('dialog[open]').last().getByRole('button',{name:/close/i}).first().click().catch(()=>{});await page.waitForTimeout(200);}}
  }
  results[name]=ways;
}
const browser=await chromium.launch();
const report={label,at:new Date().toISOString()};
for(const [vpName,vp] of Object.entries(viewports)){
  const ctx=await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:vp.isMobile,hasTouch:vp.hasTouch,deviceScaleFactor:vp.deviceScaleFactor});
  const c=sessionCookie(1);await ctx.addCookies([{name:c.name,value:c.value,url:base}]);
  const page=await ctx.newPage();const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});page.on('pageerror',e=>errors.push(String(e).slice(0,160)));
  const t0=Date.now();await page.goto(base+'/app');await page.waitForLoadState('networkidle');await page.waitForTimeout(800);
  // Load cost of the signed-in app: JS/CSS bytes and largest contentful paint, from the browser's own timing APIs.
  const load=await page.evaluate(()=>new Promise(resolve=>{let lcp=0;new PerformanceObserver(list=>{for(const e of list.getEntries())lcp=Math.max(lcp,e.startTime);}).observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>{const r=performance.getEntriesByType('resource');const kb=t=>Math.round(r.filter(e=>e.initiatorType===t||(t==='script'&&e.name.endsWith('.js'))||(t==='css'&&e.name.endsWith('.css'))).reduce((a,e)=>a+(e.encodedBodySize||0),0)/1024);resolve({lcpMs:Math.round(lcp),jsKB:kb('script'),cssKB:kb('css')});},300);}));
  const res={loadMs:Date.now()-t0,load,screens:{},dialogs:{},flows:{}};
  const navTo=async rx=>{const btn=page.locator('nav button:visible, nav a:visible').filter({hasText:rx}).first();if(await btn.count()){await btn.click();await page.waitForTimeout(700);return true;}return false;};
  for(const [name,rx] of screens){
    // Old builds expose every view in the nav; newer ones nest some views and address them by URL.
    if(!await navTo(rx)){await page.goto(`${base}/app?view=${name}`);await page.waitForLoadState('networkidle');await page.waitForTimeout(500);}
    await page.screenshot({path:`${out}/${vpName}-${name}.png`,fullPage:false});
    res.screens[name]=await measure(page);
  }
  await page.goto(base+'/app');await page.waitForLoadState('networkidle');
  const addBtn=()=>page.getByRole('button',{name:/add a rating|rate something|^rate$|new rating|add rating/i}).filter({visible:true}).first();
  // Add-rating dialog
  await addBtn().click();await page.waitForTimeout(600);
  await page.screenshot({path:`${out}/${vpName}-rate-open.png`});
  res.screens.rateDialog=await measure(page);
  const cameraInput=page.locator('dialog[open] input[type=file][capture]');
  res.flows.cameraInputPresent=await cameraInput.count();
  res.flows.cameraButtonVisible=await page.locator('dialog[open]').getByRole('button',{name:/take a photo|camera|take photo/i}).count();
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  await dismissal(page,()=>addBtn().click(),'rate',res.dialogs);
  // Item detail
  const openItem=async()=>{if(!await navTo(/^(collection|browse)$/i)){await navTo(/^explore$/i);}await page.locator('main .item-card, main [data-item-card], main article button, main .item-grid > *').first().click();};
  await openItem();await page.waitForTimeout(800);
  await page.screenshot({path:`${out}/${vpName}-item.png`});
  res.screens.itemDialog=await measure(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  await dismissal(page,openItem,'item',res.dialogs);
  // Rating flow: time + clicks to rate a new item with a photo
  await page.goto(base+'/app');await page.waitForLoadState('networkidle');
  let clicks=0;const tf=Date.now();
  try{
    await addBtn().click();clicks++;await page.waitForTimeout(400);
    await page.locator('dialog[open] input[type=file]:not([capture])').first().setInputFiles(photo);clicks++;
    await page.waitForFunction(()=>document.querySelector('dialog[open] img[src^="/api/photos/"]'),null,{timeout:15000});
    const d=page.locator('dialog[open]');
    const radio=d.getByRole('radio',{name:/^food$/i});
    if(await radio.count()){await radio.check();clicks++;}else{const food=d.getByText(/^food$/i).first();if(await food.count()&&await food.isVisible()){await food.click();clicks++;}}
    const fill=async(rx,v)=>{const f=d.getByLabel(rx).first();if(await f.count()&&await f.isEditable()){await f.fill(v);clicks++;return true;}return false;};
    await fill(/brand|restaurant|where/i,'Audit Diner');await fill(/^model|what is it|called|name|item|what did you/i,`Audit plate ${label}`);
    const save=d.getByRole('button',{name:/save|post|add rating|share/i}).last();await save.click();clicks++;
    await page.waitForFunction(()=>!document.querySelector('dialog[open]'),null,{timeout:15000});
    res.flows.rateNewItem={ok:true,clicks,ms:Date.now()-tf};
  }catch(e){res.flows.rateNewItem={ok:false,clicks,error:String(e).slice(0,200)};await page.screenshot({path:`${out}/${vpName}-rate-fail.png`});while(await dialogOpen(page))await page.keyboard.press('Escape');}
  res.consoleErrors=errors;
  report[vpName]=res;await ctx.close();
}
await browser.close();
const sum=v=>Object.values(report[v].screens).reduce((a,s)=>({axeSerious:a.axeSerious+(s.axeSerious||0),axeTotal:a.axeTotal+(s.axeTotal||0),smallTargets:a.smallTargets+(s.smallTargets||0),overflow:a.overflow+(s.horizontalOverflow?1:0),maxFontSizes:Math.max(a.maxFontSizes,s.fontSizes||0),maxColors:Math.max(a.maxColors,s.textColors||0),tinyText:a.tinyText+(s.tinyText||0)}),{axeSerious:0,axeTotal:0,smallTargets:0,overflow:0,maxFontSizes:0,maxColors:0,tinyText:0});
report.summary={mobile:sum('mobile'),desktop:sum('desktop'),dialogs:{mobile:report.mobile.dialogs,desktop:report.desktop.dialogs},flows:{mobile:report.mobile.flows,desktop:report.desktop.flows},consoleErrors:report.mobile.consoleErrors.length+report.desktop.consoleErrors.length,load:{mobile:report.mobile.load,desktop:report.desktop.load}};
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,1));
console.log(JSON.stringify(report.summary,null,1));
