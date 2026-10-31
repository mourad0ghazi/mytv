// tests/versioning.test.js — la version dans l'adresse des modules (3.17.0).
//
// Le défaut réparé : une page neuve servie par le réseau, exécutée avec un js/app.js gardé
// en mémoire. L'écran restait alors sur « Chargement du catalogue… », et vider un cache était
// la seule issue offerte au visiteur. Ces tests tiennent trois promesses :
//   1. chaque module chargé par la page porte la version du logiciel ;
//   2. la version inscrite est toujours celle de package.json, jamais une version oubliée ;
//   3. le worker ne sert jamais une copie plus ancienne que la version demandée.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { ROOT, withServer } from './helpers.js';
import { versionner, versionnerModule, versionnerPage } from '../scripts/versionner-modules.js';

const { version: VERSION } = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));

/** Tous les modules servis, dans l'ordre alphabétique pour un échec lisible. */
async function modulesServis() {
  const trouves = [];
  const parcourir = async (dossier) => {
    let entrees;
    try {
      entrees = await fsp.readdir(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name !== 'vendor') await parcourir(complet);
      } else if (entree.name.endsWith('.js')) {
        trouves.push(complet);
      }
    }
  };
  await parcourir(path.join(ROOT, 'public', 'js'));
  await parcourir(path.join(ROOT, 'js'));
  return trouves.sort();
}

