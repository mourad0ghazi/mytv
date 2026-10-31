// demo-api.js — remplace public/js/api.js dans la démonstration statique publiée sur GitHub Pages.
// Même surface publique (api, auth, ApiError, download, Admin), mêmes formes de réponse que le
// serveur Node, mais les données viennent d'un instantané JSON du catalogue. Lecture seule.

import { BASE, withBase } from './base.js?v=3.18.0';

const TOKEN_KEY = 'streamtv.token';
const PAGE_MIN = 12;
const PAGE_MAX = 60;

export class ApiError extends Error {
  constructor(message, { code = 'ERR-18', status = 0, field = '', requestId = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
    this.requestId = requestId;
  }
}

export const auth = {
  token: () => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* stockage indisponible */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ }
  },
  isSignedIn() { return Boolean(auth.token()); },
};

/* ------------------------------------------------------------------ données */

const cache = new Map();

/** Version de la publication, remplacée à la construction : elle périme toute copie ancienne. */
const PUBLICATION = '3.18.0';

/** Délai au-delà duquel une donnée manquante est dite manquante, plutôt qu'attendue sans fin. */
const DELAI_DONNEES = Number(globalThis.STREAMTV_DELAI_DONNEES) > 0
  ? Number(globalThis.STREAMTV_DELAI_DONNEES)
  : 12_000;

/**
 * Charge un instantané JSON une seule fois. Trois garanties, apprises d'un écran resté
 * bloqué sur « Recherche en cours » : l'adresse porte la version de la publication, donc
 * aucune copie ancienne ne peut être resservie ; un délai maximum interrompt l'attente ;
 * un échec est oublié, pour qu'un nouvel essai redemande vraiment le fichier.
 */
async function snapshot(name) {
  if (cache.has(name)) return cache.get(name);
  const pending = (async () => {
    const adresse = `${withBase(`demo/${name}.json`)}?v=${PUBLICATION}`;
    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), DELAI_DONNEES);
    let response;
    try {
      response = await fetch(adresse, {
        credentials: 'same-origin', cache: 'no-cache', signal: controleur.signal,
      });
    } catch (error) {
      throw new ApiError(error?.name === 'AbortError'
        ? 'Le catalogue met trop de temps à arriver. Vérifiez la connexion, puis touchez « Réessayer ».'
        : 'La connexion a été interrompue. Vérifiez votre réseau puis réessayez.', { code: 'P-09' });
    } finally {
      clearTimeout(minuterie);
    }
    if (!response.ok) {
      throw new ApiError('Le catalogue de démonstration est introuvable. Rechargez la page.', { code: 'ERR-18' });
    }
    try {
      return await response.json();
    } catch {
      throw new ApiError('Le catalogue reçu est incomplet. Rechargez la page pour le retélécharger.', { code: 'ERR-18' });
    }
  })();
  // Un échec n'est jamais gardé : le bouton « Réessayer » refait une vraie demande.
  const suivi = pending.catch((error) => {
    cache.delete(name);
    throw error;
  });
  cache.set(name, suivi);
  return suivi;
}

