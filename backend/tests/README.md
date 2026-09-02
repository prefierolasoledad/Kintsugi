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
| Postgres | `docker compose up -d postgres redis` |
| Redis | same command — see below |
| API | `npm run dev` in `backend/` |
| Frontend | `npm run dev` in `frontend/` |
| Catalog | `npx prisma db seed` |

**Redis is optional but half of two suites depend on it.** Without `REDIS_URL`
the limiter falls back to per-process counters and the cache is disabled
entirely, so `ratelimit` and `cache` skip the sections that matter — the TTL,
the atomic increment, the failure policies, stale-while-revalidate. Set it for
BOTH the server and the test process, or the thing under test is not the thing
being asserted on:

```bash
REDIS_URL=redis://localhost:6379 npm run dev     # and again for npm test
```

The runner checks the rest before starting and prints one clear sentence if
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
  totp.ts           single-use authenticator codes
api/                fast, no browser
browser/            Playwright
run.ts              the runner
payment-safety.ts   concurrency and reconciliation; slow on purpose
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

## Slow environment looks exactly like test failure

The Next **dev** server is expensive here: measured at **1.1 GB and ~1.6s to
serve a warm `/search`** on a freshly started process, with a 900-listing
catalog. That is the floor, not degradation — it does get worse under sustained
load, but it starts slow.

That matters because a browser suite does twenty-odd navigations. One full run
took **1162s instead of 447s** and reported four failures; every one of them
passed when its suite was re-run alone, minutes later, against identical code.
The failures were `waitFor` timeouts and a hydration warning — both symptoms of
a struggling server, neither a code bug.

So: **if a browser suite fails, re-run it alone before believing it.** If it
passes alone, the environment failed, not the code.

The runner measures `/search` before starting and warns when the median exceeds
1500ms. It warns rather than refusing, because slow is not broken.

A production build (`cd frontend && npm run build && npm start`) is far faster
and worth using for a full run — with one caveat worth knowing: it sets
`NODE_ENV=production`, which turns off `dangerouslyAllowLocalIP` in
`next.config.ts`. Seller-uploaded photos served from `localhost:4000/uploads`
stop being optimised. Seeded listings use Unsplash and are unaffected, so most
suites do not notice, but a suite asserting on an uploaded image would.

## Slow suites

Two suites wait on real timers rather than faking them, because the timers are
the thing under test:

- `payment-safety` waits ~60s for the reconciliation sweeper to settle an
  abandoned payment.
- `browser-cart-badge` waits ~30s for a hold to expire on its own, with no
  reload, to prove the badge re-arms from the server's `nextExpiresAt`.

## Every suite is on the shared harness

`payment-safety.ts` was the last holdout — its own `check()`, its own Prisma
client, its own HTTP client, its own teardown. It was left alone twice on the
grounds that it worked, and it broke twice in the interval, both times in the
duplicated plumbing rather than in anything it was testing. It is now on
`Scope` and `Suite` like everything else.

It still talks to the Express API directly rather than through the BFF, via
`Scope.apiBuyer()`. That is deliberate: most of its cases fire several requests
at once to prove the claim serialises them, and a proxy hop in front of each one
spreads them out in time — which makes the race less likely to happen at all. A
test that can only pass is not measuring anything.

## Shared state outlives what a suite creates

Five suites have now failed **only inside a full run**, passing when run alone.
Every one had the same shape, and it is worth recognising early because a full
run is all CI ever does.

**Writes that land after the call returns.** `notify()` is fire-and-forget so a
notification failure can never fail the sale that raised it — which means the
row commits shortly *after* the function returns. Reading the inbox on the next
line is a race that usually passes. Use `awaitNotifications()` or
`awaitNotificationsForUser()` from `lib/fixtures.ts`.

**Rate-limit counters keyed on something stable.** Limits now live in Redis
rather than in the server process, which makes this worse rather than better:
they survive a server restart as well as a run. Several are keyed by email
rather than user id — deliberately, since deleting an account must not reset an
attacker's allowance — and Scope addresses are deterministic
(`kt.<tag>.<name>@kintsugi.test`), so a suite that exhausts a budget poisons
that address for the length of the window.

`Scope.cleanup()` now clears `login:{email}` for every address the scope
created, because otherwise a suite that tests login throttling cannot run twice
inside fifteen minutes — the *second* run fails during setup, with a 429 while
creating a fixture, which looks nothing like the thing being tested. That is
exactly how `api/ratelimit.ts` broke itself.

Nothing else is cleared. `forgot:{email}` in particular is not, so where a
suite needs several hits on another rate-limited endpoint, still give it a
per-run address: ``scope.buyer(`forgot-${Date.now()}`)``.

Both failure modes report as something else entirely — a wording bug, a missing
row, a token that was not stored — so the cause is rarely where the failure
points.

## Authenticator codes are single-use

Any suite that signs in to the admin panel has to cope with this: finishing
enrolment spends a code, and inside the same 30-second period an authenticator
app shows the *same* six digits. Use `freshCode()` from `lib/totp.ts` for the
second entry — `currentCode()` twice in a row fails with "That didn't work" on a
code that is provably correct, which is a miserable hour to debug.

## Coverage

823 assertions across 23 suites.

| Suite | Covers |
|---|---|
| `wishlist` | saving is inert; idempotent under concurrency; cross-user isolation |
| `reviews` | verified-purchase gate; one review per person; the badge is earned |
| `checkout-bff` | the proxy path a browser actually takes |
| `addresses-sales` | address book, one default enforced, the seller's own sales view |
| `notifications` | every event reaches the right person; unread count; read-all |
| `refunds` | automatic and moderator-issued; over-refund guard; async webhook, forged and replayed |
| `passwords` | change and reset; no enumeration; sessions revoked; TOTP survives |
| `refresh` | rotation, the concurrency race, and the four ways a replay is still theft |
| `ratelimit` | shared counters, atomic increment, both failure policies, login throttling |
| `cache` | hit/miss, TTL, stale-while-revalidate, negative caching, invalidation over HTTP |
| `identity` | Stripe Identity, signed webhooks, the payout gate |
| `identity-stale` | a stub session left pending across a provider switch |
| `admin` | CLI grant, TOTP step-up, single-use codes, dashboard reads, audit trail |
| `payment-safety` | concurrent double-charge, reconciliation, no card data stored |
| `browser-catalog` | pagination, photo variety, nothing broken at scale |
| `browser-checkout` | the full purchase, and two copy bugs it caught |
| `browser-fulfilment` | shipping, tracking, delivery confirmation, cannot-send |
| `browser-admin` | the panel end to end: moderation actions and what they notify |
| `browser-dashboard` | the numbers match the database; orders, customers, catalogue |
| `browser-wishlist` | the heart is real, and honest when signed out |
| `browser-reviews` | writing, editing, deleting; keyboard star picker |
| `browser-identity` | the local capture form must NOT render under a real provider |
| `browser-cart-badge` | the count survives checkout and expires on its own |
