const { chromium } = require('playwright');
const { openAccountSettings, closeAccountSettings } = require('./helpers/account-settings.cjs');
const { spawn } = require('node:child_process');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const net = require('node:net');
let checks=0;
function check(ok,name){if(!ok)throw new Error(name);checks++;console.log('PASS theme browser '+name);}
async function contrast(page,selector){
 return page.locator(selector).first().evaluate(el=>{
  const s=getComputedStyle(el),rgb=x=>(x.match(/[\d.]+/g)||[]).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  let a=lum(rgb(s.color)),b=lum(rgb(s.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });
}
(async()=>{
 const root=resolve(__dirname,'../..'),temp=await mkdtemp(resolve(tmpdir(),'medtermin-themes-'));
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const url='http://127.0.0.1:'+port,assembly=process.env.TEST_WEB_DLL||resolve(root,'src/Appointments.Web/bin/Release/net10.0/Appointments.Web.dll');
 const app=spawn(process.env.TEST_DOTNET||'dotnet',[assembly,'--urls',url],{cwd:process.env.TEST_WEB_DLL?resolve(assembly,'..'):resolve(root,'src/Appointments.Web'),env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development',Backend__Mode:'Demo',Demo__Enabled:'true',Demo__DataPath:resolve(temp,'state.json')},stdio:'ignore'});
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 try{
  let ready=false;for(let i=0;i<250;i++){try{if((await fetch(url+'/Demo')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw new Error('Theme fixture failed startup');
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/Demo');await page.locator('[data-theme-select]').waitFor();
  check(await page.locator('html').getAttribute('data-theme')==='default','First visit retains standard theme');
  await page.locator('button[data-role=Administrator]').click();await page.locator('select[name=userId]').selectOption('admin');await page.locator('#demo-form button[type=submit]').click();
  await page.locator('#main-content .card').first().waitFor();
  check(await page.locator('#account-settings-dialog [data-theme-select]').count()===1&&await page.locator('[data-theme-select]').count()===1,'One selector is in account settings');
  check(await page.locator('.card').first().evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(255, 255, 255)','Default cards keep original white');
  const other=await context.newPage();await other.goto(url+'/Workspace');
  const screens=process.env.TEST_THEME_SCREENSHOTS;if(screens)await mkdir(screens,{recursive:true});
  for(const theme of ['dark','vibrant','default']){
   await page.evaluate(()=>window.themeApp=document.querySelector('#app'));
   await openAccountSettings(page);
   await page.locator('[data-theme-select]').selectOption(theme);
   await closeAccountSettings(page);
   check(await page.evaluate(()=>window.themeApp===document.querySelector('#app')),'Switch '+theme+' preserves workspace DOM');
   await other.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   check(await other.locator('[data-theme-select]').inputValue()===theme,theme+' synchronizes across tabs');
   await page.reload();check(await page.locator('[data-theme-select]').inputValue()===theme,theme+' survives reload without resetting');
   await page.goto(url+'/Workspace#doctors');await page.locator('.doctor-card').first().waitFor();
   check(await contrast(page,'.doctor-card .record-action-primary')>=4.5,theme+' primary action contrast is readable');
   if(screens)await page.screenshot({path:resolve(screens,theme+'-doctors.png'),fullPage:true});
   await page.locator('[data-profile]').first().click();await page.locator('#main-dialog').waitFor();
   check(await page.locator('#main-dialog').evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgba(0, 0, 0, 0)',theme+' doctor dialog has a themed surface');
   await page.locator('#close-dialog').click();
   await page.locator('#doctor-results [data-book=d01]').click();
   const date=await page.locator('#booking-date').inputValue();
   const monday=new Date(date+'T00:00:00Z');monday.setUTCDate(monday.getUTCDate()+7+(8-monday.getUTCDay())%7);
   await page.locator('#booking-date').fill(monday.toISOString().slice(0,10));
   await page.locator('.slot').first().waitFor();await page.locator('.slot').first().click();
   check(await contrast(page,'.slot.selected')>=4.5,theme+' selected booking time retains readable contrast');
   if(screens)await page.locator('#main-dialog').screenshot({path:resolve(screens,theme+'-booking.png')});
   await page.locator('#close-dialog').click();
   await page.goto(url+'/Workspace#calendar');await page.locator('.fc').waitFor();
   check(await page.locator('.fc').evaluate(e=>getComputedStyle(e).getPropertyValue('--fc-border-color').trim().length>0),theme+' calendar has palette borders');
   if(screens)await page.screenshot({path:resolve(screens,theme+'-calendar.png'),fullPage:true});
   for(const width of [390,320]){
    await page.setViewportSize({width,height:850});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),theme+' fits '+width+'px');
    await openAccountSettings(page);await page.locator('[data-theme-select]').scrollIntoViewIfNeeded();check(await page.locator('[data-theme-select]').isVisible(),theme+' selector remains reachable on '+width+'px');await closeAccountSettings(page);
   }
   await page.setViewportSize({width:1440,height:1000});
  }
  await openAccountSettings(page);await page.locator('[data-theme-select]').selectOption('dark');await page.emulateMedia({media:'print'});
  check(await page.locator('[data-theme-select]').isHidden(),'Printing hides the selector');
  check(await page.locator('html').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(248, 250, 252)','Dark preference does not print a dark canvas');
  await page.emulateMedia({media:'screen'});await closeAccountSettings(page);
  if(process.env.TEST_PUBLIC_WEB){
   const publicPage=await context.newPage();await publicPage.goto(process.env.TEST_PUBLIC_WEB+'/Discover');
   for(const theme of ['dark','vibrant']){
    await publicPage.locator('[data-theme-select]').selectOption(theme);
    await publicPage.locator('.discovery-card').first().waitFor();
    check(await publicPage.locator('html').getAttribute('data-theme')===theme,theme+' applies on public directory');
    if(screens)await publicPage.screenshot({path:resolve(screens,theme+'-discover.png'),fullPage:true});
    await publicPage.goto(process.env.TEST_PUBLIC_WEB+'/Account/Login');
    check(await publicPage.locator('[data-theme-select]').inputValue()===theme,theme+' follows public visitor to login');
    if(screens)await publicPage.screenshot({path:resolve(screens,theme+'-login.png'),fullPage:true});
    await publicPage.goto(process.env.TEST_PUBLIC_WEB+'/Platform/Login');
    check(await publicPage.locator('[data-theme-select]').inputValue()===theme,theme+' applies on company login');
    await publicPage.goto(process.env.TEST_PUBLIC_WEB+'/Discover');
   }
   await publicPage.close();
  }
  const blocked=await context.newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked');}}));
  await blocked.goto(url+'/Demo');await blocked.locator('[data-theme-select]').selectOption('vibrant');check(await blocked.locator('html').getAttribute('data-theme')==='vibrant','Switching still works with storage blocked');
  check(errors.length===0,'No uncaught theme/workspace JavaScript errors');
  console.log(`${checks}/${checks} theme browser checks passed.`);
 }finally{await browser.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));await rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
