// server/core/users.js · comptes visiteurs (3.19.0).
// Un compte n'existe qu'après confirmation de l'adresse e-mail par un code à six chiffres.
// Aucun mot de passe n'est stocké : seul le sel et l'empreinte scrypt le sont. Les données
// personnelles (favoris, historique, préférences, signalements) sont bornées et relues à chaque
// écriture ; la console n'en voit jamais l'empreinte du mot de passe.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LoginGuard, hashPassword, looksLikeCommonPassword, verifyPassword } from './auth.js';
import { assertEmail, normalizeEmail } from './team.js';
import { AppError, requireField } from './errors.js';

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_MAX_PER_HOUR = 8;
export const MAX_FAVORITES = 200;
export const MAX_HISTORY = 100;
export const MAX_REPORTS = 50;
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const ACCOUNT_STATUS = Object.freeze({
  attente: 'En attente de confirmation',
  actif: 'Actif',
  suspendu: 'Suspendu',
});
const STATUS_IDS = Object.keys(ACCOUNT_STATUS);
const KINDS = new Set(['chaine', 'anime', 'film']);
const SKINS = new Set(['cadre', 'plein', 'minimal']);
const TV_MODES = new Set(['auto', 'on', 'off']);

/** Trois préférences qui changent réellement l'écran : habillage, mode télé, son. */
export const DEFAULT_PREFERENCES = Object.freeze({
  skin: 'cadre',
  tvMode: 'auto',
  sourdine: false,
});

/** Compteur glissant par clé (adresse IP) : toute tentative compte, pas seulement les échecs. */
export class WindowCounter {
  constructor({ max = 5, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  hit(key) {
    const now = this.now();
    const entry = this.entries.get(key) || { count: 0, firstAt: now };
    if (now - entry.firstAt > this.windowMs) {
      entry.count = 0;
      entry.firstAt = now;
    }
    entry.count += 1;
    this.entries.set(key, entry);
    if (entry.count > this.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.firstAt + this.windowMs - now) / 1000)) };
    }
    return { allowed: true, remaining: this.max - entry.count };
  }

  reset(key) { this.entries.delete(key); }
}