const plain = (text) => String(text ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

/* ------------------------------------------------------------------ requêtes */

function number(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SORTERS = {
  number: (a, b) => a.card.number - b.card.number || a.card.id.localeCompare(b.card.id),
  name: (a, b) => a.card.name.localeCompare(b.card.name, 'fr', { sensitivity: 'base' }) || a.card.number - b.card.number,
  category: (a, b) => String(a.card.categoryLabel).localeCompare(String(b.card.categoryLabel), 'fr', { sensitivity: 'base' }) || a.card.number - b.card.number,
  recent: (a, b) => String(b.card.createdAt || '').localeCompare(String(a.card.createdAt || '')) || a.card.number - b.card.number,
};

function matches(entry, filters) {
  const card = entry.card;
  if (filters.ids && !filters.ids.has(card.id)) return false;
  if (filters.category && card.category !== filters.category) return false;
  if (filters.country && card.country !== filters.country) return false;
  if (filters.language && card.language !== filters.language) return false;
  if (filters.quality && card.quality !== filters.quality) return false;
  if (filters.health && (card.health || 'unknown') !== filters.health) return false;
  if (filters.q) {
    const words = plain(filters.q).split(/\s+/).filter(Boolean);
    if (words.length && !words.every((word) => entry.hay.includes(word))) return false;
  }
  return true;
}

async function list(params, { search = false } = {}) {
  // Premier écran : cartes et index de recherche seulement, trois fois plus léger que le
  // catalogue complet, qui n'est ouvert qu'à l'ouverture d'une fiche.
  const catalog = await snapshot('cards');
  const filters = {
    category: params.get('category') || '',
    country: params.get('country') || '',
    language: params.get('language') || '',
    quality: params.get('quality') || '',
    health: params.get('health') || '',
    q: (params.get('q') || '').trim(),
  };
  const ids = String(params.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length) filters.ids = new Set(ids.slice(0, PAGE_MAX));
  const sort = SORTERS[params.get('sort')] ? params.get('sort') : 'number';
  const pageSize = Math.min(PAGE_MAX, Math.max(PAGE_MIN, number(params.get('pageSize'), 48)));
  const found = catalog.filter((entry) => matches(entry, filters));
  // Un numéro exact passe devant (même règle que l'index de recherche du serveur).
  if (filters.q && /^\d+$/.test(filters.q)) {
    const wanted = Number(filters.q);
    found.sort((a, b) => ((b.card.number === wanted) - (a.card.number === wanted)) || SORTERS[sort](a, b));
  } else {
    found.sort(SORTERS[sort]);
  }
  const total = found.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, number(params.get('page'), 1)));
  const slice = found.slice((page - 1) * pageSize, page * pageSize);
  return {
    channels: slice.map((entry) => entry.card),
    page,
    pageSize,
    pages,
    total,
    hasMore: page < pages,
    meta: {
      query: filters.q,
      search,
      suggestions: [],
      filters: { category: filters.category, country: filters.country, language: filters.language, quality: filters.quality, health: filters.health },
    },
  };
}

async function detail(id) {
  const catalog = await snapshot('catalog');
  const entry = catalog.find((item) => item.card.id === id);
  if (!entry) throw new ApiError('Chaîne introuvable.', { code: 'ERR-10', status: 404 });
  const canal = entry.detail;
  const nom = plain(canal.rawName || canal.name);
  const tvgId = String(canal.tvgId || '').trim().toLowerCase();
  const alternatives = catalog
    .filter((item) => item.card.id !== canal.id && item.detail.url)
    .filter((item) => (tvgId && String(item.detail.tvgId || '').trim().toLowerCase() === tvgId)
      || (nom && plain(item.detail.rawName || item.detail.name) === nom))
    .slice(0, 6)
    .map((item) => ({
      id: item.card.id,
      name: item.card.name,
      number: item.card.number,
      quality: item.card.quality || 'AUTO',
      url: item.detail.url,
      blockedReason: item.card.blockedReason || '',
      match: tvgId && String(item.detail.tvgId || '').trim().toLowerCase() === tvgId ? 'tvg-id' : 'nom',
    }));
  const related = catalog
    .filter((item) => item.card.id !== canal.id && item.card.category === canal.category)
    .slice(0, 8)
    .map((item) => item.card);
  return { channel: canal, related, alternatives };
}

const ANIME_SECTIONS = [
  ['simulcast', 'Simulcast'],
  ['classiques', 'Classiques'],
  ['films_animation', 'Films d’animation'],
];

