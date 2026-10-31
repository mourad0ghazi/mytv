// server/core/search.js — F-17 (index insensible aux accents), F-18 (recherche), F-19 (pagination).
// L'index ne contient que des identifiants : la vérité reste le tableau de chaînes du store.

import { CATEGORIES, LIMITS, QUALITY_RANK, SORTS } from './constants.js';
import { isPublic } from './channels.js';
import { normalizeKey, normalizeQuery } from './text.js';

const STOPWORDS = new Set(['tv', 'la', 'le', 'les', 'de', 'du', 'des', 'the', 'and', 'of', 'a', 'en', 'el']);

// Noms de pays et de langues en français et en anglais : « maroc » doit trouver les chaînes du Maroc.
const regionFr = new Intl.DisplayNames(['fr'], { type: 'region' });
const regionEn = new Intl.DisplayNames(['en'], { type: 'region' });
const languageFr = new Intl.DisplayNames(['fr'], { type: 'language' });

function regionLabels(code) {
  if (!code) return '';
  const labels = [];
  for (const display of [regionFr, regionEn]) {
    try {
      const label = display.of(code);
      if (label && label !== code) labels.push(label);
    } catch { /* code inconnu */ }
  }
  return labels.join(' ');
}

function languageLabel(code) {
  if (!code) return '';
  try {
    const label = languageFr.of(code);
    return label && label !== code ? label : '';
  } catch { return ''; }
}

export class SearchIndex {
  constructor() {
    this.postings = new Map();
    this.names = new Map();
    this.byId = new Map();
    this.size = 0;
  }

  addTokens(tokens, id) {
    for (const token of tokens) {
      if (!token) continue;
      if (!this.postings.has(token)) this.postings.set(token, new Set());
      this.postings.get(token).add(id);
    }
  }

  add(channel) {
    this.remove(channel.id);
    const fields = [
      channel.name,
      channel.group,
      channel.tvgName,
      channel.country,
      regionLabels(channel.country),
      channel.language,
      languageLabel(channel.language),
      (channel.tags || []).join(' '),
      channel.categoryLabel,
      channel.category,
      `numero ${channel.number}`,
      String(channel.number),
    ];
    const key = normalizeKey([channel.name, channel.group, channel.tvgName, channel.country,
      regionLabels(channel.country), channel.language, languageLabel(channel.language), channel.categoryLabel].join(' '));
    this.names.set(channel.id, { key, name: normalizeKey(channel.name), number: String(channel.number) });
    const tokens = new Set();
    for (const field of fields) {
      for (const token of normalizeKey(field).split(' ')) {
        if (!token) continue;
        tokens.add(token);
        if (/\d/.test(token)) {
          for (let i = 1; i <= token.length; i += 1) tokens.add(token.slice(0, i));
        }
      }
    }
    for (const token of STOPWORDS) tokens.delete(token);
    this.addTokens(tokens, channel.id);
    this.byId.set(channel.id, channel);
    this.size = this.byId.size;
  }

  remove(id) {
    if (!this.byId.has(id)) return;
    for (const [token, ids] of this.postings) {
      if (ids.delete(id) && !ids.size) this.postings.delete(token);
    }
    this.names.delete(id);
    this.byId.delete(id);
    this.size = this.byId.size;
  }

  rebuild(channels) {
    this.postings.clear();
    this.names.clear();
    this.byId.clear();
    for (const channel of channels) this.add(channel);
    this.size = this.byId.size;
    return this;
  }

