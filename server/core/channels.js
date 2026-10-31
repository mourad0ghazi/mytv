// server/core/channels.js — contrat de la chaîne (§4.2), projections publiques et assertions A1–A10.
// Une chaîne est un objet figé de 41 champs ; aucune vue n'en invente un champ.

import { createHash } from 'node:crypto';
import { CATEGORY_IDS, CATEGORIES, LIMITS } from './constants.js';
import { AppError } from './errors.js';
import { hueFromId, truncate } from './text.js';

export const CHANNEL_FIELDS = [
  'id', 'number', 'name', 'rawName', 'url', 'urlNormalized', 'logo', 'group', 'groupKind',
  'tvgId', 'tvgName', 'category', 'categoryLabel', 'categorySource', 'confidence', 'reasons',
  'quality', 'language', 'country', 'tags', 'hue', 'visible', 'blocked', 'blockedReason',
  'health', 'variants', 'sourceId', 'licenseNote', 'manualOverride', 'featured', 'notes',
  'createdAt', 'updatedAt', 'lastSeenInSourceAt', 'epgId', 'position',
];

export const HEALTH_STATUSES = ['up', 'flaky', 'down', 'unknown'];
export const BLOCK_REASONS = [
  'mixed-content', 'ua-required', 'geo', 'dead', 'manual',
  'adult', 'license', 'duplicate', 'empty-url',
];

export const BLOCK_LABELS = {
  'mixed-content': 'Flux HTTP bloqué par le navigateur en HTTPS',
  'ua-required': 'Le flux exige un identifiant technique',
  geo: 'Diffusion réservée à un autre pays',
  dead: 'Flux déclaré indisponible',
  manual: 'Masquée par une décision du propriétaire',
  adult: 'Catégorie adulte masquée par défaut',
  license: 'Justification des droits absente',
  duplicate: 'Doublon écarté',
  'empty-url': 'Adresse de flux absente',
};

export function channelId(urlNormalized) {
  return createHash('sha1').update(urlNormalized).digest('hex').slice(0, 12);
}

export function defaultHealth() {
  return { status: 'unknown', checkedAt: null, latencyMs: null, cors: null, httpStatus: null, consecutiveFailures: 0, reason: '' };
}

export function categoryLabel(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId)?.label || 'Autre';
}

/** Construit une chaîne complète à partir d'une entrée normalisée du parseur + du classement. */
export function buildChannel({
  entry, number, category, classification, sourceId, licenseNote, siteProtocol = 'https:',
  now = new Date().toISOString(), position = 0,
}) {
  const id = channelId(entry.urlNormalized);
  const channel = {
    id,
    number,
    name: entry.name,
    rawName: entry.rawName,
    url: entry.url,
    urlNormalized: entry.urlNormalized,
    logo: entry.logo,
    group: entry.group,
    groupKind: entry.groupKind,
    tvgId: entry.tvgId,
    tvgName: entry.tvgName,
    category: category.id,
    categoryLabel: category.label,
    categorySource: classification.source,
    confidence: classification.confidence,
    reasons: classification.reasons,
    quality: entry.quality,
    language: entry.language,
    country: entry.country,
    tags: entry.tags,
    hue: hueFromId(id),
    visible: true,
    blocked: false,
    blockedReason: '',
    health: defaultHealth(),
    variants: [],
    sourceId,
    licenseNote: licenseNote || 'libre accès public',
    manualOverride: false,
    featured: false,
    notes: '',
    createdAt: now,
    updatedAt: now,
    lastSeenInSourceAt: now,
    epgId: entry.tvgId || `streamtv.${id}`,
    position,
  };
  applyBlocking(channel, siteProtocol);
  return channel;
}

/** F-15 : la décision de blocage est calculée, jamais saisie librement. */
export function applyBlocking(channel, siteProtocol = 'https:') {
  let reason = '';
  if (!channel.url) reason = 'empty-url';
  else if (channel.blocked && channel.blockedReason === 'manual') reason = 'manual';
  else if (siteProtocol === 'https:' && /^http:/i.test(channel.url)) reason = 'mixed-content';
  else if ((channel.tags || []).includes('ua-required')) reason = 'ua-required';
  else if (channel.category === 'adulte' && !channel.visible) reason = 'adult';

  const manualBlocked = channel.blocked && channel.blockedReason === 'manual';
  channel.blocked = Boolean(reason && reason !== 'adult') || manualBlocked;
  channel.blockedReason = reason === 'adult' ? 'adult' : (reason || (manualBlocked ? 'manual' : ''));
  return channel;
}

/** Visibilité publique : décision du propriétaire + règles adulte (§4.3 A4/A8). */
export function isPublic(channel, settings) {
  if (!channel || channel.visible === false) return false;
  if (channel.category === 'adulte' && !settings.showAdult && settings.autoHideAdult) return false;
  return true;
}

export function isPlayable(channel, settings, siteProtocol = 'https:') {
  if (!isPublic(channel, settings)) return false;
  if (!channel.url) return false;
  if (channel.blocked) return false;
  if (siteProtocol === 'https:' && /^http:/i.test(channel.url)) return false;
  return true;
}

/* --------------------------------------------------------------- projections */

export function projectCard(channel) {
  return {
    id: channel.id,
    number: channel.number,
    name: channel.name,
    logo: channel.logo,
    group: channel.group,
    category: channel.category,
    categoryLabel: channel.categoryLabel,
    quality: channel.quality,
    country: channel.country,
    language: channel.language,
    hue: channel.hue,
    health: channel.health?.status || 'unknown',
    // La date de mesure et sa cause : le visiteur sait ce qui a été mesuré, et quand.
    healthCheckedAt: channel.health?.checkedAt || '',
    healthReason: channel.health?.reason || '',
    // Restriction de zone déclarée par le diffuseur lui-même : dite sur la carte, pas après coup.
    geoRestricted: (channel.tags || []).includes('geo'),
    blocked: Boolean(channel.blocked),
    blockedReason: channel.blockedReason || '',
    featured: Boolean(channel.featured),
    tags: channel.tags.slice(0, 6),
  };
}

