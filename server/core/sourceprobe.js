// server/core/sourceprobe.js — vérification d'une liste M3U avant ingestion (F-20 étendu).
//
// Une liste publique n'est pas une vérité : entre la publication et la lecture, des flux
// meurent, d'autres exigent un pays, d'autres sortent en HTTP simple (bloqué par tout
// navigateur sur un site HTTPS). Ce module rejoue le parseur, déduplique, teste chaque flux
// et ne rend que ce qui répond — avec une trace chiffrée de ce qui a été écarté.

import { LIMITS } from './constants.js';
import { parseM3U } from './m3u.js';
import { normalizeUrl } from './text.js';

/** Statuts HTTP qui prouvent qu'un flux existe, même si le corps ne nous concerne pas. */
const UP_STATUS = new Set([200, 206]);
/** Un refus explicite du serveur n'est pas une preuve de disponibilité. */
const DOWN_STATUS = new Set([400, 401, 402, 403, 404, 405, 407, 410, 451, 500, 502, 503, 504]);

export const PROBE_LABELS = Object.freeze({
  up: 'disponible',
  down: 'indisponible',
  timeout: 'sans réponse',
  error: 'injoignable',
  skipped: 'ignoré (HTTP en site HTTPS)',
});

/** Une entrée est-elle lisible depuis un site en HTTPS ? */
export function isHttpsEntry(entry) {
  return /^https:\/\//i.test(String(entry?.url || ''));
}

/**
 * Teste une adresse de flux. On demande deux kilo-octets, puis on abandonne : inutile de
 * télécharger un direct entier pour savoir qu'il répond.
 */
export async function probeUrl(url, { timeoutMs = LIMITS.probeTimeoutMs, fetchImpl = globalThis.fetch } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Range: 'bytes=0-2047',
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
        'User-Agent': 'StreamTV/3.4 (verificateur de liste)',
      },
    });
    const latencyMs = Date.now() - started;
    let head = '';
    try {
      head = (await response.text()).slice(0, 2048);
    } catch {
      head = '';
    }
    if (UP_STATUS.has(response.status)) {
      return {
        status: 'up',
        httpStatus: response.status,
        latencyMs,
        playlist: /^\s*#EXTM3U/i.test(head),
        finalUrl: response.url || url,
      };
    }
    return {
      status: DOWN_STATUS.has(response.status) || response.status >= 400 ? 'down' : 'down',
      httpStatus: response.status,
      latencyMs,
      playlist: false,
      finalUrl: response.url || url,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { status: 'timeout', httpStatus: 0, latencyMs, playlist: false, finalUrl: url };
    }
    return { status: 'error', httpStatus: 0, latencyMs, playlist: false, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, worker) {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }));
}

/**
 * Prépare une liste importable : parseur tolérant, déduplication en trois passes, puis sonde.
 *
 * @param {string} text contenu M3U
 * @param {object} options
 * @param {boolean} [options.httpsOnly] écarte les flux `http:` (défaut : vrai)
 * @param {number} [options.concurrency]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.limit] ne teste que les N premières entrées (0 = toutes)
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.onProgress] appelé après chaque flux testé
 */
export async function verifySource(text, {
  sourceLabel = 'liste',
  httpsOnly = true,
  concurrency = LIMITS.probeConcurrency,
  timeoutMs = LIMITS.probeTimeoutMs,
  limit = 0,
  fetchImpl = globalThis.fetch,
  onProgress = null,
} = {}) {
  const parsed = parseM3U(text, { sourceLabel });
  // Déduplication par URL seulement : on teste chaque adresse une fois. La fusion par nom
  // (passes 2 et 3 de F-09) reste le travail de l'ingestion, qui la fait mieux, avec le
  // catalogue existant sous les yeux.
  const seen = new Map();
  let duplicates = 0;
  for (const entry of parsed.entries) {
    const key = normalizeUrl(entry.url || '') || entry.url;
    if (!key) continue;
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.set(key, entry);
  }
  const entries = [...seen.values()];
  const dedupeStats = { input: parsed.entries.length, output: entries.length, duplicates };

  const candidates = [];
  const skipped = [];
  for (const entry of entries) {
    if (!entry.url) continue;
    if (httpsOnly && !isHttpsEntry(entry)) { skipped.push(entry); continue; }
    candidates.push(entry);
  }
  const selection = limit > 0 ? candidates.slice(0, limit) : candidates;

  const results = new Map();
  let done = 0;
  await pool(selection, concurrency, async (entry) => {
    const outcome = await probeUrl(entry.url, { timeoutMs, fetchImpl });
    results.set(entry.id || entry.url, outcome);
    done += 1;
    if (onProgress) onProgress({ done, total: selection.length, entry, outcome });
  });

  const kept = [];
  const rejected = [];
  for (const entry of selection) {
    const outcome = results.get(entry.id || entry.url);
    if (outcome?.status === 'up') kept.push({ ...entry, probe: outcome });
    else rejected.push({ entry, probe: outcome });
  }

  const counts = { up: kept.length, down: 0, timeout: 0, error: 0 };
  for (const item of rejected) counts[item.probe?.status] = (counts[item.probe?.status] || 0) + 1;

  return {
    kept,
    rejected,
    skipped,
    summary: {
      sourceLabel,
      parsed: parsed.entries.length,
      afterDedupe: entries.length,
      candidates: candidates.length,
      tested: selection.length,
      up: counts.up,
      down: counts.down,
      timeout: counts.timeout,
      error: counts.error,
      skippedHttp: skipped.length,
      httpsOnly,
      concurrency,
      timeoutMs,
      parseStats: parsed.stats,
      dedupeStats,
    },
  };
}

