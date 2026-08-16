import { test, expect, devices, type Page } from '@playwright/test';

/**
 * Registration, exercised the way members actually reach it: on a phone.
 *
 * The bug these pin down was reported as "at the last page it shows form needs
 * attention but there is no error". Both halves were true. The form moved the
 * member to the step holding the bad field but never scrolled, so on a handset
 * they stayed parked at the buttons they had just pressed while the message sat
 * several screens above; and the only durable feedback was a toast that named
 * no field and then disappeared.
 *
 * So the assertions here are deliberately about *visibility*, not just about
 * state: an error that exists in the DOM and cannot be seen is the bug.
 */

// A mid-range Android, which is what this cooperative's members carry.
test.use({ ...devices['Pixel 7'] });

const VALID = {
  nameEn: 'Abdul Karim',
  fatherName: 'Mohammad Ali',
  motherName: 'Fatema Begum',
  phone: '01712345678',
  email: 'karim.e2e@example.com',
  nidNumber: '1234567890',
  profession: 'Farmer',
  dateOfBirth: '1990-04-12',
  house: '12',
  village: 'Bhekutia',
  union: 'Sadar',
  policeStation: 'Kotwali',
  district: 'Jashore',
  nomineeName: 'Fatema Begum',
  nomineeRelationship: 'Mother',
  nomineeNid: '9876543210',
};

async function fillPersonal(page: Page) {
  await page.fill('#nameEn', VALID.nameEn);
  await page.fill('#fatherName', VALID.fatherName);
  await page.fill('#motherName', VALID.motherName);
  await page.fill('#phone', VALID.phone);
  await page.fill('#email', VALID.email);
  await page.fill('#nidNumber', VALID.nidNumber);
  await page.fill('#profession', VALID.profession);
  await page.fill('#dateOfBirth', VALID.dateOfBirth);
}

async function fillAddress(page: Page) {
  await page.fill('#permanentHouseNo', VALID.house);
  await page.fill('#permanentVillage', VALID.village);
  await page.fill('#permanentUnion', VALID.union);
  await page.fill('#permanentPoliceStation', VALID.policeStation);
  await page.fill('#permanentDistrict', VALID.district);
}

async function fillNominee(page: Page) {
  await page.fill('#nomineeName', VALID.nomineeName);
  await page.fill('#nomineeRelationship', VALID.nomineeRelationship);
  await page.fill('#nomineeNid', VALID.nomineeNid);
}

/**
 * Wait until react-hook-form is actually driving the page.
 *
 * Until React hydrates, Playwright can click and type into the server-rendered
 * markup and none of it reaches the form: the DOM changes, the form state does
 * not, and the next step never opens. Probing a value React *derives* — the
 * children-count field is disabled from the watched marital status — is the
 * only reliable signal. The probe restores what it changed.
 */
