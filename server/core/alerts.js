// server/core/alerts.js — §10.4 : seuils d'alerte d'exploitation, calculés et jamais silencieux.
// Chaque alerte porte une valeur, un seuil et une action : une alerte sans action est un bruit.

import fsp from 'node:fs/promises';
import path from 'node:path';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const ALERT_RULES = Object.freeze([
  { id: 'catalog.jump', label: 'Variation du catalogue supérieure à 5 % sans ingestion', severity: 'warn',
    action: 'Vérifier la dernière importation (journal d’audit) puis restaurer la sauvegarde précédente.' },
  { id: 'catalog.lowConfidence', label: 'Plus de 10 % des chaînes ont une confiance faible', severity: 'warn',
    action: 'Ouvrir la file « à vérifier » et compléter les règles de catégorisation.' },
  { id: 'health.down', label: 'Plus de 40 % des flux sont indisponibles', severity: 'error',
    action: 'Relancer une sonde bornée, vérifier la source, ne pas supprimer en masse.' },
  { id: 'health.flaky', label: 'Plus de 25 % des flux sont instables', severity: 'warn',
    action: 'Contrôler la bande passante du serveur et les hôtes des flux.' },
  { id: 'ingest.failures', label: 'Deux importations consécutives ont échoué', severity: 'error',
    action: 'Tester l’adresse de la source puis relancer un aperçu.' },
  { id: 'auth.fail', label: 'Plus de 20 échecs de connexion en 15 minutes', severity: 'warn',
    action: 'Restreindre l’accès à /api/login et /admin, puis changer le mot de passe.' },
  { id: 'disk.free', label: 'Moins de 1 Go d’espace disque libre', severity: 'error',
    action: 'Purger les sauvegardes hors rétention et vérifier la croissance des journaux.' },
  { id: 'job.duration', label: 'Une importation a dépassé 90 secondes', severity: 'warn',
    action: 'Segmenter la source ; au-delà de 120 s l’importation est interrompue.' },
  { id: 'backup.age', label: 'La dernière sauvegarde a plus de 26 heures', severity: 'error',
    action: 'Vérifier la tâche de 03:00 puis lancer « node scripts/backup.js ».' },
  { id: 'store.size', label: 'Les données dépassent 40 Mo', severity: 'warn',
    action: 'Planifier la bascule PostgreSQL (RUNBOOK §6), seuil de 30 000 chaînes.' },
  { id: 'render.cards', label: 'Plus de 120 cartes rendues simultanément', severity: 'error',
    action: 'Réduire pageSize (≤ 60) ; la pagination doit rester active.' },
  { id: 'category.autre', label: 'La catégorie « Autre » dépasse 15 % du catalogue', severity: 'warn',
    action: 'Ajouter des règles de mots-clés puis relancer le reclassement.' },
]);

export const SEVERITY_ORDER = Object.freeze({ ok: 0, warn: 1, error: 2 });

/**
 * Évaluation pure : reçoit des métriques, renvoie les alertes déclenchées.
 * Séparée de la collecte pour être testable sans disque ni réseau.
 */
