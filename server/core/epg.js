// server/core/epg.js — F-23 : XMLTV + chaînes → grille de programmes.
// Tolérant par conception : un fichier cassé ne lève jamais, ne bloque jamais un rendu,
// et devient un message explicite (ER-A15). Aucune dépendance : analyse par expressions régulières.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { MESSAGE_BY_ID } from './messages.js';

const MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const MAX_PROGRAMMES = 200_000;

/** Messages français associés aux échecs de lecture d'un guide (jamais de code technique affiché). */
const EPG_FAILURES = Object.freeze({
  vide: 'Le fichier EPG est vide : la grille reste vide, les chaînes fonctionnent normalement.',
  taille: 'Le fichier EPG dépasse 20 Mo : la grille reste vide, les chaînes fonctionnent normalement.',
  compression: 'Le fichier EPG compressé est illisible : la grille reste vide, les chaînes fonctionnent normalement.',
  binaire: 'Le fichier EPG n’est pas un fichier texte : la grille reste vide, les chaînes fonctionnent normalement.',
  réseau: 'Le guide des programmes est injoignable pour le moment. Les chaînes restent regardables.',
  délai: 'Le guide des programmes n’a pas répondu à temps. Les chaînes restent regardables.',
  absent: 'Aucun guide des programmes n’est configuré. Les chaînes restent regardables ; le guide peut être ajouté dans les réglages.',
});

/** Message affichable pour une raison d'échec EPG. */
export function epgFailureMessage(reason) {
  return EPG_FAILURES[reason] || invalidEpgMessage();
}

/** Décode un corps XMLTV, éventuellement compressé (`.xml.gz`). */
export function decodeEpgBody(buffer) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'vide', message: epgFailureMessage('vide') };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: 'taille', message: epgFailureMessage('taille') };
  const gzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  let text = '';
  try {
    // Signature gzip : 1f 8b, jamais l'extension du fichier.
    text = gzip
      ? gunzipSync(buffer, { maxOutputLength: MAX_BYTES }).toString('utf8')
      : buffer.toString('utf8');
  } catch {
    return { ok: false, reason: 'compression', message: epgFailureMessage('compression') };
  }
  // Un corps binaire (NUL) n'est pas du XMLTV : mieux vaut le dire que produire une grille vide silencieuse.
  if (text.includes('\u0000')) return { ok: false, reason: 'binaire', message: epgFailureMessage('binaire') };
  return { ok: true, gzip, text };
}

/** Convertit « 20261025120000 +0200 » en date ISO UTC. Retourne '' si la valeur est invalide. */
export function parseXmltvDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{4})?/.exec(String(value || '').trim());
  if (!match) return '';
  const [, year, month, day, hour = '00', minute = '00', second = '00', zone = '+0000'] = match;
  const offsetMinutes = zone === '+0000'
    ? 0
    : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second)) - offsetMinutes * 60_000;
  if (Number.isNaN(utc)) return '';
  const date = new Date(utc);
  if (date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 2200) return '';
  return date.toISOString();
}

export function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (match, code) => {
      const value = Number(code);
      return value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const value = Number.parseInt(code, 16);
      return value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    })
    .replace(/&amp;/g, '&')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function attribute(source, name) {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(source)
    || new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(source);
  return match ? decodeEntities(match[1]).trim() : '';
}