/** Combien d'entrées n'apportent pas d'identifiant de guide (donc pas de programmes). */
export function epgCoverage(entries) {
  const withId = entries.filter((entry) => entry.tvgId).length;
  return {
    withId,
    total: entries.length,
    ratio: entries.length ? Number((withId / entries.length).toFixed(3)) : 0,
  };
}

/** Répartition des flux par schéma, pour la revue de conformité. */
export function schemeBreakdown(entries) {
  let https = 0;
  let http = 0;
  let other = 0;
  for (const entry of entries) {
    const url = String(entry.url || '');
    if (/^https:\/\//i.test(url)) https += 1;
    else if (/^http:\/\//i.test(url)) http += 1;
    else other += 1;
  }
  return { https, http, other, total: entries.length };
}

function attribute(name, value) {
  if (!value) return '';
  const clean = String(value).replace(/"/g, "'").replace(/[\r\n]/g, ' ').trim();
  return clean ? ` ${name}="${clean}"` : '';
}

/**
 * Écrit une liste M3U prête à être importée : uniquement les flux vérifiés, avec l'origine,
 * la licence et le décompte dans l'en-tête (traçabilité §10.5).
 */
export function renderPlaylist(entries, {
  title = 'StreamTV — flux vérifiés',
  sourceName = '',
  sourceUrl = '',
  license = '',
  generatedAt = new Date().toISOString(),
  summary = null,
} = {}) {
  const lines = ['#EXTM3U'];
  lines.push(`# ${title}`);
  if (sourceName) lines.push(`# source : ${sourceName}`);
  if (sourceUrl) lines.push(`# origine : ${sourceUrl}`);
  if (license) lines.push(`# licence de la liste d'origine : ${license}`);
  lines.push(`# vérifié le ${generatedAt} — flux ayant répondu à une requête HTTP`);
  if (summary) {
    lines.push(`# retenus : ${summary.up} sur ${summary.tested} testés`
      + ` (${summary.down} indisponibles, ${summary.timeout} sans réponse, ${summary.error} injoignables,`
      + ` ${summary.skippedHttp} écartés en HTTP simple)`);
  }
  lines.push('');
  for (const entry of entries) {
    const name = (entry.rawName || entry.name || 'Chaîne sans nom').replace(/[\r\n]/g, ' ').trim();
    const attributes = [
      attribute('tvg-id', entry.tvgId),
      attribute('tvg-name', entry.tvgName),
      attribute('tvg-logo', entry.logo),
      attribute('group-title', entry.group),
    ].join('');
    lines.push(`#EXTINF:-1${attributes},${name}`);
    lines.push(entry.url);
  }
  lines.push('');
  return lines.join('\n');
}

/** Normalise une liste d'URL pour un contrôle de recouvrement entre deux sources. */
export function urlSet(entries) {
  const set = new Set();
  for (const entry of entries) {
    const url = normalizeUrl(entry.url || '');
    if (url) set.add(url);
  }
  return set;
}

/** Part des flux d'une source déjà présents dans l'autre (0 → 1). */
export function overlap(a, b) {
  const left = urlSet(a);
  const right = urlSet(b);
  if (!left.size) return { common: 0, ratio: 0, ratioB: 0 };
  let common = 0;
  for (const url of left) if (right.has(url)) common += 1;
  return {
    common,
    ratio: Number((common / left.size).toFixed(3)),
    ratioB: right.size ? Number((common / right.size).toFixed(3)) : 0,
  };
}
