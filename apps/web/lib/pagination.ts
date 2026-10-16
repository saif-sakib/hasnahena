/**
 * The page numbers a pager shows, with gaps. Never past either end, never a gap
 * for a single page, and a CONSTANT width so buttons do not move under a thumb
 * (the window slides rather than shrinks at the ends).
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
