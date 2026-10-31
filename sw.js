/* public/sw.js · service worker écrit à la main, sans dépendance (3.15.0).
   Trois familles de fichiers, trois conduites distinctes :
   - les fichiers du site (css, js, icônes) : servis depuis le cache, rafraîchis en arrière-plan ;
   - les données de démonstration (demo/*.json) : réseau seulement, jamais de copie ancienne,
     parce qu'une copie de catalogue abîmée laissait l'écran tourner sans fin ;
   - l'API du serveur Node : réseau seulement, jamais de cache, jamais d'identifiant stocké.
   Le chemin de publication est lu dans la portée du worker : le même fichier sert à la racine
   du serveur Node et dans le sous-dossier de GitHub Pages, sans réécriture à la construction. */

const VERSION = 'streamtv-v3.18.0';
const CACHE_COQUILLE = `${VERSION}-coquille`;
const CACHE_FICHIERS = `${VERSION}-fichiers`;

/** Portée réelle du worker : « / » sur le serveur, « /myiptv/ » sur GitHub Pages. */
const PORTEE = new URL(self.registration.scope);

/** Fichiers indispensables au premier écran, résolus contre la portée. */
const COQUILLE = [
  '', 'offline.html', 'css/app.css', 'js/coquille.js', 'js/amorcage.js', 'js/base.js', 'js/app.js', 'js/router.js', 'js/api.js',
  'js/copy.js', 'js/ui.js', 'js/prefs.js', 'js/console.js', 'js/player.js', 'js/player-fullscreen.js',
  'js/player-menu.js', 'js/components.js', 'js/tv.js', 'js/epg-now.js', 'js/preview.js',
  'js/views/home.js', 'js/views/guide.js', 'js/views/channel.js', 'js/views/favorites.js',
  'js/views/login.js', 'js/views/access.js', 'js/views/admin.js', 'js/views/legal.js',
  'js/views/error.js', 'js/views/error-codes.js', 'js/vod-ui.js', 'js/views/anime.js',
  'js/views/films.js', 'js/views/search.js', 'js/player-similar.js',
  'js/views/admin/sources.js', 'js/views/admin/vod.js', 'js/views/admin/doc.js',
  'manifest.webmanifest', 'icons/favicon.svg',
];

const TIMEOUT_RESEAU = 10_000;

/** Chemin du fichier, ramené à la racine du site, quelle que soit la portée de publication. */
function cheminLocal(url) {
  const brut = new URL(url, PORTEE).pathname;
  const base = PORTEE.pathname;
  if (base !== '/' && brut.startsWith(base)) return `/${brut.slice(base.length)}`;
  return brut;
}

/**
 * Conduite à tenir pour une adresse. Fonction pure, exposée plus bas : elle est testée
 * directement, sans navigateur, pour qu'aucune régression ne puisse la remettre en cause.
 *   'externe'  : autre origine, le worker ne touche à rien
 *   'reseau'   : réseau uniquement (API et données de démonstration)
 *   'fichier'  : cache d'abord, réseau en secours
 *   'direct'   : ni cache ni interception
 */
function strategiePour(url) {
  let cible;
  try { cible = new URL(url, PORTEE); } catch { return 'direct'; }
  if (cible.origin !== PORTEE.origin) return 'externe';
  const chemin = cheminLocal(cible);
  // Les données de démonstration changent à chaque publication : aucune copie n'est servie.
  if (chemin.startsWith('/demo/')) return 'reseau';
  if (chemin.startsWith('/api/')) return 'reseau';
  if (chemin.startsWith('/vendor/') || chemin.startsWith('/icons/')) return 'fichier';
  if (/\.(?:css|js|mjs|svg|png|jpg|jpeg|webp|avif|woff2?|webmanifest)$/.test(chemin)) return 'fichier';
  return 'direct';
}

self.__streamtvSw = { VERSION, strategiePour, cheminLocal };

