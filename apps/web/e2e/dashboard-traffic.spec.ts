import { test, expect } from "@playwright/test";

import { hasDatabase, seedAccounts, disconnect } from "./fixtures/accounts";
import { loginAs, waitForContent } from "./fixtures/session";

/**
 * WO-74 — requests one open dashboard tab makes in a minute (once ~26/min/tab).
 * Slow on purpose: a polling interval can only be observed by waiting it out.
 */

/** The window we count over. Long enough to catch a 60 s interval firing once. */
const WINDOW_MS = 70_000;

/**
 * Per-endpoint ceiling over the window. Polls run every 3 min; 6 catches a
 * poll creeping back to seconds without failing on a reasonable change.
 */
const MAX_REQUESTS_PER_ENDPOINT = 6;

test.describe("dashboard background traffic", () => {
  test.skip(
    !hasDatabase(),
    "Set DATABASE_URL (scripts/test-stack.sh env) to run this.",
  );

  test.beforeAll(async () => {
    await seedAccounts();
  });
  test.afterAll(async () => {
    await disconnect();
  });

  /** Both roles — staff poll the approvals badge, which a member does not. */
  for (const role of ["MEMBER", "ADMIN"] as const) {
    test(`an idle ${role.toLowerCase()} tab is quiet for a minute`, async ({
      page,
    }) => {
      test.setTimeout(WINDOW_MS + 90_000);

      const counts = new Map<string, number>();
      const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

      page.on("request", (request) => {
        const url = request.url();
        if (url.includes("/dashboard/notifications")) bump("notifications");
        else if (url.includes("/dashboard/support/threads"))
          bump("support/threads");
        else if (url.includes("/dashboard/support/messages"))
          bump("support/messages");
        else if (url.includes("/dashboard/admin/approvals"))
          bump("admin/approvals");
      });

      await loginAs(page, role);
      await waitForContent(page);

      // Counted from here: the initial load of each endpoint is legitimate and
      // is not what this measures.
      counts.clear();
      await page.waitForTimeout(WINDOW_MS);

      const report =
        [...counts.entries()].map(([k, v]) => `${k}: ${v}`).join(", ") ||
        "nothing";
      for (const [endpoint, count] of counts) {
        expect(
          count,
          `${endpoint} was requested ${count} times in ${WINDOW_MS / 1000}s (all: ${report}). ` +
            "The shell is polling faster than WO-74 left it — check the *_POLL_MS " +
            "constants in components/layout/dashboard-layout.tsx.",
        ).toBeLessThanOrEqual(MAX_REQUESTS_PER_ENDPOINT);
      }
    });
  }

  test("a backgrounded tab polls at zero", async ({ page }) => {
    test.setTimeout(WINDOW_MS + 90_000);

    await loginAs(page, "MEMBER");
    await waitForContent(page);

    const seen: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/dashboard/")) seen.push(`${request.method()} ${url}`);
    });

    /**
     * Hide the tab by redefining visibilityState and dispatching the event —
     * headless Chromium keeps a backgrounded page "visible". A simulation, honestly.
     */
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Let the re-render settle before counting, so the effect teardown is not
    // itself measured.
    await page.waitForTimeout(1_000);
    seen.length = 0;

    await page.waitForTimeout(WINDOW_MS);

    expect(
      seen,
      `a hidden tab made ${seen.length} background requests in ${WINDOW_MS / 1000}s; ` +
        "it should make none — usePageVisible() suspends every interval, and the " +
        "visibility guard sits *before* the first load in each effect so that " +
        "becoming hidden does not itself fire one.",
    ).toEqual([]);
  });

  test("the support popup runs on the stream, not on a 7-second poll", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    /** The SSE stream is actually used (the mechanism, not just lower counts). */
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/dashboard/support/")) {
        // Tickets are single-use credentials; they do not belong in a report.
        requests.push(
          `${request.method()} ${url.replace(/ticket=[^&]*/, "ticket=***")}`,
        );
      }
    });

    await loginAs(page, "MEMBER");
    await waitForContent(page);

    await page.click('[aria-label="Support inbox"]');

    // A thread has to exist before there is anything to stream. Sending one
    // message creates it, which is also the flow a member actually takes.
    const composer = page.locator("input[placeholder], textarea").last();
    await composer.fill("WO-74 stream check");
    await page.keyboard.press("Enter");

    await expect
      .poll(() => requests.filter((r) => r.includes("/stream?")).length, {
        message:
          "no EventSource was opened. The popup has fallen back to polling — check " +
          "hooks/use-server-events.ts, and whether the ticket endpoint answered.",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // A ticket must be fetched first: EventSource cannot set an Authorization
    // header, so a stream opened without one would be an unauthenticated stream.
    expect(
      requests.some(
        (r) => r.startsWith("POST") && r.includes("/stream/ticket"),
      ),
      "the stream was opened without fetching a ticket first",
    ).toBe(true);
  });
});
