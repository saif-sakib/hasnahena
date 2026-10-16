/**
 * Amount formatting for notification text written by Next routes (WO-58).
 * Must match apps/api/internal/notify and formatCurrency in lib/utils.ts — not
 * the PDFs' lakh grouping. Whole taka, never a decimal point.
 */

/** Grouped whole taka, e.g. "150,000". */
export function formatTaka(amount: bigint | number): string {
  const whole = typeof amount === 'bigint' ? amount : Math.trunc(amount);
  return whole.toLocaleString('en-BD', { maximumFractionDigits: 0 });
}

/** "BDT 150,000" — the unit is always stated. */
export function formatMoney(amount: bigint | number): string {
  return `BDT ${formatTaka(amount)}`;
}
