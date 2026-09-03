# ADR-028 — A public page renders without a database

**Status:** accepted

**Context.** [WO-73](../changelog.md) moved the marketing pages' `system_config`
and `galleryItem` reads from request time to **build** time by prerendering them.
The Docker image is built with `DATABASE_URL` pointing at a placeholder that does
not exist — the Dockerfile says so, and says why — so the next image build failed
with `Export encountered an error on /[locale]/donate/page`.

Six of the eight pages had no `try` of their own; the two that did survived,
which made it look like a bug in two pages rather than a missing contract on one
function.

**Decision.** `getPublicSettings()` and `getPublicGalleryItems()` never reject.
An unreachable database yields an empty map and an empty gallery, and the page
renders its fallback copy. Each page carries `revalidate = 3600`, so a build
without data self-heals within an hour of the first request.

The `catch` sits **outside** `unstable_cache`, not inside it. `unstable_cache`
stores resolved values and never rejections, so catching inside would memoise the
empty map and pin every public page to its hardcoded fallback for the whole
revalidate window after one transient Neon blip.

**Consequences.** `test/unit/public-content-fallback.test.ts` asserts both
halves, and asserts them against a mocked `next/cache` — the real
`unstable_cache` throws `Invariant: incrementalCache missing` outside a Next
server, and the very `catch` under test swallows it, so the first version of that
file passed with the query never running.

---

[← all decisions](../decisions.md)
