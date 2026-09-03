# 23. An all-in-one image, alongside the split one

- **Status:** Accepted
- **Recorded:** 2026-09-03

## Context

Running Kintsugi means running two application containers — the Express API and
the Next storefront, which is also the BFF ([ADR 0002](0002-bff-proxy.md)) —
plus Postgres, Redis and MinIO. That is the right shape, and it is five things
to bring up before anything is visible.

For a demo, or a machine where the point is *see the application*, that overhead
is the whole experience. There is also no live deployment for this project and
there will not be one: it is shown by video and by running it locally, so "one
command, one port, everything works" has real value.

## Decision

Add a second image at `./Dockerfile` that runs the API and the storefront in one
container, and keep `backend/Dockerfile` and `frontend/Dockerfile` as the real
ones.

```
docker compose --profile allinone up
```

Behind a profile because it is an **alternative** to `api` + `web`, not an
addition — running both would collide on ports 3000 and 4000.

### The datastores stay separate

Postgres, Redis and MinIO remain their own services. Bundling Postgres into an
application image is a different and much worse idea: its data would live and
die with the container, so every rebuild would destroy the database. The
distinction being drawn is between *processes that serve requests* and *state*,
not between "few containers" and "many".

### A supervisor, not `node a & node b`

The shell one-liner gets three things wrong, and each only shows up once
something else has gone wrong:

- **Signals go to the wrong place.** PID 1 would be the shell, so `docker stop`'s
  SIGTERM never reaches the Node processes and both are killed by the 10-second
  SIGKILL — every single time.
- **A half-dead container stays "up".** If one process exits the other keeps
  serving, the healthcheck passes on whichever survived, and nothing restarts
  anything. A container that answers its healthcheck while serving 502s is worse
  than a dead one.
- **The exit code is the shell's**, so a crash is indistinguishable from a clean
  stop.

`docker/allinone/supervisor.mjs` handles all three explicitly: it forwards
SIGTERM and SIGINT to both children, exits the container when *either* child
exits, and prefixes each line of output with `[api]` or `[web]` so two processes
sharing stdout stay readable.

Written in Node rather than bash because Node is the one interpreter this image
is guaranteed to have — and, as it turned out, the slim base has neither `pgrep`
nor `kill`, which would have been discovered at the worst moment.

### The storefront reaches the API over loopback

`BACKEND_URL=http://127.0.0.1:4000`, set by the supervisor. This is the one line
that makes the image work with no network at all. The BFF reads `BACKEND_URL` at
runtime rather than at build time, which is what allows one frontend build to
serve compose, Kubernetes and this.

### The healthcheck checks both

Checking only the storefront would report healthy while every request through it
502s, which is precisely the failure the supervisor exists to prevent.

## Consequences

**The two tiers can no longer be scaled independently.** This is the real cost
and it is worth being blunt about: moving rate limits and the cache to Redis
([ADR 0018](0018-redis-for-shared-ephemeral-state.md),
[ADR 0019](0019-cache-tiering-rule.md)), the refresh race to Postgres
([ADR 0021](0021-refresh-race-grace-window.md)) and uploads to object storage
([ADR 0022](0022-object-storage-for-uploads.md)) was all so that each tier could
run several replicas. This image gives that up. It is a convenience for
demonstrating the application, not the deployment shape, and the split services
remain the default for exactly that reason.

**Verified, rather than assumed to work.** Both supervisor guarantees were tested
by hand:

| Checked | Result |
| --- | --- |
| `docker compose stop` | clean shutdown in **1s**, exit 0 — well inside Docker's 10s SIGKILL |
| One child killed (`SIGTERM` to the web process) | `web exited (code 143) — stopping the container`, API stopped, restart policy recovered it |
| Storefront, API health, BFF proxy over loopback | 200, 200, signup through :3000 returns 201 |
| The full API suite against the single container | **583 assertions, 0 failed** |

That last row also closed a gap: every regression until then had run against a
frontend started *outside* Docker, so the `BACKEND_URL` path between the two
containers had never actually been exercised.

**A root build context, and therefore a root `.dockerignore`.** The context is
the whole repository rather than one app directory, so without it both
`node_modules` trees are uploaded to the daemon on every build and the layer
cache is invalidated by files the image never opens.

**Two images to keep in step.** The all-in-one duplicates the build logic of
both Dockerfiles, so a change to either needs making twice. Accepted knowingly:
the alternative is a shared base image, which couples the two real images to
each other in order to serve the convenience one.

The dependency prune below is the first thing that had to be applied twice, and
both copies carry a comment saying so.

**`--omit=dev` does not give a production dependency tree.** Found while looking
at why the API image was 950MB. `@prisma/client` declares the Prisma CLI and
TypeScript as *optional peer* dependencies:

```
peerDependencies:     { "prisma": "*", "typescript": ">=5.4.0" }
peerDependenciesMeta: { "prisma": {"optional": true}, "typescript": {"optional": true} }
```

npm installs optional peers regardless and marks them `devOptional` in the
lockfile — reachable both as a devDependency and as an optional peer — so
`--omit=dev` keeps them. The runtime image was carrying the CLI, the TypeScript
compiler, and Prisma Studio's entire React UI (`react-dom`, `@radix-ui`,
`@visx`, `elkjs`), plus `effect` and `@electric-sql`. **204MB of a 470MB
"production" tree.**

`--omit=optional` removes them and also removes `@img/sharp-linux-x64`, so image
processing throws on the first upload — measured, not guessed. It drops about
ninety other packages too, any of which might be needed on a path the tests do
not reach.

So the fix deletes exactly what the CLI drags in, in the same `RUN` as the
install — layers are additive, and deleting in a later step makes an image
bigger rather than smaller. `node_modules` went **470MB → 266MB** and the image
**950MB → 679MB**, with 583 assertions passing against the result.

A comment in `backend/Dockerfile` had claimed the runtime image "never contains
typescript, tsx, the Prisma CLI, or Playwright". Two of those four were wrong.

## Alternatives considered

**A `docker-compose.yml` and nothing else.** What existed. Rejected only for the
demo case — five services is the correct shape and a poor first impression.

**Bundle Postgres, Redis and MinIO too.** A genuinely single container. Rejected:
the data would live and die with the container, which makes every rebuild a data
loss event and every demo start from an empty catalogue. The line is drawn at
state, deliberately.

**`s6-overlay` or `supervisord`.** Purpose-built, battle-tested, and the usual
answer for multi-process containers. Rejected because both mean another
system-level dependency in the image to do what forty lines of Node already do
correctly — and because a supervisor whose behaviour is written down in the
repository is easier to reason about than one whose configuration is.

**Run the API as a child of the Next server.** No supervisor at all. Rejected:
it makes the storefront responsible for the API's lifecycle, so a Next restart
takes the API with it and a crash in either has no clean recovery path. The two
are peers.
