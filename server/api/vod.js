// server/api/vod.js — routes publiques Anime, Films, Sources et recherche globale (3.18.0).

import { isPublic, projectCard } from '../core/channels.js';
import { AppError } from '../core/errors.js';
import { publicSourcePayload } from '../core/sources.js';
import { normalizeKey, normalizeQuery } from '../core/text.js';
import {
  isPublicVodItem,
  publicAnimeSummary,
  publicFilmSummary,
  queryAnime,
  queryFilms,
} from '../core/vod.js';

function scoreVodMatch(item, queryNorm) {
  const titleKey = normalizeKey(item.title || '');
  const origKey = normalizeKey(item.originalTitle || '');
  const extraKey = normalizeKey([item.studio || '', item.director || '', ...(item.genres || [])].join(' '));
  if (titleKey === queryNorm || origKey === queryNorm) return 100;
  if (titleKey.startsWith(queryNorm) || origKey.startsWith(queryNorm)) return 85;
  if (titleKey.includes(queryNorm) || origKey.includes(queryNorm)) return 70;
  const tokens = queryNorm.split(' ').filter(Boolean);
  if (tokens.length && tokens.every((tok) => `${titleKey} ${origKey} ${extraKey}`.includes(tok))) return 55;
  return 0;
}

export function registerVodRoutes(router, app) {
  // Catalogue public des anime : pagination, filtres de barre supérieure et 3 rangées.
  router.get('/api/anime', ({ query }) => {
    if (app.store.settings.vodEnabled === false) {
      return {
        body: { total: 0, page: 1, pageSize: app.store.settings.pageSize, pages: 1, items: [], rows: [], facets: { genres: [], years: [], languages: [], statuses: [] } },
        cache: 'public, max-age=15',
      };
    }
    return {
      body: queryAnime(app.store.anime, query, app.store.settings.pageSize),
      cache: 'public, max-age=15',
    };
  });

  // Fiche détaillée d'un anime.
  router.get('/api/anime/:id', ({ params }) => {
    if (app.store.settings.vodEnabled === false) throw new AppError('ERR-10', { message: 'Anime introuvable.' });
    const found = app.store.anime.find((item) => item.id === params.id);
    if (!isPublicVodItem(found)) throw new AppError('ERR-10', { message: 'Anime introuvable.' });

    const related = app.store.anime
      .filter((item) => item.id !== found.id && isPublicVodItem(item))
      .filter((item) => item.section === found.section || item.genres.some((g) => found.genres.includes(g)))
      .slice(0, 6)
      .map(publicAnimeSummary);

    return {
      body: {
        anime: {
          ...publicAnimeSummary(found),
          episodes: found.episodes,
          sources: found.sources,
          playable: found.episodes.length > 0,
        },
        related,
      },
      cache: 'public, max-age=15',
    };
  });

  // Catalogue public des films : pagination, filtres, « Ajoutés récemment » et « Par genre ».
  router.get('/api/films', ({ query }) => {
    if (app.store.settings.vodEnabled === false) {
      return {
        body: { total: 0, page: 1, pageSize: app.store.settings.pageSize, pages: 1, items: [], rows: [], byGenre: [], facets: { genres: [], years: [], languages: [] } },
        cache: 'public, max-age=15',
      };
    }
    return {
      body: queryFilms(app.store.films, query, {
        defaultPageSize: app.store.settings.pageSize,
        maxGenreRows: app.store.settings.vodGenreRowsMax,
      }),
      cache: 'public, max-age=15',
    };
  });

  // Fiche détaillée d'un film.
  router.get('/api/films/:id', ({ params }) => {
    if (app.store.settings.vodEnabled === false) throw new AppError('ERR-10', { message: 'Film introuvable.' });
    const found = app.store.films.find((item) => item.id === params.id);
    if (!isPublicVodItem(found)) throw new AppError('ERR-10', { message: 'Film introuvable.' });

    const related = app.store.films
      .filter((item) => item.id !== found.id && isPublicVodItem(item))
      .filter((item) => item.genres.some((g) => found.genres.includes(g)))
      .slice(0, 6)
      .map(publicFilmSummary);

    return {
      body: {
        film: {
          ...publicFilmSummary(found),
          url: found.url,
          sources: found.sources,
          playable: Boolean(found.url),
        },
        related,
      },
      cache: 'public, max-age=15',
    };
  });

  // Liste publique des sources actives, sans secret ni paramètre d'authentification.
  router.get('/api/sources', ({ query }) => {
    const contenu = String(query.contenu || '').trim();
    const list = app.store.sources
      .filter((src) => src.actif !== false && Boolean(src.licence))
      .filter((src) => !contenu || src.contenu === contenu)
      .sort((a, b) => b.priorite - a.priorite)
      .map(publicSourcePayload);
    return {
      body: { total: list.length, sources: list },
      cache: 'public, max-age=30',
    };
  });

  // Recherche globale multi-familles : chaque résultat indique son type par un mot (Chaîne, Anime, Film).
  router.get('/api/search', ({ query }) => {
    const q = normalizeQuery(query.q || '');
    const limit = Math.max(1, Math.min(48, Number(query.limit) || 24));
    if (!q) {
      return { body: { query: '', total: 0, results: [] }, cache: 'public, max-age=10' };
    }

    const vodActive = app.store.settings.vodEnabled !== false;
    const scored = [];

    const channelMatches = app.index.search(q, (ch) => isPublic(ch, app.store.settings)).slice(0, limit * 2);
    for (let i = 0; i < channelMatches.length; i += 1) {
      const raw = channelMatches[i];
      const ch = projectCard(raw);
      scored.push({
        score: Math.max(40, 95 - i),
        item: {
          kind: 'chaine',
          kindLabel: 'Chaîne',
          id: ch.id,
          title: ch.name,
          name: ch.name,
          subtitle: `${ch.categoryLabel} · Chaîne ${ch.number}`,
          href: `/chaine/${ch.id}`,
          poster: ch.logo || '',
          number: ch.number,
          licence: raw.licenseNote || '',
          hue: ch.hue,
        },
      });
    }

    if (vodActive) {
      for (const anime of app.store.anime) {
        if (!isPublicVodItem(anime)) continue;
        const sc = scoreVodMatch(anime, q);
        if (sc <= 0) continue;
        scored.push({
          score: sc + 2,
          item: {
            kind: 'anime',
            kindLabel: 'Anime',
            id: anime.id,
            title: anime.title,
            name: anime.title,
            subtitle: `${anime.year} · ${anime.language} · ${anime.episodeCount} ép.`,
            href: `/anime/${anime.id}`,
            poster: anime.poster || '',
            year: anime.year,
            licence: anime.licence,
            hue: anime.hue,
          },
        });
      }

      for (const film of app.store.films) {
        if (!isPublicVodItem(film)) continue;
        const sc = scoreVodMatch(film, q);
        if (sc <= 0) continue;
        scored.push({
          score: sc + 1,
          item: {
            kind: 'film',
            kindLabel: 'Film',
            id: film.id,
            title: film.title,
            name: film.title,
            subtitle: `${film.year} · ${film.language}${(film.genres || []).length ? ` · ${film.genres[0]}` : ''}`,
            href: `/film/${film.id}`,
            poster: film.poster || '',
            year: film.year,
            licence: film.licence,
            hue: film.hue,
          },
        });
      }
    }

    scored.sort((a, b) => (b.score - a.score) || a.item.title.localeCompare(b.item.title, 'fr'));
    const results = scored.slice(0, limit).map((entry) => entry.item);
    return {
      body: { query: query.q || '', total: scored.length, results },
      cache: 'public, max-age=10',
    };
  });

  // Comptage anonyme d'une lecture VOD (aucune donnée personnelle ni position conservée côté serveur).
  router.post('/api/vod/:kind/:id/play', async ({ params }) => {
    const kind = params.kind === 'anime' ? 'anime' : (params.kind === 'film' ? 'film' : '');
    if (!kind) throw new AppError('ERR-04', { params: { champ: 'type VOD' } });
    const list = kind === 'anime' ? app.store.anime : app.store.films;
    const item = list.find((entry) => entry.id === params.id);
    if (!isPublicVodItem(item)) throw new AppError('ERR-10');
    const plays = app.store.plays || (app.store.plays = { totals: {}, hours: {} });
    const key = `${kind}:${item.id}`;
    const heure = new Date().toISOString().slice(0, 13);
    const entry = plays.totals[key] || { count: 0, lastAt: '' };
    entry.count += 1;
    entry.lastAt = new Date().toISOString();
    plays.totals[key] = entry;
    plays.hours[heure] = (plays.hours[heure] || 0) + 1;
    await app.store.savePlays('vod.play');
    return { body: { ok: true }, cache: 'no-store' };
  });
}
