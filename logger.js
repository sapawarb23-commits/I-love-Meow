// logger.js — structured JSON logging, no dependency required.
//
// Emits one JSON object per line on stdout/stderr, which is the format
// every log aggregator (CloudWatch, Loki, Datadog, Render/Railway's own
// log viewers) expects for structured querying. In development
// (NODE_ENV !== 'production') it prints human-readable lines instead.

const isProd = process.env.NODE_ENV === 'production';
const SERVICE = 'i-love-meow';

function base(level, msg, meta) {
  return {
    level,
    msg,
    time: new Date().toISOString(),
    service: SERVICE,
    ...meta,
  };
}

function emit(level, msg, meta = {}, stream = console.log) {
  if (isProd) {
    stream(JSON.stringify(base(level, msg, meta)));
  } else {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    stream(`[${level.toUpperCase()}] ${msg}${extra}`);
  }
}

export const logger = {
  info: (msg, meta) => emit('info', msg, meta, console.log),
  warn: (msg, meta) => emit('warn', msg, meta, console.warn),
  error: (msg, meta) => emit('error', msg, meta, console.error),
  debug: (msg, meta) => {
    if (!isProd || process.env.LOG_LEVEL === 'debug') emit('debug', msg, meta, console.log);
  },
};

// ---------- HTTP access logging ----------
//
// Call requestLogStart(req) when a request comes in, then call the
// returned .finish(res) once the response is sent. Produces one structured
// log line per request with method, path, status, duration, and a
// request id you can also return to the client for support/debugging.

let counter = 0;
function nextRequestId() {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function requestLogStart(req) {
  const id = req.headers['x-request-id'] || nextRequestId();
  const start = process.hrtime.bigint();
  return {
    id,
    finish(res, extra = {}) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      emit('info', 'http_request', {
        request_id: id,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        ...extra,
      });
    },
  };
}
