// server/core/playback.js — ce que la lecture réelle apprend au catalogue (3.22.0).
// Le seul endroit qui voit vraiment un flux, c'est le navigateur du visiteur. Une lecture
// réussie prouve que la chaîne fonctionne ; un échec prouve le contraire. Ces deux faits
// sont enregistrés sans identité : seule une empreinte tronquée sert au plafond anti-abus.

import { createHash } from 'node:crypto';

import { LIMITS } from './constants.js';

export const LECTURE_CAUSES = ['dead', 'geo', 'cors', 'timeout', 'codec'];

// Un 404, un 410 ou un 403 est une réponse du diffuseur : deux signalements suffisent.
// Une panne réseau ou CORS peut venir du poste du visiteur : il en faut trois.
const CAUSES_CERTAINES = new Set(['dead', 'geo']);
export const SEUIL_CERTAIN = 2;
export const SEUIL_AMBIGU = 3;

export const LECTURE_FENETRE_MS = 6 * 3600_000;
export const LECTURE_JOUR_MAX = 20;
export const LECTURE_COMPTEUR_TTL_MS = 14 * 24 * 3600_000;
// Plafond global : même avec des adresses variées, un afflux de signalements ne peut pas
// bloquer le catalogue entier en une heure.
export const LECTURE_BLOCAGES_HEURE_MAX = 30;

export function seuilPour(cause) {
  return CAUSES_CERTAINES.has(cause) ? SEUIL_CERTAIN : SEUIL_AMBIGU;
}

/** Empreinte courte : de quoi compter sans garder une adresse IP en mémoire. */
export function empreinteVisiteur(ip) {
  return createHash('sha256').update(String(ip || 'inconnu')).digest('hex').slice(0, 16);
}

/**
 * Garde-fous en mémoire : un même visiteur ne compte qu'une fois par chaîne et par fenêtre,
 * et n'émet qu'un nombre borné de signalements par jour. Un redémarrage remet les compteurs
 * à zéro : c'est un plafond anti-abus, pas une donnée de catalogue.
 */
export class PlaybackLedger {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.vus = new Map();
    this.jour = new Map();
    this.compteurs = new Map();
    this.blocages = [];
  }

  /** Réserve une place pour ce visiteur. Doublon : refus silencieux. Plafond : ERR-17. */
  admit(ip, channelId) {
    const instant = this.now();
    const digest = empreinteVisiteur(ip);
    const cle = `${digest}|${channelId}`;
    const dernier = this.vus.get(cle) || 0;
    if (instant - dernier < LECTURE_FENETRE_MS) return { ok: false, raison: 'doublon', digest };
    const jour = `${digest}|${new Date(instant).toISOString().slice(0, 10)}`;
    const compte = this.jour.get(jour) || 0;
    if (compte >= LECTURE_JOUR_MAX) return { ok: false, raison: 'plafond', digest };
    this.vus.set(cle, instant);
    this.jour.set(jour, compte + 1);
    if (this.vus.size > 5000) this.elaguer(instant);
    return { ok: true, digest };
  }

  elaguer(instant) {
    for (const [cle, vu] of this.vus) if (instant - vu > LECTURE_FENETRE_MS) this.vus.delete(cle);
    const hier = new Date(instant - 24 * 3600_000).toISOString().slice(0, 10);
    for (const cle of this.jour.keys()) if (cle.split('|')[1] < hier) this.jour.delete(cle);
    for (const [id, entree] of this.compteurs) if (instant - entree.dernier > LECTURE_COMPTEUR_TTL_MS) this.compteurs.delete(id);
  }

  register(channelId, cause) {
    const instant = this.now();
    const entree = this.compteurs.get(channelId) || { causes: {}, debut: instant, dernier: instant };
    entree.causes[cause] = (entree.causes[cause] || 0) + 1;
    entree.dernier = instant;
    this.compteurs.set(channelId, entree);
    const count = entree.causes[cause];
    const threshold = seuilPour(cause);
    return { count, threshold, reached: count >= threshold, causes: { ...entree.causes } };
  }

  /** Autorise un blocage si le plafond horaire n'est pas atteint : borne l'effet d'un bourrage. */
  peutBloquer() {
    const instant = this.now();
    this.blocages = this.blocages.filter((at) => instant - at < 3600_000);
    if (this.blocages.length >= LECTURE_BLOCAGES_HEURE_MAX) return false;
    this.blocages.push(instant);
    return true;
  }

  clear(channelId) {
    this.compteurs.delete(channelId);
    for (const cle of [...this.vus.keys()]) if (cle.endsWith(`|${channelId}`)) this.vus.delete(cle);
  }

  get(channelId) {
    return this.compteurs.get(channelId) || null;
  }
}

/**
 * Applique un verdict d'échec à une chaîne. `consecutiveFailures` est poussé au seuil de
 * blocage : sans cela, la normalisation du catalogue ramènerait `down` à `flaky`.
 */
export function applyPlaybackFailure(channel, { cause, now = new Date() }) {
  const at = now.toISOString();
  channel.health = {
    ...channel.health,
    status: 'down',
    reason: cause,
    checkedAt: at,
    source: 'lecture',
    consecutiveFailures: Math.max(LIMITS.downAfterFailures, channel.health?.consecutiveFailures || 0),
  };
  channel.updatedAt = at;
  return channel.health;
}

/** Une lecture réelle vaut mieux qu'une sonde : le flux a été vu, CORS compris. */
export function applyPlaybackSuccess(channel, { now = new Date() } = {}) {
  const at = now.toISOString();
  channel.health = {
    ...channel.health,
    status: 'up',
    reason: 'ok',
    checkedAt: at,
    source: 'lecture',
    cors: true,
    consecutiveFailures: 0,
  };
  channel.updatedAt = at;
  return channel.health;
}

/** Ce que la console affiche : combien de chaînes n'ont été jugées que par des visiteurs. */
export function lectureStats(channels = []) {
  let down = 0;
  let up = 0;
  for (const channel of channels) {
    if (channel.deleted) continue;
    if (channel.health?.source !== 'lecture') continue;
    if (channel.health.status === 'down') down += 1;
    else if (channel.health.status === 'up') up += 1;
  }
  return { down, up };
}
