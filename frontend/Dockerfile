# syntax=docker/dockerfile:1

# The Next.js frontend, which is also the BFF.
#
# Every browser request lands here; the Express API is never called directly
# from a browser (ADR 0002). So this container needs to reach the API over the
# network, and BACKEND_URL is read at RUNTIME rather than baked in at build —
# which means one image works in compose, in Kubernetes, and locally.

# ------------------------------------------------------------------
# Dependencies, cached on the lockfile alone.
# ------------------------------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


# ------------------------------------------------------------------
# Build.
# ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .

# `output: "standalone"` in next.config.ts traces the files the server actually
# imports into .next/standalone — about 41MB, against the whole node_modules
# tree otherwise.
RUN npm run build


# ------------------------------------------------------------------
# Runtime.
# ------------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Three copies, and all three are required. The standalone output does NOT
# include static assets or public files — Next expects them placed alongside it,
# and leaving either out gives a site that renders with no CSS and no images.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node

# Standalone's server binds to the HOSTNAME env var and defaults to localhost,
# which inside a container accepts nothing from outside it. 0.0.0.0 is required,
# and forgetting it produces a container that looks healthy and refuses every
# connection.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js sits at the root of the standalone output, not in .next.
CMD ["node", "server.js"]