function innerText(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!match) return '';
  return decodeEntities(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Analyse un document XMLTV.
 * @returns {{ok:boolean, channels:Array, programmes:Array, stats:object, reason?:string}}
 */
export function parseXmltv(xml) {
  const text = typeof xml === 'string' ? xml : '';
  const stats = { length: text.length, channels: 0, programmes: 0, skipped: 0 };
  if (!text.trim()) return { ok: false, reason: 'vide', channels: [], programmes: [], stats };
  if (!/<tv[\s>]/i.test(text)) return { ok: false, reason: 'format', channels: [], programmes: [], stats };

  const channels = [];
  for (const match of text.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi)) {
    const id = attribute(match[1], 'id');
    if (!id) { stats.skipped += 1; continue; }
    const name = innerText(match[2], 'display-name');
    const icon = /<icon\b([^>]*)\/?>/i.exec(match[2]);
    channels.push({ id, name, icon: icon ? attribute(icon[1], 'src') : '' });
  }
  stats.channels = channels.length;

  const programmes = [];
  for (const match of text.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    if (programmes.length >= MAX_PROGRAMMES) { stats.skipped += 1; continue; }
    const start = parseXmltvDate(attribute(match[1], 'start'));
    const channel = attribute(match[1], 'channel');
    if (!start || !channel) { stats.skipped += 1; continue; }
    const stopRaw = parseXmltvDate(attribute(match[1], 'stop'));
    const stop = stopRaw && stopRaw > start ? stopRaw : new Date(Date.parse(start) + DEFAULT_DURATION_MS).toISOString();
    programmes.push({
      channel,
      start,
      stop,
      title: innerText(match[2], 'title') || 'Programme',
      description: innerText(match[2], 'desc').slice(0, 400),
      category: innerText(match[2], 'category').slice(0, 48),
    });
  }
  stats.programmes = programmes.length;
  programmes.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (!channels.length && !programmes.length) return { ok: false, reason: 'format', channels, programmes, stats };
  return { ok: true, channels, programmes, stats };
}

/** Identifiants possibles d'une chaîne dans le fichier XMLTV. */
/** Clés d'appariement d'une chaîne : epgId, tvgId, sans la qualité après « @ », casse ignorée. */
export function epgKeys(channel) {
  const keys = new Set();
  const id = String(channel.epgId || '').trim();
  const tvg = String(channel.tvgId || '').split('@')[0].trim();
  const tvgFull = String(channel.tvgId || '').trim();
  for (const value of [id, tvg, tvgFull]) {
    if (!value) continue;
    keys.add(value);
    keys.add(value.toLowerCase());
  }
  return [...keys];
}

/**
 * Construit la grille : chaînes visibles + programmes de la fenêtre demandée.
 * Les chaînes sans programme restent listées (grille vide mais utilisable).
 */
export function buildEpg(channels, parsed, { from = Date.now(), to = Date.now() + 12 * 3600_000, limit = 60, now = Date.now() } = {}) {
  const fromMs = Number.isFinite(from) ? from : Date.parse(from) || Date.now();
  const toMs = Number.isFinite(to) ? to : Date.parse(to) || fromMs + 12 * 3600_000;
  const byChannel = new Map();
  for (const programme of parsed.programmes || []) {
    if (Date.parse(programme.stop) <= fromMs || Date.parse(programme.start) >= toMs) continue;
    // Un identifiant de programme peut porter la qualité (« Chaine.fr@HD ») : on indexe les deux formes.
    const raw = String(programme.channel || '');
    const base = raw.split('@')[0].trim();
    const keys = [...new Set([raw, raw.toLowerCase(), base, base.toLowerCase()].filter(Boolean))];
    const bucket = byChannel.get(keys[0]) || [];
    for (const key of keys) if (!byChannel.has(key)) byChannel.set(key, bucket);
    bucket.push({
      start: programme.start,
      stop: programme.stop,
      title: programme.title,
      description: programme.description,
      category: programme.category,
      live: Date.parse(programme.start) <= now && Date.parse(programme.stop) > now,
    });
  }
  const grid = [];
  let matched = 0;
  for (const channel of channels) {
    if (grid.length >= limit) break;
    let programmes = [];
    for (const key of epgKeys(channel)) {
      const found = byChannel.get(key);
      if (found && found.length) { programmes = found; break; }
    }
    if (programmes.length) matched += 1;
    grid.push({
      id: channel.id,
      number: channel.number,
      name: channel.name,
      logo: channel.logo,
      epgId: channel.epgId || channel.tvgId || '',
      programmes: programmes.slice(0, 24),
    });
  }
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    channels: grid.length,
    matched,
    programmes: grid.reduce((sum, row) => sum + row.programmes.length, 0),
    grid,
  };
}

