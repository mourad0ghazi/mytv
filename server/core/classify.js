// server/core/classify.js — F-08 → F-11 : catégorisation en 5 étapes, formule fermée de confiance.
// La décision manuelle est absolue : elle n'est jamais recalculée (A6, ER-A05).

import { CATEGORY_BY_ID, CATEGORY_IDS, GENERIC_GROUPS, GENRE_GROUPS, TVG_GENRE_HINTS } from './constants.js';
import { normalizeKey, stripDiacritics } from './text.js';

/**
 * Base de mots-clés livrée. Poids implicite 1,00 ; le suffixe `|0.6` abaisse le poids.
 * Les entrées multi-mots sont comparées à la chaîne normalisée complète.
 */
export const DEFAULT_KEYWORDS = {
  info: [
    'info', 'infos', 'news', 'actualite|0.9', 'actualites', 'journal', 'jt', '24h', '24',
    'breaking', 'live news', 'noticias', 'nachrichten', 'notizie', 'press', 'africanews',
    'franceinfo', 'bfm', 'cnews', 'lci', 'france 24', 'euronews', 'al jazeera', 'aljazeera',
    'sky news', 'bbc news', 'cnn', 'dw', 'trt', 'rt', 'cgtn', 'i24', 'tv5monde info',
    'العربية', 'أخبار', 'اخبار', 'الاخبارية', 'إخبارية', 'الجزيرة', 'سكاي نيوز',
  ],
  sport: [
    'sport', 'sports', 'foot', 'football', 'soccer', 'calcio', 'futbol', 'futebol',
    'tennis', 'golf', 'nba', 'nfl', 'mlb', 'nhl', 'ufc', 'boxe', 'boxing', 'mma',
    'rugby', 'cyclisme', 'cycling', 'moto', 'motogp', 'rallye', 'formule 1', 'f1',
    'beinsports', 'bein sport', 'canal sport', 'eurosport', 'dazn', 'espn', 'skysports',
    'رياضة', 'رياضي', 'الرياضية', 'كورة', 'ملاعب',
  ],
  cinema: [
    'cinema', 'cinéma', 'ciné', 'cine', 'movie', 'movies', 'film', 'films', 'filmbox',
    'action', 'thriller', 'western', 'horreur', 'horror', 'sf', 'science fiction',
    'canal+ cinema', 'canal cinema', 'cinemax', 'hbo', 'starz', 'tcm', 'paramount',
    'أفلام', 'سينما', 'فيلم',
  ],
  series: [
    'series', 'série', 'serie', 'fiction', 'drama', 'dramas', 'novela', 'novelas',
    'feuilleton', 'sitcom', 'telefilm', 'telenovela', 'suspense', 'polar',
    'fox series', 'warner', 'netflix series', 'apple tv',
    'مسلسل', 'مسلسلات', 'دراما', 'حكايات',
  ],
  enfants: [
    'kids', 'kid', 'enfant', 'enfants', 'jeunesse', 'junior', 'cartoon', 'cartoons',
    'toon', 'animation', 'anime', 'manga', 'disney', 'nickelodeon', 'nick jr', 'cartoonito',
    'boomerang', 'baby tv', 'babytv', 'gulli', 'piwi', 'tiji', 'spacetoon', 'pogo',
    'أطفال', 'اطفال', 'كرتون', 'سبيستون', 'مجلة',
  ],
  musique: [
    'music', 'musique', 'musical', 'mtv', 'vh1', 'clips', 'hits', 'hit', 'charts',
    'radio', 'radios', 'nrj', 'trace', 'm6 music', 'skyrock', 'fun radio', 'virgin radio',
    'rotana', 'mazzika', 'nogoum', 'موسيقى', 'أغاني', 'اغاني', 'موسيقية', 'روتانا',
  ],
  divertissement: [
    'entertainment', 'divertissement', 'comedy', 'comedie', 'humour', 'fun', 'laugh',
    'variety', 'show', 'shows', 'reality', 'jeu', 'jeux', 'game', 'quiz', 'talk',
    'family', 'tlc', 'e!', 'bravo', 'tlc', 'comedy central',
    'ترفيه', 'ترفيهية', 'ضحك', 'كوميديا', 'مسابقات',
  ],
  documentaire: [
    'documentary', 'documentaire', 'documentaires', 'docs', 'doc', 'discovery',
    'national geographic', 'nat geo', 'natgeo', 'history', 'planete', 'planète',
    'animal planet', 'investigation', 'crime', 'science et vie', 'voyage documentaire',
    'وثائقي', 'وثائقية', 'ناشيونال جيوغرافيك',
  ],
  education: [
    'education', 'éducation', 'educatif', 'school', 'ecole', 'école', 'learn', 'learning',
    'academy', 'universite', 'université', 'cours', 'college', 'college', 'didactic',
    'savoir', 'knowledge', 'ted', 'campus',
    'تعليم', 'تعليمية', 'مدرسة', 'دروس', 'جامعة',
  ],
  cuisine: [
    'cooking', 'cuisine', 'food', 'chef', 'recipe', 'recipes', 'gastronomie', 'gourmet',
    'food network', 'tastemade', 'cuisine plus', 'my cuisine',
    'مطبخ', 'طبخ', 'طعام', 'أكلات',
  ],
  voyage: [
    'travel', 'voyage', 'voyages', 'tourism', 'tourisme', 'nature', 'wild', 'wildlife',
    'outdoor', 'adventure', 'explore', 'discovery hd', 'travel channel', 'meteo', 'météo',
    'weather', 'planete nature', 'escales',
    'سفر', 'سياحة', 'طبيعة', 'رحلات',
  ],
  sante: [
    'health', 'santé', 'sante', 'fitness', 'wellness', 'yoga', 'gym', 'sport santé',
    'medecine', 'médecine', 'medical', 'lifestyle', 'bien etre', 'bien-être', 'mindfulness',
    'صحة', 'صحية', 'لياقة', 'طب',
  ],
  sciences: [
    'science', 'sciences', 'technology', 'tech', 'tech24', 'techno', 'innovation',
    'space', 'nasa', 'espace', 'numerique', 'numérique', 'digital', 'informatique',
    'futura', 'usbek', '01net', 'gadget',
    'علوم', 'تكنولوجيا', 'تقنية', 'فضاء',
  ],
  religion: [
    'religion', 'religious', 'islam', 'islamic', 'muslim', 'quran', 'coran', 'sunnah',
    'hadith', 'mosque', 'church', 'gospel', 'catholic', 'christian', 'bible', 'faith',
    'spirituality', 'vatican', 'ewtn', 'daystar', 'salaf',
    'دين', 'ديني', 'قرآن', 'القرآن', 'إسلام', 'اسلام', 'سنة', 'خطبة', 'كنيسة',
  ],
  regional: [
    'regional', 'régional', 'region', 'région', 'local', 'province', 'provincial',
    'city', 'ville', 'commune', 'departement', 'département', 'territoire', 'pays',
    'reunion', 'réunion', 'antilles', 'caraibes', 'caraïbes', 'maghreb',
    'محلي', 'جهوي', 'إقليمي', 'ولاية',
  ],
  adulte: [
    'xxx', 'adult', 'adulte', 'adults', 'erotic', 'erotique', 'érotique', 'porn',
    'porno', '18+', '18 ans', 'sexy', 'playboy', 'hustler', 'brazzers', 'private',
  ],
  publicite: [
    'shop', 'shopping', 'teleshopping', 'téléachat', 'teleachat', 'téléshopping',
    'qvc', 'hse', 'home shopping', 'boutique', 'promo', 'deals', 'market',
    'بيع', 'تسوق', 'تخفيضات',
  ],
};

