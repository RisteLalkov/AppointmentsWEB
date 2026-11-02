const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_WEB_URL + '/Account/Login');
    await page.locator('[name=Email]').fill('main@high.test');
    await page.locator('[name=Password]').fill(process.env.TEST_PASSWORD);
    await Promise.all([page.waitForURL(url => !url.pathname.includes('/Account/Login')), page.locator('button[type=submit]').click()]);
    await page.goto(process.env.TEST_WEB_URL + '/Accounts');
    const row = page.locator('.account-row').filter({ hasText: 'target@high.test' });
    for (const [button, posted, badge] of [['Оневозможи пристап', 'false', 'Оневозможена'], ['Овозможи пристап', 'true', 'Овозможена']]) {
      const form = row.locator('form').first();
      if (await form.locator('[name=enabled]').inputValue() !== posted) throw new Error('Incorrect literal boolean');
      const submitted = page.waitForRequest(r => r.url().endsWith('/Accounts/Access') && r.method() === 'POST');
      await Promise.all([page.waitForURL(url => url.pathname === '/Accounts'), form.getByRole('button', { name: button, exact: true }).click()]);
      const request = await submitted;
      if (new URLSearchParams(request.postData()).get('enabled') !== posted) throw new Error('Wrong posted boolean');
      await row.locator('.badge').filter({ hasText: badge }).waitFor();
      console.log('PASS Real Razor account access round trip: ' + posted);
    }
    // Exercise the actual Web hop with two original client addresses behind one trusted test proxy.
    const noisyContext = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.30' } });
    const noisyPage = await noisyContext.newPage();
    await noisyPage.goto(process.env.TEST_WEB_URL + '/Account/Login');
    const csrf = await noisyPage.locator('[name=__RequestVerificationToken]').inputValue();
    let response;
    for (let i = 0; i < 31; i++) response = await noisyContext.request.post(process.env.TEST_WEB_URL + '/Account/Login', {
      form: { Email: 'absent@high.test', Password: process.env.TEST_PASSWORD, __RequestVerificationToken: csrf }
    });
    const responseText = await noisyPage.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent, await response.text());
    if (!responseText.includes('Премногу барања')) throw new Error('Noisy Web visitor did not hit individual quota');
    const otherContext = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.31' } });
    const otherPage = await otherContext.newPage();
    await otherPage.goto(process.env.TEST_WEB_URL + '/Account/Login');
    await otherPage.locator('[name=Email]').fill('main@high.test');
    await otherPage.locator('[name=Password]').fill(process.env.TEST_PASSWORD);
    await Promise.all([otherPage.waitForURL(url => !url.pathname.includes('/Account/Login')), otherPage.locator('button[type=submit]').click()]);
    console.log('PASS Independent original Web visitors retain separate API rate-limit budgets');
    await noisyContext.close(); await otherContext.close();
    await page.goto(process.env.TEST_WEB_URL + '/Workspace#doctors');
    const workspaceToken = await page.locator('#csrf input').inputValue();
    const protectedHeaders = { 'X-CSRF-TOKEN': workspaceToken, 'X-Workspace-Clinic': 'main' };
    const specialtyResponse = await page.request.post(process.env.TEST_WEB_URL + '/data/catalogue/specialties', {
      headers: protectedHeaders, data: { name: 'Проверка на поставки' }
    });
    if (!specialtyResponse.ok()) throw new Error('Cannot create doctor UI fixture specialty');
    const specialty = await specialtyResponse.json();
    const doctorResponse = await page.request.post(process.env.TEST_WEB_URL + '/data/catalogue/doctors', {
      headers: protectedHeaders, data: { name: 'Д-р Проверка', specialtyId: specialty.id, subspecialty: '', enabled: true, requiresConfirmation: true, staffOnly: false }
    });
    if (!doctorResponse.ok()) throw new Error('Cannot create doctor UI fixture');
    const doctor = await doctorResponse.json();
    await page.reload();
    for (const desired of [true, false]) {
      const edit = page.locator('[data-doctor-edit="' + doctor.id + '"]');
      await page.locator('.doctor-menu').filter({ has: edit }).locator('summary').click();
      await edit.click();
      await page.locator('#catalogue-staff-only').setChecked(desired);
      await page.locator('#catalogue-form button[type=submit]').click();
      await page.locator('#main-dialog').waitFor({ state: 'hidden' });
      await page.locator('.doctor-menu').filter({ has: edit }).locator('summary').click();
      await edit.click();
      if (await page.locator('#catalogue-staff-only').isChecked() !== desired) throw new Error('Reception-only setting was not persisted');
      if (!await page.locator('#catalogue-confirmation').isChecked()) throw new Error('Independent confirmation setting was lost');
      await page.locator('#close-dialog').click();
      console.log('PASS Real doctor reception-only checkbox saved: ' + desired);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
