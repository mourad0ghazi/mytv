// public/js/api.js · client HTTP unique. Toute erreur devient une phrase française.

import { withBase } from './base.js?v=3.18.1';

const TOKEN_KEY = 'streamtv.token';

export class ApiError extends Error {
  constructor(message, { code = 'ERR-18', status = 0, field = '', requestId = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
    this.requestId = requestId;
  }
}

export const auth = {
  token: () => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* stockage indisponible */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ }
  },
  isSignedIn() { return Boolean(auth.token()); },
};

export async function api(path, { method = 'GET', body = null, timeout = 25_000, signal = null } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Vous êtes hors ligne. Vérifiez votre connexion.', { code: 'P-09' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // Un appelant peut annuler sa demande (suggestions de recherche) sans priver l'appel
  // de son propre plafond de temps.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const headers = {};
  const token = auth.token();
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
    if (error.name === 'AbortError') {
      throw new ApiError('La source n’a pas répondu à temps. Réessayez plus tard.', { code: 'P-10' });
    }
    throw new ApiError('La connexion a été interrompue. Vérifiez votre réseau puis réessayez.', { code: 'P-09' });
  }
  clearTimeout(timer);

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    if (response.status === 401) {
      auth.clear();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    const message = payload?.error
      || (response.status === 404 ? 'Cette adresse n’existe pas.'
        : response.status === 429 ? 'Trop de tentatives. Patientez un instant.'
          : 'Une erreur interne est survenue. Réessayez.');
    throw new ApiError(message, {
      code: payload?.code || 'ERR-18',
      status: response.status,
      field: payload?.field || '',
      requestId: payload?.requestId || '',
    });
  }
  return payload;
}

