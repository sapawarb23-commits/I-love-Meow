// rateLimit.js — general API rate limiting, Redis-backed via redis.js
// (falls back to per-process in-memory automatically when Redis isn't
// configured — see redis.js). This is layered on top of, not a
// replacement for, the existing per-endpoint auth throttle in auth.js
// and the coarser IP-based limiting done at the nginx layer
// (nginx/conf.d/ilovemeow.conf). Defense in depth: nginx sheds obvious
// abuse before it reaches Node; this catches anything that gets through
// or when running without nginx in front (e.g. `npm start` locally).
//
// Fixed-window counter: simple, cheap, and good enough for this app's
// traffic profile. A sliding-window/token-bucket algorithm would be more
// precise at the edges of each window, at the cost of extra Redis calls
// per request — not worth it here.

import { getRedis } from './redis.js';

const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_MAX || 120); // requests
const DEFAULT_WINDOW_S = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);

/**
 * @param {string} identity - usually client IP, or `${ip}:${route}` for
 *   per-route limits.
 * @param {{limit?: number, windowSeconds?: number}} opts
 * @returns {Promise<{allowed: boolean, remaining: number, resetSeconds: number, limit: number}>}
 */
export async function checkRateLimit(identity, opts = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_S;
  const redis = await getRedis();
  const key = `ratelimit:${identity}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: windowSeconds,
    limit,
  };
}

/**
 * Applies standard rate-limit response headers and, if the caller is over
 * the limit, writes a 429 and returns true (caller should stop handling
 * the request). Returns false if the request may proceed.
 */
export async function enforceRateLimit(req, res, identity, opts) {
  const result = await checkRateLimit(identity, opts);
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.resetSeconds));
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }));
    return true;
  }
  return false;
}
