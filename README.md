# Kintsugi

金継ぎ — the Japanese art of repairing broken pottery with gold, treating the
break as part of the object's history instead of something to hide.

A marketplace for secondhand furniture, clothing, and objects, where condition
is disclosed rather than hidden. Built as a full-stack TypeScript application:
a Next.js storefront, an Express API, and PostgreSQL.

> **Status: in development.** Browsing, accounts, and seller listings work
> end to end. There is no checkout — see [Roadmap](#roadmap).

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| Backend | Node.js, Express 4, TypeScript, Zod |
| Database | PostgreSQL 16, Prisma 7 (driver adapters) |
| Auth | JWT access tokens + rotating opaque refresh tokens, bcrypt |
| Images | Sharp (re-encode + metadata stripping), local disk or object storage |

## Quick start

**Prerequisites:** Node.js 20+ (developed on 24), Docker, npm.

```bash
git clone <your-fork-url> Kintsugi && cd Kintsugi
docker compose up -d                 # Postgres on host port 5433
```

**Backend** — http://localhost:4000

```bash
cd backend
npm install
cp .env.example .env                 # then set JWT_SECRET
npx prisma migrate dev               # create schema
npx prisma db seed                   # 5 categories, 13 listings, reviews
npm run dev
```

**Frontend** — http://localhost:3000

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Sign up, and because no email provider is
configured, the verification link is printed to the **backend console** —
paste it into your browser to activate the account.

## Documentation

The README stays deliberately short. Everything else lives in [`docs/`](docs/):

| Document | What's in it |
| --- | --- |
| [Architecture overview](docs/architecture/README.md) | How the pieces fit, at a glance |
| [High-level design](docs/architecture/hld.md) | System context, containers, request lifecycle, security model |
| [Low-level design](docs/architecture/lld.md) | Module responsibilities, key flows, sequence diagrams |
| [Data model](docs/architecture/data-model.md) | ER diagram and table-by-table reference |
| [API reference](docs/api.md) | Every endpoint, with request and response shapes |
| [Decision records](docs/adr/README.md) | Why things are built the way they are |
| [Contributing](CONTRIBUTING.md) | Local setup, conventions, testing expectations |
| [Security](SECURITY.md) | Reporting vulnerabilities, and the security posture |

## Repository layout

```
Kintsugi/
├── backend/            Express API
│   ├── prisma/         Schema, migrations, seed
│   └── src/
│       ├── lib/        Auth, storage, image processing, KYC provider
│       ├── middleware/ requireAuth, requireSeller
│       └── routes/     auth, catalog, seller, sellerVerification
├── frontend/           Next.js storefront
│   └── src/
│       ├── app/        Routes, including BFF handlers under app/api/*
│       ├── components/ UI
│       └── lib/        API clients, auth context, catalog helpers
└── docs/               Architecture, ADRs, API reference
```

The browser only ever talks to the Next.js server. Next.js acts as a
Backend-for-Frontend: route handlers under `frontend/src/app/api/*` proxy to
Express server-to-server and relay session cookies both ways, so the browser
never learns the backend's address. See
[ADR 0002](docs/adr/0002-bff-proxy.md).

## Roadmap

**Working**

- Catalog browsing — categories, listing detail, search with filters
  (category, condition, price range), sorting, pagination
- Accounts — signup with email verification, login, refresh-token rotation
  with reuse detection, breached-password rejection
- Selling — seller onboarding, listing CRUD, photo upload with EXIF stripping,
  draft/publish lifecycle
- Identity verification — pluggable provider (stubbed by default) gating
  seller payouts

**Not built yet**

- Cart, checkout, orders, payments
- Real email delivery (currently logs to console)
- Real identity provider (currently a deterministic stub)
- Internal ops dashboard

Placeholder screens say so explicitly rather than presenting controls that
don't work.

## Testing

There is no test runner wired up yet. Each feature was verified with
throwaway API and Playwright scripts during development; see
[CONTRIBUTING.md](CONTRIBUTING.md#testing) for what that covered and what
replacing it properly would involve.

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
