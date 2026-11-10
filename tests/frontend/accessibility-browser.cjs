// Real Chromium + axe checks on isolated demo data; this is not a manual accessibility certification.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {resolve}=require('node:path');
const {tmpdir}=require('node:os');
const net=require('node:net');
(async()=>{
 const root=resolve(__dirname,'../..');
 const assembly=process.env.TEST_WEB_DLL||resolve(root,'src/Appointments.Web/bin/Release/net10.0/Appointments.Web.dll');
 const temporary=await fs.mkdtemp(resolve(tmpdir(),'medtermin-a11y-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+socket.address().port;await new Promise(r=>socket.close(r));
 const app=spawn(process.env.TEST_DOTNET||'dotnet',[assembly,'--urls',base],{cwd:process.env.TEST_WEB_DLL?resolve(assembly,'..'):resolve(root,'src/Appointments.Web'),env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development',Backend__Mode:'Demo',Demo__Enabled:'true',Demo__DataPath:temporary+'/data.json'},stdio:'ignore'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_EXECUTABLE,args:['--no-sandbox']});
 const results=[];
 try {
  for(let i=0;i<150;i++){try{if((await fetch(base+'/Demo')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const role of ['Administrator','Doctor','Patient']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
   await page.goto(base+'/Demo');await page.locator(`[data-role=${role}]`).click();await page.locator('#demo-form button[type=submit]').click();await page.locator('.page-heading').waitFor();
   const paths=role==='Administrator'?['overview','doctors','patients','calendar','catalogue/specialties','catalogue/services','reports','appointments']:role==='Doctor'?['overview','appointments','calendar','availability']:['overview','doctors','appointments'];
   for(const path of paths){
    await page.goto(base+'/Workspace#'+path);await page.locator('.page-heading').waitFor();await page.waitForTimeout(150);
    if(path==='appointments') await page.locator('[data-list-tab=all]').click();
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const scan=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>v.id)};});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    results.push({role,path,theme:'default',width:1440,overflow,...scan});
   }
   if(role==='Administrator')for(const theme of ['dark','vibrant']){
    await page.locator('#account-menu-button').click();await page.locator('[data-theme-select]').selectOption(theme);await page.locator('[data-account-settings-close]').click();
    await page.goto(base+'/Workspace#doctors');await page.locator('.doctor-card').first().waitFor();
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const scan=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>v.id)};});results.push({role,path:'doctors',theme,width:1440,...scan});
   }
   await context.close();
  }
 }finally{await browser.close();app.kill();await fs.rm(temporary,{recursive:true,force:true});}
 for(const item of results){
  if(item.overflow||item.violations.length)throw Error(JSON.stringify(item,null,2));
  console.log(`PASS accessibility ${item.role} ${item.path} ${item.theme}: no detected WCAG A/AA violations`);
 }
 console.log(`${results.length}/${results.length} accessibility scenarios passed (automated coverage only).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
