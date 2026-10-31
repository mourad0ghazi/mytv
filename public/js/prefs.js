// public/js/prefs.js · favoris, historique, volume et recherches : 100 % local (AC-033).
// Aucune requête serveur, aucune donnée personnelle transmise.

const KEYS = {
  favorites: 'streamtv.favorites',
  history: 'streamtv.history',
  volume: 'streamtv.volume',
  muted: 'streamtv.muted',
  searches: 'streamtv.searches',
  lastChannel: 'streamtv.lastChannel',
  skin: 'streamtv.skin',
  tvMode: 'streamtv.tvMode',
  vodFavorites: 'streamtv.vodFavorites',
  vodHistory: 'streamtv.vodHistory',
  vodProgress: 'streamtv.vodProgress',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota ou mode privé */ }
}

const listeners = new Set();
function emit(type) {
  for (const fn of listeners) {
    try { fn(type); } catch { /* un abonné ne casse pas les autres */ }
  }
}

export const prefs = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  favorites() {
    const list = read(KEYS.favorites, []);
    return Array.isArray(list) ? list.filter((item) => item && item.id) : [];
  },
  isFavorite(id) { return prefs.favorites().some((item) => item.id === id); },
  toggleFavorite(channel) {
    const list = prefs.favorites();
    const index = list.findIndex((item) => item.id === channel.id);
    if (index >= 0) list.splice(index, 1);
    else list.unshift({
      id: channel.id, name: channel.name, logo: channel.logo, number: channel.number,
      category: channel.category, categoryLabel: channel.categoryLabel, hue: channel.hue,
      at: new Date().toISOString(),
    });
    write(KEYS.favorites, list.slice(0, 300));
    emit('favorites');
    return index < 0;
  },
  removeFavorite(id) {
    write(KEYS.favorites, prefs.favorites().filter((item) => item.id !== id));
    emit('favorites');
  },
  clearFavorites() { write(KEYS.favorites, []); emit('favorites'); },

  history() {
    const list = read(KEYS.history, []);
    return Array.isArray(list) ? list.filter((item) => item && item.id) : [];
  },
  pushHistory(channel) {
    const list = prefs.history().filter((item) => item.id !== channel.id);
    list.unshift({
      id: channel.id, name: channel.name, logo: channel.logo, number: channel.number,
      category: channel.category, categoryLabel: channel.categoryLabel, hue: channel.hue,
      at: new Date().toISOString(),
    });
    write(KEYS.history, list.slice(0, 80));
    emit('history');
  },
  removeHistory(id) {
    write(KEYS.history, prefs.history().filter((item) => item.id !== id));
    emit('history');
  },
  clearHistory() { write(KEYS.history, []); emit('history'); },

  /** Habillage du lecteur : cadre (poste ancien), plein écran, minimal. */
  skin() {
    const value = read(KEYS.skin, 'cadre');
    return ['cadre', 'plein', 'minimal'].includes(value) ? value : 'cadre';
  },
  setSkin(value) { write(KEYS.skin, ['cadre', 'plein', 'minimal'].includes(value) ? value : 'cadre'); emit('skin'); },

  /** Mode télévision : 'auto' (détection de l'appareil), 'on' ou 'off'. */
  tvMode() {
    const value = read(KEYS.tvMode, 'auto');
    return ['auto', 'on', 'off'].includes(value) ? value : 'auto';
  },
  setTvMode(value) { write(KEYS.tvMode, ['auto', 'on', 'off'].includes(value) ? value : 'auto'); emit('tv'); },

  volume() {
    const value = Number(read(KEYS.volume, 0.85));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.85;
  },
  setVolume(value) { write(KEYS.volume, Math.min(1, Math.max(0, Number(value) || 0))); },
  muted() { return Boolean(read(KEYS.muted, false)); },
  setMuted(value) { write(KEYS.muted, Boolean(value)); },

  searches() {
    const list = read(KEYS.searches, []);
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, 8) : [];
  },
  pushSearch(query) {
    const clean = String(query || '').trim();
    if (clean.length < 2) return;
    const list = prefs.searches().filter((s) => s.toLowerCase() !== clean.toLowerCase());
    list.unshift(clean.slice(0, 60));
    write(KEYS.searches, list.slice(0, 8));
  },
  clearSearches() { write(KEYS.searches, []); },

  lastChannel() { return read(KEYS.lastChannel, null); },
  setLastChannel(channel) {
    if (!channel) return;
    write(KEYS.lastChannel, { id: channel.id, name: channel.name, number: channel.number, at: new Date().toISOString() });
  },

  /* ---------------------------------------------------------------------------
     Anime et films : les mêmes principes, avec une reprise de lecture à la seconde.
     Aucune donnée personnelle, aucune position envoyée au serveur.
     --------------------------------------------------------------------------- */

  vodFavorites() {
    const list = read(KEYS.vodFavorites, []);
    return Array.isArray(list)
      ? list.filter((item) => item && item.id && (item.kind === 'anime' || item.kind === 'film'))
      : [];
  },
  isVodFavorite(kind, id) {
    return prefs.vodFavorites().some((item) => item.kind === kind && item.id === id);
  },
  toggleVodFavorite(item) {
    if (!item || !item.id) return false;
    const kind = item.kind === 'anime' ? 'anime' : 'film';
    const list = prefs.vodFavorites();
    const index = list.findIndex((entry) => entry.kind === kind && entry.id === item.id);
    if (index >= 0) list.splice(index, 1);
    else list.unshift({
      id: item.id,
      kind,
      kindLabel: kind === 'anime' ? 'Anime' : 'Film',
      title: item.title || item.name || '',
      poster: item.poster || '',
      year: item.year || null,
      licence: item.licence || '',
      href: kind === 'anime' ? `/anime/${item.id}` : `/film/${item.id}`,
      at: new Date().toISOString(),
    });
    write(KEYS.vodFavorites, list.slice(0, 200));
    emit('favorites');
    return index < 0;
  },
  removeVodFavorite(kind, id) {
    write(KEYS.vodFavorites, prefs.vodFavorites().filter((entry) => !(entry.kind === kind && entry.id === id)));
    emit('favorites');
  },

  vodHistory() {
    const list = read(KEYS.vodHistory, []);
    return Array.isArray(list) ? list.filter((item) => item && item.id) : [];
  },
  pushVodHistory(item, { seconds = 0, durationSeconds = 0, episodeId = '' } = {}) {
    if (!item || !item.id) return;
    const kind = item.kind === 'anime' ? 'anime' : 'film';
    const entry = {
      id: item.id,
      kind,
      kindLabel: kind === 'anime' ? 'Anime' : 'Film',
      title: item.title || item.name || '',
      poster: item.poster || '',
      year: item.year || null,
      durationSeconds: Math.max(0, Math.round(durationSeconds || item.durationSeconds || 0)),
      seconds: Math.max(0, Math.round(seconds || 0)),
      episodeId: episodeId || '',
      href: kind === 'anime' ? `/anime/${item.id}` : `/film/${item.id}`,
      at: new Date().toISOString(),
    };
    const list = prefs.vodHistory().filter((existing) => !(existing.kind === kind && existing.id === item.id));
    list.unshift(entry);
    write(KEYS.vodHistory, list.slice(0, 60));
    emit('history');
  },
  removeVodHistory(kind, id) {
    write(KEYS.vodHistory, prefs.vodHistory().filter((entry) => !(entry.kind === kind && entry.id === id)));
    emit('history');
  },
  clearVodHistory() { write(KEYS.vodHistory, []); write(KEYS.vodProgress, {}); emit('history'); },

  /** Position de reprise, en secondes, par contenu (et par épisode pour un anime). */
  /* ---------------------------------------------------------------------------
     Compte visiteur : après connexion, le serveur rend l'union des favoris, de
     l'historique et des préférences. On remplace le local par cette union, sans
     jamais inventer une entrée absente du compte.
     --------------------------------------------------------------------------- */

  importer({ favoris = [], historique = [], preferences = {} } = {}) {
    const liste = Array.isArray(favoris) ? favoris : [];
    const chaines = liste.filter((item) => item && item.id && item.kind === 'chaine')
      .map((item) => ({ id: item.id, name: item.name || '', at: item.at || new Date().toISOString() }));
    const vod = liste.filter((item) => item && item.id && (item.kind === 'anime' || item.kind === 'film'))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        kindLabel: item.kind === 'anime' ? 'Anime' : 'Film',
        title: item.name || '',
        poster: '',
        year: null,
        licence: '',
        href: item.kind === 'anime' ? `/anime/${item.id}` : `/film/${item.id}`,
        at: item.at || new Date().toISOString(),
      }));
    write(KEYS.favorites, chaines.slice(0, 300));
    write(KEYS.vodFavorites, vod.slice(0, 200));

    const parcours = Array.isArray(historique) ? historique : [];
    write(KEYS.history, parcours.filter((item) => item && item.id && item.kind === 'chaine')
      .map((item) => ({ id: item.id, name: item.name || '', at: item.at || new Date().toISOString() }))
      .slice(0, 80));
    const reprises = parcours.filter((item) => item && item.id && (item.kind === 'anime' || item.kind === 'film'));
    write(KEYS.vodHistory, reprises.map((item) => ({
      id: item.id,
      kind: item.kind,
      kindLabel: item.kind === 'anime' ? 'Anime' : 'Film',
      title: item.name || '',
      poster: '',
      year: null,
      durationSeconds: Math.max(0, Math.round(Number(item.duration) || 0)),
      seconds: Math.max(0, Math.round(Number(item.position) || 0)),
      episodeId: '',
      href: item.kind === 'anime' ? `/anime/${item.id}` : `/film/${item.id}`,
      at: item.at || new Date().toISOString(),
    })).slice(0, 60));
    const positions = {};
    for (const item of reprises) {
      const seconds = Math.max(0, Math.round(Number(item.position) || 0));
      if (seconds > 0) positions[`${item.kind}:${item.id}`] = seconds;
    }
    write(KEYS.vodProgress, positions);

    if (preferences && typeof preferences === 'object') {
      if (['cadre', 'plein', 'minimal'].includes(preferences.skin)) prefs.setSkin(preferences.skin);
      if (['auto', 'on', 'off'].includes(preferences.tvMode)) prefs.setTvMode(preferences.tvMode);
      if (typeof preferences.sourdine === 'boolean') prefs.setMuted(preferences.sourdine);
    }
    emit('favorites');
    emit('history');
  },

  /** État local complet, au format attendu par le compte visiteur. */
  exporter() {
    const favoris = [
      ...prefs.favorites().map((item) => ({ kind: 'chaine', id: item.id, name: item.name, at: item.at })),
      ...prefs.vodFavorites().map((item) => ({ kind: item.kind, id: item.id, name: item.title, at: item.at })),
    ];
    const historique = [
      ...prefs.history().map((item) => ({ kind: 'chaine', id: item.id, name: item.name, at: item.at })),
      ...prefs.vodHistory().map((item) => ({
        kind: item.kind,
        id: item.id,
        name: item.title,
        at: item.at,
        position: item.seconds,
        duration: item.durationSeconds,
      })),
    ];
    return {
      favoris,
      historique,
      preferences: { skin: prefs.skin(), tvMode: prefs.tvMode(), sourdine: prefs.muted() },
    };
  },

  vodProgress(kind, id, episodeId = '') {
    const all = read(KEYS.vodProgress, {});
    const key = `${kind}:${id}${episodeId ? `:${episodeId}` : ''}`;
    const value = Number(all && all[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  },
  setVodProgress(kind, id, seconds, { episodeId = '', durationSeconds = 0 } = {}) {
    const all = read(KEYS.vodProgress, {});
    const key = `${kind}:${id}${episodeId ? `:${episodeId}` : ''}`;
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    // Une lecture terminée (98 % et plus) ne propose pas de reprise : elle repart du début.
    const done = durationSeconds > 0 && value >= durationSeconds * 0.98;
    if (!value || done) delete all[key];
    else all[key] = value;
    const entries = Object.entries(all).slice(-400);
    write(KEYS.vodProgress, Object.fromEntries(entries));
    emit('progress');
  },
};