/** Téléchargement authentifié (export M3U / JSON). */
export async function download(path, filename) {
  const token = auth.token();
  const response = await fetch(withBase(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    let message = 'Le fichier n’a pas pu être préparé.';
    try { message = (await response.json()).error || message; } catch { /* corps non JSON */ }
    throw new ApiError(message, { status: response.status });
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Signalement public. Le site enregistre, il ne supprime pas : la décision appartient
 * au propriétaire, sauf seuil de signalements franchi.
 */
export const Public = {
  report: (payload) => api('/api/report', { method: 'POST', body: payload }),
  reportStatus: (ref) => api(`/api/report/${encodeURIComponent(ref)}`),
};

/**
 * Identifiant de cet appareil : 32 caractères tirés au hasard, conservés localement.
 * Il ne contient aucune information personnelle et ne quitte le navigateur qu'à la
 * connexion ou à l'enregistrement d'un appareil.
 */
const DEVICE_KEY = 'streamtv.device';
export function deviceId() {
  try {
    const connu = localStorage.getItem(DEVICE_KEY);
    if (connu && /^[a-f0-9]{32}$/.test(connu)) return connu;
    const octets = new Uint8Array(16);
    crypto.getRandomValues(octets);
    const neuf = [...octets].map((octet) => octet.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, neuf);
    return neuf;
  } catch {
    return '';
  }
}

/** API admin : objet unique, testé par tests/api.test.js. */
export const redeemAccess = (token) => api('/api/access/redeem', {
  method: 'POST', body: { token, deviceId: deviceId() },
});

export const Admin = {
  session: () => api('/api/session'),
  login: (password, email = '') => api('/api/login', { method: 'POST', body: { password, email, deviceId: deviceId() } }),
  gate: () => api('/api/admin/gate'),
  setup: () => api('/api/admin/setup'),
  saveIdentity: (name) => api('/api/admin/setup/identity', { method: 'POST', body: { name } }),
  accessLinks: () => api('/api/admin/access-links'),
  createAccessLink: (payload) => api('/api/admin/access-links', { method: 'POST', body: payload }),
  revokeAccessLink: (id) => api(`/api/admin/access-links/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  devices: () => api(`/api/admin/devices?current=${deviceId()}`),
  addDevice: (label) => api('/api/admin/devices', { method: 'POST', body: { deviceId: deviceId(), label } }),
  removeDevice: (id) => api(`/api/admin/devices/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  logout: () => api('/api/logout', { method: 'POST', body: {} }),
  // Second facteur : le code part vers l'e-mail du propriétaire, la session n'existe qu'après.
  loginCode: (challengeId, code) => api('/api/login/code', { method: 'POST', body: { challengeId, code, deviceId: deviceId() } }),
  resendCode: (challengeId) => api('/api/login/code/resend', { method: 'POST', body: { challengeId, deviceId: deviceId() } }),
  testMail: () => api('/api/admin/mail/test', { method: 'POST', body: {} }),
  channels: (params) => api(`/api/admin/channels?${new URLSearchParams(params)}`),
  channel: (id) => api(`/api/admin/channels/${id}`),
  update: (id, patch) => api(`/api/admin/channels/${id}`, { method: 'PATCH', body: patch }),
  create: (payload) => api('/api/admin/channels', { method: 'POST', body: payload }),
  remove: (id) => api(`/api/admin/channels/${id}`, { method: 'DELETE', body: {} }),
  restore: (id) => api(`/api/admin/channels/${id}/restore`, { method: 'POST', body: {} }),
  bulk: (ids, action, value) => api('/api/admin/channels/bulk', { method: 'POST', body: { ids, action, value } }),
  tag: (id, category) => api(`/api/admin/channels/${id}/tag`, { method: 'POST', body: { category } }),
  tagPreview: (id) => api(`/api/admin/channels/${id}/tag/preview`, { method: 'POST', body: {} }),
  autotag: () => api('/api/admin/autotag-all', { method: 'POST', body: {} }),
  importPreview: (payload) => api('/api/admin/import/preview', { method: 'POST', body: payload, timeout: 120_000 }),
  importCommit: (jobId) => api('/api/admin/import/commit', { method: 'POST', body: { jobId }, timeout: 120_000 }),
  importStatus: (id) => api(`/api/admin/import/${id}/status`),
  importRollback: (id) => api(`/api/admin/import/${id}/rollback`, { method: 'POST', body: {} }),
  ingestions: () => api('/api/admin/ingestions'),
  settings: () => api('/api/admin/settings'),
  saveSettings: (patch) => api('/api/admin/settings', { method: 'PATCH', body: patch }),
  resetSettings: () => api('/api/admin/settings/reset', { method: 'POST', body: {} }),
  rules: () => api('/api/admin/rules'),
  saveRules: (rules) => api('/api/admin/rules', { method: 'PATCH', body: { rules } }),
  stats: () => api('/api/admin/stats'),
  probe: (payload) => api('/api/admin/health/probe', { method: 'POST', body: payload, timeout: 120_000 }),
  backup: () => api('/api/admin/backup', { method: 'POST', body: {} }),
  restoreBackup: (file) => api('/api/admin/restore', { method: 'POST', body: { file, confirm: 'RESTAURER' }, timeout: 60_000 }),
  password: (current, next, confirm) => api('/api/admin/password', { method: 'POST', body: { current, next, confirm } }),
  revokeSessions: () => api('/api/admin/sessions', { method: 'DELETE', body: {} }),
  links: (params) => api(`/api/admin/links?${new URLSearchParams(params)}`),
  consoleMeta: () => api('/api/admin/console/meta'),
  reports: (params = {}) => api(`/api/admin/reports?${new URLSearchParams(params)}`),
  confirmReport: (id) => api(`/api/admin/reports/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {} }),
  rejectReport: (id, note = '') => api(`/api/admin/reports/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { note } }),
  resetReports: (channelId) => api(`/api/admin/reports/${encodeURIComponent(channelId)}/reset`, { method: 'POST', body: {} }),
  // 3.9.0 : pilotage, agent de diagnostic, usage et comptes d'équipe.
  diagnostic: () => api('/api/admin/diagnostic'),
  analytics: (hours = 168) => api(`/api/admin/analytics?heures=${hours}`),
  audit: (lines = 60) => api(`/api/admin/audit?lines=${lines}`),
  team: () => api('/api/admin/team'),
  addMember: (payload) => api('/api/admin/team', { method: 'POST', body: payload }),
  updateMember: (id, patch) => api(`/api/admin/team/${id}`, { method: 'PATCH', body: patch }),
  removeMember: (id) => api(`/api/admin/team/${id}`, { method: 'DELETE', body: {} }),
  testLink: (url) => api('/api/admin/link/test', { method: 'POST', body: { url }, timeout: 20_000 }),
  trackPlay: (channelId) => api('/api/events/play', { method: 'POST', body: { channelId } }),
  // 3.18.0 : sources, anime et films, documentation d'administration.
  sources: () => api('/api/admin/sources'),
  createSource: (payload) => api('/api/admin/sources', { method: 'POST', body: payload }),
  updateSource: (id, patch) => api(`/api/admin/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteSource: (id) => api(`/api/admin/sources/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  probeSources: (ids = []) => api('/api/admin/sources/probe', { method: 'POST', body: { ids }, timeout: 120_000 }),
  importSource: (id, payload = null) => api(`/api/admin/sources/${encodeURIComponent(id)}/import`, {
    method: 'POST', body: payload === null ? {} : { payload }, timeout: 120_000,
  }),
  sourceImports: (sourceId = '') => api(`/api/admin/sources/imports${sourceId ? `?source=${encodeURIComponent(sourceId)}` : ''}`),
  resetSourceImport: (importId) => api(`/api/admin/sources/imports/${encodeURIComponent(importId)}/reset`, { method: 'POST', body: {} }),
  adminAnime: () => api('/api/admin/anime'),
  adminFilms: () => api('/api/admin/films'),
  adminAnimeOne: (id) => api(`/api/admin/anime/${encodeURIComponent(id)}`),
  adminFilmOne: (id) => api(`/api/admin/films/${encodeURIComponent(id)}`),
  updateAnime: (id, patch) => api(`/api/admin/anime/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  updateFilm: (id, patch) => api(`/api/admin/films/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  restoreVod: (kind, id) => api(`/api/admin/vod/${kind}/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} }),
  resetVodReports: (kind, id) => api(`/api/admin/vod/${kind}/${encodeURIComponent(id)}/reports/reset`, { method: 'POST', body: {} }),
  documentation: () => api('/api/admin/documentation'),
};
