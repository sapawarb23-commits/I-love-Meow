// health.js — liveness/readiness endpoints for Docker HEALTHCHECK, nginx
// upstream checks, and any orchestrator (ECS, Kubernetes, Render, Railway).
//
// /health        — liveness: "is the process up and responsive". Cheap,
//                   no I/O. Used by Docker's HEALTHCHECK and nginx.
// /health/ready   — readiness: "can this instance actually serve traffic".
//                   Checks the database and (if configured) Redis. A load
//                   balancer should stop routing to an instance that fails
//                   this, even if the process itself is still alive.

import { get } from './db.js';
import { getRedis, redisKind } from './redis.js';

const startedAt = Date.now();

export function handleLiveness(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
  }));
}

export async function handleReadiness(res) {
  const checks = {};
  let healthy = true;

  try {
    get('SELECT 1 AS ok');
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', error: err.message };
    healthy = false;
  }

  try {
    const redis = await getRedis();
    await redis.ping();
    checks.cache = { status: 'ok', backend: redisKind() };
  } catch (err) {
    // Redis is not required for correctness (rate limiting degrades to
    // in-memory), so a Redis failure alone shouldn't fail readiness —
    // report it but don't flip `healthy`.
    checks.cache = { status: 'degraded', error: err.message, backend: 'memory-fallback' };
  }

  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: healthy ? 'ok' : 'unhealthy',
    checks,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
  }));
}
