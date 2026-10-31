// server/core/errors.js — les 20 codes d'erreur opposables (§6.3) et leur mise en forme.
// Aucun message technique n'est jamais renvoyé à l'utilisateur.

export const ERRORS = {
  'ERR-01': { status: 400, message: 'Le formulaire est incomplet ou mal formé. Réessayez.' },
  'ERR-02': { status: 400, message: 'Le champ « {champ} » est obligatoire.' },
  'ERR-03': { status: 400, message: '« {champ} » doit être compris entre {min} et {max}.' },
  'ERR-04': { status: 400, message: '« {champ} » n’a pas le bon format.' },
  'ERR-05': { status: 400, message: 'Ce fichier n’est pas une liste M3U : aucune chaîne n’a été trouvée.' },
  'ERR-06': { status: 400, message: 'La requête a été refusée : données illisibles.' },
  'ERR-07': { status: 401, message: 'Votre session a expiré. Reconnectez-vous.' },
  'ERR-08': { status: 401, message: 'Mot de passe incorrect.' },
  'ERR-09': { status: 403, message: 'Cette action n’est pas autorisée.' },
  'ERR-10': { status: 404, message: 'Chaîne introuvable.' },
  'ERR-11': { status: 404, message: 'Cette adresse n’existe pas.' },
  'ERR-12': { status: 405, message: 'Action non autorisée sur cette adresse.' },
  'ERR-13': { status: 409, message: 'Une importation est déjà en cours. Patientez.' },
  'ERR-14': { status: 409, message: 'Cette chaîne existe déjà dans le catalogue.' },
  'ERR-15': { status: 413, message: 'Fichier trop volumineux (maximum {max}).' },
  'ERR-16': { status: 422, message: 'Impossible d’appliquer : {raison}.' },
  'ERR-17': { status: 429, message: 'Trop de tentatives. Réessayez dans {n} minutes.' },
  'ERR-18': { status: 500, message: 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code {requestId}.' },
  'ERR-19': { status: 503, message: 'Le service est momentanément indisponible. Retour prévu : {heure}.' },
  'ERR-20': { status: 504, message: 'La source n’a pas répondu à temps. Réessayez plus tard.' },
};

export const ERROR_CODES = Object.keys(ERRORS);

/** Rend le texte exact du code, en substituant les valeurs fournies. */
export function errorMessage(code, params = {}) {
  const entry = ERRORS[code] || ERRORS['ERR-18'];
  const requestId = params.requestId || '';
  return entry.message.replace(/\{(\w+)\}/g, (match, key) => {
    if (key === 'requestId') return requestId || '—';
    const value = params[key];
    return value === undefined || value === null || value === '' ? '—' : String(value);
  });
}

/** Corps JSON normalisé : {error, code, requestId?, field?}. */
export function errorBody(code, { params = {}, field = '', requestId = '' } = {}) {
  const entry = ERRORS[code] || ERRORS['ERR-18'];
  const body = { error: errorMessage(code, { ...params, requestId }), code };
  if (field) body.field = field;
  if (requestId) body.requestId = requestId;
  return { status: entry.status, body };
}

/** Erreur applicative transportant un code opposable. */
export class AppError extends Error {
  constructor(code, { params = {}, field = '', headers = {}, requestId = '', message = '' } = {}) {
    super(message || errorMessage(code, params));
    this.custom = Boolean(message);
    this.name = 'AppError';
    this.code = code;
    this.field = field;
    this.params = params;
    this.headers = headers;
    this.requestId = requestId;
    this.status = (ERRORS[code] || ERRORS['ERR-18']).status;
  }
}

export function requireField(value, field, label, { max = 2000, min = 1 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new AppError('ERR-02', { field, params: { champ: label } });
  }
  const text = String(value).trim();
  if (text.length < min) throw new AppError('ERR-02', { field, params: { champ: label } });
  if (text.length > max) {
    throw new AppError('ERR-03', { field, params: { champ: label, min: 1, max } });
  }
  return text;
}

export function requireRange(value, field, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new AppError('ERR-04', { field, params: { champ: label } });
  }
  if (number < min || number > max) {
    throw new AppError('ERR-03', { field, params: { champ: label, min, max } });
  }
  return number;
}

export function requireOneOf(value, field, label, allowed) {
  if (!allowed.includes(value)) {
    throw new AppError('ERR-04', { field, params: { champ: label } });
  }
  return value;
}