export function evaluateAlerts(metrics = {}) {
  const triggers = [];
  const push = (id, value, threshold, detail = '') => {
    const rule = ALERT_RULES.find((item) => item.id === id);
    if (!rule) return;
    triggers.push({ id, label: rule.label, severity: rule.severity, value, threshold, detail, action: rule.action });
  };

  if (Number(metrics.catalogVariationPct) > 5) push('catalog.jump', metrics.catalogVariationPct, 5);
  if (Number(metrics.lowConfidencePct) > 10) push('catalog.lowConfidence', metrics.lowConfidencePct, 10);
  if (Number(metrics.downPct) > 40) push('health.down', metrics.downPct, 40);
  if (Number(metrics.flakyPct) > 25) push('health.flaky', metrics.flakyPct, 25);
  if (Number(metrics.ingestFailures) >= 2) push('ingest.failures', metrics.ingestFailures, 2);
  if (Number(metrics.authFailures15min) > 20) push('auth.fail', metrics.authFailures15min, 20);
  if (Number.isFinite(metrics.diskFreeBytes) && metrics.diskFreeBytes < GB) {
    push('disk.free', Math.round(metrics.diskFreeBytes / MB), 1024, 'Mo libres');
  }
  if (Number(metrics.jobDurationMs) > 90_000) push('job.duration', Math.round(metrics.jobDurationMs / 1000), 90, 'secondes');
  if (Number(metrics.backupAgeHours) > 26) push('backup.age', metrics.backupAgeHours, 26, 'heures');
  if (Number(metrics.storeBytes) > 40 * MB) push('store.size', Math.round(metrics.storeBytes / MB), 40, 'Mo');
  if (Number.isFinite(metrics.renderCards) && metrics.renderCards > 120) {
    push('render.cards', metrics.renderCards, 120, 'cartes');
  }
  if (Number(metrics.autrePct) > 15) push('category.autre', metrics.autrePct, 15);

  triggers.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.id.localeCompare(b.id));
  const level = triggers.reduce((worst, item) => (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[worst]
    ? item.severity : worst), 'ok');
  return { level, checkedAt: new Date().toISOString(), items: triggers, count: triggers.length };
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** Collecte les métriques réelles du store, puis évalue les seuils. */
export async function computeAlerts(store, { now = Date.now(), logger = console, ingestions = null, renderCards = null } = {}) {
  const active = store.channels.filter((channel) => !channel.deleted);
  const total = active.length || 1;

  const down = active.filter((channel) => channel.health?.status === 'down').length;
  const flaky = active.filter((channel) => channel.health?.status === 'flaky').length;
  const lowConfidence = active.filter((channel) => (channel.confidence ?? 1) < 0.45).length;
  const autre = active.filter((channel) => channel.category === 'autre').length;

  let storeBytes = 0;
  for (const file of ['channels.json', 'settings.json', 'sources.json', 'health.json', 'learning.json', 'ingestions.json']) {
    try { storeBytes += (await fsp.stat(path.join(store.dataDir, file))).size; } catch { /* fichier absent */ }
  }

  let diskFreeBytes = Number.POSITIVE_INFINITY;
  try {
    const stats = await fsp.statfs(store.dataDir);
    diskFreeBytes = stats.bavail * stats.bsize;
  } catch { /* système sans statfs : pas d'alerte disque */ }

  let backupAgeHours = 0;
  try {
    const backups = await store.listBackups();
    if (!backups.length) backupAgeHours = Number.POSITIVE_INFINITY;
    else backupAgeHours = Math.max(0, (now - Date.parse(`${backups[0].date}T00:00:00Z`)) / 3_600_000);
  } catch { backupAgeHours = Number.POSITIVE_INFINITY; }

  const history = Array.isArray(ingestions) ? ingestions : (Array.isArray(store.ingestions) ? store.ingestions : []);
  let ingestFailures = 0;
  for (const entry of history) {
    if (entry.status === 'failed' || entry.status === 'error') ingestFailures += 1;
    else break;
  }
  const lastJob = history[0]?.durationMs || 0;

  let catalogVariationPct = 0;
  const previous = history[0]?.totalBefore;
  if (Number.isFinite(previous) && previous > 0) {
    catalogVariationPct = Math.abs((active.length - previous) / previous) * 100;
  }

  const metrics = {
    catalogVariationPct: Math.round(catalogVariationPct * 10) / 10,
    lowConfidencePct: percentage(lowConfidence, total),
    downPct: percentage(down, total),
    flakyPct: percentage(flaky, total),
    autrePct: percentage(autre, total),
    ingestFailures,
    authFailures15min: Number(store.authFailures15min) || 0,
    diskFreeBytes,
    jobDurationMs: lastJob,
    backupAgeHours: Math.round(backupAgeHours * 10) / 10,
    storeBytes,
    renderCards: Number.isFinite(renderCards) ? renderCards : null,
  };

  const report = evaluateAlerts(metrics);
  if (report.level === 'error') {
    logger.warn?.(`alertes : ${report.items.filter((item) => item.severity === 'error').map((item) => item.id).join(', ')}`);
  }
  return { ...report, metrics: { ...metrics, diskFreeBytes: Number.isFinite(diskFreeBytes) ? diskFreeBytes : null } };
}

/** Résumé lisible pour la console d'administration. */
export function alertSummary(report) {
  if (!report || !report.items?.length) return { level: 'ok', label: 'Aucune alerte', count: 0 };
  const errors = report.items.filter((item) => item.severity === 'error').length;
  return {
    level: report.level,
    label: errors ? `${errors} alerte${errors > 1 ? 's' : ''} bloquante${errors > 1 ? 's' : ''}` : 'À surveiller',
    count: report.items.length,
  };
}
