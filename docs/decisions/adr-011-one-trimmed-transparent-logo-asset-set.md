# ADR-011 — One trimmed, transparent logo asset set

**Status:** accepted · 2026-08-14.

The delivered logo was a 1366×768 video frame on an opaque black background, which renders as a black box on the site header and in white documents. Shipping it directly was not viable, so the source is keyed (alpha from the max channel, unpremultiplied to keep edges clean), trimmed to content, and published as three derived assets in `apps/web/public/images/logo/`:

`logo.png` (transparent lockup — UI and documents) · `logo-mark.png` (square leaf mark — favicon, avatars, tight spaces) · `logo-og.png` (1200×630 on white — social cards, because transparent PNGs render black in most social clients). `logo-print.png` was added by [ADR-012](adr-012-official-documents-are-english-only-and-drawn-as-pdf-text.md) for PDF mastheads.

Masters live in `apps/web/assets/brand/`, **not** `public/`: `logo-source.png` (untouched original), `logo.mp4` (animated version, unused), `dashboard-logo.png` (superseded by the `branding.dashboardLogo` setting). Anything under `public/` is served to the internet and shipped in every deploy, and these three were 2.3 MB of files nothing links to. `assets/` is not a Next.js convention directory — it is never bundled or served.

Regenerate derived assets from `assets/brand/logo-source.png` rather than editing them by hand.

---

[← all decisions](../decisions.md)
