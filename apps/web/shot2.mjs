import { chromium, devices } from '@playwright/test';
const OUT = process.argv[2];
const base = process.env.E2E_BASE_URL;
const browser = await chromium.launch();
for (const locale of ['en', 'bn']) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto(`${base}/${locale === 'en' ? '' : 'bn/'}register`);
  await page.waitForTimeout(2500);
  // Step to the page holding date of birth.
  for (let i = 0; i < 6; i += 1) {
    const dob = page.locator('#dateOfBirth');
    if (await dob.count() && await dob.isVisible().catch(() => false)) break;
    const next = page.locator('button', { hasText: /next|পরবর্তী/i }).last();
    if (!(await next.count())) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(600);
  const dob = page.locator('#dateOfBirth');
  if (await dob.count()) {
    await dob.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/dob-${locale}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log('done');
