// server/core/reports.js — signalements de contenu, compteur par chaîne, retrait au seuil.
// Invariants : un signalement n'efface rien tant que le seuil n'est pas atteint ; au seuil,
// la chaîne est supprimée (réversible) avec la raison exacte et une ligne d'audit.
// Un même visiteur ne compte qu'une fois par 24 h et par chaîne : le compteur ne se gonfle pas seul.

import { createHash } from 'node:crypto';

import { LIMITS } from './constants.js';

/** Motifs proposés au visiteur. L'identifiant est stable, le libellé est affiché. */
export const REPORT_REASONS = Object.freeze([
  { id: 'droits', label: 'Droits d’auteur' },
  { id: 'illicite', label: 'Contenu illicite' },
  { id: 'flux', label: 'Flux indisponible' },
  { id: 'categorie', label: 'Mauvaise catégorie' },
  { id: 'autre', label: 'Autre' },
]);

export const REASON_IDS = REPORT_REASONS.map((reason) => reason.id);

export function reasonLabel(id) {
  return REPORT_REASONS.find((reason) => reason.id === id)?.label || 'Autre';
}

/**
 * Seuil de retrait automatique. 1000 par défaut ; STREAMTV_SEUIL_SIGNALEMENTS permet de
 * l'abaisser (jamais sous 2) pour une instance de test ou une veille plus stricte.
 */
export function reportThreshold() {
  const raw = Number(process.env.STREAMTV_SEUIL_SIGNALEMENTS);
  if (Number.isFinite(raw) && raw >= 2) return Math.floor(raw);
  return LIMITS.reportsSuppression;
}

export function emptyState() {
  return { counters: {}, reports: [], lastRef: 0, updatedAt: null };
}

/** Empreinte d'adresse : on garde de quoi dédoublonner, jamais l'adresse elle-même. */
export function hashIp(ip) {
  return createHash('sha256').update(`streamtv:${String(ip || 'inconnue')}`).digest('hex').slice(0, 16);
}

export function nextRef(state) {
  state.lastRef = (Number(state.lastRef) || 0) + 1;
  return `SIG-${String(state.lastRef).padStart(5, '0')}`;
}

export function countFor(state, channelId) {
  return Number(state.counters?.[channelId] || 0);
}

export function reportsFor(state, channelId) {
  return (state.reports || []).filter((report) => report.channelId === channelId);
}

/**
 * Enregistre un signalement.
 * @returns {{ref:string, count:number, duplicate:boolean, shouldDelete:boolean, threshold:number}}
 */
export function recordReport({
  state, channel, contentType = 'chaine', counterKey = '', reason = 'autre', message = '', email = '', ip = '',
  threshold = LIMITS.reportsSuppression, now = Date.now(),
}) {
  const key = counterKey || channel.id;
  const label = channel.name || channel.title || key;
  const at = new Date(now).toISOString();
  const ipHash = hashIp(ip);
  const recent = (state.reports || []).find((report) => report.channelId === key
    && report.ipHash === ipHash && now - Date.parse(report.at) < 24 * 3600 * 1000);
  if (recent) {
    return { ref: recent.ref, count: countFor(state, key), duplicate: true, shouldDelete: false, threshold };
  }
  const ref = nextRef(state);
  const count = countFor(state, key) + 1;
  state.counters[key] = count;
  state.reports.push({
    id: ref.toLowerCase(),
    ref,
    channelId: key,
    contentId: channel.id,
    contentType,
    channelName: label,
    channelNumber: channel.number || null,
    reason,
    reasonLabel: reasonLabel(reason),
    message: String(message).slice(0, 1200),
    email: String(email).slice(0, 120),
    ipHash,
    at,
    status: 'nouveau',
    decidedAt: null,
    note: '',
  });
  if (state.reports.length > 400) state.reports = state.reports.slice(-400);
  state.updatedAt = at;
  return { ref, count, duplicate: false, shouldDelete: count >= threshold, threshold };
}

/**
 * Applique une décision d'administration à un signalement et à sa chaîne.
 * « confirmer » masque la chaîne tout de suite ; « rejeter » la laisse en ligne.
 */
export function applyDecision({ state, report, action, note = '', channel = null, now = Date.now() }) {
  const at = new Date(now).toISOString();
  report.status = action === 'confirm' ? 'confirme' : 'rejete';
  report.decidedAt = at;
  report.note = String(note).slice(0, 400);
  let channelChanged = false;
  if (action === 'confirm' && channel && !channel.deleted) {
    channel.visible = false;
    channel.blocked = true;
    channel.blockedReason = 'retrait-signalement';
    channel.manualOverride = 'retrait-signalement';
    channel.updatedAt = at;
    channelChanged = true;
  }
  state.updatedAt = at;
  return { channelChanged, status: report.status };
}

/** Compte les signalements d'une chaîne et fournit de quoi les afficher. */
export function summarize(state, { channels = [], anime = [], films = [], threshold = LIMITS.reportsSuppression, limit = 120 } = {}) {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  for (const item of anime) byId.set(`anime:${item.id}`, item);
  for (const item of films) byId.set(`film:${item.id}`, item);
  const rows = Object.entries(state.counters || {})
    .map(([channelId, count]) => {
      const target = byId.get(channelId) || null;
      const own = reportsFor(state, channelId);
      const last = own.length ? own[own.length - 1] : null;
      const contentType = channelId.startsWith('anime:')
        ? 'anime'
        : (channelId.startsWith('film:') ? 'film' : 'chaine');
      return {
        channelId,
        contentType,
        count: Number(count) || 0,
        name: target?.name || target?.title || last?.channelName || 'Contenu retiré du catalogue',
        number: target?.number || last?.channelNumber || null,
        deleted: Boolean(target?.deleted),
        visible: target ? Boolean(target.visible) && !target.deleted : false,
        blockedReason: target?.blockedReason || '',
        status: last?.status || 'nouveau',
        lastAt: last?.at || null,
        reasons: [...new Set(own.map((report) => report.reason))],
        seuilAtteint: Number(count) >= threshold,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));

  const reports = (state.reports || []).slice(-limit).reverse().map((report) => ({
    ...report,
    channelDeleted: Boolean(byId.get(report.channelId)?.deleted),
  }));

  return {
    threshold,
    total: Object.keys(state.counters || {}).length,
    signalements: Object.values(state.counters || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    enAttente: reports.filter((report) => report.status === 'nouveau').length,
    confirmes: reports.filter((report) => report.status === 'confirme').length,
    rejetes: reports.filter((report) => report.status === 'rejete').length,
    auSeuil: rows.filter((row) => row.seuilAtteint).length,
    channels: rows,
    reports,
    updatedAt: state.updatedAt || null,
  };
}
