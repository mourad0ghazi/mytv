// server/api/admin.js — routes protégées (§6.2) : catalogue, importation, réglages, règles, santé, sauvegardes.
// Toute écriture est validée, journalisée et sauvegardée de façon atomique.

import { createHash } from 'node:crypto';
import { CATEGORY_BY_ID, CATEGORY_IDS, LIMITS, LICENSE_NOTES, VERSION } from '../core/constants.js';
import { AppError, requireField, requireOneOf, requireRange } from '../core/errors.js';
import {
  assertMassWrite, buildChannel, categoryLabel, isPublic, projectDetail, sanitizeChannel,
} from '../core/channels.js';
import { categorizeEntry, classify, compileRules, reclassifyAll, reviewQueue } from '../core/classify.js';
import { effectiveRules, learnFromCorrections } from '../core/learning.js';
import { DEFAULTS, schemaForClient, validateSettings } from '../core/settings.js';
import { assertPasswordPolicy, hashPassword } from '../core/auth.js';
import { exportJson, exportM3U } from '../core/exports.js';
import { nextProbeBatch, probeChannels } from '../core/health.js';
import { buildTags, detectCountry, detectLanguage, detectQuality, groupKind, normalizeName, normalizeUrl } from '../core/text.js';
import { buildPredicate, paginate, sortChannels } from '../core/search.js';
import { queryInt, queryString } from '../http/router.js';
import { registerPilotageRoutes } from './admin-pilotage.js';
import { registerSettingsRoutes } from './admin-settings.js';
import { registerAccessRoutes } from './admin-access.js';
import { registerSetupRoutes } from './admin-setup.js';

const now = () => new Date().toISOString();

/** Nom lisible d'une chaîne, y compris supprimée : les compteurs d'usage la retrouvent. */
function channelName(app, id) {
  const channel = app.store.channels.find((item) => item.id === id);
  return channel ? channel.name : 'Chaîne retirée';
}

function findChannel(app, id) {
  const channel = app.store.channels.find((item) => item.id === id);
  if (!channel) throw new AppError('ERR-10');
  return channel;
}

function adminView(app, channel) {
  return {
    ...projectDetail(channel, app.settingsRef(), app.siteProtocolRef()),
    notes: channel.notes,
    manualOverride: channel.manualOverride,
    sourceId: channel.sourceId,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    deleted: Boolean(channel.deleted),
  };
}

function table(app) {
  return compileRules(effectiveRules(app.store.learning));
}

/**
 * F-22 — recalcule les règles apprises à partir des corrections, sans toucher aux règles
 * manuelles. Appelé après chaque correction ; jamais bloquant (une erreur laisse l'existant).
 */
function refreshLearned(app) {
  const { rules, stats } = learnFromCorrections(app.store.learning.corrections, { minSupport: 2 });
  app.store.learning.learned = rules;
  app.store.learning.learnedStats = { ...stats, updatedAt: new Date().toISOString() };
  return app.store.learning.learnedStats;
}

function parseUrlField(value, field = 'url') {
  const raw = requireField(value, field, 'adresse du flux', { max: LIMITS.urlMax });
  const normalized = normalizeUrl(raw);
  if (!normalized) throw new AppError('ERR-04', { field, params: { champ: 'adresse du flux' } });
  return { url: raw, urlNormalized: normalized };
}

function parseLicense(value) {
  if (value === undefined || value === null || value === '') return 'catalogue propre';
  return requireOneOf(String(value), 'licenseNote', 'justification des droits', LICENSE_NOTES);
}

function makeEntry({ name, url, urlNormalized, logo = '', group = '', quality, tvgId = '' }) {
  const cleanName = normalizeName(name);
  const finalQuality = quality && quality !== 'AUTO' ? requireOneOf(quality, 'quality', 'qualité', ['SD', 'HD', 'FHD', '4K', '8K', 'AUTO']) : detectQuality(cleanName, urlNormalized);
  const country = detectCountry({ tvgId, group, name: cleanName });
  const language = detectLanguage({ tvgId, name: cleanName, group, country });
  return {
    rawName: String(name).trim(),
    name: cleanName,
    url,
    urlNormalized,
    tvgId,
    tvgName: cleanName,
    logo: /^https?:\/\//i.test(logo) ? logo.slice(0, LIMITS.logoMax) : '',
    group: String(group || '').slice(0, LIMITS.groupMax),
    groupKind: groupKind(group),
    quality: finalQuality,
    country,
    language,
    tags: buildTags({ url, rawName: cleanName, group, quality: finalQuality, tvgId, country, language }),
    position: 0,
  };
}

