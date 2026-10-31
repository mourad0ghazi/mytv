// server/core/source-importer.js — importation multi-catégories pilotée par source.
// Garanties :
// - Refus immédiat et journalisé si la licence de la source est absente.
// - Téléchargement avec budget de tentatives (sourceRetryBudget).
// - Arbitrage des doublons par priorité de source, systématiquement journalisé.
// - Écriture atomique en fin de lot uniquement (jamais de catalogue partiel).

import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { buildChannel, channelId, defaultHealth } from './channels.js';
import { categorizeEntry, compileRules } from './classify.js';
import { CATEGORY_BY_ID, LIMITS, QUALITY_RANK } from './constants.js';
import { dedupe, finalizeEntries } from './dedupe.js';
import { AppError } from './errors.js';
import { effectiveRules } from './learning.js';
import { parseM3U } from './m3u.js';
import { arbitrateDuplicate, assertSourceLicensed, fetchWithRetry } from './sources.js';
import { mergeVodBatch } from './vod.js';

function importRecordId() {
  return `srcimp-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

async function readSourcePayload(store, source, { rawPayload = null, fetchImpl = fetch, baseDelayMs = 120 } = {}) {
  if (rawPayload !== null && rawPayload !== undefined) {
    const text = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    return { text, attemptsUsed: 1 };
  }
  if (source.seedFile) {
    const seedDir = await store.resolveSeedDir();
    const text = await fsp.readFile(path.join(seedDir, source.seedFile), 'utf8');
    return { text, attemptsUsed: 1 };
  }
  if (!source.url) {
    throw new AppError('ERR-16', {
      message: `La source « ${source.nom} » n’a aucune adresse de flux à importer.`,
    });
  }
  const budget = Number(store.settings?.sourceRetryBudget) || 3;
  const fetched = await fetchWithRetry(source.url, {
    maxAttempts: budget,
    baseDelayMs,
    fetchImpl,
  });
  return { text: fetched.text, attemptsUsed: fetched.attemptsUsed };
}

function sourcePriorityMap(sources = []) {
  const map = new Map();
  for (const src of sources) {
    map.set(src.id, Number(src.priorite) || 50);
    if (src.nom) map.set(src.nom, Number(src.priorite) || 50);
  }
  return map;
}

function mergeDirectM3u({ store, source, text, siteProtocol = 'https:' }) {
  const parsed = parseM3U(text, { sourceLabel: source.id, siteProtocol });
  if (!parsed.entries.length) {
    throw new AppError('ERR-05', {
      message: `La source « ${source.nom} » ne contient aucune chaîne M3U lisible.`,
    });
  }
  const deduped = dedupe(parsed.entries);
  const entries = finalizeEntries(deduped.entries);
  const table = compileRules(effectiveRules(store.learning));
  const prioBySource = sourcePriorityMap(store.sources);

  const cloned = store.channels.map((ch) => structuredClone(ch));
  const byId = new Map(cloned.map((ch) => [ch.id, ch]));
  let nextNumber = cloned.reduce((max, ch) => Math.max(max, ch.number || 0), 0) + 1;
  const now = new Date().toISOString();

  const addedIds = [];
  const beforeById = new Map();
  const arbitrations = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of entries) {
    const id = channelId(entry.urlNormalized);
    const existing = byId.get(id);
    const classification = categorizeEntry(entry, table, existing);

    if (!existing) {
      const channel = buildChannel({
        entry,
        number: nextNumber,
        category: CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre,
        classification,
        sourceId: source.id,
        siteProtocol,
        now,
        position: cloned.length,
      });
      channel.licenseNote = source.licence;
      nextNumber += 1;
      cloned.push(channel);
      byId.set(channel.id, channel);
      addedIds.push(channel.id);
      added += 1;
      continue;
    }

    const existingSourceId = existing.sourceId || 'inconnue';
    const existingPrio = prioBySource.get(existingSourceId) ?? 50;
    const decision = arbitrateDuplicate({
      contentType: 'chaine',
      contentId: existing.id,
      incomingSource: source,
      existingSourceId,
      existingPriorite: existingPrio,
    });

    if (decision.isDuplicateBetweenSources) {
      arbitrations.push({
        contentType: 'chaine',
        contentId: existing.id,
        winner: decision.winner === 'incoming' ? source.id : existingSourceId,
        loser: decision.winner === 'incoming' ? existingSourceId : source.id,
        replaced: decision.replaced,
        detail: decision.detail,
      });
    }

    if (decision.replaced && !existing.manualOverride) {
      if (!beforeById.has(existing.id)) beforeById.set(existing.id, structuredClone(existing));
      existing.name = entry.name || existing.name;
      existing.logo = entry.logo || existing.logo;
      existing.quality = (QUALITY_RANK[entry.quality] || 0) >= (QUALITY_RANK[existing.quality] || 0)
        ? entry.quality
        : existing.quality;
      existing.sourceId = source.id;
      existing.licenseNote = source.licence;
      existing.updatedAt = now;
      existing.lastSeenInSourceAt = now;
      updated += 1;
    } else {
      if (entry.url && entry.url !== existing.url) {
        const variants = existing.variants || [];
        if (!variants.some((v) => v.url === entry.url) && variants.length < LIMITS.maxVariants - 1) {
          if (!beforeById.has(existing.id)) beforeById.set(existing.id, structuredClone(existing));
          variants.push({ id, name: entry.name, quality: entry.quality, url: entry.url, health: defaultHealth() });
          existing.variants = variants;
          updated += 1;
          continue;
        }
      }
      unchanged += 1;
    }
  }

  return {
    nextChannels: cloned,
    addedIds,
    beforeUpdates: [...beforeById.values()],
    arbitrations,
    counts: {
      entries: entries.length,
      added,
      updated,
      unchanged,
      duplicatesArbitrated: arbitrations.length,
      skippedUnlicensed: 0,
    },
  };
}

/** Exécute l'importation incrémentale d'une source enregistrée ou passée en argument. */
export async function importFromSource({
  store,
  index = null,
  sourceOrId,
  rawPayload = null,
  actor = 'admin',
  ip = '',
  requestId = '',
  siteProtocol = 'https:',
  fetchImpl = fetch,
  baseDelayMs = 120,
}) {
  const source = typeof sourceOrId === 'string'
    ? store.sources.find((item) => item.id === sourceOrId)
    : sourceOrId;
  if (!source) {
    throw new AppError('ERR-10', { message: `Source « ${sourceOrId} » introuvable.` });
  }

  try {
    assertSourceLicensed(source);
  } catch (error) {
    await store.audit('source.import.refused', {
      actor,
      ip,
      requestId,
      result: 'licence absente',
      detail: `${source.id} (${source.nom || source.id})`,
    });
    await store.logEvent('warn', 'source.import.refused', {
      sourceId: source.id,
      reason: 'licence absente',
    });
    throw error;
  }

  const startedAt = Date.now();
  const { text, attemptsUsed } = await readSourcePayload(store, source, { rawPayload, fetchImpl, baseDelayMs });
  const now = new Date().toISOString();
  const importId = importRecordId();

  let counts;
  let arbitrations = [];
  let snapshotBefore = [];
  let addedIds = [];

  if (source.contenu === 'anime' || source.contenu === 'film') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError('ERR-05', {
        message: `Le flux JSON de la source « ${source.nom} » est illisible.`,
      });
    }
    const existingList = source.contenu === 'anime' ? store.anime : store.films;
    const beforeMap = new Map(existingList.map((item) => [item.id, structuredClone(item)]));
    const merged = mergeVodBatch({
      kind: source.contenu,
      existingItems: existingList,
      rawEntries: parsed,
      source,
    });
    counts = merged.counts;
    arbitrations = merged.arbitrations;
    addedIds = merged.addedIds;
    const addedSet = new Set(addedIds);
    snapshotBefore = merged.nextItems
      .filter((item) => !addedSet.has(item.id) && beforeMap.has(item.id))
      .map((item) => beforeMap.get(item.id));

    if (source.contenu === 'anime') {
      store.anime = merged.nextItems;
      await store.saveAnime('source.import');
    } else {
      store.films = merged.nextItems;
      await store.saveFilms('source.import');
    }
  } else {
    const merged = mergeDirectM3u({ store, source, text, siteProtocol });
    counts = merged.counts;
    arbitrations = merged.arbitrations;
    addedIds = merged.addedIds;
    snapshotBefore = merged.beforeUpdates;
    store.channels = merged.nextChannels;
    await store.saveChannels('source.import');
    if (index) index.rebuild(store.channels);
  }

  // Journalisation systématique de chaque arbitrage de doublon (jamais silencieux).
  for (const arb of arbitrations) {
    await store.audit('source.duplicate.arbitrated', {
      actor,
      ip,
      requestId,
      detail: arb.detail,
    });
    await store.logEvent('info', 'source.duplicate', arb);
  }

  const storedSource = store.sources.find((item) => item.id === source.id);
  if (storedSource) {
    storedSource.lastIngestAt = now;
    await store.saveSources('source.import');
  }

  const record = {
    id: importId,
    at: now,
    sourceId: source.id,
    sourceNom: source.nom || source.id,
    contenu: source.contenu,
    licence: source.licence,
    priorite: source.priorite,
    actor,
    attemptsUsed,
    durationMs: Math.max(1, Date.now() - startedAt),
    counts,
    status: 'applied',
    rollbackAvailable: snapshotBefore.length <= 2000,
    addedIds,
    snapshotBefore: snapshotBefore.length <= 2000 ? snapshotBefore : [],
  };
  store.sourceImports.unshift(record);
  await store.saveSourceImports('source.import');

  await store.audit('source.import', {
    actor,
    ip,
    requestId,
    count: counts.added,
    detail: `${source.id} (${source.contenu}) : ${counts.added} ajouts, ${counts.updated} mises à jour, ${counts.duplicatesArbitrated} doublons arbitrés`,
  });

  return {
    id: importId,
    sourceId: source.id,
    contenu: source.contenu,
    attemptsUsed,
    counts,
    arbitrations,
    status: 'applied',
    message: `Import de « ${source.nom} » terminé : ${counts.added} ajouté(s), ${counts.updated} mis à jour, ${counts.duplicatesArbitrated} doublon(s) arbitré(s).`,
  };
}

/** Remet à zéro (annule) un import de source précédent de manière atomique. */
export async function resetSourceImport({ store, index = null, importId, actor = 'admin', ip = '', requestId = '' }) {
  const record = store.sourceImports.find((item) => item.id === importId);
  if (!record) {
    throw new AppError('ERR-10', { message: 'Importation de source introuvable.' });
  }
  if (record.status !== 'applied') {
    throw new AppError('ERR-16', { message: 'Cet import a déjà été remis à zéro.' });
  }
  if (!record.rollbackAvailable) {
    throw new AppError('ERR-16', { message: 'Cet import est trop volumineux pour être remis à zéro automatiquement.' });
  }

  const addedSet = new Set(record.addedIds || []);
  const beforeMap = new Map((record.snapshotBefore || []).map((item) => [item.id, item]));
  let removed = 0;

  if (record.contenu === 'anime') {
    removed = store.anime.filter((item) => addedSet.has(item.id)).length;
    store.anime = store.anime
      .filter((item) => !addedSet.has(item.id))
      .map((item) => (beforeMap.has(item.id) ? structuredClone(beforeMap.get(item.id)) : item));
    await store.saveAnime('source.import.reset');
  } else if (record.contenu === 'film') {
    removed = store.films.filter((item) => addedSet.has(item.id)).length;
    store.films = store.films
      .filter((item) => !addedSet.has(item.id))
      .map((item) => (beforeMap.has(item.id) ? structuredClone(beforeMap.get(item.id)) : item));
    await store.saveFilms('source.import.reset');
  } else {
    removed = store.channels.filter((item) => addedSet.has(item.id)).length;
    store.channels = store.channels
      .filter((item) => !addedSet.has(item.id))
      .map((item) => (beforeMap.has(item.id) ? structuredClone(beforeMap.get(item.id)) : item));
    store.channels.forEach((ch, idx) => { ch.position = idx; });
    await store.saveChannels('source.import.reset');
    if (index) index.rebuild(store.channels);
  }

  record.status = 'reinitialise';
  record.resetAt = new Date().toISOString();
  await store.saveSourceImports('source.import.reset');
  await store.audit('source.import.reset', {
    actor,
    ip,
    requestId,
    count: removed,
    detail: `${record.sourceId} (${importId})`,
  });

  return {
    id: record.id,
    removed,
    status: record.status,
    message: `Import remis à zéro : ${removed} contenu(s) retiré(s).`,
  };
}
