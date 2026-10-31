// public/js/base.js · racine de déploiement.
// Le serveur Node sert le site à la racine (« / ») : BASE vaut alors « / » et rien ne change.
// Une démonstration statique peut être publiée dans un sous-dossier (« /myiptv/ ») : le build
// injecte alors <base href="/myiptv/"> et tous les appels passent par withBase().

const declared = typeof document !== 'undefined' && document.querySelector('base')
  ? document.querySelector('base').href
  : (typeof location !== 'undefined' ? location.origin + '/' : '/');
const path = (() => {
  try { return new URL(declared).pathname; } catch { return '/'; }
})();

export const BASE = path.endsWith('/') ? path : `${path}/`;

/** Transforme un chemin absolu du site (« /api/config ») en URL réelle du déploiement. */
export function withBase(path = '') {
  const text = String(path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//')) return text; // URL absolue : intacte
  return `${BASE}${text.replace(/^\/+/, '')}`;
}

/** Retire la racine du déploiement d'un chemin de `location` pour retrouver les routes du routeur. */
export function withoutBase(pathname = '/') {
  if (BASE === '/') return pathname || '/';
  const value = pathname || '/';
  if (value === BASE.slice(0, -1)) return '/';
  return value.startsWith(BASE) ? `/${value.slice(BASE.length)}` : value;
}

/** Résout une destination de navigation contre la racine du déploiement. */
export function resolve(to = '/') {
  const text = String(to);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//')) {
    try { return new URL(text); } catch { return null; }
  }
  return new URL(text.replace(/^\/+/, ''), new URL(BASE, location.href));
}
