// server/api/admin-sources.js — console, onglet Sources (3.18.0).
// Chaque route nomme sa permission : lire, écrire, importer. Aucune n'est implicite.
// Toute action sensible laisse une ligne d'audit avec un code dédié.

import { LIMITS } from '../core/constants.js';
import { AppError } from '../core/errors.js';
import { importFromSource, resetSourceImport } from '../core/source-importer.js';
import {
  normalizeProbe,
  probeSingleSource,
  validateSourceInput,
} from '../core/sources.js';
import { queryString } from '../http/router.js';

const PROBE_CONCURRENCY = 4;

function summary(source) {
  return {
    id: source.id,
    nom: source.nom,
    type: source.type,
    contenu: source.contenu,
    url: source.url,
    licence: source.licence,
    pays: source.pays,
    langue: source.langue,
    actif: source.actif,
    priorite: source.priorite,
    note: source.note,
    seedFile: source.seedFile || '',
    lastIngestAt: source.lastIngestAt || null,
    sonde: normalizeProbe(source.sonde),
    /**
     * L'interface affiche « licence manquante » et grise le bouton d'import :
     * le serveur, lui, refuse de toute façon l'import (double garde-fou).
     */
    importable: Boolean(source.licence),
  };
}

function countContents(store, sourceId) {
  const chains = store.channels.filter((channel) => channel.sourceId === sourceId && !channel.deleted).length;
  const anime = store.anime.filter((item) => item.sourceId === sourceId && !item.deleted).length;
  const films = store.films.filter((item) => item.sourceId === sourceId && !item.deleted).length;
  return { chains, anime, films, total: chains + anime + films };
}

/** Sonde bornée : quatre sources en parallèle, jamais bloquante pour le reste de la console. */
async function probeAll(app, sources) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, sources.length) }, async () => {
    while (cursor < sources.length) {
      const index = cursor;
      cursor += 1;
      const source = sources[index];
      try {
        const probe = await probeSingleSource(source, { seedDir: await app.store.resolveSeedDir() });
        source.sonde = probe;
        results.push({ id: source.id, etat: probe.etat, joignable: probe.joignable });
      } catch (error) {
        const probe = normalizeProbe({
          ...source.sonde,
          joignable: false,
          etat: 'hors service',
          erreur: error.message,
          verifieLe: new Date().toISOString(),
          essais: (source.sonde?.essais || 0) + 1,
          echecs: (source.sonde?.echecs || 0) + 1,
        });
        source.sonde = probe;
        results.push({ id: source.id, etat: probe.etat, joignable: false });
      }
    }
  });
  await Promise.all(workers);
  await app.store.saveSources('source.probe');
  return results;
}

