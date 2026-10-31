// server/core/m3u.js — F-01 : automate de lecture M3U tolérant.
// Invariant : cette fonction ne lève jamais. Toute anomalie devient un compteur ou un avertissement.

import {
  buildTags, detectLanguage, detectCountry, detectQuality, groupKind, hostOf,
  normalizeName, normalizeUrl, slug,
} from './text.js';

const ATTR_RE = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
const MAX_ENTRIES = 200_000;

function parseAttributes(line) {
  const attributes = Object.create(null);
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (value) attributes[key] = value;
  }
  return attributes;
}

function nameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return normalizeName(decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' '));
  } catch {
    return 'Chaîne sans nom';
  }
}

// Le nom suit la virgule qui ferme le bloc d'attributs. Chercher la dernière virgule
// tronquerait « Canal 5, el canal » ; on retient donc la première virgule hors guillemets.
function splitExtinf(payload) {
  let quoted = false;
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      return { head: payload.slice(0, index), title: payload.slice(index + 1).trim() };
    }
  }
  return { head: payload, title: '' };
}

function toPlayableUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^[a-z0-9.-]+\.(m3u8|mpd|ts|mp4)(\?|$)/i.test(url)) url = `https://${url}`;
  url = url.split('#')[0];
  return normalizeUrl(url) || normalizeUrl(url, { defaultProtocol: 'https:' });
}

/**
 * Analyse une playlist M3U.
 * @param {string} text contenu brut
 * @param {{sourceLabel?: string, siteProtocol?: string}} options
 */
