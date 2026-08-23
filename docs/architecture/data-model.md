# Data Model

PostgreSQL 16, managed by Prisma 7. Source of truth:
[`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma).

---

## Entity relationships

```mermaid
erDiagram
    User ||--o| SellerProfile : "may become"
    User ||--o{ RefreshToken : has
    User ||--o{ EmailVerificationToken : has
    User ||--o{ Review : writes
    SellerProfile ||--o{ Listing : owns
    SellerProfile ||--o{ KycAttempt : "attempts"
    Category ||--o{ Listing : contains
    Listing ||--o{ ListingImage : has
    Listing ||--o{ Review : receives
    Listing ||--o{ Reservation : "holds against"
    User ||--o{ Reservation : places
```

## Tables

### `users`

The account. One row per person, whether they buy, sell, or both.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `email` | text | Unique |
| `passwordHash` | text | bcrypt, cost 12 |
| `name` | text | |
| `isSeller` | bool | Capability flag, not an account type |
| `emailVerified` | bool | Login is blocked until true |
| `avatarUrl` | text? | Public URL of the stored avatar. **The image lives in object storage, never here.** Null falls back to generated initials |
| `createdAt` / `updatedAt` | timestamp | |

### `refresh_tokens`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `userId` | uuid | FK → users, cascade |
| `tokenHash` | text | Unique. **SHA-256 of the token** — the plaintext is never stored |
| `expiresAt` | timestamp | 30 days from issue |
| `revokedAt` | timestamp? | Set on logout or on reuse detection |
| `replacedByTokenHash` | text? | Rotation chain; presenting a replaced token means it leaked |

### `email_verification_tokens`

| Column | Type | Notes |
| --- | --- | --- |
| `tokenHash` | text | Unique, hashed like refresh tokens |
| `expiresAt` | timestamp | 24 hours |
| `usedAt` | timestamp? | Enforces single use |

### `seller_profiles`

One-to-one with `users`, created when someone starts selling. Separate from
`users` so verification and payout state don't bloat the row read on every
authenticated request.

| Column | Type | Notes |
| --- | --- | --- |
| `userId` | uuid | Unique FK → users, cascade |
| `shopName` | text | Defaults to the user's name |
| `bio` | text? | |
| `kycStatus` | enum | `UNSTARTED` / `PENDING` / `VERIFIED` / `REJECTED` |
| `kycProvider` | text? | e.g. `stub`, `stripe_identity` |
| `kycSessionId` | text? | Provider's session reference for the latest attempt |
| `kycDocType` | text? | `passport` / `drivers_license` / `national_id` |
| `kycCountry` | text? | ISO 3166-1 alpha-2 |
| `kycVerifiedAt` | timestamp? | |
| `kycRejectionReason` | text? | Cleared on success |
| `payoutsEnabled` | bool | True only alongside a `VERIFIED` decision |

**No document data is stored here.** No image, no document number, no date of
birth. Only a reference to the provider's decision.
→ [ADR 0006](../adr/0006-kyc-store-reference-not-document.md)

### `kyc_attempts`

Audit trail. `seller_profiles` holds current state; this holds history.

| Column | Type | Notes |
| --- | --- | --- |
| `sellerProfileId` | uuid | FK, cascade, indexed |
| `provider` | text | |
| `providerSessionId` | text | Unique — the match key for a decision |
| `status` | enum | `PENDING` → `VERIFIED` \| `REJECTED` |
| `documentType` / `country` | text? | Non-sensitive descriptors only |
| `rejectionReason` | text? | |
| `createdAt` / `completedAt` | timestamp | |

### `categories`

| Column | Type | Notes |
| --- | --- | --- |
| `slug` | text | Unique; the public URL segment |
| `title` / `description` | text | |
| `coverImage` | text | |
| `position` | int | Display order |

### `listings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `slug` | text | Unique. Generated at creation and **never regenerated**, so links survive renames |
| `sellerId` | uuid | FK → seller_profiles, cascade, indexed |
| `categoryId` | uuid | FK → categories, indexed |
| `title` / `description` | text | |
| `condition` | enum | `LIKE_NEW` / `GOOD` / `WELL_LOVED` / `NEEDS_REPAIR` — drives filtering |
| `conditionNote` | text? | Seller's own wording — what the card shows |
| `priceCents` | int | **Integer minor units.** Never a float |
| `originalPriceCents` | int? | Must exceed `priceCents` if set |
| `currency` | text | ISO 4217, default `USD` |
| `quantity` | int | Default 1 — most secondhand goods are unique |
| `status` | enum | See the [lifecycle](lld.md#4-listing-lifecycle) |
| `featured` | bool | Hand-curation for the "Picked for you" shelf. Not personalisation |
| `deletedAt` | timestamp? | Soft delete |

Indexed on `categoryId`, `sellerId`, `status`, `createdAt`, `featured` — the
five columns the catalog filters and sorts on.

### `listing_images`

| Column | Type | Notes |
| --- | --- | --- |
| `listingId` | uuid | FK, cascade, indexed |
| `url` | text | Public URL of the processed WebP |
| `alt` | text? | Defaults to the listing title |
| `position` | int | **0 is the cover** |

Rows only ever reference images that have been re-encoded and stripped of
metadata; originals are never persisted.

### `reviews`

| Column | Type | Notes |
| --- | --- | --- |
| `listingId` | uuid | FK, cascade, indexed |
| `authorId` | uuid | FK → users, cascade |
| `rating` | int | 1–5 whole stars |
| `body` | text? | |

`@@unique([listingId, authorId])` — one review per person per listing.

**There is no stored aggregate.** Averages are computed from these rows, so a
displayed rating always corresponds to reviews that exist.
→ [ADR 0009](../adr/0009-computed-ratings.md)

### `reservations`

A time-limited hold on stock, taken before checkout. Only `HELD` rows consume
availability.

| Column | Type | Notes |
| --- | --- | --- |
| `listingId` | uuid | FK, cascade, indexed |
| `userId` | uuid | FK → users, cascade |
| `quantity` | int | How much stock this hold consumes |
| `status` | enum | `HELD` → `RELEASED` \| `CONVERTED` \| `EXPIRED` |
| `expiresAt` | timestamp | 15 minutes from creation, indexed |
| `releasedAt` | timestamp? | Set when released or expired |

A **partial unique index** — `("listingId","userId") WHERE status = 'HELD'` —
enforces one live hold per buyer per listing. It is hand-written in the migration
because Prisma cannot express partial indexes, and a plain `@@unique` would also
constrain `RELEASED` rows and stop a buyer re-reserving something they let go.

Availability is decided under a `SELECT … FOR UPDATE` lock on the listing row, so
two buyers can never both claim the same unique item.
→ [ADR 0012](../adr/0012-row-locking-for-reservations.md)

---

## Enums

| Enum | Values |
| --- | --- |
| `ListingStatus` | `DRAFT`, `ACTIVE`, `RESERVED`, `SOLD`, `REMOVED` |
| `Condition` | `LIKE_NEW`, `GOOD`, `WELL_LOVED`, `NEEDS_REPAIR` |
| `VerificationStatus` | `UNSTARTED`, `PENDING`, `VERIFIED`, `REJECTED` |
| `ReservationStatus` | `HELD`, `RELEASED`, `CONVERTED`, `EXPIRED` |

## Invariants

Enforced in the application layer unless noted:

1. A visible listing satisfies `status = ACTIVE AND deletedAt IS NULL`.
2. `payoutsEnabled = true` only alongside `kycStatus = VERIFIED`, written in one
   transaction.
3. `isSeller = true` iff a `SellerProfile` exists — both written in one
   transaction by `POST /auth/become-seller`.
4. A published listing has at least one `ListingImage`.
5. `originalPriceCents > priceCents` when set.
6. One review per `(listing, author)` — enforced by the database.
7. A listing's `slug` never changes after creation.
8. `Listing.quantity` never goes negative — enforced by deciding availability
   under a row lock, not by a check constraint.
9. At most one `HELD` reservation per (listing, buyer) — enforced by the
   database.

## Migrations

| Migration | Adds |
| --- | --- |
| `init` | `users` |
| `add_refresh_tokens` | `refresh_tokens` |
| `add_email_verification` | `email_verification_tokens`, `emailVerified` |
| `add_catalog_and_seller_profiles` | `seller_profiles`, `categories`, `listings`, `listing_images`, `reviews`, all three enums |
| `add_featured_flag` | `listings.featured` |
| `add_kyc_attempts` | `kyc_attempts` |
| `add_user_avatar` | `users.avatarUrl` |
| `add_reservations` | `reservations`, `ReservationStatus`, partial unique index |

```bash
npx prisma migrate dev --name <name>   # create + apply
npx prisma generate                    # regenerate client (not always automatic)
npx prisma studio                      # browse data
```

> `migrate dev` does not reliably regenerate the client in this setup. If a new
> column or enum is missing from types at runtime, run `prisma generate`.

## Seed

`npx prisma db seed` → 5 categories, 13 listings, 46 reviews, 12 reviewer
accounts, and one house seller ("Kintsugi Collection") that owns the seeded
inventory so `sellerId` can stay non-nullable.

Every write is an upsert keyed on a unique column, so re-running converges
instead of duplicating.

Seed accounts get a random password that is never recorded, leaving them
effectively login-disabled rather than sharing a known weak credential.
Listing `createdAt` values are backdated so "Recently listed" is a genuine date
sort.
