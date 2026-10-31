// public/js/console.js · adresse privée de la console (3.11.0).
// Le chemin n'est connu que du navigateur qui a déjà ouvert la porte : le serveur ne le
// communique qu'à celui qui porte le cookie d'entrée. Aucun lien public n'y mène.

const KEY = 'streamtv.console';

/** Chemin de la console retenu par ce navigateur, ou chaîne vide. */
export function consolePath() {
  try {
    const value = localStorage.getItem(KEY) || '';
    return /^[a-z0-9-]{8,40}$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

/** Retient le chemin confirmé par le serveur. */
export function rememberConsole(path) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!/^[a-z0-9-]{8,40}$/.test(clean)) return '';
  try {
    if (localStorage.getItem(KEY) !== clean) localStorage.setItem(KEY, clean);
  } catch {
    // Mode privé sans stockage : la page courante suffit.
  }
  return clean;
}

/** Adresse de la console, ou page de connexion quand le chemin n'est pas encore connu. */
export function consoleHref() {
  const path = consolePath();
  return path ? `/${path}` : '/connexion';
}

/** Adresse de connexion qui ramène ensuite sur la console. */
export function loginHref() {
  const path = consolePath();
  return path ? `/connexion?next=/${path}` : '/connexion';
}
