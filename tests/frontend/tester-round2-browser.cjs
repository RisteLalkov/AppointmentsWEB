const {chromium}=require('playwright');
const {mkdir}=require('node:fs/promises');const {resolve}=require('node:path');
const base=process.env.TEST_WEB_URL, password=process.env.TEST_PASSWORD, fixture=JSON.parse(process.env.TEST_ROUND2_FIXTURE);
let count=0;const check=(ok,label)=>{if(!ok)throw Error(label);count++;console.log('PASS tester2 browser '+label);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_EXECUTABLE,args:['--no-sandbox']}),errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const screens=process.env.TEST_ROUND2_SCREENSHOTS;if(screens)await mkdir(screens,{recursive:true});
  const shot=async(p,name)=>{if(screens)await p.screenshot({path:resolve(screens,name+'.png'),fullPage:true});};
  async function login(p,email){await p.goto(base+'/Account/Login');await p.locator('[name=Email]').fill(email);await p.locator('[name=Password]').fill(password);await p.locator('form[action="/Account/Login"] button[type=submit]').click();}
  await login(page,'alice@round2.test');await page.locator('#patient-visits-title').waitFor();
  check(new URL(page.url()).pathname==='/PatientClinics','Ordinary login opens the all-clinics patient dashboard');
  check(await page.locator('.hero-banner').isVisible(),'The existing patient welcome design remains present');
  await shot(page,'patient-home');
  check(await page.locator('[data-visit-clinic=east]').count()===1&&await page.locator('[data-visit-clinic=main]').count()===0,'Upcoming view labels the correct clinic');
  await page.locator('#home-period').selectOption('history');await page.locator('.patient-home-filters button').click();await page.locator('[data-visit-clinic=main]').waitFor();
  check((await page.locator('[data-visit-clinic=main]').innerText()).includes('Откажан'),'Cancelled appointments appear in labelled cross-clinic history');
  await page.locator('#home-clinic').selectOption('east');await page.locator('.patient-home-filters button').click();await page.waitForLoadState();
  check(await page.locator('[data-patient-visit]').count()===0,'Filtering history to another clinic cannot display the first clinic’s appointment');
  await page.goto(base+'/PatientClinics');const homeTab=page;
  const clinicTab=await context.newPage();await clinicTab.goto(base+'/PatientClinics');await clinicTab.locator('[data-patient-clinic=east] button').click();await clinicTab.locator('.overview-grid').waitFor();
  // The old all-clinic page remains a personal action, independent of another tab's selected clinic.
  await homeTab.locator('[data-patient-clinic=main] button').click();await homeTab.locator('.overview-grid').waitFor();
  check(await homeTab.locator('meta[name=careline-clinic]').getAttribute('content')==='main','An older all-clinics page can safely select its own clinic after another tab switches');
  const csrf=await homeTab.locator('#csrf input').inputValue();
  await clinicTab.goto(base+'/PatientClinics');await clinicTab.locator('[data-patient-clinic=east] button').click();await clinicTab.locator('.overview-grid').waitFor();
  check((await homeTab.request.get(base+'/data/bootstrap',{headers:{'X-Workspace-Clinic':'main'}})).status()===409,'The old clinic workspace remains blocked after another tab switches clinics');
  const forged=await homeTab.request.post(base+'/data/appointments',{headers:{'X-Workspace-Clinic':'east','X-CSRF-TOKEN':csrf},data:{}});
  check(forged.status()===400,'An old clinical form cannot be revived by changing its clinic header');
  await clinicTab.goto(base+'/PatientClinics');
  for(const theme of ['default','dark','vibrant']){
   await clinicTab.locator('#account-menu-button').click();await clinicTab.locator('[data-theme-select]').selectOption(theme);await clinicTab.locator('[data-account-settings-close]').click();
   await clinicTab.setViewportSize({width:320,height:850});await clinicTab.waitForTimeout(150);
   check(await clinicTab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),theme+' patient dashboard fits 320px');
   await clinicTab.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
   const violations=await clinicTab.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});
   check(!violations.length,theme+' patient dashboard has no detected WCAG A/AA violations: '+JSON.stringify(violations));
  }
  await clinicTab.locator('#account-menu-button').click();await clinicTab.locator('[data-language-form] button[value="en-GB"]').click();await clinicTab.locator('html[lang=en]').waitFor();
  check((await clinicTab.locator('#patient-visits-title').innerText()).includes('Upcoming'),'All-clinic dashboard translates into English');
  await clinicTab.locator('[data-patient-clinic=east] button').click();await clinicTab.locator('.overview-grid').waitFor();
  await clinicTab.locator('#account-menu-button').click();await clinicTab.locator('[data-language-form] button[value="mk-MK"]').click();await clinicTab.locator('html[lang=mk]').waitFor();
  await clinicTab.locator('.overview-grid').waitFor();
  check(await clinicTab.locator('.overview-grid').isVisible(),'Patient language controls also work inside a selected clinic');
  await clinicTab.goto(base+'/PatientClinics');await clinicTab.locator('#account-menu-button').click();await clinicTab.locator('form[action="/Account/Logout"] button').click();await clinicTab.locator('form[action="/Account/Login"]').waitFor();
  check(new URL(clinicTab.url()).pathname==='/Account/Login','Patient can sign out from the all-clinics dashboard');await context.close();
  const staff=await browser.newContext({viewport:{width:1360,height:1000}}),p=await staff.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));await login(p,'admin@feedback.test');await p.locator('.overview-grid').waitFor();
  await p.goto(base+'/Workspace#doctors');await p.locator('#doctor-search').fill('Краток контролен');
  check(await p.locator('.doctor-card').count()===1,'Doctor text search finds assigned service names');
  await p.locator('#doctor-search').fill('');await p.locator('#doctor-service-filter-input').fill('Краток контролен');await p.locator('#doctor-service-filter-input').press('Enter');
  check(await p.locator('.doctor-card').count()===1,'Searchable service filter selects exactly the matching doctor');
  const meta=await p.locator('.doctor-card-meta').innerText();check(meta.includes('20 мин.')&&!meta.includes('30 мин.'),'Card duration follows the selected service rather than the fallback');
  await p.goto(base+'/Workspace#patients');await p.locator('[data-action=add-patient]').click();
  check(await p.locator('#patient-phone').getAttribute('required')!==null&&await p.locator('#patient-email').getAttribute('required')===null,'Patient form requires phone but keeps contact email optional');await p.locator('#close-dialog').click();
  await p.goto(base+'/Workspace#availability');await p.locator('#availability-doctor').selectOption(fixture.doctors[1].id);await p.locator('#schedule-range').selectOption('new');await p.locator('#schedule-range-dates').waitFor();
  for(const [id,value] of [['schedule-from',fixture.begin],['schedule-to',fixture.finish]])await p.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await p.locator('.period-start').fill('14:00');await p.locator('.period-end').fill('18:00');await p.locator('#schedule-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#schedule-range').value.includes('/'));
  const key=fixture.begin+'/'+fixture.finish;check(await p.locator('#schedule-range').inputValue()===key,'Date-limited hours save without replacing the regular week');
  check(await p.locator('#duration').isHidden(),'Service-based doctors do not show an unrelated default duration field');
  await p.reload();await p.locator('#availability-doctor').selectOption(fixture.doctors[1].id);await p.locator('#schedule-range').selectOption(key);await p.locator('#schedule-range-dates').waitFor();
  check(await p.locator('.period-start').inputValue()==='14:00','Date-limited hours survive reload');
  await shot(p,'dated-hours');
  await p.goto(base+'/Workspace#calendar');await p.locator('#calendar-doctor').selectOption(fixture.doctors[1].id);await p.locator('#calendar-next').click();await p.locator('.calendar-available').first().waitFor();
  for(const theme of ['default','dark','vibrant']){
   await p.locator('#account-menu-button').click();await p.locator('[data-theme-select]').selectOption(theme);await p.locator('[data-account-settings-close]').click();
   const colors=await p.evaluate(()=>({slot:getComputedStyle(document.querySelector('.calendar-available')).backgroundColor,legend:getComputedStyle(document.querySelector('.legend-available')).backgroundColor,opacity:getComputedStyle(document.querySelector('.calendar-available')).opacity}));
   check(colors.slot===colors.legend&&colors.opacity==='1',theme+' availability shading matches its legend and stays visible');
   await shot(p,'calendar-'+theme);
  }
  await staff.close();check(!errors.length,'No uncaught browser errors');console.log(`${count}/${count} tester round two browser checks passed.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