  /** Recherche : tous les jetons doivent correspondre ; les préfixes sont acceptés. */
  search(query, predicate = null) {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const tokens = normalized.split(' ').filter(Boolean);
    let results = null;
    for (const token of tokens) {
      let ids = this.postings.get(token);
      if (!ids) {
        // Repli préfixe (« mar » → « maroc ») et, pour l'arabe, radical interne
        // (« جزيرة » → « الجزيرة »), sans quoi la recherche arabe serait inutilisable.
        const union = new Set();
        const arabic = /[\u0600-\u06ff]/.test(token);
        for (const [key, values] of this.postings) {
          const matches = key.startsWith(token)
            || (arabic && token.length >= 2 && key.includes(token));
          if (matches && key.length <= token.length + 18) {
            for (const id of values) union.add(id);
          }
        }
        ids = union;
      }
      if (!ids || !ids.size) return [];
      results = results ? new Set([...results].filter((id) => ids.has(id))) : new Set(ids);
      if (!results.size) return [];
    }
    const scored = [];
    for (const id of results) {
      const channel = this.byId.get(id);
      if (!channel) continue;
      if (predicate && !predicate(channel)) continue;
      scored.push({ channel, score: this.score(channel, normalized) });
    }
    scored.sort((a, b) => b.score - a.score || a.channel.number - b.channel.number);
    return scored.map((item) => item.channel);
  }

  score(channel, normalized) {
    const meta = this.names.get(channel.id);
    if (!meta) return 0;
    let score = 0;
    if (meta.name === normalized) score += 100;
    else if (meta.name.startsWith(normalized)) score += 60;
    else if (meta.name.includes(normalized)) score += 30;
    if (meta.number === normalized) score += 50;
    if (meta.key.includes(normalized)) score += 10;
    score -= Math.min(9, meta.name.length / 12);
    return score;
  }

  suggestions(query, limit = 4) {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const prefix = normalized.split(' ')[0];
    const counts = new Map();
    for (const [token, ids] of this.postings) {
      if (token.startsWith(prefix) && token !== prefix && token.length > 2) {
        counts.set(token, (counts.get(token) || 0) + ids.size);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([token]) => token);
  }
}

/* ------------------------------------------------------------------ filtres */

export function buildPredicate(filters = {}, settings = {}) {
  const category = filters.category || '';
  const country = (filters.country || '').toUpperCase();
  const language = (filters.language || '').toLowerCase();
  const quality = (filters.quality || '').toUpperCase();
  const health = (filters.health || '').toLowerCase();
  const featured = filters.featured;
  const visibility = filters.visibility || 'public';
  const ids = filters.ids ? new Set(filters.ids) : null;

  return (channel) => {
    if (ids && !ids.has(channel.id)) return false;
    if (visibility === 'public' && !isPublic(channel, settings)) return false;
    if (visibility === 'hidden' && isPublic(channel, settings)) return false;
    if (category && channel.category !== category) return false;
    if (country && channel.country !== country) return false;
    if (language && channel.language !== language) return false;
    if (quality && channel.quality !== quality) return false;
    if (health && channel.health?.status !== health) return false;
    if (featured === true && !channel.featured) return false;
    if (featured === false && channel.featured) return false;
    return true;
  };
}

/* ------------------------------------------------------------------ tri */

const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map((category, index) => [category.id, index]));

export function sortChannels(channels, sort = 'number') {
  const key = SORTS.includes(sort) ? sort : 'number';
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const copy = [...channels];
  copy.sort((a, b) => {
    switch (key) {
      case 'name': return collator.compare(a.name, b.name) || a.number - b.number;
      case 'category': return (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99) || a.number - b.number;
      case 'recent': return String(b.createdAt).localeCompare(String(a.createdAt)) || a.number - b.number;
      case 'confidence': return b.confidence - a.confidence || a.number - b.number;
      case 'quality': return (QUALITY_RANK[b.quality] || 0) - (QUALITY_RANK[a.quality] || 0) || a.number - b.number;
      default: return a.number - b.number;
    }
  });
  return copy;
}

/* ------------------------------------------------------------------ pagination */

export function paginate(list, page = 1, pageSize = LIMITS.pageSizeDefault) {
  const size = Math.min(LIMITS.pageSizeMax, Math.max(1, Math.floor(Number(pageSize) || LIMITS.pageSizeDefault)));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  const start = (current - 1) * size;
  const items = list.slice(start, start + size);
  return {
    items,
    total,
    page: current,
    pages,
    pageSize: size,
    hasMore: current < pages,
    start,
    end: start + items.length,
  };
}

export function clampPageSize(value) {
  const number = Math.floor(Number(value) || LIMITS.pageSizeDefault);
  return Math.min(LIMITS.pageSizeMax, Math.max(LIMITS.pageSizeMin, number));
}
