# Kintsugi

[![CI](https://github.com/prefierolasoledad/Kintsugi/actions/workflows/ci.yml/badge.svg)](https://github.com/prefierolasoledad/Kintsugi/actions/workflows/ci.yml)

金継ぎ — the Japanese art of repairing broken pottery with gold, treating the
break as part of the object's history instead of something to hide.

A marketplace for secondhand furniture, clothing, and objects, where condition
is disclosed rather than hidden. Built as a full-stack TypeScript application:
a Next.js storefront, an Express API, and PostgreSQL.

> **Status: in development, and working end to end.** Browsing, accounts,
> selling, checkout, payments, refunds, order fulfilment, identity
> verification, email, and an admin dashboard all work — covered by **823
> assertions across 23 suites** (`npm test`), run against the real stack rather
> than mocks. Payments and identity run against Stripe's test mode: no real
> money moves, no real document is checked. Payouts to sellers are the one
> significant feature not built. See [What's built](#whats-built).

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| Backend | Node.js 24, Express 4, TypeScript, Zod |
| Database | PostgreSQL 16, Prisma 7 (driver adapters — no query engine binary) |
| Cache & counters | Redis 7 — rate limits and read-through caching |
| Auth | JWT access tokens + rotating opaque refresh tokens with reuse detection, bcrypt |
| Admin | CLI-granted role, TOTP step-up (`otplib`), separate short-lived session |
| Payments | Stripe PaymentIntents + Refunds, behind a provider seam with a stub |
| Identity | Stripe Identity, behind the same kind of seam |
| Email | Nodemailer — console, Ethereal, or real SMTP |
| Images | Sharp (re-encode + metadata stripping), local disk or object storage |
| Delivery | Multi-stage Docker builds, Compose, GitHub Actions CI |

## Quick start

**Prerequisites:** Node.js 20+ (developed on 24), Docker, npm.

### Everything in containers

```bash
git clone https://github.com/prefierolasoledad/Kintsugi.git && cd Kintsugi
docker compose up --build            # postgres, redis, migrations, api, web
docker compose run --rm seed         # 7 categories, 27 listings, reviews
```

The storefront is on http://localhost:3000 and the API on http://localhost:4000.
Migrations run as a one-shot job that the API waits for, rather than on API
startup — the shortcut that breaks the moment there is more than one replica.

> **Known limitation:** seller-uploaded photos do not render in this mode. The
> browser loads them from `localhost:4000`, which is reachable from the host but
> not from inside the web container. Seeded photos come from Unsplash and are
> unaffected. The fix is object storage behind the seam in `lib/storage.ts`.

### Running the servers locally

Better for development — hot reload, and the test suite expects this.

```bash
docker compose up -d postgres redis   # just the datastores
```

```bash
cd backend
npm install
cp .env.example .env                  # then set JWT_SECRET
npx prisma migrate dev
npx prisma db seed
npm run dev                           # http://localhost:4000
```

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                           # http://localhost:3000
```

Sign up, and with the default `MAIL_TRANSPORT=console` the verification link is
printed to the **backend terminal** — paste it into your browser to activate the
account. Set `MAIL_TRANSPORT=ethereal` to have it delivered to a throwaway inbox
instead, or `smtp` with credentials to send for real.

## Testing

```bash
npm test                    # everything
npm test -- api             # only the API suites
npm test -- refunds         # any suite whose name matches
```

**823 assertions across 23 suites**, and they drive the actual stack — a real
Postgres, the real Express API, and a production build of the frontend under
Playwright. Nothing is mocked, because the bugs worth catching here live in the
seams between those pieces rather than inside any one of them.

Each suite runs as its own process, so one that hangs cannot take the others
with it. The interesting ones assert things a response cannot show you:

- **`payment-safety`** fires concurrent pay requests at one order and proves
  the card is charged once — the claim-then-charge conditional `UPDATE` either
  serialises them or it does not, and a 200 looks identical either way.
- **`ratelimit`** proves three instances enforce *one* shared limit of 10
  rather than three private limits totalling 30.
- **`cache`** writes through the API and then checks the key was **dropped**,
  not left to expire. A missing invalidation still returns correct-looking data
  for its whole TTL; it can only be caught by writing and reading again.
- **`refunds`** covers the async webhook path, including a forged signature and
  a redelivery.

CI runs the whole thing on every push and pull request, against stub payment
and identity providers so that a PR from a fork — which cannot see repository
secrets — still gets a meaningful green run.

For a catalogue large enough to make pagination and search mean something:

```bash
npm run seed:scale          # 900 more listings across 30 sellers
```

### Measuring the infrastructure

Two scripts exist to make claims about scaling checkable rather than asserted.

```bash
REDIS_URL=redis://localhost:6379 npx tsx scripts/cache-demo.ts
```

Fires 120 requests across 120 distinct listing pages, cold then warm, against
the same process. Database transactions are counted from Postgres's own
`xact_commit` rather than by instrumenting the app — an app-side counter
measures what the code *believes* it did, and the question is whether the queries
reached the database at all.

|  | Cold | Warm |
| --- | --- | --- |
| p50 | 103ms | 8ms |
| p95 | 276ms | 23ms |
| Database transactions | 928 | 0 |

```bash
docker compose --profile ha up -d postgres-replica
npx tsx scripts/replication-demo.ts
```

Checks the four things that have to be true of a standby — a second Postgres
that starts without error is indistinguishable from an empty database nobody is
streaming to, since both are healthy and both answer queries. Then commits five
rows on the primary and times their arrival: **median 11.1ms**.

It also states what replication is *not*. A standby copies `DROP TABLE orders`
faithfully and in milliseconds; surviving a mistake needs point-in-time
recovery, which is the outstanding half of
[ADR 0020](docs/adr/0020-replication-and-backups.md).

```bash
# three API instances, sharing nothing
for p in 4001 4002 4003; do PORT=$p npm start & done

npx tsx scripts/ratelimit-demo.ts \
  --targets http://localhost:4001,http://localhost:4002,http://localhost:4003
```

Spreads 40 password-change attempts round-robin across three API instances
against a stated limit of 10 per 15 minutes. Sharing nothing, **30 get through**
— each instance enforcing its own count correctly while the aggregate is wrong.
Sharing Redis, 10 do. See [ADR 0019](docs/adr/0019-cache-tiering-rule.md) and
[ADR 0018](docs/adr/0018-redis-for-shared-ephemeral-state.md).

## Documentation

The README stays deliberately short. Everything else lives in [`docs/`](docs/):

| Document | What's in it |
| --- | --- |
| [Architecture overview](docs/architecture/README.md) | How the pieces fit, at a glance |
| [High-level design](docs/architecture/hld.md) | System context, containers, request lifecycle, security model |
| [Low-level design](docs/architecture/lld.md) | Module responsibilities, key flows, sequence diagrams |
| [Data model](docs/architecture/data-model.md) | ER diagram and table-by-table reference |
| [API reference](docs/api.md) | Every endpoint, with request and response shapes |
| [Decision records](docs/adr/README.md) | 21 ADRs on why things are built the way they are |
| [Contributing](CONTRIBUTING.md) | Local setup, conventions, testing expectations |
| [Security](SECURITY.md) | Reporting vulnerabilities, and the security posture |

If you only read one, read the [decision records](docs/adr/README.md). They
carry the reasoning that the code cannot: why money is stored as integer minor
units, why stock is claimed under a row lock, why an order is claimed before it
is charged, and why admin is granted by CLI with no promotion endpoint.

## Repository layout

```
Kintsugi/
├── backend/            Express API
│   ├── prisma/         Schema, migrations, seed
│   ├── scripts/        admin grant/revoke, rate-limit load demo
│   ├── src/
│   │   ├── lib/        Auth, orders, payments, refunds, moderation,
│   │   │               cache, rate limiting, mail, storage, images, KYC
│   │   ├── middleware/ requireAuth, requireSeller, requireAdmin
│   │   └── routes/     15 routers — auth, catalog, seller, orders,
│   │                   reservations, admin, webhooks, and the rest
│   └── tests/          22 suites: api/, browser/, and shared fixtures
├── frontend/           Next.js storefront
│   └── src/
│       ├── app/        Routes, including BFF handlers under app/api/*
│       ├── components/ UI, including the admin dashboard
│       └── lib/        API clients, auth context, catalog helpers
├── docs/               Architecture, ADRs, API reference
└── docker-compose.yml  postgres, redis, migrate, seed, api, web
```

The browser only ever talks to the Next.js server. Next.js acts as a
Backend-for-Frontend: route handlers under `frontend/src/app/api/*` proxy to
Express server-to-server and relay session cookies both ways, so the browser
never learns the backend's address. See
[ADR 0002](docs/adr/0002-bff-proxy.md).

## What's built

**Buying**

- Catalogue browsing — categories, listing detail, search with filters
  (category, condition, price range), sorting, pagination
- Stock held under a row lock during checkout, so two buyers can never both
  claim the same one-of-a-kind object ([ADR 0012](docs/adr/0012-row-locking-for-reservations.md))
- Payment via Stripe PaymentIntents, claimed before it is charged so two
  concurrent clicks cannot pay twice ([ADR 0013](docs/adr/0013-payment-provider-seam.md))
- Orders, addresses, wishlist, reviews with computed ratings

**Selling**

- Seller onboarding, listing CRUD, photo upload with EXIF stripping,
  draft/publish lifecycle
- Per-line fulfilment — a basket can span sellers, and two sellers cannot share
  one parcel ([ADR 0014](docs/adr/0014-one-order-fulfilment-per-line.md))
- Identity verification through Stripe Identity, gating payouts rather than
  listing ([ADR 0007](docs/adr/0007-verification-gates-payouts.md))

**Money back**

- Automatic refunds when a seller marks a line unsendable, and moderator-issued
  refunds from the admin panel
- Over-refund protection as an atomic conditional `UPDATE`, and settlement by
  webhook with signature verification ([ADR 0016](docs/adr/0016-refunds-claim-then-refund.md))

**Operations**

- Admin dashboard — metrics, orders, customers, catalogue, reports, audit log
- Admin granted only by CLI, with no promotion endpoint anywhere in the API,
  behind TOTP step-up on a separate short-lived session
  ([ADR 0015](docs/adr/0015-admin-by-cli-grant-and-step-up.md))
- Moderation with an append-only audit trail
- Redis-backed rate limiting that holds across instances, and read-through
  caching for the catalogue ([ADR 0018](docs/adr/0018-redis-for-shared-ephemeral-state.md))

## Not built yet

- **Payouts to sellers.** The largest remaining gap. Money reaches the platform
  and can be refunded from it; paying sellers out needs Stripe Connect.
- **Object storage for uploads.** Local disk works and is wrong for more than
  one replica. `lib/storage.ts` exists as the seam to replace.
- **Backups, and Kubernetes.** A streaming standby exists
  (`docker compose --profile ha up -d postgres-replica`) and is verified, but a
  replica is not a backup — it copies a mistaken `DROP TABLE` as faithfully as
  anything else. Next is WAL archiving for point-in-time recovery, and a restore
  actually rehearsed rather than assumed.

Placeholder screens say so explicitly rather than presenting controls that
don't work.

## License

[Apache License 2.0](LICENSE) © 2026 Karan Bhatt

You're free to use, modify, and distribute this, including commercially. In
return the license asks three things:

- Keep the copyright and attribution notices, including [`NOTICE`](NOTICE)
- Mark any files you change as changed
- Don't use the Kintsugi name to promote your own version

Sample images in the seed data come from [Unsplash](https://unsplash.com) under
the Unsplash License and aren't covered by the grant above.

Commits from the Apache 2.0 change onward are signed, so `Verified` on GitHub
means a commit genuinely came from the holder of the signing key rather than
from anyone who typed the right name into a Git config. Earlier commits predate
signing and are unsigned; rewriting them would destroy the timestamps that
establish authorship in the first place.
