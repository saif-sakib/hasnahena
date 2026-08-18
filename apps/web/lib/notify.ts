/**
 * Amount formatting for notification text written by the Next routes.
 *
 * WO-58 / LEDGER-07, the TypeScript half. Three notification builders rendered
 * amounts with a bare `toLocaleString()`, which uses the *server's* default
 * locale — `en-US` on Vercel. So ৳1,50,000 could print grouped one way in a
 * notification and another way on the dashboard reading the same figure.
 *
 * The Go half lives in `apps/api/internal/notify`. These two must agree, and
 * both deliberately match `formatCurrency` in `lib/utils.ts` — the grouping the
 * dashboard uses — rather than the lakh-crore grouping in
 * `lib/documents/format.ts`, which is for generated PDFs. A member seeing
 * "12,34,567" in one place and "1,234,567" in the other would reasonably ask
 * which is real.
 *
 * Money is whole taka (rule 1), so nothing here ever emits a decimal point.
 */

/** "1,50,000" → no: "150,000". Grouped whole taka, matching the dashboard. */
export function formatTaka(amount: bigint | number): string {
  const whole = typeof amount === 'bigint' ? amount : Math.trunc(amount);
  return whole.toLocaleString('en-BD', { maximumFractionDigits: 0 });
}

/** "BDT 150,000" — the unit is always stated. */
export function formatMoney(amount: bigint | number): string {
  return `BDT ${formatTaka(amount)}`;
}