const slug = (value) => plain(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function vodHay(item) {
  return plain([
    item.title, item.originalTitle, item.studio || '', item.director || '', ...(item.genres || []),
  ].join(' '));
}

/** Les deux catalogues suivent le même contrat que le serveur : filtres, pages, rangées. */
async function vodList(kind, params) {
  const donnees = await snapshot(kind === 'anime' ? 'anime' : 'films');
  const all = donnees.items || [];
  const genre = (params.get('genre') || '').trim();
  const year = Number(params.get('annee') || params.get('year') || 0) || null;
  const language = (params.get('langue') || params.get('language') || '').toUpperCase();
  const status = (params.get('statut') || '').trim().toLowerCase();
  const needle = plain((params.get('q') || '').trim());
  const words = needle.split(/\s+/).filter(Boolean);

  const filtered = all.filter((item) => {
    if (genre && !(item.genres || []).some((value) => plain(value) === plain(genre))) return false;
    if (year && item.year !== year) return false;
    if (language && item.language !== language) return false;
    if (status && item.status !== status) return false;
    if (words.length && !words.every((word) => vodHay(item).includes(word))) return false;
    return true;
  });
  const sorted = kind === 'anime'
    ? [...filtered].sort((a, b) => (b.year - a.year) || a.title.localeCompare(b.title, 'fr'))
    : [...filtered];

  const pageSize = Math.min(60, Math.max(1, number(params.get('pageSize'), 48)));
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, number(params.get('page'), 1)));
  const items = sorted.slice((page - 1) * pageSize, page * pageSize);

  const rows = [];
  if (kind === 'anime') {
    for (const [id, title] of ANIME_SECTIONS) {
      const rowItems = sorted.filter((item) => item.section === id).slice(0, 18);
      if (rowItems.length) rows.push({ id, title, items: rowItems });
    }
  } else {
    if (sorted.length) rows.push({ id: 'recents', title: 'Ajoutés récemment', items: sorted.slice(0, 12) });
    const counts = new Map();
    for (const item of sorted) for (const value of item.genres || []) counts.set(value, (counts.get(value) || 0) + 1);
    const genres = [...counts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'fr'))
      .slice(0, 6)
      .map(([label]) => label);
    for (const label of genres) {
      const rowItems = sorted.filter((item) => (item.genres || []).includes(label)).slice(0, 12);
      if (rowItems.length) rows.push({ id: `genre-${slug(label)}`, genre: label, title: label, items: rowItems });
    }
  }

  const byGenre = kind === 'film' ? rows.filter((row) => row.genre) : [];
  return {
    total, page, pageSize, pages, items, rows,
    facets: donnees.facets || { genres: [], years: [], languages: [], statuses: [] },
    ...(kind === 'film' ? { byGenre } : {}),
  };
}

async function vodDetail(kind, id) {
  const map = await snapshot(kind === 'anime' ? 'anime-details' : 'film-details');
  const payload = map?.[id];
  if (!payload) {
    throw new ApiError(kind === 'anime' ? 'Anime introuvable.' : 'Film introuvable.', {
      code: 'ERR-10', status: 404,
    });
  }
  return payload;
}

/** Recherche globale : chaînes, anime et films, chaque résultat nomme sa famille. */
async function searchAll(query, limit) {
  const needle = plain(query || '');
  if (!needle) return { query: '', total: 0, results: [] };
  const words = needle.split(/\s+/).filter(Boolean);
  const scored = [];

  const cards = await snapshot('cards');
  const channelMatches = cards.filter((entry) => words.every((word) => entry.hay.includes(word))).slice(0, limit * 2);
  channelMatches.forEach((entry, index) => {
    const card = entry.card;
    scored.push({
      score: Math.max(40, 95 - index),
      item: {
        kind: 'chaine', kindLabel: 'Chaîne', id: card.id, title: card.name, name: card.name,
        subtitle: `${card.categoryLabel} · Chaîne ${card.number}`, href: `/chaine/${card.id}`,
        poster: card.logo || '', number: card.number, licence: '', hue: card.hue,
      },
    });
  });

  for (const kind of ['anime', 'films']) {
    const donnees = await snapshot(kind);
    for (const item of donnees.items || []) {
      const hay = vodHay(item);
      if (!words.every((word) => hay.includes(word))) continue;
      const titleKey = plain(item.title);
      const originalKey = plain(item.originalTitle || '');
      let score = 55;
      if (titleKey === needle || originalKey === needle) score = 100;
      else if (titleKey.startsWith(needle) || originalKey.startsWith(needle)) score = 85;
      else if (titleKey.includes(needle) || originalKey.includes(needle)) score = 70;
      const isAnime = kind === 'anime';
      scored.push({
        score: score + (isAnime ? 2 : 1),
        item: {
          kind: isAnime ? 'anime' : 'film',
          kindLabel: isAnime ? 'Anime' : 'Film',
          id: item.id, title: item.title, name: item.title,
          subtitle: isAnime
            ? `${item.year} · ${item.language} · ${item.episodeCount} ép.`
            : `${item.year} · ${item.language}${(item.genres || []).length ? ` · ${item.genres[0]}` : ''}`,
          href: isAnime ? `/anime/${item.id}` : `/film/${item.id}`,
          poster: item.poster || '', year: item.year, licence: item.licence, hue: item.hue,
        },
      });
    }
  }

  scored.sort((a, b) => (b.score - a.score) || a.item.title.localeCompare(b.item.title, 'fr'));
  return {
    query,
    total: scored.length,
    results: scored.slice(0, limit).map((entry) => entry.item),
  };
}

