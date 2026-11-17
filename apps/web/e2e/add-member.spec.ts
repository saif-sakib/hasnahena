import { test, expect, devices, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import {
  seedAccounts,
  hasDatabase,
  disconnect,
  assertDisposableDatabase,
} from './fixtures/accounts';
import { loginAs, horizontalOverflow } from './fixtures/session';
import { PENDING_APPROVAL_PASSWORD_HASH } from '../lib/rejected-application';
import { registerApiSchema } from '../lib/validation/registration';

test.use({ ...devices['Pixel 7'] });

const documents = ['nidFrontImage', 'nidBackImage', 'memberPhotoImage', 'signatureImage'];
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64',
);

async function fillPersonal(page: Page) {
  for (const [field, value] of Object.entries({
    nameEn: 'Add Member Test',
    fatherName: 'Test Father',
    motherName: 'Test Mother',
    phone: '01955508001',
    email: 'add-member@browser.test',
    nidNumber: '7654321098',
    profession: 'Farmer',
  }))
    await page.locator(`#add-member-${field}`).fill(value);
  await page.selectOption('#add-member-dateOfBirth', '12');
  await page.selectOption('#add-member-dateOfBirthMonth', '4');
  await page.selectOption('#add-member-dateOfBirthYear', '1990');
}

async function reachDocuments(page: Page, next: string) {
  await fillPersonal(page);
  await page.getByRole('button', { name: next, exact: true }).click();
  await expect(page.locator('#add-member-permanentHouseNo')).toBeVisible();
  for (const [field, value] of Object.entries({
    permanentHouseNo: '12',
    permanentVillage: 'Bhekutia',
    permanentUnion: 'Sadar',
    permanentPoliceStation: 'Kotwali',
    permanentDistrict: 'Jashore',
  }))
    await page.locator(`#add-member-${field}`).fill(value);
  await page.getByRole('button', { name: next, exact: true }).click();
  await expect(page.locator('#add-member-nomineeName')).toBeVisible();
  await page.locator('#add-member-nomineeName').fill('Test Nominee');
  await page.locator('#add-member-nomineeRelationship').fill('Mother');
  await page.locator('#add-member-nomineeNid').fill('8765432109');
  await page.getByRole('button', { name: next, exact: true }).click();
  await expect(page.locator('#add-member-nidFrontImage')).toBeAttached();
}

async function attachDocuments(page: Page) {
  for (const field of documents) {
    await page.locator(`#add-member-${field}`).setInputFiles({
      name: `${field}.png`,
      mimeType: 'image/png',
      buffer: photo,
    });
    await expect(page.getByText(`${field}.png`, { exact: true })).toBeVisible();
  }
}

