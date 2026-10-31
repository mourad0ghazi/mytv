// server/core/engine.js — orchestration du moteur : catégorisation, reclassement, mesure (§2.3, §2.5).

import { buildKeywordTable, categorize, previewCategorize, categoryCounts } from './classify.js';
import { GENRE_GROUPS, CATEGORY_IDS, FALLBACK_CATEGORY } from './constants.js';
import { applyVisibilityRules } from './channels.js';

/** Catégorise une entrée avant écriture. */
export function classifyEntry(entry, keywordTable) {
  return categorize(entry, { keywordTable });
}

/** Reclassement d'une chaîne existante, sans toucher à une décision manuelle (A10). */
export function reclassifyChannel(channel, keywordTable) {
  if (channel.manualOverride) return { changed: false, locked: true, channel };
  const result = categorize({ ...channel, manualOverride: false }, { keywordTable });
  const changed = result.category !== channel.category
    || result.confidence !== channel.confidence
    || result.categorySource !== channel.categorySource;
  return {
    changed,
    locked: false,
    before: { category: channel.category, confidence: channel.confidence },
    after: { category: result.category, confidence: result.confidence },
    channel: {
      ...channel,
      category: result.category,
      categoryLabel: (awaitableLabel(result.category)),
      categorySource: result.categorySource,
      confidence: Math.round(result.confidence * 100) / 100,
      reasons: result.reasons,
    },
  };
}

function awaitableLabel(category) {
  // Table locale pour éviter une dépendance circulaire au moment du reclassement.
  const labels = {
    info: 'Info & Actualités', sport: 'Sport', cinema: 'Cinéma', series: 'Séries & Fiction',
    enfants: 'Enfants', musique: 'Musique', divertissement: 'Divertissement',
    documentaire: 'Documentaire', education: 'Éducation', cuisine: 'Cuisine', voyage: 'Voyage',
    sante: 'Santé & Bien-être', sciences: 'Sciences & Technologie', religion: 'Religion',
    regional: 'Régional', adulte: 'Adulte (masquée par défaut)', publicite: 'Téléachat',
    autre: 'Autres',
  };
  return labels[category] || category;
}

/** Reclassement en masse : respecte A10 (manualOverride) et retourne un compte rendu. */
export function reclassifyAll(channels, rules, settings) {
  const keywordTable = buildKeywordTable(rules);
  let changed = 0;
  let locked = 0;
  const updatedAt = new Date().toISOString();
  for (const channel of channels) {
    if (channel.manualOverride) { locked += 1; continue; }
    const result = categorize({ ...channel, manualOverride: false }, { keywordTable });
    if (result.category !== channel.category
      || result.confidence !== channel.confidence
      || result.categorySource !== channel.categorySource) {
      channel.category = result.category;
      channel.categoryLabel = awaitableLabel(result.category);
      channel.categorySource = result.categorySource;
      channel.confidence = Math.round(result.confidence * 100) / 100;
      channel.reasons = result.reasons;
      channel.updatedAt = updatedAt;
      changed += 1;
    }
  }
  applyVisibilityRules(channels, settings);
  return { changed, locked, total: channels.length };
}

/**
 * Mesure du moteur (§2.3 / §2.5) : vitesse, accord avec le groupe d'origine,
 * part sous 0,45, confiance moyenne, distribution des décisions.
 */
export function measureEngine(channels, rules) {
  const keywordTable = buildKeywordTable(rules);
  const startedAt = process.hrtime.bigint();
  let comparable = 0;
  let agree = 0;
  let under = 0;
  let sum = 0;
  let autre = 0;
  const parDecision = { override: 0, genre: 0, tvgid: 0, name: 0, none: 0 };
  const confusions = new Map();

  for (const channel of channels) {
    const result = categorize({ ...channel, category: channel.category, manualOverride: channel.manualOverride }, { keywordTable });
    const groupKey = String(channel.group || '').toLowerCase();
    const expected = Object.prototype.hasOwnProperty.call(GENRE_GROUPS, groupKey) ? GENRE_GROUPS[groupKey] : '';
    if (expected) {
      comparable += 1;
      if (expected === result.category) agree += 1;
      else {
        const key = `${expected} → ${result.category}`;
        confusions.set(key, (confusions.get(key) || 0) + 1);
      }
    }
    if (result.confidence < 0.45) under += 1;
    sum += result.confidence;
    parDecision[result.categorySource] = (parDecision[result.categorySource] || 0) + 1;
    if (result.category === FALLBACK_CATEGORY) autre += 1;
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const total = channels.length || 1;
  return {
    total: channels.length,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    vitesse: Math.round(channels.length / (elapsedMs / 1000)),
    accordGenre: comparable ? Math.round((agree / comparable) * 1000) / 1000 : 0,
    comparable,
    sous045: Math.round((under / total) * 1000) / 1000,
    confianceMoyenne: Math.round((sum / total) * 100) / 100,
    partAutre: Math.round((autre / total) * 1000) / 1000,
    parDecision,
    topConfusions: [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([pair, count]) => ({ pair, count })),
    categories: categoryCounts(channels, { includeHidden: true }),
    targets: {
      vitesse: { value: Math.round(channels.length / (elapsedMs / 1000)), min: 5000 },
      accordGenre: { value: comparable ? Math.round((agree / comparable) * 1000) / 1000 : 0, min: 0.85 },
      sous045: { value: Math.round((under / total) * 1000) / 1000, max: 0.1 },
      confiance: { value: Math.round((sum / total) * 100) / 100, min: 0.8 },
      autre: { value: Math.round((autre / total) * 1000) / 1000, max: 0.15 },
    },
    generatedAt: new Date().toISOString(),
  };
}

export function confidenceHistogram(channels) {
  const buckets = [0, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
  const counts = buckets.slice(0, -1).map((min, index) => ({
    min, max: buckets[index + 1], count: 0,
  }));
  for (const channel of channels) {
    const value = Number(channel.confidence) || 0;
    for (let i = counts.length - 1; i >= 0; i -= 1) {
      if (value >= counts[i].min) { counts[i].count += 1; break; }
    }
  }
  return counts;
}

export function categoryDistribution(channels) {
  return CATEGORY_IDS.map((id) => ({
    id,
    count: channels.filter((c) => c.category === id).length,
  }));
}

export { previewCategorize, categorize, buildKeywordTable };