/** Table de permissions : chaque route d'administration nomme l'action qu'elle autorise. */
export function permissionFor(method, pattern) {
  // Sources et VOD nomment leurs propres permissions : aucune n'est accordée par défaut.
  if (pattern.includes('/admin/sources')) {
    if (method === 'GET') return 'sources.read';
    return pattern.includes('/import') ? 'sources.import' : 'sources.write';
  }
  if (pattern.includes('/admin/anime') || pattern.includes('/admin/films')) {
    if (method === 'GET') return 'vod.read';
    return method === 'POST' && pattern.includes('/probe') ? 'vod.read' : 'vod.write';
  }
  if (pattern.includes('/team')) return 'team';
  if (pattern.includes('/device')) return 'team';
  if (pattern.includes('/access-links')) return 'team';
  if (pattern.includes('/setup')) return 'team';
  if (pattern.includes('/mail')) return 'team';
  if (pattern.includes('/password') || pattern.includes('/sessions')) return 'team';
  if (pattern.includes('/backup') || pattern.includes('/restore')) return 'backup';
  if (pattern.includes('/settings') || pattern.includes('/rules')) return 'settings';
  if (pattern.includes('/import')) return 'import';
  if (pattern.includes('/audit') || pattern.includes('/analytics')) return 'analytics';
  if (pattern.includes('/diagnostic')) return 'diagnostic';
  if (method === 'DELETE' && /channels\/:id$/.test(pattern)) return 'catalogue.delete';
  if (method === 'GET') return 'catalogue.read';
  return 'catalogue.write';
}

