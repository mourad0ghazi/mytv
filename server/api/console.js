// server/api/console.js — console « Chaînes et liens » et gestion des signalements.
// Routes protégées : inventaire exhaustif des flux (lecture seule) et décisions humaines.
// Aucune route de ce fichier ne supprime une chaîne sans une décision explicite, sauf le
// seuil de signalements déjà franchi, qui est appliqué à l'instant du signalement public.

import { CATEGORY_IDS, LIMITS } from '../core/constants.js';
import { AppError } from '../core/errors.js';
import { isPublic } from '../core/channels.js';
import { applyDecision, countFor, reportThreshold, summarize } from '../core/reports.js';
import { buildPredicate, paginate, sortChannels } from '../core/search.js';
import { queryInt, queryString } from '../http/router.js';

const PROTOCOLS = ['https', 'http', 'rtsp', 'rtmp', 'udp', 'autre'];
const VISIBILITIES = ['all', 'public', 'hidden', 'deleted', 'blocked', 'reported'];
const HEALTH = ['all', 'up', 'flaky', 'down', 'unknown'];
const SORTS = ['number', 'name', 'reports', 'health', 'updated'];

export function protocolOf(url) {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(String(url || ''));
  const scheme = match ? match[1].toLowerCase() : '';
  return PROTOCOLS.includes(scheme) ? scheme : 'autre';
}

function linkRow(channel, state) {
  return {
    id: channel.id,
    number: channel.number,
    name: channel.name,
    rawName: channel.rawName,
    url: channel.url,
    urlNormalized: channel.urlNormalized,
    protocol: protocolOf(channel.url),
    logo: channel.logo,
    group: channel.group,
    category: channel.category,
    categoryLabel: channel.categoryLabel,
    country: channel.country,
    language: channel.language,
    quality: channel.quality,
    tvgId: channel.tvgId,
    epgId: channel.epgId,
    sourceId: channel.sourceId,
    licenseNote: channel.licenseNote,
    visible: Boolean(channel.visible) && !channel.deleted,
    deleted: Boolean(channel.deleted),
    blocked: Boolean(channel.blocked),
    blockedReason: channel.blockedReason || '',
    manualOverride: Boolean(channel.manualOverride),
    featured: Boolean(channel.featured),
    notes: channel.notes || '',
    reports: countFor(state, channel.id),
    health: {
      status: channel.health?.status || 'unknown',
      httpStatus: channel.health?.httpStatus ?? null,
      latencyMs: channel.health?.latencyMs ?? null,
      cors: channel.health?.cors ?? null,
      checkedAt: channel.health?.checkedAt || null,
      consecutiveFailures: channel.health?.consecutiveFailures || 0,
    },
    variants: (channel.variants || []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      quality: variant.quality,
      url: variant.url,
      health: variant.health?.status || 'unknown',
    })),
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

