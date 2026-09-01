/**
 * The page numbers a pager shows, with gaps where it skips.
 *
 * Its own module with its own tests because the off-by-one cases are where
 * pagers go wrong and none of them are visible in a screenshot:
 *
 *  - the window must not run past either end
 *  - a gap must never stand in for a single page — `…` is wider than the number
 *    it would hide, and hides a page the reader can see is missing
 *  - the control must keep a **constant width**, so the buttons do not move
 *    under the reader's thumb as they page. On a 412 px screen these are small
 *    targets and a row that reflows between presses is how a mis-tap happens.
 *
 * The last one is why the window slides rather than shrinking at the ends:
 * on page 1 there is nothing to the left to show, so the space goes to the
 * right instead of collapsing.
 */

/** A page to link to, or a gap in the sequence. */
export type PageToken = number | "gap";

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * @param current  the page being shown, 1-based
 * @param total    how many pages there are
 * @param around   how many neighbours to keep either side of `current`
 */
export function pageWindow(
  current: number,
  total: number,
  around = 1,
): PageToken[] {
  if (total <= 1) return [1];

  const page = Math.min(Math.max(1, current), total);
  // first + gap + (around · 2 + 1) + gap + last
  const slots = around * 2 + 5;

  // Everything fits; a gap would hide nothing worth hiding.
  if (total <= slots) return range(1, total);

  // Near the start: no room on the left, so the whole run sits at the front.
  if (page <= around + 3) return [...range(1, slots - 2), "gap", total];

  // Near the end: the mirror of it.
  if (page >= total - (around + 2))
    return [1, "gap", ...range(total - (slots - 3), total)];

  return [1, "gap", ...range(page - around, page + around), "gap", total];
}
