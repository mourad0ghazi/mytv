// public/js/compte.js · compte visiteur côté navigateur (3.19.0).
// Le jeton du compte vit dans sessionStorage, séparé du jeton d'administration : fermer
// l'onglet déconnecte le visiteur sans jamais toucher à la console. Aucune donnée secrète
// n'est conservée : le serveur ne renvoie ni empreinte ni sel.

import { withBase } from './base.js?v=3.21.0';
import { ApiError } from './api.js?v=3.21.0';
import { prefs } from './prefs.js?v=3.21.0';

const KEY = 'streamtv.compte.token';
const NOM = 'streamtv.compte.nom';

export const compteSession = {
  token() {
    try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
  },
  nom() {
    try { return localStorage.getItem(NOM) || ''; } catch { return ''; }
  },
  set(token, nom = '') {
    try {
      sessionStorage.setItem(KEY, token);
      if (nom) localStorage.setItem(NOM, nom);
    } catch { /* stockage indisponible */ }
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(NOM);
    } catch { /* stockage indisponible */ }
  },
  isSignedIn() { return Boolean(compteSession.token()); },
};

function messageDe(status, payload) {
  if (payload?.error) return payload.error;
  if (status === 404) return 'Cette adresse n’existe pas.';
  if (status === 429) return 'Trop de tentatives. Patientez un instant.';
  if (status === 503) return 'Le service d’envoi d’e-mail est indisponible. Réessayez plus tard.';
  return 'Une erreur interne est survenue. Réessayez.';
}

/** Appel HTTP vers /api/compte/*, avec le jeton du compte s'il existe. */
export async function appelCompte(path, { method = 'GET', body = null, timeout = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = {};
  const token = compteSession.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(withBase(path), {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw new ApiError('La source n’a pas répondu à temps. Réessayez.', { code: 'P-10' });
    throw new ApiError('La connexion a été interrompue. Vérifiez votre réseau puis réessayez.', { code: 'P-09' });
  }
  clearTimeout(timer);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    if (response.status === 401) compteSession.clear();
    throw new ApiError(messageDe(response.status, payload), {
      code: payload?.code || 'ERR-18',
      status: response.status,
      field: payload?.field || '',
      requestId: payload?.requestId || '',
    });
  }
  return payload;
}

export const Compte = {
  inscription: (payload) => appelCompte('/api/compte/inscription', { method: 'POST', body: payload }),
  verifier: (email, code) => appelCompte('/api/compte/verification', { method: 'POST', body: { email, code } }),
  renvoyerCode: (email) => appelCompte('/api/compte/renvoyer-code', { method: 'POST', body: { email } }),
  connexion: (email, password) => appelCompte('/api/compte/connexion', { method: 'POST', body: { email, password } }),
  sortie: () => appelCompte('/api/compte/sortie', { method: 'POST', body: {} }),
  profil: () => appelCompte('/api/compte/profil'),
  renommer: (name) => appelCompte('/api/compte/profil', { method: 'PATCH', body: { name } }),
  motDePasse: (actuel, nouveau) => appelCompte('/api/compte/mot-de-passe', { method: 'POST', body: { actuel, nouveau } }),
  codeOublie: (email) => appelCompte('/api/compte/code-oublie', { method: 'POST', body: { email } }),
  reinitialiser: (payload) => appelCompte('/api/compte/reinitialisation', { method: 'POST', body: payload }),
  donnees: () => appelCompte('/api/compte/donnees'),
  preferences: (payload) => appelCompte('/api/compte/preferences', { method: 'PUT', body: payload }),
  favori: (payload) => appelCompte('/api/compte/favoris', { method: 'POST', body: payload }),
  historique: (payload) => appelCompte('/api/compte/historique', { method: 'POST', body: payload }),
  signalements: () => appelCompte('/api/compte/signalements'),
};

/**
 * Après connexion ou confirmation : l'état local part au serveur, l'union revient et
 * remplace le stockage local. Le visiteur retrouve donc ses favoris sur un autre appareil.
 */
export async function synchroniserCompte() {
  const local = prefs.exporter();
  const donnees = await appelCompte('/api/compte/donnees', { method: 'PUT', body: local });
  prefs.importer(donnees);
  return donnees;
}

/** Ouvre la session locale après une réponse serveur contenant un jeton. */
export function ouvrirSession(payload) {
  if (!payload?.token) return false;
  compteSession.set(payload.token, payload.compte?.name || '');
  return true;
}