/* ------------------------------------------------------------------ installation */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_COQUILLE);
    // addAll échoue en bloc si une seule ressource manque : on ajoute une par une.
    await Promise.all(COQUILLE.map(async (chemin) => {
      const adresse = new URL(chemin, PORTEE).toString();
      try { await cache.add(new Request(adresse, { cache: 'reload' })); } catch { /* ressource facultative */ }
    }));
    // Une nouvelle version prend la main sans attendre la fermeture des onglets : une
    // coquille ancienne ne doit jamais servir un site nouveau.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((nom) => !nom.startsWith(VERSION)).map((nom) => caches.delete(nom)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting' || event.data?.type === 'skip-waiting') self.skipWaiting();
  if (event.data?.type === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION });
  }
});

/* ------------------------------------------------------------------ conduites */

async function reseauSeulement(request, timeout = TIMEOUT_RESEAU) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), timeout);
  try {
    return await fetch(request, { signal: controleur.signal, cache: 'no-store' });
  } finally {
    clearTimeout(minuterie);
  }
}

/** Version du logiciel que ce worker connaît, sans le préfixe de ses caches. */
const VERSION_LOGICIEL = VERSION.replace(/^streamtv-v/, '');

/**
 * Une page neuve demande ses modules avec la version en clair : js/app.js?v=3.17.0.
 * Si la version demandée n'est pas celle que ce worker garde, sa copie est plus ancienne que
 * la page : la servir reproduirait exactement le défaut réparé ici. Dans ce cas, le réseau
 * passe devant, et le cache ne sert qu'en secours quand il n'y a plus de réseau du tout.
 */
function versionEtrangere(url) {
  let demandee;
  try {
    demandee = new URL(url, PORTEE).searchParams.get('v');
  } catch {
    return false;
  }
  return Boolean(demandee) && demandee !== VERSION_LOGICIEL;
}

async function cacheDAbord(request, nomCache) {
  const cache = await caches.open(nomCache);
  const perimee = versionEtrangere(request.url);
  // ignoreSearch : la coquille est mise en cache sans version, la page la demande avec.
  const garde = perimee ? null : await cache.match(request, { ignoreSearch: true });
  if (garde) {
    // Rafraîchissement silencieux : la copie servie reste utilisable même hors ligne.
    fetch(request).then((reponse) => {
      if (reponse && reponse.ok) cache.put(request, reponse.clone()).catch(() => {});
    }).catch(() => {});
    return garde;
  }
  let reponse;
  try {
    reponse = await fetch(request);
  } catch (erreur) {
    if (!perimee) throw erreur;
    // Sans réseau, une copie ancienne vaut mieux qu'une page vide : elle reste utilisable.
    const secours = await cache.match(request, { ignoreSearch: true });
    if (secours) return secours;
    throw erreur;
  }
  if (reponse && reponse.ok && !perimee) cache.put(request, reponse.clone()).catch(() => {});
  return reponse;
}

/* ------------------------------------------------------------------ interception */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const strategie = strategiePour(request.url);
  if (strategie === 'externe' || strategie === 'direct') return;

  if (strategie === 'reseau') {
    event.respondWith((async () => {
      // Les appels authentifiés de la console ne passent jamais par le worker.
      if (request.headers.has('Authorization')) return fetch(request);
      try {
        return await reseauSeulement(request);
      } catch {
        if (request.mode === 'navigate') {
          const coquille = await caches.match(new URL('offline.html', PORTEE).toString());
          if (coquille) return coquille;
        }
        const message = cheminLocal(request.url).startsWith('/demo/')
          ? 'Les données du catalogue ne sont pas arrivées. Vérifiez la connexion, puis rechargez.'
          : 'Vous êtes hors ligne. Le catalogue réapparaîtra dès le retour du réseau.';
        return new Response(JSON.stringify({ error: message, code: 'P-09', requestId: 'sw-reseau' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_COQUILLE);
        const coquille = await cache.match(new URL('', PORTEE).toString());
        if (coquille) return coquille;
        const horsLigne = await cache.match(new URL('offline.html', PORTEE).toString());
        if (horsLigne) return horsLigne;
        return new Response('Vous êtes hors ligne.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith(cacheDAbord(request, CACHE_FICHIERS).catch(async () => {
    const garde = await caches.match(request, { ignoreSearch: true });
    return garde || new Response('', { status: 504, statusText: 'Hors ligne' });
  }));
});
