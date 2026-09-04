# Plan 0001 — Multi-channel notifications on Kafka

- **Status:** Plan. Nothing below is built.
- **Written:** 2026-09-04
- **Produces:** ADRs 0024–0027, as each phase lands

> **This is a plan, not a description.** Every other document in `docs/`
> describes code that exists. This one describes code that does not, which makes
> it the most dangerous file in the repository — a reader who mistakes it for
> `architecture/lld.md` will go looking for modules that were never written.
>
> The rule from [docs/README.md](../README.md) applies with force here: *state
> what is not built*. As each phase lands, the decisions it settled move into an
> ADR and the phase is struck through below. When the last phase lands this file
> is deleted, because a plan that outlives its execution becomes a description of
> a system nobody built.

---

## 1. Where notifications stand today

`Notification` is the source of truth and the only delivery channel is the app
itself. `lib/notifications.ts` says so at the top, and commits to what has to
stay true when that changes:

> This table remains the source of truth, so adding mail later means reading
> from here rather than replacing it. Nothing below assumes a delivery channel.

Eleven call sites emit events, all through `events.*`:

| Module | Events |
| --- | --- |
| `lib/orders.ts` | `saleMade` (via `notifyMany` — one basket, several sellers) |
| `lib/sales.ts` | `orderShipped`, `orderDelivered`, `orderUnfulfillable` |
| `lib/refunds.ts` | `refundIssued` ×2 — the automatic path and the moderator path |
| `lib/moderation.ts` | `listingRemoved`, `accountSuspended`, `reportResolved` |
| `lib/reviews.ts` | `reviewReceived` |
| `lib/verification.ts` | `identityVerified`, `identityRejected` |

Every one is `void`-ed, and every emit swallows its own errors, deliberately:
failing to tell someone their item sold must not roll back the sale.

Three gaps, in increasing order of difficulty:

- **Email** — `lib/mailer.ts` exists, has three transports, and is used by
  nothing except verification and password reset. The blocker was never the
  transport. It was per-type preferences and an unsubscribe path, without which
  transactional mail becomes the reason somebody filters the domain to spam and
  then stops seeing the messages that matter.
- **Push** — nothing at all.
- **SMS** — nothing at all, and `User` has **no phone column**. `Address.phone`
  exists but is a delivery contact for a parcel; see §5.

---

## 2. Why the design is an outbox *and* Kafka, not Kafka alone

Kafka on its own would be a step backwards in correctness.

A notification and its published event are two writes to two systems. No
transaction spans them, so a process that dies between them leaves the row
without the event — or, with the publish first, the event without the row. Both
are silent. Neither is recoverable, because nothing anywhere records that the
pair was meant to be atomic.

This codebase does not accept that class of bug anywhere else. Stock is decided
under `SELECT … FOR UPDATE` ([ADR 0012](../adr/0012-row-locking-for-reservations.md)).
Payment is claimed with a conditional `UPDATE` before the provider is called
([ADR 0013](../adr/0013-payment-provider-seam.md)). Refund headroom is claimed
the same way ([ADR 0016](../adr/0016-refunds-claim-then-refund.md)). The rule is
identical in each: one system decides, atomically, and the external call happens
only after that decision is durable.

A **transactional outbox** is that rule applied to publishing. The event row is
written in the same transaction as the notification, so the two commit together
or not at all. A separate relay reads committed outbox rows and publishes them.
A crash anywhere leaves work visibly unfinished rather than silently lost.

With the outbox in place, Kafka is doing what it is genuinely good at:

- **fan-out** — one event, N channels, and adding a channel touches no producer
- **independent consumer scaling** — SMS is slow and email is not; they should
  not share a throughput budget
- **failure isolation** — a dead SMS provider must not stall email
- **replay** — a template bug is fixable by resetting an offset, rather than by
  reconstructing a day of events from logs

It also keeps the transport replaceable. Every call site talks to `events.*`,
which talks to the outbox. Swapping Kafka for something else later is a change
to the relay and the workers, not to eleven business modules.

