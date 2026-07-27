// sentry.js — optional error tracking. Only activates when SENTRY_DSN is
// set and @sentry/node is installed (it's an optionalDependency). Without
// both, captureException() is a no-op — errors still go to the structured
// logger (logger.js / console.error), they just aren't shipped to Sentry.

import { logger } from './logger.js';

let Sentry = null;

async function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('sentry_disabled', { reason: 'SENTRY_DSN not set' });
    return;
  }
  try {
    const mod = await import('@sentry/node');
    mod.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
      release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    });
    Sentry = mod;
    logger.info('sentry_enabled', {});
  } catch (err) {
    logger.warn('sentry_unavailable', { error: err.message });
  }
}

const ready = init();

export async function captureException(err, context = {}) {
  await ready;
  if (Sentry) {
    Sentry.captureException(err, { extra: context });
  }
}

export async function sentryReady() {
  await ready;
  return !!Sentry;
}
