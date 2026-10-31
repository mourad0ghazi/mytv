// server/core/learning.js — F-22 : apprendre des corrections manuelles, sans dépendance.
// Principe : un mot qui revient dans les corrections vers une catégorie devient un indice pondéré
// (TF-IDF simple). Les règles manuelles restent prioritaires : apprendre ne réécrit jamais une
// décision explicite.

import { CATEGORY_IDS } from './constants.js';
import { normalizeKey } from './text.js';

/** Mots trop fréquents ou trop techniques pour distinguer une catégorie. */
export const STOPWORDS = Object.freeze(new Set([
  'tv', 'live', 'channel', 'chaine', 'chaine', 'hd', 'fhd', 'uhd', 'sd', '4k', '2160', '1080', '720', '480',
  'plus', 'direct', 'stream', 'streaming', 'official', 'officiel', 'ar', 'en', 'fr', 'the', 'and', 'of',
  'la', 'le', 'les', 'de', 'du', 'des', 'et', 'un', 'une', 'el', 'al', 'be', 'bi',
]));

const SUFFIX_RE = /\b(?:hd|fhd|uhd|sd|4k|1080p?|720p?|480p?|2160p?|hevc|h265)\b/gi;
const MIN_TERM = 3;
const MAX_TERM = 24;
const MAX_TERMS_PER_CATEGORY = 60;

/** Découpe un nom de chaîne en termes utiles : sans accents, sans qualité, sans mots vides. */
export function tokenizeName(name) {
  const cleaned = String(name || '').replace(SUFFIX_RE, ' ');
  const key = normalizeKey(cleaned);
  if (!key) return [];
  const terms = [];
  for (const raw of key.split(' ')) {
    const term = raw.trim();
    if (term.length < MIN_TERM || term.length > MAX_TERM) continue;
    if (STOPWORDS.has(term)) continue;
    if (/^\d+$/.test(term)) continue;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * F-22 — corrections → règles pondérées.
 * Entrée : [{ name, from, to, at }]. Sortie : { category: ['terme|0.62', …] } + statistiques.
 * Une correction vers « autre » n'apprend rien : c'est un aveu d'ignorance, pas une règle.
 */
export function learnFromCorrections(corrections, { minSupport = 2, maxPerCategory = MAX_TERMS_PER_CATEGORY } = {}) {
  const list = Array.isArray(corrections) ? corrections : [];
  const termCounts = new Map(); // terme → Map(catégorie → nombre)
  const perCategoryTotal = new Map();
  let usable = 0;

  for (const correction of list) {
    const to = String(correction?.to || '');
    if (!CATEGORY_IDS.includes(to) || to === 'autre') continue;
    const name = correction?.name || '';
    const terms = tokenizeName(name);
    if (!terms.length) continue;
    usable += 1;
    perCategoryTotal.set(to, (perCategoryTotal.get(to) || 0) + terms.length);
    for (const term of terms) {
      if (!termCounts.has(term)) termCounts.set(term, new Map());
      const bucket = termCounts.get(term);
      bucket.set(to, (bucket.get(to) || 0) + 1);
    }
  }

  // df = nombre de catégories distinctes où le terme apparaît (le « document » est une catégorie).
  const corpus = Math.max(1, CATEGORY_IDS.length);
  const scored = new Map(); // catégorie → [{ term, score }]
  for (const [term, bucket] of termCounts) {
    const df = bucket.size;
    const total = [...bucket.values()].reduce((sum, value) => sum + value, 0);
    const idf = Math.log((1 + corpus) / (1 + df)) + 1;
    for (const [category, count] of bucket) {
      if (count < minSupport) continue;
      const tf = count / Math.max(1, total);
      const score = tf * idf;
      if (!scored.has(category)) scored.set(category, []);
      scored.get(category).push({ term, score, count });
    }
  }

  // Normalisation globale : un indice fort vaut plus qu'un indice rare, d'une catégorie à l'autre.
  const globalBest = Math.max(1e-6, ...[...scored.values()].flat().map((entry) => entry.score));
  const rules = {};
  for (const category of CATEGORY_IDS) {
    const entries = scored.get(category);
    if (!entries || !entries.length) continue;
    entries.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    rules[category] = entries.slice(0, maxPerCategory).map(({ term, score }) => {
      // Poids borné à [0,30 ; 0,90] : jamais au-dessus d'une règle manuelle, qui vaut 1.
      const weight = round(0.3 + 0.6 * Math.min(1, score / globalBest), 2);
      return `${term}|${weight}`;
    });
  }

  const terms = Object.values(rules).reduce((sum, entries) => sum + entries.length, 0);
  return {
    rules,
    stats: {
      corrections: list.length,
      usable,
      categories: Object.keys(rules).length,
      terms,
      minSupport,
      perCategory: Object.fromEntries(perCategoryTotal),
    },
  };
}

/**
 * Fusionne règles manuelles et règles apprises. L'ordre compte : compileRules garde le poids
 * maximal par couple (mot, catégorie), donc une règle manuelle (poids 1) ne peut pas être
 * affaiblie par un apprentissage.
 */
export function mergeRules(manual = {}, learned = {}) {
  const merged = {};
  for (const [category, keywords] of Object.entries(manual || {})) {
    if (!Array.isArray(keywords)) continue;
    merged[category] = keywords.map((keyword) => String(keyword));
  }
  for (const [category, keywords] of Object.entries(learned || {})) {
    if (!Array.isArray(keywords)) continue;
    const existing = merged[category] || [];
    const seen = new Set(existing.map((keyword) => normalizeKey(String(keyword).split('|')[0])));
    for (const keyword of keywords) {
      const term = normalizeKey(String(keyword).split('|')[0]);
      if (!term || seen.has(term)) continue;
      seen.add(term);
      existing.push(String(keyword));
    }
    merged[category] = existing;
  }
  return merged;
}

/** Jeu de règles effectif : manuel d'abord, appris ensuite. */
export function effectiveRules(learning = {}) {
  return mergeRules(learning.rules || {}, learning.learned || {});
}
