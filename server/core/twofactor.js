// server/core/twofactor.js · code à six chiffres envoyé par e-mail (3.12.0).
// Le code vit dix minutes, ne sert qu'une fois, et n'est jamais stocké en clair :
// on garde un condensé salé, comparé en temps constant. Cinq essais par code, puis il meurt.

import { createHash, randomInt, timingSafeEqual, randomBytes } from 'node:crypto';

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_MAX_PER_HOUR = 10;

/** Code à six chiffres, tiré au sort par le générateur cryptographique. */
export function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Condensé salé : le code en clair n'existe que dans l'e-mail et dans la mémoire de la requête. */
export function hashCode(code, salt) {
  return createHash('sha256').update(`${salt}:${String(code)}`).digest('hex');
}

function sameHash(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Adresse masquée pour l'écran : m•••@yahoo.com. Suffisant pour reconnaître sa boîte. */
export function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at < 1) return 'votre boîte';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local.slice(0, 1)}${'•'.repeat(Math.min(4, Math.max(2, local.length - 1)))}@${domain}`;
}

/**
 * Challenges en mémoire : identifiant aléatoire, condensé du code, appareil lié.
 * Rien n'est écrit sur disque : un redémarrage annule les codes en cours, ce qui est voulu.
 */
export class TwoFactor {
  constructor({ ttlMs = CODE_TTL_MS, resendMs = CODE_RESEND_MS, maxAttempts = CODE_MAX_ATTEMPTS, maxPerHour = CODE_MAX_PER_HOUR, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.resendMs = resendMs;
    this.maxAttempts = maxAttempts;
    this.maxPerHour = maxPerHour;
    this.now = now;
    this.map = new Map();
    this.purge();
  }

  purge() {
    const now = this.now();
    for (const [id, challenge] of this.map) {
      if (challenge.expiresAt <= now || challenge.used) this.map.delete(id);
    }
  }

  /** Nombre de codes envoyés depuis une heure pour une adresse IP donnée. */
  countRecent(ip) {
    const limit = this.now() - 3600_000;
    let total = 0;
    for (const challenge of this.map.values()) if (challenge.ip === ip && challenge.createdAt >= limit) total += 1;
    return total;
  }

  /**
   * Ouvre un challenge et rend le code à envoyer. `null` si le plafond horaire est atteint.
   */
  issue({ deviceId = '', role = 'proprietaire', memberId = '', memberName = 'Propriétaire', email = '', ip = '' } = {}) {
    if (this.countRecent(ip) >= this.maxPerHour) return null;
    this.purge();
    const id = randomBytes(18).toString('hex');
    const salt = randomBytes(12).toString('hex');
    const code = newCode();
    const createdAt = this.now();
    this.map.set(id, {
      id,
      salt,
      hash: hashCode(code, salt),
      deviceId: String(deviceId || ''),
      role,
      memberId,
      memberName,
      email,
      ip,
      attempts: 0,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      used: false,
    });
    return { id, code, expiresAt: createdAt + this.ttlMs, resendAfter: Math.ceil(this.resendMs / 1000) };
  }

  /** Remplace le code d'un challenge encore valable, sans changer son identité. */
  reissue(id) {
    const challenge = this.map.get(id);
    if (!challenge) return { ok: false, reason: 'inconnu' };
    const now = this.now();
    if (challenge.used || challenge.expiresAt <= now) return { ok: false, reason: 'expire' };
    if (now - challenge.createdAt < this.resendMs) {
      return { ok: false, reason: 'trop-tot', retryAfter: Math.ceil((this.resendMs - (now - challenge.createdAt)) / 1000) };
    }
    const salt = randomBytes(12).toString('hex');
    const code = newCode();
    challenge.salt = salt;
    challenge.hash = hashCode(code, salt);
    challenge.createdAt = now;
    challenge.expiresAt = now + this.ttlMs;
    challenge.attempts = 0;
    return { ok: true, id, code, expiresAt: challenge.expiresAt, resendAfter: Math.ceil(this.resendMs / 1000) };
  }

  /**
   * Vérifie un code. Le challenge n'est consommé qu'en cas de succès ;
   * un mauvais code compte un essai et le challenge meurt au cinquième.
   */
  verify(id, code, { deviceId = '' } = {}) {
    const challenge = this.map.get(id);
    if (!challenge) return { ok: false, reason: 'inconnu' };
    if (challenge.used) return { ok: false, reason: 'utilise' };
    if (challenge.expiresAt <= this.now()) { this.map.delete(id); return { ok: false, reason: 'expire' }; }
    if (challenge.deviceId && challenge.deviceId !== String(deviceId || '')) {
      return { ok: false, reason: 'appareil' };
    }
    const valeur = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(valeur)) {
      challenge.attempts += 1;
      return { ok: false, reason: 'format', restants: Math.max(0, this.maxAttempts - challenge.attempts) };
    }
    if (!sameHash(hashCode(valeur, challenge.salt), challenge.hash)) {
      challenge.attempts += 1;
      if (challenge.attempts >= this.maxAttempts) this.map.delete(id);
      return { ok: false, reason: 'code', restants: Math.max(0, this.maxAttempts - challenge.attempts) };
    }
    challenge.used = true;
    this.map.delete(id);
    return { ok: true, challenge };
  }
}
