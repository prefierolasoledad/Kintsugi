# Tests

End-to-end suites that drive the real stack: Postgres, the Express API, the
Next.js BFF, and — for half of them — an actual browser.

```bash
npm test                  # everything (~6 minutes)
npm test -- api           # API suites only (~1 minute)
npm test -- browser       # browser suites only
npm test -- reviews       # any suite whose name matches
```

## Prerequisites

These are not unit tests. They need the stack running:

| | |
|---|---|
| Postgres | `docker compose up -d` |
| API | `npm run dev` in `backend/` |
| Frontend | `npm run dev` in `frontend/` |
| Catalog | `npx prisma db seed` |

The runner checks all four before starting and prints one clear sentence if
something is missing, rather than producing forty confusing failures. That
matters — a stopped API once looked like a frontend bug for several minutes.

## Why they live here

They exercise the frontend as much as the backend, so `backend/tests` is a
slight misnomer. They are here because this is where the Prisma client and the
database credentials already are, and a third npm package for tests would cost
more than the naming inaccuracy does.

## Layout

```
lib/
  harness.ts        check(), suite runner, totals, exit codes
  db.ts             Prisma client, service preflight
  api.ts            HTTP client with a cookie jar
  fixtures.ts       accounts and listings, with cleanup that cannot forget
  browser.ts        Playwright helpers
  stripeWebhook.ts  correctly signed webhook delivery
api/                fast, no browser
browser/            Playwright
run.ts              the runner
payment-safety.ts   the original suite (see "known inconsistency")
```

## Cleanup is the part that matters

Every suite gets a `Scope`. It tracks the accounts and listings that suite
touched, restores exactly those, and its "is it clean?" check is scoped by
construction.

This is not tidiness. These suites buy real listings, and a bought listing is
marked `SOLD` and disappears from the shop. A half-finished run **silently
shrinks the catalog**, which happened three times during development — twice to
listings the site owner had created.

Two rules follow, and `Scope` exists to enforce them:

**Cleanup runs on every exit path.** It is in a `finally`, and wired to
`SIGINT`. It is not the last statement of the suite — a suite that throws
halfway is exactly when leftover data does damage, and Ctrl+C during the
60-second sweeper wait is the most likely way anyone will end a run early.

**Verification is scoped, never global.** Asking "are any listings SOLD?" or
"are there any orders?" reports a real user's genuine purchase as test residue.
That bug got written four separate times and sent me chasing a phantom leak
twice. There is deliberately no global variant of `verifyClean` to reach for,
because the global variant *is* the bug.

Test accounts all live under `kt.<suite>.<name>@kintsugi.test`, a reserved
prefix, so the sweep at the start of each run can never match a real account.

## Conventions

**Call `main()` without `await`.** tsx compiles this project as CJS, where
top-level await is a hard transform error. `main()` exits the process itself.

**Assert what rendered, not what exists.** A suite once reported 20/20 green
while every image on the page was broken, because it checked that the `<img>`
element existed rather than that it had loaded. Use `brokenImages()`, which
checks `naturalWidth`.

**Put the actual value in the failure detail.** `check(ok, label, actual)` —
a failure that says only "expected true" costs a debugging round trip.

**Look at the screenshots.** Two real bugs were found this way and by nothing
else: a decline reason printed twice, and a "Verified purchase" badge on 1,792
reviews nobody had paid for. Both had passing text assertions over them.
Screenshots land in `tests/screenshots/` (gitignored).

## Slow suites

Two suites wait on real timers rather than faking them, because the timers are
the thing under test:

- `payment-safety` waits ~60s for the reconciliation sweeper to settle an
  abandoned payment.
- `browser-cart-badge` waits ~30s for a hold to expire on its own, with no
  reload, to prove the badge re-arms from the server's `nextExpiresAt`.

## Known inconsistency

`payment-safety.ts` predates this harness and still carries its own copy of
`check()` and its own teardown. It passes 44/44 and its cleanup is already
scoped correctly, so it was left alone rather than risking a working suite for
consistency. Everything else — 11 suites — is on the shared harness.

## Coverage

328 assertions across 12 suites.

| Suite | Covers |
|---|---|
| `wishlist` | saving is inert; idempotent under concurrency; cross-user isolation |
| `reviews` | verified-purchase gate; one review per person; the badge is earned |
| `checkout-bff` | the proxy path a browser actually takes |
| `identity` | Stripe Identity, signed webhooks, the payout gate |
| `identity-stale` | a stub session left pending across a provider switch |
| `payment-safety` | concurrent double-charge, reconciliation, no card data stored |
| `browser-catalog` | pagination, photo variety, nothing broken at scale |
| `browser-checkout` | the full purchase, and two copy bugs it caught |
| `browser-wishlist` | the heart is real, and honest when signed out |
| `browser-reviews` | writing, editing, deleting; keyboard star picker |
| `browser-identity` | the local capture form must NOT render under a real provider |
| `browser-cart-badge` | the count survives checkout and expires on its own |
