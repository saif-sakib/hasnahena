# ADR-012 — Official documents are English only, and drawn as PDF text

**Status:** accepted · 2026-08-15 · supersedes [ADR-010](adr-010-documents-are-rendered-in-the-browser-then-rasterised.md).

Statements, receipts, loan agreements and certificates were generated in both
Bengali and English. Official and financial paperwork is now English only: it is
the language the records are audited, filed and presented in, and one version
means one thing to review when the layout changes. The UI stays bilingual —
this applies to generated documents, not to the app.

That removes the constraint ADR-010 was built around. Bengali conjuncts and
matras cannot be shaped by jsPDF's standard fonts, which is why documents used
to be rendered as HTML and captured with html2canvas. With no Bengali to shape,
the PDF is drawn with real text primitives instead, which fixes what
rasterisation cost us:

- **Text is selectable, searchable and copyable.** A raster PDF is a picture.
- **Output is vector-sharp** at any zoom, instead of fixed-resolution JPEG.
- **Pagination is explicit** — a block that will not fit before the content
  bottom starts a new page, and the footer is painted per page once the page
  count is known. Slicing a tall bitmap could and did cut the last line in half.
- **Files are ~6× smaller** (a 3-page statement is ~33 kB, not ~200 kB).

`html2canvas` and `jspdf-autotable` were dropped as dependencies.

One document model now feeds two renderers — `render/html.ts` for preview and
print, `render/pdf.ts` for download — so the two outputs cannot drift apart.
Amounts print as `BDT 1,25,000`: the `৳` sign lives in the Bengali Unicode block
and cannot be encoded by the PDF's standard fonts. Values that arrive in Bengali
anyway (letterhead from `system_config`, member-typed notes) are stripped before
drawing, so an unrenderable string shows as a dash rather than mojibake.

If Bengali documents are ever required again, the fix is an embedded Unicode
font with shaping — not a return to screenshotting the page.

---

[← all decisions](../decisions.md)
