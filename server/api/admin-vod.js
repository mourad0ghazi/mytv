// server/api/admin-vod.js — console, onglets Anime et Films (3.18.0).
// Chaque onglet montre : compteurs par source, contenu sans affiche, contenu sans épisode
// (ou sans flux pour un film), contenu sans licence, et les derniers ajouts.

import { LIMITS } from '../core/constants.js';
import { AppError, requireOneOf } from '../core/errors.js';
import { buildVodAdminSummary, normalizeAnime, normalizeFilm } from '../core/vod.js';
import { queryString } from '../http/router.js';

const EDITABLE_FIELDS = ['visible', 'licence', 'poster', 'section', 'status', 'language'];

function collectionOf(app, kind) {
  return kind === 'anime' ? app.store.anime : app.store.films;
}

function labelOf(item) {
  return item.title || item.name || item.id;
}

export function registerVodAdminRoutes(router, app) {
  const auth = (permission) => ({ auth: true, permission, bodyLimit: LIMITS.maxBodyAdmin });

  router.get('/api/admin/anime', () => ({
    body: { ...buildVodAdminSummary(app.store.anime, app.store.sources, 'anime'), editableFields: EDITABLE_FIELDS },
    cache: 'no-store',
  }), auth('vod.read'));

  router.get('/api/admin/films', () => ({
    body: { ...buildVodAdminSummary(app.store.films, app.store.sources, 'film'), editableFields: EDITABLE_FIELDS },
    cache: 'no-store',
  }), auth('vod.read'));

  router.get('/api/admin/anime/:id', ({ params }) => {
    const found = app.store.anime.find((item) => item.id === params.id);
    if (!found) throw new AppError('ERR-10', { message: 'Anime introuvable.' });
    return { body: { anime: found }, cache: 'no-store' };
  }, auth('vod.read'));

  router.get('/api/admin/films/:id', ({ params }) => {
    const found = app.store.films.find((item) => item.id === params.id);
    if (!found) throw new AppError('ERR-10', { message: 'Film introuvable.' });
    return { body: { film: found }, cache: 'no-store' };
  }, auth('vod.read'));

  router.patch('/api/admin/anime/:id', async ({ params, body, session, ip, requestId }) => {
    const item = app.store.anime.find((entry) => entry.id === params.id);
    if (!item) throw new AppError('ERR-10', { message: 'Anime introuvable.' });
    const patch = body && typeof body === 'object' ? body : {};
    const unknown = Object.keys(patch).filter((key) => !EDITABLE_FIELDS.includes(key));
    if (unknown.length) {
      throw new AppError('ERR-04', { field: unknown[0], params: { champ: `champ non modifiable (${unknown[0]})` } });
    }
    if ('visible' in patch && typeof patch.visible !== 'boolean') {
      throw new AppError('ERR-04', { field: 'visible', params: { champ: 'visible' } });
    }
    if ('section' in patch) {
      requireOneOf(patch.section, 'section', 'rangée', ['simulcast', 'classiques', 'films_animation']);
    }
    if ('status' in patch) {
      requireOneOf(patch.status, 'status', 'statut', ['en_cours', 'termine']);
    }
    if ('language' in patch) {
      requireOneOf(patch.language, 'language', 'langue', ['VOSTFR', 'VF', 'VO']);
    }

    const next = normalizeAnime({ ...item, ...patch, manualOverride: true });
    // Une fiche sans licence reste bloquée, même si l'on tente de la réafficher.
    if (patch.visible === true && !next.licence) {
      throw new AppError('ERR-16', { message: 'Impossible de publier une fiche sans licence identifiée.' });
    }
    // Renseigner une licence lève le blocage qu'elle avait provoqué, et lui seul.
    if (next.licence && next.blockedReason === 'sans-licence') {
      next.blocked = false;
      next.blockedReason = '';
    }
    const index = app.store.anime.findIndex((entry) => entry.id === item.id);
    app.store.anime[index] = next;
    await app.store.saveAnime('anime.update');
    await app.store.audit('anime.update', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${next.id} : ${Object.keys(patch).join(', ') || 'aucun champ'}`,
    });
    return {
      body: { anime: next, message: `Fiche « ${labelOf(next)} » mise à jour.` },
      cache: 'no-store',
    };
  }, auth('vod.write'));

  router.patch('/api/admin/films/:id', async ({ params, body, session, ip, requestId }) => {
    const item = app.store.films.find((entry) => entry.id === params.id);
    if (!item) throw new AppError('ERR-10', { message: 'Film introuvable.' });
    const patch = body && typeof body === 'object' ? body : {};
    const unknown = Object.keys(patch).filter((key) => !EDITABLE_FIELDS.includes(key));
    if (unknown.length) {
      throw new AppError('ERR-04', { field: unknown[0], params: { champ: `champ non modifiable (${unknown[0]})` } });
    }
    if ('visible' in patch && typeof patch.visible !== 'boolean') {
      throw new AppError('ERR-04', { field: 'visible', params: { champ: 'visible' } });
    }
    if ('language' in patch) {
      requireOneOf(patch.language, 'language', 'langue', ['VOSTFR', 'VF', 'VO']);
    }
    const next = normalizeFilm({ ...item, ...patch, manualOverride: true });
    if (patch.visible === true && !next.licence) {
      throw new AppError('ERR-16', { message: 'Impossible de publier une fiche sans licence identifiée.' });
    }
    if (next.licence && next.blockedReason === 'sans-licence') {
      next.blocked = false;
      next.blockedReason = '';
    }
    const index = app.store.films.findIndex((entry) => entry.id === item.id);
    app.store.films[index] = next;
    await app.store.saveFilms('film.update');
    await app.store.audit('film.update', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${next.id} : ${Object.keys(patch).join(', ') || 'aucun champ'}`,
    });
    return {
      body: { film: next, message: `Fiche « ${labelOf(next)} » mise à jour.` },
      cache: 'no-store',
    };
  }, auth('vod.write'));

  // Signalements qui visent un anime ou un film : la console les traite comme les chaînes.
  router.get('/api/admin/vod/reports', ({ query }) => {
    const kind = queryString(query, 'type', { max: 8 });
    const rows = Object.entries(app.store.reports.counters || {})
      .filter(([key]) => key.startsWith('anime:') || key.startsWith('film:'))
      .filter(([key]) => !kind || key.startsWith(`${kind}:`))
      .map(([key, count]) => ({ id: key, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
    return { body: { total: rows.length, rows }, cache: 'no-store' };
  }, auth('vod.read'));

  // Compteur d'un contenu remis à zéro, comme pour une chaîne.
  router.post('/api/admin/vod/:kind/:id/reports/reset', async ({ params, session, ip, requestId }) => {
    if (!['anime', 'film'].includes(params.kind)) {
      throw new AppError('ERR-04', { params: { champ: 'type de contenu' } });
    }
    const key = `${params.kind}:${params.id}`;
    const precedent = Number(app.store.reports.counters?.[key] || 0);
    if (app.store.reports.counters) delete app.store.reports.counters[key];
    app.store.reports.reports = app.store.reports.reports.filter((report) => report.channelId !== key);
    await app.store.saveReports('report.reset');
    await app.store.audit('report.reset', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      channelIds: [key],
      detail: `${key} : ${precedent} remis à zéro`,
    });
    return { body: { message: `Compteur de « ${key} » remis à zéro (${precedent}).`, reports: 0 }, cache: 'no-store' };
  }, auth('vod.write'));

  // Remise en catalogue d'un contenu retiré automatiquement ou manuellement.
  router.post('/api/admin/vod/:kind/:id/restore', async ({ params, session, ip, requestId }) => {
    const collection = collectionOf(app, params.kind);
    const item = collection.find((entry) => entry.id === params.id);
    if (!item) throw new AppError('ERR-10', { message: 'Contenu introuvable.' });
    if (!item.licence) {
      throw new AppError('ERR-16', { message: 'Ce contenu n’a pas de licence : il ne peut pas être remis en ligne.' });
    }
    item.deleted = false;
    item.visible = true;
    item.blocked = false;
    item.blockedReason = '';
    item.updatedAt = new Date().toISOString();
    if (params.kind === 'anime') await app.store.saveAnime('restore');
    else await app.store.saveFilms('restore');
    await app.store.audit(params.kind === 'anime' ? 'anime.update' : 'film.update', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${item.id} : remis en catalogue`,
    });
    return { body: { message: `« ${labelOf(item)} » est de nouveau au catalogue.` }, cache: 'no-store' };
  }, auth('vod.write'));
}
