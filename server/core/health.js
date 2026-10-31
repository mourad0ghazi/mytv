// server/core/health.js — F-16 : sonde de disponibilité sans lecture vidéo.
// Concurrence 8, délai 6 s, 300 sondes par minute au maximum, 3 échecs consécutifs → indisponible.

import { LIMITS } from './constants.js';

export class ProbeLimiter {
  constructor({ max = LIMITS.probePerMinute, windowMs = 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = [];
  }

  take(count = 1) {
    const now = Date.now();
    this.hits = this.hits.filter((at) => now - at < this.windowMs);
    if (this.hits.length + count > this.max) {
      return { allowed: false, retryAfterSeconds: Math.ceil((this.windowMs - (now - this.hits[0])) / 1000) };
    }
    for (let i = 0; i < count; i += 1) this.hits.push(now);
    return { allowed: true, remaining: this.max - this.hits.length };
  }
}

export function classifyProbe({ ok, httpStatus, latencyMs, cors, error }) {
  if (error) return { status: 'down', reason: 'unreachable' };
  if (!ok) {
    if (httpStatus === 403 || httpStatus === 451) return { status: 'down', reason: 'geo' };
    if (httpStatus === 404 || httpStatus === 410) return { status: 'down', reason: 'dead' };
    if (httpStatus >= 500) return { status: 'flaky', reason: 'server' };
    return { status: 'flaky', reason: 'http' };
  }
  if (latencyMs > 4000) return { status: 'flaky', reason: 'slow' };
  if (cors === false) return { status: 'flaky', reason: 'cors' };
  return { status: 'up', reason: 'ok' };
}

async function probeOne(channel, { timeoutMs = LIMITS.probeTimeoutMs } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(channel.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': 'StreamTV/3.0 (+sonde de disponibilité)',
        Origin: 'https://streamtv.local',
      },
    });
    const latencyMs = Date.now() - started;
    const allowOrigin = response.headers.get('access-control-allow-origin');
    const cors = allowOrigin === '*' || Boolean(allowOrigin && allowOrigin.includes('streamtv'));
    const httpStatus = response.status;
    try { await response.body?.cancel(); } catch { /* corps non consommé */ }
    const ok = httpStatus >= 200 && httpStatus < 400;
    return { ok, httpStatus, latencyMs, cors, error: null };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      cors: null,
      error: error?.name === 'AbortError' ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sonde une liste de chaînes avec une concurrence bornée.
 * @returns {Promise<{tested:number, up:number, flaky:number, down:number, durationMs:number, results:Array}>}
 */
export async function probeChannels(channels, {
  concurrency = LIMITS.probeConcurrency,
  timeoutMs = LIMITS.probeTimeoutMs,
  onResult = null,
} = {}) {
  const started = Date.now();
  const queue = [...channels];
  const results = [];
  const counters = { up: 0, flaky: 0, down: 0 };
  let index = 0;

  const worker = async () => {
    for (;;) {
      const current = index;
      index += 1;
      const channel = queue[current];
      if (!channel) return;
      const raw = await probeOne(channel, { timeoutMs });
      const verdict = classifyProbe(raw);
      const now = new Date().toISOString();
      const previousFailures = channel.health?.consecutiveFailures || 0;
      const consecutiveFailures = verdict.status === 'down' ? previousFailures + 1 : 0;
      channel.health = {
        status: verdict.status,
        checkedAt: now,
        latencyMs: raw.latencyMs,
        cors: raw.cors,
        httpStatus: raw.httpStatus,
        consecutiveFailures,
        // La cause est conservée : « geo », « dead », « cors » ou « ok » expliquent la mesure.
        reason: verdict.reason,
      };
      channel.updatedAt = now;
      // La mesure prime sur l'étiquette : une chaîne annoncée « géo-bloquée » par sa source
      // qui répond ici est rendue à la lecture ; une chaîne qui échoue pour une raison de
      // zone n'est marquée `geo` qu'après constat, jamais sur la foi d'un nom.
      if (verdict.status === 'down' && consecutiveFailures >= LIMITS.downAfterFailures && !channel.manualOverride) {
        channel.blocked = true;
        channel.blockedReason = verdict.reason === 'geo' ? 'geo' : 'dead';
      } else if (verdict.status === 'up' && (channel.blockedReason === 'dead' || channel.blockedReason === 'geo')) {
        channel.blocked = false;
        channel.blockedReason = '';
      }
      if (raw.error === 'timeout' && !channel.manualOverride) channel.tags = [...new Set([...channel.tags, 'timeout'])].slice(0, 12);
      counters[verdict.status] += 1;
      results.push({
        id: channel.id,
        number: channel.number,
        name: channel.name,
        status: verdict.status,
        reason: verdict.reason,
        latencyMs: raw.latencyMs,
        httpStatus: raw.httpStatus,
        cors: raw.cors,
      });
      if (onResult) onResult(results[results.length - 1]);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, channels.length)) }, () => worker());
  await Promise.all(workers);
  return {
    tested: results.length,
    up: counters.up,
    flaky: counters.flaky,
    down: counters.down,
    durationMs: Date.now() - started,
    results,
  };
}

export function nextProbeBatch(channels, { limit = 40, onlyUntested = true } = {}) {
  const pool = onlyUntested
    ? channels.filter((channel) => !channel.health || channel.health.status === 'unknown')
    : channels;
  return pool.slice(0, Math.min(limit, 100));
}
