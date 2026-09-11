# Plan 0005 — Letting the platform choose, and letting a seller ask

- **Status:** Phases 0–1 landed 2026-09-11. Phases 2–7 not started.
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
| 2 | `lib/messaging.ts` — open a thread, post a message, mark read, close. Two new notification event types wired through the outbox. | A message raises exactly one outbox row in the same transaction |
| 3 | `lib/placement.ts` — request, counter, agree, activate, end, decline, withdraw. Every transition a conditional `UPDATE`. | Two concurrent activations produce one LIVE row, proven by a test that runs them in parallel |
| 4 | Seller routes: request placement, list threads, read, reply. Admin routes: the placement queue, counter, decide, activate. | Both sides drivable over HTTP with no database access |
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
