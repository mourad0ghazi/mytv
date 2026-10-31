// tests/journal.test.js · journal en phrases et premier lancement (3.14.0).
// Le journal doit parler français à l'écran sans jamais taire une action : on vérifie la
// traduction, sa fidélité au code technique, et l'état de premier lancement servi par l'API.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { ROOT } from './helpers.js';
import { describeAudit, describeAuditEntry, heureCourte, jourLisible } from '../server/core/journal.js';

/** Tous les codes réellement émis par le serveur, lus dans le code, pas dans une liste tenue à la main. */
async function codesEmis() {
  const codes = new Set();
  const racine = path.join(ROOT, 'server');
  const fichiers = [];
  const parcourir = async (dossier) => {
    for (const entree of await fsp.readdir(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) await parcourir(complet);
      else if (entree.name.endsWith('.js')) fichiers.push(complet);
    }
  };
  await parcourir(racine);
  for (const fichier of fichiers) {
    const texte = await fsp.readFile(fichier, 'utf8');
    for (const trouve of texte.matchAll(/audit\('([a-z.]+)'/g)) codes.add(trouve[1]);
  }
  return [...codes];
}
import { withServer } from './helpers.js';

describe('Journal : phrases', () => {
  test('chaque action connue devient une phrase, jamais un code', async () => {
    const actions = await codesEmis();
    assert.ok(actions.length >= 30, `le serveur émet ${actions.length} codes, tous doivent être couverts`);
    for (const action of actions) {
      const vue = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action, actor: 'Mourad' });
      assert.equal(vue.reconnu, true, `${action} doit être reconnu`);
      assert.ok(!vue.phrase.includes(action), `${action} ne doit pas rester un code brut`);
      assert.ok(vue.phrase.length > 8, `${action} doit faire une phrase`);
      assert.ok(/^[A-ZÀ-Ý]/.test(vue.phrase), `${action} doit commencer par une majuscule`);
      assert.ok(['info', 'warn', 'danger'].includes(vue.ton));
    }
  });

  test('une action inconnue est dite technique, jamais masquée', () => {
    const vue = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action: 'quelque.chose.de.neuf' });
    assert.equal(vue.reconnu, false);
    assert.match(vue.phrase, /Action technique/);
    assert.ok(vue.phrase.includes('quelque.chose.de.neuf'), 'le code reste visible pour le diagnostic');
  });

  test('les réglages sont nommés comme à l’écran', () => {
    const vue = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action: 'settings.update', detail: 'adminName,adminEmail' });
    assert.equal(vue.phrase, 'Réglages modifiés : nom du propriétaire, adresse du code');
    const partiel = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action: 'settings.update', detail: 'reglage.avenir' });
    assert.ok(partiel.phrase.includes('reglage.avenir'), 'un réglage non nommé garde sa clef');
  });

  test('les actions groupées disent le geste et le nombre', () => {
    const vue = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action: 'channel.bulk', count: 3, detail: 'hide' });
    assert.equal(vue.phrase, 'Action groupée sur 3 chaînes : masquer');
    const une = describeAuditEntry({ at: '2026-10-28T09:41:00Z', action: 'channel.bulk', count: 1, detail: 'delete' });
    assert.equal(une.phrase, 'Action groupée sur 1 chaîne : retirer');
  });

  test('un échec est signalé comme danger, une connexion réussie comme information', () => {
    assert.equal(describeAuditEntry({ action: 'login.fail' }).ton, 'danger');
    assert.equal(describeAuditEntry({ action: 'login.success' }).ton, 'info');
    assert.equal(describeAuditEntry({ action: 'channel.bulk' }).ton, 'warn');
  });

  test('le journal entier est traduit dans le même ordre', () => {
    const entrees = [
      { at: '2026-10-28T08:00:00Z', action: 'login.success' },
      { at: '2026-10-27T20:15:00Z', action: 'channel.delete', detail: 'beIN Sports 1' },
    ];
    const vues = describeAudit(entrees);
    assert.equal(vues.length, 2);
    assert.equal(vues[0].action, 'login.success');
    assert.equal(vues[1].action, 'channel.delete');
    assert.ok(vues[1].phrase.includes('beIN Sports 1'));
  });

  test('une entrée vide ne casse pas l’affichage', () => {
    const vue = describeAuditEntry({});
    assert.ok(vue.phrase.length > 0);
    assert.equal(vue.heure, '');
    assert.equal(describeAudit(null).length, 0);
  });

  test('les heures et les jours sont dits en français', () => {
    const maintenant = new Date();
    const iso = maintenant.toISOString();
    assert.match(heureCourte(iso), /^\d{2}:\d{2}$/);
    assert.equal(jourLisible(iso), 'Aujourd’hui');
    const hier = new Date(maintenant.getTime() - 24 * 3600 * 1000).toISOString();
    assert.equal(jourLisible(hier), 'Hier');
    assert.match(jourLisible('2026-01-05T10:00:00Z'), /^5 janvier( 2026)?$/);
    assert.equal(jourLisible('2019-03-09T10:00:00Z'), '9 mars 2019', 'une autre année se dit entière');
    assert.equal(jourLisible(''), '');
  });
});

