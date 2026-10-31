// server/core/ingest.js — F-20 : ingestion prévisualisée, verrou global, commit atomique, annulation.
// Aucune écriture avant le commit : l'aperçu ne touche ni le disque ni le catalogue.

import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LIMITS, QUALITY_RANK, CATEGORY_BY_ID } from './constants.js';
import { buildChannel, channelId, defaultHealth, isPublic, assertMassWrite } from './channels.js';
import { AppError } from './errors.js';
import { dedupe, finalizeEntries } from './dedupe.js';
import { parseM3U } from './m3u.js';
import { categorizeEntry, compileRules } from './classify.js';
import { effectiveRules } from './learning.js';
import { assertSourceLicensed } from './sources.js';
import { normalizeKey } from './text.js';

const JOB_TTL_MS = 20 * 60 * 1000;

function ingestionId() {
  return `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;
}

export class Ingest {
  constructor({ store, index, logger = console, siteProtocol = 'https:', dataDir = 'data', table = null }) {
    this.store = store;
    this.index = index;
    this.logger = logger;
    this.siteProtocol = siteProtocol;
    this.dataDir = dataDir;
    this.jobs = new Map();
    this.locked = null;
    this.table = table;
    this.ingestions = [];
    this.loaded = false;
  }

  get tableRef() {
    return this.table || null;
  }

  async loadHistory() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fsp.readFile(path.join(this.dataDir, 'ingestions.json'), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.ingestions)) this.ingestions = parsed.ingestions;
    } catch { /* premier démarrage */ }
  }

  async saveHistory() {
    const file = path.join(this.dataDir, 'ingestions.json');
    const tmp = `${file}.tmp-${Date.now()}`;
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.writeFile(tmp, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), ingestions: this.ingestions.slice(0, 60) })}\n`, { mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  activeJob() {
    return this.locked;
  }

  /** Télécharge une playlist avec plafond de taille, délai et redirections bornées. */
  async fetchSource(url) {
    let target;
    try { target = new URL(url); } catch { throw new AppError('ERR-04', { field: 'url', params: { champ: 'adresse de la liste' } }); }
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new AppError('ERR-04', { field: 'url', params: { champ: 'adresse de la liste' } });
    }
    if (target.protocol === 'http:' && this.siteProtocol === 'https:') {
      // Le serveur peut lire http, mais on prévient l'utilisateur dans les avertissements.
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs);
    try {
      const response = await fetch(target, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'StreamTV/3.0 (+ingestion M3U)', Accept: 'audio/x-mpegurl, application/x-mpegURL, text/plain, */*' },
      });
      if (!response.ok) {
        throw new AppError('ERR-20', { params: {} });
      }
      if (Number(response.headers.get('content-length') || 0) > LIMITS.fetchMaxBytes) {
        throw new AppError('ERR-15', { params: { max: '20 Mo' } });
      }
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        if (Buffer.byteLength(text) > LIMITS.fetchMaxBytes) throw new AppError('ERR-15', { params: { max: '20 Mo' } });
        return { text, url: response.url || url, bytes: Buffer.byteLength(text) };
      }
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIMITS.fetchMaxBytes) {
          controller.abort();
          throw new AppError('ERR-15', { params: { max: '20 Mo' } });
        }
        chunks.push(Buffer.from(value));
      }
      const buffer = Buffer.concat(chunks);
      return { text: buffer.toString('utf8'), url: response.url || url, bytes: buffer.length };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error.name === 'AbortError') throw new AppError('ERR-20');
      throw new AppError('ERR-20');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Prépare un travail d'importation sans rien écrire. */
  async preview(options = {}) {
    const { url = '', text = '', name = '', sourceId = '', actor = 'admin', ip = '', requestId = '' } = options;
    await this.loadHistory();
    if (this.locked) {
      throw new AppError('ERR-13', { headers: { 'Retry-After': '30' } });
    }
    if (sourceId) {
      const targetSource = this.store.sources.find((item) => item.id === sourceId);
      if (!targetSource) throw new AppError('ERR-10', { message: `Source « ${sourceId} » introuvable.` });
      try {
        assertSourceLicensed(targetSource);
      } catch (error) {
        await this.store.audit('source.import.refused', { actor, ip, requestId, result: 'licence absente', detail: sourceId });
        throw error;
      }
    } else if ('licence' in options || 'license' in options) {
      try {
        assertSourceLicensed({ nom: name || url || 'liste importée', licence: options.licence ?? options.license });
      } catch (error) {
        await this.store.audit('source.import.refused', { actor, ip, requestId, result: 'licence absente', detail: name || url });
        throw error;
      }
    }
    let raw = text || '';
    let sourceUrl = url || '';
    let sourceName = name || '';
    if (!raw) {
      if (!sourceUrl) throw new AppError('ERR-02', { field: 'url', params: { champ: 'adresse de la liste' } });
      const fetched = await this.fetchSource(sourceUrl);
      raw = fetched.text;
      sourceUrl = fetched.url;
      sourceName = sourceName || (() => {
        try { return new URL(fetched.url).host; } catch { return 'liste'; }
      })();
    } else {
      sourceName = sourceName || 'liste collée';
    }

    const started = Date.now();
    const parsed = parseM3U(raw, { sourceLabel: sourceName, siteProtocol: this.siteProtocol });
    if (!parsed.entries.length) {
      throw new AppError('ERR-05');
    }
    const deduped = dedupe(parsed.entries);
    const entries = finalizeEntries(deduped.entries);
    const table = this.tableRef || compileRules(effectiveRules(this.store.learning));

    const existingById = new Map(this.store.channels.map((channel) => [channel.id, channel]));
    const existingBySignature = new Map();
    for (const channel of this.store.channels) {
      existingBySignature.set(`${normalizeKey(channel.name)}|${channel.country || ''}`, channel);
    }

    const seenIds = new Set();
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let keptManual = 0;
    let aboutToBlock = 0;
    const sample = [];
    const future = [];

    for (const entry of entries) {
      if (Date.now() - started > LIMITS.importMaxMs) {
        throw new AppError('ERR-20');
      }
      const id = channelId(entry.urlNormalized);
      const existing = existingById.get(id) || existingBySignature.get(`${normalizeKey(entry.name)}|${entry.country || ''}`);
      const classification = categorizeEntry(entry, table, existing);
      const blockedPreview = (this.siteProtocol === 'https:' && /^http:/i.test(entry.url))
        || entry.tags.includes('ua-required')
        || !entry.url;
      if (blockedPreview) aboutToBlock += 1;

      if (!existing) {
        added += 1;
        seenIds.add(id);
        if (sample.length < 12) {
          sample.push({
            id,
            name: entry.name,
            category: classification.category,
            categoryLabel: (CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre).label,
            categorySource: classification.source,
            confidence: classification.confidence,
            quality: entry.quality,
            country: entry.country,
            blocked: blockedPreview,
          });
        }
      } else {
        seenIds.add(existing.id);
        if (existing.manualOverride) {
          keptManual += 1;
          unchanged += 1;
        } else if (classification.category !== existing.category
          || (QUALITY_RANK[entry.quality] || 0) > (QUALITY_RANK[existing.quality] || 0)
          || entry.logo && !existing.logo
          || entry.name !== existing.name
          || String(existing.lastSeenInSourceAt || '').slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
      future.push({ entry, id: existing?.id || id, classification, existing });
    }

    const counts = {
      added,
      updated,
      unchanged,
      keptManual,
      entries: entries.length,
      blocked: aboutToBlock,
    };
    const job = {
      id: `job-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      expiresAt: Date.now() + JOB_TTL_MS,
      sourceUrl,
      sourceName,
      actor,
      ip,
      requestId,
      counts,
      entries: future,
      stats: { ...parsed.stats, duplicatesMerged: deduped.stats.mergedVariants, unique: entries.length },
      warnings: parsed.warnings,
      errors: parsed.errors,
      sample,
      totalBefore: this.store.channels.length,
    };
    this.jobs.set(job.id, job);
    for (const [key, value] of this.jobs) {
      if (value.expiresAt < Date.now()) this.jobs.delete(key);
    }
    return {
      jobId: job.id,
      sourceName,
      sourceUrl,
      counts,
      stats: job.stats,
      warnings: job.warnings,
      errors: job.errors,
      sample,
      totalBefore: job.totalBefore,
      totalAfter: this.store.channels.length + added,
      expiresIn: Math.round(JOB_TTL_MS / 1000),
    };
  }

  /** Applique un travail : verrou global, écriture atomique, journal d'audit. */
  async commit(jobId, { actor = 'admin', ip = '', requestId = '' } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError('ERR-16', { params: { raison: 'aperçu introuvable ou expiré, relancez l’analyse' } });
    if (job.expiresAt < Date.now()) {
      this.jobs.delete(jobId);
      throw new AppError('ERR-16', { params: { raison: 'aperçu expiré, relancez l’analyse' } });
    }
    if (this.locked) throw new AppError('ERR-13', { headers: { 'Retry-After': '30' } });

    const started = Date.now();
    this.locked = { jobId, at: new Date().toISOString(), actor };
    try {
      const now = new Date().toISOString();
      const byId = new Map(this.store.channels.map((channel) => [channel.id, channel]));
      const bySignature = new Map();
      for (const channel of this.store.channels) bySignature.set(`${normalizeKey(channel.name)}|${channel.country || ''}`, channel);
      let nextNumber = this.store.channels.reduce((max, channel) => Math.max(max, channel.number || 0), 0) + 1;
      const addedIds = [];
      const updates = [];
      let added = 0;
      let updated = 0;
      let keptManual = 0;

      for (const item of job.entries) {
        if (Date.now() - started > LIMITS.importMaxMs) {
          throw new AppError('ERR-20');
        }
        const { entry, classification } = item;
        const id = channelId(entry.urlNormalized);
        const existing = byId.get(id)
          || bySignature.get(`${normalizeKey(entry.name)}|${entry.country || ''}`)
          || null;

        if (!existing) {
          const channel = buildChannel({
            entry,
            number: nextNumber,
            category: CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre,
            classification,
            sourceId: job.sourceName,
            siteProtocol: this.siteProtocol,
            now,
            position: this.store.channels.length,
          });
          nextNumber += 1;
          this.store.channels.push(channel);
          byId.set(channel.id, channel);
          bySignature.set(`${normalizeKey(channel.name)}|${channel.country || ''}`, channel);
          addedIds.push(channel.id);
          added += 1;
          continue;
        }

        if (existing.manualOverride) {
          keptManual += 1;
          existing.lastSeenInSourceAt = now;
          const before = snapshot(existing);
          updates.push({ id: existing.id, before });
          continue;
        }

        const before = snapshot(existing);
        existing.lastSeenInSourceAt = now;
        existing.updatedAt = now;
        existing.name = entry.name || existing.name;
        existing.rawName = entry.rawName || existing.rawName;
        existing.logo = entry.logo || existing.logo;
        existing.group = entry.group || existing.group;
        existing.groupKind = entry.groupKind || existing.groupKind;
        existing.tvgId = entry.tvgId || existing.tvgId;
        existing.tvgName = entry.tvgName || existing.tvgName;
        existing.quality = (QUALITY_RANK[entry.quality] || 0) > (QUALITY_RANK[existing.quality] || 0) ? entry.quality : existing.quality;
        existing.language = entry.language || existing.language;
        existing.country = entry.country || existing.country;
        existing.tags = [...new Set([...(existing.tags || []), ...entry.tags])].slice(0, 12);
        existing.category = classification.category;
        existing.categoryLabel = (CATEGORY_BY_ID[classification.category] || CATEGORY_BY_ID.autre).label;
        existing.categorySource = classification.source;
        existing.confidence = classification.confidence;
        existing.reasons = classification.reasons;
        if (!this.store.settings.showAdult && this.store.settings.autoHideAdult && existing.category === 'adulte') {
          existing.visible = false;
          existing.blocked = true;
          existing.blockedReason = 'adult';
        }
        if (entry.url !== existing.url && entry.urlNormalized !== existing.urlNormalized) {
          const variants = existing.variants || [];
          if (!variants.some((variant) => variant.url === entry.url) && variants.length < LIMITS.maxVariants - 1) {
            variants.push({ id, name: entry.name, quality: entry.quality, url: entry.url, health: defaultHealth() });
          }
          existing.variants = variants;
        }
        updates.push({ id: existing.id, before });
        updated += 1;
      }

      assertMassWrite(this.store.channels.length - added, this.store.channels.length, { operation: 'l’importation' });
      const visibleAfter = this.store.channels.filter((channel) => isPublic(channel, this.store.settings)).length;
      if (visibleAfter === 0 && this.store.channels.length > 0) {
        throw new AppError('ERR-16', { params: { raison: 'le catalogue serait entièrement masqué après importation' } });
      }

      await this.store.saveChannels('import');
      if (this.index) this.index.rebuild(this.store.channels);
      const record = {
        // L'identifiant du travail devient l'identifiant de l'importation : l'interface
        // peut demander l'état ou l'annulation avec le même identifiant.
        id: job.id,
        jobId: job.id,
        label: ingestionId(),
        at: now,
        sourceName: job.sourceName,
        sourceUrl: job.sourceUrl,
        actor,
        counts: { added, updated, keptManual, entries: job.entries.length },
        totalAfter: this.store.channels.length,
        status: 'applied',
        addedIds,
        updates: updates.slice(0, 4000),
        rollbackAvailable: updates.length <= 4000,
      };
      this.ingestions.unshift(record);
      await this.saveHistory();
      for (const source of this.store.sources) {
        if (source.name === job.sourceName || source.id === job.sourceName) source.lastIngestAt = now;
      }
      await this.store.saveSources('import');
      await this.store.audit('import.commit', {
        actor, ip, requestId, count: added,
        detail: `${added} ajouts, ${updated} mises à jour, ${keptManual} verrouillées`,
      });
      this.jobs.delete(jobId);
      return {
        id: record.id,
        message: `Importation terminée : ${added} chaîne${added > 1 ? 's ajoutées' : ' ajoutée'}, ${updated} mise${updated > 1 ? 's' : ''} à jour.`,
        counts: record.counts,
        totalAfter: record.totalAfter,
        durationMs: Date.now() - started,
      };
    } finally {
      this.locked = null;
    }
  }

  async status(jobId) {
    await this.loadHistory();
    const job = this.jobs.get(jobId);
    if (job) return { status: 'pending', counts: job.counts, expiresAt: new Date(job.expiresAt).toISOString() };
    const record = this.ingestions.find((item) => item.id === jobId || item.jobId === jobId);
    if (record) {
      return {
        status: record.status,
        counts: record.counts,
        totalAfter: record.totalAfter,
        at: record.at,
        rollbackAvailable: record.status === 'applied' && record.rollbackAvailable !== false,
      };
    }
    throw new AppError('ERR-16', { params: { raison: 'importation inconnue' } });
  }

  async history() {
    await this.loadHistory();
    return this.ingestions.map((record) => ({
      id: record.id,
      at: record.at,
      sourceName: record.sourceName,
      counts: record.counts,
      totalAfter: record.totalAfter,
      status: record.status,
      rollbackAvailable: record.status === 'applied' && record.rollbackAvailable !== false,
    }));
  }

  async rollback(recordId, { actor = 'admin', ip = '', requestId = '' } = {}) {
    await this.loadHistory();
    const record = this.ingestions.find((item) => item.id === recordId || item.jobId === recordId);
    if (!record) throw new AppError('ERR-16', { params: { raison: 'importation inconnue' } });
    if (record.status !== 'applied') throw new AppError('ERR-16', { params: { raison: 'cette importation a déjà été annulée' } });
    if (record.rollbackAvailable === false) {
      throw new AppError('ERR-16', { params: { raison: 'cette importation est trop ancienne pour être annulée' } });
    }
    if (this.locked) throw new AppError('ERR-13', { headers: { 'Retry-After': '30' } });
    this.locked = { jobId: `rollback-${recordId}`, at: new Date().toISOString(), actor };
    try {
      const addedIds = new Set(record.addedIds || []);
      const removed = this.store.channels.filter((channel) => addedIds.has(channel.id)).length;
      this.store.channels = this.store.channels.filter((channel) => !addedIds.has(channel.id));
      const byId = new Map(this.store.channels.map((channel) => [channel.id, channel]));
      let restored = 0;
      for (const update of record.updates || []) {
        const channel = byId.get(update.id);
        if (!channel) continue;
        Object.assign(channel, update.before);
        restored += 1;
      }
      this.store.channels.forEach((channel, index) => { channel.position = index; });
      await this.store.saveChannels('rollback');
      if (this.index) this.index.rebuild(this.store.channels);
      record.status = 'rolledBack';
      record.rolledBackAt = new Date().toISOString();
      await this.saveHistory();
      await this.store.audit('import.rollback', { actor, ip, requestId, count: removed, detail: recordId });
      return {
        message: `Importation annulée : ${removed} chaîne${removed > 1 ? 's retirées' : ' retirée'}, ${restored} restaurée${restored > 1 ? 's' : ''}.`,
        removed,
        restored,
        total: this.store.channels.length,
      };
    } finally {
      this.locked = null;
    }
  }
}

function snapshot(channel) {
  return {
    name: channel.name,
    rawName: channel.rawName,
    logo: channel.logo,
    group: channel.group,
    groupKind: channel.groupKind,
    tvgId: channel.tvgId,
    tvgName: channel.tvgName,
    quality: channel.quality,
    language: channel.language,
    country: channel.country,
    tags: channel.tags,
    category: channel.category,
    categoryLabel: channel.categoryLabel,
    categorySource: channel.categorySource,
    confidence: channel.confidence,
    reasons: channel.reasons,
    visible: channel.visible,
    blocked: channel.blocked,
    blockedReason: channel.blockedReason,
    variants: channel.variants,
    lastSeenInSourceAt: channel.lastSeenInSourceAt,
    updatedAt: channel.updatedAt,
  };
}
