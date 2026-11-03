// Real Razor + Chromium tests. Demo workflows are independent of production data.
// TEST_PUBLIC_WEB adds public/company checks against the discovery MVC fixture.
const { chromium }=require('playwright');
const { openAccountSettings, closeAccountSettings }=require('./helpers/account-settings.cjs');
const { spawn }=require('node:child_process');
const { mkdtemp,rm,mkdir }=require('node:fs/promises');
const { resolve }=require('node:path');
const { tmpdir }=require('node:os');
const net=require('node:net');
let count=0;
const check=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS language browser '+label);count++;};
const root=resolve(__dirname,'../..');
async function switchLanguage(page,value){
 await openAccountSettings(page);
 await Promise.all([page.waitForNavigation(),page.locator(`[data-language-form] button[value="${value}"]`).click()]);
 check(await page.locator('html').getAttribute('lang')===(value==='en-GB'?'en':'mk'),'Saved language renders on the server: '+value);
}
async function fits(page,label){
 const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
 if(!fits)console.error(await page.locator('body *').evaluateAll(elements=>elements.filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed';}).slice(0,8).map(e=>({tag:e.tagName,classes:e.className,text:e.textContent.slice(0,80),right:e.getBoundingClientRect().right}))));
 check(fits,label+' fits viewport');
}
async function selectedIcons(page,label){
 const bad=await page.locator('.ui-icon:visible').evaluateAll(icons=>icons.filter(e=>{const r=e.getBoundingClientRect();return !e.querySelector('use')||r.width<8||r.height<8||r.width>55||r.height>55;}).length);
 check(!bad,label+' SVG icons have stable dimensions');
}
(async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),'medtermin-language-'));
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const base='http://127.0.0.1:'+port,assembly=process.env.TEST_WEB_DLL||resolve(root,'src/Appointments.Web/bin/Release/net10.0/Appointments.Web.dll');
 const app=spawn(process.env.TEST_DOTNET||'dotnet',[assembly,'--urls',base],{cwd:process.env.TEST_WEB_DLL?resolve(assembly,'..'):resolve(root,'src/Appointments.Web'),env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development',Backend__Mode:'Demo',Demo__Enabled:'true',Demo__DataPath:resolve(temp,'state.json')},stdio:'ignore'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_EXECUTABLE,args:['--no-sandbox']});
 const errors=[];
 try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/Demo')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw Error('Language fixture did not start');
  const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/Demo');
  check(await page.locator('html').getAttribute('lang')==='mk','English browser preference still starts in Macedonian');
  check(await page.locator('script[src*="/i18n/en.js"]').count()===0,'Default Macedonian does not download English catalogue');
  await page.locator('[data-theme-select]').selectOption('dark');await switchLanguage(page,'en-GB');
  check(await page.getByRole('button',{name:'Open my workspace'}).count()===1,'Demo sign-in is translated');
  check(await page.locator('[data-theme-select]').inputValue()==='dark','Changing language preserves theme');
  const languageCookie=(await context.cookies()).find(c=>c.name==='MedTermin.Language');
  check(languageCookie?.httpOnly&&languageCookie.path==='/'&&languageCookie.sameSite==='Lax','Language cookie is a bounded non-authentication preference');
  check((await page.request.get(base+'/icons/interface.svg')).ok(),'Bundled icon and flag sprite is served locally');
  await page.locator('button[data-role=Administrator]').click();await page.locator('select[name=userId]').selectOption('admin');await page.locator('#demo-form button[type=submit]').click();
  await page.locator('.page-heading').waitFor();
  check((await page.locator('#navigation').innerText()).includes('Management')&&!(await page.locator('#navigation').innerText()).includes('Управување'),'Reception navigation is English');
  check(await page.locator('#account-settings-dialog [data-language-form]').count()===1,'Language selector sits beside theme control in account settings');
  await page.goto(base+'/Workspace#doctors');await page.locator('.doctor-card').first().waitFor();
  const dataName=await page.locator('.doctor-card h3').first().innerText();
  check(/[А-Яа-я]/.test(dataName),'Doctor record names retain Cyrillic');
  check((await page.locator('.doctor-card-meta').first().innerText()).includes('Payment method not specified'),'Legacy empty funding metadata gets an English presentation label');
  await page.locator('#doctor-results [data-book=d01]').click();await page.locator('#booking-date').waitFor();
  check((await page.locator('#main-dialog').innerText()).includes('Doctor')&&(await page.locator('#main-dialog').innerText()).includes('Patient'),'Booking labels and searchable controls are English');
  const current=await page.locator('#booking-date').inputValue(),monday=new Date(current+'T00:00:00Z');monday.setUTCDate(monday.getUTCDate()+7+(8-monday.getUTCDay())%7);
  await page.locator('#booking-date').fill(monday.toISOString().slice(0,10));await page.locator('.slot').first().waitFor();await page.locator('.slot').first().click();
  const patient=page.locator('#booking-patient');
  // Searchable combo preserves the original select for submission.
  const patientId=await patient.locator('option[value]:not([value=""])').first().getAttribute('value');
  await patient.evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},patientId);
  await page.locator('#review-booking').click();await page.locator('#submit-booking').waitFor();
  check((await page.locator('#main-dialog').innerText()).includes('Confirm appointment'),'English review step shows confirmation action');
  await page.locator('#submit-booking').click();await page.locator('.success-view').waitFor();
  check((await page.locator('.success-view').innerText()).includes('confirmed'),'English booking completes against the real demo service');
  const bookedId=await page.locator('#dialog-content [data-detail]').getAttribute('data-detail');
  await page.locator('#close-dialog').click();
  await page.goto(base+'/Workspace#appointments');await page.locator('#appointment-results').waitFor();
  check((await page.locator('.chip-tabs').first().innerText()).includes('Upcoming'),'Appointment period filters are English');
  await page.locator(`[data-detail="${bookedId}"]`).first().click();await page.locator('[data-move]').click();
  check(await page.locator('#booking-date').inputValue()===monday.toISOString().slice(0,10),'English rescheduling retains the original future date');
  await page.locator('.slot').last().click();await page.locator('#review-booking').click();await page.locator('#submit-booking').click();await page.locator('.success-view').waitFor();
  check((await page.locator('.success-view').innerText()).includes('confirmed'),'English rescheduling completes');
  await page.locator('#close-dialog').click();await page.locator(`[data-detail="${bookedId}"]`).first().click();await page.locator('[data-status=Cancelled]').click();
  check(await page.locator('#confirm-no').innerText()==='Keep current state','Cancellation confirmation is English');
  await page.locator('#confirm-yes').click();await page.locator('#dialog-content .badge.Cancelled').waitFor();await page.locator('#close-dialog').click();
  for(const [hash,selector,label] of [['calendar','.fc','Calendar'],['patients','#patient-results','Patients'],['catalogue/specialties','#catalogue-search','Specialties'],['catalogue/services','#catalogue-search','Services'],['reports','#report-form','Reports'],['availability','#schedule-form','Weekly working hours']]){
   await page.goto(base+'/Workspace#'+hash);await page.locator(selector).waitFor();
   check((await page.locator('#app').innerText()).includes(label),'English screen: '+hash);
  }
  await page.goto(base+'/Workspace#calendar');await page.locator('.fc').waitFor();
  check(!(await page.locator('#calendar-title').innerText()).match(/[А-Яа-я]/),'Calendar buttons and date headings are English');
  for(const theme of ['default','dark','vibrant']){
   await openAccountSettings(page);await page.locator('[data-theme-select]').selectOption(theme);
   for(const width of [390,320]){
    await page.setViewportSize({width,height:850});await openAccountSettings(page);await fits(page,theme+' English '+width);
    await page.locator('[data-language-form]').scrollIntoViewIfNeeded();
    check(await page.locator('[data-language-form]').isVisible(),theme+' language selector is reachable at '+width);
    await selectedIcons(page,theme+' mobile');
    if(process.env.TEST_LANGUAGE_SCREENSHOTS&&theme==='default'&&width===390){
     await mkdir(process.env.TEST_LANGUAGE_SCREENSHOTS,{recursive:true});
     await page.waitForFunction(()=>getComputedStyle(document.querySelector('#toast')).opacity==='0');
     await page.screenshot({path:resolve(process.env.TEST_LANGUAGE_SCREENSHOTS,'english-mobile-preferences.png')});
     await closeAccountSettings(page);await page.locator('#menu-toggle').scrollIntoViewIfNeeded();await page.locator('#menu-toggle').click();
     await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().x>=-1);
     await page.screenshot({path:resolve(process.env.TEST_LANGUAGE_SCREENSHOTS,'english-mobile-navigation.png')});
     await page.locator('#sidebar [data-page=calendar]').click();
    }
   }
  }
  await closeAccountSettings(page);await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/Workspace#doctors');await page.locator('.doctor-card').first().waitFor();
  if(process.env.TEST_LANGUAGE_SCREENSHOTS){await mkdir(process.env.TEST_LANGUAGE_SCREENSHOTS,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(process.env.TEST_LANGUAGE_SCREENSHOTS,'english-doctors.png'),fullPage:true});}
  await switchLanguage(page,'mk-MK');check(page.url().endsWith('#doctors'),'Changing language preserves the selected workspace section');
  check((await page.locator('#navigation').innerText()).includes('Управување'),'Switching back restores Macedonian navigation');
  await page.goto(base+'/Demo');await switchLanguage(page,'en-GB');
  for(const role of ['Patient','Doctor']){
   await page.goto(base+'/Demo');await page.locator('button[data-role='+role+']').click();await page.locator('#demo-form button[type=submit]').click();await page.locator('.page-heading').waitFor();
   check((await page.locator('.user-info small').innerText()).includes(role),role+' role label is English');
   await page.goto(base+'/Workspace#appointments');await page.locator('#appointment-results').waitFor();
   check((await page.locator('.page-heading').innerText()).includes(role==='Patient'?'Your appointments':'All your appointments'),role+' appointment workflow renders in English');
  }
  const token=await page.locator('[data-language-form] [name=__RequestVerificationToken]').inputValue();
  check((await page.request.post(base+'/Preferences/Language',{form:{culture:'en-GB'}})).status()===400,'Language action rejects missing CSRF');
  check((await page.request.post(base+'/Preferences/Language',{form:{culture:'xx',__RequestVerificationToken:token}})).status()===400,'Language action rejects unsupported cultures');
  const external=await page.request.post(base+'/Preferences/Language',{form:{culture:'en-GB',returnUrl:'https://outside.invalid/',__RequestVerificationToken:token},maxRedirects:0});
  check(external.status()===302&&external.headers().location==='/Discover','Language action cannot redirect off-site');
  await context.close();
  if(process.env.TEST_PUBLIC_WEB){
   const basePublic=process.env.TEST_PUBLIC_WEB,ctx=await browser.newContext({locale:'en-US',viewport:{width:1280,height:1000}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(basePublic+'/Discover?Search=Јован#directory');await switchLanguage(p,'en-GB');
   check(p.url().includes('Search=')&&p.url().endsWith('#directory')&&(await p.locator('#search').inputValue())==='Јован','Public switch keeps Cyrillic search and fragment');
   check(await p.locator('.discovery-card h3').first().innerText()==='Тест лекар','Public doctor name remains clinic data');
   check(!(await p.locator('.discovery-copy').innerText()).replace(/МедТермин/g,'').match(/[А-Яа-я]/),'Landing hero is fully English');
   await p.goto(basePublic+'/Discover/Doctor/d01?clinicId=main');
   check(await p.locator('#availability-title').innerText()==='Available appointments','Doctor availability heading is English');
   check((await p.locator('.doctor-profile-services').innerText()).includes('Преглед'),'Service data named like a UI phrase is not translated');
   check(!(await p.locator('.availability-day-heading').innerText()).match(/[А-Яа-я]/),'Public availability dates are English');
   await p.locator('.public-slot-link').first().click();await p.locator('form[action="/Account/Login"]').waitFor();
   check((await p.locator('.welcome-form').innerText()).includes('Sign in'),'Slot redirects to English login');
   await p.goto(basePublic+'/Account/Register?clinicId=main');check((await p.locator('main').innerText()).includes('Create'),'Public registration is English');
   await p.locator('[name=Name]').fill('Unsaved patient');
   p.once('dialog',dialog=>dialog.dismiss());await p.locator('[data-language-form] button[value="mk-MK"]').click();
   check(await p.locator('[name=Name]').inputValue()==='Unsaved patient'&&await p.locator('html').getAttribute('lang')==='en','Declining language reload keeps unsaved registration');
   await p.goto(basePublic+'/Discover/Clinic/main');check(await p.locator('.clinic-contact-card').innerText().then(t=>t.includes('Address')),'Clinic info labels are English');
   // Keep a clinical cookie too: company preference forms must validate against PlatformCookie.
   await p.goto(basePublic+'/Account/Login');await p.locator('[name=Email]').fill('accounts-admin@test.test');await p.locator('[name=Password]').fill('Test-password-123');await p.locator('form[action="/Account/Login"] button[type=submit]').click();
   await p.goto(basePublic+'/Platform/Login');await p.locator('[name=Email]').fill('company@test.test');await p.locator('[name=Password]').fill('Test-password-123');await p.locator('form[action="/Platform/Login"] button.btn.primary').click();await p.locator('form[action="/Platform/Create"]').waitFor();
   check((await p.locator('main').innerText()).includes('Registered clinics'),'Company dashboard is English');
   await switchLanguage(p,'mk-MK');check(p.url().includes('/Platform')&&await p.locator('form[action="/Platform/Create"]').count()===1,'Company language CSRF works with independent clinical and platform cookies');
   await switchLanguage(p,'en-GB');
   for(const width of [390,320]){await p.setViewportSize({width,height:850});await fits(p,'English company '+width);}
   await ctx.close();
  }
  check(errors.length===0,'No uncaught JavaScript errors across translated workflows');
  console.log(`${count}/${count} language browser checks passed.`);
 }finally{await browser.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));await rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
