# syntax=docker/dockerfile:1

# The Express API.
#
# WHY DEBIAN SLIM AND NOT ALPINE
# `sharp` is a production dependency — every seller photo is re-encoded through
# it to strip EXIF. It ships prebuilt binaries per platform, and the musl builds
# Alpine needs are the single most common source of "works locally, segfaults in
# the container". Roughly 70MB of image is a fair price for removing a class of
# failure that only shows up at runtime.
#
# Prisma helps here: this project uses driver adapters (@prisma/adapter-pg), so
# there is no native query engine to match against the base image at all.

# ------------------------------------------------------------------
# Dependencies. Its own stage so it is cached on the lockfile alone —
# editing a route must not reinstall node_modules.
# ------------------------------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


# ------------------------------------------------------------------
# Build. Also the image that runs migrations — it is the only stage with
# the Prisma CLI, the schema, and the migration history.
# ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./

# Generated inside the image, never copied from the host: the client is built
# for a platform, and .dockerignore excludes src/generated for that reason.
#
# The dummy URL is needed because prisma.config.ts declares a datasource url and
# the CLI insists on one being present. Nothing connects during generate — this
# value is never used to reach a database.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

COPY src ./src
RUN npm run build


# ------------------------------------------------------------------
# Production dependencies only.
#
# Separate from `deps` so the runtime image never contains tsx or Playwright —
# the latter is around 400MB installed and exists purely for the browser suites.
#
# `--omit=dev` IS NOT ENOUGH, which took measuring to notice.
#
# `@prisma/client` declares the Prisma CLI and TypeScript as OPTIONAL PEER
# dependencies:
#
#   peerDependencies:     { "prisma": "*", "typescript": ">=5.4.0" }
#   peerDependenciesMeta: { "prisma": {"optional": true}, ... }
#
# npm installs optional peers anyway, and marks them `devOptional` in the
# lockfile — reachable both as a devDependency and as an optional peer. So
# `--omit=dev` keeps them, and a production image ends up carrying the CLI, the
# TypeScript compiler, and Prisma Studio's entire React UI. Measured: 470MB of
# "production" dependencies, of which 204MB is that.
#
# `--omit=optional` does drop them, and also drops sharp's platform binaries —
# `@img/sharp-linux-x64` — so image processing throws on the first upload. It
# removes about ninety other packages too, any of which might be needed on a
# path the tests do not reach. Rejected as a blunt instrument.
#
# So: delete exactly what the CLI drags in, and nothing else. The list is
# hand-maintained, which is the honest cost; every entry is here because
# `npm ls` traced it to one of the four Prisma dev packages above it.
#
# IN THE SAME `RUN` AS THE INSTALL, deliberately. A separate layer would delete
# the files from the filesystem and leave them in the image — layers are
# additive, so removing something in a later step makes the image bigger, not
# smaller.
# ------------------------------------------------------------------
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
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


# ------------------------------------------------------------------
# Runtime.
# ------------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Ownership is set BY the COPY, not by a chown afterwards.
#
# `RUN chown -R node:node /app` looks equivalent and costs ~455MB: chown
# rewrites every file's metadata, so the layer it creates contains a second
# complete copy of node_modules. --chown does it as the files land.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Seller uploads. Local disk is a known limitation — it does not survive a
# replacement container and is not shared between replicas, which is why
# lib/storage.ts is written behind a seam. Mounted as a volume in compose so at
# least a restart does not lose them.
#
# chown here is fine: the directory is empty, so the layer is bytes not
# megabytes.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# Never root. A process that only needs to read its own code and write one
# directory has no business being able to modify the image.
USER node

EXPOSE 4000

# Uses the app's own /health endpoint. Written with node's fetch rather than
# curl, which slim does not ship — installing a package purely to poll yourself
# is a poor trade.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here. See the `migrate` service in docker-compose.yml:
# several replicas racing `migrate deploy` on startup is a problem worth not
# having, and a one-shot job maps directly onto a Kubernetes Job later.
CMD ["node", "dist/index.js"]
