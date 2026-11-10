const {chromium}=require('playwright');
const base=process.env.TEST_WEB_URL, fixture=JSON.parse(process.env.TEST_OVERNIGHT_FIXTURE);
let count=0;const failures=[];
function check(ok,label){count++;console.log((ok?'PASS':'FAIL')+' overnight browser '+label);if(!ok)failures.push(label);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_EXECUTABLE,args:['--no-sandbox']});
 try{
  const login=async()=>{const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(base+'/Account/Login');await page.locator('[name=Email]').fill('admin@feedback.test');await page.locator('[name=Password]').fill(process.env.TEST_PASSWORD);await page.locator('form[action="/Account/Login"] button[type=submit]').click();await page.locator('.overview-grid').waitFor();return {context,page};};
  const review=async page=>{await page.goto(base+`/Workspace?book=${fixture.doctors[0].id}&date=${fixture.day}&time=09:00&serviceId=${fixture.service.id}#doctors`);await page.locator('#booking-patient').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},fixture.people[0].id);await page.locator('.slot.selected').waitFor();await page.locator('#review-booking').click();await page.locator('#submit-booking').waitFor();};
  const first=await login(),p=first.page,errors=[];p.on('pageerror',e=>errors.push(e.message));await review(p);
  let arrived,release,finished;const started=new Promise(r=>arrived=r),held=new Promise(r=>release=r),done=new Promise(r=>finished=r);
  await p.route('**/data/appointments',async route=>{if(route.request().method()!=='POST')return route.continue();arrived();await held;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Delayed booking conflict'})});finished();});
  await p.locator('#submit-booking').click();await started;await p.locator('#close-dialog').click();await p.locator(`[data-book="${fixture.doctors[1].id}"]`).click();await p.locator('#booking-doctor-input').waitFor();
  release();await done;await p.waitForTimeout(200);
  check(errors.length===0,'Closing a pending booking cannot cause an uncaught late-response error');
  check(await p.locator('#booking-doctor').inputValue()===fixture.doctors[1].id && !(await p.locator('#booking-error').innerText()),'An old failure cannot overwrite another booking dialog');
  await first.context.close();
  const second=await login(),q=second.page;await review(q);
  await q.route('**/data/bootstrap',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Refresh temporarily unavailable'})}));
  await q.locator('#submit-booking').click();await q.locator('.success-view, #booking-error .inline-error').waitFor();
  check(await q.locator('.success-view').count()===1,'A committed booking remains a success if the following refresh fails');
  await q.unroute('**/data/bootstrap');const state=await(await q.request.get(base+'/data/bootstrap',{headers:{'X-Workspace-Clinic':'main'}})).json();
  const saved=state.appointments.find(a=>a.doctorId===fixture.doctors[0].id&&a.patientId===fixture.people[0].id);
  check(!!saved,'The interrupted-refresh scenario really committed one appointment');await second.context.close();
  const third=await login(),r=third.page;
  await r.goto(base+`/Workspace?appointment=${saved.id}#appointments`);await r.locator(`[data-move="${saved.id}"]`).click();await r.locator('#booking-date').fill(fixture.day);await r.locator('[data-time="10:00"]').click();await r.locator('#review-booking').click();
  const csrf=await r.locator('#csrf input').inputValue();
  const changed=await r.request.post(base+`/data/appointments/${saved.id}/move`,{headers:{'X-Workspace-Clinic':'main','X-CSRF-TOKEN':csrf},data:{date:fixture.day,time:'11:00',version:saved.version}});check(changed.status()===200,'A second staff edit changes the appointment during review');
  await r.locator('#submit-booking').click();await r.locator('#booking-error .inline-error').waitFor();
  const reload=r.locator('#reload-booking');check(await reload.count()===1,'A stale reschedule offers an in-dialog reload action');
  if(await reload.count()){
   await reload.click();await r.locator('.slot.selected').waitFor();check((await r.locator('.slot.selected').innerText())==='11:00','Reloaded rescheduling starts from the saved current time');
   await r.locator('[data-time="12:00"]').click();await r.locator('#review-booking').click();await r.locator('#submit-booking').click();await r.locator('.success-view').waitFor();check(true,'A recovered stale reschedule can be saved without closing and restarting');
  }
  await third.context.close();
  // Catalogue failures and patient successes are also bound to their originating dialog.
  const fourth=await login(),c=fourth.page,formErrors=[];c.on('pageerror',e=>formErrors.push(e.message));
  await c.goto(base+'/Workspace#doctors');await c.locator('#catalogue-add').click();await c.locator('#catalogue-name').fill('Одложен лекар');await c.locator('#catalogue-specialty').selectOption(fixture.service.specialtyId);
  let catArrive,catRelease;const catStarted=new Promise(r=>catArrive=r),catGate=new Promise(r=>catRelease=r);
  await c.route('**/data/catalogue/doctors',async route=>{catArrive();await catGate;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Old catalogue conflict'})});});
  await c.locator('#catalogue-form button[type=submit]').click();await catStarted;await c.locator('#close-dialog').click();await c.goto(base+'/Workspace#patients');await c.locator('[data-action=add-patient]').click();catRelease();await c.waitForTimeout(200);
  check(formErrors.length===0&&await c.locator('#patient-form').isVisible(),'Late catalogue errors cannot throw or replace a new patient form');
  await c.locator('#close-dialog').click();await c.locator('[data-action=add-patient]').click();await c.locator('#patient-name').fill('Одложен пациент');
  let patientArrive,patientRelease;const patientStarted=new Promise(r=>patientArrive=r),patientGate=new Promise(r=>patientRelease=r);
  await c.route('**/data/patients',async route=>{const response=await route.fetch();patientArrive();await patientGate;await route.fulfill({response});});
  await c.locator('#patient-form button[type=submit]').click();await patientStarted;await c.locator('#close-dialog').click();await c.goto(base+'/Workspace#doctors');await c.locator(`[data-book="${fixture.doctors[1].id}"]`).click();patientRelease();await c.waitForTimeout(300);
  check(formErrors.length===0&&await c.locator('#booking-doctor-input').isVisible(),'Late patient creation cannot close a different booking form');
  await fourth.context.close();
  const fifth=await login(),v=fifth.page;await v.goto(base+'/Workspace#patients');await v.locator('[data-action=add-patient]').click();await v.locator('#patient-name').fill('Пациент зачуван без освежување');
  await v.route('**/data/bootstrap',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Read unavailable'})}));
  await v.locator('#patient-form button[type=submit]').click();await v.locator('#main-dialog').waitFor({state:'hidden'});
  check((await v.locator('#patient-results').innerText()).includes('Пациент зачуван без освежување'),'Patient creation remains acknowledged when the following refresh fails');await fifth.context.close();
  if(failures.length)throw Error(failures.join('; '));console.log(`${count}/${count} overnight browser checks passed.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