const WEIGHT_RE = /\|([\d.]+)$/;

function tokenize(value) {
  const normal = normalizeKey(value);
  return normal ? normal.split(' ') : [];
}

export function compileRules(custom = {}, base = DEFAULT_KEYWORDS) {
  const table = new Map();
  const add = (category, rawKeyword) => {
    if (!CATEGORY_IDS.includes(category)) return;
    const [keyword, weightText] = rawKeyword.split(WEIGHT_RE);
    const key = normalizeKey(keyword);
    if (!key) return;
    const weight = weightText ? Number(weightText) : 1;
    if (!table.has(key)) table.set(key, new Map());
    const entry = table.get(key);
    entry.set(category, Math.max(entry.get(category) || 0, weight));
  };
  for (const [category, keywords] of Object.entries(base)) {
    for (const keyword of keywords) add(category, keyword);
  }
  for (const [category, keywords] of Object.entries(custom || {})) {
    if (!Array.isArray(keywords)) continue;
    for (const keyword of keywords) add(category, String(keyword));
  }
  return table;
}

/** Scores par catégorie : multi-mots d'abord, tokens ensuite, bonus de position. */
export function scoreName(name, table, { group = '' } = {}) {
  const scores = new Map();
  const hits = new Map();
  const key = normalizeKey(name);
  if (!key) return { scores, hits, key };
  const tokens = key.split(' ');

  const bump = (category, weight, label) => {
    scores.set(category, (scores.get(category) || 0) + weight);
    if (!hits.has(category)) hits.set(category, []);
    if (!hits.get(category).includes(label)) hits.get(category).push(label);
  };

  for (const [keyword, categories] of table) {
    if (!keyword) continue;
    let found = false;
    if (keyword.includes(' ')) {
      if (` ${key} `.includes(` ${keyword} `)) found = true;
    } else {
      const position = tokens.indexOf(keyword);
      if (position >= 0) {
        found = true;
        for (const [category, weight] of categories) {
          const bonus = weight + (position === 0 ? 0.25 : 0);
          bump(category, bonus, keyword);
        }
      }
    }
    if (found && keyword.includes(' ')) {
      for (const [category, weight] of categories) bump(category, weight, keyword);
    }
  }

  // Le nom de catégorie porté par le groupe renforce modérément le score (jamais une certitude).
  const groupCategory = GENRE_GROUPS[normalizeKey(group)];
  if (groupCategory && scores.has(groupCategory)) {
    scores.set(groupCategory, scores.get(groupCategory) + 0.15);
  }
  return { scores, hits, key };
}

