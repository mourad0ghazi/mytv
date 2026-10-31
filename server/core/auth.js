// server/core/auth.js — scrypt N=16384 r=8 p=1, jeton Bearer 48 hex, TTL glissant 12 h, verrouillage 429.
// Un mot de passe n'est jamais stocké : seul le sel et l'empreinte scrypt le sont.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { LIMITS } from './constants.js';
import { AppError } from './errors.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COMMON_PASSWORDS = new Set([
  'admin', 'password', 'motdepasse', '123456', 'azerty', 'qwerty', 'streamtv', 'admin123',
  'password123', '000000', '111111', 'soleil', 'bonjour', 'letmein', 'welcome',
  'motdepasse123', 'streamtv123', 'administrateur', 'azerty123', 'iloveyou', 'monkey',
  'dragon', 'football', 'baseball', 'superman', 'trustno1', 'soleil123',
]);

/**
 * Liste noire élargie : un mot courant suivi de quelques chiffres reste un mot courant.
 * « password1234 » est refusé ; « motdepassesolide123 » reste accepté.
 */
export function looksLikeCommonPassword(normalized) {
  if (COMMON_PASSWORDS.has(normalized)) return true;
  for (const entry of COMMON_PASSWORDS) {
    if (entry.length < 5) continue;
    if (normalized.startsWith(entry) && /^\d{0,6}$/.test(normalized.slice(entry.length))) return true;
  }
  return false;
}

export function defaultSecurity() {
  return { passwordHash: '', salt: '', iterations: 16384, defaultPassword: true, updatedAt: null };
}

export async function hashPassword(password, { salt = '', iterations = 16384 } = {}) {
  const saltHex = salt || randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), Buffer.from(saltHex, 'hex'), KEY_LENGTH, { ...SCRYPT_OPTIONS, N: iterations });
  return { passwordHash: derived.toString('hex'), salt: saltHex, iterations };
}

export async function verifyPassword(password, security) {
  if (!security?.passwordHash || !security?.salt) return false;
  try {
    const derived = await scrypt(String(password), Buffer.from(security.salt, 'hex'), KEY_LENGTH,
      { ...SCRYPT_OPTIONS, N: security.iterations || 16384 });
    const expected = Buffer.from(security.passwordHash, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function newToken() {
  return randomBytes(24).toString('hex'); // 48 caractères hexadécimaux
}

export class Sessions {
  constructor({ ttlMs = SESSION_TTL_MS, max = LIMITS.sessionsMax, store = null } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.store = store;
    this.map = new Map();
  }

  create({ ip = '', userAgent = '', role = 'proprietaire', memberId = '', memberName = 'Propriétaire' } = {}) {
    const token = newToken();
    const now = Date.now();
    const session = {
      token,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.ttlMs,
      ip,
      userAgent: String(userAgent).slice(0, 120),
      // 3.9.0 : la session porte le rôle, pour que chaque route vérifie la permission réelle.
      role,
      memberId,
      memberName,
    };
    this.map.set(token, session);
    // Limite : les sessions les plus anciennes sont fermées.
    if (this.map.size > this.max) {
      const sorted = [...this.map.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      while (this.map.size > this.max) this.map.delete(sorted.shift().token);
    }
    return session;
  }

  touch(token) {
    if (!token) return null;
    const session = this.map.get(token);
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt <= now) { this.map.delete(token); return null; }
    // TTL glissant : chaque requête authentifiée repousse l'échéance.
    session.lastSeenAt = now;
    session.expiresAt = now + this.ttlMs;
    return session;
  }

  revoke(token) {
    return this.map.delete(token);
  }

  /** Ferme les sessions d'un seul membre : les autres comptes restent connectés. */
  revokeMember(memberId) {
    if (!memberId) return 0;
    let closed = 0;
    for (const [token, session] of this.map) {
      if (session.memberId === memberId) { this.map.delete(token); closed += 1; }
    }
    return closed;
  }

  revokeAll() {
    const count = this.map.size;
    this.map.clear();
    return count;
  }

  count() {
    const now = Date.now();
    let total = 0;
    for (const session of this.map.values()) if (session.expiresAt > now) total += 1;
    return total;
  }

  list() {
    const now = Date.now();
    return [...this.map.values()]
      .filter((session) => session.expiresAt > now)
      .map((session) => ({
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        ip: session.ip,
        userAgent: session.userAgent,
        role: session.role || 'proprietaire',
        memberName: session.memberName || 'Propriétaire',
        current: false,
      }));
  }
}

/** Verrouillage progressif des tentatives de connexion, par adresse IP. */
export class LoginGuard {
  constructor({ max = LIMITS.loginFailsMax, windowMs = LIMITS.loginWindowMs } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  check(ip) {
    const entry = this.entries.get(ip);
    if (!entry) return { allowed: true, remaining: this.max };
    const now = Date.now();
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    if (now - entry.firstAt > this.windowMs) {
      this.entries.delete(ip);
      return { allowed: true, remaining: this.max };
    }
    return { allowed: true, remaining: Math.max(0, this.max - entry.count) };
  }

  fail(ip) {
    const now = Date.now();
    const entry = this.entries.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
    if (now - entry.firstAt > this.windowMs) { entry.count = 0; entry.firstAt = now; }
    entry.count += 1;
    if (entry.count >= this.max) {
      entry.lockedUntil = now + this.windowMs;
      entry.count = 0;
      entry.firstAt = now;
    }
    this.entries.set(ip, entry);
    return entry;
  }

  success(ip) {
    this.entries.delete(ip);
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (entry.lockedUntil < now && now - entry.firstAt > this.windowMs) this.entries.delete(ip);
    }
  }
}

export function assertPasswordPolicy(password, currentPassword = '') {
  const value = String(password ?? '');
  if (!value) throw new AppError('ERR-02', { field: 'next', params: { champ: 'nouveau mot de passe' } });
  if (value.length < 12) throw new AppError('ERR-03', { field: 'next', params: { champ: 'nouveau mot de passe', min: 12, max: 200 } });
  if (value.length > 200) throw new AppError('ERR-03', { field: 'next', params: { champ: 'nouveau mot de passe', min: 12, max: 200 } });
  if (looksLikeCommonPassword(value.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
    throw new AppError('ERR-04', { field: 'next', params: { champ: 'nouveau mot de passe' } });
  }
  if (value === currentPassword) {
    throw new AppError('ERR-04', { field: 'next', params: { champ: 'nouveau mot de passe' } });
  }
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    throw new AppError('ERR-04', { field: 'next', params: { champ: 'nouveau mot de passe' } });
  }
  return value;
}

/** Initialise le secret d'administration au premier démarrage. */
export async function bootstrapPassword(store, env = process.env) {
  if (store.security?.passwordHash) return false;
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (production && !env.ADMIN_PASSWORD) {
    // Refus explicite : jamais de mot de passe de démonstration sur une instance publique.
    throw new AppError('ERR-09', { message: 'ADMIN_PASSWORD est obligatoire en production.' });
  }
  const initial = String(env.ADMIN_PASSWORD || 'admin');
  const hashed = await hashPassword(initial);
  store.security = {
    ...defaultSecurity(),
    ...hashed,
    defaultPassword: initial === 'admin',
    updatedAt: new Date().toISOString(),
  };
  await store.saveSecurity('bootstrap-password');
  return true;
}
