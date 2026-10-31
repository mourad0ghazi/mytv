// server/api/report.js — EP-38 : signalement public d'une chaîne, d'un anime ou d'un film (F-25).
// Au-delà du plafond de signalements (1000 par défaut), le contenu est retiré automatiquement
// et journalisé, quelle que soit sa famille (chaîne, anime ou film).

import { LIMITS } from '../core/constants.js';
import { AppError, requireOneOf } from '../core/errors.js';
import { REASON_IDS, countFor, recordReport, reportThreshold } from '../core/reports.js';
import { normalizeKey, normalizeName } from '../core/text.js';
import { linkReportToVisitor } from './accounts.js';

function findTarget(app, body) {
  const animeId = typeof body?.animeId === 'string' ? body.animeId.trim() : '';
  if (animeId) {
    const found = app.store.anime.find((item) => item.id === animeId);
    if (!found) throw new AppError('ERR-10');
    return { item: found, kind: 'anime', counterKey: `anime:${found.id}` };
  }

  const filmId = typeof body?.filmId === 'string' ? body.filmId.trim() : '';
  if (filmId) {
    const found = app.store.films.find((item) => item.id === filmId);
    if (!found) throw new AppError('ERR-10');
    return { item: found, kind: 'film', counterKey: `film:${found.id}` };
  }

  const contentId = typeof body?.contentId === 'string' ? body.contentId.trim() : '';
  const contentType = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
  if (contentId) {
    if (contentType === 'anime' || contentId.startsWith('anime:')) {
      const id = contentId.replace(/^anime:/, '');
      const found = app.store.anime.find((item) => item.id === id);
      if (!found) throw new AppError('ERR-10');
      return { item: found, kind: 'anime', counterKey: `anime:${found.id}` };
    }
    if (contentType === 'film' || contentId.startsWith('film:')) {
      const id = contentId.replace(/^film:/, '');
      const found = app.store.films.find((item) => item.id === id);
      if (!found) throw new AppError('ERR-10');
      return { item: found, kind: 'film', counterKey: `film:${found.id}` };
    }
  }

  const id = (typeof body?.channelId === 'string' ? body.channelId.trim() : '') || contentId;
  if (id) {
    if (id.startsWith('anime:')) {
      const found = app.store.anime.find((item) => item.id === id.slice(6));
      if (!found) throw new AppError('ERR-10');
      return { item: found, kind: 'anime', counterKey: `anime:${found.id}` };
    }
    if (id.startsWith('film:')) {
      const found = app.store.films.find((item) => item.id === id.slice(5));
      if (!found) throw new AppError('ERR-10');
      return { item: found, kind: 'film', counterKey: `film:${found.id}` };
    }
    const foundChannel = app.store.channels.find((channel) => channel.id === id);
    if (foundChannel) return { item: foundChannel, kind: 'chaine', counterKey: foundChannel.id };
    const foundAnime = app.store.anime.find((item) => item.id === id);
    if (foundAnime) return { item: foundAnime, kind: 'anime', counterKey: `anime:${foundAnime.id}` };
    const foundFilm = app.store.films.find((item) => item.id === id);
    if (foundFilm) return { item: foundFilm, kind: 'film', counterKey: `film:${foundFilm.id}` };
    throw new AppError('ERR-10');
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError('ERR-02', { field: 'name', params: { champ: 'nom du contenu' } });
  const wanted = normalizeName(name);
  const exactChannel = app.store.channels.find((channel) => normalizeName(channel.name) === wanted);
  if (exactChannel) return { item: exactChannel, kind: 'chaine', counterKey: exactChannel.id };

  const key = normalizeKey(name);
  const exactAnime = app.store.anime.find((item) => normalizeKey(item.title) === key);
  if (exactAnime) return { item: exactAnime, kind: 'anime', counterKey: `anime:${exactAnime.id}` };
  const exactFilm = app.store.films.find((item) => normalizeKey(item.title) === key);
  if (exactFilm) return { item: exactFilm, kind: 'film', counterKey: `film:${exactFilm.id}` };

  const candidates = app.index.search(name);
  if (candidates.length) return { item: candidates[0], kind: 'chaine', counterKey: candidates[0].id };
  throw new AppError('ERR-10');
}

export function registerReportRoutes(router, app) {
  router.post('/api/report', async ({ body, ip, req }) => {
    const guard = app.reportGuard.check(ip);
    if (!guard.allowed) {
      throw new AppError('ERR-17', {
        params: { n: Math.max(1, Math.ceil(guard.retryAfterSeconds / 60)) },
        headers: { 'Retry-After': String(guard.retryAfterSeconds) },
      });
    }
    const { item: target, kind, counterKey } = findTarget(app, body);
    if (target.deleted) throw new AppError('ERR-10');
    const reason = requireOneOf(body?.reason || 'autre', 'reason', 'motif', REASON_IDS);
    const message = String(body?.message || '').slice(0, LIMITS.reportMessageMax);
    const email = String(body?.email || '').slice(0, 120);
    const result = recordReport({
      state: app.store.reports,
      channel: target,
      contentType: kind,
      counterKey,
      reason,
      message,
      email,
      ip,
      threshold: reportThreshold(),
    });
    app.reportGuard.fail(ip);

    let deleted = false;
    if (result.shouldDelete && !target.deleted) {
      const at = new Date().toISOString();
      target.deleted = true;
      target.deletedAt = at;
      target.visible = false;
      target.blocked = true;
      target.blockedReason = 'retrait-signalement';
      target.manualOverride = true;
      target.updatedAt = at;
      const label = target.name || target.title || target.id;
      if (kind === 'anime') {
        await app.store.saveAnime('report.auto-delete');
      } else if (kind === 'film') {
        await app.store.saveFilms('report.auto-delete');
      } else {
        target.notes = `Retirée automatiquement après ${result.count} signalements.`;
        await app.store.saveChannels('report.auto-delete');
        app.index.remove(target.id);
      }
      await app.store.audit('report.auto-delete', {
        channelIds: [counterKey],
        detail: `${kind} ${label} : ${result.count} signalements`,
      });
      deleted = true;
    }

    await app.store.saveReports('report.create');
    // Un visiteur connecté retrouve ses propres signalements dans son compte ; un visiteur
    // anonyme n'a rien à lier et le signalement reste strictement public.
    await linkReportToVisitor(app, req, {
      ref: result.ref,
      contentType: kind,
      name: target.name || target.title || target.id,
    }).catch(() => false);
    await app.store.audit('report.create', {
      channelIds: [counterKey],
      detail: `${result.ref} ${reason} (${result.count})`,
    });

    const displayTitle = target.name || target.title;
    return {
      status: 201,
      body: {
        ref: result.ref,
        count: result.count,
        threshold: result.threshold,
        duplicate: result.duplicate,
        deleted,
        contentType: kind,
        channel: { id: target.id, name: displayTitle, number: target.number || null },
        message: deleted
          ? 'Ce signalement atteint le seuil de retrait. Le contenu a été retiré du catalogue.'
          : result.duplicate
            ? 'Ce signalement a déjà été enregistré récemment pour ce contenu.'
            : 'Signalement enregistré. Merci, il est examiné sous 72 heures ouvrées.',
      },
      cache: 'no-store',
    };
  }, { bodyLimit: 4096 });

  router.get('/api/report/:ref', ({ params }) => {
    const ref = String(params.ref || '').toUpperCase();
    const report = app.store.reports.reports.find((item) => item.ref === ref);
    if (!report) throw new AppError('ERR-11');
    return {
      body: {
        ref: report.ref,
        status: report.status,
        at: report.at,
        decidedAt: report.decidedAt,
        contentType: report.contentType || 'chaine',
        channelName: report.channelName,
        count: countFor(app.store.reports, report.channelId),
        threshold: reportThreshold(),
      },
      cache: 'no-store',
    };
  });
}