---

## 3. Target architecture

```mermaid
flowchart TB
    subgraph TX["one Postgres transaction"]
        E["events.saleMade()"] --> N[("notifications")]
        E --> O[("outbox_events")]
    end

    O -->|"FOR UPDATE SKIP LOCKED"| R["relay"]
    R --> T["kintsugi.notifications.v1<br/><i>key = userId</i>"]

    T --> EW["group: email-worker"]
    T --> PW["group: push-worker"]
    T --> SW["group: sms-worker"]

    EW --> L[("notification_deliveries<br/><i>unique(eventId, channel)</i>")]
    PW --> L
    SW --> L

    EW --> M["nodemailer"]
    PW --> WP["Web Push"]
    SW --> TW["SMS provider"]

    EW -.->|"transient failure"| RT["retry.5s → retry.1m → retry.15m"]
    PW -.-> RT
    SW -.-> RT
    RT -.-> DLQ["dlq.v1"]
```

Three properties this shape has to preserve:

**Postgres stays the only source of truth.** Kafka carries delivery, never
truth. The line ADR 0018 draws around Redis is drawn around Kafka here: losing
the entire cluster loses in-flight *deliveries*, and no notification, no order,
and no money. `notifications` is still what the app reads.

**Consumer groups are the fan-out mechanism.** One domain topic, three groups —
not three topics. Per-channel topics would force the relay to know the channel
set, so adding WhatsApp later would mean editing the producer. Groups make the
channel set a consumer-side concern, which is where it belongs.

**Nothing in the request path talks to Kafka.** The relay and the workers are
separate processes. A broker outage slows notifications and does not touch
checkout.

---

## 4. Topics and partitioning

| Topic | Partitions | Key | Retention |
| --- | --- | --- | --- |
| `kintsugi.notifications.v1` | 12 | `userId` | 7d |
| `kintsugi.notifications.retry.5s.v1` | 6 | `userId` | 1d |
| `kintsugi.notifications.retry.1m.v1` | 6 | `userId` | 1d |
| `kintsugi.notifications.retry.15m.v1` | 6 | `userId` | 1d |
| `kintsugi.notifications.dlq.v1` | 3 | `userId` | 30d |

### The partition key is `userId`, and this is the decision that matters

Kafka orders messages within a partition and makes no promise across them.
Keying by `userId` puts every event about one person on one partition, so "your
item sold" cannot overtake "your item shipped".

The tempting alternative — keying by `NotificationType` — is wrong twice over.
There are eleven types, so eleven partitions would carry all the traffic and the
rest none; `SALE_MADE` alone would be a hot partition while eight others idle.
And per-user ordering is destroyed, because one person's events are now spread
across every partition by type.

**12 partitions is the ceiling on consumers per group.** A group cannot usefully
run more consumers than partitions — the extras idle. Raising the count later
rehashes keys, which breaks per-user ordering during the migration, so it is set
deliberately above current need.

`replication.factor` and `min.insync.replicas` come from environment, not from a
literal: 1 and 1 on a single-broker Compose stack, 3 and 2 anywhere real.

### The retry ladder, and why retries are not in-process

A consumer that retries in place blocks its partition. One buyer with a dead
phone number would hold up every other user hashed to that partition — a
per-recipient failure escalating into a per-channel stall.

Republishing to a delay topic keeps the main partition moving. The consumer
commits its offset, the message waits elsewhere, and a worker on the delay topic
picks it up once the delay has elapsed. Three rungs, then the DLQ.

**What is retryable is decided per failure, not per exception.** A 5xx from a
provider, a timeout, or a connection reset is transient and rides the ladder. A
rejected address, an unsubscribed recipient, or a `410 Gone` push endpoint is
permanent — it goes to the ledger as `FAILED` and never retries, because
retrying it is how a sender reputation gets burned.

---

## 5. Schema additions

