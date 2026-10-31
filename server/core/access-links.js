// server/core/access-links.js · liens d'accès nominatifs (3.13.0).
// Un lien porte un jeton aléatoire de 32 octets. Le serveur n'en garde que le condensé :
// le lien en clair n'existe que dans le presse-papiers de celui qui l'a créé. Chaque lien a
// une durée de vie, un nombre d'utilisations et un rôle ; il se révoque à tout moment.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LINK_DEFAULT_MINUTES = 60;
export const LINK_MAX_MINUTES = 60 * 24 * 30;
export const LINK_MAX_USES = 50;
export const LINK_MAX_ACTIVE = 20;
export const TOKEN_LENGTH = 64;

/** Jeton de lien : 32 octets en héxadécimal, jamais devinable. */
export function newLinkToken() {
  return randomBytes(32).toString('hex');
}

export function linkDigest(token) {
  return createHash('sha256').update(`streamtv-lien:${String(token || '')}`).digest('hex');
}

export function isLinkToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function sameDigest(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Étiquette lisible : jamais vide, jamais plus de 40 caractères. */
export function cleanLinkLabel(value, fallback = 'Lien d’accès') {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (text || fallback).slice(0, 40);
}

/** Bornes de durée : une minute au moins, trente jours au plus. */
export function clampMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return LINK_DEFAULT_MINUTES;
  return Math.min(LINK_MAX_MINUTES, Math.max(1, Math.round(number)));
}

/** Vue publique d'un lien : le condensé et le jeton ne sortent jamais. */
export function publicLink(link, now = Date.now()) {
  const expiresAt = new Date(link.expiresAt).getTime();
  const epuise = link.uses >= link.maxUses;
  return {
    id: link.id,
    label: link.label,
    role: link.role,
    roleLabel: link.roleLabel,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    uses: link.uses,
    maxUses: link.maxUses,
    lastUsedAt: link.lastUsedAt || '',
    revokedAt: link.revokedAt || '',
    state: link.revokedAt ? 'revoque' : epuise ? 'epuise' : expiresAt <= now ? 'expire' : 'actif',
  };
}

/** Un lien est utilisable si ni révoqué, ni expiré, ni épuisé. */
export function linkUsable(link, now = Date.now()) {
  if (!link || link.revokedAt) return false;
  if (link.uses >= link.maxUses) return false;
  return new Date(link.expiresAt).getTime() > now;
}