function sameHash(left, right) {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function digest(code, salt) {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * Codes à six chiffres en mémoire : un redémarrage les annule, ce qui est voulu.
 * Le code en clair n'existe que dans l'e-mail et dans la requête qui le vérifie.
 */
export class EmailCodes {
  constructor({
    ttlMs = CODE_TTL_MS, resendMs = CODE_RESEND_MS, maxAttempts = CODE_MAX_ATTEMPTS,
    maxPerHour = CODE_MAX_PER_HOUR, now = () => Date.now(),
  } = {}) {
    this.ttlMs = ttlMs;
    this.resendMs = resendMs;
    this.maxAttempts = maxAttempts;
    this.maxPerHour = maxPerHour;
    this.now = now;
    this.map = new Map();
    this.sent = new Map();
  }

  key(purpose, email) { return `${purpose}:${normalizeEmail(email)}`; }

  purge() {
    const now = this.now();
    for (const [key, entry] of this.map) if (entry.expiresAt <= now) this.map.delete(key);
  }

  recent(key) {
    const cutoff = this.now() - 3600_000;
    const list = (this.sent.get(key) || []).filter((at) => at >= cutoff);
    this.sent.set(key, list);
    return list;
  }

  issue({ purpose, email, ip = '' }) {
    const key = this.key(purpose, email);
    this.purge();
    const recent = this.recent(key);
    if (recent.length >= this.maxPerHour) {
      return { ok: false, reason: 'plafond', retryAfter: Math.ceil((recent[0] + 3600_000 - this.now()) / 1000) };
    }
    const previous = this.map.get(key);
    if (previous && this.now() - previous.issuedAt < this.resendMs) {
      return { ok: false, reason: 'trop-tot', retryAfter: Math.ceil((this.resendMs - (this.now() - previous.issuedAt)) / 1000) };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(12).toString('hex');
    const issuedAt = this.now();
    this.map.set(key, { hash: digest(code, salt), salt, attempts: 0, issuedAt, expiresAt: issuedAt + this.ttlMs, ip });
    recent.push(issuedAt);
    this.sent.set(key, recent);
    return { ok: true, code, expiresAt: issuedAt + this.ttlMs, resendAfter: Math.ceil(this.resendMs / 1000) };
  }

  verify({ purpose, email, code }) {
    const key = this.key(purpose, email);
    const entry = this.map.get(key);
    const value = String(code || '').replace(/\s+/g, '');
    if (!entry || entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return { ok: false, reason: 'expire' };
    }
    if (!/^\d{6}$/.test(value)) {
      entry.attempts += 1;
      if (entry.attempts >= this.maxAttempts) this.map.delete(key);
      return { ok: false, reason: 'format', restants: Math.max(0, this.maxAttempts - entry.attempts) };
    }
    if (!sameHash(digest(value, entry.salt), entry.hash)) {
      entry.attempts += 1;
      if (entry.attempts >= this.maxAttempts) this.map.delete(key);
      return { ok: false, reason: 'code', restants: Math.max(0, this.maxAttempts - entry.attempts) };
    }
    this.map.delete(key);
    return { ok: true };
  }
}

/** Refus de mot de passe, toujours avec le champ attendu par le formulaire. */
function assertVisitorPassword(password) {
  const value = String(password ?? '');
  if (!value) throw new AppError('ERR-02', { field: 'password', params: { champ: 'mot de passe' } });
  if (value.length < 12 || value.length > 200) {
    throw new AppError('ERR-03', { field: 'password', params: { champ: 'mot de passe', min: 12, max: 200 } });
  }
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value) || looksLikeCommonPassword(value)) {
    throw new AppError('ERR-04', { field: 'password', params: { champ: 'mot de passe' } });
  }
  return value;
}

function cleanKind(kind) {
  const value = String(kind || '').trim();
  return KINDS.has(value) ? value : '';
}

function cleanLabel(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanIdentifiant(value) {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : '';
}

export function normalizePreferences(input, base = DEFAULT_PREFERENCES) {
  const source = input && typeof input === 'object' ? input : {};
  const out = { ...base };
  if (SKINS.has(source.skin)) out.skin = source.skin;
  if (TV_MODES.has(source.tvMode)) out.tvMode = source.tvMode;
  if (typeof source.sourdine === 'boolean') out.sourdine = source.sourdine;
  return out;
}

function normalizeFavorite(raw) {
  const kind = cleanKind(raw?.kind);
  const id = cleanIdentifiant(raw?.id);
  if (!kind || !id) return null;
  return { kind, id, name: cleanLabel(raw?.name), at: cleanLabel(raw?.at, 40) || new Date().toISOString() };
}

function normalizeHistoryEntry(raw) {
  const favorite = normalizeFavorite(raw);
  if (!favorite) return null;
  const position = Number(raw?.position);
  const duration = Number(raw?.duration);
  return {
    ...favorite,
    position: Number.isFinite(position) && position >= 0 ? Math.round(position) : 0,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
  };
}

function entryKey(item) { return `${item.kind}:${item.id}`; }

function uniqueByKey(list, max) {
  const seen = new Map();
  for (const item of list) {
    const key = entryKey(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].slice(0, max);
}

/** Codes d'erreur opposables : aucune fuite sur l'existence d'un compte. */
function codeRefuse() {
  return new AppError('ERR-04', { field: 'code', message: 'Le code est incorrect ou a expiré. Demandez un nouveau code.' });
}

function rateLimited(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new AppError('ERR-17', { params: { n: minutes }, headers: { 'Retry-After': String(Math.max(1, seconds)) } });
}

export class Users {
  constructor({
    store, now = () => Date.now(), mailReady = () => false, registrationOpen = () => true, deliver = null,
    codes = new EmailCodes({ now }), loginGuard = new LoginGuard({ max: 8, windowMs: 15 * 60_000 }),
    registerCounter = new WindowCounter({ max: 5, windowMs: 15 * 60_000, now }),
    resendCounter = new WindowCounter({ max: 5, windowMs: 15 * 60_000, now }),
  } = {}) {
    this.store = store;
    this.now = now;
    this.mailReady = mailReady;
    this.registrationOpen = registrationOpen;
    this.deliver = deliver;
    this.codes = codes;
    this.loginGuard = loginGuard;
    this.registerCounter = registerCounter;
    this.resendCounter = resendCounter;
    this.dummy = null;
  }

  /* ------------------------------------------------------------- lecture */

  list() { return this.store.users || []; }

  find(email) {
    const address = normalizeEmail(email);
    if (!address) return null;
    return this.list().find((user) => normalizeEmail(user.email) === address) || null;
  }

  byId(id) {
    const value = String(id || '');
    return this.list().find((user) => user.id === value) || null;
  }

  require(id) {
    const user = this.byId(id);
    if (!user) throw new AppError('ERR-11');
    return user;
  }

  countByStatus() {
    const counts = { attente: 0, actif: 0, suspendu: 0 };
    for (const user of this.list()) counts[user.status] = (counts[user.status] || 0) + 1;
    return counts;
  }

  /** Vue publique d'un compte : jamais l'empreinte, jamais le sel. */
  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      statusLabel: ACCOUNT_STATUS[user.status] || 'Inconnu',
      createdAt: user.createdAt,
      verifiedAt: user.verifiedAt || '',
      lastLoginAt: user.lastLoginAt || '',
      preferences: normalizePreferences(user.preferences),
      favoritesCount: (user.favorites || []).length,
      historyCount: (user.history || []).length,
      reportsCount: (user.reports || []).length,
    };
  }

  exportData(user) {
    return {
      compte: this.publicUser(user),
      favoris: (user.favorites || []).map((item) => ({ ...item })),
      historique: (user.history || []).map((item) => ({ ...item })),
      preferences: normalizePreferences(user.preferences),
      signalements: (user.reports || []).map((item) => ({ ...item })),
    };
  }

  /* --------------------------------------------------------- inscription */

  async sendCode({ purpose, email, name, ip = '' }) {
    const issued = this.codes.issue({ purpose, email, ip });
    if (!issued.ok) return issued;
    const intro = purpose === 'reinitialisation'
      ? 'Vous avez demandé à choisir un nouveau mot de passe StreamTV.'
      : name
        ? `Bienvenue ${name}, votre compte StreamTV est presque prêt.`
        : 'Votre compte StreamTV est presque prêt.';
    const text = [
      intro,
      '',
      `Votre code de confirmation : ${issued.code}`,
      `Il expire dans ${Math.round(this.codes.ttlMs / 60_000)} minutes et ne sert qu’une fois.`,
      '',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : aucun compte ne sera activé sans ce code.',
    ].join('\n');
    if (typeof this.deliver !== 'function') throw new AppError('ERR-19', { message: 'Aucun serveur d’envoi n’est configuré.' });
    await this.deliver({
      to: email,
      subject: purpose === 'reinitialisation' ? 'Votre nouveau mot de passe StreamTV' : 'Confirmez votre compte StreamTV',
      text,
    });
    return issued;
  }

  async register({ name, email, password, ip = '' }) {
    if (!this.registrationOpen()) {
      throw new AppError('ERR-09', { message: 'Les inscriptions sont fermées. Réessayez plus tard.' });
    }
    const quota = this.registerCounter.hit(ip);
    if (!quota.allowed) throw rateLimited(quota.retryAfterSeconds);
    if (!this.mailReady()) {
      throw new AppError('ERR-19', {
        message: 'L’inscription par e-mail n’est pas disponible : aucun serveur d’envoi n’est configuré.',
      });
    }
    const label = requireField(name, 'name', 'nom affiché', { min: 2, max: 60 });
    const address = assertEmail(email);
    assertVisitorPassword(password);

    const existing = this.find(address);
    if (existing) {
      if (existing.status === 'attente') {
        const sent = await this.sendCode({ purpose: 'inscription', email: address, name: existing.name, ip });
        return { user: this.publicUser(existing), resent: true, resendAfter: sent.resendAfter || 60 };
      }
      const error = new AppError('ERR-16', { message: 'Un compte utilise déjà cette adresse. Connectez-vous.' });
      error.status = 409;
      throw error;
    }

    const secret = await hashPassword(String(password));
    const user = {
      id: `u-${randomBytes(6).toString('hex')}`,
      name: label,
      email: address,
      status: 'attente',
      passwordHash: secret.passwordHash,
      salt: secret.salt,
      iterations: secret.iterations,
      createdAt: new Date(this.now()).toISOString(),
      verifiedAt: '',
      lastLoginAt: '',
      preferences: { ...DEFAULT_PREFERENCES },
      favorites: [],
      history: [],
      reports: [],
    };
    const sent = await this.sendCode({ purpose: 'inscription', email: address, name: label, ip });
    this.list().push(user);
    await this.save('compte.inscription', { detail: user.id });
    return { user: this.publicUser(user), resent: false, resendAfter: sent.resendAfter };
  }

  async resend({ email, ip = '' }) {
    const quota = this.resendCounter.hit(ip);
    if (!quota.allowed) throw rateLimited(quota.retryAfterSeconds);
    if (!this.mailReady()) {
      throw new AppError('ERR-19', {
        message: 'L’envoi d’e-mail n’est pas disponible : aucun serveur d’envoi n’est configuré.',
      });
    }
    const message = 'Si un compte attend une confirmation, un nouveau code vient d’être envoyé.';
    const user = this.find(email);
    if (!user || user.status !== 'attente') return { message, sent: false };
    const sent = await this.sendCode({ purpose: 'inscription', email: user.email, name: user.name, ip });
    return { message, sent: Boolean(sent.ok), resendAfter: sent.resendAfter || 60 };
  }

  async verify({ email, code }) {
    const user = this.find(email);
    if (!user) throw codeRefuse();
    if (user.status === 'actif') {
      const error = new AppError('ERR-16', { message: 'Ce compte est déjà confirmé. Connectez-vous.' });
      error.status = 409;
      throw error;
    }
    if (user.status === 'suspendu') {
      throw new AppError('ERR-09', { message: 'Ce compte est suspendu. Contactez l’administrateur du site.' });
    }
    const checked = this.codes.verify({ purpose: 'inscription', email: user.email, code });
    if (!checked.ok) throw codeRefuse();
    user.status = 'actif';
    user.verifiedAt = new Date(this.now()).toISOString();
    await this.save('compte.confirmation', { detail: user.id });
    return user;
  }

  /* ------------------------------------------------------------ sessions */

  async login({ email, password, ip = '' }) {
    const guard = this.loginGuard.check(ip);
    if (!guard.allowed) throw rateLimited(guard.retryAfterSeconds);
    const user = this.find(email);
    const security = user
      ? { passwordHash: user.passwordHash, salt: user.salt, iterations: user.iterations }
      : await this.dummySecurity();
    const correct = await verifyPassword(String(password || ''), security);
    if (!user || !correct) {
      this.loginGuard.fail(ip);
      throw new AppError('ERR-08', { message: 'Adresse ou mot de passe incorrect.' });
    }
    if (user.status === 'attente') {
      throw new AppError('ERR-09', { field: 'email', message: 'Confirmez votre adresse e-mail avant de vous connecter.' });
    }
    if (user.status === 'suspendu') {
      throw new AppError('ERR-09', { message: 'Ce compte est suspendu. Contactez l’administrateur du site.' });
    }
    this.loginGuard.success(ip);
    user.lastLoginAt = new Date(this.now()).toISOString();
    await this.save('compte.connexion', { detail: user.id });
    return user;
  }

  /** Empreinte factice : une adresse inconnue coûte le même temps qu'un mot de passe faux. */
  async dummySecurity() {
    if (!this.dummy) this.dummy = await hashPassword(randomBytes(9).toString('hex'));
    return this.dummy;
  }

  async requestReset({ email, ip = '' }) {
    const quota = this.resendCounter.hit(ip);
    if (!quota.allowed) throw rateLimited(quota.retryAfterSeconds);
    if (!this.mailReady()) {
      throw new AppError('ERR-19', {
        message: 'L’envoi d’e-mail n’est pas disponible : aucun serveur d’envoi n’est configuré.',
      });
    }
    const message = 'Si cette adresse a un compte, un code de réinitialisation vient d’être envoyé.';
    const user = this.find(email);
    if (!user || user.status !== 'actif') return { message, sent: false };
    const sent = await this.sendCode({ purpose: 'reinitialisation', email: user.email, name: user.name, ip });
    return { message, sent: Boolean(sent.ok), resendAfter: sent.resendAfter || 60 };
  }

  async reset({ email, code, password, ip = '' }) {
    const quota = this.resendCounter.hit(ip);
    if (!quota.allowed) throw rateLimited(quota.retryAfterSeconds);
    const user = this.find(email);
    if (!user || user.status !== 'actif') throw codeRefuse();
    assertVisitorPassword(password);
    const checked = this.codes.verify({ purpose: 'reinitialisation', email: user.email, code });
    if (!checked.ok) throw codeRefuse();
    const secret = await hashPassword(String(password));
    user.passwordHash = secret.passwordHash;
    user.salt = secret.salt;
    user.iterations = secret.iterations;
    await this.save('compte.mot-de-passe', { detail: user.id });
    return user;
  }

  async changePassword(user, { current, next }) {
    const correct = await verifyPassword(String(current || ''), {
      passwordHash: user.passwordHash, salt: user.salt, iterations: user.iterations,
    });
    if (!correct) throw new AppError('ERR-08', { message: 'Le mot de passe actuel est incorrect.' });
    assertVisitorPassword(next);
    const secret = await hashPassword(String(next));
    user.passwordHash = secret.passwordHash;
    user.salt = secret.salt;
    user.iterations = secret.iterations;
    await this.save('compte.mot-de-passe', { detail: user.id });
    return user;
  }

  async rename(user, name) {
    user.name = requireField(name, 'name', 'nom affiché', { min: 2, max: 60 });
    await this.save('compte.profil', { detail: user.id });
    return user;
  }

  /* -------------------------------------------------------------- données */

  async savePreferences(user, input) {
    user.preferences = normalizePreferences(input, normalizePreferences(user.preferences));
    await this.save('compte.preferences', { detail: user.id });
    return user.preferences;
  }

  async addFavorite(user, payload) {
    const favorite = normalizeFavorite(payload);
    if (!favorite) throw new AppError('ERR-04', { field: 'id', params: { champ: 'contenu' } });
    const list = user.favorites || [];
    if (list.some((item) => entryKey(item) === entryKey(favorite))) return { added: false, favorites: list };
    user.favorites = uniqueByKey([favorite, ...list], MAX_FAVORITES);
    await this.save('compte.donnees', { detail: user.id });
    return { added: true, favorites: user.favorites };
  }

  async removeFavorite(user, payload) {
    const favorite = normalizeFavorite(payload);
    if (!favorite) throw new AppError('ERR-04', { field: 'id', params: { champ: 'contenu' } });
    user.favorites = (user.favorites || []).filter((item) => entryKey(item) !== entryKey(favorite));
    await this.save('compte.donnees', { detail: user.id });
    return { removed: true, favorites: user.favorites };
  }

  async recordHistory(user, payload) {
    const entry = normalizeHistoryEntry({ ...payload, at: new Date(this.now()).toISOString() });
    if (!entry) throw new AppError('ERR-04', { field: 'id', params: { champ: 'contenu' } });
    const rest = (user.history || []).filter((item) => entryKey(item) !== entryKey(entry));
    user.history = [entry, ...rest].slice(0, MAX_HISTORY);
    await this.save('compte.donnees', { detail: user.id });
    return entry;
  }

  async linkReport(user, { ref, contentType = 'chaine', name = '' }) {
    if (!user) return false;
    const value = String(ref || '');
    if (!/^SIG-[A-Z0-9]{4,12}$/.test(value)) return false;
    const list = user.reports || [];
    if (list.some((item) => item.ref === value)) return false;
    user.reports = [{
      ref: value,
      type: cleanLabel(contentType, 20),
      name: cleanLabel(name),
      at: new Date(this.now()).toISOString(),
    }, ...list].slice(0, MAX_REPORTS);
    await this.save('compte.donnees', { detail: user.id });
    return true;
  }

  /** Fusionne un état local (navigateur) avec le compte : union, jamais écrasement silencieux. */
  async merge(user, input) {
    const source = input && typeof input === 'object' ? input : {};
    const favorites = (Array.isArray(source.favoris) ? source.favoris : [])
      .map(normalizeFavorite).filter(Boolean);
    const history = (Array.isArray(source.historique) ? source.historique : [])
      .map(normalizeHistoryEntry).filter(Boolean);
    if (favorites.length) user.favorites = uniqueByKey([...user.favorites || [], ...favorites], MAX_FAVORITES);
    if (history.length) user.history = uniqueByKey([...user.history || [], ...history], MAX_HISTORY);
    if (source.preferences && typeof source.preferences === 'object') {
      user.preferences = normalizePreferences(source.preferences, normalizePreferences(user.preferences));
    }
    await this.save('compte.donnees', { detail: user.id });
    return this.exportData(user);
  }

  /* ------------------------------------------------------------ console */

  listPage({ page = 1, pageSize = 20, q = '', statut = '' } = {}) {
    const needle = normalizeEmail(q);
    const label = String(q || '').trim().toLowerCase();
    const rows = this.list()
      .filter((user) => (statut ? user.status === statut : true))
      .filter((user) => {
        if (!label) return true;
        return normalizeEmail(user.email).includes(needle) || String(user.name).toLowerCase().includes(label);
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const size = Math.min(60, Math.max(5, Number(pageSize) || 20));
    const total = rows.length;
    const start = (Math.max(1, Number(page) || 1) - 1) * size;
    return {
      total,
      page: Math.max(1, Number(page) || 1),
      pageSize: size,
      pages: Math.max(1, Math.ceil(total / size)),
      counts: this.countByStatus(),
      members: rows.slice(start, start + size).map((user) => this.publicUser(user)),
    };
  }

  async setStatus(user, statut, { actor = 'admin' } = {}) {
    if (!STATUS_IDS.includes(statut)) throw new AppError('ERR-04', { field: 'statut', params: { champ: 'statut' } });
    user.status = statut;
    if (statut === 'actif' && !user.verifiedAt) user.verifiedAt = new Date(this.now()).toISOString();
    await this.save('membre.statut', { detail: `${user.id} ${statut}`, actor });
    return user;
  }

  async remove(user, { actor = 'admin' } = {}) {
    this.store.users = this.list().filter((item) => item.id !== user.id);
    await this.save('compte.suppression', { detail: user.id, actor });
    return true;
  }

  async save(action, meta = {}) {
    if (!this.store?.saveUsers) return false;
    await this.store.saveUsers(action);
    if (this.store.audit) await this.store.audit(action, { actor: 'visiteur', ...meta });
    return true;
  }
}

/** Vrai si le mot de passe figure dans la liste noire (réexport tolérant). */
export function commonPassword(password) {
  return looksLikeCommonPassword(password);
}
