# Deleting only what the database remembers

- **"Erase this person" written as a list of columns is a promise that decays one
  schema change at a time.** The member erasure cleared the name, the NID, the
  date of birth, the parents, the addresses, the nominee and the documents — and
  left gender, marital status, number of children, preferred language and branch
  standing on the row, plus the entire support conversation, which is the most
  narrative thing the platform holds about anybody. Nothing failed. Nothing could
  fail: a column nobody scrubs looks exactly like a column nobody has. The fix is
  not a longer list, it is a **census** — enumerate the model and require every
  column to be either cleared or on a keep-list with the reason written beside
  it, so the next column added to `users` fails a test instead of quietly
  surviving an erasure.

- **Two meaningful folder names are still worse than one, if nothing joins
  them.** A member's avatar was under `people/ACC-KH-33001` and their four
  identity documents under `applications/APP-2026-000001`. Both names are
  readable; neither says the two are the same person. The join lived in the
  database — which is the thing an erasure destroys — so "delete everything you
  hold about this member" was correct only for as long as the row survived to
  say where to look, and an audit of what is stored about somebody needed a query
  to answer. The fix is not a better name, it is **one** name: approval renames
  the documents into the person's folder, so the erasure is a single prefix.
  Renaming and not re-uploading, because these are NID scans stored with
  `preserveOriginal` and a round trip through the uploader would re-encode them
  silently. And the emptied folder is removed with `deleteEmptyFolder`, which
  refuses a folder that still has contents — reaching for `deleteFolder` there
  would "finish" a half-completed move by deleting the half that did not move.

`documents` records what was *recorded*; the image host holds what was *stored*,
and those are not the same set. An upload that succeeded before its row insert
failed, a retry that wrote a second asset, a file put there by hand — none has a
row, all are still served from a public URL, and an erasure that iterates the
table reaches exactly none of them.

So erasure deletes **by prefix**, not by list: `hasnahena/people/ACC-KH-33001` and
`hasnahena/applications/APP-2026-000001` are the units. That is most of the
argument for one folder per person and one per application in the first place —
the naming is for humans, the *scoping* is for deletion.

Related: `deleteFolder` returns `null` on failure and `0` on "nothing there", and
callers must tell them apart. Collapsing the two makes an unreachable image host
indistinguishable from a clean erasure, which is the difference between a
member's NID scan being gone and it still being online after they were told it
was not.

- **A rename moves the URL. It does not move the folder anybody looks at.** This
  Cloudinary account is in **dynamic folder mode**, where `public_id` — the path
  in the URL — and `asset_folder` — the folder the Media Library draws — are two
  independent properties, and `uploader.rename` changes only the first. So the
  approval that files a member's documents into `people/ACC-KH-33001` produced,
  for every member ever admitted, four assets *served* from the right place and
  still *filed* under `applications/APP-2026-000001`. Nothing failed, and the
  database was right the whole time. Two things followed. The
  `deleteEmptyFolder` at the end of the move silently did nothing every single
  time, because the folder it was asked to remove still contained the assets it
  had just moved out of it — which is why an application folder existed for
  every member the foundation has. And when the application numbers came round
  again after a database restore, four of those folders took a *second* set of
  files under the same four names. A folder showing `nid-front` twice is
  indistinguishable, at a glance, from two versions of somebody's identity card.
  `moveAsset` now sets `asset_folder` and `display_name` after the rename, and
  `scripts/cloudinary-reconcile.mjs` reports and repairs any asset whose two
  halves disagree.

- **The test rig has a disposable database and no disposable image host, and
  nothing said so.** `scripts/test-stack.sh` moves the whole stack onto a
  throwaway Postgres, `assertDisposableDatabase` refuses to seed anything that
  is not localhost, and `TEST_DATABASE_URL` exists precisely because Next
  overwrites `DATABASE_URL` from `apps/web/.env`. All of that protects one of
  the two stores this platform writes to. `e2e/entry-path.spec.ts` submits real
  registration forms through the real route, reading Cloudinary credentials out
  of `apps/web/.env` deliberately so the test can run on a developer's machine —
  and those credentials name **the foundation's own cloud**, the one holding real
  members' NID photographs. Every local run of the browser suite left four
  70-byte 1×1 pixels called `nid-front`, `nid-back`, `member-photo` and
  `signature` in it. Forty-four were still there on 2026-09-02, sixteen of them
  in the folders of admitted members. The database half of a test is easy to
  make disposable and the reflex is to assume the rest of the rig followed:
  `uploadImage` now refuses outright when `TEST_DATABASE_URL` is set without
  `ALLOW_TEST_IMAGE_UPLOADS=yes`, so the guard lives with the upload rather than
  in the discipline of whoever writes the next spec.

---

[← all traps](../traps.md)
