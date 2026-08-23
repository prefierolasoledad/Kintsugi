# 12. Row-level locking for stock reservations

- **Status:** Accepted
- **Recorded:** 2026-08-23

## Context

Almost every listing on Kintsugi is quantity 1 — one chair, one jacket, one
repaired plate. So the hard problem in checkout is not counting stock. It is
making sure two buyers can never both claim the same object.

The naive reservation reads then writes:

```ts
const listing = await prisma.listing.findUnique(...);   // quantity: 1, ACTIVE
if (listing.quantity >= 1) {
  await prisma.listing.update({ data: { quantity: 0 } });
}
```

Two requests arriving together both execute the read before either executes the
write. Both see stock, both proceed, and the item sells twice. The window is
milliseconds, which means it will not show up in manual testing and will show up
in production.

## Decision

Availability is decided inside a transaction that holds an **exclusive row lock
on the listing**:

```sql
SELECT "id", "quantity", "status"::text, "sellerId", "deletedAt"
FROM "listings" WHERE "id" = $1
FOR UPDATE
```

A second transaction touching the same row blocks until the first commits, then
reads the *updated* state and correctly finds no stock. Concurrency on one
listing becomes strictly serial; other listings are unaffected, because the lock
is per row rather than per table.

Inside that lock, one indivisible step:

1. Reclaim any expired holds, returning their stock
2. Reject if this buyer already holds the item
3. Reject if the listing isn't for sale
4. Reject if stock is short
5. Decrement `quantity`, flip to `RESERVED` when it reaches zero
6. Insert the `Reservation` row

**Holds expire after 15 minutes** and are reclaimed lazily on the next attempt
against that listing, so correctness never depends on a background sweeper. A
sweeper is still worth adding so abandoned stock doesn't sit idle until someone
happens to ask for it — but it is an optimisation, not a fix.

**Every path locks the listing row first**, then touches reservations. One
consistent ordering is what keeps this deadlock-free.

`RESERVED` is distinct from `SOLD`: stock is held, but no money has moved.
Releasing returns it to `ACTIVE`.

### Raw SQL, deliberately

This is the only raw SQL in the codebase, because Prisma's query builder cannot
express `FOR UPDATE`. Values go through Prisma's tagged template, which
parameterises them — it is not string concatenation. Reads use raw SQL purely
for the lock; every write is a normal, type-checked Prisma call on the already
locked row.

## Consequences

- Overselling a unique item is prevented by the database rather than by hoping
  requests don't collide.
- Losing a race is a **409 with `INSUFFICIENT_STOCK`**, not a 500. Contention is
  an expected outcome, not an error.
- Writes to a single hot listing serialise. That is the point, and it caps
  throughput per listing — fine for one-of-a-kind goods, and something to
  revisit for high-quantity inventory.
- Transactions carry a 10-second timeout so a stuck client can't hold a lock
  indefinitely.
- A partial unique index (`WHERE status = 'HELD'`) enforces one live hold per
  buyer per listing in the database too. Prisma can't express partial indexes, so
  it's hand-written in the migration — a plain `@@unique` would also constrain
  `RELEASED` rows and permanently stop a buyer re-reserving something they had
  let go.
- Reservations are retained after release or expiry rather than deleted, so the
  history of who held what stays inspectable.

## Alternatives considered

**Conditional update with a rowcount check.**

```sql
UPDATE listings SET status = 'RESERVED'
WHERE id = $1 AND status = 'ACTIVE' AND quantity > 0
```

Atomic on its own, no explicit lock, no deadlock ordering to think about — and
genuinely the better choice for a bare status flip. Rejected here because
reserving is not one write: it has to read stock, reclaim expired holds, check
for a duplicate hold, decrement, and insert a row, all indivisibly. Compressing
that into a single conditional statement would mean giving up the expiry
reclamation and the specific error codes.

**`SERIALIZABLE` isolation with retry.** Correct, and pushes the burden into
retry logic on every caller while making failures appear as opaque
serialisation errors rather than "someone took the last one".

**Optimistic locking via a version column.** Standard and effective, but turns
every collision into a client-visible retry. With unique items the contention is
concentrated on exactly the rows people fight over, which is where optimistic
concurrency performs worst.

**Application-level mutex or a Redis lock.** Works until there are two server
processes and the lock is in the wrong place — and Postgres already offers the
guarantee for free, transactionally tied to the data being protected.

**Reserving at payment time only.** Simplest, and it means a buyer can complete
a whole checkout flow and be told at the very end that the item is gone.