export function registerSourcesRoutes(router, app) {
  const auth = (permission) => ({ auth: true, permission, bodyLimit: LIMITS.maxBodyAdmin });

  router.get('/api/admin/sources', () => ({
    body: {
      sources: app.store.sources.map((source) => ({
        ...summary(source),
        contenus: countContents(app.store, source.id),
      })),
      licenceObligatoire: true,
      sondeStates: ['saine', 'instable', 'hors service'],
      imports: app.store.sourceImports.slice(0, 40).map((record) => ({
        id: record.id,
        at: record.at,
        sourceId: record.sourceId,
        sourceNom: record.sourceNom,
        contenu: record.contenu,
        counts: record.counts,
        attemptsUsed: record.attemptsUsed,
        durationMs: record.durationMs,
        status: record.status,
        rollbackAvailable: Boolean(record.rollbackAvailable),
      })),
      limiteCorps: LIMITS.maxBodyAdmin,
    },
    cache: 'no-store',
  }), auth('sources.read'));

  router.post('/api/admin/sources', async ({ body, session, ip, requestId }) => {
    const existingIds = new Set(app.store.sources.map((source) => source.id));
    const created = validateSourceInput(body || {}, { existingIds });
    app.store.sources.push(created);
    await app.store.saveSources('source.create');
    await app.store.audit('source.create', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${created.id} (${created.contenu}, licence ${created.licence})`,
    });
    return {
      status: 201,
      body: {
        source: { ...summary(created), contenus: countContents(app.store, created.id) },
        message: `Source « ${created.nom} » ajoutée avec sa licence.`,
      },
      cache: 'no-store',
    };
  }, auth('sources.write'));

  router.patch('/api/admin/sources/:id', async ({ params, body, session, ip, requestId }) => {
    const source = app.store.sources.find((item) => item.id === params.id);
    if (!source) throw new AppError('ERR-10', { message: 'Source introuvable.' });
    const updated = validateSourceInput(body || {}, { partial: true, existing: source });
    Object.assign(source, updated);
    await app.store.saveSources('source.update');
    const changed = Object.keys(body || {}).join(', ');
    await app.store.audit('source.update', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${source.id} : ${changed}`,
    });
    return {
      body: {
        source: { ...summary(source), contenus: countContents(app.store, source.id) },
        message: `Source « ${source.nom} » mise à jour.`,
      },
      cache: 'no-store',
    };
  }, auth('sources.write'));

  router.delete('/api/admin/sources/:id', async ({ params, session, ip, requestId }) => {
    const source = app.store.sources.find((item) => item.id === params.id);
    if (!source) throw new AppError('ERR-10', { message: 'Source introuvable.' });
    if (source.id === 'catalogue-propre') {
      throw new AppError('ERR-16', { message: 'La source des ajouts manuels ne peut pas être supprimée.' });
    }
    const contenus = countContents(app.store, source.id);
    app.store.sources = app.store.sources.filter((item) => item.id !== params.id);
    await app.store.saveSources('source.delete');
    await app.store.audit('source.delete', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      detail: `${source.id} (${source.nom}), ${contenus.total} contenu(s) conservé(s)`,
    });
    return {
      body: {
        message: `Source « ${source.nom} » supprimée. ${contenus.total} contenu(s) déjà importés restent au catalogue.`,
        contenusConserves: contenus.total,
      },
      cache: 'no-store',
    };
  }, auth('sources.write'));

  router.post('/api/admin/sources/probe', async ({ body, session, ip, requestId }) => {
    const wanted = Array.isArray(body?.ids) && body.ids.length
      ? app.store.sources.filter((source) => body.ids.includes(source.id))
      : app.store.sources;
    if (!wanted.length) throw new AppError('ERR-10', { message: 'Aucune source à sonder.' });
    const results = await probeAll(app, wanted);
    const counts = {
      saine: results.filter((item) => item.etat === 'saine').length,
      instable: results.filter((item) => item.etat === 'instable').length,
      'hors service': results.filter((item) => item.etat === 'hors service').length,
    };
    await app.store.audit('source.probe', {
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      count: results.length,
      detail: `${counts.saine} saines, ${counts.instable} instables, ${counts['hors service']} hors service`,
    });
    return {
      body: {
        results,
        counts,
        message: `Sonde terminée : ${counts.saine} saine(s), ${counts.instable} instable(s), ${counts['hors service']} hors service.`,
        sources: app.store.sources.map((source) => ({ ...summary(source), contenus: countContents(app.store, source.id) })),
      },
      cache: 'no-store',
    };
  }, auth('sources.write'));

  router.post('/api/admin/sources/:id/import', async ({ params, body, session, ip, requestId }) => {
    const source = app.store.sources.find((item) => item.id === params.id);
    if (!source) throw new AppError('ERR-10', { message: 'Source introuvable.' });
    if (source.actif === false) {
      throw new AppError('ERR-16', { message: `La source « ${source.nom} » est désactivée : activez-la avant de l’importer.` });
    }
    const result = await importFromSource({
      store: app.store,
      index: app.index,
      sourceOrId: source,
      rawPayload: body?.payload ?? null,
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
      siteProtocol: app.siteProtocol,
    });
    return {
      body: {
        ...result,
        sources: app.store.sources.map((item) => ({ ...summary(item), contenus: countContents(app.store, item.id) })),
      },
      cache: 'no-store',
    };
  }, { ...auth('sources.import'), bodyLimit: LIMITS.maxBodyImport });

  router.get('/api/admin/sources/imports', ({ query }) => {
    const sourceId = queryString(query, 'source', { max: 48 });
    const list = app.store.sourceImports
      .filter((record) => !sourceId || record.sourceId === sourceId)
      .slice(0, 60);
    return {
      body: {
        total: list.length,
        imports: list.map((record) => ({
          id: record.id,
          at: record.at,
          sourceId: record.sourceId,
          sourceNom: record.sourceNom,
          contenu: record.contenu,
          licence: record.licence,
          counts: record.counts,
          attemptsUsed: record.attemptsUsed,
          durationMs: record.durationMs,
          status: record.status,
          rollbackAvailable: Boolean(record.rollbackAvailable),
        })),
      },
      cache: 'no-store',
    };
  }, auth('sources.read'));

  router.post('/api/admin/sources/imports/:id/reset', async ({ params, session, ip, requestId }) => {
    const result = await resetSourceImport({
      store: app.store,
      index: app.index,
      importId: params.id,
      actor: session?.memberName || 'Administrateur',
      ip,
      requestId,
    });
    return { body: result, cache: 'no-store' };
  }, auth('sources.import'));
}