describe('Premier lancement : API', () => {
  test('tant que le mot de passe de démonstration vit, le passage est obligatoire', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const etat = (await client('/api/admin/setup', { token })).json;
      assert.equal(etat.motDePasseParDefaut, true);
      assert.equal(etat.termine, false);
      assert.deepEqual(etat.restantes.sort(), ['identite', 'mot-de-passe']);
      const motDePasse = etat.etapes.find((etape) => etape.id === 'mot-de-passe');
      assert.equal(motDePasse.obligatoire, true);
      assert.match(motDePasse.aide, /démonstration/);
    });
  });

  test('le nom du propriétaire se pose et signe le journal', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const reponse = await client('/api/admin/setup/identity', {
        method: 'POST', token, body: { name: '  Mourad   El  ' },
      });
      assert.equal(reponse.status, 200, reponse.text);
      const apres = reponse.json;
      assert.equal(apres.nom, 'Mourad El');
      assert.equal(apres.etapes.find((etape) => etape.id === 'identite').fait, true);
      const journal = (await client('/api/admin/audit?lines=10', { token })).json;
      const entree = journal.entries[0];
      assert.equal(entree.action, 'settings.update');
      assert.match(entree.phrase, /nom du propriétaire/);
      assert.equal(entree.ton, 'info');
      assert.ok(Array.isArray(journal.resume));
    });
  });

  test('un nom vide ou trop court est refusé par le serveur, pas par l’écran', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const refus = await client('/api/admin/setup/identity', { method: 'POST', token, body: { name: ' ' } });
      assert.equal(refus.status, 400);
      assert.equal(refus.json.field, 'name');
      const apres = (await client('/api/admin/setup', { token })).json;
      assert.equal(apres.etapes.find((etape) => etape.id === 'identite').fait, false);
    });
  });

  test('après un mot de passe à soi, le passage n’est plus obligatoire', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const nom = await client('/api/admin/setup/identity', { method: 'POST', token, body: { name: 'Mourad' } });
      assert.equal(nom.status, 200, nom.text);
      const change = await client('/api/admin/password', {
        method: 'POST', token, body: { current: 'admin', next: 'Casa2026Stream!', confirm: 'Casa2026Stream!' },
      });
      assert.equal(change.status, 200, change.text);
      const reconnexion = await client('/api/login', { method: 'POST', body: { password: 'Casa2026Stream!' } });
      assert.equal(reconnexion.status, 200);
      const etat = (await client('/api/admin/setup', { token: reconnexion.json.token })).json;
      assert.equal(etat.motDePasseParDefaut, false);
      assert.equal(etat.termine, true);
      assert.deepEqual(etat.restantes, []);
      assert.match(etat.chemin, /^[a-z0-9-]{8,40}$/, 'le chemin secret est un slug, sans barre oblique');
    });
  });

  test('le journal complet reste lisible après plusieurs actions', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const nom = await client('/api/admin/setup/identity', { method: 'POST', token, body: { name: 'Mourad' } });
      assert.equal(nom.status, 200, nom.text);
      const appareil = await client('/api/admin/devices', {
        method: 'POST', token, body: { deviceId: '7f'.repeat(16), label: 'Téléphone de travail' },
      });
      assert.equal(appareil.status, 200, appareil.text);
      const journal = (await client('/api/admin/audit?lines=20', { token })).json;
      assert.ok(journal.entries.length >= 2);
      for (const entree of journal.entries) {
        assert.ok(entree.phrase && typeof entree.phrase === 'string');
        assert.ok(['info', 'warn', 'danger'].includes(entree.ton));
      }
    });
  });
});