function isToponymOnly(name) {
  const key = normalizeKey(name);
  if (!key) return true;
  const words = key.split(' ');
  const meaningful = words.filter((word) => !['tv', 'hd', 'channel', 'chaine', 'live', 'the', 'la', 'le', 'les', 'de', 'du'].includes(word));
  return meaningful.length <= 1;
}

/** F-10 + F-11 : décision complète et justifiée. */
export function classify(channel, { table = compileRules(), rulesVersion = '' } = {}) {
  const name = channel.name || channel.rawName || '';
  const group = channel.group || '';
  const tvgId = channel.tvgId || '';
  const reasons = [];

  // Étape 1 — décision manuelle.
  if (channel.manualOverride && channel.category && CATEGORY_IDS.includes(channel.category)) {
    return {
      category: channel.category,
      confidence: 0.99,
      source: 'manual',
      reasons: ['décision manuelle conservée'],
      scores: {},
    };
  }

  // Étape 2 — groupe de playlist.
  const groupKey = normalizeKey(group);
  const groupCategory = GENRE_GROUPS[groupKey];
  if (groupCategory) {
    return {
      category: groupCategory,
      confidence: 0.9,
      source: 'genre',
      reasons: [`groupe « ${group} » associé à « ${groupCategory} »`],
      scores: {},
    };
  }
  const groupIsGeneric = GENERIC_GROUPS.has(groupKey);

  // Étape 3 — indice porté par le tvg-id.
  const tvgParts = stripDiacritics(tvgId).toLowerCase().split(/[.\-_]/).filter(Boolean);
  for (const part of tvgParts) {
    const hinted = TVG_GENRE_HINTS[part];
    if (hinted) {
      return {
        category: hinted,
        confidence: 0.8,
        source: 'tvg-id',
        reasons: [`identifiant « ${tvgId} » contient « ${part} »`],
        scores: {},
      };
    }
  }

  // Étape 4 — mots-clés du nom.
  const { scores, hits } = scoreName(name, table, { group });
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const [bestCategory, bestScore] = ranked[0];
    const [, secondScore] = ranked[1] || [bestCategory, 0];
    const total = ranked.reduce((sum, [, value]) => sum + value, 0);
    const share = total > 0 ? bestScore / total : 0;
    const margin = bestScore > 0 ? (bestScore - secondScore) / bestScore : 0;
    const strong = (hits.get(bestCategory) || []).length > 0;
    let confidence = 0.3 + 0.4 * share + 0.2 * margin + (strong ? 0.08 : 0);
    if (isToponymOnly(name)) confidence -= 0.12;
    if (bestCategory === 'adulte') confidence = Math.max(confidence, 0.9);
    confidence = Math.min(0.95, Math.max(0.15, Math.round(confidence * 100) / 100));
    for (const [category, value] of ranked.slice(0, 3)) {
      reasons.push(`« ${category} » ${value.toFixed(2)} via ${(hits.get(category) || []).slice(0, 3).join(', ')}`);
    }
    if (groupIsGeneric || !group) reasons.push('groupe non discriminant');
    return {
      category: bestCategory,
      confidence,
      source: 'name',
      reasons,
      scores: Object.fromEntries(ranked.slice(0, 4)),
      decidedBy: 'name',
      share,
      margin,
    };
  }

  // Étape 5 — repli neutre, documenté et mesuré.
  // Un groupe générique ou national sans mot-clé identifiable désigne une chaîne généraliste :
  // on la range dans « Divertissement » avec une confiance moyenne, jamais dans « Autre » par défaut.
  const nonEmptyGroup = Boolean(normalizeKey(group));
  if (nonEmptyGroup) {
    return {
      category: 'divertissement',
      confidence: 0.55,
      source: 'fallback',
      reasons: [
        `aucun mot-clé de genre dans « ${name} »`,
        `groupe « ${group} » généraliste → divertissement`,
      ],
      scores: {},
    };
  }
  return {
    category: 'autre',
    confidence: 0.3,
    source: 'fallback',
    reasons: ['aucun mot-clé reconnu et aucun groupe : classement neutre'],
    scores: {},
  };
}

