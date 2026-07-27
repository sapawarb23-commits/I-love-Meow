# Deployment guide

This app is a single stateful Node process with an on-disk SQLite database
(`data/ilovemeow.db`). That shape determines which platforms are a good fit
and which need a workaround — this guide is honest about both.

## Quick decision guide

| Platform | Fit | Why |
|---|---|---|
| **Render** | ✅ Good | Persistent disks, Docker support, managed TLS, easiest path to what's in this repo |
| **Railway** | ✅ Good | Same shape as Render — persistent volumes + Docker |
| **Fly.io** | ✅ Good | Volumes attach to a single VM, matches SQLite's single-writer model well |
| **AWS (ECS Fargate + EFS, or a single EC2)** | ✅ Good, more setup | Full control, see the architecture below |
| **Vercel** | ⚠️ Needs a rethink | Serverless functions are stateless/ephemeral — no filesystem persists between invocations, so SQLite can't live there. Vercel is a great fit if you migrate the frontend to be statically hosted and the API to Postgres (Vercel Postgres or Neon), but that's a real architecture change, not a config change |
| **Cloudflare Workers/Pages** | ⚠️ Needs a rethink | Same constraint as Vercel — Workers have no persistent local disk. Cloudflare is, however, an excellent **CDN/DNS layer in front of Render/Railway/AWS** (see below) even without moving the app itself there |

The honest short version: **run the app on Render, Railway, Fly.io, or AWS
(all of which give you a persistent disk), and optionally put Cloudflare in
front of it for CDN/DDoS protection and DNS.** That combination gets you
everything on this checklist without a database migration.

---

## Render

1. Push this repo to GitHub.
2. New → Web Service → connect the repo → **Runtime: Docker** (it'll pick up
   the `Dockerfile` automatically).
3. Add a **Persistent Disk** mounted at `/app/data` (1GB is plenty to start;
   SQLite files stay small) — without this, the database resets on every
   deploy.
4. Set environment variables from `.env.example` (at minimum
   `SESSION_SECRET`, `NODE_ENV=production`).
5. Render terminates TLS for you automatically on the `*.onrender.com`
   domain, and on a custom domain once you add one under Settings →
   Custom Domains (auto-provisions Let's Encrypt) — you don't need this
   repo's own nginx/certbot setup on Render specifically.
6. Health check path: `/health`.

## Railway

1. New Project → Deploy from GitHub repo (Dockerfile detected automatically).
2. Add a **Volume** mounted at `/app/data`.
3. Set the same environment variables as above under Variables.
4. Railway also terminates TLS automatically on both its own domain and any
   custom domain you attach.
5. Set the health check path to `/health` under Settings → Healthcheck.

## Fly.io

```
fly launch --dockerfile Dockerfile --no-deploy
fly volumes create ilovemeow_data --size 1
```
Then in `fly.toml`, mount the volume at `/app/data` and set
`[[services.http_checks]] path = "/health"`. `fly deploy` handles TLS
automatically via Fly's built-in Let's Encrypt integration.

## Vercel / Cloudflare — as a CDN in front, not a host for the app

Point your domain's DNS at Cloudflare, then set Cloudflare's origin to
whichever of the above (Render/Railway/Fly/AWS) is running the app:

- **Cloudflare** gives you: CDN caching for static assets, DDoS protection,
  a free universal SSL certificate at the edge, and WAF rules — all without
  touching the app. Set SSL/TLS mode to "Full (strict)" so the
  Cloudflare→origin leg is also encrypted (this repo's nginx/Let's Encrypt
  setup, or your host's managed TLS, provides the origin certificate
  Cloudflare validates against).
- **Vercel**, if you want it specifically, is best used for a *separate*
  static marketing/landing page, not this stateful app — Vercel serverless
  functions can't hold a SQLite file across requests.

## AWS-ready architecture

The Dockerfile in this repo is already what you'd deploy to AWS — no
AWS-specific rewrite needed. Two shapes, in increasing order of
complexity:

**Simple: single EC2 instance**
- EC2 instance (t3.small is plenty to start) running Docker + this repo's
  `docker-compose.yml` as-is (app + nginx + redis + certbot).
- EBS volume for `/app/data` (survives instance stop/start; snapshot it for
  backups — or just use `scripts/backup.sh` + S3, which works unchanged
  here).
- Route 53 for DNS, this repo's certbot setup for TLS, or an ALB in front
  with an ACM certificate instead of nginx/certbot doing it.

**Scaled: ECS Fargate**
- Push the image built by this repo's `Dockerfile` to ECR (the GitHub
  Actions workflow in `.github/workflows/ci.yml` already builds it —
  point the push step at ECR instead of/alongside GHCR).
- ECS Fargate service running that image, behind an **Application Load
  Balancer** (ALB) with an ACM certificate — the ALB replaces this repo's
  nginx for TLS termination and health checks (`/health`) at that point.
- **ElastiCache for Redis** replaces the `redis` container — same
  `REDIS_URL` env var, no code change (see `redis.js`).
- SQLite's single-writer model doesn't horizontally scale across multiple
  Fargate tasks sharing one file well; at this scale, migrate `db.js` to
  **RDS Postgres** (the migration table in `README.md` and the
  `postgres` service already provisioned in `docker-compose.yml` are the
  starting point) so multiple app instances can share one database safely.
- **S3 + CloudFront** for the image CDN instead of/alongside Cloudinary
  (`cloudinary.js`) if you'd rather own the storage.
- **CloudWatch Logs** picks up the JSON lines this app already emits
  (`logger.js`) with zero changes — CloudWatch's JSON log parsing reads
  structured fields directly.

---

## Domain & DNS checklist

1. Buy/point your domain's nameservers at your registrar or Cloudflare.
2. Add an `A`/`AAAA` (or `CNAME`, if your host gives you one, e.g. Render's
   `*.onrender.com`) record pointing at your host.
3. Add a `www` record (`CNAME www -> yourdomain.com`, or per the "Quick
   decision guide" table above's `Domain=` setting in `.env`).
4. If self-managing TLS (the EC2/single-VM path), run
   `scripts/init-letsencrypt.sh yourdomain.com you@email.com` once DNS has
   propagated — Let's Encrypt validates domain ownership over HTTP, so DNS
   must resolve to your server first.
5. If using Cloudflare in front, set SSL/TLS mode to **Full (strict)**, not
   "Flexible" — Flexible leaves the Cloudflare→origin leg unencrypted.
