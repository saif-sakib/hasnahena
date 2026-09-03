# Browser suites

- **A spec that passes alone and fails in the suite is shared state or a limit,
  not luck.** The e2e run tripped the API's 60-requests-per-minute limiter partway
  through, so the *later* specs rendered empty pages. It read as flaky ordering;
  `grep -c 429 .test-stack/api.log` said 91. A retry would have buried it
  permanently. `test-stack.sh` raises the limit now.
- **A Playwright run starved of CPU produces timeouts that read exactly like
  defects.** Four attempts at a one-pass run were killed by unrelated load. Before
  acting on a browser failure, check `uptime` and re-run the single spec alone.
- **Reading `innerText` once races every page that fills in its figures.** Use the
  retrying matchers (`await expect(locator).toContainText(x)`). Reading once made
  four working specs fail.
- **`nextjs-portal` is in the DOM and in the tab order, and is not the
  application.** `next dev` injects a dev-tools overlay absent from a production
  build. It has cost two sessions: once by matching a `"Next"` button locator,
  once by absorbing Tab presses and reporting no focus ring. Exclude it in any DOM
  sweep — and Next's route announcer is an always-empty `role="alert"`, so filter
  on `hasText: /\S/` when counting alerts.
- **Radix `Select` renders a hidden native `<select aria-hidden tabindex="-1">`**
  for plain-form submission. An accessibility sweep must respect `aria-hidden`, or
  it reports a false positive on every page with a filter.
- **`bringToFront()` does not background the other tab.** In headless Chromium
  the first page's `document.visibilityState` stays `'visible'`, so a spec
  written to prove that a hidden tab stops polling was measuring a *foreground*
  tab and reporting its ordinary polls as the failure. Redefine `document.hidden`
  and `visibilityState` and dispatch `visibilitychange` — that drives exactly
  what the browser drives and what a visibility hook subscribes to. Say in the
  test that it is a simulation.
- **`networkidle` never arrives on a page that polls.** It is the obvious wait
  and it times out at 30 s, which reads as a broken page rather than a busy one.
  `e2e/fixtures/session.ts` already carries a `waitForContent` that budgets it
  and moves on; use that.
- **Chromium reports `'upgrade-insecure-requests' is ignored when delivered in a
  report-only policy` to the console on every page load.** A spec that collects
  CSP violations by reading the console counts it as one, on every page. The fix
  is to omit the directive when the policy is report-only rather than to filter
  the message — a matcher with a special case is a matcher that will hide a real
  violation later.
- **Generous per-page waits multiply.** A helper that waits up to 25 s per page is
  fine once and fatal in a loop: a spec walking ten admin pages blew the 30 s test
  timeout and reported as a broken page rather than a slow one. Keep the helper's
  waits short, let the retrying assertions wait, and raise `test.setTimeout()` on
  sweeps. `next dev` compiles each route on first visit, so the first pass is slow
  in a way a production build never is.

---

[← all traps](../traps.md)
