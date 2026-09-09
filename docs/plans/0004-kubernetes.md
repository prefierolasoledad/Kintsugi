# Plan 0004 — Running it on Kubernetes

- **Status:** Phase 0 landed 2026-09-09. Phases 1-5 are **not built**.
- **Written:** 2026-09-09
- **Produces:** ADR 0032

> **This is a plan, not a description.** There is no `k8s/` directory yet. A
> reader who mistakes this for documentation will go looking for manifests that
> have not been written.

---

## 1. Where this stands today

Compose runs the whole system in one command and cannot do two things:
promote the standby when the primary dies, and run anything on a schedule.

The images are already shaped for an orchestrator —
[ADR 0023](../adr/0023-one-dockerfile-many-targets.md) made five single-process
targets and kept migrations out of API startup specifically so they could be a
Job. What is missing is the manifests, and one entrypoint.

## 2. What is being built

```
k8s/
  base/            postgres (CNPG), redis, minio, api, web, migrate Job,
                   the payout CronJob, one Ingress to web
  overlays/
    local/         kind: NodePort instead of Ingress, 1 replica, MinIO
    messaging/     kafka + relay + worker, NOTIFY_TRANSPORT=kafka
```

Deliberately **not** built: a CronJob per sweeper. The five recovery sweepers
stay in the API process, for the three reasons ADR 0032 gives — chiefly that N
replicas currently divide the work by conditional `UPDATE`, and one CronJob
would serialise it.

## 3. Phases

### ~~Phase 0 — Decide, and write it down~~ · landed 2026-09-09

- ADR 0032: an operator for Postgres, plain kustomize for everything else; the
  sweepers stay in-process; one CronJob; no Ingress for the API; Secrets with no
  defaults.

**Exit:** one record naming its rejected alternatives.

**Met.** The alternative worth arguing about was "Kubernetes has CronJobs, so
move the timers into CronJobs", and most of the record exists to explain why
that is a regression rather than a tidy-up.

### Phase 1 — The entrypoint a CronJob can call

- `src/jobs.ts` compiled to `dist/jobs.js`, taking a job name: `payouts:pending`
  to start, and the other exports registered beside it so the list is one place.
- Exits non-zero on failure, so a Job's status means something.
- Logs one line of counts, so `kubectl logs` answers "did it do anything".

**Exit:** `node dist/jobs.js payouts:pending` settles a stranded payout and
exits 0; an unknown job name exits 2 rather than silently succeeding.

### Phase 2 — The base manifests

- Deployments for `api` and `web`; ClusterIP Services for both; one Ingress to
  `web` only.
- `migrate` as a Job, with the image's `api-build` target.
- Secrets and ConfigMaps split on the line ADR 0032 draws: no credential has a
  default, and a missing one fails the pod.
- Probes: `/health` for both tiers, with the API's `startupProbe` generous
  enough for a cold Prisma client.

**Exit:** `kubectl apply -k k8s/overlays/local` on kind brings the stack up, the
migrate Job completes, and the storefront serves a seeded listing.

### Phase 3 — Postgres via CloudNativePG

- A `Cluster` with `instances: 3` and a `barmanObjectStore` pointing at the same
  bucket Compose archives to, with `retentionPolicy` — the thing
  [ADR 0020](../adr/0020-replication-and-backups.md) said would replace
  `archive_command` and the hand-rolled standby.
- The application connects to the `-rw` service only. Nothing uses `-ro`.

**Exit:** deleting the primary pod produces a promoted replica and an API that
reconnects, demonstrated rather than asserted.

### Phase 4 — The one CronJob

- `payouts:pending` every 15 minutes, `concurrencyPolicy: Forbid`,
  `successfulJobsHistoryLimit` low enough to read.

**Exit:** a payout stranded by a killed process is settled by the CronJob within
one interval, and running two at once produces one transfer.

### Phase 5 — Prove it, and correct the record

- A demo script in the style of the others: kill the primary, watch failover,
  strand a payout, watch the CronJob settle it.
- Rewrite the five places that say "a `setInterval` in a web process is a worse
  cron than cron" so they read as the justification for this design rather than
  an apology for its absence. One of them —
  [`sellerPayouts.ts`](../../backend/src/routes/sellerPayouts.ts) — is about
  payouts being seller-triggered by choice and should not change at all.

**Exit:** the README describes what runs on a schedule and what does not, and is
accurate about both.

## 4. What this does not do

**No Helm chart.** Kustomize overlays, for the reason in ADR 0032.

**No Strimzi.** One broker does not need an operator, and the messaging overlay
is optional anyway.

**No horizontal pod autoscaling.** It needs load data this project does not
have. The measured figures in
[plan 0001 §5](0001-multi-channel-notifications.md) are consumer throughput, not
request throughput.

**No service mesh, no cert-manager, no external-dns.** Each is a real thing a
real cluster wants and none of them is this application's problem.

**No production cluster.** Everything is verified on kind. A manifest that
applies cleanly locally can still be wrong about a cloud load balancer, and
saying otherwise would be the kind of claim this repository avoids.

## 5. Open questions

1. **Liveness for the relay and the worker.** Neither serves HTTP. ADR 0023
   suggested consumer lag at `/health/lag`; that endpoint is on the API, so
   either the workers grow a port or the probe becomes an `exec` against their
   own lag. Unsolved, and only affects the messaging overlay.
2. **Where the Stripe webhook lands.** It is the one inbound path that is not a
   browser, and ADR 0032 gives the API no Ingress. Either the Ingress grows one
   path that bypasses the BFF, or Next proxies webhooks too — which means a
   signature-verified body passing through a second process.
3. **Whether MinIO belongs in-cluster at all.** It is right for kind. In a cloud
   it is a bucket, and the only reason to run it is to avoid depending on one.