export function projectDetail(channel, settings, siteProtocol = 'https:') {
  return {
    ...projectCard(channel),
    rawName: channel.rawName,
    url: channel.url,
    urlNormalized: channel.urlNormalized,
    groupKind: channel.groupKind,
    tvgId: channel.tvgId,
    tvgName: channel.tvgName,
    categorySource: channel.categorySource,
    confidence: channel.confidence,
    reasons: channel.reasons,
    tags: channel.tags,
    visible: channel.visible,
    healthDetail: {
      status: channel.health.status,
      checkedAt: channel.health.checkedAt,
      latencyMs: channel.health.latencyMs,
      cors: channel.health.cors,
      httpStatus: channel.health.httpStatus,
      consecutiveFailures: channel.health.consecutiveFailures,
      reason: channel.health.reason || '',
      // Lisible dans un navigateur : réponse correcte et en-tête CORS accepté.
      browserPlayable: (channel.health.status === 'up' || channel.health.status === 'flaky')
        && channel.health.cors !== false,
    },
    variants: channel.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      quality: variant.quality,
      url: variant.url,
      health: variant.health?.status || 'unknown',
    })),
    licenseNote: channel.licenseNote,
    sourceId: channel.sourceId,
    // Le diffuseur a déclaré lui-même une restriction de zone dans la liste d'origine :
    // le visiteur doit le savoir avant de cliquer, pas après un écran d'erreur.
    geoRestricted: (channel.tags || []).includes('geo'),
    epgId: channel.epgId,
    position: channel.position,
    lastSeenInSourceAt: channel.lastSeenInSourceAt,
    notes: channel.notes,
    manualOverride: Boolean(channel.manualOverride),
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    playable: isPlayable(channel, settings, siteProtocol),
  };
}

/* --------------------------------------------------------------- assertions */

/**
 * A1–A10 du §4.3. Retourne la liste des corrections appliquées (chaîne mutée sur place).
 * Une chaîne qui échoue à A1, A3, A7 ou A8 est écartée : le retour vaut alors null.
 */
export function sanitizeChannel(channel, { index = 0, siteProtocol = 'https:' } = {}) {
  const fixes = [];
  if (!channel || typeof channel !== 'object') return { channel: null, fixes: ['A1'] };
  for (const field of ['id', 'url', 'name', 'category', 'urlNormalized']) {
    if (channel[field] === undefined || channel[field] === null || channel[field] === '') {
      return { channel: null, fixes: ['A1'] };
    }
  }
  if (!/^[a-f0-9]{12}$/.test(channel.id)) return { channel: null, fixes: ['A1'] };
  if (channel.id !== channelId(channel.urlNormalized)) {
    // A3 : l'identifiant reste l'empreinte de l'URL normalisée.
    channel.id = channelId(channel.urlNormalized);
    fixes.push('A3');
  }
  if (!Number.isInteger(channel.number) || channel.number < 1) {
    channel.number = index + 1;
    fixes.push('A2');
  }
  if (!CATEGORY_IDS.includes(channel.category)) {
    channel.category = 'autre';
    channel.categoryLabel = categoryLabel('autre');
    channel.categorySource = 'fallback';
    channel.confidence = 0.3;
    channel.reasons = ['catégorie inconnue remplacée par « Autre »'];
    fixes.push('A4');
  }
  channel.categoryLabel = categoryLabel(channel.category);
  if (!Number.isFinite(channel.confidence) || channel.confidence < 0 || channel.confidence > 1) {
    channel.confidence = 0.5;
    fixes.push('A5');
  }
  channel.confidence = Math.round(channel.confidence * 100) / 100;
  if (!Array.isArray(channel.reasons) || !channel.reasons.length) {
    channel.reasons = [`classement par défaut (${channel.categorySource || 'fallback'})`];
    fixes.push('A6');
  }
  if (!Array.isArray(channel.tags)) {
    channel.tags = [];
    fixes.push('A7');
  } else {
    channel.tags = [...new Set(channel.tags.map((tag) => truncate(String(tag).trim(), 24)).filter(Boolean))].slice(0, 12);
  }
  if (!channel.health || typeof channel.health !== 'object') {
    channel.health = defaultHealth();
    fixes.push('A8');
  }
  if (!HEALTH_STATUSES.includes(channel.health.status)) {
    channel.health.status = 'unknown';
    fixes.push('A9');
  }
  if (channel.health.status === 'down' && (channel.health.consecutiveFailures || 0) < LIMITS.downAfterFailures) {
    channel.health.status = 'flaky';
    fixes.push('A9');
  }
  applyBlocking(channel, siteProtocol);
  return { channel, fixes };
}

/** A10 : garde-fou contre l'effacement massif du catalogue. */
export function assertMassWrite(beforeCount, afterCount, { operation = 'cette opération' } = {}) {
  if (beforeCount > 20 && afterCount < beforeCount * 0.5) {
    throw new AppError('ERR-16', {
      params: { raison: `${operation} supprimerait plus de la moitié du catalogue (${beforeCount} → ${afterCount})` },
    });
  }
}

/** Renumérote de 1 à N en conservant l'ordre courant. */
export function renumber(channels) {
  channels.forEach((channel, index) => { channel.number = index + 1; });
  return channels;
}

export function isValidCategory(value) {
  return CATEGORY_IDS.includes(value);
}

export function channelNotFound() {
  return new AppError('ERR-10');
}
