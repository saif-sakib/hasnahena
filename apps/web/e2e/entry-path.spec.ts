import { test, expect, devices, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { hasDatabase, assertDisposableDatabase, disconnect } from './fixtures/accounts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PENDING_APPROVAL_PASSWORD_HASH } from '../lib/rejected-application';

/**
 * T-08 — the entry path, walked end to end.
 *
 * *"The entry point to this foundation is the registration process, so the whole
 * entry point should be user friendly, zero bugs, and the arising of bugs in the
 * future should be very minimum."* — the owner, 2026-08-25.
 *
 * `registration.spec.ts` covers the **form**: which field is flagged, whether
 * the message can be seen on a handset, whether a step scrolls. This covers the
 * **journey** the form is the first step of, which nothing did:
 *
 *     apply → the applicant is told what happens next
 *           → an admin decides
 *           → the applicant is told the decision
 *           → and, if approved, can actually get in
 *
 * Every defect the T-06 audit found lived in the *gaps* between those, which is
 * why no existing test caught them. The form worked. The approval endpoint
 * worked. What did not work was that a rejected applicant was never told
 * anything and could not be told afterwards, that a submitted applicant got a
 * two-second toast and a redirect to a login page they cannot use, and that the
 * one email the foundation sends did not say what to log in with.
 *
 * At a **phone viewport, in both languages** (rule 10). The registration form is
 * eight steps of dense Bengali text on a 412 px screen; the language that fits
 * in English is the one that overflows in Bengali.
 */

test.use({ ...devices['Pixel 7'] });

test.describe('the entry path', () => {
  test.skip(!hasDatabase(), 'Set DATABASE_URL (scripts/test-stack.sh env) to run the entry-path spec.');

  // Namespaced so this file can clean up after itself without touching rows
  // another suite seeded — the Go suites truncate between tests, this one does
  // not, and a spec that deletes by shape eventually deletes somebody else's
  // fixture.
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

  /**
   * The seeded application has to be the shape the route actually writes.
   *
   * A hand-built fixture that has drifted from the code passes forever while
   * testing nothing, and this one carries the two fields the decision path turns
   * on: the password-hash sentinel that makes a row a rejectable *application*
   * rather than a member, and `preferredLocale`. Reading the route is how the
   * drift becomes a failure instead of a false green.
   */
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
   * Whether a real form submission can reach the end of `POST /registrations`.
   *
   * It uploads four images to Cloudinary and rolls the whole application back if
   * any of them fails — correctly, because the NID scan is a regulatory record
   * and a member row without one is worse than no member row. So on a machine
   * with no Cloudinary credentials the form cannot be driven end to end, and
   * **CI is deliberately such a machine**: that account holds real members' NID
   * photographs and no test may write to it.
   *
   * That is why the four tests below that are about the *decision* create their
   * applicant with Prisma instead of through the form. They are not about the
   * form — `registration.spec.ts` owns it, and stubs the POST for the same
   * reason. Only the two that assert what the applicant is shown after
   * submitting need the real round trip, and those skip when this is false.
   */
  const CLOUDINARY_KEYS = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ] as const;

  const canSubmitForReal = (() => {
    if (CLOUDINARY_KEYS.every((key) => process.env[key])) return true;
    // Playwright's own process does not load `apps/web/.env`; **Next does**, so
    // asking `process.env` alone would skip these two tests on every developer
    // machine that can actually run them. Read the file the server reads.
    try {
      const env = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
      return CLOUDINARY_KEYS.every((key) => new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(env));
    } catch {
      return false;
    }
  })();

  /**
   * A PENDING application, written the way the route writes one.
   *
   * Every field here is one the decision path reads: `passwordHash` is the
   * sentinel that makes this a *rejected-able application* rather than a member
   * (`lib/rejected-application.ts`), `preferredLocale` decides which language the
   * decision email goes out in, and `formNumber` is the reference the applicant
   * was given — **not** an account number, which they do not have until they are
   * admitted ([ADR-039](../../../docs/decisions.md)). Getting any of them wrong would make these tests pass
   * against a row the real flow never produces, which is the failure mode of
   * every hand-built fixture — so `applicationShapeMatchesTheRoute` below reads
   * the route and checks.
   */
  let seededApplications = 0;

  async function seedApplication(tag: string, locale: 'en' | 'bn' = 'en') {
    const who = applicant(tag);
    // `formNumber` is derived per seeded row rather than from the tag alone: a
    // re-application is a **second row** holding the same email, phone and NID
    // as the first, so a number derived from the tag would collide on exactly
    // the test that matters.
    seededApplications += 1;
    const seq = (Math.abs(hash(tag)) % 90_000) + 9000 + seededApplications;
    return prisma.user.create({
      data: {
        email: who.email,
        phone: who.phone,
        passwordHash: PENDING_APPROVAL_PASSWORD_HASH,
        preferredLocale: locale,
        role: 'MEMBER',
        status: 'PENDING',
        // **No account number.** An application does not have one — it is
        // issued on approval and nowhere else ([ADR-039](../../../docs/decisions.md)),
        // so that refusing somebody does not consume a number from the
        // foundation's register. This mirrors what `POST /registrations` writes.
        formNumber: `APP-2026-${String(seq).padStart(6, '0')}`,
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

  /**
   * Wait until react-hook-form is driving the page.
   *
   * Copied deliberately from `registration.spec.ts` rather than shared: until
   * React hydrates, Playwright types into server-rendered markup and none of it
   * reaches the form — the DOM changes, the form state does not, and the next
   * step never opens. Probing a *derived* value is the only reliable signal.
   */
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
    await page.fill('#dateOfBirth', overrides.dateOfBirth ?? '1990-04-12');
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
        'Needs CLOUDINARY_* — POST /registrations uploads the four documents and rolls the ' +
          'application back if it cannot. CI has no credentials on purpose: that account holds ' +
          "real members' NID photographs.",
      );
      const tag = `confirm-${locale}`;
      await reset(tag);
      await apply(page, tag, locale);

      // What this replaces: a two-second toast, then `router.push('/login')`.
      // The receipt for twenty minutes of form-filling vanished on its own, and
      // the applicant was left on a door that cannot open — an application has
      // no password until it is approved.
      const heading = page.getByRole('heading', {
        name: locale === 'bn' ? 'আবেদন জমা হয়েছে' : 'Application submitted',
      });
      await expect(heading).toBeVisible({ timeout: 30_000 });

      // The **application's** reference — `APP-2026-000001` — allocated at
      // submission. Not an account number: that is issued if and when the
      // application is approved, and is in the approval email. This used to
      // assert `ACC-KH-…`, which is what a public form allocating membership
      // numbers looked like from the outside.
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
    // A pending applicant cannot log in — they have no password yet — so they
    // see the same refusal as a stranger. That is deliberate and must stay:
    // answering "your application is under review" would confirm the identifier
    // belongs to an applicant, which is the membership oracle ADR-032 closed on
    // forgot-password, on a busier endpoint. For a religious-finance
    // cooperative in one town, membership itself is the sensitive fact.
    //
    // So the hint is unconditional, and this test is what stops somebody
    // "improving" it into a conditional one.
    const tag = 'oracle';
    await reset(tag);
    // The application is seeded rather than filled in: what is under test is the
    // *login page's* answer, and driving twenty form fields to reach it would
    // make this test depend on an image host for no assertion of its own.
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

    // Approve through the API rather than the admin screen: this test is about
    // the *applicant's* half of the journey, and admin-dashboard.spec.ts owns
    // the screen. No pre-check that an admin exists: `adminToken()` logs one in
    // and asserts on the response, which proves the same thing without guessing
    // at the seeded account's role — the seeded admin is SUPER_ADMIN, and the
    // only row with role ADMIN is the inactive donation-fund system account.
    const approval = await approveViaApi(page, application.id);
    expect(approval.accountNo, 'the approval must hand back the account number it allocated')
      .toMatch(/^ACC-KH-\d+$/);

    // **The password comes from the staff-assisted reset, not from the
    // approval.** The approval used to return a temporary password and the
    // admin screen displayed it; it does not any more, because a working
    // credential for a fresh account does not belong on a queue screen in a
    // shared office. Most members of this cooperative have no email (ADR-036),
    // so this route *is* how they are given one — which makes it part of the
    // entry path, and this is the test that walks it.
    const temporaryPassword = await resetPasswordViaApi(page, application.id, approval.accountNo);
    expect(temporaryPassword, 'an admin must be able to issue a password to a member with no email')
      .toBeTruthy();

    await page.goto('/login');
    await page.fill('input[name="identifier"]', applicant(tag).email);
    await page.fill('input[name="password"]', temporaryPassword);
    await page.click('button[type="submit"]');

    // The forced password change, which is the last step of the entry path and
    // the one nothing walked end to end. A member arriving with a password that
    // was emailed to them must not be able to keep it.
    await expect(
      page.getByText(/set (a )?new password|choose a( new)? password/i).first(),
    ).toBeVisible({ timeout: 25_000 });

    // Not on a dashboard yet — the change is not optional.
    await expect(page).not.toHaveURL(/\/dashboard\//);
  });

  test('a rejected applicant is told why, and may apply again with the same details', async ({ page }) => {
    // The finding this exists for. Rejection wrote a status, overwrote the
    // applicant's email and phone so the unique constraint would let them
    // reapply, and told them **nothing** — not by email, not in the app. The
    // scramble meant they could not be told afterwards either. The foundation
    // held an application it had refused and no way to say so.
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

    // **The contact details survive**, which is the whole point: they are what
    // the rejection email is sent to, and they used to be destroyed by the same
    // statement that recorded the decision.
    expect(rejected.email).toBe(who.email);
    expect(rejected.phone).toBe(who.phone);

    // And the same person can apply again with the same email, phone and NID —
    // the owner's ruling, enforced by the live-scoped unique indexes.
    //
    // Asserted as a second INSERT rather than a second trip through the form,
    // and that is the stronger check of the two: what permits the re-application
    // is `users_email_live_key` / `users_phone_live_key` / `users_nid_live_key`,
    // and only a write reaches them. A form submission would be refused by the
    // route's own duplicate check first, so it would never touch the constraint
    // this is about. The form path is covered by the gated pair above.
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

  /**
   * The staff-assisted reset (ADR-036), through the Next route that owns it.
   *
   * `E2E_BASE_URL` rather than `apiBase`: this half lives in the web app, not
   * the Go API, because it revokes every session in the same transaction as the
   * password.
   */
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
    // FR-05 asks for "approve/reject with reason". The admin screen used to
    // post `reason: ''` — hardcoded, with no control to change it — so the
    // requirement was met on paper and by nothing in practice. The server is
    // where that has to be enforced, because the screen is only one caller.
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
