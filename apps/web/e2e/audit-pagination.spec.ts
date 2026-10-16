import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { loginAs } from "./fixtures/session";
import {
  seedAccounts,
  disconnect,
  assertDisposableDatabase,
  ACCOUNTS,
} from "./fixtures/accounts";

/**
 * Numbered pages on the audit trail (bounded count, ADR-035): the numbers are
 * there, a press MOVES rather than appends, and a jump lands where it says.
 */

const MARKER = "e2e-pagination-fixture";
const ROWS = 45; // enough for three pages at the default twenty

let prisma: PrismaClient | null = null;
const db = () => (prisma ??= new PrismaClient());

test.describe("the audit trail pages", () => {
  test.beforeAll(async () => {
    await seedAccounts();
    assertDisposableDatabase();

    /*
     * Clear this fixture's own rows first (runs would otherwise interleave),
     * opting in to audit deletes via SET LOCAL (DATA-08).
     */
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SET LOCAL hasnahena.allow_audit_purge = 'on'",
      );
      await tx.auditLog.deleteMany({
        where: { details: { startsWith: MARKER } },
      });
    });

    // INSERT is always allowed — that is what append-only means, and is why a
    // fixture can seed one at all.
    await db().auditLog.createMany({
      data: Array.from({ length: ROWS }, (_, i) => ({
        action: "DEPOSIT_POSTED",
        entityType: "TRANSACTION",
        entityId: `DEP-2099-${String(900_001 + i).padStart(6, "0")}`,
        details: `${MARKER} row ${String(i + 1).padStart(3, "0")}`,
        userId: ACCOUNTS.ADMIN.id,
        // Descending, so row 001 is newest and lands on page 1 — the ordering
        // the screen sorts by, made explicit rather than left to insert order.
        createdAt: new Date(Date.now() - i * 60_000),
      })),
    });
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    await disconnect();
  });

  test("shows numbered pages, and pressing one jumps there", async ({
    page,
  }) => {
    await loginAs(page, "ADMIN");
    await page.goto("/dashboard/admin/audit");

    const pager = page.getByRole("navigation", { name: /pagination/i });
    await expect(
      pager,
      "no numbered pager on a trail with three pages",
    ).toBeVisible();

    // The numbers themselves, not just Prev/Next.
    await expect(pager.getByRole("button", { name: /Page 2$/ })).toBeVisible();
    await expect(pager.getByRole("button", { name: /Page 3$/ })).toBeVisible();

    // Page 1 is current, and its newest row is on screen.
    await expect(
      pager.getByRole("button", { name: /Page 1$/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`${MARKER} row 001`)).toBeVisible();

    // Jump straight to page 3.
    await pager.getByRole("button", { name: /Page 3$/ }).click();

    await expect(
      pager.getByRole("button", { name: /Page 3$/ }),
    ).toHaveAttribute("aria-current", "page");
    // Rows 41-45 are the third page of twenty.
    await expect(page.getByText(`${MARKER} row 041`)).toBeVisible();

    // **Replaced, not appended.** This is what the load-more version could not
    // do: page 1's rows must be gone, or the screen is still only growing.
    await expect(
      page.getByText(`${MARKER} row 001`),
      "page 1 is still on screen after jumping to page 3 — the pager appends instead of replacing",
    ).toBeHidden();
  });
});
