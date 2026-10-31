// server/core/sources.js — catalogue multi-catégories des sources (direct et VOD).
// Règles opposables :
// 1. Aucune source sans licence renseignée ne peut être importée (sécurité juridique).
// 2. À doublon d'identifiant de contenu, la source de priorité la plus haute gagne,
//    et l'arbitrage est systématiquement journalisé.
// 3. Chaque source expose l'état de sa sonde : saine, instable ou hors service.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { LIMITS } from './constants.js';
import { AppError } from './errors.js';

export const SOURCE_TYPES = Object.freeze(['direct', 'vod']);
export const SOURCE_CONTENTS = Object.freeze(['chaine', 'anime', 'film']);
export const PROBE_STATES = Object.freeze(['saine', 'instable', 'hors service']);
export const SOURCE_LANGUAGES = Object.freeze(['VOSTFR', 'VF', 'VO', 'fr', 'en', 'multi']);

const PROBE_HISTORY_MAX = 10;

export const DEFAULT_SOURCES = Object.freeze([
  {
    id: 'iptv-org',
    nom: 'iptv-org (chaînes publiques)',
    type: 'direct',
    contenu: 'chaine',
    url: 'https://iptv-org.github.io/iptv/index.m3u',
    licence: 'CC0 1.0 (base iptv-org)',
    pays: 'INT',
    langue: 'multi',
    actif: true,
    priorite: 80,
    note: 'Répertoire communautaire de flux officiels gratuits diffusés publiquement.',
  },
  {
    id: 'catalogue-propre',
    nom: 'Ajouts manuels de l’opérateur',
    type: 'direct',
    contenu: 'chaine',
    url: '',
    licence: 'Catalogue propre déclaré par l’opérateur',
    pays: 'FR',
    langue: 'fr',
    actif: true,
    priorite: 95,
    note: 'Chaînes saisies directement dans la console par l’équipe.',
  },
  {
    id: 'anime-ouverts-cc',
    nom: 'Studios libres d’animation (Blender Studio & Morevna)',
    type: 'vod',
    contenu: 'anime',
    url: 'https://morevnaproject.org/',
    seedFile: 'anime-cc.json',
    licence: 'Creative Commons Attribution 3.0 / 4.0 (CC BY)',
    pays: 'INT',
    langue: 'VOSTFR',
    actif: true,
    priorite: 90,
    note: 'Séries et courts d’animation publiés sous licence ouverte Creative Commons Attribution.',
  },
  {
    id: 'anime-classiques-dp',
    nom: 'Animation classique du domaine public',
    type: 'vod',
    contenu: 'anime',
    url: 'https://archive.org/details/animationandcartoons',
    seedFile: 'anime-dp.json',
    licence: 'Domaine public',
    pays: 'US',
    langue: 'VO',
    actif: true,
    priorite: 85,
    note: 'Séries d’animation historiques tombées dans le domaine public.',
  },
  {
    id: 'films-ouverts-cc',
    nom: 'Films ouverts Blender Foundation',
    type: 'vod',
    contenu: 'film',
    url: 'https://studio.blender.org/films/',
    seedFile: 'films-cc.json',
    licence: 'Creative Commons Attribution 3.0 / 4.0 (CC BY)',
    pays: 'NL',
    langue: 'VOSTFR',
    actif: true,
    priorite: 90,
    note: 'Films en prise de vues réelles produits et diffusés sous licence CC BY.',
  },
  {
    id: 'cinema-patrimoine-dp',
    nom: 'Cinéma de patrimoine (domaine public)',
    type: 'vod',
    contenu: 'film',
    url: 'https://archive.org/details/feature_films',
    seedFile: 'films-dp.json',
    licence: 'Domaine public',
    pays: 'INT',
    langue: 'VO',
    actif: true,
    priorite: 85,
    note: 'Longs et courts métrages classiques libres de droits.',
  },
]);