```prisma
/// A domain event, written in the SAME TRANSACTION as the thing it describes.
///
/// Publishing to Kafka directly from the emitting code would be a dual write:
/// two systems, no transaction between them, and a crash in the gap that is
/// both silent and unrecoverable. This row is what makes the pair atomic — it
/// commits with the notification or not at all, and the relay publishes only
/// what is already durable. Same discipline as claim-then-charge in ADR 0013.
model OutboxEvent {
  id            String    @id @default(uuid())
  /// Stable across every republish and redelivery. This is what consumers
  /// deduplicate on, so it is generated once, here, and never regenerated.
  eventId       String    @unique @default(uuid())
  aggregateType String
  aggregateId   String
  type          NotificationType
  /// The partition key, denormalised so the relay never joins to find it.
  userId        String
  payload       Json
  createdAt     DateTime  @default(now())
  /// Null means unpublished. The relay's entire working set.
  publishedAt   DateTime?
  attempts      Int       @default(0)
  lastError     String?

  @@index([publishedAt, createdAt])
  @@map("outbox_events")
}

enum DeliveryChannel { EMAIL PUSH SMS }
enum DeliveryStatus  { PENDING SENT FAILED SUPPRESSED }

/// Which channels actually delivered, and what the provider said back.
///
/// KAFKA IS AT-LEAST-ONCE. A rebalance, a redeploy, or a consumer that dies
/// after sending and before committing its offset all produce a redelivery, and
/// redeliveries are normal traffic rather than an error case — exactly as they
/// are for Stripe webhooks. The unique constraint below is what stops one
/// becoming a second SMS to somebody's phone at 3am.
///
/// SUPPRESSED is a real outcome, not a failure: the recipient had this channel
/// off, or was inside quiet hours. Recorded rather than dropped, so "why did I
/// not get a text" has an answer.
model NotificationDelivery {
  id                String          @id @default(uuid())
  eventId           String
  channel           DeliveryChannel
  status            DeliveryStatus  @default(PENDING)
  /// A REFERENCE to the provider's message, never its content.
  providerMessageId String?
  attempts          Int             @default(0)
  lastError         String?
  createdAt         DateTime        @default(now())
  completedAt       DateTime?

  /// THE IDEMPOTENCY GUARD. Inserted before the provider is called, so a
  /// redelivery collides here and stops rather than sending twice.
  @@unique([eventId, channel])
  @@index([status, createdAt])
  @@map("notification_deliveries")
}

/// An explicit opt-in or opt-out. ABSENT MEANS "use the default for this type"
/// — see §6. Storing only the deviations keeps a new event type from needing a
/// backfill across every user before it can be sent at all.
model NotificationPreference {
  id      String           @id @default(uuid())
  userId  String
  user    User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type    NotificationType
  channel DeliveryChannel
  enabled Boolean

  @@unique([userId, type, channel])
  @@index([userId])
  @@map("notification_preferences")
}

/// Web Push, one row per browser profile — NOT per user. Somebody signed in on
/// a laptop and a phone has two, and both should ring.
model PushSubscription {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Unique because the browser regenerates it on resubscribe, and a stale
  /// duplicate would deliver the same notification twice to one device.
  endpoint   String   @unique
  p256dh     String
  auth       String
  userAgent  String?
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([userId])
  @@map("push_subscriptions")
}

/// Proof that whoever holds this account also holds this phone.
///
/// Mirrors EmailVerificationToken deliberately: hashed, single-use, short
/// expiry. Shorter than email's, because an SMS code is six digits and lands in
/// a notification shade rather than behind a login.
model PhoneVerification {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// E.164, normalised before storage.
  phone      String
  codeHash   String
  attempts   Int       @default(0)
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  consumedAt DateTime?

  @@index([userId])
  @@map("phone_verifications")
}
```

On `User`: `phone String?`, `phoneVerifiedAt DateTime?`, `smsConsentAt DateTime?`.

### Why `Address.phone` must not be reused

