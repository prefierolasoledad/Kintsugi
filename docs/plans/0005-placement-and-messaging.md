# Plan 0005 — Letting the platform choose, and letting a seller ask

- **Status:** Phases 0–4 landed 2026-09-11. Phases 5–7 not started.
- **Written:** 2026-09-11
- **Produces:** ADR 0033 (messaging), ADR 0034 (paid placement)

---

## 1. Where this stands today

Two gaps that turn out to be one feature.

**Nobody can choose what is on the homepage.** `page.tsx` derives all four
shelves — reduced, top rated, new arrivals, everything — and a moderator has no
say in any of them. `Listing.featured` exists, is indexed, carries a comment
explaining that it is hand-curation, and is written by nothing.

**A seller cannot talk to the platform.** All eleven notification types are
one-way. There is no reply path anywhere in the application, so "ask us about
appearing on the homepage" has no destination.

The second gap is why the first one cannot simply be an admin checkbox: the
feature the product actually wants is a seller *asking*, and somebody
*answering*.

## 2. What is being built

```
seller picks a listing, names a slot and an amount
        │
        ↓
PlacementRequest  ──────────────►  MessageThread  (the negotiation lives here)
  REQUESTED                              │
        │                                │  admin counters: amount, period, slot
        │◄───────────────────────────────┘
        ↓
  AGREED  ──(claim the slot)──►  LIVE  ──(period ends)──►  ENDED
        │                          │
        │                          └── listing sells → stops rendering, stays LIVE
        ↓
  DECLINED / WITHDRAWN
```

Money is **not** charged. The agreement is a record; settlement happens off
platform ([ADR 0034](../adr/0034-paid-homepage-placement.md)).

Everything on the homepage that is there because of an agreement carries a
**Promoted** label. That is a requirement of the feature, not a phase that can
slip.

## 3. Schema additions

Two enums and three tables. No changes to any existing table except
`Listing`, which gains a back-relation.

```prisma
enum PlacementSlot {
  HERO          /// One at a time: the banner at the top of the homepage.
  PICKED_SHELF  /// Four positions on the "Picked for you" shelf.
}

enum PlacementStatus {
  REQUESTED   /// The seller asked. Nobody has answered.
  COUNTERED   /// An admin proposed different terms. Back with the seller.
  AGREED      /// Both sides agreed. Not live yet.
  LIVE        /// On the homepage now. Claimed — see the partial unique index.
  ENDED       /// The period ran out. Terminal.
  DECLINED    /// An admin said no. Terminal.
  WITHDRAWN   /// The seller pulled it. Terminal.
}

enum ThreadKind { PLACEMENT  SUPPORT }
enum MessageAuthor { SELLER  ADMIN }

model MessageThread {
  id        String     @id @default(uuid())
  sellerId  String
  seller    SellerProfile @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  kind      ThreadKind
  subject   String

  /// Denormalised so the thread list sorts without touching messages.
  lastMessageAt DateTime @default(now())
  closedAt      DateTime?

  /// Two counters, not a read-receipt table: there are exactly two sides and
  /// one of them is a role. ADR 0033 records what this costs.
  sellerUnread Int @default(0)
  adminUnread  Int @default(0)

  messages  Message[]
  placement PlacementRequest?

  @@index([sellerId, lastMessageAt])
  @@map("message_threads")
}

model Message {
  id       String        @id @default(uuid())
  threadId String
  thread   MessageThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  author   MessageAuthor

  /// No FK, deliberately: "an admin who has since been deleted wrote this"
  /// must stay answerable. Same reasoning as notification_deliveries.
  authorUserId String?

  body      String
  createdAt DateTime @default(now())

  @@index([threadId, createdAt])
  @@map("messages")
}

model PlacementRequest {
  id        String @id @default(uuid())
  listingId String
  listing   Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  sellerId  String
  seller    SellerProfile @relation(fields: [sellerId], references: [id], onDelete: Cascade)

  slot     PlacementSlot
  /// 0 for HERO; 0-3 for the shelf. Part of the live-slot claim.
  position Int @default(0)

  /// Whole cents, like every other amount in this schema (ADR 0005).
  offeredCents Int
  agreedCents  Int?

  startsAt DateTime?
  endsAt   DateTime?

  status     PlacementStatus @default(REQUESTED)
  decidedById String?        /// no FK, same reasoning as Message.authorUserId
  decidedAt   DateTime?

  /// The conversation carrying the negotiation. One thread per request.
  threadId String        @unique
  thread   MessageThread @relation(fields: [threadId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status, slot, position])
  @@index([sellerId, status])
  @@map("placement_requests")
}
```

And one thing Prisma cannot express, added by hand to the migration:

```sql
CREATE UNIQUE INDEX placement_live_slot
  ON placement_requests (slot, position)
  WHERE status = 'LIVE';
```

That index **is** the concurrency guard. Activating is
`UPDATE … SET status='LIVE' WHERE id=$1 AND status='AGREED'`, and two admins
activating two hero agreements at once produce one success and one
unique-violation.

## 4. Phases

