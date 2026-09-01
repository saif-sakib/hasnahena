import { describe, it, expect } from "vitest";
import { pageWindow, type PageToken } from "@/lib/pagination";

const render = (tokens: PageToken[]) =>
  tokens.map((t) => (t === "gap" ? "…" : String(t))).join(" ");

describe("the page numbers a pager shows", () => {
  it("lists every page while they all fit", () => {
    expect(render(pageWindow(1, 1))).toBe("1");
    expect(render(pageWindow(2, 3))).toBe("1 2 3");
    expect(render(pageWindow(3, 5))).toBe("1 2 3 4 5");
  });

  it("keeps the first and last page reachable from the middle", () => {
    // The point of the whole control: a jump to either end is one press from
    // anywhere, which is what Prev/Next could not do.
    const tokens = pageWindow(10, 20);
    expect(tokens[0]).toBe(1);
    expect(tokens[tokens.length - 1]).toBe(20);
    expect(render(tokens)).toBe("1 … 9 10 11 … 20");
  });

  it("spends the space on the side that has pages, at either end", () => {
    // On page 1 there is nothing to the left, so the window must not simply be
    // narrower — that is the version whose buttons move as you page.
    expect(render(pageWindow(1, 20))).toBe("1 2 3 4 5 … 20");
    expect(render(pageWindow(20, 20))).toBe("1 … 16 17 18 19 20");
  });

  it("never prints a gap standing in for a single page", () => {
    // '…' is wider than the number it would hide, and hides a page the reader
    // can see they are missing.
    for (let total = 1; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        const tokens = pageWindow(page, total);
        const numbers = tokens.filter((t): t is number => t !== "gap");
        tokens.forEach((token, i) => {
          if (token !== "gap") return;
          const before = tokens[i - 1] as number;
          const after = tokens[i + 1] as number;
          expect(
            after - before,
            `page ${page} of ${total}: a gap hides only page ${before + 1}`,
          ).toBeGreaterThan(2);
        });
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        expect(new Set(numbers).size).toBe(numbers.length);
      }
    }
  });

  it("keeps a steady width, so the buttons do not move as you page", () => {
    // A row that reflows under the thumb is how a mis-tap happens on a phone.
    const widths = new Set<number>();
    for (let page = 1; page <= 20; page++)
      widths.add(pageWindow(page, 20).length);
    expect([...widths]).toEqual([7]);
  });

  it("survives a page number outside the range", () => {
    // The reader can arrive on page 9 and then filter down to three pages.
    expect(render(pageWindow(9, 3))).toBe("1 2 3");
    expect(render(pageWindow(0, 3))).toBe("1 2 3");
  });
});