/** Reclassement en lot, sans toucher aux décisions manuelles ; retourne le nombre de changements. */
export function reclassifyAll(channels, { table, rulesVersion = '' } = {}) {
  let changed = 0;
  for (const channel of channels) {
    if (channel.manualOverride) continue;
    const result = classify(channel, { table, rulesVersion });
    if (result.category !== channel.category || Math.abs(result.confidence - channel.confidence) > 0.001) {
      channel.category = result.category;
      channel.categoryLabel = (CATEGORY_BY_ID[result.category] || CATEGORY_BY_ID.autre).label;
      channel.categorySource = result.source;
      channel.confidence = result.confidence;
      channel.reasons = result.reasons.slice(0, 4);
      changed += 1;
    }
  }
  return changed;
}

/** File « à vérifier » : confiance sous le plancher et décision non manuelle. */
export function reviewQueue(channels, floor = 0.45, limit = 20) {
  return channels
    .filter((channel) => !channel.manualOverride && channel.confidence < floor)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, limit)
    .map((channel) => ({
      id: channel.id,
      number: channel.number,
      name: channel.name,
      category: channel.category,
      categoryLabel: channel.categoryLabel,
      confidence: channel.confidence,
      reasons: channel.reasons,
      group: channel.group,
    }));
}

/** Classe une entrée de playlist en respectant une éventuelle décision manuelle existante. */
export function categorizeEntry(entry, table, existing = null) {
  const subject = {
    name: entry.name,
    rawName: entry.rawName,
    group: entry.group,
    tvgId: entry.tvgId,
    category: existing?.manualOverride ? existing.category : '',
    manualOverride: Boolean(existing?.manualOverride),
  };
  if (existing?.manualOverride) {
    return {
      category: existing.category,
      confidence: Math.max(0.9, existing.confidence || 0.9),
      source: 'manual',
      reasons: ['décision manuelle conservée'],
      scores: {},
    };
  }
  return classify(subject, { table });
}
