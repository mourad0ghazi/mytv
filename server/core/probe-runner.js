// server/core/probe-runner.js · exécution commune d'une sonde (3.20.0).
// La console et la tâche nocturne passent par le même chemin : plafond de sondes par minute,
// mesure réelle, écriture atomique unique, journal d'audit, puis avancée du curseur.
// Aucune sonde ne modifie autre chose que `health`, les étiquettes de blocage et le curseur.

import { LIMITS } from './constants.js';
import { AppError } from './errors.js';
import { nextProbeBatch, probeChannels } from './health.js';
import { PROBE_MAX_PER_RUN, nextRotatingBatch, probeStats } from './probe-plan.js';

function refusPlafond(retryAfterSeconds) {
  return new AppError('ERR-17', {
    params: { n: Math.max(1, Math.ceil(retryAfterSeconds / 60)) },
    headers: { 'Retry-After': String(Math.max(1, retryAfterSeconds)) },
  });
}

function phrase(result, stats) {
  const reste = stats.remaining
    ? ` ${stats.remaining} chaîne${stats.remaining > 1 ? 's restent' : ' reste'} à tester.`
    : ' Toutes les chaînes ont été testées au moins une fois.';
  return `Sonde terminée : ${result.up} disponibles, ${result.flaky} instables, ${result.down} indisponibles sur ${result.tested} chaînes testées.${reste}`;
}

/**
 * Mesure un lot déjà choisi, puis enregistre le résultat.
 * @param {object} app application
 * @param {object[]} batch chaînes à sonder
 * @param {{actor?: string, ip?: string, requestId?: string, rotation?: object|null}} options
 */
export async function executerSonde(app, batch, {
  actor = 'admin', ip = '', requestId = '', rotation = null,
  emptyReason = 'aucune chaîne à sonder : le catalogue ne contient aucun flux',
} = {}) {
  if (!batch.length) throw new AppError('ERR-16', { params: { raison: emptyReason } });
  const ticket = app.probeLimiter.take(batch.length);
  if (!ticket.allowed) throw refusPlafond(ticket.retryAfterSeconds);

  const result = await probeChannels(batch, { concurrency: LIMITS.probeConcurrency, timeoutMs: LIMITS.probeTimeoutMs });
  await app.store.saveChannels('health.probe');
  if (rotation) {
    app.store.probe = {
      cursor: rotation.nextCursor,
      runs: (app.store.probe.runs || 0) + 1,
      tested: (app.store.probe.tested || 0) + result.tested,
      lastAt: new Date().toISOString(),
    };
  }
  await app.store.saveHealthSnapshot();
  const stats = probeStats(app.store.channels);
  await app.store.audit('health.probe', {
    actor,
    ip,
    requestId,
    count: result.tested,
    detail: `${result.up} ok / ${result.flaky} instables / ${result.down} hs, ${stats.remaining} restantes`,
  });
  return { ...result, probe: stats, message: phrase(result, stats) };
}

/**
 * Ronde : lot suivant dans l'ordre du catalogue, à partir du curseur enregistré.
 * `ids` restreint la mesure aux chaînes désignées (100 au plus), sans toucher au curseur.
 */
export async function lancerRonde(app, { limit = 150, ids = null, actor = 'admin', ip = '', requestId = '' } = {}) {
  if (Array.isArray(ids) && ids.length) {
    const wanted = new Set(ids.slice(0, 100));
    const pool = app.store.channels.filter((channel) => wanted.has(channel.id) && channel.url);
    return executerSonde(app, pool, { actor, ip, requestId });
  }
  const plan = nextRotatingBatch(app.store.channels, { cursor: app.store.probe.cursor, limit });
  const result = await executerSonde(app, plan.batch, {
    actor,
    ip,
    requestId,
    rotation: { nextCursor: plan.nextCursor },
  });
  return {
    ...result,
    rotation: {
      cursor: plan.nextCursor,
      previousCursor: plan.cursor,
      total: plan.total,
      roundComplete: plan.roundComplete,
      testedInRound: plan.batch.length,
      maxPerRun: PROBE_MAX_PER_RUN,
    },
  };
}

/** Sonde de la file « jamais testée » : priorité aux chaînes sans mesure, comme avant. */
export async function lancerSondeNonTestees(app, { limit = 40, ids = null, actor = 'admin', ip = '', requestId = '' } = {}) {
  const pool = Array.isArray(ids) && ids.length
    ? app.store.channels.filter((channel) => ids.includes(channel.id) && channel.url)
    : nextProbeBatch(app.store.channels.filter((channel) => !channel.deleted && channel.url), { limit });
  return executerSonde(app, pool, {
    actor,
    ip,
    requestId,
    emptyReason: 'aucune chaîne à sonder : toutes ont été testées récemment',
  });
}
