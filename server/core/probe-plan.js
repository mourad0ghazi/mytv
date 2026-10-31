// server/core/probe-plan.js · plan de sonde rotative (3.20.0).
// Le catalogue contient plus de chaînes qu'une nuit ne peut en tester : la sonde avance par
// lots, dans l'ordre du catalogue, et retient sa position. Un tour complet est ainsi réalisé
// sans jamais retester toujours les mêmes quarante premières chaînes.

import { LIMITS } from './constants.js';

/** Lot par défaut d'une ronde nocturne : 150 chaînes, sous le plafond de 300 sondes/minute. */
export const PROBE_NIGHTLY_LIMIT = 150;
/** Plafond absolu d'une ronde demandée depuis la console. */
export const PROBE_MAX_PER_RUN = 300;

/** Seules les chaînes actives et réellement lisibles ont une adresse à sonder. */
export function probePool(channels = []) {
  return channels.filter((channel) => channel && !channel.deleted && channel.url);
}

/**
 * Lot suivant dans l'ordre du catalogue, à partir d'un curseur.
 * Le curseur revient à zéro après le dernier lot : le tour suivant recommence au début.
 * @returns {{batch: object[], cursor: number, nextCursor: number, roundComplete: boolean, total: number}}
 */
export function nextRotatingBatch(channels = [], { cursor = 0, limit = PROBE_NIGHTLY_LIMIT } = {}) {
  const pool = probePool(channels);
  if (!pool.length) return { batch: [], cursor: 0, nextCursor: 0, roundComplete: false, total: 0 };
  const size = Math.max(1, Math.min(PROBE_MAX_PER_RUN, Math.floor(Number(limit)) || PROBE_NIGHTLY_LIMIT));
  const start = ((Math.floor(Number(cursor)) || 0) % pool.length + pool.length) % pool.length;
  const batch = pool.slice(start, start + size);
  const reachedEnd = start + batch.length >= pool.length;
  const nextCursor = reachedEnd ? 0 : start + batch.length;
  return { batch, cursor: start, nextCursor, roundComplete: reachedEnd, total: pool.length };
}

/**
 * Photographie de la mesure : ce qui a été testé, ce qui reste, et ce qui est réellement
 * lisible dans un navigateur (réponse correcte et en-tête CORS présent).
 */
/**
 * Photographie de la mesure. `withProbe: false` compte tout le catalogue publié, quel que soit
 * le réglage de visibilité de la pastille : la console ne doit jamais afficher zéro chaîne
 * parce qu'un bandeau est masqué.
 */
export function probeStats(channels = [], { withProbe = true } = {}) {
  const pool = withProbe ? probePool(channels) : channels.filter((channel) => !channel.deleted);
  const counts = { up: 0, flaky: 0, down: 0, unknown: 0 };
  let measured = 0;
  let readable = 0;
  let corsMissing = 0;
  let lastCheckedAt = '';
  for (const channel of pool) {
    const health = channel.health || {};
    const status = health.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    if (status !== 'unknown') measured += 1;
    if (health.checkedAt && health.checkedAt > lastCheckedAt) lastCheckedAt = health.checkedAt;
    if (status === 'up' || status === 'flaky') {
      if (health.cors === false) corsMissing += 1;
      else readable += 1;
    }
  }
  return {
    total: pool.length,
    ...counts,
    measured,
    remaining: counts.unknown,
    readable,
    corsMissing,
    lastCheckedAt: lastCheckedAt || null,
    nightlyLimit: PROBE_NIGHTLY_LIMIT,
    nights: pool.length ? Math.ceil(counts.unknown / PROBE_NIGHTLY_LIMIT) : 0,
    concurrency: LIMITS.probeConcurrency,
    timeoutMs: LIMITS.probeTimeoutMs,
  };
}