It is a delivery contact for a parcel. It is frequently the *recipient's* number
rather than the account holder's — gifts, deliveries to a workplace, an elderly
relative's landline — and it is typed into a checkout form with no verification
whatsoever.

Texting it would mean sending account notifications to a third party who never
consented and cannot unsubscribe. That is wrong on its own terms and unlawful
under most SMS consent regimes. The contact number needs its own field, its own
proof of possession, and its own recorded consent timestamp. Nothing is ever
sent to a number whose `phoneVerifiedAt` is null.

Same reasoning as [ADR 0006](../adr/0006-kyc-store-reference-not-document.md):
the cheap shortcut creates a liability far more expensive than the work it
avoided.

---

## 6. Channel policy

Defaults per event, overridable per user through `NotificationPreference`. This
table is the difference between notifications people trust and notifications
people mute.

| Event | Recipient | In-app | Email | Push | SMS |
| --- | --- | --- | --- | --- | --- |
| `SALE_MADE` | seller | ✓ | ✓ | ✓ | opt-in |
| `ORDER_SHIPPED` | buyer | ✓ | ✓ | ✓ | — |
| `ORDER_DELIVERED` | seller | ✓ | — | ✓ | — |
| `ORDER_UNFULFILLABLE` | buyer | ✓ | ✓ | ✓ | **on** |
| `REFUND_ISSUED` | buyer | ✓ | ✓ | ✓ | **on** |
| `REVIEW_RECEIVED` | seller | ✓ | — | ✓ | — |
| `IDENTITY_VERIFIED` | seller | ✓ | ✓ | ✓ | — |
| `IDENTITY_REJECTED` | seller | ✓ | ✓ | ✓ | — |
| `LISTING_REMOVED` | seller | ✓ | ✓ | ✓ | — |
| `ACCOUNT_SUSPENDED` | user | ✓ | ✓ | — | — |
| `REPORT_RESOLVED` | reporter | ✓ | — | ✓ | — |

The two unusual rows, and why:

**SMS defaults on for exactly two events.** Both are cases where money moved, or
where an item that was paid for is not coming. SMS costs money per message and
spends goodwill that cannot be earned back, so the bar is "this person needs to
know now, away from a screen" — which `REVIEW_RECEIVED` does not clear.

**`ACCOUNT_SUSPENDED` gets no push.** A suspended user cannot open the app, so a
push notification leads to a login screen that refuses them. Email leaves them
something to read and something to appeal against.

In-app is unconditional in every row: it is the ledger, and preferences govern
delivery, not the record.

**Quiet hours apply to SMS only**, by the recipient's timezone, deferring rather
than dropping. Email and push are silent by nature and do not need them.

---

## 7. Testing

The suite drives the real stack and mocks nothing, on the grounds that the bugs
worth catching live in the seams between the pieces. A broker is a seam, so it
should be tested — but adding one to every CI run would slow a ten-minute
pipeline and give fork pull requests one more piece of infrastructure to depend
on.

The codebase already solved this shape of problem twice, with the payment and
identity provider seams. Same answer:

```
NOTIFY_TRANSPORT=inline   # default. The relay hands events straight to the
                          # consumer functions in-process. Same consumer code,
                          # no broker. What the suite and CI run.

NOTIFY_TRANSPORT=kafka    # the real transport. Local, and everywhere real.
```

Consumers are plain `async (event) => …` functions under both, so `inline`
exercises preference resolution, the idempotency guard, template rendering, and
the provider seams for real. Only the transport is absent.

What only a broker can demonstrate goes in one suite, gated on `KAFKA_BROKERS`
the way `ratelimit` and `cache` are gated on `REDIS_URL`:

- an offset is committed only **after** the ledger row is written, so a consumer
  killed between the two redelivers and deduplicates rather than losing the send
- a consumer group rebalances without duplicate delivery
- each rung of the retry ladder fires on a transient failure, and a permanent
  failure skips the ladder entirely
- a message that exhausts the ladder arrives in the DLQ with its failure history

Following the precedent in `tests/README.md`, the gated sections **skip loudly**
rather than passing quietly when the broker is absent.

