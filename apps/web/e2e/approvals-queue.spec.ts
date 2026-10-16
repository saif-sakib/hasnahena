import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { loginAs } from "./fixtures/session";
import {
  seedAccounts,
  disconnect,
  ACCOUNTS,
  assertDisposableDatabase,
} from "./fixtures/accounts";

/**
 * The approvals queue: the sidebar light (shares the screen's SWR key, so it
 * goes out at once), confirmation before money moves, and the submitted time.
 */

const PENDING_ID = "DEP-2099-900001";
const PENDING_AMOUNT = 4_500;

let prisma: PrismaClient | null = null;
const db = () => (prisma ??= new PrismaClient());

async function seedPendingDeposit() {
  assertDisposableDatabase();
  await db().transaction.deleteMany({ where: { id: PENDING_ID } });
  await db().transaction.create({
    data: {
      // The id IS the receipt number (ADR-044). Year 2099 so this can never
      // collide with a number `nextDocumentNumber` would really issue.
      id: PENDING_ID,
      type: "DEPOSIT",
      status: "PENDING",
      amount: BigInt(PENDING_AMOUNT),
      description: "e2e pending deposit",
      userId: ACCOUNTS.MEMBER.id,
      createdAt: new Date(),
    },
  });
}

async function clearPendingDeposit() {
  await db().transaction.deleteMany({ where: { id: PENDING_ID } });
}

test.describe("the approvals queue", () => {
  test.beforeAll(async () => {
    await seedAccounts();
  });

  test.beforeEach(async () => {
    await seedPendingDeposit();
  });

  test.afterAll(async () => {
    await clearPendingDeposit();
    if (prisma) await prisma.$disconnect();
    await disconnect();
  });

  test("the sidebar shows a light while something is waiting, and it goes out when the queue clears", async ({
    page,
  }) => {
    await loginAs(page, "ADMIN");

    const light = page.getByRole("status", { name: /pending approvals/i });
    await expect(
      light,
      "no light on the sidebar with an item waiting",
    ).toBeVisible();

    // By href, not by name: the light contributes its own label to the link's
    // accessible name, so an exact name match breaks the moment the badge works.
    await page.locator('a[href$="/dashboard/admin/approvals"]').first().click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/approvals/);

    // A marker that does not survive a reload, so the assertion at the end is
    // about a live update rather than a page that happened to come back empty.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    // An admin lands on the Registration tab; the seeded item is a deposit.
    await page.getByRole("button", { name: /^Deposit/ }).click();

    const row = page.locator("tr", {
      hasText: PENDING_AMOUNT.toLocaleString("en-GB"),
    });
    await expect(row.first()).toBeVisible();

    // The submitted time, not only the date.
    await expect(
      row.first(),
      "the row shows no time — only a date, which cannot order two requests from one day",
    ).toContainText(/\d{2}:\d{2}/);

    // Approving must ask first.
    await row.first().getByRole("button").last().click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog,
      "approving acted on the first press, with no confirmation",
    ).toBeVisible();
    await expect(dialog).toContainText(/Approve this request\?/i);
    await expect(dialog).toContainText(ACCOUNTS.MEMBER.accountNo);

    // Cancelling must leave it alone.
    await dialog.getByRole("button", { name: /^Cancel$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(
      row.first(),
      "cancelling the dialog still acted on the request",
    ).toBeVisible();

    // Confirming clears it.
    await row.first().getByRole("button").last().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Approve$/i })
      .click();

    await expect(
      light,
      "the light did not go out after the queue emptied",
    ).toBeHidden({
      timeout: 20_000,
    });

    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __noReload?: boolean }).__noReload === true,
      ),
      "the page reloaded, so this proves nothing about a live update",
    ).toBe(true);
  });
});