export function registerConsoleRoutes(router, app) {
  const auth = { auth: true, bodyLimit: LIMITS.maxBodyAdmin };

  /* ------------------------------------------------ inventaire des chaînes et liens */

  // EP-40 — inventaire complet pour la console : un flux, ses variantes, sa santé, son débit de signalements.
  router.get('/api/admin/links', ({ query }) => {
    const state = app.store.reports;
    const visibility = queryString(query, 'visibility', { max: 12, fallback: 'all' });
    const health = queryString(query, 'health', { max: 10, fallback: 'all' });
    const protocol = queryString(query, 'protocol', { max: 10, fallback: '' });
    const source = queryString(query, 'source', { max: 40 });
    const sort = queryString(query, 'sort', { max: 12, fallback: 'number' });
    const q = queryString(query, 'q', { max: 80 });

    let list = app.store.channels.slice();
    if (q) {
      const ids = new Set(app.index.search(q).map((channel) => channel.id));
      list = list.filter((channel) => ids.has(channel.id));
    }
    if (visibility === 'public') list = list.filter((channel) => isPublic(channel, app.store.settings));
    else if (visibility === 'hidden') list = list.filter((channel) => !channel.deleted && !isPublic(channel, app.store.settings));
    else if (visibility === 'deleted') list = list.filter((channel) => channel.deleted);
    else if (visibility === 'blocked') list = list.filter((channel) => channel.blocked && !channel.deleted);
    else if (visibility === 'reported') list = list.filter((channel) => countFor(state, channel.id) > 0);
    if (health !== 'all') list = list.filter((channel) => (channel.health?.status || 'unknown') === health);
    if (protocol) list = list.filter((channel) => protocolOf(channel.url) === protocol);
    if (source) list = list.filter((channel) => channel.sourceId === source);

    if (sort === 'reports') list.sort((a, b) => countFor(state, b.id) - countFor(state, a.id) || a.number - b.number);
    else if (sort === 'health') {
      const weight = { down: 0, flaky: 1, unknown: 2, up: 3 };
      list.sort((a, b) => (weight[a.health?.status || 'unknown'] ?? 9) - (weight[b.health?.status || 'unknown'] ?? 9));
    } else if (sort === 'updated') list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    else list = sortChannels(list, sort === 'name' ? 'name' : 'number');

    const result = paginate(list, queryInt(query, 'page', { max: LIMITS.maxPage }),
      queryInt(query, 'pageSize', { min: 1, max: LIMITS.pageSizeMax, fallback: 60 }));

    const all = app.store.channels;
    const counts = {
      catalog: all.filter((channel) => !channel.deleted).length,
      visible: all.filter((channel) => isPublic(channel, app.store.settings)).length,
      hidden: all.filter((channel) => !channel.deleted && !isPublic(channel, app.store.settings)).length,
      deleted: all.filter((channel) => channel.deleted).length,
      blocked: all.filter((channel) => channel.blocked && !channel.deleted).length,
      reported: all.filter((channel) => countFor(state, channel.id) > 0).length,
      variants: all.reduce((sum, channel) => sum + (channel.variants?.length || 0), 0),
      protocols: Object.fromEntries(PROTOCOLS.map((id) => [id, all.filter((channel) => protocolOf(channel.url) === id).length])),
      health: {
        up: all.filter((channel) => channel.health?.status === 'up').length,
        flaky: all.filter((channel) => channel.health?.status === 'flaky').length,
        down: all.filter((channel) => channel.health?.status === 'down').length,
        unknown: all.filter((channel) => (channel.health?.status || 'unknown') === 'unknown').length,
      },
    };

    return {
      body: {
        total: result.total,
        page: result.page,
        pages: result.pages,
        pageSize: result.pageSize,
        scope: { visibility, health, protocol, source, sort, q },
        counts,
        reportThreshold: reportThreshold(),
        sources: app.store.sources.map((item) => ({ id: item.id, name: item.name })),
        channels: result.items.map((channel) => linkRow(channel, state)),
      },
      cache: 'no-store',
    };
  }, auth);

  /* ------------------------------------------------------------- signalements */

  // EP-41 — file des signalements, compteurs par chaîne, seuil de retrait.
  router.get('/api/admin/reports', ({ query }) => {
    const threshold = reportThreshold();
    const summary = summarize(app.store.reports, {
      channels: app.store.channels,
      threshold,
      limit: queryInt(query, 'limit', { min: 1, max: 400, fallback: 120 }),
    });
    const status = queryString(query, 'status', { max: 12, fallback: '' });
    if (status) summary.reports = summary.reports.filter((report) => report.status === status);
    return {
      body: {
        ...summary,
        restantAvantRetrait: Math.max(0, threshold),
        seuil: threshold,
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-42 — confirmer un signalement : la chaîne est masquée immédiatement.
  router.post('/api/admin/reports/:id/confirm', async ({ params }) => {
    const report = app.store.reports.reports.find((item) => item.id === params.id || item.ref === params.id);
    if (!report) throw new AppError('ERR-11');
    const channel = app.store.channels.find((item) => item.id === report.channelId) || null;
    const { channelChanged } = applyDecision({
      state: app.store.reports, report, action: 'confirm', channel,
    });
    if (channelChanged) {
      await app.store.saveChannels('report.confirm');
      app.index.add(channel);
      await app.store.saveHealthSnapshot();
    }
    await app.store.saveReports('report.confirm');
    await app.store.audit('report.confirm', { channelIds: [report.channelId], detail: report.ref });
    return {
      body: {
        message: channel
          ? `« ${channel.name} » est masquée. Le signalement ${report.ref} est confirmé.`
          : `Signalement ${report.ref} confirmé. La chaîne n’est plus au catalogue.`,
        status: report.status,
        channelId: report.channelId,
        undoAvailable: Boolean(channel),
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-43 — rejeter un signalement : la chaîne reste en ligne.
  router.post('/api/admin/reports/:id/reject', async ({ params, body }) => {
    const report = app.store.reports.reports.find((item) => item.id === params.id || item.ref === params.id);
    if (!report) throw new AppError('ERR-11');
    applyDecision({ state: app.store.reports, report, action: 'reject', note: body?.note || '' });
    await app.store.saveReports('report.reject');
    await app.store.audit('report.reject', { channelIds: [report.channelId], detail: report.ref });
    return { body: { message: `Signalement ${report.ref} rejeté.`, status: report.status }, cache: 'no-store' };
  }, auth);

  // EP-44 — remettre à zéro le compteur d'une chaîne (après vérification manuelle).
  router.post('/api/admin/reports/:channelId/reset', async ({ params }) => {
    const channel = app.store.channels.find((item) => item.id === params.channelId);
    if (!channel) throw new AppError('ERR-10');
    const precedent = countFor(app.store.reports, channel.id);
    delete app.store.reports.counters[channel.id];
    app.store.reports.reports = app.store.reports.reports.filter((report) => report.channelId !== channel.id);
    await app.store.saveReports('report.reset');
    await app.store.audit('report.reset', { channelIds: [channel.id], detail: `${channel.name} : ${precedent} remis à zéro` });
    return { body: { message: `Compteur de « ${channel.name} » remis à zéro (${precedent}).`, reports: 0 }, cache: 'no-store' };
  }, auth);

  /* ------------------------------------------------------------ libellés pour l'écran */

  router.get('/api/admin/console/meta', () => ({
    body: {
      protocols: PROTOCOLS,
      visibilities: VISIBILITIES,
      health: HEALTH,
      sorts: SORTS,
      categories: CATEGORY_IDS,
      reportThreshold: reportThreshold(),
      reportsPerHour: LIMITS.reportsPerHour,
      note: 'Inventaire en lecture seule. Toute modification passe par le catalogue, avec audit.',
    },
    cache: 'no-store',
  }), auth);
}
