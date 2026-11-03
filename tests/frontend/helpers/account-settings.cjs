// Public pages retain footer preferences; workspace preferences live in the account dialog.
async function openAccountSettings(page) {
  if (!await page.locator('#account-menu-button').count()) return;
  if (!await page.locator('#account-settings-dialog[open]').count()) await page.locator('#account-menu-button').click();
  await page.locator('#account-settings-dialog').waitFor({state:'visible'});
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#account-settings-dialog')).transform === 'none');
}
async function closeAccountSettings(page) {
  if (!await page.locator('#account-settings-dialog[open]').count()) return;
  await page.locator('[data-account-settings-close]').click();
  await page.locator('#account-settings-dialog').waitFor({state:'hidden'});
}
module.exports={openAccountSettings,closeAccountSettings};
