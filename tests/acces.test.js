// tests/acces.test.js — liens d'accès à la console (3.13.0).
// Un lien porte le droit d'entrer : on vérifie sa création, son usage, son épuisement,
// sa révocation et le rôle qu'il accorde, sans jamais manipuler le jeton côté serveur.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import fsp from 'node:fs/promises';
import path from 'node:path';

import { startServer, tempDataDir, withServer } from './helpers.js';
import {
  TOKEN_LENGTH, clampMinutes, isLinkToken, linkDigest, linkUsable, newLinkToken, publicLink,
} from '../server/core/access-links.js';

const appareil = (n = 1) => String(n).padStart(2, '0').repeat(16);
const jetonDe = (lien) => lien.split('/acces/')[1];

describe('Liens d’accès : briques', () => {
  test('un jeton fait 64 caractères et ne se devine pas', () => {
    const jetons = new Set();
    for (let index = 0; index < 200; index += 1) {
      const jeton = newLinkToken();
      assert.equal(jeton.length, TOKEN_LENGTH);
      assert.equal(isLinkToken(jeton), true);
      jetons.add(jeton);
    }
    assert.equal(jetons.size, 200, 'aucune collision');
    assert.equal(isLinkToken('abc'), false);
    assert.equal(isLinkToken('z'.repeat(64)), false);
    assert.notEqual(linkDigest('a'.repeat(64)), linkDigest('b'.repeat(64)));
  });

  test('les bornes de durée sont appliquées', () => {
    assert.equal(clampMinutes(0), 60);
    assert.equal(clampMinutes('pas un nombre'), 60);
    assert.equal(clampMinutes(-5), 60);
    assert.equal(clampMinutes(1), 1);
    assert.equal(clampMinutes(1e9), 60 * 24 * 30);
  });

  test('un lien est utilisable tant qu’il n’est ni fermé, ni épuisé, ni expiré', () => {
    const base = {
      id: 'l-1', label: 'Test', role: 'editeur', uses: 0, maxUses: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: '',
    };
    assert.equal(linkUsable(base), true);
    assert.equal(linkUsable({ ...base, uses: 1 }), false, 'épuisé');
    assert.equal(linkUsable({ ...base, revokedAt: new Date().toISOString() }), false, 'révoqué');
    assert.equal(linkUsable({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }), false, 'expiré');
    const vue = publicLink({ ...base, uses: 1 });
    assert.equal(vue.state, 'epuise');
    assert.equal(vue.digest, undefined, 'aucune empreinte dans la vue publique');
  });
});

