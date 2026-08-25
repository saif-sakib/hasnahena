import { test, expect, devices, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { hasDatabase, assertDisposableDatabase, disconnect } from './fixtures/accounts';

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

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: `${NS}-` } } });
    await prisma.$disconnect();
    await disconnect();
  });

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

      // The account number, allocated at submission and never shown before.
      await expect(page.getByText(/ACC-KH-\d+/)).toBeVisible();

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
    await apply(page, tag, 'en');
    await expect(
      page.getByRole('heading', { name: 'Application submitted' }),
    ).toBeVisible({ timeout: 30_000 });

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
    await apply(page, tag, 'en');
    await expect(
      page.getByRole('heading', { name: 'Application submitted' }),
    ).toBeVisible({ timeout: 30_000 });

    // Approve through the API rather than the admin screen: this test is about
    // the *applicant's* half of the journey, and admin-dashboard.spec.ts owns
    // the screen. Going through the endpoint also gets us the temporary
    // password, which is the thing the applicant would have received by email.
    // No pre-check that an admin exists: `adminToken()` logs one in and asserts
    // on the response, which proves the same thing without guessing at the
    // seeded account's role — the seeded admin is SUPER_ADMIN, and the only row
    // with role ADMIN is the inactive donation-fund system account.
    const created = await prisma.user.findFirstOrThrow({
      where: { email: applicant(tag).email },
      select: { id: true },
    });

    const approval = await approveViaApi(page, created.id);
    expect(approval.temporaryPassword, 'the approval must hand back a password to hand over')
      .toBeTruthy();

    await page.goto('/login');
    await page.fill('input[name="identifier"]', applicant(tag).email);
    await page.fill('input[name="password"]', approval.temporaryPassword);
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
    await apply(page, tag, 'en');
    await expect(
      page.getByRole('heading', { name: 'Application submitted' }),
    ).toBeVisible({ timeout: 30_000 });

    const who = applicant(tag);
    const created = await prisma.user.findFirstOrThrow({
      where: { email: who.email },
      select: { id: true },
    });

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
    await apply(page, tag, 'en');
    await expect(
      page.getByRole('heading', { name: 'Application submitted' }),
    ).toBeVisible({ timeout: 30_000 });

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
      temporaryPassword: body?.data?.temporaryPassword as string,
    };
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
    await apply(page, tag, 'en');
    await expect(
      page.getByRole('heading', { name: 'Application submitted' }),
    ).toBeVisible({ timeout: 30_000 });

    const created = await prisma.user.findFirstOrThrow({
      where: { email: applicant(tag).email },
      select: { id: true },
    });

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