async function waitForHydration(page: Page) {
  await expect(async () => {
    await page.selectOption('#maritalStatus', 'MARRIED');
    await expect(page.locator('#childrenCount')).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.selectOption('#maritalStatus', 'UNMARRIED');
  await expect(page.locator('#childrenCount')).toBeDisabled();
}

/** Open a clean registration form with no leftover draft, fully hydrated. */
async function gotoRegister(page: Page) {
  await page.goto('/en/register');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await waitForHydration(page);
}

/** Walk a clean form from step 1 to the documents step. */
async function reachDocumentsStep(page: Page) {
  await gotoRegister(page);
  await fillPersonal(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.locator('#permanentHouseNo')).toBeVisible();
  await fillAddress(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.locator('#nomineeName')).toBeVisible();
  await fillNominee(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Complete Registration' })).toBeVisible();
}

test.describe('registration on a phone', () => {
  test('a blocked submit says which field, in words that stay on screen', async ({ page }) => {
    await reachDocumentsStep(page);

    // Leave the agreement unticked — the one required field on this step.
    await page.getByRole('button', { name: 'Complete Registration' }).click();

    // The banner has to name the field. A toast saying "Form needs attention"
    // told the member only that something, somewhere, was wrong.
    const banner = page.getByRole('alert').filter({ hasText: /Agreement/i });
    await expect(banner).toBeVisible();
    await expect(banner).toBeInViewport();

    // And it must persist rather than time out like a toast.
    await page.waitForTimeout(6000);
    await expect(banner).toBeVisible();
  });

  test('the reason for a blocked submit is scrolled into view, not left above the fold', async ({
    page,
  }) => {
    await reachDocumentsStep(page);

    await page.check('#agreeToTerms');
    // Scroll to the very bottom, which is where a member pressing the submit
    // button actually is.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole('button', { name: 'Complete Registration' }).click();

    const banner = page.getByRole('alert').filter({ hasText: /document photos are required/i });
    await expect(banner).toBeVisible();
    // The assertion that fails without the scroll fix: the message existed in
    // the DOM before, several screens above where the member was looking.
    await expect(banner).toBeInViewport();
  });

  test('a duplicate caught by the server sends the member back to the field', async ({ page }) => {
    await reachDocumentsStep(page);

    await page.route('**/api/v1/registrations', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'A user with this phone number already exists' }),
      });
    });

    // Attach the four documents so the submit reaches the network.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    for (const key of ['nidFrontImage', 'nidBackImage', 'memberPhotoImage', 'signatureImage']) {
      await page.setInputFiles(`#${key}`, {
        name: `${key}.png`,
        mimeType: 'image/png',
        buffer: png,
      });
    }
    await page.check('#agreeToTerms');
    await page.getByRole('button', { name: 'Complete Registration' }).click();

    // Back on step 1, with the offending field flagged — not stranded on the
    // last step being told a field three steps back is taken.
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('#phone')).toBeFocused();
    // Two alerts carry this, and both are wanted: the summary at the top of the
    // card explains why the submit did nothing, and the message under the input
    // says which value to change.
    await expect(
      page.locator('div[role="alert"]').filter({ hasText: /already registered/i }),
    ).toBeVisible();
    await expect(
      page.locator('p[role="alert"]').filter({ hasText: /phone number is already registered/i }),
    ).toBeVisible();
  });

  test('every step fits the screen without sideways scrolling', async ({ page }) => {
    await gotoRegister(page);

    const overflows = async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );

    expect(await overflows()).toBe(false);
    await fillPersonal(page);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#permanentHouseNo')).toBeVisible();
    expect(await overflows()).toBe(false);

    // The present-address block is the widest thing on the form.
    await page.uncheck('#sameAsPermanent');
    await expect(page.locator('#presentHouseNo')).toBeVisible();
    expect(await overflows()).toBe(false);
  });

  test('text inputs meet the Android touch-target and no-zoom thresholds', async ({ page }) => {
    await gotoRegister(page);

    for (const id of ['#nameEn', '#phone', '#email', '#nidNumber']) {
      const box = await page.locator(id).boundingBox();
      expect(box, `${id} should be laid out`).not.toBeNull();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);

      // Below 16px, mobile browsers zoom the viewport when the field takes
      // focus, which leaves the member scrolled sideways mid-form.
      const fontSize = await page
        .locator(id)
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize, `${id} font-size`).toBeGreaterThanOrEqual(16);
    }

    // The select controls used to be 36px tall next to 40px inputs.
    for (const id of ['#gender', '#bloodGroup', '#maritalStatus']) {
      const box = await page.locator(id).boundingBox();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the way forward stays reachable without scrolling to the end of a step', async ({
    page,
  }) => {
    await gotoRegister(page);

    // Half way down the longest step, the Next button should still be on screen.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeInViewport();
  });

  test('an unfinished form comes back, without a pre-ticked agreement', async ({ page }) => {
    await gotoRegister(page);

    await fillPersonal(page);
    // The draft write is debounced.
    await page.waitForTimeout(700);

    await page.reload();
    await expect(page.locator('#nameEn')).toHaveValue(VALID.nameEn);
    await expect(page.getByText('We restored your unfinished form.')).toBeVisible();

    // Consent is an act, not a saved preference.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await fillAddress(page);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await fillNominee(page);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#agreeToTerms')).not.toBeChecked();
  });

  test('starting fresh clears the restored draft', async ({ page }) => {
    await gotoRegister(page);

    await page.fill('#nameEn', VALID.nameEn);
    await page.waitForTimeout(700);
    await page.reload();

    await page.getByRole('button', { name: 'Start fresh' }).click();
    await expect(page.locator('#nameEn')).toHaveValue('');
  });

  test('children count cannot be left stranded on an unmarried applicant', async ({ page }) => {
    await gotoRegister(page);

    await page.selectOption('#maritalStatus', 'MARRIED');
    await page.fill('#childrenCount', '3');
    // Switching back must clear the count, because the input is then disabled —
    // a leftover 3 would fail the "must be 0 when unmarried" rule in a field
    // the member is no longer allowed to touch.
    await page.selectOption('#maritalStatus', 'UNMARRIED');
    await expect(page.locator('#childrenCount')).toBeDisabled();
    await expect(page.locator('#childrenCount')).toHaveValue('0');
  });
});
