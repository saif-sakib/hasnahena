# Next, React and the build

- **A streamed response's failure cannot be caught by the route that returned
  it.** Next pipes the body to the client *after* the handler has finished, in
  `pipeToNodeResponse`, and anything the body throws there that is not an
  `AbortError` becomes `failed to pipe response` (`E180`) — unhandled, reported
  by `onRequestError`, filed against the route. The support proxy hands the Go
  API's SSE body straight to `NextResponse`, and an event stream ends for
  ordinary reasons all day: the tab closes, a phone loses signal, a proxy times
  the connection out, the API is redeployed. Every one of those arrived as
  `TypeError: terminated` or `ECONNRESET` on the upstream body and was reported
  as a fault, for a connection the browser was already reconnecting. The route's
  own `try/catch` looks like it covers this and covers only the `fetch`. The fix
  is in the stream: `lib/sse-stream.ts` reads the upstream itself and **closes**
  on a read failure, which downstream is indistinguishable from an upstream that
  finished — the one ending Next pipes without throwing. Two corollaries. A
  stream that transmits nothing looks dead to every middlebox on the path, so
  the Go handler now writes a `: ping` comment every 20 seconds, under the
  shortest idle timeout it can be behind; and cancellation has to be *forwarded*
  to the upstream reader, or wrapping the body reintroduces the leak that
  `signal: req.signal` was added to close.

- **A Server Action's request body is capped at 1 MB, and exceeding it is
  silent.** Next enforces `experimental.serverActions.bodySizeLimit` *before* the
  action runs, so nothing in the action executes and nothing logs. Content &
  Media's brand uploader validated a file up to 5 MB and posted it uncompressed:
  every logo off a phone or out of a design tool was refused by the framework,
  and the admin saw a Server Action failure naming no size, no field and no
  remedy — an uploader that simply did not work. The gallery (10 MB) and avatar
  (5 MB) uploaders had the same ceiling. **The general form: a size limit
  enforced by infrastructure produces no message a user can act on, so the
  application's own validator must be the stricter of the two.** Compress in the
  browser first and validate the *compressed* file; then the limit describes what
  gets stored, and a rejection only happens for a file nothing could rescue.
  `test/unit/image-uploads.test.ts` compares `bodySizeLimit` against every entry
  in `UPLOAD_SIZE_LIMITS` so the two cannot drift apart again. Note the platform
  in front of the app has its own cap (4.5 MB on Vercel) which is lower than the
  10 MB one validator used to claim.

- **A reader census that greps for a key name is satisfied by the writer.**
  `branding.favicon` and `branding.dashboardLogo` each had an admin control and
  **no reader anywhere**, and passed `settings-keys-read.test.ts` because the
  uploader that writes them names them as string literals. So an admin uploaded
  a favicon and a dashboard logo, saw both stored, and watched the browser tab
  and the sidebar keep the shipped assets for ever — the exact failure
  `UNIMPLEMENTED_CONFIG_KEYS` exists to make honest. A census over "is this
  string present" cannot tell a read from a write; where that distinction is the
  whole point, assert the *reader* by name and by file.

- **Awaiting in a layout changes when everything below it mounts.** Reading
  `getPublicSettings()` in the dashboard's server layout — to hand a logo down —
  put a database round trip on every dashboard navigation *and* tripped a race in
  the client shell's mount-time effects, so every navigation logged the reader
  out. Neither cost was visible in the diff. A value that only decorates belongs
  on a path that cannot delay or break the page: this one is a client fetch of a
  key that is in `PUBLIC_CONFIG_KEYS`, so it needs no token and its worst failure
  is a missing logo.

- **A single click can fire a handler and then submit the form, when a
  conditional swaps a button's `type` in place.** `{!isLastStep ? <Button
  type="button" onClick={next}/> : <Button type="submit"/>}` is one `<button>` in
  one slot as far as reconciliation is concerned, so React mutates `type` on the
  node the member just clicked. `next` is `async`, and the continuation after
  `await trigger(...)` runs as a **microtask — before the browser performs the
  click's default action**. So the state update lands, the node becomes
  `type="submit"`, and the browser then submits. One ordinary click, no double
  tap. Give the branches distinct `key`s — a new node has no pending default
  action.
- **React Hook Form's `shouldFocusError` defaults to true and will fight your own
  scrolling.** It focuses the first errored field, which scrolls it into view —
  and on a long step that can be the *last* control on the page. On the
  registration form a blocked submit sent the member to the bottom with the four
  document slots off-screen above them. A form that reveals its own errors has to
  turn it off.
- **`next-env.d.ts` churns on every run and must not be tracked.** `next dev`
  writes `import "./.next/dev/types/routes.d.ts"`; `next build` writes
  `import "./.next/types/routes.d.ts"`. A tracked copy therefore shows as
  modified after whichever command you ran last, forever. Next's own docs say to
  gitignore it. It stays in the tsconfig `include` array — tsc tolerates a listed
  file that does not exist.
- **`outputFileTracingIncludes` must stay top-level.** Next 15 promoted it out of
  `experimental` and only *warns* if you leave it behind — which silently ships
  an image with no Prisma engine that dies on the first query.
- **The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry
  `plugins:` across.** `tailwindcss-animate` stopped loading and Tailwind
  compiles unknown utilities away without complaint — 81 classes across 17 files,
  every Radix animation, would have become dead strings. Restored with `@plugin`
  in `globals.css`.
- **Next 16 removed `next lint`** and does not fail usefully: it reads `lint` as a
  directory name and reports "no such directory .../lint".
- **`output: 'standalone'` is gated behind `DOCKER_BUILD=1`** so a Docker concern
  cannot change what `pnpm build` emits for Vercel.
- **The React Compiler config is top-level `reactCompiler` in Next 16.** The old
  `experimental.reactCompiler` key is silently ignored.
- **`unstable_cache` serialises what it stores, so a `Date` comes back a
  string.** Typed as `Date` it compiles, and it works — on the cache *miss*.
  The *hit* returns the JSON round-trip, and the build died on
  `item.date.toISOString is not a function` at the second render of the
  homepage. Normalise at the accessor boundary so there is one type, and be
  aware that every wrong-on-the-second-render bug has this shape: local checks
  pass, the first deploy looks fine.
- **`generateStaticParams` on a locale segment applies to the entire subtree.**
  Adding it so the marketing pages could be prerendered swept in every dashboard
  route as well — the build emitted `● /en/dashboard/member`. Nothing leaked,
  because those pages fetch with the reader's own token, but that is a property
  of how they are written rather than a rule. `export const dynamic =
  'force-dynamic'` on the dashboard layout states it, and
  `scripts/assert-static-routes.mjs` fails the build on a route that becomes
  static in either direction.
- **An unwrapped `useSearchParams` fails the *build* the moment its route can be
  prerendered.** It is legal while everything is dynamic and becomes a hard
  error the day something upstream makes the route static — which is how
  `/reset-password` broke a build it had nothing to do with. A `<Suspense>`
  boundary is the fix and the better page anyway.
- **`revalidateTag(tag)` with one argument is deprecated in Next 16**, and the
  replacement is not one call but two: `updateTag(tag)` in a Server Action,
  which expires immediately and is what read-your-own-writes needs, and
  `revalidateTag(tag, profile)` everywhere else — where `'max'` is
  stale-while-revalidate and will show an admin the value they just replaced.
  `{ expire: 0 }` is the immediate form for a route handler. `updateTag` throws
  outright if called from one.

---

[← all traps](../traps.md)
