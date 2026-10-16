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
 * The lightbox covers the viewport on EVERY page with a gallery — a parent
 * stacking context once trapped it under the header on the home page.
 */

const PHONE = devices["Pixel 7"].viewport!; // 412 px — the width this site is read at

const CAPTION_EN = "Lightbox regression fixture";
const CAPTION_BN = "লাইটবক্স পরীক্ষার ছবি";

/** Seeded via the API so revalidateTag runs (a direct write is cached for an hour). */
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

        // 2. Nothing paints above it (a hit test at the top lands in the overlay).
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
