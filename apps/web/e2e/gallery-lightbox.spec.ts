import {
  test,
  expect,
  devices,
  type APIRequestContext,
} from "@playwright/test";
import {
  seedAccounts,
  disconnect,
  ACCOUNTS,
  E2E_PASSWORD,
} from "./fixtures/accounts";

/**
 * The gallery lightbox must cover the viewport on every page that renders a
 * gallery — which means it must not depend on what a page wraps the grid in.
 *
 * It did. `fixed inset-0 z-50` spans the viewport only while no ancestor opens
 * a stacking context, and on `/gallery` none does, so the lightbox was correct
 * there and correct in every test that looked at it. The home page puts the
 * same component inside `<section class="relative overflow-hidden">` >
 * `<div class="relative z-10">`; that `z-10` is a stacking context, so `z-50`
 * became 50-within-10 and the `fixed z-50` header painted straight over the
 * top of the overlay, with the section's `overflow-hidden` clipping the rest.
 *
 * So this asserts the thing that was actually wrong — the overlay covers the
 * whole viewport and nothing paints above it — and asserts it on **both**
 * pages, because checking only the page that worked is what missed it.
 */

const PHONE = devices["Pixel 7"].viewport!; // 412 px — the width this site is read at

const CAPTION_EN = "Lightbox regression fixture";
const CAPTION_BN = "লাইটবক্স পরীক্ষার ছবি";

/**
 * Seeded through the API rather than straight into the table, because
 * `getPublicGalleryItems` is an `unstable_cache` keyed on GALLERY_TAG and the
 * route handler is what calls `revalidateTag`. A row written behind it is a row
 * the page will not show for an hour.
 */
async function adminToken(request: APIRequestContext): Promise<string> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8099";
  const response = await request.post(
    `${api.replace(/\/$/, "")}/v1/auth/login`,
    {
      data: { identifier: ACCOUNTS.ADMIN.phone, password: E2E_PASSWORD },
    },
  );
  expect(response.ok(), `admin login failed: ${response.status()}`).toBe(true);
  return (await response.json()).data.accessToken as string;
}

test.describe("the gallery lightbox escapes its page", () => {
  test.beforeAll(async ({ request }) => {
    await seedAccounts();
    const token = await adminToken(request);
    const response = await request.post("/api/v1/gallery", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        captionEn: CAPTION_EN,
        captionBn: CAPTION_BN,
        date: new Date().toISOString(),
      },
    });
    expect(
      response.ok(),
      `seeding a gallery item failed: ${response.status()} ${await response.text()}`,
    ).toBe(true);
  });

  test.afterAll(async () => {
    await disconnect();
  });

  for (const [pageName, path] of [
    ["home", "/"],
    ["gallery", "/gallery"],
  ] as const) {
    for (const locale of ["en", "bn"] as const) {
      test(`${pageName} page, ${locale}, at ${PHONE.width}px`, async ({
        page,
      }) => {
        await page.setViewportSize(PHONE);
        await page.goto(
          locale === "en" ? path : `/bn${path === "/" ? "" : path}`,
        );

        const opener = page.getByRole("button", {
          name: /Lightbox regression fixture|লাইটবক্স/,
        });
        await opener.first().scrollIntoViewIfNeeded();
        await opener.first().click();

        const overlay = page.getByRole("dialog");
        await expect(overlay).toBeVisible();

        // 1. It spans the viewport rather than the section it was declared in.
        const box = await overlay.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(PHONE.width - 1);
        expect(box!.height).toBeGreaterThanOrEqual(PHONE.height - 1);

        // 2. Nothing paints above it. The header is the element that did: a hit
        //    test at the top of the screen must land inside the overlay, not on
        //    a nav link sitting over it.
        const topCentre = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest('[role="dialog"]')
              ? "overlay"
              : (el?.tagName ?? "nothing");
          },
          [PHONE.width / 2, 24],
        );
        expect(topCentre, "something is painting over the lightbox").toBe(
          "overlay",
        );

        // 3. The caption is on screen, not pushed past the bottom edge.
        const caption = overlay.getByText(
          /Lightbox regression fixture|লাইটবক্স/,
        );
        await expect(caption.first()).toBeInViewport();

        // 4. Escape closes it, and the page is scrollable again afterwards.
        await page.keyboard.press("Escape");
        await expect(overlay).toBeHidden();
        expect(
          await page.evaluate(() => document.body.style.overflow),
        ).not.toBe("hidden");
      });
    }
  }
});
