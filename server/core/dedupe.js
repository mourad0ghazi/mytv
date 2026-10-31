// server/core/dedupe.js — F-09 : déduplication en trois passes + F-21 : fusion des variantes.
// Trois passes ordonnées : URL exacte, signature nom+pays, similarité de jetons.

import { LIMITS, QUALITY_RANK } from './constants.js';
import { channelId, defaultHealth } from './channels.js';
import { normalizeKey, normalizeUrl } from './text.js';

function filledScore(entry) {
  let score = 0;
  if (entry.logo) score += 3;
  if (entry.tvgId) score += 2;
  if (entry.group) score += 2;
  if (entry.country) score += 1;
  if (entry.language) score += 1;
  if (entry.name && entry.name.length > 3) score += 1;
  if (/^https:/i.test(entry.url)) score += 4;
  if (entry.tags?.includes('ua-required')) score -= 3;
  return score;
}

function richness(entry) {
  return (QUALITY_RANK[entry.quality] || 0) * 10 + filledScore(entry);
}

function tokens(name) {
  return new Set(normalizeKey(name).split(' ').filter((token) => token.length > 1));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function signature(entry) {
  return `${normalizeKey(entry.name)}|${entry.country || ''}`;
}

function makeVariant(entry) {
  return {
    id: channelId(entry.urlNormalized || normalizeUrl(entry.url) || entry.url),
    name: entry.name,
    quality: entry.quality,
    url: entry.url,
    health: defaultHealth(),
  };
}

/** Fusionne deux entrées : la plus riche devient primaire, les autres deviennent des variantes. */
export function mergeEntries(primary, secondary) {
  const winner = richness(secondary) > richness(primary) ? secondary : primary;
  const loser = winner === primary ? secondary : primary;
  const variants = winner.variants ? [...winner.variants] : [];
  const candidate = makeVariant(loser);
  if (!variants.some((variant) => variant.url === candidate.url) && variants.length < LIMITS.maxVariants - 1) {
    variants.push(candidate);
  }
  const merged = { ...winner, variants };
  if (!merged.logo && loser.logo) merged.logo = loser.logo;
  if (!merged.country && loser.country) merged.country = loser.country;
  if (!merged.language && loser.language) merged.language = loser.language;
  if (!merged.tvgId && loser.tvgId) merged.tvgId = loser.tvgId;
  if (!merged.group && loser.group) merged.group = loser.group;
  if (loser.tags) merged.tags = [...new Set([...(merged.tags || []), ...loser.tags])].slice(0, 12);
  merged.sources = [...new Set([...(merged.sources || []), ...(loser.sources || [])])];
  return merged;
}

/**
 * @param {Array} entries entrées du parseur (ordre de playlist)
 * @returns {{entries: Array, stats: {input:number, afterPass1:number, afterPass2:number, output:number, mergedVariants:number}}}
 */
export function dedupe(entries) {
  const stats = { input: entries.length, afterPass1: 0, afterPass2: 0, output: 0, mergedVariants: 0 };

  // Passe 1 — URL normalisée identique.
  const byUrl = new Map();
  for (const entry of entries) {
    const key = entry.urlNormalized || normalizeUrl(entry.url) || entry.url;
    if (!key) continue;
    if (byUrl.has(key)) {
      const merged = mergeEntries(byUrl.get(key), entry);
      byUrl.set(key, merged);
      stats.mergedVariants += 1;
    } else {
      byUrl.set(key, { ...entry, variants: [] });
    }
  }
  let list = [...byUrl.values()];
  stats.afterPass1 = list.length;

  // Passe 2 — signature nom + pays.
  const bySignature = new Map();
  const keep = [];
  for (const entry of list) {
    const key = signature(entry);
    if (!key || key === '|') { keep.push(entry); continue; }
    if (bySignature.has(key)) {
      const existing = bySignature.get(key);
      const merged = mergeEntries(existing, entry);
      bySignature.set(key, merged);
      stats.mergedVariants += 1;
    } else {
      bySignature.set(key, entry);
    }
  }
  list = [...keep, ...bySignature.values()];
  stats.afterPass2 = list.length;

  // Passe 3 — similarité de jetons (même pays, longueurs proches).
  const clusters = [];
  for (const entry of list) {
    const tokensA = tokens(entry.name);
    let attached = false;
    if (tokensA.size >= 2) {
      for (const cluster of clusters) {
        if ((cluster.country || '') !== (entry.country || '')) continue;
        if (Math.abs(cluster.name.length - entry.name.length) > Math.max(6, entry.name.length * 0.35)) continue;
        if (jaccard(tokensA, cluster.tokens) >= 0.86) {
          const merged = mergeEntries(cluster.entry, entry);
          cluster.entry = merged;
          cluster.tokens = tokens(merged.name);
          stats.mergedVariants += 1;
          attached = true;
          break;
        }
      }
    }
    if (!attached) clusters.push({ entry, tokens: tokensA, country: entry.country || '', name: entry.name });
  }
  list = clusters.map((cluster) => cluster.entry);
  stats.output = list.length;

  return { entries: list, stats };
}

/** Prépare l'indexation : identifiants recalculés, ordre stable, positions cohérentes. */
export function finalizeEntries(entries) {
  return entries.map((entry, index) => ({
    ...entry,
    id: channelId(entry.urlNormalized || normalizeUrl(entry.url) || entry.url),
    position: index,
  }));
}