| # | What | Done when |
| --- | --- | --- |
| 0 | Decide. ADR 0033 and ADR 0034. | **Recorded 2026-09-11** |
| 1 | Schema + migration, including the hand-written partial unique index. | **Landed 2026-09-11** — see the note below |
| 2 | `lib/messaging.ts` — open a thread, post a message, mark read, close. Two new notification event types wired through the outbox. | **Landed 2026-09-11** — 38 assertions in `tests/api/messaging.ts` |
| 3 | `lib/placement.ts` — request, counter, agree, activate, end, decline, withdraw. Every transition a conditional `UPDATE`. | **Landed 2026-09-11** — 43 assertions, and the race proven to fail without the index |
| 4 | Seller routes: request placement, list threads, read, reply. Admin routes: the placement queue, counter, decide, activate. | **Landed 2026-09-11** — 45 assertions in `tests/api/placement-routes.ts` |
| 5 | Homepage reads live placements. **Promoted label on the hero and the shelf card.** Sold listings drop out. | A LIVE placement appears with its label; marking it SOLD removes it |
| 6 | Seller and admin UI: a thread view, a placement request form, an admin merchandising screen. | A negotiation can be completed end to end in a browser |
| 7 | Sweeper: `AGREED` → `LIVE` when `startsAt` arrives, `LIVE` → `ENDED` when `endsAt` passes. Sixth in-process sweeper. | A placement goes live and ends without anyone pressing anything |

### Phase 1, and what it cost

Three tables, two enums for placement, two for messaging, and 133 lines of
hand-written SQL. `migrate deploy` applied it clean as the 25th migration.

**The index was tested before anything was built on it**, because an untested
constraint is a comment. Two `AGREED` hero placements, then two activations:

```
UPDATE ... WHERE id='p1' AND status='AGREED'   →  UPDATE 1
UPDATE ... WHERE id='p2' AND status='AGREED'   →  ERROR: duplicate key value
                                                  violates unique constraint
                                                  "placement_live_slot"
                                                  Key (slot, "position")=(HERO, 0)
```

Then both rows to `ENDED` on the same slot — `UPDATE 2`, confirming the index
really is partial and terminal history is unconstrained.

**The typechecker found the consequence I had not planned for.** Adding two
`NotificationType` values broke `lib/channelPolicy.ts`, whose `POLICY` is a
`Record<NotificationType, Policy>` — exhaustive on purpose, so a new event
cannot ship without somebody deciding which channels it uses. That is the table
working as designed: it turned "I forgot the consent defaults" into a compile
error rather than an event that silently reaches nobody. Both new types are
`EMAIL: on, PUSH: on, SMS: off`; the SMS boundary from
[ADR 0027](../adr/0027-notification-consent.md) holds, since only money moving
unexpectedly earns a text.

**One thing that turned out to be free.** Notification content is passed in by
the caller — `notify({ type, title, body })` — rather than looked up from a
per-type template map, so there is no template table to extend. Phase 2 only
has to call it.

**Worth knowing before phase 2:** `npm run lint` is `--max-warnings 195` and the
repository currently sits at exactly 195. It passes, with nothing to spare, so
the next phase that adds an unhandled promise or an `any` will fail CI on the
ceiling rather than on its own merits.

### Phase 2, and what it cost

`lib/messaging.ts`, 393 lines, and a 38-assertion suite. Green, and so are the
three suites the work touched indirectly: returns 43, email-delivery 26,
outbox 28.

**The interesting decision was not to use `notify()`.** Every other caller in
the codebase does, and it is wrong here: `notify()` opens its own transaction
and swallows its own errors, which is correct when the notification is a side
effect of something more important. A message has nothing more important behind
it, so the message, the counters, the notification and the outbox event commit
in one transaction and a failure reaches the caller. `enqueue(tx, …)` takes a
transaction client precisely so this cannot be written as a dual write — the
signature is the enforcement.

**Implementation forced a decision the ADR had not made.** "The admin side is a
role" does not say who receives the notification, because a notification needs a
`userId`. Answer: every non-suspended `ADMIN`, one event each. Recorded in
ADR 0033 rather than left in the code, along with the two rejected alternatives
and the cost.

**The suite asserts against the real admin population**, not against the two
moderators it creates. Other suites and the seed leave admins behind, so
`liveAdminIds` is read from the database at fixture time and the fan-out is
compared to that. Hard-coding 2 would have passed today and broken the first
time somebody seeded another moderator.

**One cleanup taken rather than a third copy made.** `isUniqueViolation` existed
twice — in `deliveryLedger.ts` and `returns.ts` — and the two had already
drifted, one checking Postgres's `23505` as well as Prisma's `P2002` and the
other not. The placement work needs it a third time, so it is now
`lib/pgErrors.ts` with the union of both behaviours, and both original callers
import it. The drift mattered: the partial unique index on live placements is a
constraint Prisma does not know about, so it raises `23505`, which the narrower
copy would have rethrown as an unexpected error.

### Phase 3, and what it cost

`lib/placement.ts`, 560 lines, 43 assertions. The sweeper from phase 7 is
written here too, since it is two queries and the suite could prove it now.

