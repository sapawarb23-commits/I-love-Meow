// metrics.js — Prometheus metrics via prom-client (optionalDependency).
// If prom-client isn't installed, /metrics still responds — with a plain
// text explanation instead of a 500 — so scraping doesn't crash anything,
// it just returns no series until the dependency is present.
//
// Exposed at GET /metrics. In production this route should NOT be public:
// nginx/conf.d/ilovemeow.conf restricts it to the internal Docker network
// (where Prometheus itself lives) via `allow`/`deny`, and optionally a
// shared-secret header set via METRICS_TOKEN below as defense in depth.

import { logger } from './logger.js';

let client = null;
let httpDuration = null;
let httpTotal = null;
let dbQueryDuration = null;

async function init() {
  try {
    client = await import('prom-client');
    client.collectDefaultMetrics({ prefix: 'ilovemeow_' });

    httpDuration = new client.Histogram({
      name: 'ilovemeow_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    });

    httpTotal = new client.Counter({
      name: 'ilovemeow_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
    });

    dbQueryDuration = new client.Histogram({
      name: 'ilovemeow_db_query_duration_seconds',
      help: 'SQLite query duration in seconds',
      buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
    });

    logger.info('metrics_enabled', { backend: 'prom-client' });
  } catch (err) {
    logger.warn('metrics_disabled', { reason: 'prom-client not installed', error: err.message });
  }
}

const ready = init();

export function observeHttp(method, route, status, durationSeconds) {
  if (!httpDuration) return;
  const labels = { method, route, status: String(status) };
  httpDuration.observe(labels, durationSeconds);
  httpTotal.inc(labels);
}

export function observeDbQuery(durationSeconds) {
  dbQueryDuration?.observe(durationSeconds);
}

export async function handleMetrics(req, res) {
  await ready;

  const token = process.env.METRICS_TOKEN;
  if (token && req.headers['x-metrics-token'] !== token) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!client) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('# prom-client is not installed in this environment.\n# Run `npm install` with network access, or leave metrics disabled.\n');
  }

  res.writeHead(200, { 'Content-Type': client.register.contentType });
  res.end(await client.register.metrics());
}
