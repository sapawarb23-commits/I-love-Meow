# Production checklist

Go through this before pointing real users at the app. Items link to the
file/mechanism in this repo that handles them, or explain what you still
need to configure yourself (mostly: your own accounts/secrets — nothing in
this repo can fabricate those).

## Secrets & configuration
- [ ] `SESSION_SECRET` set to a real random value (`.env.example` has the
      generator command) — not the `dev-secret-change-me-in-production`
      default in `auth.js`.
- [ ] `.env` is not committed (`.gitignore` already excludes it — double
      check `git status` before your first push).
- [ ] `TRUST_PROXY=1` set **only if** nginx (or another reverse proxy) sits
      in front of Node — otherwise rate limiting can be bypassed by a
      spoofed `X-Forwarded-For` header (`server.js`'s `clientIp()`).
- [ ] `NODE_ENV=production` set — flips logging to structured JSON
      (`logger.js`) and disables Node's dev-mode overhead.

## Database
- [ ] `data/` is on a **persistent volume** (`docker-compose.yml`'s
      `db-data` volume, or your host's persistent disk) — without this,
      every deploy wipes user data.
- [ ] `scripts/backup.sh` is scheduled (cron, or your host's scheduled
      jobs feature) and tested end-to-end at least once — a backup you've
      never restored from isn't a backup.
- [ ] `BACKUP_S3_BUCKET` configured for offsite backups, so a lost/corrupted
      disk doesn't also mean lost backups.
- [ ] You've read the SQLite-at-scale note in `DEPLOYMENT.md` — fine for
      one app instance; migrate to Postgres before running multiple
      instances against the same data.

## Domain & TLS
- [ ] DNS points at your host (`DEPLOYMENT.md` → Domain & DNS checklist).
- [ ] Real certificate issued — either your host's managed TLS (Render/
      Railway/Fly) or `scripts/init-letsencrypt.sh` (self-managed nginx).
- [ ] HTTPS redirect confirmed working (`nginx/conf.d/ilovemeow.conf.template`
      redirects `:80` → `:443`).
- [ ] Certificate auto-renewal confirmed (the `certbot` service in
      `docker-compose.yml` renews every 12h — or your host's automatic
      renewal, if using Render/Railway/Fly's managed TLS instead).

## Security
- [ ] Security headers present on real responses — check with
      `curl -sI https://yourdomain.com | grep -i -E "strict-transport|x-frame|content-security"`
      (set in `security.js` and again in nginx for defense in depth).
- [ ] Rate limiting active at both layers: nginx (`limit_req_zone` in
      `nginx/nginx.conf`) and the app (`rateLimit.js`, Redis-backed).
- [ ] `/metrics` is NOT publicly reachable — confirm
      `curl https://yourdomain.com/metrics` returns 403 from outside your
      network (nginx restricts it to internal IP ranges; `METRICS_TOKEN`
      is a second layer).
- [ ] Dependency audit run: `npm audit` (only `ioredis`, `prom-client`,
      `@sentry/node` are real npm dependencies here — everything else is
      hand-rolled specifically to avoid a large dependency surface).
- [ ] `CORS`/`connect-src` in the CSP (`security.js`) still matches your
      actual domain if you change it.

## Observability
- [ ] `/health` returns 200 (liveness — Docker's `HEALTHCHECK` and your
      host's health check both use this).
- [ ] `/health/ready` returns 200 and its `checks.database.status` is
      `"ok"` (readiness — checks the DB is actually reachable, not just
      that the process is running).
- [ ] Prometheus is scraping `/metrics` successfully — check the Targets
      page at `http://<host>:9090/targets` if running the `observability`
      compose profile.
- [ ] Grafana dashboard loads real data (`monitoring/grafana/provisioning`
      auto-provisions the "I Love Meow — Overview" dashboard).
- [ ] `SENTRY_DSN` set if you want error tracking — without it, errors
      still go to structured logs (`logger.js`) but nothing pages you.
- [ ] Log aggregation wired up — this app already emits structured JSON
      lines (`logger.js`); point your platform's log drain (CloudWatch,
      Loki, Datadog, or your host's built-in log viewer) at stdout.

## Performance & scaling
- [ ] Resource limits set appropriately for your traffic
      (`docker-compose.yml`'s `deploy.resources` — defaults are
      conservative, raise them if you see `HighMemoryUsage` alerts firing).
- [ ] Redis is running (`REDIS_URL` set) — without it, rate limiting and
      caching fall back to in-memory, which doesn't work correctly across
      multiple app instances (each instance would have its own counters).
- [ ] If you expect to run more than one app instance: migrate off SQLite
      first (see `DEPLOYMENT.md`'s AWS/ECS section) — a single SQLite file
      can't be safely written to by multiple processes across machines.
- [ ] Static assets are cached at the edge (nginx's `expires 7d` block, or
      Cloudflare/CloudFront in front) so repeat visitors aren't re-fetching
      CSS/JS from your origin every time.

## Disaster recovery
- [ ] Restore procedure tested at least once in a non-production
      environment: `scripts/restore.sh <backup file>`.
- [ ] You know your **RPO** (how much data you're willing to lose — set by
      your backup schedule's frequency) and **RTO** (how long a full
      restore + redeploy actually takes — time it once).
- [ ] Rollback plan for a bad deploy: keep the previous Docker image
      tagged (the CI workflow tags by commit SHA, not just `latest`, for
      exactly this reason) and know the one command to redeploy it.

## Launch day
- [ ] Load-test at a level above what you actually expect (a simple
      `autocannon` or `k6` run against a staging deploy is enough to catch
      obvious bottlenecks before real users do).
- [ ] Confirm registration → post → like → comment flow works end-to-end
      against the production URL, not just localhost.
- [ ] Someone is watching Grafana/Sentry/logs for the first few hours after
      launch.
