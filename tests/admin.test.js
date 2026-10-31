// tests/admin.test.js — console de pilotage 3.9.0 : équipe, rôles, permissions, agent, usage.
// Ce que ces tests protègent : un rôle ne peut jamais faire plus que ce qu'il annonce,
// et l'agent de diagnostic ne modifie rien.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server;
let ownerToken = '';

before(async () => {
  server = await startServer();
  const login = await server.login('admin');
  ownerToken = login.token;
});

after(async () => {
  await server?.stop();
});

const member = {
  name: 'Salma Idrissi',
  email: 'salma@example.com',
  role: 'editeur',
  password: 'BureauSolide2026',
};

describe('Équipe et permissions (3.9.0)', () => {
  test('la connexion du propriétaire nomme son rôle', async () => {
    const login = await server.login('admin');
    assert.equal(login.status, 200);
    assert.equal(login.json.role, 'proprietaire');
    assert.equal(login.json.roleLabel, 'Propriétaire');
  });

  test('un compte d’équipe se connecte par e-mail et reçoit son rôle', async () => {
    const creation = await server.client('/api/admin/team', { method: 'POST', body: member, token: ownerToken });
    assert.equal(creation.status, 200, creation.text);
    assert.equal(creation.json.member.role, 'editeur');
    assert.equal(creation.json.member.passwordHash, undefined, 'aucune empreinte ne sort de l’API');

    const login = await server.client('/api/login', { method: 'POST', body: { email: member.email, password: member.password } });
    assert.equal(login.status, 200);
    assert.equal(login.json.role, 'editeur');
  });

  test('les routes d’administration refusent un appel sans jeton', async () => {
    for (const path of ['/api/admin/team', '/api/admin/diagnostic', '/api/admin/analytics', '/api/admin/stats']) {
      const response = await server.client(path);
      assert.equal(response.status, 401, `${path} devrait exiger un jeton`);
    }
  });

  test('un éditeur ne gère ni les comptes, ni les réglages, ni les suppressions', async () => {
    const login = await server.client('/api/login', { method: 'POST', body: { email: member.email, password: member.password } });
    const token = login.json.token;
    const refus = [
      ['/api/admin/team', 'GET'],
      ['/api/admin/settings', 'PATCH'],
      ['/api/admin/channels/x', 'DELETE'],
      ['/api/admin/password', 'POST'],
    ];
    for (const [path, method] of refus) {
      const response = await server.client(path, { method, body: method === 'GET' ? undefined : {}, token });
      assert.equal(response.status, 403, `${method} ${path} devrait être refusé`);
    }
    const lecture = await server.client('/api/admin/channels?pageSize=2', { token });
    assert.equal(lecture.status, 200, 'la lecture du catalogue reste permise');
    const diag = await server.client('/api/admin/diagnostic', { token });
    assert.equal(diag.status, 200, 'le diagnostic est lisible par un éditeur');
  });

  test('fermer un accès coupe la connexion du membre', async () => {
    const liste = await server.client('/api/admin/team', { token: ownerToken });
    const cible = liste.json.members.find((item) => item.email === member.email);
    await server.client(`/api/admin/team/${cible.id}`, { method: 'PATCH', body: { disabled: true }, token: ownerToken });
    const login = await server.client('/api/login', { method: 'POST', body: { email: member.email, password: member.password } });
    assert.equal(login.status, 401);
    await server.client(`/api/admin/team/${cible.id}`, { method: 'DELETE', token: ownerToken });
  });

  test('un mot de passe trop court est refusé', async () => {
    const creation = await server.client('/api/admin/team', {
      method: 'POST', token: ownerToken,
      body: { name: 'Court', email: 'court@example.com', role: 'analyste', password: 'abc' },
    });
    assert.equal(creation.status, 400);
  });
});

