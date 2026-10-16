import { test, expect, devices, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { hasDatabase, assertDisposableDatabase, disconnect } from './fixtures/accounts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PENDING_APPROVAL_PASSWORD_HASH } from '../lib/rejected-application';

/**
 * T-08 — the entry path end to end, at a phone viewport in both languages:
 * apply → told what happens next → an admin decides → told the decision → if
 * approved, can get in. (registration.spec.ts covers the form itself.)
 */

test.use({ ...devices['Pixel 7'] });

test.describe('the entry path', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run the entry-path spec.');

  // Namespaced, so cleanup never touches another suite's rows.
  const NS = 'entrypath-e2e';
  const applicant = (tag: string) => ({
    nameEn: `Entry Path ${tag}`,
    email: `${NS}-${tag}@example.test`,
    // 11 digits, deterministic per tag so a re-run reuses the same row.
    phone: `0179${String(Math.abs(hash(tag)) % 10_000_000).padStart(7, '0')}`,
    nidNumber: `77${String(Math.abs(hash(tag)) % 100_000_000).padStart(8, '0')}`,
  });

  function hash(value: string): number {
    let out = 0;
    for (const ch of value) out = (out * 31 + ch.charCodeAt(0)) | 0;
    return out;
  }

  let prisma: PrismaClient;

  test.beforeAll(() => {
    assertDisposableDatabase();
    prisma = new PrismaClient();
  });

  /** The seeded application must match what the route writes — read the route. */
  test('the seeded application matches what POST /registrations writes', async () => {
    const route = readFileSync(
      resolve(__dirname, '..', 'app/api/v1/registrations/route.ts'),
      'utf8',
    );
    for (const field of [
      'passwordHash: PENDING_APPROVAL_PASSWORD_HASH',
      'preferredLocale: applicantLocale',
      'status: UserStatus.PENDING',
      'role: UserRole.MEMBER',
    ]) {
      expect(
        route,
        `POST /registrations no longer writes \`${field}\` — seedApplication() in this ` +
          'file builds a row the real flow never produces, so every decision test below ' +
          'is now asserting against a fixture rather than against the entry path.',
      ).toContain(field);
    }
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: `${NS}-` } } });
    await prisma.$disconnect();
    await disconnect();
  });

  /**
   * A real submission uploads four images to Cloudinary; CI has no credentials
   * on purpose (real NID scans), so decision tests seed via Prisma and only the
   * two post-submission tests need — and skip without — the real round trip.
   */
  const CLOUDINARY_KEYS = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ] as const;

  const hasCloudinaryCredentials = (() => {
    if (CLOUDINARY_KEYS.every((key) => process.env[key])) return true;
    // Next loads apps/web/.env; Playwright does not — read the file.
    try {
      const env = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
      return CLOUDINARY_KEYS.every((key) => new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(env));
    } catch {
      return false;
    }
  })();

  /**
   * Credentials are not permission: apps/web/.env is the foundation's real
   * cloud. Uploads require ALLOW_TEST_IMAGE_UPLOADS, the same switch
   * lib/cloudinary.ts enforces.
   */
  const canSubmitForReal =
    hasCloudinaryCredentials && process.env.ALLOW_TEST_IMAGE_UPLOADS === 'yes';

  /**
   * A PENDING application as the route writes it: the password-hash sentinel,
   * preferredLocale, and a formNumber — no account number (ADR-039).
   */
  let seededApplications = 0;

  async function seedApplication(tag: string, locale: 'en' | 'bn' = 'en') {
    const who = applicant(tag);
    // Per row: a re-application reuses the same email, phone and NID.
    seededApplications += 1;
    const seq = (Math.abs(hash(tag)) % 90_000) + 9000 + seededApplications;
    const formNumber = `APP-2026-${String(seq).padStart(6, '0')}`;
    return prisma.user.create({
      data: {
        // The applicant's own number, which is also their row id since
        // [ADR-043](../../docs/decisions.md).
        id: formNumber,
        email: who.email,
        phone: who.phone,
        passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
        preferredLocale: locale,
        role: 'MEMBER',
        status: 'PENDING',
        // No account number until approval (ADR-039).
        formNumber,
        nameEn: who.nameEn,
        fatherName: 'Mohammad Ali',
        motherName: 'Fatema Begum',
        profession: 'Farmer',
        dateOfBirth: new Date('1990-04-12T00:00:00Z'),
        nidNumber: who.nidNumber,
        account: {
          create: {
            savingsBalance: BigInt(0),
            loanBalance: BigInt(0),
          },
        },
      },
      select: { id: true, accountNo: true },
    });
  }

  /** Remove any row this spec left behind, so each test starts from nothing. */
  async function reset(tag: string) {
    const who = applicant(tag);
    const rows = await prisma.user.findMany({
      where: { OR: [{ email: who.email }, { phone: who.phone }] },
      select: { id: true, nameEn: true },
    });
    for (const row of rows) {
      await prisma.notification.deleteMany({ where: { message: { contains: row.nameEn } } });
      await prisma.user.delete({ where: { id: row.id } });
    }
    // The submission throttle keys on the caller's address, and every test in
    // this file shares one.
    await prisma.rateLimit.deleteMany({ where: { id: { startsWith: 'registration-submit:' } } });
  }

  // -------------------------------------------------------------------------
  // Filling the form
  // -------------------------------------------------------------------------

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Wait for react-hook-form to drive the page (typing before hydration is lost). */
  async function waitForHydration(page: Page) {
    await expect(async () => {
      await page.selectOption('#maritalStatus', 'MARRIED');
      await expect(page.locator('#childrenCount')).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await page.selectOption('#maritalStatus', 'UNMARRIED');
  }

  /** Fill every step and submit. Returns nothing; the caller asserts. */
  async function apply(page: Page, tag: string, locale: 'en' | 'bn', overrides: { dateOfBirth?: string } = {}) {
    const who = applicant(tag);
    const next = locale === 'bn' ? 'পরবর্তী' : 'Next';
    const submit = locale === 'bn' ? 'নিবন্ধন সম্পন্ন করুন' : 'Complete Registration';

    await page.goto(locale === 'bn' ? '/bn/register' : '/register');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await waitForHydration(page);

    await page.fill('#nameEn', who.nameEn);
    await page.fill('#fatherName', 'Mohammad Ali');
    await page.fill('#motherName', 'Fatema Begum');
    await page.fill('#phone', who.phone);
    await page.fill('#email', who.email);
    await page.fill('#nidNumber', who.nidNumber);
    await page.fill('#profession', 'Farmer');
    // Three selects, not a date input — the platform calendar was unusable for a
    // birthday on the phones this is for. The value the form holds is unchanged.
    const [dobYear, dobMonth, dobDay] = (overrides.dateOfBirth ?? '1990-04-12').split('-');
    await page.selectOption('#dateOfBirth', String(Number(dobDay)));
    await page.selectOption('#dateOfBirthMonth', String(Number(dobMonth)));
    await page.selectOption('#dateOfBirthYear', dobYear);
    await page.getByRole('button', { name: next, exact: true }).click();

    await expect(page.locator('#permanentHouseNo')).toBeVisible();
    await page.fill('#permanentHouseNo', '12');
    await page.fill('#permanentVillage', 'Bhekutia');
    await page.fill('#permanentUnion', 'Sadar');
    await page.fill('#permanentPoliceStation', 'Kotwali');
    await page.fill('#permanentDistrict', 'Jashore');
    await page.getByRole('button', { name: next, exact: true }).click();

    await expect(page.locator('#nomineeName')).toBeVisible();
    await page.fill('#nomineeName', 'Fatema Begum');
    await page.fill('#nomineeRelationship', 'Mother');
    // Deliberately not the applicant's own NID — the form refuses that now, and
    // `registration.test.ts` covers the refusal.
    await page.fill('#nomineeNid', '9876543210');
    await page.getByRole('button', { name: next, exact: true }).click();

    await expect(page.getByRole('button', { name: submit })).toBeVisible();
    for (const key of ['nidFrontImage', 'nidBackImage', 'memberPhotoImage', 'signatureImage']) {
      await page.setInputFiles(`#${key}`, { name: `${key}.png`, mimeType: 'image/png', buffer: PNG });
    }
    await page.check('#agreeToTerms');
    await page.getByRole('button', { name: submit }).click();
  }

  // -------------------------------------------------------------------------
  // What the applicant is told
  // -------------------------------------------------------------------------

  for (const locale of ['en', 'bn'] as const) {
    test(`${locale}: submitting leaves the applicant on a confirmation, not a login page`, async ({ page }) => {
      test.skip(
        !canSubmitForReal,
        'Needs CLOUDINARY_* and ALLOW_TEST_IMAGE_UPLOADS=yes — POST /registrations uploads the ' +
          'four documents and rolls the application back if it cannot. CI has no credentials on ' +
          "purpose, and a developer's own credentials name the account holding real members' " +
          'NID photographs: point them at a disposable cloud before opting in.',
      );
      const tag = `confirm-${locale}`;
      await reset(tag);
      await apply(page, tag, locale);

      // A confirmation screen, not a toast and a redirect to an unusable login.
      const heading = page.getByRole('heading', {
        name: locale === 'bn' ? 'আবেদন জমা হয়েছে' : 'Application submitted',
      });
      await expect(heading).toBeVisible({ timeout: 30_000 });

      // The application reference (APP-…), not an account number.
      await expect(page.getByText(/APP-\d{4}-\d{6}/)).toBeVisible();
      await expect(page.getByText(/ACC-KH-\d+/)).toHaveCount(0);

      // And it stays. A toast would be gone by now.
      await page.waitForTimeout(4000);
      await expect(heading).toBeVisible();

      // It must NOT push them at the login page.
      await expect(page).not.toHaveURL(/\/login/);

      // Rule 10: the whole confirmation has to fit a 412 px screen without
      // sideways scrolling, in Bengali as well as English.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, 'the confirmation scrolls sideways on a phone').toBe(false);

      const row = await prisma.user.findFirst({
        where: { email: applicant(tag).email },
        select: { status: true, preferredLocale: true, accountNo: true },
      });
      expect(row?.status).toBe('PENDING');
      // The language they applied in, recorded so the decision email arrives in
      // it rather than in whatever the deciding admin happens to be reading.
      expect(row?.preferredLocale).toBe(locale);
    });
  }

  test('the login page never confirms whether an identifier belongs to an applicant', async ({ page }) => {
    // A pending applicant gets the SAME refusal as a stranger (ADR-032) — this
    // stops anyone making the hint conditional.
    const tag = 'oracle';
    await reset(tag);
    // Seeded: the subject is the login page's answer.
    await seedApplication(tag);

    const who = applicant(tag);

    async function refusalFor(identifier: string): Promise<string> {
      await page.goto('/login');
      await page.fill('input[name="identifier"]', identifier);
      await page.fill('input[name="password"]', 'not-the-password-either-way');
      await page.click('button[type="submit"]');
      const alert = page.locator('div').filter({ hasText: /./ }).last();
      await expect(page.getByText(/Applied recently\?/i)).toBeVisible({ timeout: 20_000 });
      void alert;
      return (await page.locator('p.text-red-600').first().innerText()).trim();
    }

    const applicantRefusal = await refusalFor(who.email);
    const strangerRefusal = await refusalFor(`${NS}-nobody-at-all@example.test`);

    expect(
      applicantRefusal,
      'the login page answers a pending applicant differently from a stranger — ' +
        'that difference is a membership oracle (rule 7a, ADR-032)',
    ).toBe(strangerRefusal);
  });

  // -------------------------------------------------------------------------
  // The decision, and getting in
  // -------------------------------------------------------------------------

  test('an approved applicant can log in and is made to choose a password', async ({ page }) => {
    const tag = 'approve';
    await reset(tag);
    const application = await seedApplication(tag);

    // Approve via the API (admin-dashboard.spec.ts owns the screen).
    const approval = await approveViaApi(page, application.id);
    expect(approval.accountNo, 'the approval must hand back the account number it allocated')
      .toMatch(/^ACC-KH-\d+$/);

    // The row id moved to the account number (ADR-043) and its children cascaded.
    const renamed = await prisma.user.findUnique({
      where: { id: approval.accountNo },
      select: { id: true, formNumber: true, account: { select: { userId: true } } },
    });
    expect(renamed, 'the member must now be addressable by their account number').not.toBeNull();
    expect(renamed?.formNumber, 'the application reference survives the rename')
      .toMatch(/^APP-\d{4}-\d{6}$/);
    expect(renamed?.account?.userId).toBe(approval.accountNo);
    expect(await prisma.user.findUnique({ where: { id: application.id } })).toBeNull();

    // The password comes from the staff-assisted reset (ADR-036), addressed by
    // the NEW id (approval.accountNo).
    const temporaryPassword = await resetPasswordViaApi(page, approval.accountNo, approval.accountNo);
    expect(temporaryPassword, 'an admin must be able to issue a password to a member with no email')
      .toBeTruthy();

    await page.goto('/login');
    await page.fill('input[name="identifier"]', applicant(tag).email);
    await page.fill('input[name="password"]', temporaryPassword);
    await page.click('button[type="submit"]');

    // The forced password change at first login.
    await expect(
      page.getByText(/set (a )?new password|choose a( new)? password/i).first(),
    ).toBeVisible({ timeout: 25_000 });

    // Not on a dashboard yet — the change is not optional.
    await expect(page).not.toHaveURL(/\/dashboard\//);
  });

  test('a rejected applicant is told why, and may apply again with the same details', async ({ page }) => {
    // A rejected applicant is told.
    const tag = 'reject';
    await reset(tag);
    const who = applicant(tag);
    const created = await seedApplication(tag);

    const result = await rejectViaApi(page, created.id, 'UNCLEAR_DOCUMENTS', 'The back of the NID is blurred.');
    expect(result.ok, `rejection failed: ${JSON.stringify(result)}`).toBe(true);

    const rejected = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        status: true,
        email: true,
        phone: true,
        rejectionReasonCode: true,
        rejectionReasonNote: true,
        rejectedAt: true,
      },
    });

    expect(rejected.status).toBe('INACTIVE');
    // The reason is on the row, not only in an append-only log no screen reads.
    expect(rejected.rejectionReasonCode).toBe('UNCLEAR_DOCUMENTS');
    expect(rejected.rejectionReasonNote).toContain('blurred');
    expect(rejected.rejectedAt).toBeTruthy();

    // Contact details survive rejection.
    expect(rejected.email).toBe(who.email);
    expect(rejected.phone).toBe(who.phone);

    // Re-application with the same details, as a second INSERT — only a write
    // reaches the live-scoped unique indexes.
    await seedApplication(`${tag}`);

    const rows = await prisma.user.findMany({
      where: { email: who.email },
      select: { status: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['INACTIVE', 'PENDING']);
  });

  // -------------------------------------------------------------------------
  // Talking to the API as an admin, from inside the browser context
  // -------------------------------------------------------------------------

  async function adminToken(page: Page): Promise<string> {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
    const identifier = process.env.E2E_ADMIN_IDENTIFIER;
    const password = process.env.E2E_ADMIN_PASSWORD;
    expect(identifier && password, 'Set E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD').toBeTruthy();

    const response = await page.request.post(`${apiBase}/v1/auth/login`, {
      data: { identifier, password },
    });
    const body = await response.json();
    expect(body?.data?.accessToken, `admin login failed: ${JSON.stringify(body)}`).toBeTruthy();
    return body.data.accessToken as string;
  }

  async function approveViaApi(page: Page, userId: string) {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
    const token = await adminToken(page);
    const response = await page.request.post(
      `${apiBase}/v1/dashboard/admin/approvals/registration`,
      { headers: { Authorization: `Bearer ${token}` }, data: { userId, notes: '', locale: 'en' } },
    );
    const body = await response.json();
    return {
      ok: response.ok(),
      accountNo: body?.data?.accountNo as string,
    };
  }

  /** The staff-assisted reset (ADR-036), via the Next route. */
  async function resetPasswordViaApi(page: Page, userId: string, confirmAccountNo: string) {
    const token = await adminToken(page);
    const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
    const response = await page.request.post(
      `${base}/api/v1/admin/members/${userId}/reset-password`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { confirmAccountNo },
      },
    );
    const body = await response.json();
    expect(response.ok(), `reset-password failed: ${JSON.stringify(body)}`).toBe(true);
    return (body?.data?.temporaryPassword ?? body?.temporaryPassword) as string;
  }

  async function rejectViaApi(page: Page, userId: string, reasonCode: string, reasonNote: string) {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
    const token = await adminToken(page);
    const response = await page.request.post(
      `${apiBase}/v1/dashboard/admin/approvals/registration/reject`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { userId, reasonCode, reasonNote, locale: 'en' },
      },
    );
    return { ok: response.ok(), body: await response.json() };
  }

  test('a rejection with no reason is refused', async ({ page }) => {
    // FR-05: a rejection reason is enforced by the server.
    const tag = 'noreason';
    await reset(tag);
    const created = await seedApplication(tag);

    const blank = await rejectViaApi(page, created.id, '', '');
    expect(blank.ok, 'a rejection with no reason was accepted').toBe(false);

    // "Other" with no note is the same as no reason at all.
    const otherWithoutNote = await rejectViaApi(page, created.id, 'OTHER', '');
    expect(otherWithoutNote.ok, '"Other" was accepted with nothing written after it').toBe(false);

    // The application is untouched by either refusal.
    const stillPending = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true },
    });
    expect(stillPending.status).toBe('PENDING');
  });
});
