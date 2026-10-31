// tests/coquille.test.js — sortie de secours de la page (3.16.0).
// Un écran prisonnier de son chargement a coûté une soirée : ces tests tiennent les deux
// garde-fous qui l'empêchent de revenir. La coquille compare les versions et nettoie ce qui
// vient d'une autre ; le plafond d'amorçage rend la main au bout de quinze secondes.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';
import vm from 'node:vm';

import { ROOT } from './helpers.js';
import { PLAFOND_AMORCAGE, avecPlafond } from '../public/js/amorcage.js';

const attendre = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exécute la coquille dans un faux navigateur, avec les compteurs utiles :
 * désenregistrements, caches supprimés, rechargements, version mémorisée.
 */
async function jouerCoquille({ versionPage = '3.16.0', memoire = '3.15.0', enregistrements = 1, caches = 2, stockageKo = false } = {}) {
  const source = await fsp.readFile(path.join(ROOT, 'public', 'js', 'coquille.js'), 'utf8');
  const trace = { desenregistres: 0, cachesSupprimes: [], rechargements: 0, memoire: memoire };
  const stockage = {
    getItem: () => {
      if (stockageKo) throw new Error('stockage refusé');
      return trace.memoire;
    },
    setItem: (_cle, valeur) => { trace.memoire = valeur; },
  };
  const enregistrement = { unregister: async () => { trace.desenregistres += 1; return true; } };
  const fenetre = {
    localStorage: stockage,
    location: { reload: () => { trace.rechargements += 1; } },
    caches: {
      keys: async () => Array.from({ length: caches }, (_vide, index) => `streamtv-v3.15.0-${index}`),
      delete: async (nom) => { trace.cachesSupprimes.push(nom); return true; },
    },
  };
  const bac = {
    window: fenetre,
    document: {
      querySelector: (selecteur) => (selecteur === 'meta[name="streamtv-version"]' && versionPage
        ? { getAttribute: () => versionPage }
        : null),
    },
    navigator: {
      serviceWorker: {
        getRegistrations: async () => Array.from({ length: enregistrements }, () => enregistrement),
      },
    },
    Promise, setTimeout, clearTimeout, console,
  };
  bac.window.caches = fenetre.caches;
  vm.runInNewContext(source, bac, { filename: 'coquille.js' });
  await attendre(30);
  return trace;
}

describe('Coquille : une page neuve ne tourne jamais avec du vieux code', () => {
  test('même version : rien n’est touché, rien n’est rechargé', async () => {
    const trace = await jouerCoquille({ versionPage: '3.16.0', memoire: '3.16.0' });
    assert.equal(trace.desenregistres, 0);
    assert.deepEqual(trace.cachesSupprimes, []);
    assert.equal(trace.rechargements, 0);
  });

  test('version différente : workers retirés, caches supprimés, une seule recharge', async () => {
    const trace = await jouerCoquille({ versionPage: '3.16.0', memoire: '3.15.0', enregistrements: 2, caches: 3 });
    assert.equal(trace.desenregistres, 2, 'chaque worker enregistré est retiré');
    assert.equal(trace.cachesSupprimes.length, 3, 'chaque cache est supprimé');
    assert.equal(trace.rechargements, 1, 'une seule recharge, jamais une boucle');
    assert.equal(trace.memoire, '3.16.0', 'la nouvelle version est mémorisée');
  });

  test('première visite : aucune recharge inutile', async () => {
    const trace = await jouerCoquille({ versionPage: '3.16.0', memoire: null, enregistrements: 0, caches: 0 });
    assert.equal(trace.rechargements, 0);
    assert.equal(trace.desenregistres, 0);
    assert.equal(trace.memoire, '3.16.0');
  });

  test('stockage refusé ou page sans version : la coquille se tait', async () => {
    const refuse = await jouerCoquille({ stockageKo: true, memoire: '3.15.0' });
    assert.equal(refuse.rechargements, 0);
    assert.equal(refuse.desenregistres, 0);
    const sansVersion = await jouerCoquille({ versionPage: '', memoire: '3.15.0' });
    assert.equal(sansVersion.rechargements, 0);
  });

  test('après nettoyage et recharge, la seconde visite ne boucle pas', async () => {
    const premiere = await jouerCoquille({ versionPage: '3.16.0', memoire: '3.15.0' });
    assert.equal(premiere.rechargements, 1);
    // La page rechargée relit la mémoire : elle est à la bonne version, donc elle s'arrête là.
    const seconde = await jouerCoquille({ versionPage: '3.16.0', memoire: premiere.memoire });
    assert.equal(seconde.rechargements, 0);
    assert.equal(seconde.desenregistres, 0);
  });
});

describe('Amorçage : une attente a toujours une fin', () => {
  test('le plafond vaut quinze secondes', () => {
    assert.equal(PLAFOND_AMORCAGE, 15_000);
  });

  test('un travail rapide rend sa valeur', async () => {
    assert.equal(await avecPlafond(Promise.resolve('pret'), { ms: 1000 }), 'pret');
  });

  test('un échec est propagé, jamais transformé en attente', async () => {
    await assert.rejects(() => avecPlafond(Promise.reject(new Error('panne')), { ms: 1000 }), /panne/);
  });

  test('un travail trop lent rend la main au plafond', async () => {
    const debut = Date.now();
    const issue = await avecPlafond(new Promise(() => {}), { ms: 60 });
    const duree = Date.now() - debut;
    assert.equal(issue, 'depasse');
    assert.ok(duree >= 50 && duree < 1000, `plafond respecté (${duree} ms)`);
  });

  test('une valeur de dépassement peut être un objet, pour distinguer les cas', async () => {
    const secours = { secours: true };
    assert.deepEqual(await avecPlafond(new Promise(() => {}), { ms: 30, valeurDeDepassement: secours }), secours);
  });

  test('un travail qui répond après le plafond ne change plus rien', async () => {
    let tardif;
    const travail = new Promise((resolve) => { tardif = resolve; });
    const issue = await avecPlafond(travail, { ms: 30 });
    tardif('trop tard');
    await attendre(20);
    assert.equal(issue, 'depasse');
  });
});
