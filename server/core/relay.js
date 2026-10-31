// server/core/relay.js — relais HLS de la liste blanche licenciée (3.21.0).
// Un diffuseur peut répondre au serveur et refuser le navigateur (absence d'en-tête CORS) :
// le serveur relit alors le flux pour le compte du visiteur. Le relais ne sort jamais de la
// liste blanche : uniquement des adresses déjà publiées par une source licenciée.

import { AppError } from './errors.js';

export const RELAY_LIMITS = {
  playlistBytes: 512 * 1024,
  segmentBytes: 12 * 1024 * 1024,
  timeoutSeconds: 15,
  inFlightMax: 32,
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Hôtes admis : ceux des chaînes publiques dont la source (ou la fiche) déclare une licence. */
export function relayAllowlist(store) {
  const sources = new Map((store.sources || []).map((source) => [source.id, source]));
  const allowed = new Set();
  for (const channel of store.channels || []) {
    if (channel.deleted) continue;
    const source = channel.sourceId ? sources.get(channel.sourceId) : null;
    const licensed = String(channel.licenseNote || '').trim()
      || String(source?.licence || source?.license || '').trim();
    if (!licensed) continue;
    for (const raw of [channel.url, ...(channel.variants || []).map((variant) => variant.url)]) {
      const host = hostOf(raw);
      if (host) allowed.add(host);
    }
  }
  return allowed;
}

export function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isHttp(url) {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

/**
 * Vérifie une adresse à relayer : HTTPS, hôte de la liste blanche, jamais une adresse privée.
 * `insecure` n'ouvre que la boucle locale en HTTP, pour les essais locaux et les tests.
 */
export function relayTarget(raw, allowlist, { insecure = false } = {}) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new AppError('ERR-04', { field: 'u', params: { champ: 'adresse du flux' } });
  }
  if (!isHttp(url)) throw new AppError('ERR-04', { field: 'u', params: { champ: 'adresse du flux' } });
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK.has(host);
  if (url.protocol === 'http:' && !(insecure && loopback)) {
    throw new AppError('ERR-04', { field: 'u', params: { champ: 'adresse du flux (HTTPS attendu)' } });
  }
  if (!allowlist.has(host)) {
    throw new AppError('ERR-09', { params: { champ: 'relais' } });
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !loopback) {
    throw new AppError('ERR-09', { params: { champ: 'relais' } });
  }
  return url;
}

/** Une ligne de playlist qui porte une adresse : commentaire avec URI="…" ou adresse nue. */
function rewriteLine(line, { base, makeUrl, allowlist }) {
  const absolute = (value) => {
    try {
      const resolved = new URL(value, base);
      if (!isHttp(resolved)) return '';
      // Une adresse hors liste blanche reste telle quelle : le relais ne la servira jamais,
      // et le navigateur garde sa chance en direct.
      if (allowlist && !allowlist.has(resolved.hostname.toLowerCase())) return '';
      return resolved.toString();
    } catch {
      return '';
    }
  };
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (trimmed.startsWith('#')) {
    return line.replace(/URI="([^"]*)"/g, (match, value) => {
      const target = absolute(value);
      return target ? `URI="${makeUrl(target)}"` : match;
    });
  }
  const target = absolute(trimmed);
  return target ? makeUrl(target) : line;
}

/**
 * Réécrit une playlist : chaque adresse (variante, segment, clé, init) passe par le relais.
 * Les adresses relatives sont résolues contre celle de la playlist d'origine.
 */
export function rewritePlaylist(text, { baseUrl, makeUrl, allowlist = null }) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new AppError('ERR-10');
  }
  return String(text)
    .split(/\r?\n/)
    .map((line) => rewriteLine(line, { base, makeUrl, allowlist }))
    .join('\n');
}

export function looksLikePlaylist(contentType, buffer) {
  if (/mpegurl/i.test(contentType)) return true;
  const head = buffer.subarray(0, 7).toString('latin1');
  return head === '#EXTM3U';
}

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new AppError('ERR-15', { params: { max: `${Math.round(maxBytes / 1024)} Ko` } });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new AppError('ERR-15', { params: { max: `${Math.round(maxBytes / 1024)} Ko` } });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks);
}

/**
 * Récupère une adresse de la liste blanche. Aucune redirection n'est suivie : une redirection
 * sortirait de la liste blanche sans nouvelle vérification.
 */
export async function fetchRelay(url, { maxBytes, timeoutMs = RELAY_LIMITS.timeoutSeconds * 1000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: '*/*', 'user-agent': 'StreamTV-relais/1' },
    });
    if (response.status >= 300 && response.status < 400) throw new AppError('ERR-09', { params: { champ: 'relais' } });
    if (!response.ok) {
      throw new AppError('ERR-16', { params: { raison: `le diffuseur a répondu ${response.status}` } });
    }
    const buffer = await readCapped(response, maxBytes);
    return { contentType: String(response.headers.get('content-type') || ''), buffer };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.name === 'AbortError') throw new AppError('ERR-20');
    throw new AppError('ERR-16', { params: { raison: 'le diffuseur n’a pas répondu' } });
  } finally {
    clearTimeout(timer);
  }
}

/** Le relais ne peut pas servir plus de requêtes simultanées qu'il n'en peut tenir en mémoire. */
export function createGate(max = RELAY_LIMITS.inFlightMax) {
  let inFlight = 0;
  return {
    async run(task) {
      if (inFlight >= max) throw new AppError('ERR-17', { params: { n: 1 } });
      inFlight += 1;
      try {
        return await task();
      } finally {
        inFlight -= 1;
      }
    },
    get inFlight() {
      return inFlight;
    },
  };
}

export function relayPath(channelId, absoluteUrl = '') {
  const base = `/api/relais/${encodeURIComponent(channelId)}`;
  return absoluteUrl ? `${base}/s?u=${encodeURIComponent(absoluteUrl)}` : `${base}/flux.m3u8`;
}

/** Ce que la fiche publique annonce : un relais utilisable, ou rien du tout. */
export function relayInfo(store, channel, { insecure = false } = {}) {
  const allowlist = relayAllowlist(store);
  try {
    relayTarget(channel.url, allowlist, { insecure });
  } catch {
    return { available: false, url: '' };
  }
  return { available: true, url: relayPath(channel.id) };
}
