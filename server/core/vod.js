// server/core/vod.js — modèles, filtres, rangées et import incrémental pour Anime et Films.
// Règles opposables :
// - Aucun contenu sans licence identifiée n'est visible côté public.
// - Une rangée vide n'est jamais produite.
// - Tout doublon d'identifiant entre deux sources est arbitré par priorité et tracé.

import { AppError } from './errors.js';
import { arbitrateDuplicate, assertSourceLicensed, slugifySourceId } from './sources.js';
import { normalizeKey as fold } from './text.js';

export const ANIME_SECTIONS = Object.freeze([
  { id: 'simulcast', title: 'Simulcast de la saison' },
  { id: 'classiques', title: 'Classiques' },
  { id: 'films_animation', title: 'Films d’animation' },
]);

export const VOD_LANGUAGES = Object.freeze(['VOSTFR', 'VF', 'VO']);
export const ANIME_STATUSES = Object.freeze({
  en_cours: 'En cours',
  termine: 'Terminé',
});

function clean(value, maxLength = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function computeHue(seed) {
  let hash = 0;
  const text = String(seed || 'streamtv');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function normalizeLanguage(raw) {
  const up = clean(raw, 12).toUpperCase();
  if (VOD_LANGUAGES.includes(up)) return up;
  if (up === 'FR') return 'VF';
  return 'VOSTFR';
}

function normalizeGenres(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const label = clean(item, 40);
    if (!label) continue;
    const key = fold(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.slice(0, 6);
}

function normalizeSourcesEntries(entries, fallback = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const merged = [];
  const seen = new Set();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const licence = clean(item.licence ?? item.license ?? '', 160);
    if (!licence) continue;
    const sourceId = slugifySourceId(item.sourceId || item.id || fallback.sourceId || 'source');
    const url = clean(item.url || fallback.url || '', 500);
    const key = `${sourceId}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pr = Number(item.priorite ?? fallback.sourcePriorite ?? 50);
    merged.push({
      sourceId,
      nom: clean(item.nom ?? item.name ?? fallback.sourceNom ?? sourceId, 80),
      url,
      quality: clean(item.quality || 'HD', 12).toUpperCase(),
      language: normalizeLanguage(item.language || fallback.language),
      licence,
      priorite: Number.isFinite(pr) ? Math.max(1, Math.min(100, Math.round(pr))) : 50,
    });
  }

  if (!merged.length && fallback.licence) {
    merged.push({
      sourceId: slugifySourceId(fallback.sourceId || 'source'),
      nom: clean(fallback.sourceNom || fallback.sourceId || 'Source officielle', 80),
      url: clean(fallback.url || '', 500),
      quality: clean(fallback.quality || 'HD', 12).toUpperCase(),
      language: normalizeLanguage(fallback.language),
      licence: clean(fallback.licence, 160),
      priorite: Number.isFinite(Number(fallback.sourcePriorite)) ? Number(fallback.sourcePriorite) : 50,
    });
  }

  return merged.sort((a, b) => b.priorite - a.priorite);
}

export function normalizeEpisode(raw = {}, index = 0, animeId = 'anime', defaultLang = 'VOSTFR') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const number = Number.isInteger(Number(src.number)) && Number(src.number) > 0 ? Number(src.number) : index + 1;
  const id = slugifySourceId(src.id || `${animeId}-ep-${number}`);
  const title = clean(src.title || `Épisode ${number}`, 120);
  const dur = Number(src.durationSeconds ?? src.duration ?? 0);
  const durationSeconds = Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : 0;
  const url = clean(src.url, 500);
  const quality = clean(src.quality || 'HD', 12).toUpperCase();
  const language = normalizeLanguage(src.language || defaultLang);
  return { id, number, title, durationSeconds, url, quality, language };
}

/** Normalise une fiche anime. Sans licence explicite, la fiche est bloquée côté public. */
export function normalizeAnime(raw = {}, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const now = new Date().toISOString();
  const title = clean(src.title ?? src.titre ?? src.name ?? `Anime ${index + 1}`, 140);
  const id = slugifySourceId(src.id || title);
  const originalTitle = clean(src.originalTitle ?? src.titreOriginal ?? title, 140);
  const synopsis = clean(src.synopsis ?? '', 900);
  const yr = Number(src.year ?? src.annee ?? 2020);
  const year = Number.isInteger(yr) && yr >= 1895 && yr <= 2100 ? yr : 2020;
  const genres = normalizeGenres(src.genres);
  const studio = clean(src.studio ?? 'Studio indépendant', 90);
  const language = normalizeLanguage(src.language ?? src.langue);
  const rawStatus = clean(src.status ?? src.statut ?? 'termine', 20).toLowerCase();
  const status = rawStatus === 'en_cours' || rawStatus === 'en cours' ? 'en_cours' : 'termine';
  const validSections = ANIME_SECTIONS.map((item) => item.id);
  const section = validSections.includes(src.section)
    ? src.section
    : (status === 'en_cours' ? 'simulcast' : 'classiques');
  const poster = clean(src.poster ?? src.affiche ?? '', 400);
  const episodes = Array.isArray(src.episodes)
    ? src.episodes
        .map((ep, idx) => normalizeEpisode(ep, idx, id, language))
        .filter((ep) => Boolean(ep.url))
        .sort((a, b) => a.number - b.number)
    : [];
  const rawCount = Number(src.episodeCount ?? src.nombreEpisodes ?? episodes.length);
  const episodeCount = Number.isInteger(rawCount) && rawCount >= episodes.length ? rawCount : episodes.length;

  const licence = clean(src.licence ?? src.license ?? '', 160);
  const sourceId = slugifySourceId(src.sourceId || 'anime-ouverts-cc');
  const sourceNom = clean(src.sourceNom || src.sourceName || sourceId, 80);
  const pr = Number(src.sourcePriorite ?? src.priorite ?? 80);
  const sourcePriorite = Number.isFinite(pr) ? Math.max(1, Math.min(100, Math.round(pr))) : 80;
  const primaryUrl = episodes[0]?.url || clean(src.url || '', 500);
  const sources = normalizeSourcesEntries(src.sources, {
    sourceId,
    sourceNom,
    sourcePriorite,
    url: primaryUrl,
    quality: episodes[0]?.quality || 'HD',
    language,
    licence,
  });

  const deleted = Boolean(src.deleted);
  const missingLicence = !licence;
  const blocked = Boolean(src.blocked) || missingLicence;
  const blockedReason = missingLicence ? 'sans-licence' : clean(src.blockedReason || '', 60);
  const visible = missingLicence || deleted ? false : (src.visible !== false);

  return {
    id,
    type: 'anime',
    title,
    originalTitle,
    synopsis,
    year,
    genres,
    studio,
    language,
    status,
    statusLabel: ANIME_STATUSES[status],
    section,
    poster,
    episodeCount,
    episodes,
    licence,
    sourceId,
    sourceNom,
    sourcePriorite,
    sources,
    country: clean(src.country ?? src.pays ?? 'INT', 3).toUpperCase(),
    hue: Number.isInteger(src.hue) ? src.hue : computeHue(id),
    visible,
    deleted,
    blocked,
    blockedReason,
    manualOverride: Boolean(src.manualOverride),
    createdAt: clean(src.createdAt || now, 40),
    updatedAt: clean(src.updatedAt || now, 40),
  };
}

/** Normalise une fiche film. Sans licence explicite, la fiche est bloquée côté public. */
export function normalizeFilm(raw = {}, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const now = new Date().toISOString();
  const title = clean(src.title ?? src.titre ?? src.name ?? `Film ${index + 1}`, 140);
  const id = slugifySourceId(src.id || title);
  const originalTitle = clean(src.originalTitle ?? src.titreOriginal ?? title, 140);
  const synopsis = clean(src.synopsis ?? '', 900);
  const dur = Number(src.durationSeconds ?? src.dureeSecondes ?? src.duration ?? 0);
  const durationSeconds = Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : 0;
  const yr = Number(src.year ?? src.annee ?? 2000);
  const year = Number.isInteger(yr) && yr >= 1895 && yr <= 2100 ? yr : 2000;
  const genres = normalizeGenres(src.genres);
  const director = clean(src.director ?? src.realisateur ?? '', 90);
  const language = normalizeLanguage(src.language ?? src.langue);
  const poster = clean(src.poster ?? src.affiche ?? '', 400);
  const url = clean(src.url ?? '', 500);
  const quality = clean(src.quality || 'HD', 12).toUpperCase();

  const licence = clean(src.licence ?? src.license ?? '', 160);
  const sourceId = slugifySourceId(src.sourceId || 'films-ouverts-cc');
  const sourceNom = clean(src.sourceNom || src.sourceName || sourceId, 80);
  const pr = Number(src.sourcePriorite ?? src.priorite ?? 80);
  const sourcePriorite = Number.isFinite(pr) ? Math.max(1, Math.min(100, Math.round(pr))) : 80;
  const sources = normalizeSourcesEntries(src.sources, {
    sourceId,
    sourceNom,
    sourcePriorite,
    url,
    quality,
    language,
    licence,
  });

  const deleted = Boolean(src.deleted);
  const missingLicence = !licence;
  const blocked = Boolean(src.blocked) || missingLicence;
  const blockedReason = missingLicence ? 'sans-licence' : clean(src.blockedReason || '', 60);
  const visible = missingLicence || deleted ? false : (src.visible !== false);

  return {
    id,
    type: 'film',
    title,
    originalTitle,
    synopsis,
    durationSeconds,
    year,
    genres,
    director,
    language,
    poster,
    url,
    quality,
    licence,
    sourceId,
    sourceNom,
    sourcePriorite,
    sources,
    country: clean(src.country ?? src.pays ?? 'INT', 3).toUpperCase(),
    hue: Number.isInteger(src.hue) ? src.hue : computeHue(id),
    visible,
    deleted,
    blocked,
    blockedReason,
    manualOverride: Boolean(src.manualOverride),
    createdAt: clean(src.createdAt || now, 40),
    updatedAt: clean(src.updatedAt || now, 40),
  };
}

/** Seul un contenu visible, non supprimé, licencié et muni d'un flux est proposé au public. */
export function isPublicVodItem(item) {
  if (!item || item.deleted || item.visible === false || item.blocked) return false;
  if (!clean(item.licence, 160)) return false;
  if (item.type === 'anime') return Array.isArray(item.episodes) && item.episodes.length > 0;
  if (item.type === 'film') return Boolean(clean(item.url, 500));
  return false;
}

export function publicAnimeSummary(item) {
  return {
    id: item.id,
    type: 'anime',
    kindLabel: 'Anime',
    title: item.title,
    originalTitle: item.originalTitle,
    synopsis: item.synopsis,
    year: item.year,
    genres: item.genres,
    studio: item.studio,
    language: item.language,
    status: item.status,
    statusLabel: item.statusLabel,
    section: item.section,
    poster: item.poster,
    episodeCount: item.episodeCount,
    licence: item.licence,
    sourceNom: item.sourceNom,
    hue: item.hue,
  };
}

export function publicFilmSummary(item) {
  return {
    id: item.id,
    type: 'film',
    kindLabel: 'Film',
    title: item.title,
    originalTitle: item.originalTitle,
    synopsis: item.synopsis,
    durationSeconds: item.durationSeconds,
    year: item.year,
    genres: item.genres,
    director: item.director,
    language: item.language,
    poster: item.poster,
    quality: item.quality,
    licence: item.licence,
    sourceNom: item.sourceNom,
    hue: item.hue,
  };
}

function matchesVodQuery(item, queryText) {
  const needle = fold(queryText || '');
  if (!needle) return true;
  const hay = fold([
    item.title,
    item.originalTitle,
    item.studio || '',
    item.director || '',
    ...(item.genres || []),
  ].join(' '));
  return needle.split(' ').every((token) => hay.includes(token));
}

function buildFacets(items, includeStatus = false) {
  const genres = new Set();
  const years = new Set();
  const languages = new Set();
  const statuses = new Set();
  for (const item of items) {
    for (const genre of item.genres || []) genres.add(genre);
    if (item.year) years.add(item.year);
    if (item.language) languages.add(item.language);
    if (includeStatus && item.status) statuses.add(item.status);
  }
  return {
    genres: [...genres].sort((a, b) => a.localeCompare(b, 'fr')),
    years: [...years].sort((a, b) => b - a),
    languages: VOD_LANGUAGES.filter((lang) => languages.has(lang)),
    ...(includeStatus ? { statuses: ['en_cours', 'termine'].filter((st) => statuses.has(st)) } : {}),
  };
}

/** Filtre, pagine et construit les trois rangées publiques d'anime (sans rangée vide). */
export function queryAnime(allAnime, params = {}, defaultPageSize = 48) {
  const publicItems = (Array.isArray(allAnime) ? allAnime : []).filter(isPublicVodItem);
  const facets = buildFacets(publicItems, true);

  const genre = clean(params.genre || '', 40);
  const year = params.year || params.annee ? Number(params.year ?? params.annee) : null;
  const language = params.language || params.langue ? clean(params.language ?? params.langue, 12).toUpperCase() : '';
  const status = clean(params.status ?? params.statut ?? '', 20).toLowerCase();
  const section = clean(params.section || '', 30);
  const q = clean(params.q || '', 120);
  const idsFilter = params.ids ? new Set(String(params.ids).split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const filtered = publicItems.filter((item) => {
    if (idsFilter && !idsFilter.has(item.id)) return false;
    if (genre && !item.genres.some((g) => fold(g) === fold(genre))) return false;
    if (Number.isInteger(year) && item.year !== year) return false;
    if (language && item.language !== language) return false;
    if (status && item.status !== status) return false;
    if (section && item.section !== section) return false;
    if (q && !matchesVodQuery(item, q)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => (b.year - a.year) || a.title.localeCompare(b.title, 'fr'));
  const pageSize = Math.max(1, Math.min(60, Number(params.pageSize) || defaultPageSize || 48));
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(pages, Number(params.page) || 1));
  const slice = sorted.slice((page - 1) * pageSize, page * pageSize).map(publicAnimeSummary);

  // Trois rangées canoniques ; toute rangée vide est omise.
  const rows = ANIME_SECTIONS
    .map((spec) => ({
      id: spec.id,
      title: spec.title,
      items: sorted.filter((item) => item.section === spec.id).slice(0, 18).map(publicAnimeSummary),
    }))
    .filter((row) => row.items.length > 0);

  return { total, page, pageSize, pages, items: slice, rows, facets };
}

/** Filtre, pagine et construit les rangées publiques de films (sans rangée vide, genres bornés). */
export function queryFilms(allFilms, params = {}, { defaultPageSize = 48, maxGenreRows = 6 } = {}) {
  const publicItems = (Array.isArray(allFilms) ? allFilms : []).filter(isPublicVodItem);
  const facets = buildFacets(publicItems, false);

  const genre = clean(params.genre || '', 40);
  const year = params.year || params.annee ? Number(params.year ?? params.annee) : null;
  const language = params.language || params.langue ? clean(params.language ?? params.langue, 12).toUpperCase() : '';
  const q = clean(params.q || '', 120);
  const idsFilter = params.ids ? new Set(String(params.ids).split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const filtered = publicItems.filter((item) => {
    if (idsFilter && !idsFilter.has(item.id)) return false;
    if (genre && !item.genres.some((g) => fold(g) === fold(genre))) return false;
    if (Number.isInteger(year) && item.year !== year) return false;
    if (language && item.language !== language) return false;
    if (q && !matchesVodQuery(item, q)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const byCreated = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return byCreated || (b.year - a.year) || a.title.localeCompare(b.title, 'fr');
  });

  const pageSize = Math.max(1, Math.min(60, Number(params.pageSize) || defaultPageSize || 48));
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(pages, Number(params.page) || 1));
  const slice = sorted.slice((page - 1) * pageSize, page * pageSize).map(publicFilmSummary);

  const rows = [];
  if (sorted.length > 0) {
    rows.push({
      id: 'recents',
      title: 'Ajoutés récemment',
      items: sorted.slice(0, 12).map(publicFilmSummary),
    });
  }

  const genreCap = Math.max(1, Math.min(12, Number(maxGenreRows) || 6));
  const genreCounts = new Map();
  for (const item of sorted) {
    for (const g of item.genres || []) {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }
  }
  const orderedGenres = [...genreCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'fr'))
    .slice(0, genreCap);

  const byGenre = orderedGenres.map(([label]) => ({
    id: `genre-${slugifySourceId(label)}`,
    genre: label,
    title: label,
    items: sorted.filter((item) => item.genres.includes(label)).slice(0, 12).map(publicFilmSummary),
  })).filter((row) => row.items.length > 0);

  return { total, page, pageSize, pages, items: slice, rows: [...rows, ...byGenre], byGenre, facets };
}

/** Fusion incrémentale d'un lot VOD (anime ou film) avec arbitrage par priorité et refus sans licence. */
export function mergeVodBatch({ kind, existingItems = [], rawEntries, source }) {
  const sourceLicence = assertSourceLicensed(source);
  const items = Array.isArray(rawEntries)
    ? rawEntries
    : (Array.isArray(rawEntries?.items) ? rawEntries.items : null);
  if (!items || !items.length) {
    throw new AppError('ERR-05', {
      message: `Le flux de la source « ${source.nom || source.id} » ne contient aucune fiche ${kind} valide.`,
    });
  }

  const normalizeFn = kind === 'anime' ? normalizeAnime : normalizeFilm;
  const cloned = existingItems.map((entry, idx) => normalizeFn(entry, idx));
  const byId = new Map(cloned.map((entry) => [entry.id, entry]));
  const addedIds = [];
  const arbitrations = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedUnlicensed = 0;

  const now = new Date().toISOString();

  for (let i = 0; i < items.length; i += 1) {
    const raw = items[i];
    if (!raw || typeof raw !== 'object') continue;
    const explicitBlankLicence = ('licence' in raw && !clean(raw.licence, 160))
      || ('license' in raw && !clean(raw.license, 160));
    if (explicitBlankLicence) {
      skippedUnlicensed += 1;
      continue;
    }

    const incoming = normalizeFn({
      ...raw,
      licence: clean(raw.licence ?? raw.license ?? sourceLicence, 160),
      sourceId: source.id,
      sourceNom: source.nom || source.name || source.id,
      sourcePriorite: source.priorite,
      updatedAt: now,
    }, i);

    if (!incoming.licence) {
      skippedUnlicensed += 1;
      continue;
    }

    const current = byId.get(incoming.id);
    if (!current) {
      incoming.createdAt = clean(raw.createdAt || now, 40);
      cloned.push(incoming);
      byId.set(incoming.id, incoming);
      addedIds.push(incoming.id);
      added += 1;
      continue;
    }

    const decision = arbitrateDuplicate({
      contentType: kind,
      contentId: incoming.id,
      incomingSource: source,
      existingSourceId: current.sourceId,
      existingPriorite: current.sourcePriorite,
    });

    if (decision.isDuplicateBetweenSources) {
      arbitrations.push({
        contentType: kind,
        contentId: incoming.id,
        winner: decision.winner === 'incoming' ? source.id : current.sourceId,
        loser: decision.winner === 'incoming' ? current.sourceId : source.id,
        replaced: decision.replaced,
        detail: decision.detail,
      });
    }

    const combinedSources = normalizeSourcesEntries(
      [...(current.sources || []), ...(incoming.sources || [])],
      decision.replaced ? incoming : current,
    );

    if (decision.replaced && !current.manualOverride) {
      const merged = {
        ...incoming,
        createdAt: current.createdAt || incoming.createdAt,
        updatedAt: now,
        sources: combinedSources,
      };
      const idx = cloned.findIndex((item) => item.id === current.id);
      if (idx >= 0) cloned[idx] = merged;
      byId.set(merged.id, merged);
      updated += 1;
    } else {
      const beforeCount = (current.sources || []).length;
      current.sources = combinedSources;
      if (combinedSources.length !== beforeCount) {
        current.updatedAt = now;
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
  }

  return {
    nextItems: cloned,
    addedIds,
    arbitrations,
    counts: {
      entries: items.length,
      added,
      updated,
      unchanged,
      duplicatesArbitrated: arbitrations.length,
      skippedUnlicensed,
    },
  };
}

/** Résumé d'exploitation pour les onglets console Anime et Films. */
export function buildVodAdminSummary(items = [], sources = [], kind = 'anime') {
  const activeItems = (Array.isArray(items) ? items : []).filter((item) => !item.deleted);
  const sourceNameById = Object.fromEntries(
    (Array.isArray(sources) ? sources : []).map((src) => [src.id, src.nom || src.name || src.id]),
  );

  const countsMap = new Map();
  for (const src of (Array.isArray(sources) ? sources : [])) {
    if (src.contenu === kind) countsMap.set(src.id, 0);
  }
  for (const item of activeItems) {
    countsMap.set(item.sourceId, (countsMap.get(item.sourceId) || 0) + 1);
  }

  const parSource = [...countsMap.entries()].map(([sourceId, count]) => ({
    sourceId,
    nom: sourceNameById[sourceId] || sourceId,
    count,
  })).sort((a, b) => (b.count - a.count) || a.nom.localeCompare(b.nom, 'fr'));

  const sansAffiche = activeItems
    .filter((item) => !clean(item.poster, 400))
    .map((item) => ({ id: item.id, title: item.title, sourceId: item.sourceId }));

  const sansEpisode = activeItems
    .filter((item) => (kind === 'anime'
      ? (!Array.isArray(item.episodes) || item.episodes.length === 0)
      : !clean(item.url, 500)))
    .map((item) => ({ id: item.id, title: item.title, sourceId: item.sourceId }));

  const sansLicence = activeItems
    .filter((item) => !clean(item.licence, 160))
    .map((item) => ({ id: item.id, title: item.title, sourceId: item.sourceId }));

  const derniersAjouts = [...activeItems]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.title,
      year: item.year,
      language: item.language,
      licence: item.licence,
      sourceId: item.sourceId,
      sourceNom: sourceNameById[item.sourceId] || item.sourceNom || item.sourceId,
      poster: item.poster,
      episodeCount: kind === 'anime' ? item.episodeCount : undefined,
      durationSeconds: kind === 'film' ? item.durationSeconds : undefined,
      visible: item.visible !== false && Boolean(item.licence),
      createdAt: item.createdAt,
    }));

  return {
    kind,
    total: activeItems.length,
    publicCount: activeItems.filter(isPublicVodItem).length,
    parSource,
    sansAffiche: { count: sansAffiche.length, items: sansAffiche },
    sansEpisode: { count: sansEpisode.length, items: sansEpisode },
    sansLicence: { count: sansLicence.length, items: sansLicence },
    derniersAjouts,
  };
}