function clean(value, maxLength = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

export function slugifySourceId(value) {
  const base = clean(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'source').slice(0, 48);
}

/** Calcule l'état lisible d'une sonde : saine, instable ou hors service. */
export function computeProbeState({ joignable, tempsReponseMs = null, tauxEchec = 0, essais = 0 } = {}) {
  if (!essais) return 'inconnue';
  const rate = Number.isFinite(tauxEchec) ? Math.max(0, Math.min(1, tauxEchec)) : 0;
  if (!joignable && (rate >= 0.6 || essais === 1)) return 'hors service';
  if (rate >= 0.6) return 'hors service';
  if (!joignable || rate >= 0.2 || (Number.isFinite(tempsReponseMs) && tempsReponseMs > 5000)) {
    return 'instable';
  }
  return 'saine';
}

export function normalizeProbe(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const historique = Array.isArray(src.historique)
    ? src.historique.map((item) => Boolean(item)).slice(-PROBE_HISTORY_MAX)
    : [];
  const essais = Number.isInteger(src.essais) && src.essais >= 0 ? src.essais : historique.length;
  const echecs = Number.isInteger(src.echecs) && src.echecs >= 0
    ? Math.min(essais, src.echecs)
    : historique.filter((ok) => !ok).length;
  const tauxEchec = historique.length
    ? Math.round((historique.filter((ok) => !ok).length / historique.length) * 1000) / 1000
    : (essais > 0 ? Math.round((echecs / essais) * 1000) / 1000 : 0);
  const joignable = typeof src.joignable === 'boolean' ? src.joignable : null;
  const tempsReponseMs = Number.isFinite(src.tempsReponseMs) && src.tempsReponseMs >= 0
    ? Math.round(src.tempsReponseMs)
    : null;
  const computed = computeProbeState({ joignable, tempsReponseMs, tauxEchec, essais });
  const etat = PROBE_STATES.includes(src.etat) && essais > 0 ? src.etat : computed;
  return {
    etat,
    joignable,
    tempsReponseMs,
    tauxEchec,
    essais,
    echecs,
    historique,
    verifieLe: src.verifieLe ? clean(src.verifieLe, 40) : null,
    codeHttp: Number.isInteger(src.codeHttp) ? src.codeHttp : null,
    erreur: src.erreur ? clean(src.erreur, 160) : '',
  };
}

/** Normalise une source (format 3.18.0 ou ancien format 3.17.0) en gardant les alias utiles. */
export function normalizeSource(raw = {}, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nom = clean(src.nom ?? src.name ?? `Source ${index + 1}`, 80) || `Source ${index + 1}`;
  const id = slugifySourceId(src.id || nom);
  const contenu = SOURCE_CONTENTS.includes(src.contenu) ? src.contenu : 'chaine';
  const type = SOURCE_TYPES.includes(src.type)
    ? src.type
    : (contenu === 'chaine' ? 'direct' : 'vod');
  const url = clean(src.url, 500);
  // Si la clé `licence` ou `license` a été fournie explicitement à vide, on garde le vide pour déclencher le refus.
  const hasExplicitLicence = Object.prototype.hasOwnProperty.call(src, 'licence')
    || Object.prototype.hasOwnProperty.call(src, 'license');
  const licence = hasExplicitLicence
    ? clean(src.licence ?? src.license ?? '', 160)
    : clean(src.licence ?? src.license ?? '', 160);
  const pays = clean(src.pays ?? src.country ?? 'INT', 3).toUpperCase() || 'INT';
  const langue = clean(src.langue ?? src.language ?? (contenu === 'chaine' ? 'multi' : 'VOSTFR'), 12) || 'multi';
  const actif = typeof src.actif === 'boolean'
    ? src.actif
    : (typeof src.enabled === 'boolean' ? src.enabled : true);
  const rawPrio = Number(src.priorite ?? src.weight ?? 50);
  const priorite = Number.isFinite(rawPrio) ? Math.max(1, Math.min(100, Math.round(rawPrio))) : 50;
  const note = clean(src.note ?? '', 240);
  const seedFile = src.seedFile && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(String(src.seedFile))
    ? String(src.seedFile)
    : '';
  const lastIngestAt = src.lastIngestAt ? clean(src.lastIngestAt, 40) : null;
  const sonde = normalizeProbe(src.sonde);

  return {
    id,
    nom,
    type,
    contenu,
    url,
    licence,
    pays,
    langue,
    actif,
    priorite,
    note,
    ...(seedFile ? { seedFile } : {}),
    lastIngestAt,
    sonde,
    // Alias synchronisés pour les modules existants (mentions légales, migration SQL, script verify).
    name: nom,
    license: licence,
    enabled: actif,
  };
}

export function normalizeSourcesList(list) {
  const items = Array.isArray(list) ? list : DEFAULT_SOURCES;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const normalized = normalizeSource(items[i], i);
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  // Si une ancienne installation n'avait que les sources directes, on ajoute les sources VOD par défaut.
  const hasVodAnime = out.some((item) => item.contenu === 'anime');
  const hasVodFilm = out.some((item) => item.contenu === 'film');
  if (!hasVodAnime || !hasVodFilm) {
    for (const def of DEFAULT_SOURCES) {
      if (def.contenu === 'chaine' || seen.has(def.id)) continue;
      if (def.contenu === 'anime' && hasVodAnime) continue;
      if (def.contenu === 'film' && hasVodFilm) continue;
      seen.add(def.id);
      out.push(normalizeSource(def));
    }
  }
  return out;
}

function isAllowedSourceUrl(url, sourceId = '') {
  if (!url && sourceId === 'catalogue-propre') return true;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Validation serveur stricte d'une création ou modification de source. */
export function validateSourceInput(input = {}, { partial = false, existing = null, existingIds = new Set() } = {}) {
  if (!input || typeof input !== 'object') {
    throw new AppError('ERR-04', { params: { champ: 'source' } });
  }
  const base = existing ? normalizeSource(existing) : {
    id: '',
    nom: '',
    type: 'vod',
    contenu: 'film',
    url: '',
    licence: '',
    pays: 'INT',
    langue: 'VOSTFR',
    actif: true,
    priorite: 50,
    note: '',
    seedFile: '',
    lastIngestAt: null,
    sonde: normalizeProbe(),
  };

  const nom = ('nom' in input || 'name' in input || !partial)
    ? clean(input.nom ?? input.name ?? base.nom, 80)
    : base.nom;
  if (!nom) throw new AppError('ERR-02', { field: 'nom', params: { champ: 'nom' } });

  const id = existing ? base.id : slugifySourceId(input.id || nom);
  if (!existing && existingIds.has(id)) {
    throw new AppError('ERR-16', { field: 'id', message: `Une source porte déjà l’identifiant « ${id} ».` });
  }

  const contenu = ('contenu' in input || !partial) ? clean(input.contenu ?? base.contenu, 16) : base.contenu;
  if (!SOURCE_CONTENTS.includes(contenu)) {
    throw new AppError('ERR-04', { field: 'contenu', params: { champ: 'contenu (chaine, anime ou film)' } });
  }

  const type = ('type' in input || !partial)
    ? clean(input.type ?? (contenu === 'chaine' ? 'direct' : 'vod'), 16)
    : base.type;
  if (!SOURCE_TYPES.includes(type)) {
    throw new AppError('ERR-04', { field: 'type', params: { champ: 'type (direct ou vod)' } });
  }

  const url = ('url' in input || !partial) ? clean(input.url ?? base.url, 500) : base.url;
  if (!isAllowedSourceUrl(url, id) && !base.seedFile && !input.seedFile) {
    throw new AppError('ERR-04', {
      field: 'url',
      message: 'L’adresse de la source doit utiliser HTTPS (ou http://127.0.0.1 en test local).',
    });
  }

  const hasLicenceKey = 'licence' in input || 'license' in input;
  const licence = (hasLicenceKey || !partial)
    ? clean(input.licence ?? input.license ?? (partial ? base.licence : ''), 160)
    : base.licence;
  if (!licence) {
    throw new AppError('ERR-16', {
      field: 'licence',
      message: `Licence obligatoire : la source « ${nom} » doit déclarer une licence explicite (ex. CC BY 4.0, Domaine public).`,
    });
  }

  const pays = ('pays' in input || !partial) ? clean(input.pays ?? base.pays, 3).toUpperCase() : base.pays;
  if (!/^[A-Z]{2,3}$/.test(pays)) {
    throw new AppError('ERR-04', { field: 'pays', params: { champ: 'pays (code ISO sur 2 ou 3 lettres)' } });
  }

  const langue = ('langue' in input || !partial) ? clean(input.langue ?? base.langue, 12) : base.langue;
  if (!SOURCE_LANGUAGES.includes(langue) && !/^[a-z]{2,3}$/.test(langue)) {
    throw new AppError('ERR-04', { field: 'langue', params: { champ: 'langue (VOSTFR, VF, VO, fr, en, multi)' } });
  }

  const actif = ('actif' in input || 'enabled' in input || !partial)
    ? (input.actif ?? input.enabled ?? base.actif)
    : base.actif;
  if (typeof actif !== 'boolean') {
    throw new AppError('ERR-04', { field: 'actif', params: { champ: 'actif' } });
  }

  let priorite = base.priorite;
  if ('priorite' in input || 'weight' in input || !partial) {
    const rawPrio = input.priorite ?? input.weight ?? base.priorite;
    const num = typeof rawPrio === 'boolean' || rawPrio === '' || rawPrio === null ? NaN : Number(rawPrio);
    if (!Number.isInteger(num) || num < 1 || num > 100) {
      throw new AppError('ERR-03', { field: 'priorite', params: { champ: 'priorité', min: 1, max: 100 } });
    }
    priorite = num;
  }

  const note = ('note' in input || !partial) ? clean(input.note ?? base.note, 240) : base.note;
  return normalizeSource({
    ...base,
    id,
    nom,
    type,
    contenu,
    url,
    licence,
    pays,
    langue,
    actif,
    priorite,
    note,
  });
}

/** Règle juridique non négociable : refuse tout import si la source n'a pas de licence. */
export function assertSourceLicensed(source) {
  const nom = clean(source?.nom ?? source?.name ?? source?.id ?? 'inconnue', 80);
  const licence = clean(source?.licence ?? source?.license ?? '', 160);
  if (!licence) {
    throw new AppError('ERR-16', {
      field: 'licence',
      message: `Import refusé : la source « ${nom} » n’indique aucune licence. Renseignez une licence explicite avant d’importer.`,
    });
  }
  return licence;
}

/** Arbitrage déterministe des doublons par priorité de source. */
export function arbitrateDuplicate({ contentType, contentId, incomingSource, existingSourceId, existingPriorite }) {
  const inId = clean(incomingSource?.id || 'inconnue', 48);
  const inPrio = Number.isFinite(Number(incomingSource?.priorite)) ? Number(incomingSource.priorite) : 50;
  const exId = clean(existingSourceId || 'inconnue', 48);
  const exPrio = Number.isFinite(Number(existingPriorite)) ? Number(existingPriorite) : 50;

  if (inId === exId) {
    return {
      isDuplicateBetweenSources: false,
      winner: 'incoming',
      replaced: true,
      detail: `${contentType} ${contentId} : mise à jour depuis la même source ${inId} (priorité ${inPrio})`,
    };
  }
  if (inPrio > exPrio) {
    return {
      isDuplicateBetweenSources: true,
      winner: 'incoming',
      replaced: true,
      detail: `${contentType} ${contentId} : la source ${inId} (priorité ${inPrio}) l’emporte sur ${exId} (priorité ${exPrio})`,
    };
  }
  return {
    isDuplicateBetweenSources: true,
    winner: 'existing',
    replaced: false,
    detail: `${contentType} ${contentId} : la source ${exId} (priorité ${exPrio}) est conservée face à ${inId} (priorité ${inPrio})`,
  };
}

/** Sanitise une URL publique pour ne jamais exposer d'identifiants ni de jetons de requête. */
export function sanitizePublicSourceUrl(url) {
  const raw = clean(url, 500);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|auth|pass|sig/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

/** Représentation publique d'une source (/api/sources), garantie sans secret. */
export function publicSourcePayload(source) {
  const normalized = normalizeSource(source);
  return {
    id: normalized.id,
    nom: normalized.nom,
    type: normalized.type,
    contenu: normalized.contenu,
    url: sanitizePublicSourceUrl(normalized.url),
    licence: normalized.licence,
    pays: normalized.pays,
    langue: normalized.langue,
    actif: normalized.actif,
    priorite: normalized.priorite,
    etat: normalized.sonde.etat,
    verifieLe: normalized.sonde.verifieLe,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Téléchargement avec budget de tentatives borné et délai progressif. */
export async function fetchWithRetry(url, {
  maxAttempts = 3,
  baseDelayMs = 120,
  timeoutMs = LIMITS.fetchTimeoutMs,
  maxBytes = LIMITS.importMaxBytes,
  fetchImpl = fetch,
} = {}) {
  const budget = Math.max(1, Math.min(5, Math.round(Number(maxAttempts) || 3)));
  let lastError = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= budget; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'StreamTV/3.18 (+catalogue-ouvert)' },
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
      } else if (!response.ok) {
        throw new AppError('ERR-16', {
          message: `La source a répondu avec le code HTTP ${response.status}.`,
        });
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
          throw new AppError('ERR-06', { params: { max: `${Math.round(maxBytes / 1024 / 1024)} Mo` } });
        }
        return {
          text: buffer.toString('utf8'),
          status: response.status,
          attemptsUsed: attempt,
          durationMs: Math.max(1, Date.now() - startedAt),
        };
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < budget && baseDelayMs > 0) {
      await sleep(baseDelayMs * attempt);
    }
  }

  throw new AppError('ERR-20', {
    message: `La source n’a pas répondu après ${budget} tentative${budget > 1 ? 's' : ''} (${lastError?.message || 'délai dépassé'}).`,
  });
}

/** Exécute la sonde d'une source (HTTP distante ou manifeste local embarqué). */
export async function probeSingleSource(source, {
  seedDir = '',
  fetchImpl = fetch,
  timeoutMs = LIMITS.probeTimeoutMs,
} = {}) {
  const normalized = normalizeSource(source);
  const prev = normalized.sonde;
  const started = Date.now();
  let ok = false;
  let codeHttp = null;
  let erreur = '';

  if (normalized.id === 'catalogue-propre' && !normalized.url && !normalized.seedFile) {
    ok = true;
    codeHttp = 200;
  } else if (normalized.seedFile && seedDir) {
    try {
      const target = path.join(seedDir, normalized.seedFile);
      const raw = await fsp.readFile(target, 'utf8');
      const parsed = JSON.parse(raw);
      ok = Array.isArray(parsed) || Array.isArray(parsed?.items);
      codeHttp = ok ? 200 : 422;
      if (!ok) erreur = 'Manifeste local invalide';
    } catch (error) {
      ok = false;
      codeHttp = 404;
      erreur = error.message || 'Manifeste local introuvable';
    }
  } else if (normalized.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await fetchImpl(normalized.url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'user-agent': 'StreamTV/3.18 (+sonde-source)' },
      });
      if (response.status === 405 || response.status === 501) {
        response = await fetchImpl(normalized.url, {
          method: 'GET',
          signal: controller.signal,
          headers: { range: 'bytes=0-1023', 'user-agent': 'StreamTV/3.18 (+sonde-source)' },
        });
      }
      codeHttp = response.status;
      ok = response.status >= 200 && response.status < 400;
      if (!ok) erreur = `Réponse HTTP ${response.status}`;
    } catch (error) {
      ok = false;
      erreur = error?.name === 'AbortError' ? 'Délai dépassé' : (error?.message || 'Source injoignable');
    } finally {
      clearTimeout(timer);
    }
  } else {
    ok = false;
    erreur = 'Aucune adresse configurée';
  }

  const tempsReponseMs = Math.max(1, Date.now() - started);
  const historique = [...prev.historique, ok].slice(-PROBE_HISTORY_MAX);
  const essais = prev.essais + 1;
  const echecs = prev.echecs + (ok ? 0 : 1);
  const tauxEchec = Math.round((historique.filter((entry) => !entry).length / historique.length) * 1000) / 1000;
  const etat = computeProbeState({ joignable: ok, tempsReponseMs, tauxEchec, essais });

  return normalizeProbe({
    etat,
    joignable: ok,
    tempsReponseMs,
    tauxEchec,
    essais,
    echecs,
    historique,
    verifieLe: new Date().toISOString(),
    codeHttp,
    erreur: ok ? '' : erreur,
  });
}
