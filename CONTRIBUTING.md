# Contributing

Kintsugi is a personal project rather than a community-maintained one, so
there's no review rota or triage process. This file exists because the setup has
sharp edges worth writing down — mostly for whoever picks it up next, including
future me.

## Setup

Follow [Quick start](README.md#quick-start). Two things that bite:

**Postgres runs on host port 5433, not 5432.** `docker-compose.yml` maps it
there to avoid clashing with a native Postgres install. If you change it, change
`DATABASE_URL` too.

**`prisma migrate dev` does not reliably regenerate the client here.** If a new
column or enum is missing from types at runtime — a `PrismaClientValidationError`
saying `Unknown argument` — run:

```bash
npx prisma generate
```

## Running things

```bash
# backend/
npm run dev            # tsx watch
npm run build          # tsc typecheck + emit
npx prisma studio      # browse data
npx prisma db seed     # idempotent; safe to re-run

# frontend/
npm run dev
npm run build          # includes typecheck — run before committing
```

**Restart the dev server after editing `next.config.ts`.** It is read at boot,
not watched. A stale config produced an hour of confusion once already.

**Start one dev server per app.** Repeated background launches leave orphaned
`tsx watch` / `next dev` trees fighting over ports 4000 and 3000, which shows up
as `EADDRINUSE` crash loops. On Windows:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'tsx watch|next dev' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

Kill the top of the tree (the `npm` process), not just the leaf.

## Conventions

**Validate at the boundary.** Zod parses request bodies and query strings in the
route; everything inward is typed. Errors carry a stable `code` and, when one
input is at fault, a `field` the UI renders against that input.

**Wrap async handlers.** Express 4 does not catch rejected promises. Every
handler try/catches, logs with context, and returns a generic message —
internal detail stays server-side.

**Scope by owner, return 404.** Seller queries filter on `sellerId`. A record
owned by someone else returns 404, never 403: a 403 confirms the id exists.

**Money is integer minor units.** `priceCents` end to end. Convert in
`dollarsToCents` on input and `formatPrice` on output, nowhere else.

**Explicit `select`.** Name the fields a route returns, so adding a column never
silently leaks it through an existing endpoint.

**Comments explain why.** The constraint that isn't visible from the signature,
not a restatement of the code.

**Don't fake unbuilt features.** Placeholders say what's missing and carry a
"Planned" badge. No button that looks functional and isn't.

Names: tables `snake_case` via `@@map`, TypeScript `camelCase`, enum values
`SCREAMING_SNAKE_CASE`.

## Documentation

Ship docs with the code, in the same change:

| Change | Also update |
| --- | --- |
| Schema | [docs/architecture/data-model.md](docs/architecture/data-model.md) |
| Endpoint added or changed | [docs/api.md](docs/api.md) |
| Module boundary or notable flow | [docs/architecture/lld.md](docs/architecture/lld.md) |
| A decision with more than one defensible answer | a new [ADR](docs/adr/README.md) |
| Env var | `.env.example` in the relevant app |

## Testing

**There is no test runner wired up.** Being straight about that: each phase was
verified with throwaway scripts — Node scripts hitting the API directly, and
Playwright scripts driving a real browser — run once, checked, and deleted. That
covered roughly 140 assertions across the four phases, including refresh-token
rotation and reuse detection, ownership isolation between sellers, EXIF removal
end to end, and both KYC outcome paths.

That approach caught real bugs, including two the UI hid: a BFF proxy that
corrupted binary uploads, and images that silently failed to render while a
weaker assertion reported success. But deleted scripts don't protect against
regressions.

Making this real means adding Vitest for units and integration against a test
database, plus Playwright as a committed suite, with the seed as fixture. Until
then, if you change something, verify it by actually running it — and assert on
outcomes, not on the presence of elements. `expect(img).toBeVisible()` passed
while every image on the page was broken; `naturalWidth > 0` is what caught it.

## Security

Don't open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

Three invariants worth guarding when touching adjacent code:

1. Identity documents are never persisted, logged, or returned
   ([ADR 0006](docs/adr/0006-kyc-store-reference-not-document.md)).
2. Uploads are re-encoded, never stored as received
   ([ADR 0010](docs/adr/0010-strip-image-metadata.md)).
3. Refresh tokens are stored hashed, and reuse revokes the family
   ([ADR 0001](docs/adr/0001-access-and-refresh-tokens.md)).