async function epg(hours) {
  let payload;
  try {
    payload = await snapshot('epg');
  } catch {
    payload = { enabled: false };
  }
  if (!payload || !payload.enabled) return payload || { enabled: false };
  const limit = new Date(Date.now() + Math.max(1, Math.min(48, hours)) * 3600 * 1000).toISOString();
  const grid = (payload.grid || []).map((row) => ({
    ...row,
    programmes: row.programmes.filter((programme) => programme.start <= limit),
  }));
  return { ...payload, grid, to: limit, cached: true };
}

async function epgNow(ids) {
  let payload;
  try {
    payload = await snapshot('epg-now');
  } catch {
    return { enabled: false, now: [] };
  }
  if (!payload || !payload.enabled) return { enabled: false, now: [] };
  const wanted = new Set(String(ids || '').split(',').map((id) => id.trim()).filter(Boolean));
  const now = (payload.now || []).filter((item) => wanted.size === 0 || wanted.has(item.id));
  return { ...payload, now };
}

const READ_ONLY = 'Cette démonstration publique est en lecture seule : la console d’administration n’y est pas disponible.';

/* ------------------------------------------------------------------ entrée */

export async function api(path, { method = 'GET', body = null } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Vous êtes hors ligne. Vérifiez votre connexion.', { code: 'P-09' });
  }
  const url = new URL(withBase(path), location.href);
  const route = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname.replace(/^\//, '');
  const params = url.searchParams;
  // Petite latence simulée : les squelettes de chargement restent visibles et testables.
  await new Promise((resolve) => setTimeout(resolve, 40));
  if (method !== 'GET') {
    if (route === 'api/login') {
      throw new ApiError('Le mot de passe ne peut pas être vérifié dans cette démonstration.', { code: 'ERR-08', status: 401 });
    }
    throw new ApiError(READ_ONLY, { code: 'ERR-09', status: 403 });
  }
  if (route === 'api/config') return snapshot('config');
  if (route === 'api/errors/catalog') return snapshot('errors');
  if (route === 'api/session') return { signedIn: false, expiresAt: null, demo: true };
  if (route === 'api/epg') return epg(number(params.get('hours'), 12));
  if (route === 'api/epg/now') return epgNow(params.get('ids'));
  if (route === 'api/anime') return vodList('anime', params);
  if (route === 'api/films') return vodList('film', params);
  if (route.startsWith('api/anime/')) return vodDetail('anime', decodeURIComponent(route.slice('api/anime/'.length)));
  if (route.startsWith('api/films/')) return vodDetail('film', decodeURIComponent(route.slice('api/films/'.length)));
  if (route === 'api/sources') return snapshot('sources');
  if (route === 'api/search') return searchAll(params.get('q') || '', Math.min(48, Math.max(1, number(params.get('limit'), 24))));
  if (route === 'api/channels') return list(params);
  if (route === 'api/channels/search') return list(params, { search: true });
  if (route.startsWith('api/channels/')) return detail(decodeURIComponent(route.slice('api/channels/'.length)));
  if (route.startsWith('api/admin/')) throw new ApiError(READ_ONLY, { code: 'ERR-07', status: 401 });
  throw new ApiError('Cette adresse n’existe pas.', { code: 'ERR-11', status: 404 });
}

export async function download(path, filename) {
  const payload = await api(path);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Console d'administration : absente d'une démonstration statique, mais l'interface reste utilisable. */
export const Admin = new Proxy({}, {
  get: () => async () => { throw new ApiError(READ_ONLY, { code: 'ERR-07', status: 401 }); },
});