---

## 8. Phases

Each phase ships on its own and leaves the system working. No phase depends on a
later one.

### Phase 0 — Decide, and write it down

Four ADRs, no code:

| ADR | Decision |
| --- | --- |
| 0024 | Transactional outbox, not dual writes |
| 0025 | Kafka topics, `userId` as partition key, retry ladder over in-process retry |
| 0026 | Delivery idempotency: the ledger, and the unique constraint that enforces it |
| 0027 | Notification consent: verified phone, per-type preferences, unsubscribe |

The ADRs in this repository are load-bearing — they carry the reasoning the code
cannot. Writing them first is how the design gets argued before it gets built,
and §2, §4, and §5 above are already most of their content.

**Exit:** four records merged, each with its rejected alternatives.

### Phase 1 — Outbox, relay, broker

- `OutboxEvent` model and migration.
- `lib/outbox.ts` — one function, `enqueue(tx, event)`, taking a transaction
  client so it cannot be called outside one.
- `notify()` and `notifyMany()` rewritten to wrap the notification insert and
  the outbox insert in one `prisma.$transaction`. **All eleven call sites stay
  untouched** — that is what the `events.*` layer is for.
- `lib/relay.ts` — polls with `SELECT … FOR UPDATE SKIP LOCKED`. `FOR UPDATE` is
  the same lock discipline as `lib/reservations.ts`; `SKIP LOCKED` is what lets
  N replicas poll one table without double-publishing, since a row already
  claimed by another relay is passed over instead of waited on. Shaped like the
  two existing sweepers (`startOrderSweeper`, `startReservationSweeper`), which
  have the same "recover state nothing in the request path can reach" job.
- Kafka in `docker-compose.yml` in **KRaft mode — no ZooKeeper**, behind a
  `messaging` profile so a plain `docker compose up` stays lean.
- Two new Dockerfile targets, `relay` and `worker`, per
  [ADR 0023](../adr/0023-one-dockerfile-many-targets.md). Separate processes, so
  they scale and fail independently of the API and map onto Kubernetes
  Deployments later.
- A consumer that only logs.

**Exit:** an event provably reaches a consumer exactly once, with the relay
SIGKILLed mid-batch.

### Phase 2 — Email

- `NotificationDelivery` and `NotificationPreference` models.
- Preference resolution: explicit row, else the §6 default.
- Email worker: claim in the ledger → render → send through the existing
  `lib/mailer.ts`, unchanged → record the provider id.
- Templates per type, plain text and HTML.
- Signed unsubscribe tokens; one-click unsubscribe headers.
- `/account/notifications` gains a preferences panel.

**Exit:** the promise in the `lib/notifications.ts` header is discharged — mail
goes out, reading from the notification table rather than replacing it, with the
preferences and unsubscribe path that were the actual blocker all along.

### Phase 3 — Web Push

Web Push over FCM/APNs because there is no mobile app: no store, no native
build, and it works in the browser that is already open.

- VAPID keypair; `assertPushConfigured()` at startup beside the existing checks.
- `PushSubscription` model, subscribe and unsubscribe endpoints.
- Service worker in the Next app; permission requested **on a user action**,
  never on page load.
- `410 Gone` and `404` from the push service delete the subscription — that is
  the protocol saying the browser is gone, not a transient failure.

**Exit:** one notification reaches two devices signed in as the same user, and a
revoked subscription cleans itself up.

### Phase 4 — SMS

- `phone`, `phoneVerifiedAt`, `smsConsentAt` on `User`; `PhoneVerification`.
- E.164 normalisation on input; a code sent and verified before the number is
  usable; rate-limited through the existing `lib/rateLimit.ts` — send *and*
  verify, both, because an unlimited verify endpoint is a six-digit oracle, the
  same reasoning that puts a limit on `admin-stepup`.
- Provider seam, `SMS_PROVIDER=stub|twilio`, mirroring payments and identity, so
  CI never sends a message and never needs a secret.
