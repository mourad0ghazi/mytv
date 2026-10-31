// public/js/router.js · routage History API, interception des liens, nettoyage des vues.
// Aucun rechargement complet : une seule coquille HTML, des vues montées puis démontées.

import { BASE, resolve, withoutBase } from './base.js?v=3.19.0';
import { consolePath } from './console.js?v=3.19.0';

const ROUTES = [
  { name: 'home', pattern: /^\/$/, title: 'Catalogue' },
  { name: 'search', pattern: /^\/recherche\/?$/, title: 'Recherche' },
  { name: 'guide', pattern: /^\/guide\/?$/, title: 'Guide' },
  { name: 'channel', pattern: /^\/chaine\/([A-Za-z0-9_-]{1,32})\/?$/, title: 'Fiche chaîne', keys: ['id'] },
  { name: 'anime', pattern: /^\/anime\/?$/, title: 'Anime' },
  { name: 'animeDetail', pattern: /^\/anime\/([A-Za-z0-9_-]{1,80})\/?$/, title: 'Fiche anime', keys: ['id'] },
  { name: 'films', pattern: /^\/films\/?$/, title: 'Films' },
  { name: 'filmDetail', pattern: /^\/film\/([A-Za-z0-9_-]{1,80})\/?$/, title: 'Fiche film', keys: ['id'] },
  { name: 'favorites', pattern: /^\/favoris\/?$/, title: 'Favoris et historique' },
  { name: 'access', pattern: /^\/acces\/([a-f0-9]{64})\/?$/, title: 'Connexion par lien', keys: ['token'] },
  { name: 'login', pattern: /^\/(?:connexion|login)\/?$/, title: 'Connexion administration' },
  { name: 'compte', pattern: /^\/compte\/?$/, title: 'Mon compte' },
  { name: 'compteInscription', pattern: /^\/compte\/inscription\/?$/, title: 'Créer un compte' },
  { name: 'compteConnexion', pattern: /^\/compte\/connexion\/?$/, title: 'Connexion à mon compte' },
  { name: 'legal', pattern: /^\/mentions-legales\/?$/, title: 'Mentions légales' },
  { name: 'privacy', pattern: /^\/confidentialite\/?$/, title: 'Confidentialité' },
  { name: 'report', pattern: /^\/signaler\/?$/, title: 'Signaler un contenu' },
  { name: 'help', pattern: /^\/aide\/?$/, title: 'Aide et raccourcis' },
  { name: 'errors', pattern: /^\/erreurs\/?$/, title: 'Catalogue des messages' },
];

/** Découpe une chaîne de requête en objet simple (première valeur gagnante). */
export function parseQuery(search = '') {
  const clean = String(search).replace(/^\?/, '');
  const out = Object.create(null);
  if (!clean) return out;
  for (const [key, value] of new URLSearchParams(clean)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

export function matchRoute(pathname) {
  const path = pathname || '/';
  // La console vit sur un chemin privé, connu seulement de ce navigateur.
  const consoleSegment = consolePath();
  if (consoleSegment && path.replace(/^\/+|\/+$/g, '') === consoleSegment) {
    return { name: 'admin', title: 'Console', params: {}, path };
  }
  for (const route of ROUTES) {
    const found = route.pattern.exec(path);
    if (!found) continue;
    const params = {};
    (route.keys || []).forEach((key, index) => {
      try { params[key] = decodeURIComponent(found[index + 1]); } catch { params[key] = found[index + 1]; }
    });
    return { name: route.name, title: route.title, params, path };
  }
  return { name: 'notFound', title: 'Page introuvable', params: {}, path };
}

export function routeTitle(route) {
  return route.title || 'StreamTV';
}

function isSameOrigin(href) {
  try {
    const url = new URL(href, location.href);
    return url.origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Crée le routeur.
 * @param {{render: (route: object) => Promise<void> | void, announce?: (route: object) => void}} options
 */
export function createRouter({ render, announce = null }) {
  let started = false;
  let current = null;
  let pending = 0;

  const buildLocation = () => {
    const route = matchRoute(withoutBase(location.pathname));
    route.query = parseQuery(location.search);
    route.hash = location.hash;
    route.url = location.pathname + location.search;
    return route;
  };

  const run = async ({ keepScroll = false, focus = true, restore = null } = {}) => {
    const route = buildLocation();
    const ticket = ++pending;
    current = route;
    if (announce) announce(route);
    try {
      await render(route);
    } finally {
      if (ticket !== pending) return; // une navigation plus récente a pris la main
      const main = document.getElementById('main');
      if (main) {
        if (!keepScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
        if (focus) {
          try { main.focus({ preventScroll: true }); } catch { main.focus(); }
        }
      }
      if (restore && typeof restore === 'function') restore();
      document.documentElement.classList.remove('is-navigating');
    }
  };

  const navigate = (to, { replace = false, keepScroll = false, focus = true } = {}) => {
    const url = resolve(to);
    if (!url) return;
    if (url.origin !== location.origin) { location.assign(url.href); return; }
    const next = url.pathname + url.search + url.hash;
    const same = next === location.pathname + location.search + location.hash;
    if (same) { run({ keepScroll }); return; }
    document.documentElement.classList.add('is-navigating');
    if (replace) history.replaceState({ scroll: window.scrollY }, '', next);
    else history.pushState({ scroll: window.scrollY }, '', next);
    run({ keepScroll, focus });
  };

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest ? event.target.closest('a') : null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    if (anchor.dataset.external === 'true') return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
    if (!isSameOrigin(href)) return;
    const explicit = anchor.hasAttribute('data-link');
    // Les liens internes sont pris en charge même sans data-link : un clic ne recharge jamais la page.
    event.preventDefault();
    const url = new URL(href, location.href);
    if (explicit && url.pathname === location.pathname && url.search === location.search && url.hash) {
      const target = document.querySelector(url.hash);
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    }
    // On repasse par une route logique (« /guide ») : navigate() réapplique la racine du déploiement.
    navigate(withoutBase(url.pathname) + url.search + url.hash);
  };

  const onPop = () => {
    const state = history.state || {};
    run({ keepScroll: true, focus: false, restore: () => {
      if (typeof state.scroll === 'number') window.scrollTo({ top: state.scroll });
    } });
  };

  const start = () => {
    if (started) return;
    started = true;
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    if (!history.state) history.replaceState({ scroll: window.scrollY }, '', location.href);
    document.documentElement.classList.add('is-navigating');
    run({ focus: false });
  };

  const stop = () => {
    document.removeEventListener('click', onClick);
    window.removeEventListener('popstate', onPop);
    started = false;
  };

  return {
    start,
    stop,
    navigate,
    get current() { return current; },
    refresh: () => run({ keepScroll: true, focus: false }),
  };
}