/** Message opposable pour un fichier EPG invalide (§9.4, ER-A15). */
export function invalidEpgMessage() {
  return MESSAGE_BY_ID.get('ER-A15')?.text || 'Le fichier EPG est invalide : la grille reste vide, les chaînes fonctionnent normalement.';
}

/**
 * Charge et met en cache un guide distant.
 * Le cache est en mémoire : une panne d'EPG ne touche jamais le catalogue.
 */
export class EpgCache {
  constructor({ ttlMs = 30 * 60 * 1000, timeoutMs = 15_000, fetchImpl = globalThis.fetch, publicDir = '' } = {}) {
    this.publicDir = publicDir;
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.source = '';
    this.fetchedAt = 0;
    this.parsed = null;
    this.error = '';
    this.loading = null;
  }

  isFresh(url) {
    return Boolean(url && this.source === url && this.parsed && Date.now() - this.fetchedAt < this.ttlMs);
  }

  async load(url, { force = false } = {}) {
    if (!url) return { ok: false, reason: 'absent', message: epgFailureMessage('absent') };
    if (!force && this.isFresh(url)) return { ok: true, cached: true, parsed: this.parsed, fetchedAt: this.fetchedAt };
    if (this.loading) return this.loading;
    this.loading = (async () => {
      // Guide livré avec le site : lu sur le disque, aucun aller-retour réseau.
      if (url.startsWith('/')) return this.readLocal(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'application/xml, application/gzip, text/xml;q=0.9, */*;q=0.5' },
        });
        if (!response.ok) {
          this.error = `indisponible (${response.status})`;
          return { ok: false, reason: 'http', status: response.status, message: epgFailureMessage('réseau') };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const decoded = decodeEpgBody(buffer);
        if (!decoded.ok) {
          this.error = decoded.reason;
          return { ok: false, reason: decoded.reason, message: decoded.message || invalidEpgMessage() };
        }
        const parsed = parseXmltv(decoded.text);
        if (!parsed.ok) {
          this.error = parsed.reason;
          return { ok: false, reason: parsed.reason, message: parsed.message || invalidEpgMessage() };
        }
        this.source = url;
        this.fetchedAt = Date.now();
        this.parsed = parsed;
        this.error = '';
        return { ok: true, cached: false, parsed, fetchedAt: this.fetchedAt };
      } catch (error) {
        this.error = error.name === 'AbortError' ? 'délai' : 'réseau';
        return { ok: false, reason: this.error, message: epgFailureMessage(this.error) };
      } finally {
        clearTimeout(timer);
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Lecture d'un guide livré dans public/. Le chemin est confiné : aucune remontée possible. */
  async readLocal(url) {
    if (!this.publicDir) {
      this.error = 'absent';
      return { ok: false, reason: 'absent', message: epgFailureMessage('absent') };
    }
    const root = path.resolve(this.publicDir);
    const target = path.resolve(root, `.${url}`);
    if (!target.startsWith(root + path.sep) || !target.endsWith('.xml') && !target.endsWith('.xml.gz')) {
      this.error = 'format';
      return { ok: false, reason: 'format', message: invalidEpgMessage() };
    }
    let buffer;
    try {
      buffer = await fsp.readFile(target);
    } catch {
      this.error = 'absent';
      return { ok: false, reason: 'absent', message: epgFailureMessage('réseau') };
    }
    const decoded = decodeEpgBody(buffer);
    if (!decoded.ok) {
      this.error = decoded.reason;
      return { ok: false, reason: decoded.reason, message: decoded.message };
    }
    const parsed = parseXmltv(decoded.text);
    if (!parsed.ok) {
      this.error = parsed.reason;
      return { ok: false, reason: parsed.reason, message: invalidEpgMessage() };
    }
    this.source = url;
    this.fetchedAt = Date.now();
    this.parsed = parsed;
    this.error = '';
    return { ok: true, cached: false, parsed, fetchedAt: this.fetchedAt };
  }

  stats() {
    return {
      source: this.source,
      fetchedAt: this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null,
      programmes: this.parsed?.programmes?.length || 0,
      channels: this.parsed?.channels?.length || 0,
      error: this.error,
    };
  }
}
