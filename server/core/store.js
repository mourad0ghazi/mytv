// server/core/store.js — persistance JSON atomique (BUG-09), sauvegardes tournantes, journal d'audit.
// Trois fichiers de catalogue distincts : channels.json, anime.json et films.json,
// tous au même format de version, de date et d'écriture atomique (tmp → fsync → rename).

import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, normalizeSettings } from './settings.js';
import { DEFAULT_SOURCES, normalizeSource, normalizeSourcesList } from './sources.js';
import { mergeVodBatch, normalizeAnime, normalizeFilm } from './vod.js';

const REPO_SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'seed');

const FILES = {
  channels: 'channels.json',
  anime: 'anime.json',
  films: 'films.json',
  settings: 'settings.json',
  sources: 'sources.json',
  health: 'health.json',
  learning: 'learning.json',
  reports: 'reports.json',
  team: 'team.json',
  plays: 'plays.json',
  devices: 'devices.json',
  accessLinks: 'access-links.json',
  sourceImports: 'source-imports.json',
  users: 'users.json',
  audit: 'audit.log',
};

const DATA_VERSION = 3;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return `${target.getUTCFullYear()}-W${String(Math.ceil(((target - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

function maskSecrets(value) {
  return String(value)
    .replace(/([?&](?:token|signature|sig|expire|sid|key|password)=)[^&\s]+/gi, '$1***')
    .replace(/(Bearer\s+)[a-f0-9]{8,}/gi, '$1***');
}

export class Store {
  constructor({ dataDir, logger = console }) {
    this.dataDir = dataDir;
    this.backupDir = path.join(dataDir, 'backups');
    this.logDir = path.join(dataDir, 'logs');
    this.logger = logger;
    this.channels = [];
    this.anime = [];
    this.films = [];
    this.settings = { ...DEFAULTS };
    this.sources = [];
    this.sourceImports = [];
    this.users = [];
    this.learning = { rules: {}, learned: {}, learnedStats: null, corrections: [], updatedAt: null };
    this.reports = { counters: {}, reports: [], lastRef: 0, updatedAt: null };
    this.security = { passwordHash: '', salt: '', iterations: 16384, defaultPassword: true, updatedAt: null };
    this.notices = [];
    this.loadedAt = null;
    this.error = null;
    // Position de la sonde rotative : survit au redémarrage avec le reste de health.json.
    this.probe = { cursor: 0, runs: 0, lastAt: null, tested: 0 };
    this.writeQueue = Promise.resolve();
    this.auditQueue = Promise.resolve();
  }

  file(key) {
    return path.join(this.dataDir, FILES[key]);
  }

  async resolveSeedDir() {
    const localSeed = path.join(this.dataDir, 'seed');
    try {
      const names = await fsp.readdir(localSeed);
      if (names.some((name) => name.endsWith('.json'))) return localSeed;
    } catch { /* repli sur data/seed du dépôt */ }
    return REPO_SEED_DIR;
  }

  async ensureDirs() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(this.backupDir, { recursive: true });
    await fsp.mkdir(this.logDir, { recursive: true });
  }

  /* --------------------------------------------------------------- lecture */

  async readJson(file, fallback) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      if (!raw.trim()) return { data: fallback, missing: true, corrupt: false };
      return { data: JSON.parse(raw), missing: false, corrupt: false };
    } catch (error) {
      if (error.code === 'ENOENT') return { data: fallback, missing: true, corrupt: false };
      return { data: fallback, missing: false, corrupt: true, error };
    }
  }

  async init() {
    await this.ensureDirs();
    await this.loadChannels();
    await this.loadSettings();
    await this.loadSources();
    const animeMissing = await this.loadAnime();
    const filmsMissing = await this.loadFilms();
    const importsMissing = await this.loadSourceImports();
    await this.loadLearning();
    await this.loadHealthSnapshot();
    this.loadedAt = new Date().toISOString();
    await this.saveSources('init');
    if (animeMissing) await this.saveAnime('init');
    if (filmsMissing) await this.saveFilms('init');
    if (importsMissing) await this.saveSourceImports('init');
    await this.saveHealthSnapshot();
    await this.saveLearning('init');
    await this.loadReports();
    await this.loadTeam();
    await this.loadPlays();
    await this.loadDevices();
    await this.loadAccessLinks();
    await this.loadUsers();
    return this;
  }

  async loadChannels() {
    const { data, missing, corrupt } = await this.readJson(this.file('channels'), null);
    if (!corrupt && data && Array.isArray(data.channels)) {
      this.channels = data.channels;
      this.loadedAt = data.updatedAt || this.loadedAt;
      return;
    }
    if (corrupt) {
      const quarantine = path.join(this.dataDir, `channels.corrupt-${stamp()}.json`);
      try { await fsp.rename(this.file('channels'), quarantine); } catch { /* déjà déplacé */ }
      this.error = 'channels-corrupt';
      this.notices.push('Le catalogue était illisible : il a été mis de côté.');
      const restored = await this.restoreLatestBackup({ silent: true });
      if (restored) {
        this.notices.push(`Catalogue restauré depuis la sauvegarde du ${restored.date}.`);
        return;
      }
      this.channels = [];
      return;
    }
    this.channels = [];
    if (missing) this.loadedAt = null;
  }

  async seedVodKind(kind) {
    const seedDir = await this.resolveSeedDir();
    let items = [];
    const matching = this.sources
      .filter((src) => src.contenu === kind && src.actif !== false && src.seedFile && src.licence)
      .sort((a, b) => b.priorite - a.priorite);
    for (const src of matching) {
      try {
        const raw = JSON.parse(await fsp.readFile(path.join(seedDir, src.seedFile), 'utf8'));
        const merged = mergeVodBatch({ kind, existingItems: items, rawEntries: raw, source: src });
        items = merged.nextItems;
      } catch { /* semence facultative absente */ }
    }
    return items;
  }

  async loadAnime() {
    const { data, missing, corrupt } = await this.readJson(this.file('anime'), null);
    if (!corrupt && data && Array.isArray(data.anime)) {
      this.anime = data.anime.map((item, idx) => normalizeAnime(item, idx));
      return false;
    }
    if (corrupt) {
      const quarantine = path.join(this.dataDir, `anime.corrupt-${stamp()}.json`);
      try { await fsp.rename(this.file('anime'), quarantine); } catch { /* déjà déplacé */ }
      this.notices.push('Le fichier anime.json était illisible : il a été mis de côté.');
    }
    this.anime = await this.seedVodKind('anime');
    return missing || corrupt;
  }

  async loadFilms() {
    const { data, missing, corrupt } = await this.readJson(this.file('films'), null);
    if (!corrupt && data && Array.isArray(data.films)) {
      this.films = data.films.map((item, idx) => normalizeFilm(item, idx));
      return false;
    }
    if (corrupt) {
      const quarantine = path.join(this.dataDir, `films.corrupt-${stamp()}.json`);
      try { await fsp.rename(this.file('films'), quarantine); } catch { /* déjà déplacé */ }
      this.notices.push('Le fichier films.json était illisible : il a été mis de côté.');
    }
    this.films = await this.seedVodKind('film');
    return missing || corrupt;
  }

  async loadSettings() {
    const { data, corrupt } = await this.readJson(this.file('settings'), null);
    if (!corrupt && data && typeof data === 'object') {
      this.settings = normalizeSettings(data.settings || data);
      if (data.security && typeof data.security === 'object') this.security = { ...this.security, ...data.security };
      return;
    }
    this.settings = { ...DEFAULTS };
  }

  async loadSources() {
    const { data, corrupt } = await this.readJson(this.file('sources'), null);
    if (!corrupt && data && Array.isArray(data.sources)) {
      this.sources = normalizeSourcesList(data.sources);
      return;
    }
    this.sources = DEFAULT_SOURCES.map((src, idx) => normalizeSource(src, idx));
  }

  async loadSourceImports() {
    const { data, missing } = await this.readJson(this.file('sourceImports'), null);
    this.sourceImports = Array.isArray(data?.imports) ? data.imports.slice(0, 120) : [];
    return missing;
  }

  async saveSourceImports(reason = 'source-imports') {
    return this.enqueue(async () => {
      this.sourceImports = this.sourceImports.slice(0, 120);
      await this.atomicWriteJson(this.file('sourceImports'), {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        imports: this.sourceImports,
      });
    });
  }

  async loadLearning() {
    const { data, corrupt } = await this.readJson(this.file('learning'), null);
    if (!corrupt && data && typeof data === 'object') {
      this.learning = {
        rules: data.rules && typeof data.rules === 'object' ? data.rules : {},
        learned: data.learned && typeof data.learned === 'object' ? data.learned : {},
        learnedStats: data.learnedStats && typeof data.learnedStats === 'object' ? data.learnedStats : null,
        corrections: Array.isArray(data.corrections) ? data.corrections.slice(-500) : [],
        updatedAt: data.updatedAt || null,
      };
    }
  }

  async loadReports() {
    const { data, corrupt } = await this.readJson(this.file('reports'), null);
    if (corrupt || !data || typeof data !== 'object') return;
    this.reports = {
      counters: data.counters && typeof data.counters === 'object' ? data.counters : {},
      reports: Array.isArray(data.reports) ? data.reports.slice(-400) : [],
      lastRef: Number(data.lastRef) || 0,
      updatedAt: data.updatedAt || null,
    };
  }

  async loadUsers() {
    const { data, corrupt } = await this.readJson(this.file('users'), null);
    if (corrupt) {
      const quarantine = path.join(this.dataDir, `users.corrupt-${stamp()}.json`);
      try { await fsp.rename(this.file('users'), quarantine); } catch { /* déjà déplacé */ }
      this.notices.push('Le fichier des comptes était illisible : il a été mis de côté.');
    }
    this.users = Array.isArray(data?.users) ? data.users : [];
    return this.users;
  }

  async saveUsers(reason = 'users') {
    return this.enqueue(async () => {
      await this.atomicWriteJson(this.file('users'), {
        version: 1,
        updatedAt: new Date().toISOString(),
        reason,
        count: this.users.length,
        users: this.users,
      });
    });
  }

  async loadTeam() {
    const { data } = await this.readJson(this.file('team'), null);
    this.team = Array.isArray(data?.members) ? data.members : [];
    return this.team;
  }

  async saveTeam(reason = 'team') {
    return this.enqueue(async () => {
      await this.atomicWriteJson(this.file('team'), { version: 1, reason, members: this.team });
    });
  }

  async loadPlays() {
    const { data } = await this.readJson(this.file('plays'), null);
    this.plays = data && typeof data === 'object' && data.counts ? data : { totals: {}, hours: {} };
    return this.plays;
  }

  async loadDevices() {
    const { data } = await this.readJson(this.file('devices'), null);
    this.devices = Array.isArray(data?.devices) ? data.devices : [];
    return this.devices;
  }

  async loadAccessLinks() {
    const { data } = await this.readJson(this.file('accessLinks'), null);
    this.accessLinks = Array.isArray(data?.links) ? data.links : [];
    return this.accessLinks;
  }

  async saveAccessLinks(reason = 'access-links') {
    return this.enqueue(async () => {
      await this.atomicWriteJson(this.file('accessLinks'), { version: 1, reason, links: this.accessLinks });
    });
  }

  async saveDevices(reason = 'devices') {
    return this.enqueue(async () => {
      await this.atomicWriteJson(this.file('devices'), { version: 1, reason, devices: this.devices });
    });
  }

  async savePlays(reason = 'plays') {
    return this.enqueue(async () => {
      await this.atomicWriteJson(this.file('plays'), { version: 1, reason, ...this.plays });
    });
  }

  async saveReports(reason = 'reports') {
    return this.enqueue(async () => {
      const updatedAt = new Date().toISOString();
      this.reports.updatedAt = updatedAt;
      await this.atomicWriteJson(this.file('reports'), {
        version: DATA_VERSION,
        updatedAt,
        reason,
        counters: this.reports.counters,
        reports: this.reports.reports.slice(-400),
        lastRef: this.reports.lastRef,
      });
    });
  }

  async loadHealthSnapshot() {
    const { data, corrupt } = await this.readJson(this.file('health'), null);
    if (corrupt || !data || typeof data !== 'object') return;
    const probe = data.probe && typeof data.probe === 'object' ? data.probe : {};
    this.probe = {
      cursor: Math.max(0, Number(probe.cursor) || 0),
      runs: Math.max(0, Number(probe.runs) || 0),
      tested: Math.max(0, Number(probe.tested) || 0),
      lastAt: typeof probe.lastAt === 'string' ? probe.lastAt : null,
    };
    const entries = data.entries && typeof data.entries === 'object' ? data.entries : {};
    const byId = new Map(Object.entries(entries));
    for (const channel of this.channels) {
      const stored = byId.get(channel.id);
      if (stored && (!channel.health || channel.health.status === 'unknown')) {
        channel.health = { ...channel.health, ...stored };
      }
    }
    this.healthUpdatedAt = data.updatedAt || null;
  }

  /* --------------------------------------------------------------- écriture */

  async atomicWrite(file, content) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const handle = await fsp.open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fsp.rename(tmp, file);
    } catch (error) {
      await fsp.unlink(tmp).catch(() => {});
      throw error;
    }
    try {
      const dir = await fsp.open(path.dirname(file), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } catch { /* certains systèmes de fichiers refusent fsync sur dossier */ }
  }

  async atomicWriteJson(file, value) {
    await this.atomicWrite(file, `${JSON.stringify(value)}\n`);
  }

  enqueue(task) {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async saveChannels(reason = 'update') {
    return this.enqueue(async () => {
      const payload = {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        count: this.channels.length,
        channels: this.channels,
      };
      await this.atomicWriteJson(this.file('channels'), payload);
      this.loadedAt = payload.updatedAt;
      return payload;
    });
  }

  async saveAnime(reason = 'update') {
    return this.enqueue(async () => {
      this.anime = this.anime.map((item, idx) => normalizeAnime(item, idx));
      const payload = {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        count: this.anime.length,
        anime: this.anime,
      };
      await this.atomicWriteJson(this.file('anime'), payload);
      return payload;
    });
  }

  async saveFilms(reason = 'update') {
    return this.enqueue(async () => {
      this.films = this.films.map((item, idx) => normalizeFilm(item, idx));
      const payload = {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        count: this.films.length,
        films: this.films,
      };
      await this.atomicWriteJson(this.file('films'), payload);
      return payload;
    });
  }

  async saveSettings(next, reason = 'settings') {
    return this.enqueue(async () => {
      this.settings = normalizeSettings(next);
      const payload = {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        settings: this.settings,
        security: this.security,
      };
      await this.atomicWriteJson(this.file('settings'), payload);
      return payload;
    });
  }

  async saveSecurity(reason = 'security') {
    return this.saveSettings(this.settings, reason);
  }

  async saveSources(reason = 'sources') {
    return this.enqueue(async () => {
      this.sources = this.sources.map((src, idx) => normalizeSource(src, idx));
      await this.atomicWriteJson(this.file('sources'), {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        reason,
        sources: this.sources,
      });
    });
  }

  async saveLearning(reason = 'learning') {
    return this.enqueue(async () => {
      this.learning.updatedAt = new Date().toISOString();
      await this.atomicWriteJson(this.file('learning'), {
        version: DATA_VERSION,
        updatedAt: this.learning.updatedAt,
        reason,
        rules: this.learning.rules,
        learned: this.learning.learned,
        learnedStats: this.learning.learnedStats,
        corrections: this.learning.corrections,
      });
    });
  }

  async saveHealthSnapshot() {
    return this.enqueue(async () => {
      const entries = {};
      for (const channel of this.channels) {
        if (channel.health && channel.health.status !== 'unknown') entries[channel.id] = channel.health;
      }
      await this.atomicWriteJson(this.file('health'), {
        version: DATA_VERSION,
        updatedAt: new Date().toISOString(),
        counts: this.healthCounts(),
        entries,
        probe: this.probe,
      });
      this.healthUpdatedAt = new Date().toISOString();
    });
  }

  healthCounts() {
    const counts = { up: 0, flaky: 0, down: 0, unknown: 0 };
    for (const channel of this.channels) {
      const status = channel.health?.status || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }

  /* --------------------------------------------------------------- audit */

  async audit(action, meta = {}) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      action,
      actor: meta.actor || 'admin',
      ip: meta.ip || '',
      requestId: meta.requestId || '',
      channelIds: Array.isArray(meta.channelIds) ? meta.channelIds.slice(0, 200) : undefined,
      count: meta.count,
      result: meta.result || 'ok',
      detail: meta.detail === undefined ? undefined : maskSecrets(String(meta.detail)).slice(0, 500),
    });
    this.auditQueue = this.auditQueue.then(async () => {
      await fsp.appendFile(this.file('audit'), `${line}\n`, { mode: 0o600 }).catch((error) => {
        this.logger.error?.(`audit: ${error.message}`);
      });
    });
    return this.auditQueue;
  }

  async readAudit(lines = 50) {
    try {
      const raw = await fsp.readFile(this.file('audit'), 'utf8');
      const all = raw.trim().split('\n').filter(Boolean);
      return all.slice(-lines).map((line) => {
        try { return JSON.parse(line); } catch { return { at: null, action: 'illisible', raw: maskSecrets(line).slice(0, 200) }; }
      }).reverse();
    } catch {
      return [];
    }
  }

  async logEvent(level, event, detail = {}) {
    const file = path.join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...detail });
    await fsp.appendFile(file, `${line}\n`).catch(() => {});
  }

  /* --------------------------------------------------------------- sauvegardes */

  async backup(reason = 'manual') {
    const now = new Date();
    const weekly = reason === 'auto' && now.getUTCDay() === 0;
    const name = `catalogue-${stamp(now)}${weekly ? '-hebdo' : ''}.json`;
    const payload = {
      version: DATA_VERSION,
      createdAt: now.toISOString(),
      reason,
      count: this.channels.length,
      channels: this.channels,
      anime: this.anime,
      films: this.films,
      sources: this.sources,
      settings: this.settings,
    };
    const content = `${JSON.stringify(payload)}\n`;
    const file = path.join(this.backupDir, name);
    await this.atomicWrite(file, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    await this.atomicWrite(`${file}.sha256`, `${sha256}  ${name}\n`);
    await this.rotateBackups();
    await this.audit('backup.create', { count: this.channels.length, detail: name });
    return { file: name, date: now.toISOString().slice(0, 10), size: Buffer.byteLength(content), sha256, weekly };
  }

  async listBackups() {
    let names = [];
    try { names = await fsp.readdir(this.backupDir); } catch { return []; }
    const files = names.filter((name) => name.endsWith('.json')).sort().reverse();
    const out = [];
    for (const name of files.slice(0, 80)) {
      const full = path.join(this.backupDir, name);
      try {
        const stat = await fsp.stat(full);
        let sha256 = '';
        try { sha256 = (await fsp.readFile(`${full}.sha256`, 'utf8')).split(/\s+/)[0]; } catch { /* empreinte absente */ }
        out.push({
          file: name,
          createdAt: stat.mtime.toISOString(),
          date: stat.mtime.toISOString().slice(0, 10),
          size: stat.size,
          sha256,
          weekly: name.includes('-hebdo'),
        });
      } catch { /* fichier disparu */ }
    }
    return out;
  }

  async rotateBackups() {
    const backups = await this.listBackups();
    const keep = new Set(backups.slice(0, 7).map((backup) => backup.file));
    for (const backup of backups.filter((item) => item.weekly).slice(0, 4)) keep.add(backup.file);
    const weeks = new Set();
    for (const backup of backups) {
      const week = isoWeek(new Date(backup.createdAt));
      if (weeks.has(week) || weeks.size >= 4) continue;
      weeks.add(week);
      keep.add(backup.file);
    }
    for (const backup of backups) {
      if (keep.has(backup.file)) continue;
      await fsp.unlink(path.join(this.backupDir, backup.file)).catch(() => {});
      await fsp.unlink(path.join(this.backupDir, `${backup.file}.sha256`)).catch(() => {});
    }
  }

  async verifyBackup(name) {
    if (!/^catalogue-[0-9]{8}-[0-9]{6}(?:-hebdo)?\.json$/.test(name)) return { ok: false, reason: 'nom' };
    const full = path.join(this.backupDir, name);
    let content;
    try { content = await fsp.readFile(full, 'utf8'); } catch { return { ok: false, reason: 'absent' }; }
    let expected = '';
    try { expected = (await fsp.readFile(`${full}.sha256`, 'utf8')).split(/\s+/)[0]; } catch { /* pas d'empreinte */ }
    if (expected) {
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== expected) return { ok: false, reason: 'empreinte' };
    }
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.channels)) return { ok: false, reason: 'format' };
      return { ok: true, data: parsed };
    } catch {
      return { ok: false, reason: 'json' };
    }
  }

  async restoreLatestBackup({ silent = false } = {}) {
    const backups = await this.listBackups();
    for (const backup of backups) {
      const verified = await this.verifyBackup(backup.file);
      if (verified.ok) {
        this.channels = verified.data.channels;
        if (Array.isArray(verified.data.anime)) this.anime = verified.data.anime.map((it, i) => normalizeAnime(it, i));
        if (Array.isArray(verified.data.films)) this.films = verified.data.films.map((it, i) => normalizeFilm(it, i));
        if (!silent) {
          await this.saveChannels('restore-latest');
          await this.saveAnime('restore-latest');
          await this.saveFilms('restore-latest');
        }
        return { date: backup.date, file: backup.file };
      }
    }
    return null;
  }

  async restore(name) {
    const verified = await this.verifyBackup(name);
    if (!verified.ok) {
      const reasons = { nom: 'nom de fichier refusé', absent: 'fichier introuvable', empreinte: 'empreinte SHA-256 différente', format: 'format inattendu', json: 'fichier illisible' };
      const error = new Error(reasons[verified.reason] || 'sauvegarde invalide');
      error.code = 'ERR-16';
      throw error;
    }
    await this.backup('avant-restauration');
    this.channels = verified.data.channels;
    if (Array.isArray(verified.data.anime)) this.anime = verified.data.anime.map((it, i) => normalizeAnime(it, i));
    if (Array.isArray(verified.data.films)) this.films = verified.data.films.map((it, i) => normalizeFilm(it, i));
    if (Array.isArray(verified.data.sources)) this.sources = normalizeSourcesList(verified.data.sources);
    if (verified.data.settings) this.settings = normalizeSettings(verified.data.settings);
    await this.saveChannels('restore');
    await this.saveAnime('restore');
    await this.saveFilms('restore');
    await this.saveSources('restore');
    if (verified.data.settings) await this.saveSettings(this.settings, 'restore');
    await this.audit('backup.restore', { count: this.channels.length, detail: name });
    return { count: this.channels.length, file: name };
  }

  /* --------------------------------------------------------------- divers */

  async storageStats() {
    const sizes = {};
    for (const filename of Object.values(FILES)) {
      try { sizes[filename] = (await fsp.stat(path.join(this.dataDir, filename))).size; } catch { sizes[filename] = 0; }
    }
    let backupBytes = 0;
    try {
      const names = await fsp.readdir(this.backupDir);
      for (const name of names) {
        try { backupBytes += (await fsp.stat(path.join(this.backupDir, name))).size; } catch { /* ignoré */ }
      }
    } catch { /* dossier absent */ }
    sizes.backups = backupBytes;
    sizes['font-404'] = 0;
    return sizes;
  }

  async flush() {
    await this.writeQueue.catch(() => {});
    await this.auditQueue.catch(() => {});
  }
}
