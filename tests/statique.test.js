// tests/statique.test.js — le site publié (3.15.0).
// Un écran resté sur « Recherche en cours » a montré que le chemin des données pouvait se
// rompre sans que rien ne le dise. Ces tests tiennent les trois promesses qui l'empêchent :
// le worker ne sert jamais de données depuis un cache, l'attente a une fin, et un échec
// s'oublie pour qu'un nouvel essai redemande vraiment le fichier.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

import { ROOT } from './helpers.js';

/**
 * Page publiée minimale : une balise <base> comme celle du site, et une origine.
 * Sans elle, la couche de lecture ne saurait pas dans quel sous-dossier elle est publiée.
 */
function preparerNavigateur(dossier = '/myiptv/') {
  globalThis.document = {
    querySelector: (selecteur) => (selecteur === 'base' ? { href: `https://exemple.test${dossier}` } : null),
    addEventListener() {},
  };
  globalThis.location = { href: `https://exemple.test${dossier}`, origin: 'https://exemple.test' };
}

preparerNavigateur();

/** Le service worker, évalué hors navigateur avec une portée de publication réaliste. */
async function chargerWorker(portee = 'https://exemple.test/myiptv/') {
  const source = await fsp.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const ecouteurs = [];
  const bac = {
    URL, Headers, Request, Response, AbortController,
    Promise, setTimeout, clearTimeout, console,
    fetch: async () => new Response('{}', { status: 200 }),
    caches: {
      open: async () => ({ add: async () => {}, match: async () => undefined, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    self: {
      registration: { scope: portee },
      addEventListener: (type) => ecouteurs.push(type),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };
  bac.self.self = bac.self;
  vm.runInNewContext(source, bac, { filename: 'sw.js' });
  return { worker: bac.self.__streamtvSw, ecouteurs };
}

/** Écrit le modèle de couche de lecture à côté d'une copie de base.js, puis l'importe. */
async function chargerApi({ version = '3.15.0' } = {}) {
  const dossier = await fsp.mkdtemp(path.join(os.tmpdir(), 'streamtv-statique-'));
  await fsp.mkdir(path.join(dossier, 'js'), { recursive: true });
  await fsp.copyFile(path.join(ROOT, 'public', 'js', 'base.js'), path.join(dossier, 'js', 'base.js'));
  const modele = await fsp.readFile(path.join(ROOT, 'scripts', 'templates', 'demo-api.js'), 'utf8');
  const fichier = path.join(dossier, 'js', 'api.js');
  await fsp.writeFile(fichier, modele.replaceAll('__BUILD_VERSION__', version));
  const module = await import(`${pathToFileURL(fichier).href}?cas=${Math.random().toString(36).slice(2)}`);
  return { module, dossier };
}

describe('Site publié : conduite du service worker', () => {
  test('les données de démonstration ne sont jamais servies depuis un cache', async () => {
    const { worker } = await chargerWorker();
    for (const adresse of [
      'https://exemple.test/myiptv/demo/cards.json?v=3.15.0',
      'https://exemple.test/myiptv/demo/catalog.json?v=3.15.0',
      'https://exemple.test/myiptv/demo/config.json?v=3.15.0',
    ]) {
      assert.equal(worker.strategiePour(adresse), 'reseau', `${adresse} doit venir du réseau`);
    }
  });

  test('l’API du serveur reste hors du cache et hors de portée du worker', async () => {
    const { worker } = await chargerWorker();
    assert.equal(worker.strategiePour('https://exemple.test/api/channels'), 'reseau');
    assert.equal(worker.strategiePour('https://exemple.test/myiptv/api/admin/audit'), 'reseau');
  });

  test('les fichiers du site viennent du cache, les autres origines ne sont pas touchées', async () => {
    const { worker } = await chargerWorker();
    assert.equal(worker.strategiePour('https://exemple.test/myiptv/js/views/home.js'), 'fichier');
    assert.equal(worker.strategiePour('https://exemple.test/myiptv/css/app.css'), 'fichier');
    assert.equal(worker.strategiePour('https://exemple.test/myiptv/icons/icon-192.svg'), 'fichier');
    assert.equal(worker.strategiePour('https://i.imgur.com/V6Kaqha.png'), 'externe');
    assert.equal(worker.strategiePour('https://exemple.test/myiptv/chaine/abc'), 'direct');
  });

  test('la portée de publication est lue, pas devinée', async () => {
    const racine = await chargerWorker('https://exemple.test/');
    assert.equal(racine.worker.cheminLocal('https://exemple.test/demo/cards.json'), '/demo/cards.json');
    assert.equal(racine.worker.strategiePour('https://exemple.test/demo/cards.json'), 'reseau');
    const sousDossier = await chargerWorker('https://exemple.test/myiptv/');
    assert.equal(sousDossier.worker.cheminLocal('https://exemple.test/myiptv/demo/cards.json'), '/demo/cards.json');
    assert.equal(sousDossier.worker.strategiePour('https://exemple.test/myiptv/js/app.js'), 'fichier');
  });

  test('le worker prend la main sans attendre et s’installe', async () => {
    const { ecouteurs } = await chargerWorker();
    assert.ok(ecouteurs.includes('install'));
    assert.ok(ecouteurs.includes('activate'));
    assert.ok(ecouteurs.includes('fetch'));
    const source = await fsp.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
    assert.match(source, /skipWaiting\(\)/, 'une version en attente doit prendre la main');
    assert.match(source, /version/, 'la version doit être lisible');
  });
});

describe('Site publié : attente des données', () => {
  test('une donnée qui n’arrive pas s’arrête au lieu d’attendre sans fin', async () => {
    globalThis.STREAMTV_DELAI_DONNEES = 150;
    preparerNavigateur();
    let appels = 0;
    // Le pire cas réel : le réseau ne répond pas, seul le signal d'abandon le débloque.
    globalThis.fetch = (_adresse, options) => {
      appels += 1;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const erreur = new Error('abandon');
          erreur.name = 'AbortError';
          reject(erreur);
        });
      });
    };
    const { module } = await chargerApi();
    const debut = Date.now();
    await assert.rejects(
      () => module.api('/api/channels?pageSize=48'),
      (error) => {
        assert.equal(error.code, 'P-09');
        assert.match(error.message, /trop de temps/);
        assert.match(error.message, /Réessayer/);
        return true;
      },
    );
    const duree = Date.now() - debut;
    assert.ok(duree < 3000, `l’attente doit être bornée, elle a duré ${duree} ms`);
    assert.equal(appels, 1);
    delete globalThis.STREAMTV_DELAI_DONNEES;
  });

  test('un échec ne condamne pas l’essai suivant', async () => {
    globalThis.STREAMTV_DELAI_DONNEES = 100;
    preparerNavigateur();
    const corps = {
      cards: [
        { card: { id: 'a', number: 1, name: 'Une', category: 'info', categoryLabel: 'Info' }, hay: 'une info' },
      ],
      catalog: [],
    };
    let mode = 'panne';
    globalThis.fetch = async (adresse) => {
      if (mode === 'panne') throw new Error('réseau coupé');
      const fichier = String(adresse).includes('cards') ? corps.cards : corps.catalog;
      return new Response(JSON.stringify(fichier), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const { module } = await chargerApi();
    await assert.rejects(() => module.api('/api/channels?pageSize=48'), /connexion/i);
    mode = 'marche';
    const page = await module.api('/api/channels?pageSize=48');
    assert.equal(page.total, 1, 'le second essai redemande vraiment le fichier');
    assert.equal(page.channels[0].name, 'Une');
    delete globalThis.STREAMTV_DELAI_DONNEES;
  });

  test('l’adresse des données porte la version de la publication', async () => {
    preparerNavigateur();
    const vues = [];
    globalThis.fetch = async (adresse) => {
      vues.push(String(adresse));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const { module } = await chargerApi({ version: '9.9.9' });
    await module.api('/api/channels?pageSize=48');
    assert.equal(vues.length, 1);
    assert.match(vues[0], /demo\/cards\.json\?v=9\.9\.9$/);
    // Une adresse relative à la racine du site : le navigateur y ajoute l'origine lui-même.
    assert.equal(vues[0].startsWith('/myiptv/demo/'), true, `sous-dossier respecté : ${vues[0]}`);
  });

  test('un JSON tronqué est dit incomplet, jamais présenté comme un catalogue vide', async () => {
    preparerNavigateur();
    globalThis.fetch = async () => new Response('[{"card":', { status: 200 });
    const { module } = await chargerApi();
    await assert.rejects(() => module.api('/api/channels?pageSize=48'), /incomplet/);
  });
});

describe('Site publié : fichiers livrés', () => {
  test('les cartes sont publiées à part et pèsent moins que le catalogue complet', async () => {
    const carte = path.join(ROOT, 'demo', 'cards.json');
    const complet = path.join(ROOT, 'demo', 'catalog.json');
    const [tailleCartes, tailleComplet] = await Promise.all([
      fsp.stat(carte).then((stat) => stat.size),
      fsp.stat(complet).then((stat) => stat.size),
    ]);
    assert.ok(tailleCartes < tailleComplet, 'le premier écran ne doit pas télécharger les détails');
    const cartes = JSON.parse(await fsp.readFile(carte, 'utf8'));
    assert.ok(cartes.length >= 1000, `${cartes.length} cartes publiées`);
    assert.ok(cartes[0].card?.name, 'une carte porte un nom');
    assert.equal(cartes[0].detail, undefined, 'aucun détail dans le fichier du premier écran');
    assert.ok(cartes[0].hay, 'l’index de recherche accompagne la carte');
  });

  test('la couche de lecture publiée porte une version, pas le marqueur de construction', async () => {
    const api = await fsp.readFile(path.join(ROOT, 'js', 'api.js'), 'utf8');
    assert.equal(api.includes('__BUILD_VERSION__'), false);
    assert.match(api, /const PUBLICATION = '\d+\.\d+\.\d+'/);
    assert.match(api, /snapshot\('cards'\)/);
  });

  test('le worker publié n’est plus réécrit et lit sa portée', async () => {
    const publie = await fsp.readFile(path.join(ROOT, 'sw.js'), 'utf8');
    const source = await fsp.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
    assert.equal(publie, source, 'le fichier publié est le fichier source, sans réécriture');
  });
});

describe('Démonstration publiée : Anime, Films et Sources (3.18.0)', () => {
  test('la couche de lecture statique sert les trois catalogues et la recherche globale', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const name = new URL(String(url), 'https://exemple.test').pathname.split('/').pop();
      try {
        return new Response(await fsp.readFile(path.join(ROOT, 'demo', name), 'utf8'), { status: 200 });
      } catch {
        return new Response('{}', { status: 404 });
      }
    };
    try {
      const { api } = await import(`${pathToFileURL(path.join(ROOT, 'js', 'api.js')).href}?demo=${Date.now()}`);

      const anime = await api('/api/anime?pageSize=48');
      assert.ok(anime.total >= 7, `${anime.total} anime publiés`);
      assert.equal(anime.items.every((item) => Boolean(item.licence)), true);
      assert.ok(anime.rows.length >= 1, 'les rangées de sections sont servies');
      const fantaisie = await api('/api/anime?genre=Fantaisie');
      assert.ok(fantaisie.items.length >= 1);
      assert.equal(fantaisie.items.every((item) => item.genres.includes('Fantaisie')), true);

      const films = await api('/api/films?pageSize=48');
      assert.ok(films.total >= 6, `${films.total} films publiés`);
      assert.ok(films.byGenre.length <= 6, 'six rangées de genres au plus');
      assert.equal(films.rows.some((row) => row.id === 'recents'), true);

      const fiche = await api('/api/anime/morevna');
      assert.equal(fiche.anime.id, 'morevna');
      assert.ok(fiche.anime.episodes.length >= 1, 'les épisodes sont dans l’instantané');
      const film = await api('/api/films/charade');
      assert.equal(film.film.playable, true);
      await assert.rejects(api('/api/anime/inexistant'), (error) => error.status === 404);

      const sources = await api('/api/sources');
      assert.ok(sources.total >= 6);
      assert.equal(sources.sources.every((source) => Boolean(source.licence)), true);

      const recherche = await api('/api/search?q=charade&limit=36');
      assert.equal(recherche.results[0].kind, 'film');
      assert.equal(recherche.results[0].kindLabel, 'Film');
      const animeTrouve = await api('/api/search?q=morevna&limit=36');
      assert.equal(animeTrouve.results.some((result) => result.kind === 'anime'), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Racine de publication : les fichiers du site suivent <base> (3.18.0)', () => {
  test('withBase préfixe un chemin du site et laisse une adresse absolue intacte', async () => {
    const dossier = await fsp.mkdtemp(path.join(os.tmpdir(), 'streamtv-base-'));
    try {
      await fsp.copyFile(path.join(ROOT, 'public', 'js', 'base.js'), path.join(dossier, 'base.js'));
      globalThis.document = {
        querySelector: (selecteur) => (selecteur === 'base' ? { href: 'https://exemple.test/mytv/' } : null),
      };
      globalThis.location = { href: 'https://exemple.test/mytv/', origin: 'https://exemple.test' };
      const { withBase } = await import(`${pathToFileURL(path.join(dossier, 'base.js')).href}?cas=${Date.now()}`);
      assert.equal(withBase('/posters/anime-sintel.svg'), '/mytv/posters/anime-sintel.svg');
      assert.equal(withBase('/demo/anime.json'), '/mytv/demo/anime.json');
      assert.equal(withBase('https://exemple.test/logo.png'), 'https://exemple.test/logo.png');
      assert.equal(withBase('//cdn.exemple.test/x.png'), '//cdn.exemple.test/x.png');
    } finally {
      delete globalThis.document;
      delete globalThis.location;
      preparerNavigateur();
      await fsp.rm(dossier, { recursive: true, force: true });
    }
  });

  test('aucune affiche n’est posée à la racine du domaine', async () => {
    const modules = {
      'public/js/vod-ui.js': 'item',
      'public/js/views/anime.js': 'anime',
      'public/js/views/films.js': 'film',
      'public/js/views/search.js': 'result',
      'public/js/ui.js': 'channel',
    };
    for (const [fichier, variable] of Object.entries(modules)) {
      const source = await fsp.readFile(path.join(ROOT, fichier), 'utf8');
      const ligne = source.split('\n').find((ligneSource) => ligneSource.includes('withBase')
        && ligneSource.includes('base.js'));
      assert.ok(ligne, `${fichier} n’importe pas withBase depuis base.js`);
      const nus = [...source.matchAll(new RegExp(`src:\\s*${variable}\\.(?:poster|logo)\\b`, 'g'))];
      assert.deepEqual(nus.map((m) => m[0]), [], `${fichier} sert une image sans racine de publication`);
    }
  });

  test('la démonstration publiée garde ses affiches sous /mytv/', async () => {
    const anime = JSON.parse(await fsp.readFile(path.join(ROOT, 'demo', 'anime.json'), 'utf8'));
    const films = JSON.parse(await fsp.readFile(path.join(ROOT, 'demo', 'films.json'), 'utf8'));
    const affiches = [...anime.items, ...films.items].map((item) => item.poster).filter(Boolean);
    assert.ok(affiches.length >= 10, `${affiches.length} affiches`);
    for (const affiche of affiches) {
      assert.match(affiche, /^\/posters\/[\w-]+\.svg$/, `affiche hors du dossier livré : ${affiche}`);
      await fsp.access(path.join(ROOT, 'public', affiche.replace(/^\//, '')));
    }
  });
});
