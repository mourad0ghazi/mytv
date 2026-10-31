// public/js/epg-now.js · « en ce moment » : programme en cours d'une chaîne (F-23 étendu).
// Chargé au survol ou au focus d'une carte, jamais au chargement de la page.
// Trois règles : une seule requête par lot, cache mémoire de 5 minutes, silence total en cas d'échec.

import { api } from './api.js?v=3.22.0';

const DUREE_CACHE = 5 * 60 * 1000;
const cache = new Map();
const enCours = new Map();
let disponible = true;
let dernierEchec = 0;

function expire(entree) {
  return !entree || Date.now() - entree.at > DUREE_CACHE;
}

/** Une réponse fraîche existe déjà (positive ou négative) : inutile de redemander. */
function frais(id) {
  const entree = cache.get(id);
  return Boolean(entree) && Date.now() - entree.at <= DUREE_CACHE;
}

/** Programme en cours déjà connu, sans requête. */
export function nowCached(id) {
  const entree = cache.get(id);
  if (!entree || expire(entree)) return null;
  return entree.programme;
}

/** Horodatage lisible et stable : « 20:45 », au format 24 h de l'interface. */
export function heureCourte(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Progression du programme, entre 0 et 1. */
export function progression(programme) {
  if (!programme) return 0;
  const debut = new Date(programme.start).getTime();
  const fin = new Date(programme.stop).getTime();
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return 0;
  return Math.min(1, Math.max(0, (Date.now() - debut) / (fin - debut)));
}

async function demander(ids) {
  const liste = ids.filter((id) => !enCours.has(id) && !frais(id));
  if (!liste.length) return;
  for (const id of liste) enCours.set(id, true);
  try {
    const payload = await api(`/api/epg/now?ids=${encodeURIComponent(liste.join(','))}`);
    disponible = payload?.enabled !== false;
    const now = Array.isArray(payload?.now) ? payload.now : [];
    for (const item of now) cache.set(item.id, { at: Date.now(), programme: item });
    for (const id of liste) if (!cache.has(id)) cache.set(id, { at: Date.now(), programme: null });
  } catch {
    // Guide indisponible : la carte n'affiche simplement pas de programme.
    disponible = false;
    dernierEchec = Date.now();
  } finally {
    for (const id of liste) enCours.delete(id);
  }
}

/** Prépare les programmes d'une page entière en une requête. */
export async function primeNow(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  if (!disponible && Date.now() - dernierEchec < DUREE_CACHE) return;
  await demander(ids.slice(0, 60));
}

/** Programme en cours pour une chaîne, avec requête à la demande. */
export async function nowFor(id) {
  const connu = nowCached(id);
  if (connu !== null || !disponible) return connu;
  await demander([id]);
  return nowCached(id) || null;
}

/** Le guide est-il utilisable ? (mis à jour après le premier appel) */
export function guideDisponible() {
  return disponible;
}