export function registerAdminRoutes(base, app) {
  // Le routeur reçoit la permission déduite du couple méthode + chemin : aucune route n'est oubliée.
  const router = {
    get: (pattern, handler, options = {}) => base.get(pattern, handler, { auth: true, bodyLimit: LIMITS.maxBodyAdmin, ...options, permission: options.permission || permissionFor('GET', pattern) }),
    post: (pattern, handler, options = {}) => base.post(pattern, handler, { auth: true, bodyLimit: LIMITS.maxBodyAdmin, ...options, permission: options.permission || permissionFor('POST', pattern) }),
    patch: (pattern, handler, options = {}) => base.patch(pattern, handler, { auth: true, bodyLimit: LIMITS.maxBodyAdmin, ...options, permission: options.permission || permissionFor('PATCH', pattern) }),
    delete: (pattern, handler, options = {}) => base.delete(pattern, handler, { auth: true, bodyLimit: LIMITS.maxBodyAdmin, ...options, permission: options.permission || permissionFor('DELETE', pattern) }),
  };
  app.settingsRef = () => app.store.settings;
  app.siteProtocolRef = () => app.siteProtocol;

  const auth = { auth: true, bodyLimit: LIMITS.maxBodyAdmin };

  /* ---------------------------------------------------------------- catalogue */

  // EP-10 — liste d'administration.
  router.get('/api/admin/channels', ({ query }) => {
    const visibility = queryString(query, 'visibility', { max: 10, fallback: 'all' });
    const q = queryString(query, 'q', { max: 80 });
    const predicate = buildPredicate({
      category: queryString(query, 'category', { max: 24 }),
      visibility: 'all',
    }, app.store.settings);
    let list = app.store.channels.filter(predicate);
    if (visibility === 'public') list = list.filter((channel) => isPublic(channel, app.store.settings) && !channel.deleted);
    else if (visibility === 'hidden') list = list.filter((channel) => !isPublic(channel, app.store.settings) && !channel.deleted);
    else if (visibility === 'deleted') list = list.filter((channel) => channel.deleted);
    else list = list.filter((channel) => !channel.deleted);
    if (q) {
      const ids = new Set(app.index.search(q).map((channel) => channel.id));
      list = list.filter((channel) => ids.has(channel.id));
    }
    const sorted = sortChannels(list, queryString(query, 'sort', { max: 12, fallback: 'number' }));
    const result = paginate(sorted, queryInt(query, 'page', { max: LIMITS.maxPage }),
      queryInt(query, 'pageSize', { min: 1, max: LIMITS.pageSizeMax, fallback: 60 }));
    return {
      body: {
        total: result.total,
        page: result.page,
        pages: result.pages,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
        channels: result.items.map((channel) => ({
          id: channel.id,
          number: channel.number,
          name: channel.name,
          category: channel.category,
          categoryLabel: channel.categoryLabel,
          categorySource: channel.categorySource,
          confidence: channel.confidence,
          quality: channel.quality,
          country: channel.country,
          logo: channel.logo,
          visible: channel.visible && !channel.deleted,
          deleted: Boolean(channel.deleted),
          featured: Boolean(channel.featured),
          manualOverride: Boolean(channel.manualOverride),
          blocked: Boolean(channel.blocked),
          blockedReason: channel.blockedReason,
          health: channel.health?.status || 'unknown',
          updatedAt: channel.updatedAt,
        })),
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-11 — création.
  router.post('/api/admin/channels', async ({ body }) => {
    const name = requireField(body?.name, 'name', 'nom de la chaîne', { max: LIMITS.nameMax });
    const url = parseUrlField(body?.url);
    if (app.store.channels.some((channel) => channel.id === channelIdFor(url.urlNormalized) && !channel.deleted)) {
      throw new AppError('ERR-14');
    }
    const licenseNote = parseLicense(body?.licenseNote);
    const entry = makeEntry({ ...url, name, logo: body?.logo, group: body?.group, quality: body?.quality });
    const categoryProvided = body?.category ? requireOneOf(body.category, 'category', 'catégorie', CATEGORY_IDS) : '';
    const classification = categoryProvided
      ? { category: categoryProvided, confidence: 1, source: 'manual', reasons: ['décision manuelle à la création'] }
      : categorizeEntry(entry, table(app));
    let number = body?.number === undefined || body?.number === null || body?.number === ''
      ? app.store.channels.reduce((max, channel) => Math.max(max, channel.number || 0), 0) + 1
      : requireRange(body.number, 'number', 'numéro', 1, 99999);
    if (app.store.channels.some((channel) => channel.number === number)) {
      number = app.store.channels.reduce((max, channel) => Math.max(max, channel.number || 0), 0) + 1;
    }
    const channel = buildChannel({
      entry,
      number,
      category: CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre,
      classification,
      sourceId: 'manuel',
      licenseNote,
      siteProtocol: app.siteProtocol,
      now: now(),
      position: app.store.channels.length,
    });
    channel.manualOverride = Boolean(categoryProvided);
    channel.notes = String(body?.notes || '').slice(0, LIMITS.notesMax);
    channel.featured = Boolean(body?.featured);
    channel.visible = body?.visible === false ? false : true;
    if (licenseNote === 'retiré — demande de tiers') {
      channel.visible = false;
      channel.blocked = true;
      channel.blockedReason = 'license';
    }
    if (channel.category === 'adulte' && app.store.settings.autoHideAdult && !app.store.settings.showAdult) {
      channel.visible = false;
    }
    app.store.channels.push(channel);
    await app.store.saveChannels('channel.create');
    app.index.add(channel);
    await app.store.audit('channel.create', { channelIds: [channel.id], detail: channel.name });
    return { status: 201, body: { channel: adminView(app, channel), message: `« ${channel.name} » a été ajoutée au catalogue.` }, cache: 'no-store' };
  }, auth);

  // EP-12 — lecture d'une chaîne.
  router.get('/api/admin/channels/:id', ({ params }) => {
    const channel = findChannel(app, params.id);
    return {
      body: {
        channel: adminView(app, channel),
        raw: channel,
        audit: [],
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-13 — modification.
  router.patch('/api/admin/channels/:id', async ({ params, body }) => {
    const channel = findChannel(app, params.id);
    const before = { ...channel, health: { ...channel.health } };
    let categoryChanged = false;
    let previousCategory = channel.category;

    if (body?.name !== undefined) channel.name = requireField(body.name, 'name', 'nom de la chaîne', { max: LIMITS.nameMax });
    if (body?.url !== undefined) {
      const parsed = parseUrlField(body.url);
      if (parsed.urlNormalized !== channel.urlNormalized) {
        channel.variants = [...(channel.variants || [])];
        if (!channel.variants.some((variant) => variant.url === channel.url) && channel.variants.length < LIMITS.maxVariants - 1) {
          channel.variants.push({ id: channel.id, name: channel.name, quality: channel.quality, url: channel.url, health: channel.health });
        }
      }
      channel.url = parsed.url;
      channel.urlNormalized = parsed.urlNormalized;
    }
    if (body?.logo !== undefined) {
      const logo = String(body.logo || '').trim();
      if (logo && !/^https:\/\/[^\s]+$/i.test(logo)) throw new AppError('ERR-04', { field: 'logo', params: { champ: 'logo' } });
      channel.logo = logo.slice(0, LIMITS.logoMax);
    }
    if (body?.group !== undefined) {
      channel.group = String(body.group || '').slice(0, LIMITS.groupMax);
      channel.groupKind = groupKind(channel.group);
    }
    if (body?.quality !== undefined) {
      channel.quality = requireOneOf(body.quality, 'quality', 'qualité', ['SD', 'HD', 'FHD', '4K', '8K', 'AUTO']);
    }
    if (body?.number !== undefined) {
      const number = requireRange(body.number, 'number', 'numéro', 1, 99999);
      if (app.store.channels.some((item) => item.id !== channel.id && item.number === number)) {
        throw new AppError('ERR-14');
      }
      channel.number = number;
    }
    if (body?.category !== undefined) {
      const category = requireOneOf(body.category, 'category', 'catégorie', CATEGORY_IDS);
      if (category !== channel.category) {
        previousCategory = channel.category;
        channel.category = category;
        channel.categoryLabel = categoryLabel(category);
        channel.categorySource = 'manual';
        channel.confidence = 1;
        channel.reasons = ['décision manuelle confirmée'];
        channel.manualOverride = true;
        categoryChanged = true;
        app.store.learning.corrections.push({
          channelId: channel.id,
          name: channel.name,
          from: previousCategory,
          to: category,
          at: now(),
        });
        app.store.learning.corrections = app.store.learning.corrections.slice(-500);
      }
    }
    if (body?.licenseNote !== undefined) channel.licenseNote = parseLicense(body.licenseNote);
    if (body?.visible !== undefined) channel.visible = Boolean(body.visible);
    if (body?.featured !== undefined) channel.featured = Boolean(body.featured);
    if (body?.notes !== undefined) channel.notes = String(body.notes || '').slice(0, LIMITS.notesMax);
    if (body?.blocked !== undefined) {
      channel.blocked = Boolean(body.blocked);
      channel.blockedReason = channel.blocked ? 'manual' : '';
    }
    if (channel.category === 'adulte' && app.store.settings.autoHideAdult && !app.store.settings.showAdult) {
      channel.visible = false;
    }
    channel.updatedAt = now();
    const sanitized = sanitizeChannel(channel, { siteProtocol: app.siteProtocol });
    if (!sanitized.channel) throw new AppError('ERR-16', { params: { raison: 'la chaîne obtenue n’est pas valide' } });

    await app.store.saveChannels('channel.update');
    app.index.add(channel);
    if (categoryChanged) {
      refreshLearned(app);
      await app.store.saveLearning('correction');
    }
    await app.store.audit('channel.update', {
      channelIds: [channel.id],
      detail: `${before.name} → ${channel.name}${categoryChanged ? ` (${previousCategory} → ${channel.category})` : ''}`,
    });
    return { body: { channel: adminView(app, channel), message: 'Modifications enregistrées.' }, cache: 'no-store' };
  }, auth);

  // EP-14 — suppression réversible.
  router.delete('/api/admin/channels/:id', async ({ params }) => {
    const channel = findChannel(app, params.id);
    if (channel.deleted) throw new AppError('ERR-16', { params: { raison: 'cette chaîne est déjà supprimée' } });
    channel.deleted = true;
    channel.deletedAt = now();
    channel.visible = false;
    channel.blocked = true;
    channel.blockedReason = 'manual';
    channel.updatedAt = now();
    assertMassWrite(app.store.channels.filter((item) => !item.deleted).length + 1,
      app.store.channels.filter((item) => !item.deleted).length, { operation: 'la suppression' });
    await app.store.saveChannels('channel.delete');
    app.index.remove(channel.id);
    await app.store.audit('channel.delete', { channelIds: [channel.id], detail: channel.name });
    return { body: { message: `« ${channel.name} » a été retirée du catalogue.`, undoAvailable: true, channelId: channel.id }, cache: 'no-store' };
  }, auth);

  // EP-15 — restauration.
  router.post('/api/admin/channels/:id/restore', async ({ params }) => {
    const channel = findChannel(app, params.id);
    channel.deleted = false;
    channel.deletedAt = null;
    channel.visible = true;
    channel.blocked = false;
    channel.blockedReason = '';
    channel.updatedAt = now();
    await app.store.saveChannels('channel.restore');
    app.index.add(channel);
    await app.store.audit('channel.restore', { channelIds: [channel.id], detail: channel.name });
    return { body: { message: `« ${channel.name} » est de retour dans le catalogue.`, channel: adminView(app, channel) }, cache: 'no-store' };
  }, auth);

  // EP-16 — actions groupées.
  router.post('/api/admin/channels/bulk', async ({ body }) => {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) throw new AppError('ERR-02', { field: 'ids', params: { champ: 'sélection' } });
    if (ids.length > 500) throw new AppError('ERR-03', { field: 'ids', params: { champ: 'sélection', min: 1, max: 500 } });
    const action = requireOneOf(body?.action, 'action', 'action', [
      'hide', 'show', 'block', 'unblock', 'delete', 'restore', 'feature', 'unfeature', 'category', 'probe',
    ]);
    let category = '';
    if (action === 'category') category = requireOneOf(body?.value, 'value', 'catégorie', CATEGORY_IDS);
    const channels = app.store.channels.filter((channel) => ids.includes(channel.id));
    if (!channels.length) throw new AppError('ERR-10');
    let changed = 0;
    for (const channel of channels) {
      switch (action) {
        case 'hide': channel.visible = false; break;
        case 'show':
          channel.visible = true;
          if (channel.category === 'adulte' && app.store.settings.autoHideAdult && !app.store.settings.showAdult) {
            channel.visible = false;
          }
          break;
        case 'block': channel.blocked = true; channel.blockedReason = 'manual'; break;
        case 'unblock': channel.blocked = false; channel.blockedReason = ''; break;
        case 'delete': channel.deleted = true; channel.deletedAt = now(); channel.visible = false; break;
        case 'restore': channel.deleted = false; channel.deletedAt = null; channel.visible = true; break;
        case 'feature':
          if (app.store.channels.filter((item) => item.featured).length >= LIMITS.maxFeatured) {
            throw new AppError('ERR-16', { params: { raison: `huit chaînes sont déjà en vedette` } });
          }
          channel.featured = true;
          break;
        case 'unfeature': channel.featured = false; break;
        case 'category':
          channel.category = category;
          channel.categoryLabel = categoryLabel(category);
          channel.categorySource = 'manual';
          channel.confidence = 1;
          channel.manualOverride = true;
          break;
        default: break;
      }
      channel.updatedAt = now();
      changed += 1;
    }
    if (action === 'delete') {
      assertMassWrite(app.store.channels.length, app.store.channels.filter((item) => !item.deleted).length,
        { operation: 'la suppression groupée' });
    }
    await app.store.saveChannels('channel.bulk');
    app.index.rebuild(app.store.channels.filter((channel) => !channel.deleted));
    await app.store.audit('channel.bulk', { channelIds: ids.slice(0, 200), count: changed, detail: action });
    return {
      body: { updated: changed, action, message: `${changed} chaîne${changed > 1 ? 's' : ''} mise${changed > 1 ? 's' : ''} à jour.` },
      cache: 'no-store',
    };
  }, auth);

  // EP-17 — aperçu de reclassement.
  router.post('/api/admin/channels/:id/tag/preview', ({ params }) => {
    const channel = findChannel(app, params.id);
    const result = classify({ ...channel, manualOverride: false }, { table: table(app) });
    return {
      body: {
        preview: {
          before: {
            category: channel.category,
            categoryLabel: channel.categoryLabel,
            confidence: channel.confidence,
            categorySource: channel.categorySource,
          },
          after: {
            category: result.category,
            categoryLabel: categoryLabel(result.category),
            confidence: result.confidence,
            categorySource: result.source,
            reasons: result.reasons,
          },
        },
        locked: Boolean(channel.manualOverride),
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-18 — appliquer une catégorie.
  router.post('/api/admin/channels/:id/tag', async ({ params, body }) => {
    const channel = findChannel(app, params.id);
    const category = requireOneOf(body?.category, 'category', 'catégorie', CATEGORY_IDS);
    const previous = channel.category;
    channel.category = category;
    channel.categoryLabel = categoryLabel(category);
    channel.categorySource = 'manual';
    channel.confidence = 1;
    channel.reasons = ['décision manuelle confirmée'];
    channel.manualOverride = true;
    channel.updatedAt = now();
    app.store.learning.corrections.push({ channelId: channel.id, name: channel.name, from: previous, to: category, at: now() });
    app.store.learning.corrections = app.store.learning.corrections.slice(-500);
    refreshLearned(app);
    await app.store.saveChannels('channel.tag');
    await app.store.saveLearning('correction');
    app.index.add(channel);
    await app.store.audit('channel.tag', { channelIds: [channel.id], detail: `${previous} → ${category}` });
    return { body: { channel: adminView(app, channel), message: `Catégorie « ${categoryLabel(category)} » appliquée.` }, cache: 'no-store' };
  }, auth);

  /* ---------------------------------------------------------------- importation */

  // EP-19 — aperçu d'importation.
  router.post('/api/admin/import/preview', async ({ body, ip, requestId }) => {
    const result = await app.ingest.preview({
      url: String(body?.url || '').trim(),
      text: typeof body?.text === 'string' ? body.text : '',
      name: String(body?.name || '').trim().slice(0, 80),
      ip,
      requestId,
    });
    await app.store.audit('import.preview', { ip, requestId, count: result.counts.entries, detail: result.sourceName });
    return { body: result, cache: 'no-store' };
  }, { auth: true, bodyLimit: LIMITS.maxBodyImport });

  // EP-20 — confirmation.
  router.post('/api/admin/import/commit', async ({ body, ip, requestId }) => {
    const jobId = requireField(body?.jobId, 'jobId', 'identifiant d’aperçu', { max: 80 });
    const result = await app.ingest.commit(jobId, { ip, requestId });
    return { body: result, cache: 'no-store' };
  }, auth);

  // EP-21 — état d'une importation.
  router.get('/api/admin/import/:id/status', async ({ params }) => ({
    body: await app.ingest.status(params.id),
    cache: 'no-store',
  }), auth);

  // EP-22 — annulation.
  router.post('/api/admin/import/:id/rollback', async ({ params, ip, requestId }) => {
    const result = await app.ingest.rollback(params.id, { ip, requestId });
    return { body: result, cache: 'no-store' };
  }, auth);

  // EP-23 — historique.
  router.get('/api/admin/ingestions', async () => ({
    body: { ingestions: await app.ingest.history() },
    cache: 'no-store',
  }), auth);

  /* ---------------------------------------------------------------- réglages */
  registerSettingsRoutes(router, app);

  /* ---------------------------------------------------------------- règles */

  // EP-27 — règles de catégorisation.
  router.get('/api/admin/rules', () => {
    const custom = app.store.learning.rules || {};
    const compiled = compileRules(effectiveRules(app.store.learning));
    const effective = {};
    for (const [keyword, categories] of compiled) {
      for (const [category, weight] of categories) {
        if (!effective[category]) effective[category] = [];
        effective[category].push(weight < 1 ? `${keyword}|${weight}` : keyword);
      }
    }
    return {
      body: {
        categories: Object.values(CATEGORY_BY_ID).map((category) => ({ id: category.id, label: category.label, count: app.store.channels.filter((channel) => channel.category === category.id).length })),
        custom,
        learned: app.store.learning.learned || {},
        learnedStats: app.store.learning.learnedStats || { corrections: 0, usable: 0, categories: 0, terms: 0, minSupport: 2 },
        effective,
        corrections: app.store.learning.corrections.slice(-20).reverse(),
        updatedAt: app.store.learning.updatedAt,
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-28 — mise à jour des règles + reclassement.
  router.patch('/api/admin/rules', async ({ body, ip }) => {
    const rules = body?.rules;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      throw new AppError('ERR-02', { field: 'rules', params: { champ: 'règles' } });
    }
    const clean = {};
    for (const [category, keywords] of Object.entries(rules)) {
      if (!CATEGORY_IDS.includes(category)) throw new AppError('ERR-04', { field: 'rules', params: { champ: category } });
      if (!Array.isArray(keywords)) throw new AppError('ERR-04', { field: 'rules', params: { champ: category } });
      if (keywords.length > 200) throw new AppError('ERR-03', { field: 'rules', params: { champ: category, min: 0, max: 200 } });
      clean[category] = keywords.map((keyword) => String(keyword).trim().slice(0, 40)).filter(Boolean).slice(0, 200);
    }
    app.store.learning.rules = clean;
    refreshLearned(app);
    const changed = reclassifyAll(app.store.channels.filter((channel) => !channel.deleted), {
      table: compileRules(effectiveRules(app.store.learning)),
    });
    await app.store.saveChannels('rules.update');
    await app.store.saveLearning('rules.update');
    app.index.rebuild(app.store.channels.filter((channel) => !channel.deleted));
    await app.store.audit('rules.update', { ip, count: changed, detail: Object.keys(clean).join(',') });
    return {
      body: {
        message: `${changed} chaîne${changed > 1 ? 's reclassées' : ' reclassée'} avec les nouvelles règles.`,
        changed,
        rules: clean,
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-29 — reclassement global.
  router.post('/api/admin/autotag-all', async ({ ip }) => {
    const started = Date.now();
    const changed = reclassifyAll(app.store.channels.filter((channel) => !channel.deleted), { table: table(app) });
    await app.store.saveChannels('autotag');
    app.index.rebuild(app.store.channels.filter((channel) => !channel.deleted));
    await app.store.audit('autotag.all', { ip, count: changed });
    return {
      body: {
        message: `Reclassement terminé : ${changed} chaîne${changed > 1 ? 's modifiées' : ' modifiée'} sur ${app.store.channels.length}.`,
        changed,
        durationMs: Date.now() - started,
      },
      cache: 'no-store',
    };
  }, auth);

  /* ---------------------------------------------------------------- santé & statistiques */

  // EP-30 — statistiques consolidées.
  router.get('/api/admin/stats', async () => {
    const started = performance.now();
    const active = app.store.channels.filter((channel) => !channel.deleted);
    const categories = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
    const sources = {};
    const decision = {};
    const histogram = Array.from({ length: 5 }, (_, index) => ({ min: index / 5, max: (index + 1) / 5, count: 0 }));
    let confidenceSum = 0;
    for (const channel of active) {
      categories[channel.category] = (categories[channel.category] || 0) + 1;
      sources[channel.categorySource] = (sources[channel.categorySource] || 0) + 1;
      decision[channel.category] = (decision[channel.category] || 0) + 1;
      confidenceSum += channel.confidence || 0;
      const bucket = Math.min(4, Math.max(0, Math.floor((channel.confidence || 0) * 5)));
      histogram[bucket].count += 1;
    }
    const measured = app.measureCache && Date.now() - app.measureCache.at < 30_000
      ? app.measureCache.value
      : measureEngine(app);
    if (app.measureCache) app.measureCache = { at: Date.now(), value: measured };
    const storage = await app.store.storageStats();
    const backups = await app.store.listBackups();
    const queue = reviewQueue(active, app.store.settings.confidenceFloor, 25).map((item) => ({
      ...item,
      categoryLabel: categoryLabel(item.category),
    }));
    const sizes = {
      channels: storage['channels.json'] || 0,
      settings: storage['settings.json'] || 0,
      audit: storage['audit.log'] || 0,
      backups: storage.backups || 0,
    };
    return {
      body: {
        version: VERSION,
        total: app.store.channels.length,
        active: active.length,
        deleted: app.store.channels.length - active.length,
        visible: active.filter((channel) => isPublic(channel, app.store.settings)).length,
        hidden: active.filter((channel) => !isPublic(channel, app.store.settings)).length,
        categories,
        health: app.store.healthCounts(),
        sources,
        decision,
        confidence: {
          average: active.length ? Math.round((confidenceSum / active.length) * 100) / 100 : 0,
          histogram,
          floor: app.store.settings.confidenceFloor,
          engine: measured,
        },
        queue,
        storage: { sizes, backups, sizeTotal: Object.values(sizes).reduce((sum, value) => sum + value, 0) },
        alerts: await app.alerts({ renderCards: Number(app.store.settings.pageSize) || 0 }),
        learning: (() => {
          const learned = app.store.learning.learned || {};
          const top = [];
          for (const [category, entries] of Object.entries(learned)) {
            for (const entry of entries) {
              const [term, weight] = String(entry).split('|');
              top.push({ category, term, weight: Number(weight) || 1 });
            }
          }
          top.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
          return {
            ...(app.store.learning.learnedStats || { corrections: 0, usable: 0, categories: 0, terms: 0, minSupport: 2 }),
            manualRules: Object.values(app.store.learning.rules || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
            top: top.slice(0, 12),
          };
        })(),
        migration: {
          schemaVersion: 'streamtv-sql-1',
          thresholdChannels: 30_000,
          channels: active.length,
          ratio: Math.round((active.length / 30_000) * 1000) / 1000,
          atThreshold: active.length >= 30_000,
          targetTable: app.store.settings.targetTable || 0,
          command: 'node scripts/migrate.js --plan',
          reversible: true,
        },
        sessions: app.sessions.count(),
        ingestion: app.ingest.activeJob(),
        ingestions: await app.ingest.history(),
        backupList: backups,
        uptimeSeconds: Math.round(process.uptime()),
        computeMs: Math.round(performance.now() - started),
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-31 — sonde de disponibilité.
  router.post('/api/admin/health/probe', async ({ body, ip, requestId }) => {
    const limit = queryProbeLimit(body?.limit);
    const ids = Array.isArray(body?.ids) ? body.ids.slice(0, 100) : null;
    const pool = ids
      ? app.store.channels.filter((channel) => ids.includes(channel.id) && channel.url)
      : nextProbeBatch(app.store.channels.filter((channel) => !channel.deleted && channel.url), { limit });
    if (!pool.length) {
      throw new AppError('ERR-16', { params: { raison: 'aucune chaîne à sonder : toutes ont été testées récemment' } });
    }
    const ticket = app.probeLimiter.take(pool.length);
    if (!ticket.allowed) {
      throw new AppError('ERR-17', { params: { n: Math.max(1, Math.ceil(ticket.retryAfterSeconds / 60)) }, headers: { 'Retry-After': String(ticket.retryAfterSeconds) } });
    }
    const result = await probeChannels(pool, { concurrency: LIMITS.probeConcurrency, timeoutMs: LIMITS.probeTimeoutMs });
    await app.store.saveChannels('health.probe');
    await app.store.saveHealthSnapshot();
    await app.store.audit('health.probe', { ip, requestId, count: result.tested, detail: `${result.up} ok / ${result.flaky} instables / ${result.down} hs` });
    return {
      body: {
        ...result,
        message: `Sonde terminée : ${result.up} disponibles, ${result.flaky} instables, ${result.down} indisponibles sur ${result.tested} chaînes testées.`,
      },
      cache: 'no-store',
    };
  }, auth);

  /* ---------------------------------------------------------------- exports & sauvegardes */

  // EP-32 — export M3U.
  router.get('/api/admin/export.m3u', () => {
    const exported = exportM3U(app.store.channels.filter((channel) => !channel.deleted), {
      title: app.store.settings.brand,
      epgUrl: app.store.settings.epgUrl,
      includeHidden: true,
      settings: app.store.settings,
    });
    return {
      file: {
        content: exported.content,
        type: exported.type,
        disposition: exported.disposition,
      },
      cache: 'no-store',
      headers: { 'X-StreamTV-Count': String(exported.count) },
    };
  }, { auth: true, allowBody: false });

  // EP-33 — export JSON.
  router.get('/api/admin/export.json', () => {
    const exported = exportJson(app.store.channels.filter((channel) => !channel.deleted), {
      settings: app.store.settings,
      includeHidden: true,
      siteProtocol: app.siteProtocol,
    });
    return {
      file: { content: exported.content, type: exported.type, disposition: exported.disposition },
      cache: 'no-store',
      headers: { 'X-StreamTV-Count': String(exported.count) },
    };
  }, { auth: true, allowBody: false });

  // EP-34 — sauvegarde immédiate.
  router.post('/api/admin/backup', async ({ ip }) => {
    const backup = await app.store.backup('manual');
    await app.store.audit('backup.manual', { ip, detail: backup.file });
    return {
      body: {
        backup,
        message: `Sauvegarde créée : ${backup.file}.`,
      },
      cache: 'no-store',
    };
  }, auth);

  // EP-35 — restauration.
  router.post('/api/admin/restore', async ({ body, ip, requestId }) => {
    if (String(body?.confirm || '') !== 'RESTAURER') {
      throw new AppError('ERR-16', { params: { raison: 'saisissez RESTAURER pour confirmer' } });
    }
    const file = requireField(body?.file, 'file', 'fichier de sauvegarde', { max: 80 });
    const result = await app.store.restore(file);
    app.index.rebuild(app.store.channels.filter((channel) => !channel.deleted));
    await app.store.audit('backup.restore', { ip, requestId, count: result.count, detail: file });
    return {
      body: {
        message: `Sauvegarde restaurée : ${result.count} chaînes.`,
        count: result.count,
        file: result.file,
      },
      cache: 'no-store',
    };
  }, auth);

  /* ---------------------------------------------------------------- sécurité */

  // EP-36 — changement de mot de passe.
  registerPilotageRoutes(router, app);
  registerAccessRoutes(router, app);
  registerSetupRoutes(router, app);

  router.post('/api/admin/password', async ({ body, session, ip, requestId }) => {
    const current = String(body?.current || '');
    const next = String(body?.next || '');
    const confirm = String(body?.confirm || '');
    if (!current) throw new AppError('ERR-02', { field: 'current', params: { champ: 'mot de passe actuel' } });
    const valid = await app.auth.verify(current);
    if (!valid) throw new AppError('ERR-08', { field: 'current' });
    if (next !== confirm) throw new AppError('ERR-04', { field: 'confirm', params: { champ: 'confirmation' } });
    assertPasswordPolicy(next, current);
    const hashed = await hashPassword(next);
    app.store.security = {
      ...app.store.security,
      ...hashed,
      defaultPassword: false,
      updatedAt: now(),
    };
    await app.store.saveSecurity('password.change');
    app.sessions.revokeAll();
    await app.store.audit('password.change', { ip, requestId, detail: 'toutes les sessions ont été fermées' });
    return {
      body: {
        message: 'Mot de passe modifié. Toutes les sessions ont été fermées : reconnectez-vous.',
        mustReconnect: true,
      },
      cache: 'no-store',
    };
  }, { auth: true, bodyLimit: LIMITS.maxBodyAdmin });

  // EP-37 — fermeture de toutes les sessions.
  router.delete('/api/admin/sessions', async ({ ip, requestId }) => {
    const count = app.sessions.revokeAll();
    await app.store.audit('sessions.revoke', { ip, requestId, count });
    return { body: { message: `${count} session${count > 1 ? 's ont été fermées' : ' a été fermée'}.`, count }, cache: 'no-store' };
  }, auth);
}

function channelIdFor(urlNormalized) {
  return createHash('sha1').update(urlNormalized).digest('hex').slice(0, 12);
}

function queryProbeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 40;
  return Math.min(100, Math.max(1, Math.floor(number)));
}

function measureEngine(app) {
  const active = app.store.channels.filter((channel) => !channel.deleted);
  const sample = active.slice(0, 300);
  const compiled = table(app);
  const started = performance.now();
  let low = 0;
  let confidenceSum = 0;
  let genreTotal = 0;
  let genreMatch = 0;
  const decisions = { genre: 0, name: 0, fallback: 0, manual: 0, 'tvg-id': 0 };
  for (const channel of sample) {
    const result = classify({ ...channel, manualOverride: false }, { table: compiled });
    decisions[result.source] = (decisions[result.source] || 0) + 1;
    confidenceSum += result.confidence;
    if (result.confidence < 0.45) low += 1;
    if (channel.groupKind === 'genre') {
      genreTotal += 1;
      if (result.category === channel.category) genreMatch += 1;
    }
  }
  const durationMs = Math.max(0.001, performance.now() - started);
  const count = Math.max(1, sample.length);
  return {
    vitesse: Math.round((sample.length / durationMs) * 1000),
    accordGenre: genreTotal ? Math.round((genreMatch / genreTotal) * 100) / 100 : 1,
    sous045: Math.round((low / count) * 1000) / 1000,
    confianceMoyenne: Math.round((confidenceSum / count) * 100) / 100,
    parDecision: decisions,
    total: sample.length,
    durationMs: Math.round(durationMs * 100) / 100,
  };
}
