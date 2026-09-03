# ADR-022 — Member approval waits for the email, inside a ten-second budget

**Status:** accepted · 2026-08-18 · closes WO-62.

`sendWithRetry` made three attempts against a 12-second client with a 1.5-second
sleep between them: **39 seconds**, synchronous, inside the handler that approves
a member. `SERVER_SHUTDOWN_TIMEOUT` is 30. A deploy landing during a slow Brevo
call was a `SIGKILL` mid-request — the failure RUN-02 exists to prevent,
reintroduced through a dependency's latency.

The order asked whether approval should block on delivery at all, given that the
handler reports `emailDelivered` and `deliveryError` separately and returns the
temporary password in the response.

**It should block.** Those two fields are the argument *for* waiting, not
against it: they exist so the admin knows, while the member is still in front of
them, whether to read the password out instead. Send it after the response and
that signal becomes either absent or a guess, and the admin learns nothing.
Ten seconds is a tolerable spinner for the one action in the system that hands
someone their credentials.

What made the old code dangerous was that it had no bound, not that it blocked.
So: a 10-second budget for the whole sequence, 4 seconds per attempt so one hung
connection cannot spend all of it, and an interruptible backoff.

**The caller's context is taken for its values and not for its cancellation**,
which is deliberate and is the part most likely to be "tidied up" later:

- **A client disconnect must not cancel it.** The approval has already
  committed, and the response carrying the password is exactly what was lost —
  so the email is now the only way the member will ever receive it.
- **A shutdown need not cancel it.** In-flight requests are allowed to finish;
  that is what the drain is for, and ten seconds fits inside thirty with room.

`TestTheCallersCancellationDoesNotCancelTheSend` and
`TestTheWorstCaseFitsInsideTheShutdownDrain` hold both halves, the second
against the real constants so the budget and the drain cannot drift apart.

**Unchanged, and load-bearing:** `ApproveRegistration` has already committed
before the send. A member's approval is never rolled back because an email
failed.

---

[← all decisions](../decisions.md)