test.describe('admin adds a member', () => {
  test.skip(!hasDatabase(), 'Needs the disposable test stack.');
  let prisma: PrismaClient;
  test.beforeAll(async () => {
    assertDisposableDatabase();
    prisma = new PrismaClient();
    await seedAccounts();
  });
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'add-member@browser.test' } });
    await prisma.$disconnect();
    await disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await prisma.user.deleteMany({ where: { email: 'add-member@browser.test' } });
    await page.route('**/api/v1/registrations?*', (route) =>
      route.fulfill({
        json: { ok: true, emailExists: false, phoneExists: false },
      }),
    );
  });

  for (const locale of ['en', 'bn'] as const) {
    const next = locale === 'en' ? 'Next' : 'পরবর্তী';
    const submit = locale === 'en' ? 'Register & Send Password' : 'নিবন্ধন ও পাসওয়ার্ড পাঠান';

    async function open(page: Page) {
      await loginAs(page, 'ADMIN', locale);
      await page.goto(`${locale === 'bn' ? '/bn' : ''}/dashboard/admin/members`);
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Add Member' : 'নতুন সদস্য যুক্ত করুন',
          exact: true,
        })
        .click();
      await expect(page.locator('#add-member-nameEn')).toBeVisible();
    }

    test(`${locale}: the form fits at 1280px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page);
      await reachDocuments(page, next);
      expect(await horizontalOverflow(page)).toBe(0);
      await expect(page.getByRole('dialog')).toBeInViewport();
      const overflow = await page
        .getByRole('dialog')
        .evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`add-member-${locale}-1280.png`) });
    });

    test(`${locale}: repeated Next while availability is pending cannot skip Address`, async ({
      page,
    }) => {
      await open(page);
      await fillPersonal(page);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/v1/registrations?*', async (route) => {
        await pending;
        await route.fulfill({
          json: { ok: true, emailExists: false, phoneExists: false },
        });
      });
      const check = page.waitForRequest('**/api/v1/registrations?*');
      await page.getByRole('button', { name: next, exact: true }).click();
      await check;
      // Dispatch a second submit while the first async validation is in flight.
      await page
        .locator('[role="dialog"] form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
      release();
      await expect(page.locator('#add-member-permanentHouseNo')).toBeVisible();
      await expect(page.locator('#add-member-nomineeName')).toHaveCount(0);
      await expect(page.locator('#add-member-nidFrontImage')).toHaveCount(0);
    });

    test(`${locale}: documents and validation stay visible at 412px`, async ({
      page,
    }, testInfo) => {
      await open(page);
      await reachDocuments(page, next);
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
      await page.getByRole('button', { name: submit, exact: true }).click();
      await expect(page.getByRole('alert').first()).toBeInViewport();
      await expect(page.locator('[role="dialog"]')).toBeInViewport();
      expect(await horizontalOverflow(page)).toBe(0);
      const overflow = await page
        .getByRole('dialog')
        .evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`add-member-${locale}-412.png`),
      });
    });

    test(`${locale}: a saved application exposes an approval retry without editable application fields`, async ({
      page,
    }, testInfo) => {
      await open(page);
      await reachDocuments(page, next);
      await attachDocuments(page);
      let registrations = 0;
      await page.route('**/api/v1/registrations', (route) => {
        registrations++;
        return route.fulfill({
          status: 201,
          json: {
            ok: true,
            user: {
              id: 'APP-2026-880001',
              formNumber: 'APP-2026-880001',
              nameEn: 'Add Member Test',
              email: 'add-member@browser.test',
            },
          },
        });
      });
      await page.route('**/v1/dashboard/admin/approvals/registration', (route) =>
        route.fulfill({
          status: 400,
          json: {
            success: false,
            error: { message: 'That office is not available.' },
          },
        }),
      );
      await page.getByRole('button', { name: submit, exact: true }).click();
      await expect(page.getByRole('alert').first()).toContainText('APP-2026-880001');
      // Editing a saved application's fields would silently discard those edits on retry.
      await expect(page.locator('#add-member-nomineeName')).toHaveCount(0);
      await expect(page.locator('#add-member-branch')).toBeVisible();
      await expect(page.locator('#add-member-nidFrontImage')).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`add-member-retry-${locale}-412.png`) });
      await page.route('**/v1/dashboard/admin/approvals/registration', (route) =>
        route.fulfill({
          json: {
            success: true,
            data: { accountNo: 'ACC-KH-88001', emailDelivered: false },
          },
        }),
      );
      await page.route('**/api/v1/admin/members/*/refile-documents', (route) =>
        route.fulfill({ json: { ok: true } }),
      );
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Retry activation' : 'সক্রিয়করণ আবার চেষ্টা করুন',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'ACC-KH-88001' })).toBeVisible();
      expect(registrations).toBe(1);
    });

    test(`${locale}: uploading locks the documents and ignores a second submit`, async ({
      page,
    }) => {
      await open(page);
      await reachDocuments(page, next);
      await attachDocuments(page);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let submissions = 0;
      await page.route('**/api/v1/registrations', async (route) => {
        submissions++;
        await pending;
        await route.fulfill({ status: 503, json: { ok: false, error: 'Upload unavailable' } });
      });
      const submitted = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/registrations'),
      );
      await page.getByRole('button', { name: submit, exact: true }).click();
      await submitted;
      await expect(page.locator('#add-member-nidFrontImage')).toBeDisabled();
      await expect(
        page.getByRole('button', { name: locale === 'en' ? 'Cancel' : 'বাতিল', exact: true }),
      ).toBeDisabled();
      await page
        .locator('[role="dialog"] form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
      release();
      await expect(page.getByRole('alert').first()).toContainText('Upload unavailable');
      expect(submissions).toBe(1);
    });

    test(`${locale}: the submitted application is activated by the real API with one account and audit entry`, async ({
      page,
    }) => {
      await open(page);
      await reachDocuments(page, next);
      await attachDocuments(page);
      // Cloudinary stays outside the browser test. The registration route's
      // real persistence and upload compensation run in test/routes/registration.test.ts.
      // Seed its committed result here, then exercise the real Go approval.
      await page.route('**/api/v1/registrations', async (route) => {
        const request = route.request();
        const form = await new Request(request.url(), {
          method: 'POST',
          headers: request.headers(),
          body: new Uint8Array(request.postDataBuffer()!),
        }).formData();
        const payload = registerApiSchema.parse(JSON.parse(String(form.get('payload'))));
        expect(payload.nameEn).toBe('Add Member Test');
        expect(payload.permanentDistrict).toBe('Jashore');
        expect(payload.nomineeName).toBe('Test Nominee');
        expect(form.get('locale')).toBe(locale);
        for (const key of documents) expect((form.get(key) as File).size).toBeGreaterThan(0);
        const user = await prisma.user.create({
          data: {
            id: `APP-2026-${locale === 'en' ? '880001' : '880002'}`,
            formNumber: `APP-2026-${locale === 'en' ? '880001' : '880002'}`,
            nameEn: payload.nameEn,
            fatherName: payload.fatherName,
            motherName: payload.motherName,
            phone: payload.phone,
            email: payload.email,
            nidNumber: payload.nidNumber,
            passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
            preferredLocale: locale,
            role: 'MEMBER',
            status: 'PENDING',
            account: { create: {} },
          },
        });
        await route.fulfill({
          status: 201,
          json: {
            ok: true,
            user: {
              id: user.id,
              formNumber: user.formNumber,
              nameEn: user.nameEn,
              email: user.email,
            },
          },
        });
      });
      await page.route('**/api/v1/admin/members/*/refile-documents', (route) =>
        route.fulfill({ json: { ok: true } }),
      );
      const auditFilter = { action: 'APPROVE_REGISTRATION', userId: 'e2e-admin' };
      const auditBefore = await prisma.auditLog.count({ where: auditFilter });
      const approval = page.waitForResponse('**/v1/dashboard/admin/approvals/registration');
      await page.getByRole('button', { name: submit, exact: true }).click();
      const response = await approval;
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.accountNo).toMatch(/^ACC-KH-\d+$/);
      expect(body.data).not.toHaveProperty('tempPassword');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: body.data.accountNo })).toBeVisible();
      const member = await prisma.user.findUniqueOrThrow({
        where: { id: body.data.accountNo },
        include: { account: true },
      });
      expect(member.id).toBe(body.data.accountNo);
      expect(member.status).toBe('ACTIVE');
      expect(member.assignedBranchId).toBe('KH');
      expect(member.preferredLocale).toBe(locale);
      expect(member.account?.savingsBalance).toBe(BigInt(0));
      expect(member.account?.loanBalance).toBe(BigInt(0));
      expect(await prisma.auditLog.count({ where: auditFilter })).toBe(auditBefore + 1);
      expect(
        await prisma.auditLog.findFirst({
          where: { entityId: member.id, action: 'APPROVE_REGISTRATION' },
        }),
      ).not.toBeNull();
    });
  }
});
