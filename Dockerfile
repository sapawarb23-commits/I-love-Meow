# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# I Love Meow — production image
#
# Multi-stage build:
#   1. "deps"    installs production node_modules only (npm ci, cached layer)
#   2. "runtime" copies app source + deps into a slim, non-root final image
#
# Persistence uses the `sqlite3` npm package (stable, ships prebuilt
# binaries for linux/x64 and linux/arm64 — no node:sqlite, no native
# compilation needed on Railway/Docker/Linux in the common case). This
# Dockerfile still runs `npm ci` so that the optional production
# integrations (Redis, Sentry, Prometheus client, Cloudinary signing)
# declared in package.json's "optionalDependencies" are installed when
# available, without breaking the build if any single one fails to install.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.11-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Alpine needs build tools in case any dependency (or its prebuilt-binary
# fallback path) needs to compile from source on an unusual platform/arch.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
# npm ci if a lockfile exists (reproducible), else npm install.
# --omit=dev keeps devDependencies (linters, etc.) out of the image.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Non-root user (alpine node images ship a "node" user/group already).
# db.js also creates this directory itself at startup if it's missing (so
# a fresh volume mount, or a fresh Railway deploy with no prior filesystem
# state, still works) — this just ensures correct ownership up front.
RUN mkdir -p /app/data && chown -R node:node /app

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json* ./
COPY --chown=node:node server.js db.js auth.js validate.js security.js games.js breeds.js ./
COPY --chown=node:node health.js logger.js metrics.js redis.js rateLimit.js sentry.js cloudinary.js ./
COPY --chown=node:node public ./public

# No VOLUME instruction here on purpose: Railway (and most single-instance
# PaaS deploys) don't provide durable anonymous volumes the way plain
# Docker does, and an unmounted VOLUME can mask permission issues instead
# of surfacing them. For durable storage on your own Docker host, mount a
# named volume at /app/data via docker-compose.yml (see the `db-data`
# volume there) or your platform's persistent-disk feature — no Dockerfile
# change needed either way, since db.js creates /app/data automatically.

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
