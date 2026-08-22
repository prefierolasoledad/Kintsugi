# Kintsugi

金継ぎ — the Japanese art of repairing broken pottery with gold, treating the
break as part of the object's history instead of something to hide.

Kintsugi is a marketplace for secondhand furniture, clothing, and objects —
built on an event-driven order pipeline that's designed to fail on purpose,
so that the reliability claims behind it (idempotency, retries, backpressure,
partition tolerance) are things that get demonstrated under real chaos
testing, not just listed on a slide.

## Structure

This is a single repo with the frontend and backend kept as separate,
independently runnable apps:

```
Kintsugi/
├── frontend/   Next.js marketplace site (customer-facing)
└── backend/    Node.js/Express API
```

A third surface — an admin-gated internal dashboard for watching chaos-test
runs and pipeline health in real time — is planned but not part of either app
above; see [Status](#status).

## Status

**Frontend**
- [x] Marketplace homepage — hero, recently-listed cards, categories, brand
      philosophy, seller flow
- [x] Signup / login pages, session-aware nav
- [ ] Category/browse pages
- [ ] Product detail page
- [ ] Cart / checkout

**Backend**
- [x] Express skeleton with a `/health` endpoint
- [x] Auth — unified account (buyer and seller are the same account; selling
      is a capability, not a separate account type), email/password,
      Postgres via Prisma, JWT session in an httpOnly cookie
- [ ] `order-service` (Postgres, range-partitioned `orders` table)
- [ ] Kafka backbone (`order.created`, `payment.completed` / `payment.failed`)
- [ ] `payment-service` (simulated payment, publishes back to Kafka)
- [ ] Idempotent consumers (Redis-backed dedupe by event ID)
- [ ] Dead-letter queues + retry with backoff
- [ ] Rate limiting / backpressure at the gateway

**Ops dashboard**
- [ ] Admin-gated, server-rendered from the backend (not the customer frontend)
- [ ] Live chaos-test run log (what was killed, expected vs. actual outcome)
- [ ] Consumer lag / DLQ depth, backed by Prometheus + Grafana

## Running locally

**Database** (Postgres via Docker):
```
docker compose up -d
```

**Backend** (Express, [http://localhost:4000](http://localhost:4000)):
```
cd backend
npm install
cp .env.example .env   # first time only
npx prisma migrate dev
npm run dev
```

**Frontend** (Next.js, [http://localhost:3000](http://localhost:3000)):
```
cd frontend
npm install
npm run dev
```

## Stack

Next.js · TypeScript · Tailwind CSS · Node.js/Express · PostgreSQL · Prisma ·
Kafka · Redis · Prometheus/Grafana