describe('Liens d’accès : API', () => {
  test('le propriétaire crée un lien, le jeton n’est rendu qu’une fois', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const creation = await client('/api/admin/access-links', {
        method: 'POST', token, body: { label: 'Téléphone de Mourad', role: 'administrateur', minutes: 60, maxUses: 2 },
      });
      assert.equal(creation.status, 200, creation.text);
      assert.match(creation.json.lien, /^http:\/\/127\.0\.0\.1:\d+\/acces\/[a-f0-9]{64}$/);
      assert.equal(creation.json.afficheUneFois, true);
      assert.equal(creation.json.link.state, 'actif');
      assert.equal(creation.json.link.label, 'Téléphone de Mourad');

      const liste = await client('/api/admin/access-links', { token });
      assert.equal(liste.status, 200);
      assert.equal(liste.json.links.length, 1);
      assert.equal(JSON.stringify(liste.json).includes(jetonDe(creation.json.lien)), false, 'le jeton ne ressort jamais');
      assert.equal(JSON.stringify(liste.json).includes('digest'), false, 'aucune empreinte non plus');
      assert.equal(liste.json.chemin, 'console-privee');
    });
  });

  test('le lien ouvre une session avec le rôle prévu, et s’épuise', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const creation = await client('/api/admin/access-links', {
        method: 'POST', token, body: { label: 'Éditeur invité', role: 'editeur', minutes: 30, maxUses: 1 },
      });
      const jeton = jetonDe(creation.json.lien);

      const entree = await client('/api/access/redeem', {
        method: 'POST', body: { token: jeton, deviceId: appareil(2) },
      });
      assert.equal(entree.status, 200, entree.text);
      assert.ok(entree.json.token);
      assert.equal(entree.json.role, 'editeur');
      assert.equal(entree.json.entry, '/console-privee');
      assert.equal(entree.json.lien.uses, 1);

      // Le rôle du lien est réellement appliqué par le serveur.
      const refus = await client('/api/admin/settings', { token: entree.json.token });
      assert.equal(refus.status, 403, 'un éditeur ne lit pas les réglages');
      const lecture = await client('/api/admin/channels', { token: entree.json.token });
      assert.equal(lecture.status, 200, 'mais il lit le catalogue');

      const second = await client('/api/access/redeem', { method: 'POST', body: { token: jeton } });
      assert.equal(second.status, 401, 'un lien à un usage ne sert qu’une fois');

      const liste = await client('/api/admin/access-links', { token });
      assert.equal(liste.json.links[0].state, 'epuise');
      assert.equal(liste.json.links[0].uses, 1);
    });
  });

  test('un lien révoqué ferme l’entrée immédiatement', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const creation = await client('/api/admin/access-links', {
        method: 'POST', token, body: { label: 'À fermer', role: 'analyste', maxUses: 5 },
      });
      const jeton = jetonDe(creation.json.lien);
      const avant = await client('/api/access/redeem', { method: 'POST', body: { token: jeton } });
      assert.equal(avant.status, 200);

      const liste = await client('/api/admin/access-links', { token });
      const id = liste.json.links[0].id;
      const revue = await client(`/api/admin/access-links/${id}`, { method: 'DELETE', token });
      assert.equal(revue.status, 200, revue.text);
      assert.equal(revue.json.link.state, 'revoque');

      const apres = await client('/api/access/redeem', { method: 'POST', body: { token: jeton } });
      assert.equal(apres.status, 401);
      const inconnu = await client('/api/admin/access-links/l-inconnu', { method: 'DELETE', token });
      assert.equal(inconnu.status, 404);
    });
  });

  test('un jeton inventé est refusé sans révéler l’existence des liens', async () => {
    await withServer({}, async ({ client }) => {
      const faux = await client('/api/access/redeem', { method: 'POST', body: { token: 'f'.repeat(64) } });
      assert.equal(faux.status, 401);
      assert.match(faux.json.error, /expiré ou a été révoqué/);
      const court = await client('/api/access/redeem', { method: 'POST', body: { token: 'abc' } });
      assert.equal(court.status, 401);
      assert.match(court.json.error, /pas valable/);
    });
  });

  test('seul le propriétaire gère les liens', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      await client('/api/admin/team', {
        method: 'POST', token,
        body: { name: 'Admin Test', email: 'admin2@example.com', role: 'administrateur', password: 'motdepasse-solide' },
      });
      const membre = await client('/api/login', {
        method: 'POST', body: { email: 'admin2@example.com', password: 'motdepasse-solide' },
      });
      assert.equal(membre.status, 200, membre.text);
      const liste = await client('/api/admin/access-links', { token: membre.json.token });
      assert.equal(liste.status, 403, 'un administrateur ne voit pas les liens');
      const creation = await client('/api/admin/access-links', {
        method: 'POST', token: membre.json.token, body: { role: 'editeur' },
      });
      assert.equal(creation.status, 403);
    });
  });

  test('un lien administrateur respecte le verrou d’appareil', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      await client('/api/admin/devices', { method: 'POST', token, body: { deviceId: appareil(1), label: 'Poste fixe' } });
      await client('/api/admin/settings', { method: 'PATCH', token, body: { adminDeviceLock: true } });
      const creation = await client('/api/admin/access-links', {
        method: 'POST', token, body: { label: 'Administrateur', role: 'administrateur', maxUses: 3 },
      });
      const jeton = jetonDe(creation.json.lien);
      const inconnu = await client('/api/access/redeem', {
        method: 'POST', body: { token: jeton, deviceId: appareil(7) },
      });
      assert.equal(inconnu.status, 403);
      assert.equal(inconnu.json.code, 'ERR-09');
      const connu = await client('/api/access/redeem', {
        method: 'POST', body: { token: jeton, deviceId: appareil(1) },
      });
      assert.equal(connu.status, 200, connu.text);

      // Un lien éditeur n'est pas concerné par le verrou, qui ne vise que l'administration.
      const invite = await client('/api/admin/access-links', {
        method: 'POST', token, body: { label: 'Invité', role: 'editeur', maxUses: 1 },
      });
      const entree = await client('/api/access/redeem', {
        method: 'POST', body: { token: jetonDe(invite.json.lien), deviceId: appareil(8) },
      });
      assert.equal(entree.status, 200);
    });
  });

  test('la page du lien est servie, et rien d’autre', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const creation = await client('/api/admin/access-links', { method: 'POST', token, body: { role: 'editeur' } });
      const chemin = new URL(creation.json.lien).pathname;
      const page = await client(chemin);
      assert.equal(page.status, 200);
      assert.match(page.text, /id="main"/);
      const incomplet = await client('/acces/abcdef');
      assert.equal(incomplet.status, 404);
    });
  });

  test('un lien expiré refuse l’entrée, même si son jeton est exact', async () => {
    const dir = await tempDataDir();
    const jeton = 'a1'.repeat(32);
    await fsp.writeFile(path.join(dir, 'access-links.json'), JSON.stringify({
      version: 1,
      links: [{
        id: 'l-expire', digest: linkDigest(jeton), label: 'Vieux lien', role: 'editeur', roleLabel: 'Éditeur',
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 3600_000).toISOString(),
        uses: 0, maxUses: 5, lastUsedAt: '', revokedAt: '',
      }],
    }), 'utf8');

    const serveur = await startServer({ dataDir: dir });
    try {
      const refus = await serveur.client('/api/access/redeem', { method: 'POST', body: { token: jeton } });
      assert.equal(refus.status, 401);
      assert.match(refus.json.error, /expiré ou a été révoqué/);
      const { token } = await serveur.login();
      const liste = await serveur.client('/api/admin/access-links', { token });
      assert.equal(liste.json.links[0].state, 'expire');
      assert.equal(liste.json.links[0].uses, 0);
    } finally {
      await serveur.stop();
    }
  });
});
