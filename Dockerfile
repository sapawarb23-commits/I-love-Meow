# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# I Love Meow — production image
#
# Multi-stage build:
#   1. "deps"    installs production node_modules only (npm ci, cached layer)
#   2. "runtime" copies app source + deps into a slim, non-root final image
#
# The app itself has zero required runtime dependencies (Node's built-in
# http/sqlite modules), but this Dockerfile still runs `npm ci` so that the
# optional production integrations (Redis, Sentry, Prometheus client,
# Cloudinary signing) declared in package.json's "optionalDependencies" are
# installed when available, without breaking the build if any single one
# fails to install.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.11-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Alpine needs build tools for any native addons pulled in transitively.
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
RUN mkdir -p /app/data && chown -R node:node /app

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json* ./
COPY --chown=node:node server.js db.js auth.js validate.js security.js games.js breeds.js ./
COPY --chown=node:node health.js logger.js metrics.js redis.js rateLimit.js sentry.js cloudinary.js ./
COPY --chown=node:node public ./public

# SQLite database file lives on a mounted volume in production — see
# docker-compose.yml (the `db-data` volume mounted at /app/data).


USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