export function parseM3U(text, { sourceLabel = '', siteProtocol = 'https:' } = {}) {
  const stats = {
    lines: 0, extinf: 0, urls: 0, orphans: 0, duplicates: 0, ignored: 0,
    emptyNames: 0, invalidUrls: 0, attributes: 0, extgrp: 0, uaRequired: 0,
  };
  const warnings = [];
  const errors = {
    'ligne vide': 0, 'URL invalide': 0, 'nom absent': 0, 'doublon exact': 0, 'hors format': 0,
  };
  const entries = [];
  const seen = new Set();
  let playlistTitle = '';
  let pending = null;
  let pendingGroup = '';
  let pendingUa = '';
  let pendingReferer = '';

  if (typeof text !== 'string' || !text.trim()) {
    return {
      entries, stats, warnings: ['Le fichier est vide.'], errors, playlist: { title: '', source: sourceLabel },
    };
  }

  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = body.split('\n');
  if (lines.length > 400_000) {
    warnings.push('Fichier très volumineux : seules les 400 000 premières lignes ont été lues.');
  }

  // Une playlist HLS (média ou maître) n'est pas un catalogue : on refuse tôt, avec une explication.
  if (/#EXT-X-(TARGETDURATION|MEDIA-SEQUENCE|STREAM-INF|PLAYLIST-TYPE)/i.test(body)) {
    stats.hlsPlaylist = true;
    return {
      entries,
      stats,
      warnings: ['Ce fichier est une playlist HLS de segments, pas une liste de chaînes. Importez une playlist M3U de type #EXTINF.'],
      errors,
      playlist: { title: '', source: sourceLabel },
    };
  }

  const limit = Math.min(lines.length, 400_000);
  for (let index = 0; index < limit; index += 1) {
    const rawLine = lines[index];
    stats.lines += 1;
    const line = rawLine.trim();
    if (!line) { errors['ligne vide'] += 1; continue; }

    try {
      if (line.startsWith('#')) {
        const upper = line.toUpperCase();

        if (upper.startsWith('#EXTM3U')) {
          const attributes = parseAttributes(line);
          playlistTitle = attributes['x-tvg-url'] ? '' : playlistTitle;
          continue;
        }
        if (upper.startsWith('#PLAYLIST:')) {
          playlistTitle = line.slice(9).trim();
          continue;
        }
        if (upper.startsWith('#EXTINF:')) {
          if (pending) {
            // Un EXTINF sans URL suivi d'un autre EXTINF : l'entrée précédente est orpheline.
            stats.orphans += 1;
            errors['nom absent'] += 1;
            // Un EXTINF sans URL consomme son groupe et son UA : rien ne fuit vers l'entrée suivante.
            pendingGroup = '';
            pendingUa = '';
            pendingReferer = '';
          }
          stats.extinf += 1;
          const { head, title } = splitExtinf(line.slice(8));
          const attributes = parseAttributes(head);
          stats.attributes += Object.keys(attributes).length;
          pending = { attributes, title, line: index + 1 };
          continue;
        }
        if (upper.startsWith('#EXTGRP:')) {
          pendingGroup = line.slice(8).trim();
          stats.extgrp += 1;
          continue;
        }
        if (upper.startsWith('#EXTVLCOPT:')) {
          const option = line.slice(11).trim();
          const [key, ...rest] = option.split('=');
          const value = rest.join('=').trim();
          if (/user-?agent/i.test(key)) { pendingUa = value; stats.uaRequired += 1; }
          if (/referer|referrer/i.test(key)) pendingReferer = value;
          continue;
        }
        stats.ignored += 1;
        continue;
      }

      // Ligne d'adresse.
      const url = toPlayableUrl(line);
      if (!url) {
        stats.invalidUrls += 1;
        errors['URL invalide'] += 1;
        pending = null;
        continue;
      }
      stats.urls += 1;
      if (!pending) {
        stats.orphans += 1;
        errors['hors format'] += 1;
      }
      const attributes = pending?.attributes || {};
      const rawName = (pending?.title || attributes['tvg-name'] || nameFromUrl(url)).trim();
      if (!rawName) { stats.emptyNames += 1; errors['nom absent'] += 1; }

      if (seen.has(url)) {
        stats.duplicates += 1;
        errors['doublon exact'] += 1;
        pending = null;
        continue;
      }
      seen.add(url);

      const tvgId = String(attributes['tvg-id'] || '').trim();
      const tvgName = String(attributes['tvg-name'] || '').trim();
      const logo = String(attributes['tvg-logo'] || attributes['logo'] || '').trim();
      const group = (pendingGroup || attributes['group-title'] || attributes['group'] || '').trim();
      const name = normalizeName(rawName);
      const cleanGroup = group || (pendingGroup || '');
      const quality = detectQuality(rawName, url);
      const country = detectCountry({ tvgId, group: cleanGroup, name });
      const language = detectLanguage({ tvgId, name, group: cleanGroup, country });
      const extras = {};
      if (pendingUa) extras.userAgent = pendingUa;
      if (pendingReferer) extras.referrer = pendingReferer;
      if (pending?.line) extras.line = pending.line;

      const tags = buildTags({ url, rawName: `${rawName} ${pendingUa}`, group: cleanGroup, quality, tvgId, country, language });
      if (pendingUa && !tags.includes('ua-required')) tags.push('ua-required');

      entries.push({
        rawName,
        name,
        url,
        urlNormalized: url,
        tvgId,
        tvgName,
        logo: /^https?:\/\//i.test(logo) ? logo.slice(0, 512) : '',
        group: cleanGroup.slice(0, 120),
        groupKind: groupKind(cleanGroup),
        quality,
        country,
        language,
        tags,
        position: entries.length,
        host: hostOf(url),
        slug: slug(name),
        extras,
      });
      pending = null;
      pendingGroup = '';
      pendingUa = '';
      pendingReferer = '';
      if (entries.length >= MAX_ENTRIES) {
        warnings.push(`Limite de ${MAX_ENTRIES} entrées atteinte : le reste du fichier a été ignoré.`);
        break;
      }
    } catch {
      stats.ignored += 1;
      errors['hors format'] += 1;
    }
  }

  if (pending) stats.orphans += 1;

  const uaCount = entries.filter((entry) => entry.tags.includes('ua-required')).length;
  if (uaCount) {
    warnings.push(`${uaCount} chaînes exigent un identifiant technique (User-Agent) : elles seront signalées comme protégées.`);
  }
  const geoCount = entries.filter((entry) => entry.tags.includes('geo')).length;
  if (geoCount) warnings.push(`${geoCount} chaînes sont déclarées géo-restreintes par la source.`);
  const httpCount = entries.filter((entry) => /^http:/i.test(entry.url)).length;
  if (httpCount && siteProtocol === 'https:') {
    warnings.push(`${httpCount} chaînes sont diffusées en HTTP : le navigateur les bloquera sur un site HTTPS.`);
  }
  if (stats.duplicates) warnings.push(`${stats.duplicates} adresses identiques ont été comptées une seule fois.`);

  return {
    entries,
    stats,
    warnings,
    errors,
    playlist: { title: playlistTitle, source: sourceLabel, lines: stats.lines },
  };
}

/** Construit le texte d'une playlist exportable (F-22, EP-36). */
export function buildM3U(channels, { title = 'StreamTV', epgUrl = '' } = {}) {
  const head = epgUrl
    ? `#EXTM3U x-tvg-url="${epgUrl}"`
    : '#EXTM3U';
  const lines = [head, `#PLAYLIST:${title}`];
  for (const channel of channels) {
    const attrs = [
      `tvg-id="${escapeAttribute(channel.tvgId || channel.epgId || '')}"`,
      `tvg-name="${escapeAttribute(channel.name)}"`,
      channel.logo ? `tvg-logo="${escapeAttribute(channel.logo)}"` : '',
      channel.group ? `group-title="${escapeAttribute(channel.group)}"` : '',
      `tvg-chno="${channel.number}"`,
      channel.language ? `tvg-language="${escapeAttribute(channel.language)}"` : '',
      channel.country ? `tvg-country="${escapeAttribute(channel.country)}"` : '',
      `streamtv-category="${escapeAttribute(channel.category)}"`,
    ].filter(Boolean).join(' ');
    lines.push(`#EXTINF:-1 ${attrs},${channel.name}`);
    lines.push(channel.url);
  }
  return `${lines.join('\n')}\n`;
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/"/g, '’').replace(/[\r\n]/g, ' ');
}
