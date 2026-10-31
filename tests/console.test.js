// tests/console.test.js — console privée (3.11.0) : chemin secret, porte, appareils autorisés.
// Chaque test part d'un serveur neuf : aucun état ne fuit d'une suite à l'autre.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { withServer } from './helpers.js';

const appareil = (n = 1) => String(n).padStart(2, '0').repeat(16);

describe('Console privée', () => {
  test('le chemin secret sert le site et pose le cookie d’entrée', async () => {
    await withServer({}, async ({ client }) => {
      const page = await client('/console-privee');
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /text\/html/);
      assert.match(page.text, /id="main"/, 'la coquille du site est rendue');
      const cookie = page.headers.get('set-cookie') || '';
      assert.match(cookie, /stv_entry=1/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
    });
  });

  test('/admin ne mène nulle part : aucune page, aucun indice', async () => {
    await withServer({}, async ({ client }) => {
      for (const chemin of ['/admin', '/administration']) {
        const page = await client(chemin);
        assert.equal(page.status, 404, `${chemin} ne doit pas exister`);
        assert.equal(page.headers.get('set-cookie'), null, 'aucun cookie d’entrée offert');
      }
    });
  });

  test('la porte ne révèle le chemin qu’au navigateur déjà entré', async () => {
    await withServer({}, async ({ client }) => {
      const ferme = await client('/api/admin/gate');
      assert.equal(ferme.status, 200);
      assert.equal(ferme.json.admin, false);
      assert.equal(ferme.json.path, '', 'un inconnu n’apprend pas le chemin');
      assert.equal(ferme.json.deviceLock, false);

      const ouvert = await client('/api/admin/gate', { headers: { Cookie: 'stv_entry=1' } });
      assert.equal(ouvert.json.admin, true);
      assert.equal(ouvert.json.path, 'console-privee');
    });
  });

  test('changer l’adresse secrète déplace la porte et refuse les mots réservés', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const change = await client('/api/admin/settings', {
        method: 'PATCH', token, body: { adminPath: 'atelier-prive-2026' },
      });
      assert.equal(change.status, 200, change.text);
      assert.equal(change.json.adminPath, 'atelier-prive-2026');
      assert.equal(change.json.requiresReload, true, 'le client doit recharger sur le nouveau chemin');

      const neuf = await client('/atelier-prive-2026');
      assert.equal(neuf.status, 200);
      assert.match(neuf.headers.get('set-cookie') || '', /stv_entry=1/);
      const ancien = await client('/console-privee');
      assert.equal(ancien.status, 404, 'l’ancienne adresse est fermée');

      for (const mauvais of ['admin', 'console', 'api', 'Ab']) {
        const refus = await client('/api/admin/settings', { method: 'PATCH', token, body: { adminPath: mauvais } });
        assert.equal(refus.status, 400, `${mauvais} doit être refusé`);
      }
      const gate = await client('/api/admin/gate', { headers: { Cookie: 'stv_entry=1' } });
      assert.equal(gate.json.path, 'atelier-prive-2026', 'un refus ne change rien');
    });
  });

  test('les appareils s’ajoutent, se listent et se retirent', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const vide = await client('/api/admin/devices?current=' + appareil(1), { token });
      assert.equal(vide.status, 200);
      assert.equal(vide.json.devices.length, 0);
      assert.equal(vide.json.lock, false);

      const ajout = await client('/api/admin/devices', {
        method: 'POST', token, body: { deviceId: appareil(1), label: 'Téléphone de Mourad' },
      });
      assert.equal(ajout.status, 200, ajout.text);
      assert.equal(ajout.json.already, undefined);

      const encore = await client('/api/admin/devices', {
        method: 'POST', token, body: { deviceId: appareil(1), label: 'Doublon' },
      });
      assert.equal(encore.json.already, true, 'un même appareil ne compte pas deux fois');

      const liste = await client('/api/admin/devices?current=' + appareil(1), { token });
      assert.equal(liste.json.devices.length, 1);
      assert.equal(liste.json.devices[0].label, 'Téléphone de Mourad');
      assert.equal(liste.json.devices[0].current, true, 'l’appareil courant est signalé');
      assert.equal(liste.json.devices[0].digest, undefined, 'aucune empreinte ne sort de l’API');

      const autre = await client('/api/admin/devices?current=' + appareil(2), { token });
      assert.equal(autre.json.devices[0].current, false);

      const retrait = await client(`/api/admin/devices/${liste.json.devices[0].id}`, { method: 'DELETE', token });
      assert.equal(retrait.status, 200, retrait.text);
      const apres = await client('/api/admin/devices', { token });
      assert.equal(apres.json.devices.length, 0);
      const inconnu = await client('/api/admin/devices/d-inconnu0000', { method: 'DELETE', token });
      assert.equal(inconnu.status, 404);
    });
  });

  test('huit appareils au maximum, et un identifiant invalide est remplacé', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const invalide = await client('/api/admin/devices', {
        method: 'POST', token, body: { deviceId: 'pas-un-identifiant', label: 'Étrange' },
      });
      assert.equal(invalide.status, 200, invalide.text);
      assert.match(invalide.json.deviceId, /^[a-f0-9]{32}$/, 'le serveur tire un identifiant valide');
      assert.notEqual(invalide.json.deviceId, 'pas-un-identifiant');

      for (let index = 1; index <= 7; index += 1) {
        const ajout = await client('/api/admin/devices', {
          method: 'POST', token, body: { deviceId: appareil(index), label: `Appareil ${index}` },
        });
        assert.equal(ajout.status, 200, ajout.text);
      }
      const trop = await client('/api/admin/devices', {
        method: 'POST', token, body: { deviceId: appareil(9), label: 'Neuvième' },
      });
      assert.equal(trop.status, 422, 'ERR-16 : la demande est comprise mais impossible');
      assert.equal(trop.json.code, 'ERR-16');
      const liste = await client('/api/admin/devices', { token });
      assert.equal(liste.json.devices.length, 8, 'le plafond tient');
    });
  });

  test('le verrou d’appareil ne se pose pas sans appareil, puis ferme la connexion', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const premature = await client('/api/admin/settings', {
        method: 'PATCH', token, body: { adminDeviceLock: true },
      });
      assert.equal(premature.status, 422, 'aucun appareil : le verrou est refusé');
      assert.equal(premature.json.code, 'ERR-16');

      await client('/api/admin/devices', { method: 'POST', token, body: { deviceId: appareil(1), label: 'Téléphone' } });
      const pose = await client('/api/admin/settings', { method: 'PATCH', token, body: { adminDeviceLock: true } });
      assert.equal(pose.status, 200, pose.text);

      const gate = await client('/api/admin/gate');
      assert.equal(gate.json.deviceLock, true);

      const inconnu = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: appareil(7) } });
      assert.equal(inconnu.status, 403);
      assert.equal(inconnu.json.code, 'ERR-09');
      assert.equal(inconnu.json.token, undefined);

      const connu = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: appareil(1) } });
      assert.equal(connu.status, 200, connu.text);
      assert.equal(connu.json.entry, '/console-privee', 'la connexion rend le chemin de la console');
      assert.ok(connu.json.token);

      const sansIdentifiant = await client('/api/login', { method: 'POST', body: { password: 'admin' } });
      assert.equal(sansIdentifiant.status, 403, 'sans identifiant, le verrou tient');
    });
  });

  test('verrou levé : le mot de passe suffit, sans appareil déclaré', async () => {
    await withServer({}, async ({ client }) => {
      const connexion = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: appareil(3) } });
      assert.equal(connexion.status, 200);
      assert.equal(connexion.json.entry, '/console-privee');
    });
  });

  test('la gestion des appareils reste au propriétaire et aux administrateurs', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      await client('/api/admin/team', {
        method: 'POST', token,
        body: { name: 'Éditeur Test', email: 'editeur@example.com', role: 'editeur', password: 'motdepasse-solide' },
      });
      const membre = await client('/api/login', {
        method: 'POST', body: { email: 'editeur@example.com', password: 'motdepasse-solide' },
      });
      assert.equal(membre.status, 200, membre.text);
      const refus = await client('/api/admin/devices', { token: membre.json.token });
      assert.equal(refus.status, 403, 'un éditeur ne voit pas les appareils');
      const ajoutRefuse = await client('/api/admin/devices', {
        method: 'POST', token: membre.json.token, body: { deviceId: appareil(4), label: 'Intrusion' },
      });
      assert.equal(ajoutRefuse.status, 403);
    });
  });
});