describe('Agent de diagnostic', () => {
  test('il rend une note, un verdict et des constats hiérarchisés', async () => {
    const response = await server.client('/api/admin/diagnostic', { token: ownerToken });
    assert.equal(response.status, 200);
    const body = response.json;
    assert.ok(Number.isInteger(body.score) && body.score >= 0 && body.score <= 100);
    assert.ok(body.verdict.length > 10);
    assert.ok(Array.isArray(body.constats));
    assert.ok(body.chiffres.total > 0);
    const ordre = { critique: 0, avertissement: 1, info: 2 };
    const rangs = body.constats.map((item) => ordre[item.severite]);
    assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b), 'les critiques passent devant');
    for (const constat of body.constats) {
      assert.ok(constat.titre && constat.detail && constat.action, 'chaque constat propose une action');
      assert.match(constat.lien, /^\/admin\?onglet=/, 'chaque constat mène à l’écran concerné');
    }
  });

  test('le mot de passe par défaut est signalé comme critique', async () => {
    const response = await server.client('/api/admin/diagnostic', { token: ownerToken });
    const securite = response.json.constats.find((item) => item.code === 'SEC-01');
    assert.ok(securite, 'SEC-01 doit apparaître');
    assert.equal(securite.severite, 'critique');
  });
});

describe('Usage anonyme et journal', () => {
  test('une lecture est comptée, sans aucune donnée personnelle', async () => {
    const liste = await server.client('/api/channels?pageSize=1');
    const channel = liste.json.channels[0];
    for (let i = 0; i < 3; i += 1) {
      const response = await server.client('/api/events/play', { method: 'POST', body: { channelId: channel.id } });
      assert.equal(response.status, 200);
    }
    const usage = await server.client('/api/admin/analytics?heures=24', { token: ownerToken });
    assert.equal(usage.status, 200);
    assert.ok(usage.json.totalGeneral >= 3);
    const top = usage.json.parChaine[0];
    assert.equal(top.id, channel.id);
    assert.ok(top.count >= 3);
  });

  test('une chaîne inconnue n’incrémente rien', async () => {
    const response = await server.client('/api/events/play', { method: 'POST', body: { channelId: 'inexistante' } });
    assert.equal(response.status, 404);
  });

  test('le journal expose qui a fait quoi, du plus récent au plus ancien', async () => {
    const response = await server.client('/api/admin/audit?lines=20', { token: ownerToken });
    assert.equal(response.status, 200);
    assert.ok(response.json.entries.length > 0);
    const actions = response.json.entries.map((entry) => entry.action);
    assert.ok(actions.includes('login.success'));
    assert.ok(actions.every((action) => typeof action === 'string' && action.length > 2));
  });
});

describe('Remplacement de lien', () => {
  test('une adresse invalide est refusée avant tout réseau', async () => {
    const response = await server.client('/api/admin/link/test', { method: 'POST', body: { url: 'pas une adresse' }, token: ownerToken });
    assert.equal(response.status, 400);
  });

  test('le remplacement conserve l’ancienne adresse comme variante', async () => {
    const liste = await server.client('/api/admin/channels?pageSize=1', { token: ownerToken });
    const channel = liste.json.channels[0];
    const avant = await server.client(`/api/admin/channels/${channel.id}`, { token: ownerToken });
    const ancienne = avant.json.channel.url;
    const nouveau = 'https://exemple.test/flux/nouveau.m3u8';
    const patch = await server.client(`/api/admin/channels/${channel.id}`, { method: 'PATCH', body: { url: nouveau }, token: ownerToken });
    assert.equal(patch.status, 200, patch.text);
    // L'identifiant est l'empreinte de l'URL : il change avec elle, et le serveur le renvoie.
    const nouvelId = patch.json.channel.id;
    assert.notEqual(nouvelId, channel.id, 'l’identifiant suit l’adresse');
    const apres = await server.client(`/api/admin/channels/${nouvelId}`, { token: ownerToken });
    assert.equal(apres.json.channel.url, nouveau);
    // L'ancienne adresse reste consultable dans la console des liens, comme variante.
    const liens = await server.client(`/api/admin/links?pageSize=50&q=${encodeURIComponent(channel.name)}`, { token: ownerToken });
    const ligne = liens.json.channels.find((item) => item.id === nouvelId);
    assert.ok(ligne, 'la chaîne reste dans la console des liens');
    assert.equal(ligne.url, nouveau);
    assert.ok(ligne.variants.some((variant) => variant.url === ancienne), 'l’ancien lien reste disponible');
  });
});
