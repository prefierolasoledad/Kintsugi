# syntax=docker/dockerfile:1

# The whole application in one image: the Express API and the Next storefront,
# run side by side by a small supervisor.
#
#   docker build -t kintsugi .
#   docker compose --profile allinone up
#
# WHAT THIS IS FOR
# Running Kintsugi from a single image, for a demo or on a machine where
# orchestrating several containers is not worth the trouble. One `docker run`,
# one port, everything works.
#
# WHAT IT IS NOT
# The deployment shape. Two tiers in one container cannot be scaled
# independently — the whole point of moving rate limits and the cache to Redis
# (ADR 0018, ADR 0019), the refresh race to Postgres (ADR 0021) and uploads to
# object storage (ADR 0022) was that each tier can run several replicas. This
# image gives that up on purpose, in exchange for being trivial to run.
#
# backend/Dockerfile and frontend/Dockerfile remain the real ones, and are what
# docker-compose.yml and the Kubernetes manifests use.
#
# See docs/adr/0023-all-in-one-image.md

# ==================================================================
# Backend
# ==================================================================

FROM node:24-slim AS api-deps
WORKDIR /api
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM api-deps AS api-build
WORKDIR /api
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts backend/tsconfig.json ./

# Generated inside the image, never copied from the host: the client is built
# for a platform. The dummy URL exists because prisma.config.ts declares a
# datasource and the CLI insists one is present — nothing connects here.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

COPY backend/src ./src
RUN npm run build

# Separate from api-deps so the runtime never carries tsx or Playwright.
#
# The prune matters as much as `--omit=dev` here: `@prisma/client` lists the
# Prisma CLI and TypeScript as OPTIONAL PEERS, npm installs optional peers
# anyway, and the result is 204MB of CLI, compiler and Prisma Studio's React UI
# in a production tree. `--omit=optional` would remove them and also break sharp.
# The reasoning is written out in full in backend/Dockerfile — keep the two
# lists in step.
#
# Same `RUN` as the install: layers are additive, so deleting in a later step
# makes the image bigger rather than smaller.
FROM node:24-slim AS api-prod-deps
WORKDIR /api
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev \
 && rm -rf \
      node_modules/prisma \
      node_modules/typescript \
      node_modules/@prisma/config \
      node_modules/@prisma/dev \
      node_modules/@prisma/studio-core \
      node_modules/@electric-sql \
      node_modules/@radix-ui \
      node_modules/@visx \
      node_modules/react \
      node_modules/react-dom \
      node_modules/scheduler \
      node_modules/effect \
      node_modules/elkjs \
 && node -e "require('@prisma/adapter-pg'); require('sharp'); console.log('runtime deps still resolve after prune')"

# ==================================================================
# Frontend
# ==================================================================

FROM node:24-slim AS web-deps
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM web-deps AS web-build
WORKDIR /web
COPY frontend/ ./

# `output: "standalone"` traces the files the server actually imports — about
# 41MB, against the whole node_modules tree otherwise.
#
# BACKEND_URL is a build-time placeholder only. The BFF reads it at runtime,
# where the supervisor sets it to this container's own loopback address.
RUN BACKEND_URL="http://127.0.0.1:4000" npm run build

# ==================================================================
# Runtime
# ==================================================================

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Ownership is set BY the COPY, not by a chown afterwards. `RUN chown -R` looks
# equivalent and rewrites every file's metadata, so the layer it creates holds a
# second complete copy of node_modules — it cost this project ~455MB once.
COPY --from=api-prod-deps --chown=node:node /api/node_modules ./api/node_modules
COPY --from=api-build     --chown=node:node /api/dist         ./api/dist
COPY --chown=node:node backend/package.json ./api/package.json

# Three copies, and all three are required. The standalone output does NOT
# include static assets or public files — Next expects them alongside it, and
# leaving either out gives a site that renders with no CSS and no images.
COPY --from=web-build --chown=node:node /web/.next/standalone ./web/
COPY --from=web-build --chown=node:node /web/.next/static     ./web/.next/static
COPY --from=web-build --chown=node:node /web/public           ./web/public

COPY --chown=node:node docker/allinone/supervisor.mjs ./supervisor.mjs

# Only used on the local-disk storage driver; with object storage nothing is
# written here. Empty, so this layer is bytes rather than megabytes.
RUN mkdir -p /app/api/uploads && chown node:node /app/api/uploads

# Never root. Neither process needs to modify the image it runs from.
USER node

# 3000 is the only one a browser needs — every API call goes through the BFF
# (ADR 0002). 4000 is published anyway so Stripe webhooks and `npm test` can
# reach the API directly.
EXPOSE 3000 4000

# Both, because either being down means the container is not serving. Checking
# only the storefront would report healthy while every request through it 502s.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:'+(process.env.PORT||3000)),fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here — see the `migrate` service in
# docker-compose.yml. Several replicas racing `migrate deploy` on startup is a
# problem worth not having, and a one-shot job maps onto a Kubernetes Job.
CMD ["node", "supervisor.mjs"]
