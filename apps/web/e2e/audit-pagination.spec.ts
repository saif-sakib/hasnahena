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
 * Numbered pages on the audit trail — the owner's request, 2026-09-02:
 * "I want for many data like this 1 2 3...10 like this to make a big jump".
 *
 * Prev/Next reached page 7 in seven presses. The obstacle was that numbered
 * pages need a total, and this route was deliberately built without a
 * `COUNT(*)` — it scanned every matching row on every keystroke of the search
 * box, against a database that bills for being awake (ADR-035), to render the
 * word "of". The count is bounded now: it stops at a ceiling, so it is O(cap)
 * rather than O(table) and cannot grow back into that scan however long the
 * trail gets — and the trail only grows, because `audit_logs` is append-only.
 *
 * This asserts the part that is not visible in the route: that the numbers are
 * really there, that pressing one *moves* rather than appending, and that the
 * jump lands where it says.
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
     * Clear this fixture's own rows first, then re-seed.
     *
     * Two runs otherwise **interleave**: each seeds 45 rows ending at `now`, so
     * a second run minutes later lands its timestamps in among the first run's,
     * and "row 041 is on page 3" stops being true for reasons that have nothing
     * to do with the pager. A test whose fixture depends on how long ago it last
     * ran is a test that fails on a Monday.
     *
     * `audit_logs` refuses DELETE unless a transaction opts in (DATA-08); that
     * hatch exists for resetting a test environment, which is exactly this, and
     * `SET LOCAL` scopes the permission to this transaction and this connection
     * so it cannot leak to a neighbouring pooled query.
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