**The race assertion was checked by breaking it.** A test that cannot fail is
decoration, so the index was dropped and the suite re-run:

```
[4. two agreements, one slot, activated in parallel]
  PASS  two agreements both reached AGREED for HERO position 0
  FAIL  exactly one activation won — 2 won
  FAIL  and the other was told the slot was taken — 0 reported slot-taken
  FAIL  one LIVE row in the database — found 2
```

Two live heroes, which is the exact bug ADR 0034 exists to prevent. Index
recreated, suite green again. **It also had to be `Promise.all`** — two
sequential `activate()` calls pass against an implementation with no constraint
at all, because the second one sees the first row already `LIVE`.

**The dedupe from phase 2 paid for itself here.** The partial index is a
constraint Prisma does not know about, so it raises Postgres's `23505` rather
than Prisma's `P2002`. The narrower copy of `isUniqueViolation` that used to
live in `returns.ts` would have rethrown it as an unexpected error, and the
loser of a slot race would have been a 500 instead of a queued placement.

**One decision the ADR had not made:** what the loser of a race gets. It returns
`slot-taken` and stays `AGREED` rather than failing, which is what makes queuing
work without anybody re-requesting — and is why `sweepPlacements()` activates
one row at a time rather than in a single `updateMany`, since a bulk update of
everything due would take the whole batch or none of it.

**One notification per action.** A counter-offer is both a message and a
commercial decision, and announcing it twice is how a channel gets muted. So
`writeMessage` gained an optional notification type and placement transitions
raise `PLACEMENT_DECIDED` in place of `MESSAGE_RECEIVED`, with the terms in the
message body — the thread reads as a negotiation rather than a status log.

### Phase 4, and what it cost

Two routers — `sellerMessaging.ts` (9 endpoints) and `adminPlacement.ts` (12) —
and a 45-assertion suite that drives the whole negotiation over HTTP: seller
asks, moderator counters, seller accepts, moderator activates, moderator ends.

**The admin routes are mounted INSIDE `admin.ts`, below
`adminRouter.use(requireAdmin)`.** Mounting them separately at `/admin` from
`index.ts` would have looked identical and been completely unguarded, because a
separate router does not inherit another router's middleware. The file says so
at the top, since it is the sort of thing that gets "tidied up" later.

**Both `use()` calls in the seller router name their path**, and the suite opens
by proving the neighbours still answer:

```
[1. the new router did not lock its neighbours out]
  PASS  GET /seller/sales still answers 200
  PASS  GET /seller/verification still answers 200 — the door an unverified seller needs
  PASS  GET /seller/listings still answers 200
```

That is not a theoretical risk. An unscoped `use()` in a router mounted at
`/seller` broke every sibling route with a 500 once already, and the feature's
own tests did not notice — `identity.ts` caught it. Both `identity` (44) and
`payout-routes` (62) were re-run here and are green.

**The lint ceiling moved, by the procedure the config documents.** 195 → 218,
with a note in `eslint.config.mjs` beside the existing one, because
`no-misused-promises` is a warning by deliberate choice and the ceiling exists
to make growth visible rather than to prevent it. All 23 are async Express
handlers, the same shape as the 133 before them. The check that mattered: zero
new warnings in `lib/messaging.ts`, `lib/placement.ts` or any of the three
suites. Route handlers growing the count is expected; anything else would mean
the pattern had spread.

**One thing the routes say out loud that the UI could have kept to itself.**
`GET /seller/placements/slots` returns a `disclosure` field —
*"Paid placements are labelled “Promoted” wherever they appear."* A seller
agreeing to pay is entitled to know that before they agree, and a client that
forgets to render it should not be the only thing standing between them and a
surprise.

**Authorisation, stated as the suite asserts it:** a signed-out request is 401;
a buyer reaching a seller route is refused; another seller asking about your
listing, thread or placement gets **404, never 403**, so an id cannot be used to
ask whether a rival's thing exists; and declining a request without a reason is
a 400, for the same reason refusing a return requires one.

## 5. What this deliberately does not do

Stated here so the next person does not go looking.

- **No card is charged.** The platform can agree a fee and cannot collect one.
  ADR 0034 records why, and this is the largest gap the feature ships with.
- **No buyer ↔ seller messaging.** ADR 0033 records why; abuse handling and
  contact-detail scrubbing are the real cost, not the table.
- **No realtime.** A reply arrives as a notification on the channels the
  recipient already consented to.
- **No overlapping-period booking.** Two agreements cannot be booked for
  consecutive future weeks on the same slot; the live claim is the only guard.
- **No assignment or SLA.** A thread is open or closed. This is not a support
  desk.
- **No auction.** Sellers negotiate, they do not bid against each other.

## 6. Counts this will move

The repository states its own size in several places, and adding two
notification event types makes every one of them stale:

| Claim | Today | After |
| --- | --- | --- |
| Notification event types | 11 | 13 |
| Tables | 28 | 31 |
| Decision records | 32 | 34 |
| Routers | 16 | 17 or 18 |

`README.md`, `docs/api.md`, `docs/architecture/lld.md`, `docs/architecture/hld.md`
and the published architecture reference all carry at least one of these.
