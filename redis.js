// redis.js — thin wrapper around ioredis that degrades to an in-memory
// store when REDIS_URL isn't set or the `ioredis` package isn't installed
// (it's an optionalDependency — see package.json). This lets rate limiting
// and caching work identically in local dev (no Redis needed) and in
// production (real Redis via docker-compose / a managed instance), and
// lets the app boot even if the optional package install failed.
//
// Surface used elsewhere in this codebase: get, set (with px/ttl-ms),
// incr, expire, del. That's the subset ioredis and the in-memory shim
// both implement, so callers don't need to branch on which backend is live.

import { logger } from './logger.js';

const REDIS_URL = process.env.REDIS_URL || '';

class MemoryStore {
  constructor() {
    this.map = new Map(); // key -> { value, expiresAt }
    this.kind = 'memory';
    setInterval(() => this._sweep(), 30_000).unref?.();
  }

  _sweep() {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expiresAt && v.expiresAt <= now) this.map.delete(k);
    }
  }

  _get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    const entry = this._get(key);
    return entry ? entry.value : null;
  }

  async set(key, value, mode, ttlMs) {
    let expiresAt = null;
    if (mode === 'PX' && ttlMs) expiresAt = Date.now() + Number(ttlMs);
    if (mode === 'EX' && ttlMs) expiresAt = Date.now() + Number(ttlMs) * 1000;
    this.map.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async incr(key) {
    const entry = this._get(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.map.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async expire(key, seconds) {
    const entry = this._get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + Number(seconds) * 1000;
    return 1;
  }

  async del(key) {
    return this.map.delete(key) ? 1 : 0;
  }

  async ping() {
    return 'PONG';
  }
}

let client = null;
let kind = 'memory';

async function init() {
  if (!REDIS_URL) {
    logger.info('redis_disabled', { reason: 'REDIS_URL not set — using in-memory store (single-instance only)' });
    client = new MemoryStore();
    return;
  }
  try {
    const { default: Redis } = await import('ioredis');
    const real = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    real.on('error', (err) => logger.warn('redis_error', { error: err.message }));
    await real.connect();
    client = real;
    kind = 'redis';
    logger.info('redis_connected', { url: REDIS_URL.replace(/:[^:@]*@/, ':***@') });
  } catch (err) {
    logger.warn('redis_unavailable_falling_back_to_memory', { error: err.message });
    client = new MemoryStore();
    kind = 'memory';
  }
}

const ready = init();

export async function getRedis() {
  await ready;
  return client;
}

export function redisKind() {
  return kind;
}