- Quiet hours; a hard per-user daily cap; permanent failures never retried.

**Exit:** SMS to verified numbers only, never outside quiet hours, never twice
for one event, and never at all in CI.

### Phase 5 — Prove the scaling claim

This repository does not assert performance, it measures it — `cache-demo.ts`
counts Postgres's own `xact_commit` rather than trusting an app-side counter,
and `ratelimit-demo.ts` shows the limits coming apart before it shows them
holding. Kafka is being introduced *for* scale, so the same standard applies.

- `scripts/notification-throughput-demo.ts` — 10k events; end-to-end p50/p95 lag
  at 1, 3, 6, and 15 consumers per group. The honest result includes the
  **flattening at 12**, where consumers exceed partitions and the extras idle.
- `scripts/consumer-failure-demo.ts` — SIGKILL a consumer mid-batch; count
  duplicate deliveries in the ledger (must be 0) and lost events (must be 0).
- `scripts/dlq-replay.ts` — an operator tool, not a demo. Replay a DLQ partition
  once the cause is fixed.

**Exit:** numbers in the README, in the existing style, including the ones that
are unflattering.

### Phase 6 — Operations

- Consumer lag at `/health/lag`; an alert on DLQ depth.
- The delivery ledger surfaced in the admin panel — "did the buyer actually get
  the refund email?" is a real support question with no current answer.
- Retention and cleanup for `outbox_events`, whose published rows otherwise grow
  without bound.

**Exit:** a moderator can answer a delivery question without a database console.

---

## 9. What this costs, and what it does not do

**Three more processes to run** — broker, relay, worker — and one more stateful
system to operate. Kafka being down becomes a thing that happens, and it needs a
defined answer rather than an assumed one: notifications queue in the outbox and
drain when it returns. That is why the outbox is load-bearing rather than
ceremony.

**Kafka is oversized for one broker on Compose, and ADR 0025 should say so out
loud.** At this traffic a table and a worker would do. It earns its place on the
fan-out, on independent consumer scaling, and on replay — and the outbox means
the transport could be swapped later without touching a call site. An ADR that
pretended the choice was obvious would be exactly the kind of document
`docs/README.md` warns about.

**No orchestration.** Nothing here promotes a broker, rebalances after a node
loss, or replaces a dead worker. That is an orchestrator's job, and it is the
same gap already recorded for the Postgres standby in
[ADR 0020](../adr/0020-replication-and-backups.md).

**Exactly-once is not claimed.** Kafka is at-least-once and the ledger makes
delivery idempotent, which is a different and weaker guarantee than exactly-once
end to end. A provider that accepts a message and then fails to return an id can
still produce a duplicate at the far end. This is at-least-once sending with a
very small duplicate window, and saying otherwise would be a lie.

**Ordering holds per user, not globally.** Two events for one person keep their
order. Two events for two people have no relative order at all, and nothing
should be built that assumes one.

---

## 10. Open questions

1. **Debezium instead of a polling relay?** CDC off the WAL — which is already
   being archived for [ADR 0020](../adr/0020-replication-and-backups.md) — is
   the more rigorous answer, and removes the polling interval from the latency
   budget. It also adds Kafka Connect, a large operational surface for a system
   that already has two sweepers doing this shape of work. **Recommendation:
   polling relay in Phase 1, Debezium recorded as an upgrade path in ADR 0024.**
2. **Kafka client.** `@confluentinc/kafka-javascript` (librdkafka-based,
   officially supported, KafkaJS-compatible API) over `kafkajs`. Verify current
   maintenance status before committing — this landscape moves.
3. **SMS provider.** Twilio (best DX, highest cost), AWS SNS (cheapest, worst
   DX), or stub-only with the seam in place and a real provider deferred.
4. **Does the relay live in the API process or its own?** Its own is proposed
   above, for independent scaling and a separate failure domain. In-process
   would match the existing sweepers and add no container. The tradeoff is real
   and worth ten minutes before Phase 1 starts.
