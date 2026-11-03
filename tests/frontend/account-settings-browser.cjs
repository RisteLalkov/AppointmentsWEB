const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const net = require('node:net');
const { openAccountSettings, closeAccountSettings } = require('./helpers/account-settings.cjs');
const root = resolve(__dirname, '../..');
let count = 0;
function check(ok, message) { if (!ok) throw Error(message); count++; console.log('PASS account settings ' + message); }
async function fits(page, message) {
  const result = await page.evaluate(() => {
    const dialog = document.querySelector('#account-settings-dialog'), r = dialog.getBoundingClientRect();
    return document.documentElement.scrollWidth <= innerWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1
      && r.top >= 0 && r.bottom <= innerHeight + 1 && dialog.scrollWidth <= dialog.clientWidth + 1;
  });
  if (!result) {
    console.error(await page.evaluate(() => {
      const d=document.querySelector('#account-settings-dialog'), r=d.getBoundingClientRect();
      return { viewport:[innerWidth,innerHeight], pageWidth:document.documentElement.scrollWidth, panel:{x:r.x,y:r.y,width:r.width,height:r.height,scroll:d.scrollWidth,client:d.clientWidth},
        overflow:[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0 && b.right>innerWidth+1;}).map(e=>({tag:e.tagName,classes:e.className,text:e.textContent.slice(0,70),width:e.getBoundingClientRect().width})) };
    }));
    if (process.env.TEST_SETTINGS_SCREENSHOTS) await page.screenshot({path:resolve(process.env.TEST_SETTINGS_SCREENSHOTS,'overflow.png')});
  }
  check(result,message);
}
(async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'medtermin-settings-'));
  const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port; await new Promise(r => server.close(r));
  const assembly = process.env.TEST_WEB_DLL || resolve(root, 'src/Appointments.Web/bin/Release/net10.0/Appointments.Web.dll');
  const app = spawn(process.env.TEST_DOTNET || 'dotnet', [assembly, '--urls', base], {
    cwd: process.env.TEST_WEB_DLL ? resolve(assembly, '..') : resolve(root, 'src/Appointments.Web'),
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', Backend__Mode: 'Demo', Demo__Enabled: 'true', Demo__DataPath: resolve(temp, 'state.json') }, stdio: 'ignore'
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE, args: ['--no-sandbox'] });
  const errors = [], screens = process.env.TEST_SETTINGS_SCREENSHOTS;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/Demo')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
    if (!ready) throw Error('Account settings fixture failed startup');
    if (screens) await mkdir(screens, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    for (const role of ['Patient', 'Doctor', 'Administrator']) {
      await page.goto(base + '/Demo'); await page.locator(`button[data-role="${role}"]`).click();
      await page.locator('#demo-form button[type=submit]').click(); await page.locator('.page-heading').waitFor();
      check(await page.locator('#account-settings-dialog').isHidden(), role + ' starts with settings closed');
      check(await page.locator('#sidebar a[href="/Account/Password"], #sidebar form[action="/Account/Logout"]').count() === 0, role + ' sidebar has no password/sign-out controls');
      check(await page.locator('.app-footer [data-theme-select], .app-footer [data-language-form], .topbar #zone-label').count() === 0, role + ' preferences and timezone have moved out of header/footer');
      check(await page.locator('[data-theme-select]').count() === 1 && await page.locator('[data-language-form]').count() === 1 && await page.locator('#zone-label').count() === 1, role + ' has no duplicated preferences or timezone');
      const name = await page.locator('.user-info strong').innerText();
      await page.locator('#account-menu-button').focus(); await page.keyboard.press('Enter');
      check(await page.locator('#account-settings-dialog').evaluate(e => e.matches(':modal')), role + ' account button opens a native modal');
      check(await page.locator('#account-menu-button').getAttribute('aria-expanded') === 'true' && await page.locator('.account-settings-identity h3').innerText() === name, role + ' modal displays the actual account identity');
      check(await page.locator('#zone-label').innerText() === 'Europe/Skopje', role + ' modal shows the clinic timezone');
      check(await page.locator('#account-settings-dialog a[href="/Account/Password"]').count() === 0, role + ' demo does not expose a nonfunctional password action');
      for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
      check(await page.evaluate(() => !!document.activeElement.closest('#account-settings-dialog')), role + ' Tab stays inside the modal');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#account-settings-dialog').open && document.querySelector('#account-menu-button').getAttribute('aria-expanded') === 'false');
      check(await page.locator('#account-menu-button').evaluate(e => document.activeElement === e && e.getAttribute('aria-expanded') === 'false'), role + ' Escape closes and restores focus');
      await openAccountSettings(page); await page.mouse.click(3, 3);
      check(await page.locator('#account-settings-dialog').isHidden(), role + ' backdrop click dismisses');
      await openAccountSettings(page); await page.locator('#account-settings-title').click();
      check(await page.locator('#account-settings-dialog').isVisible(), role + ' clicking inside keeps settings open');
      await closeAccountSettings(page);
    }
    await page.goto(base + '/Workspace#availability'); await page.locator('#duration').waitFor();
    const originalDuration = await page.locator('#duration').inputValue();
    await page.locator('#duration').fill(originalDuration === '35' ? '40' : '35');
    const draft = await page.locator('#duration').inputValue();
    await page.evaluate(() => window.originalDurationField = document.querySelector('#duration'));
    await openAccountSettings(page);
    let refreshes = 0; page.on('request', r => { if (new URL(r.url()).pathname === '/data/bootstrap') refreshes++; });
    const before = refreshes; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(100);
    check(refreshes === before, 'Opening settings pauses background workspace refresh');
    for (const theme of ['default', 'dark', 'vibrant']) {
      await page.locator('[data-theme-select]').selectOption(theme);
      check(await page.locator('#duration').inputValue() === draft && await page.evaluate(() => window.originalDurationField === document.querySelector('#duration')), theme + ' change preserves the underlying schedule draft');
      for (const [width, height] of [[1440, 1000], [768, 1000], [390, 850], [320, 568]]) {
        await page.setViewportSize({ width, height }); await fits(page, theme + ' fits ' + width + '×' + height);
        await page.locator('#account-settings-dialog button[type=submit]').last().scrollIntoViewIfNeeded();
        check(await page.locator('#account-settings-dialog form[action="/Account/Logout"] button').isVisible(), theme + ' sign-out remains reachable at ' + width);
      }
      if (screens) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('#account-settings-dialog').evaluate(e => e.scrollTop = 0);
        await page.screenshot({ path: resolve(screens, theme + '-desktop.png') });
        await page.setViewportSize({ width: 390, height: 850 });
        await page.screenshot({ path: resolve(screens, theme + '-mobile.png') });
      }
    }
    page.once('dialog', d => d.dismiss()); await page.locator('[data-language-form] button[value="en-GB"]').click();
    check(await page.locator('#account-settings-dialog').isVisible() && await page.locator('#duration').inputValue() === draft, 'Declining language reload keeps settings and unsaved schedule intact');
    await closeAccountSettings(page); await page.reload(); await page.locator('#duration').waitFor(); await openAccountSettings(page);
    await Promise.all([page.waitForNavigation(), page.locator('[data-language-form] button[value="en-GB"]').click()]);
    await openAccountSettings(page);
    check(await page.locator('html').getAttribute('lang') === 'en' && await page.locator('#account-settings-title').innerText() === 'Your account', 'Language switch renders translated account settings');
    check(page.url().endsWith('#availability') && await page.locator('[data-theme-select]').inputValue() === 'vibrant', 'Language switch keeps current workspace section and theme');
    check((await page.locator('#account-settings-dialog').innerText()).includes('Time zone'), 'Timezone label is translated');
    for (const [width, height] of [[1440, 1000], [390, 850], [320, 568]]) { await page.setViewportSize({ width, height }); await fits(page, 'English settings fit ' + width); }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check(await page.locator('#account-settings-dialog').evaluate(e => getComputedStyle(e).animationName) === 'none', 'Reduced motion disables entrance animation');
    await page.emulateMedia({ media: 'print' }); check(await page.locator('#account-settings-dialog').isHidden(), 'Printing hides account settings'); await page.emulateMedia({ media: 'screen' });
    await page.locator('#account-settings-dialog form[action="/Account/Logout"] button').click();
    await page.waitForURL(url => url.pathname === '/Demo');
    check(!(await page.request.get(base + '/data/bootstrap')).ok(), 'Sign-out from settings invalidates the clinical session');
    await context.close();
    if (process.env.TEST_PUBLIC_WEB) {
      const apiContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await apiContext.newPage();
      p.on('pageerror', e => errors.push(e.message));
      for (const email of ['accounts-admin@test.test', 'patient@test.test']) {
        await p.goto(process.env.TEST_PUBLIC_WEB + '/Account/Login');
        await p.locator('[name=Email]').fill(email); await p.locator('[name=Password]').fill('Test-password-123');
        await p.locator('form[action="/Account/Login"] button[type=submit]').click();
        await p.locator('#account-menu-button').waitFor(); await openAccountSettings(p);
        check(await p.locator('#account-settings-dialog a[href="/Account/Password"]').count() === 1, email + ' has one real password action inside settings');
        check(await p.locator('.account-settings-clinic').innerText() === 'Тест клиника', email + ' modal retains clinic identity');
        if (screens) await p.screenshot({ path: resolve(screens, email.startsWith('accounts') ? 'reception-account.png' : 'patient-account.png') });
        await p.locator('#account-settings-dialog a[href="/Account/Password"]').click(); await p.locator('form[action="/Account/Password"]').waitFor();
        check(await p.locator('[type=password]').count() === 2, email + ' password action opens the existing secure form');
        await p.goto(process.env.TEST_PUBLIC_WEB + '/Workspace'); await openAccountSettings(p);
        const csrf = await p.locator('#account-settings-dialog form[action="/Account/Logout"] [name=__RequestVerificationToken]').inputValue();
        check((await p.request.post(process.env.TEST_PUBLIC_WEB + '/Account/Logout', { form: {} })).status() === 400, email + ' sign-out still requires CSRF protection');
        check(!!csrf, 'Settings sign-out form includes an antiforgery token');
        await p.locator('#account-settings-dialog form[action="/Account/Logout"] button').click(); await p.waitForURL(url => url.pathname === '/Account/Login');
        check((await p.request.get(process.env.TEST_PUBLIC_WEB + '/data/bootstrap', { headers: { 'X-Workspace-Clinic': 'main' } })).status() === 401, email + ' sign-out denies further workspace data access');
      }
      await apiContext.close();
    }
    check(errors.length === 0, 'No uncaught JavaScript errors');
    console.log(`${count}/${count} account settings browser checks passed.`);
  } finally { await browser.close(); app.kill(); await new Promise(r => app.exitCode !== null ? r() : app.once('exit', r)); await rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
