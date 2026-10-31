// server/core/text.js — normalisations F-02 → F-07 et F-12 → F-14.
// Aucune fonction de ce module ne lève d'exception : une entrée sale donne une sortie vide.

import { createHash } from 'node:crypto';
import { COUNTRY_ALIASES, COUNTRY_BY_CODE, COUNTRIES, countryByName } from './countries.js';
import { GENERIC_GROUPS, GENRE_GROUPS, LIMITS, QUALITY_RANK } from './constants.js';

export const stripDiacritics = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

/** Normalise pour comparaison : minuscules, sans accents, ponctuation réduite à l'espace. */
export function normalizeKey(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** F-17 : normalisation des requêtes (accents, casse, ponctuation, espaces). */
export function normalizeQuery(value) {
  const key = normalizeKey(value);
  return key.slice(0, LIMITS.searchMaxLength);
}

export function truncate(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

/** F-02 : URL normalisée, stable, utilisée pour l'empreinte d'identité. */
export function normalizeUrl(raw, { defaultProtocol = 'https:' } = {}) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';
  value = value.replace(/^["'<]+|["'>]+$/g, '');
  if (value.startsWith('//')) value = `${defaultProtocol.replace(':', '')}:${value}`;
  if (/^(rtsp|rtmp|rtmps|udp|mms|mmsh):/i.test(value)) {
    return value.replace(/\s+/g, '');
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    url.hash = '';
    const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    url.search = '';
    for (const [key, val] of params) url.searchParams.append(key, val);
    let out = url.toString();
    // La barre finale ne distingue pas deux flux : elle est retirée (dédoublonnage plus fiable).
    if (url.pathname.endsWith('/')) out = out.replace(/\/(\?|$)/, '$1');
    return out.slice(0, LIMITS.urlMax);
  } catch {
    return '';
  }
}

/** Extrait l'hôte d'une URL, pour l'affichage et la sonde. */
export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

/* ------------------------------------------------------------------ qualité */

const QUALITY_PATTERNS = [
  { value: '8K', re: /(?:^|[^a-z0-9])(?:8k|4320p?|uhd2)(?:[^a-z0-9]|$)/i },
  { value: '4K', re: /(?:^|[^a-z0-9])(?:4k|2160p?|uhd)(?:[^a-z0-9]|$)/i },
  { value: 'FHD', re: /(?:^|[^a-z0-9])(?:fhd|full\s?hd|1080[pi]?)(?:[^a-z0-9]|$)/i },
  { value: 'HD', re: /(?:^|[^a-z0-9])(?:hd|720[pi]?|hq)(?:[^a-z0-9]|$)/i },
  { value: 'SD', re: /(?:^|[^a-z0-9])(?:sd|576[pi]?|480[pi]?|360p?)(?:[^a-z0-9]|$)/i },
];

/** F-04 : qualité déclarée par le nom, puis par l'URL. AUTO si aucune indication. */
export function detectQuality(rawName, url = '') {
  const haystack = `${rawName || ''} ${url.split('?')[0].split('/').slice(-2).join(' ')}`;
  for (const { value, re } of QUALITY_PATTERNS) {
    if (re.test(haystack)) return value;
  }
  return 'AUTO';
}

export function bestQuality(a, b) {
  return (QUALITY_RANK[a] || 0) >= (QUALITY_RANK[b] || 0) ? a : b;
}

/* ------------------------------------------------------------------ nom */

const NOISE = [
  /\(\s*(?:not\s*24\/?7|24\/?7|geo[- ]?blocked?|backup|alt|test)\s*\)/gi,
  /\[\s*(?:not\s*24\/?7|24\/?7|geo[- ]?blocked?|backup|alt|test)\s*\]/gi,
  /\(\s*(?:720p?|1080p?|2160p?|4320p?|4k|8k|uhd|fhd|hd|sd)\s*\)/gi,
  /\[\s*(?:720p?|1080p?|2160p?|4320p?|4k|8k|uhd|fhd|hd|sd)\s*\]/gi,
  /\s*[-–|]\s*(?:backup|alt(?:ernative)?)\s*$/gi,
];

const TRAILING_TOKENS = /(?:\s*[|–-]\s*|\s+)(?:raw|uhd|fhd|full\s?hd|hd|sd|4k|8k|h265|hevc|hevc265|h\.?264|multi|backup|alt)\s*$/i;

/** F-03 : nom lisible — suffixes de qualité retirés, espaces compactés, longueur bornée. */
export function normalizeName(raw) {
  let name = String(raw ?? '');
  name = name.replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const noise of NOISE) name = name.replace(noise, ' ');
  for (let i = 0; i < 4; i += 1) {
    const next = name.replace(TRAILING_TOKENS, '');
    if (next === name) break;
    name = next;
  }
  name = name.replace(/^[\s|•·–-]+|[\s|•·–-]+$/g, '');
  name = name.replace(/\s{2,}/g, ' ');
  if (!name) name = 'Chaîne sans nom';
  return truncate(name, LIMITS.nameMax);
}

/** F-05 : identifiant lisible pour les ancres et les journaux. */
export function slug(value) {
  const base = stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'chaine').slice(0, 60);
}

/** F-06 : teinte stable dérivée de l'identifiant — même couleur à chaque visite. */
export function hueFromId(id) {
  const value = createHash('sha1').update(String(id)).digest('hex').slice(0, 6);
  return Number.parseInt(value, 16) % 360;
}

/* ------------------------------------------------------------------ pays & langue */

export function countryFromCode(code) {
  const found = COUNTRY_BY_CODE[String(code || '').toUpperCase()];
  return found ? found.code : '';
}

/** F-13 : pays — tvg-id, puis groupe, puis nom. Retourne un code ISO 3166-1 alpha-2. */
export function detectCountry({ tvgId = '', group = '', name = '' } = {}) {
  const cleanTvg = String(tvgId || '').split('@')[0];
  const suffix = cleanTvg.includes('.') ? cleanTvg.split('.').pop() : '';
  if (suffix && /^[a-z]{2,3}$/i.test(suffix)) {
    const byCode = COUNTRY_BY_CODE[suffix.toUpperCase()];
    if (byCode) return byCode.code;
  }
  if (group) {
    const byGroup = countryByName(group);
    if (byGroup) return byGroup.code;
  }
  const key = normalizeKey(name);
  for (const country of COUNTRIES) {
    const countryKey = normalizeKey(country.name);
    if (countryKey.length > 3 && new RegExp(`(?:^|\\s)${escapeRegExp(countryKey)}(?:\\s|$)`).test(key)) {
      return country.code;
    }
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (key.includes(normalizeKey(alias))) return code;
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** F-12 : langue — pays de nationalité du tvg-id, puis écriture du nom, puis langue du pays. */
/**
 * Marqueurs de langue explicites dans le nom : « Al Jazeera English » est anglophone
 * même si son pays de rattachement est le Qatar (AC-026).
 */
const LANGUAGE_HINTS = [
  [/\benglish\b|\banglais\b/i, 'en'],
  [/\bfran[cç]ais\b|\bfrench\b/i, 'fr'],
  [/\bespa[nñ]ol\b|\bspanish\b/i, 'es'],
  [/\bdeutsch\b|\bgerman\b|\ballemand\b/i, 'de'],
  [/\bportugu[eê]s\b|\bportuguese\b/i, 'pt'],
  [/\bitaliano\b|\bitalian\b/i, 'it'],
  [/\bt[uü]rk[cç]e\b|\bturkish\b/i, 'tr'],
  [/\brusski\b|\brussian\b|\brusse\b/i, 'ru'],
  [/\bchinese\b|\bmandarin\b/i, 'zh'],
  [/\bhindi\b/i, 'hi'],
  [/\burdu\b/i, 'ur'],
];

export function detectLanguage({ tvgId = '', name = '', group = '', country = '' } = {}) {
  for (const [pattern, code] of LANGUAGE_HINTS) {
    if (pattern.test(name)) return code;
  }
  const cleanTvg = String(tvgId || '').split('@')[0];
  const suffix = cleanTvg.includes('.') ? cleanTvg.split('.').pop() : '';
  const tvgCountry = COUNTRY_BY_CODE[suffix.toUpperCase()];
  if (tvgCountry?.languages?.length) return tvgCountry.languages[0];
  if (/[\u0600-\u06ff]/.test(name) || /[\u0600-\u06ff]/.test(group)) return 'ar';
  if (/[\u0400-\u04ff]/.test(name)) return 'ru';
  if (/[\u0590-\u05ff]/.test(name)) return 'he';
  if (/[\u4e00-\u9fff]/.test(name)) return 'zh';
  if (/[\u3040-\u30ff]/.test(name)) return 'ja';
  if (/[\uac00-\ud7af]/.test(name)) return 'ko';
  if (/[\u0900-\u097f]/.test(name)) return 'hi';
  const byCountry = COUNTRY_BY_CODE[String(country || '').toUpperCase()];
  if (byCountry?.languages?.length) return byCountry.languages[0];
  return '';
}

/** F-07 : numéro stable — l'ordre d'insertion prime, jamais l'alphabet. */
export function nextNumber(channels) {
  let max = 0;
  for (const channel of channels) {
    if (Number.isInteger(channel.number) && channel.number > max) max = channel.number;
  }
  return max + 1;
}

/* ------------------------------------------------------------------ groupe & étiquettes */

/** Type de groupe : genre, pays, langue ou autre. */
export function groupKind(group) {
  const key = normalizeKey(group);
  if (!key) return 'other';
  if (GENRE_GROUPS[key]) return 'genre';
  if (GENERIC_GROUPS.has(key)) return 'other';
  if (countryByName(group)) return 'country';
  if (/^[a-z]{2}$/.test(key) && COUNTRY_BY_CODE[key.toUpperCase()]) return 'country';
  return 'other';
}

/** F-14 : étiquettes dérivées, bornées à 12, dédupliquées. */
export function buildTags({ url = '', rawName = '', group = '', quality = 'AUTO', tvgId = '', country = '', language = '' }) {
  const tags = new Set();
  if (/^http:/i.test(url)) tags.add('http');
  if (/^https:/i.test(url)) tags.add('https');
  if (/\|.*user-agent|#extvlcopt.*user-agent/i.test(rawName) || /ua-required/i.test(rawName)) tags.add('ua-required');
  if (/geo[- ]?blocked|geo-restricted/i.test(rawName)) tags.add('geo');
  if (/not\s*24\/?7/i.test(rawName)) tags.add('not-24-7');
  if (/\bbackup\b/i.test(rawName)) tags.add('backup');
  if (quality !== 'AUTO') tags.add(quality.toLowerCase());
  if (/\.m3u8?(?:$|\?)/i.test(url)) tags.add('hls');
  if (/\.mpd(?:$|\?)/i.test(url)) tags.add('dash');
  if (tvgId) tags.add('epg');
  if (country) tags.add(`pays-${country.toLowerCase()}`);
  if (language) tags.add(`lang-${language.toLowerCase()}`);
  if (group) tags.add(`groupe-${slug(group).slice(0, 18)}`);
  return [...tags].slice(0, 12);
}

export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'TV';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
