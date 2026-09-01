import { test, expect } from "@playwright/test";

import { hasDatabase, seedAccounts, disconnect } from "./fixtures/accounts";
import { loginAs, waitForContent } from "./fixtures/session";

/**
 * WO-74 — how many requests one open dashboard tab makes in a minute.
 *
 * The number this replaces was measured, not estimated: the shell ran three
 * intervals — notifications at 20 s, support signals at 10 s, and threads plus
 * the open thread's messages at 7 s — which is about 26 requests a minute, per
 * tab, forever, whether or not anything had changed. One full browser-suite run
 * counted 288 requests to `/v1/dashboard/notifications` and 144 to
 * `/v1/dashboard/support/threads`; that measurement was that code.
 *
 * At twenty concurrent members it was ~500 requests/minute against a free
 * Render instance and a free Neon compute, for data that changes a few times an
 * hour.
 *
 * This spec is slow on purpose. There is no way to observe a polling interval
 * except by waiting one, and a threshold measured over ten seconds would pass
 * on a 20-second interval it was meant to catch.
 */

/** The window we count over. Long enough to catch a 60 s interval firing once. */
const WINDOW_MS = 70_000;

/**
 * What one tab may ask for in that window.
 *
 * The polls run at three minutes each since the 2026-08-27 cost pass, so over a
 * seventy-second window each endpoint fires at most once — usually not at all.
 * Six is left as the ceiling rather than tightened to one: this exists to catch
 * a poll that has crept back to seconds, and a bound that fails when somebody
 * legitimately moves an interval from 180 s to 120 s is a bound that gets
 * deleted. The gap that matters is against the ~30 the original intervals
 * produced over the same window.
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

  /**
   * Both roles, because they poll different sets.
   *
   * This measured a MEMBER only, and a member's shell does not subscribe to the
   * approvals queue at all — so the sidebar's pending-approvals badge, which is
   * staff-only, was a fourth poll that no budget could see. A guard that cannot
   * observe the thing most likely to grow is not guarding it.
   */
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
     * Hiding the tab, by hand.
     *
     * The obvious version — open a second page and `bringToFront()` — does not
     * work, and finding that out is worth recording: in headless Chromium the
     * first page's `document.visibilityState` stays `'visible'`, so the spec
     * measured a *foreground* tab and reported its ordinary 60-second polls as
     * a failure of the thing it was meant to prove.
     *
     * Redefining the property and dispatching the event drives exactly what the
     * browser drives, and exactly what `usePageVisible` subscribes to. It is a
     * simulation of a hidden tab rather than a real one, and that is the honest
     * limit of this assertion.
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

    /**
     * The half of WO-74 that a request count cannot show.
     *
     * `GET /v1/dashboard/support/stream` and its ticket endpoint had existed
     * for some time and had never been called: `EventSource` appeared nowhere
     * in `apps/web`, and the popup refetched threads *and* the open thread's
     * messages every 7 seconds instead. Lowering the interval would have looked
     * like the same improvement in the counts above while leaving the stream
     * unused, so this asserts the mechanism rather than the symptom.
     */
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
