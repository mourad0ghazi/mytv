// tests/conformite.test.js — règles transverses du cahier des charges (§3, §4, §13, §11-L).
// Ces vérifications protègent la livraison : aucune ligne ne doit dériver sans qu'un test le dise.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';
import { promisify } from 'node:util';

import { CATEGORIES, CATEGORY_IDS, LIMITS, VERSION } from '../server/core/constants.js';
import { ERRORS, errorMessage } from '../server/core/errors.js';
import { DEFAULTS, SCHEMA, SETTING_COUNT } from '../server/core/settings.js';
import { ROOT } from './helpers.js';

const run = promisify(execFile);

async function listFiles(dir, filter = () => true) {
  const out = [];
  for (const entry of await fsp.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'data', 'backups'].includes(entry.name)) continue;
      out.push(...await listFiles(relative, filter));
    } else if (filter(relative)) {
      out.push(relative);
    }
  }
  return out;
}

const sources = async () => [
  ...await listFiles('server', (file) => file.endsWith('.js')),
  ...await listFiles('public', (file) => file.endsWith('.js') && !file.includes('vendor')),
  ...await listFiles('scripts', (file) => file.endsWith('.js')),
  ...await listFiles('tests', (file) => file.endsWith('.js')),
];

describe('Règles de code (§3, §13)', () => {
  test('aucun fichier source ne dépasse 900 lignes', async () => {
    const offenders = [];
    for (const file of await sources()) {
      const content = await fsp.readFile(path.join(ROOT, file), 'utf8');
      const lines = content.split('\n').length;
      if (lines > 900) offenders.push(`${file} (${lines})`);
    }
    assert.deepEqual(offenders, []);
  });

  test('aucun TODO, FIXME, XXX ni console.log en production', async () => {
    const markers = new RegExp(`\\b(${['TO', 'DO'].join('')}|${['FIX', 'ME'].join('')}|XXX|HACK)\\b`);
    const logging = new RegExp(`console\\.(log|debug|info)\\(`);
    const offenders = [];
    for (const file of await sources()) {
      if (file === 'tests/conformite.test.js') continue; // ce test décrit les marqueurs qu'il traque
      const content = await fsp.readFile(path.join(ROOT, file), 'utf8');
      if (markers.test(content)) offenders.push(`${file} : marqueur de travail`);
      if (logging.test(content)) offenders.push(`${file} : console.log`);
    }
    assert.deepEqual(offenders, []);
  });

  test('aucun catch vide et aucune écriture non atomique', async () => {
    const emptyCatch = [];
    for (const file of await sources()) {
      const content = await fsp.readFile(path.join(ROOT, file), 'utf8');
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(content)) emptyCatch.push(file);
      if (/fs\.writeFile(Sync)?\(/.test(content) && !/writeAtomic|\.tmp/.test(content)) emptyCatch.push(`${file} : writeFile direct`);
    }
    assert.deepEqual(emptyCatch, []);
    const store = await fsp.readFile(path.join(ROOT, 'server/core/store.js'), 'utf8');
    assert.match(store, /writeAtomic|\.tmp/);
    assert.match(store, /fsync|sync\(/);
    assert.match(store, /rename\(/);
  });

  test('tous les fichiers JavaScript sont syntaxiquement valides', async () => {
    for (const file of await sources()) {
      await run(process.execPath, ['--check', path.join(ROOT, file)]);
    }
  });

  test('zéro dépendance : package.json vide, aucun import externe', async () => {
    const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies || {}, {});
    assert.deepEqual(pkg.devDependencies || {}, {});
    assert.match(pkg.engines.node, />=20/);
    for (const file of await sources()) {
      const content = await fsp.readFile(path.join(ROOT, file), 'utf8');
      for (const match of content.matchAll(/from\s+'([^']+)'/g)) {
        const target = match[1];
        assert.ok(target.startsWith('node:') || target.startsWith('.') || target.startsWith('/'),
          `${file} importe un paquet externe : ${target}`);
      }
    }
  });
});