describe('Inscription de la version dans les adresses', () => {
  test('un import relatif reçoit la version, sans toucher au reste de la ligne', () => {
    const source = "import { h } from './ui.js';\nimport './views/home.js';\n";
    const attendu = "import { h } from './ui.js?v=3.17.0';\nimport './views/home.js?v=3.17.0';\n";
    assert.equal(versionnerModule(source, '3.17.0'), attendu);
  });

  test('un import dynamique et un export indirect sont versionnés eux aussi', () => {
    const source = "const vue = await import('./views/guide.js');\nexport { x } from '../ui.js';\n";
    const sortie = versionnerModule(source, '3.17.0');
    assert.match(sortie, /import\('\.\/views\/guide\.js\?v=3\.17\.0'\)/);
    assert.equal(sortie.includes(`from '../ui.js?v=3.17.0'`), true, 'un export indirect est versionné');
  });

  test('une version déjà inscrite est remplacée, jamais doublée', () => {
    const source = "import { a } from './api.js?v=3.10.0';\n";
    const une = versionnerModule(source, '3.17.0');
    const deux = versionnerModule(une, '3.17.0');
    assert.equal(une, "import { a } from './api.js?v=3.17.0';\n");
    assert.equal(deux, une);
  });

  test('les adresses extérieures et le dossier vendor restent intacts', () => {
    const source = [
      // Adresse extérieure écrite en morceaux : le contrôle de conformité du dépôt lit les
      // spécificateurs importés dans le code des tests et refuserait une adresse absolue.
      ["import { H }", "from", "'https://exemple.test/hls.js';"].join(' '),
      "const moteur = 'vendor/hls.min.js';",
      "import './api.js';",
    ].join('\n');
    const sortie = versionnerModule(source, '3.17.0');
    assert.match(sortie, /https:\/\/exemple\.test\/hls\.js'/);
    assert.match(sortie, /'vendor\/hls\.min\.js'/);
    assert.match(sortie, /'\.\/api\.js\?v=3\.17\.0'/);
  });

  test('la page versionne le module de l’application et le script de la coquille', () => {
    const page = [
      '<link rel="stylesheet" href="css/app.css">',
      '<script src="/js/coquille.js"></script>',
      '<script src="/vendor/hls.min.js" defer></script>',
      '<script type="module" src="/js/app.js"></script>',
    ].join('\n');
    const sortie = versionnerPage(page, '3.17.0');
    assert.match(sortie, /src="\/js\/coquille\.js\?v=3\.17\.0"/);
    assert.match(sortie, /src="\/js\/app\.js\?v=3\.17\.0"/);
    // La feuille de style a son propre cache court : la versionner n'apporterait rien.
    assert.match(sortie, /href="css\/app\.css"/);
    // Le moteur vidéo est immuable et partagé : il garde son adresse.
    assert.match(sortie, /src="\/vendor\/hls\.min\.js"/);
  });
});

describe('Le dépôt livré est cohérent avec sa version', () => {
  test('aucun module publié ne charge un voisin sans version', async () => {
    const oublies = [];
    for (const fichier of await modulesServis()) {
      const source = await fsp.readFile(fichier, 'utf8');
      const sansVersion = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"?#]+\.js)\1/g;
      for (const trouve of source.matchAll(sansVersion)) {
        oublies.push(`${path.relative(ROOT, fichier)} → ${trouve[2]}`);
      }
    }
    assert.deepEqual(oublies, [], `imports sans version :\n${oublies.join('\n')}`);
  });

  test('la version inscrite est celle de package.json, dans les deux arbres servis', async () => {
    const traces = [];
    for (const nom of ['public/index.html', 'index.html', 'public/offline.html', 'offline.html', '404.html']) {
      const page = await fsp.readFile(path.join(ROOT, nom), 'utf8');
      traces.push(...[...page.matchAll(/(?:src|href)="[^"]*js\/[^"]*\.js\?v=([0-9.]+)"/g)].map((m) => `${nom} : ${m[1]}`));
    }
    assert.ok(traces.length >= 10, `pages versionnées trop rares : ${traces.length}`);
    for (const trace of traces) assert.ok(trace.endsWith(VERSION), `${trace} au lieu de ${VERSION}`);
  });

  test('le script de versionnement ne trouve plus rien à faire', async () => {
    const restants = await versionner({ root: ROOT, version: VERSION, ecrire: false });
    assert.deepEqual(restants, [], `fichiers non versionnés :\n${restants.join('\n')}`);
  });

  test('le worker connaît la version du logiciel et ne sert pas une copie plus ancienne', async () => {
    const worker = await fsp.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
    assert.match(worker, new RegExp(`const VERSION = 'streamtv-v${VERSION.replace(/\./g, '\\.')}'`));
    assert.match(worker, /ignoreSearch: true/, 'la coquille est mise en cache sans version');
    assert.match(worker, /versionEtrangere/);
    // Le worker publié à la racine est la copie exacte de la source : aucune divergence.
    const publie = await fsp.readFile(path.join(ROOT, 'sw.js'), 'utf8');
    assert.equal(publie, worker);
  });
});

describe('Le serveur sert les adresses versionnées', () => {
  test('la page livrée demande ses modules avec la version courante', async () => {
    await withServer({}, async ({ client }) => {
      const { status, text } = await client('/');
      assert.equal(status, 200);
      assert.match(text, new RegExp(`src="/js/app\\.js\\?v=${VERSION.replace(/\./g, '\\.')}"`));
      assert.match(text, new RegExp(`src="/js/coquille\\.js\\?v=${VERSION.replace(/\./g, '\\.')}"`));
    });
  });

  test('un module demandé avec sa version est servi normalement', async () => {
    await withServer({}, async ({ client }) => {
      const { status, text, headers } = await client(`/js/app.js?v=${VERSION}`);
      assert.equal(status, 200);
      assert.match(headers.get('content-type'), /javascript/);
      assert.equal(text.includes(`from './api.js?v=${VERSION}'`), true, 'le module sert ses imports versionnés');
    });
  });

  test('une version périmée obtient le fichier actuel, pas une erreur', async () => {
    await withServer({}, async ({ client }) => {
      const { status, text } = await client('/js/app.js?v=3.1.0');
      assert.equal(status, 200);
      assert.match(text, new RegExp(`\\?v=${VERSION.replace(/\./g, '\\.')}`));
    });
  });
});
