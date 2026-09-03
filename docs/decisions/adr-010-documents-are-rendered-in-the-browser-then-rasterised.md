# ADR-010 — Documents are rendered in the browser, then rasterised

**Status:** superseded by [ADR-012](adr-012-official-documents-are-english-only-and-drawn-as-pdf-text.md) · 2026-08-15.

Documents were built as standalone HTML, rendered by the browser and captured
with html2canvas, because **jsPDF cannot shape complex scripts** — Bengali
conjuncts and matras come out reordered, and `jspdf-autotable` is unusable for
the same reason. ADR-012 removed the constraint by making documents English
only. The shaping problem is real and unchanged: if Bengali documents are ever
required again, the fix is an embedded Unicode font with shaping, **not** a
return to screenshotting the page.

---

[← all decisions](../decisions.md)