/** Le schéma sert l'interface : chaque entrée doit porter un type, un libellé et une aide. */
function depthUiSchema(schema) {
  return Object.values(schema).filter((item) => item.key && item.type && item.label && item.help).length;
}

describe('Contrat de données (§4)', () => {
  test('18 catégories françaises, identifiants stables', () => {
    assert.equal(CATEGORIES.length, 18);
    assert.deepEqual(CATEGORY_IDS, CATEGORIES.map((category) => category.id));
    for (const category of CATEGORIES) {
      assert.match(category.id, /^[a-z]+$/);
      assert.ok(category.label.length > 2, `${category.id} sans libellé`);
      assert.equal(/[a-z]/.test(category.label), true);
    }
    assert.ok(CATEGORY_IDS.includes('autre'));
  });

  test('20 codes d’erreur, textes français exacts du §6.3', () => {
    assert.equal(Object.keys(ERRORS).length, 20);
    const expected = {
      'ERR-01': [400, 'Le formulaire est incomplet ou mal formé. Réessayez.'],
      'ERR-02': [400, 'Le champ « {champ} » est obligatoire.'],
      'ERR-03': [400, '« {champ} » doit être compris entre {min} et {max}.'],
      'ERR-04': [400, '« {champ} » n’a pas le bon format.'],
      'ERR-05': [400, 'Ce fichier n’est pas une liste M3U : aucune chaîne n’a été trouvée.'],
      'ERR-06': [400, 'La requête a été refusée : données illisibles.'],
      'ERR-07': [401, 'Votre session a expiré. Reconnectez-vous.'],
      'ERR-08': [401, 'Mot de passe incorrect.'],
      'ERR-09': [403, 'Cette action n’est pas autorisée.'],
      'ERR-10': [404, 'Chaîne introuvable.'],
      'ERR-11': [404, 'Cette adresse n’existe pas.'],
      'ERR-12': [405, 'Action non autorisée sur cette adresse.'],
      'ERR-13': [409, 'Une importation est déjà en cours. Patientez.'],
      'ERR-14': [409, 'Cette chaîne existe déjà dans le catalogue.'],
      'ERR-15': [413, 'Fichier trop volumineux (maximum {max}).'],
      'ERR-16': [422, 'Impossible d’appliquer : {raison}.'],
      'ERR-17': [429, 'Trop de tentatives. Réessayez dans {n} minutes.'],
      'ERR-18': [500, 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code {requestId}.'],
      'ERR-19': [503, 'Le service est momentanément indisponible. Retour prévu : {heure}.'],
      'ERR-20': [504, 'La source n’a pas répondu à temps. Réessayez plus tard.'],
    };
    for (const [code, [status, message]] of Object.entries(expected)) {
      assert.equal(ERRORS[code].status, status, `${code} : statut`);
      assert.equal(ERRORS[code].message, message, `${code} : texte`);
    }
    assert.equal(errorMessage('ERR-02', { champ: 'nom' }), 'Le champ « nom » est obligatoire.');
    assert.equal(errorMessage('ERR-17', { n: 3 }), 'Trop de tentatives. Réessayez dans 3 minutes.');
    assert.equal(errorMessage('ERR-16', { raison: 'test' }), 'Impossible d’appliquer : test.');
  });

  test('réglages détenus par une seule source de vérité, schéma complet, bornes documentées', () => {
    assert.equal(SETTING_COUNT, 24);
    assert.equal(Object.keys(DEFAULTS).length, SETTING_COUNT);
    assert.equal(SCHEMA.length, SETTING_COUNT);
    const keys = new Set(SCHEMA.map((item) => item.key));
    for (const key of Object.keys(DEFAULTS)) assert.ok(keys.has(key), `schéma sans ${key}`);
    for (const item of SCHEMA) {
      assert.ok(Number.isInteger(item.maxLength) && item.maxLength > 0, `maxLength manquant sur ${item.key}`);
    }
    const schema = Object.fromEntries(SCHEMA.map((item) => [item.key, item]));
    assert.equal(schema.pageSize.min, 12);
    assert.equal(schema.pageSize.max, 60);
    assert.equal(schema.featuredIds.max, 8);
    assert.equal(schema.vodGenreRowsMax.min, 1);
    assert.equal(schema.vodGenreRowsMax.max, 12);
    assert.equal(schema.sourceRetryBudget.min, 1);
    assert.equal(schema.sourceRetryBudget.max, 5);
    assert.equal(DEFAULTS.accent, '#ff3d71');
    assert.equal(DEFAULTS.pageSize, 48);
    assert.equal(DEFAULTS.confidenceFloor, 0.45);
    assert.equal(DEFAULTS.targetTable, 0);
    assert.equal(DEFAULTS.vodEnabled, true);
    assert.equal(DEFAULTS.vodGenreRowsMax, 6);
    assert.equal(DEFAULTS.sourceRetryBudget, 3);
    assert.equal(depthUiSchema(schema), SETTING_COUNT);
  });

  test('limites techniques conformes au cahier des charges', async () => {
    assert.equal(LIMITS.pageSizeMax, 60);
    assert.equal(LIMITS.domCardsMax, 120);
    assert.equal(LIMITS.probeConcurrency, 8);
    assert.equal(LIMITS.probeTimeoutMs, 6000);
    assert.equal(LIMITS.downAfterFailures, 3);
    assert.equal(LIMITS.backupDaily, 7);
    assert.equal(LIMITS.backupWeekly, 4);
    assert.equal(LIMITS.importMaxMs, 120000);
    const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(VERSION, pkg.version, 'la version du serveur est celle de package.json');
  });

  test('une seule version partout : serveur, page, worker', async () => {
    const page = await fsp.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const meta = page.match(/<meta name="streamtv-version" content="([^"]+)">/);
    assert.ok(meta, 'la page déclare sa version');
    assert.equal(meta[1], VERSION, 'la page et le serveur annoncent la même version');
    const worker = await fsp.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
    const versionWorker = worker.match(/const VERSION = 'streamtv-v([\d.]+)';/);
    assert.ok(versionWorker, 'le worker déclare sa version');
    assert.equal(versionWorker[1], VERSION, 'le worker et le serveur annoncent la même version');
    assert.match(worker, /js\/coquille\.js/, 'la coquille est mise en cache avec le site');
  });
});

describe('Livraison documentaire (§11-L, AC-111/115/116/117)', () => {
  test('les documents d’exploitation existent et sont substantiels', async () => {
    const docs = {
      'README.md': 3000,
      'RUNBOOK.md': 3000,
      'CONFORMITE.md': 3000,
      'CHANGELOG.md': 500,
      'SOURCES.md': 800,
      'docs/PV-RECETTE.md': 2000,
    };
    for (const [file, minimum] of Object.entries(docs)) {
      const content = await fsp.readFile(path.join(ROOT, file), 'utf8');
      assert.ok(content.length >= minimum, `${file} : ${content.length} caractères (minimum ${minimum})`);
      assert.equal(/\bTODO\b|\bà définir\b|\bà compléter\b/i.test(content), false, `${file} contient un marqueur de travail`);
    }
  });

  test('README : démarrage sans installation, portée et limites explicites', async () => {
    const readme = await fsp.readFile(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /node server\/index\.js/);
    assert.match(readme, /npm test/);
    assert.match(readme, /Node\.js 20/);
    assert.match(readme, /zéro dépendance|aucune dépendance/i);
  });

  test('CONFORMITE.md couvre les 118 critères', async () => {
    const conformite = await fsp.readFile(path.join(ROOT, 'CONFORMITE.md'), 'utf8');
    for (let index = 1; index <= 118; index += 1) {
      const id = `AC-${String(index).padStart(3, '0')}`;
      assert.ok(conformite.includes(id), `${id} absent du tableau de conformité`);
    }
  });

  test('le procès-verbal cite les preuves et laisse les réserves visibles', async () => {
    const pv = await fsp.readFile(path.join(ROOT, 'docs/PV-RECETTE.md'), 'utf8');
    assert.match(pv, /npm test/);
    assert.match(pv, /Réserves|réserve/i);
    assert.match(pv, /Date/);
  });
});
