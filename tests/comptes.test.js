// tests/comptes.test.js — comptes visiteurs 3.19.0 : inscription confirmée par e-mail,
// sessions séparées de la console, données personnelles bornées, refus explicites.
// Le serveur SMTP est simulé localement : aucun e-mail ne sort de la machine.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';

import { freePort, startServer, tempDataDir, withServer } from './helpers.js';
import { EmailCodes, Users } from '../server/core/users.js';

/** Serveur SMTP minimal : accueille, collecte le corps des messages, répond 250. */
async function fakeSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 test ESMTP\r\n');
    let buffer = '';
    let inData = false;
    let lines = [];
    const finish = () => {
      const raw = lines.join('\n');
      const body = raw.split('\n\n').slice(1).join('\n\n').replace(/\s+/g, '');
      let text = '';
      try { text = Buffer.from(body, 'base64').toString('utf8'); } catch { text = ''; }
      messages.push({ raw, text });
      lines = [];
      inData = false;
    };
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') { finish(); socket.write('250 2.0.0 accepté\r\n'); }
          else lines.push(line);
        } else if (/^EHLO|^HELO/i.test(line)) {
          socket.write('250 test\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 envoyez\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 au revoir\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
        index = buffer.indexOf('\r\n');
      }
    });
    socket.on('error', () => {});
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    messages,
    codeFor(email) {
      const mine = messages.filter((message) => message.raw.includes(email));
      const last = mine[mine.length - 1];
      return last ? (/(\d{6})/.exec(last.text) || [])[1] || '' : '';
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const COMPTE_OK = { name: 'Camille Visiteuse', email: 'camille@exemple.test', password: 'Visiteuse2026!' };

async function subscribe(server, payload = {}) {
  const body = { ...COMPTE_OK, ...payload };
  const registered = await server.client('/api/compte/inscription', { method: 'POST', body });
  return { ...registered, body };
}

describe('comptes visiteurs : inscription et confirmation', () => {
  test('sans serveur d’envoi, l’inscription est refusée et rien n’est écrit', async () => {
    await withServer({}, async (server) => {
      const refused = await subscribe(server);
      assert.equal(refused.status, 503);
      assert.match(refused.json.error, /serveur d’envoi|e-mail/);
      const usersFile = path.join(server.dataDir, 'users.json');
      await assert.rejects(fsp.access(usersFile), /ENOENT|no such file/);
      const conexion = await server.client('/api/compte/connexion', {
        method: 'POST', body: { email: COMPTE_OK.email, password: COMPTE_OK.password },
      });
      assert.equal(conexion.status, 401);
      assert.equal(conexion.json.error, 'Adresse ou mot de passe incorrect.');
    });
  });

  test('inscription, mauvais code, confirmation, jeton de session', async () => {
    const smtp = await fakeSmtp();
    const dataDir = await tempDataDir();
    const server = await startServer({
      dataDir,
      env: {
        STREAMTV_SMTP_HOST: '127.0.0.1',
        STREAMTV_SMTP_PORT: String(smtp.port),
        STREAMTV_SMTP_TLS: '0',
        STREAMTV_SMTP_SECURE: '0',
        STREAMTV_SMTP_FROM: 'streamtv@exemple.test',
      },
    });
    try {
      const created = await subscribe(server);
      assert.equal(created.status, 201);
      assert.match(created.json.message, /code de confirmation/i);
      assert.equal(created.json.verificationRequired, true);
      assert.equal(created.json.compte.status, 'attente');
      assert.equal(created.json.compte.email, COMPTE_OK.email);
      assert.equal(JSON.stringify(created.json).includes('passwordHash'), false, 'aucun secret exposé');
      assert.equal(JSON.stringify(created.json).includes(COMPTE_OK.password), false);

      const stored = JSON.parse(await fsp.readFile(path.join(dataDir, 'users.json'), 'utf8'));
      assert.equal(stored.users.length, 1);
      assert.equal(stored.users[0].status, 'attente');
      assert.match(stored.users[0].passwordHash, /^[a-f0-9]{128}$/, 'empreinte scrypt seulement');
      assert.equal(JSON.stringify(stored).includes(COMPTE_OK.password), false, 'mot de passe jamais écrit');

      const code = smtp.codeFor(COMPTE_OK.email);
      assert.match(code, /^\d{6}$/, 'un code à six chiffres a été envoyé');
      const mauvais = code === '000000' ? '111111' : '000000';
      const refuse = await server.client('/api/compte/verification', {
        method: 'POST', body: { email: COMPTE_OK.email, code: mauvais },
      });
      assert.equal(refuse.status, 400);
      assert.match(refuse.json.error, /incorrect|expiré/);

      const connexionAvant = await server.client('/api/compte/connexion', {
        method: 'POST', body: { email: COMPTE_OK.email, password: COMPTE_OK.password },
      });
      assert.equal(connexionAvant.status, 403);
      assert.match(connexionAvant.json.error, /Confirmez votre adresse/);

      const ok = await server.client('/api/compte/verification', {
        method: 'POST', body: { email: COMPTE_OK.email, code },
      });
      assert.equal(ok.status, 200);
      assert.match(ok.json.token, /^[a-f0-9]{48}$/);
      assert.equal(ok.json.compte.status, 'actif');

      const profil = await server.client('/api/compte/profil', { token: ok.json.token });
      assert.equal(profil.status, 200);
      assert.equal(profil.json.compte.email, COMPTE_OK.email);
      assert.equal(profil.json.compte.statusLabel, 'Actif');
      assert.equal(JSON.stringify(profil.json).includes('passwordHash'), false);

      // Un jeton visiteur n'ouvre aucune route de la console.
      const admin = await server.client('/api/admin/settings', { token: ok.json.token });
      assert.equal(admin.status, 401);
      const membres = await server.client('/api/admin/membres', { token: ok.json.token });
      assert.equal(membres.status, 401);

      // Ni les routes réservées au propriétaire par un jeton inventé.
      const faux = await server.client('/api/admin/settings', { token: 'a'.repeat(48) });
      assert.equal(faux.status, 401);
    } finally {
      await server.stop();
      await smtp.close();
    }
  });
});

describe('comptes visiteurs : session, données personnelles et modération', () => {
  let smtp;
  let server;
  let token = '';
  let codeEnvoye = '';
  let adminToken = '';

  before(async () => {
    smtp = await fakeSmtp();
    server = await startServer({
      dataDir: await tempDataDir(),
      env: {
        STREAMTV_SMTP_HOST: '127.0.0.1',
        STREAMTV_SMTP_PORT: String(smtp.port),
        STREAMTV_SMTP_TLS: '0',
        STREAMTV_SMTP_SECURE: '0',
        STREAMTV_SMTP_FROM: 'streamtv@exemple.test',
      },
    });
    const created = await subscribe(server);
    assert.equal(created.status, 201);
    codeEnvoye = smtp.codeFor(COMPTE_OK.email);
    const verified = await server.client('/api/compte/verification', {
      method: 'POST', body: { email: COMPTE_OK.email, code: codeEnvoye },
    });
    token = verified.json.token;
  });

  after(async () => {
    await server.stop();
    await smtp.close();
  });

  test('la connexion refuse un mot de passe faux sans dire si l’adresse existe', async () => {
    const connu = await server.client('/api/compte/connexion', {
      method: 'POST', body: { email: COMPTE_OK.email, password: 'mauvais-mot-de-passe-2026' },
    });
    const inconnu = await server.client('/api/compte/connexion', {
      method: 'POST', body: { email: 'personne@exemple.test', password: 'mauvais-mot-de-passe-2026' },
    });
    assert.equal(connu.status, 401);
    assert.equal(inconnu.status, 401);
    assert.equal(connu.json.error, inconnu.json.error);
    assert.equal(connu.json.code, 'ERR-08');
  });

  test('favoris, historique, préférences et reprise survivent à la session', async () => {
    const favori = await server.client('/api/compte/favoris', {
      method: 'POST', token, body: { kind: 'chaine', id: 'chaine-1', name: 'Chaîne une' },
    });
    assert.equal(favori.status, 200);
    assert.equal(favori.json.added, true);
    const doublon = await server.client('/api/compte/favoris', {
      method: 'POST', token, body: { kind: 'chaine', id: 'chaine-1', name: 'Chaîne une' },
    });
    assert.equal(doublon.json.added, false);
    const retire = await server.client('/api/compte/favoris', {
      method: 'POST', token, body: { kind: 'chaine', id: 'chaine-1', actif: false },
    });
    assert.equal(retire.json.removed, true);

    const reprise = await server.client('/api/compte/historique', {
      method: 'POST', token, body: { kind: 'film', id: 'film-1', name: 'Film un', position: 420, duration: 5400 },
    });
    assert.equal(reprise.status, 200);
    assert.equal(reprise.json.entree.position, 420);

    const prefs = await server.client('/api/compte/preferences', {
      method: 'PUT', token, body: { skin: 'minimal', tvMode: 'off', qualite: 'n-importe-quoi' },
    });
    assert.equal(prefs.status, 200);
    assert.equal(prefs.json.preferences.skin, 'minimal');
    assert.equal(prefs.json.preferences.tvMode, 'off');
    assert.equal(prefs.json.preferences.qualite, undefined, 'valeur inconnue ignorée, pas inventée');

    const fusion = await server.client('/api/compte/donnees', {
      method: 'PUT', token,
      body: {
        favoris: [{ kind: 'anime', id: 'anime-1', name: 'Anime un' }],
        historique: [{ kind: 'chaine', id: 'chaine-2', name: 'Chaîne deux', position: 30, duration: 3600 }],
        preferences: { sourdine: true },
      },
    });
    assert.equal(fusion.status, 200);
    assert.equal(fusion.json.favoris.length, 1);
    assert.equal(fusion.json.historique.length, 2);
    assert.equal(fusion.json.preferences.sourdine, true);

    const relu = await server.client('/api/compte/donnees', { token });
    assert.equal(relu.status, 200);
    assert.equal(relu.json.historique[0].id, 'film-1', 'la reprise la plus récente reste en tête');
    assert.equal(relu.json.favoris[0].id, 'anime-1');
  });

  test('données mal formées : refus explicite, rien n’est écrit', async () => {
    const invalide = await server.client('/api/compte/favoris', {
      method: 'POST', token, body: { kind: 'podcast', id: 'x' },
    });
    assert.equal(invalide.status, 400);
    const sansJeton = await server.client('/api/compte/donnees');
    assert.equal(sansJeton.status, 401);
    const sortie = await server.client('/api/compte/sortie', { method: 'POST', token });
    assert.equal(sortie.status, 200);
    const apres = await server.client('/api/compte/profil', { token });
    assert.equal(apres.status, 401);
  });

  test('la console liste les comptes sans secret et peut suspendre puis supprimer', async () => {
    const admin = await server.login();
    assert.equal(admin.status, 200);
    adminToken = admin.token;
    const liste = await server.client('/api/admin/membres', { token: adminToken });
    assert.equal(liste.status, 200);
    assert.equal(liste.json.total, 1);
    assert.equal(liste.json.counts.actif, 1);
    const membre = liste.json.members[0];
    assert.equal(JSON.stringify(liste.json).includes('passwordHash'), false);
    assert.equal(membre.status, 'actif');

    // Nouvelle connexion pour obtenir un jeton valide avant la suspension.
    const connexion = await server.client('/api/compte/connexion', {
      method: 'POST', body: { email: COMPTE_OK.email, password: COMPTE_OK.password },
    });
    assert.equal(connexion.status, 200);
    const frais = connexion.json.token;
    const suspension = await server.client(`/api/admin/membres/${membre.id}`, {
      method: 'PATCH', token: adminToken, body: { statut: 'suspendu' },
    });
    assert.equal(suspension.status, 200);
    assert.equal(suspension.json.membre.status, 'suspendu');
    assert.equal((await server.client('/api/compte/profil', { token: frais })).status, 401, 'sessions fermées');
    const refus = await server.client('/api/compte/connexion', {
      method: 'POST', body: { email: COMPTE_OK.email, password: COMPTE_OK.password },
    });
    assert.equal(refus.status, 403);
    assert.match(refus.json.error, /suspendu/);

    const suppression = await server.client(`/api/admin/membres/${membre.id}`, {
      method: 'DELETE', token: adminToken,
    });
    assert.equal(suppression.status, 200);
    assert.equal((await server.client('/api/admin/membres', { token: adminToken })).json.total, 0);

    const statutInvalide = await server.client('/api/admin/membres/inconnu', {
      method: 'PATCH', token: adminToken, body: { statut: 'actif' },
    });
    assert.equal(statutInvalide.status, 404);
  });

  test('les inscriptions se ferment depuis les réglages', async () => {
    const ferme = await server.client('/api/admin/settings', {
      method: 'PATCH', token: adminToken, body: { registrationMode: 'ferme' },
    });
    assert.equal(ferme.status, 200);
    const refus = await server.client('/api/compte/inscription', {
      method: 'POST',
      body: { name: 'Autre Visiteur', email: 'autre@exemple.test', password: 'Visiteuse2026!' },
    });
    assert.equal(refus.status, 403);
    assert.match(refus.json.error, /inscriptions sont fermées/);
  });
});

describe('comptes visiteurs : garde-fous de temps', () => {
  test('un code expire, tolère cinq essais et limite les renvois', () => {
    let now = 1_700_000_000_000;
    const codes = new EmailCodes({ now: () => now });
    const premier = codes.issue({ purpose: 'inscription', email: 'a@b.test' });
    assert.equal(premier.ok, true);
    assert.match(premier.code, /^\d{6}$/);
    const tropTot = codes.issue({ purpose: 'inscription', email: 'a@b.test' });
    assert.equal(tropTot.ok, false);
    assert.equal(tropTot.reason, 'trop-tot');
    for (let essai = 0; essai < 5; essai += 1) {
      const faux = codes.verify({ purpose: 'inscription', email: 'a@b.test', code: '000000' === premier.code ? '111111' : '000000' });
      assert.equal(faux.ok, false);
    }
    assert.equal(codes.verify({ purpose: 'inscription', email: 'a@b.test', code: premier.code }).reason, 'expire');

    now += 120_000;
    const second = codes.issue({ purpose: 'inscription', email: 'a@b.test' });
    assert.equal(second.ok, true);
    now += 16 * 60_000;
    assert.equal(codes.verify({ purpose: 'inscription', email: 'a@b.test', code: second.code }).reason, 'expire');
  });

  test('un mot de passe faible ne crée aucun compte', async () => {
    const sent = [];
    const users = new Users({
      store: { users: [], saveUsers: async () => {}, audit: async () => {} },
      mailReady: () => true,
      deliver: async (message) => { sent.push(message); },
    });
    for (const password of ['court123', 'motdepasse', 'Password123']) {
      await assert.rejects(
        users.register({ name: 'Essai', email: 'essai@exemple.test', password, ip: '10.0.0.1' }),
        (error) => error.code === 'ERR-03' || error.code === 'ERR-04',
        `mot de passe accepté à tort : ${password}`,
      );
    }
    await assert.rejects(users.register({ name: 'A', email: 'essai@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.1' }),
      (error) => error.code === 'ERR-02');
    await assert.rejects(users.register({ name: 'Essai', email: 'pas-une-adresse', password: 'Visiteuse2026!', ip: '10.0.0.1' }),
      (error) => error.code === 'ERR-04');
    assert.equal(users.list().length, 0);
  });

  test('cinq inscriptions par adresse IP et par quart d’heure, pas une de plus', async () => {
    let now = 1_700_000_000_000;
    const sent = [];
    const users = new Users({
      store: { users: [], saveUsers: async () => {}, audit: async () => {} },
      now: () => now,
      mailReady: () => true,
      deliver: async (message) => { sent.push(message); },
    });
    for (let index = 0; index < 5; index += 1) {
      const created = await users.register({
        name: `Visiteur ${index}`,
        email: `visiteur${index}@exemple.test`,
        password: 'Visiteuse2026!',
        ip: '10.0.0.9',
      });
      assert.equal(created.user.status, 'attente');
    }
    await assert.rejects(
      users.register({ name: 'Trop', email: 'trop@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.9' }),
      (error) => error.code === 'ERR-17' && Boolean(error.headers['Retry-After']),
    );
    now += 16 * 60_000;
    const apres = await users.register({ name: 'Après', email: 'apres@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.9' });
    assert.equal(apres.user.status, 'attente');
    assert.equal(sent.length, 6);
  });

  test('une adresse déjà inscrite n’ouvre pas un second compte', async () => {
    const users = new Users({
      store: { users: [], saveUsers: async () => {}, audit: async () => {} },
      mailReady: () => true,
      deliver: async () => {},
    });
    const premier = await users.register({
      name: 'Doublon', email: 'doublon@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.4',
    });
    assert.equal(premier.user.status, 'attente');
    // Tant que le compte attend sa confirmation, la même adresse renvoie un code : rien n'est dupliqué.
    const renvoi = await users.register({
      name: 'Doublon', email: 'DOUBLON@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.5',
    });
    assert.equal(renvoi.resent, true);
    assert.equal(users.list().length, 1);
    // Une fois le compte actif, un second compte est refusé avec un conflit explicite.
    users.find('doublon@exemple.test').status = 'actif';
    await assert.rejects(
      users.register({ name: 'Doublon', email: 'doublon@exemple.test', password: 'Visiteuse2026!', ip: '10.0.0.6' }),
      (error) => error.status === 409,
    );
    assert.equal(users.list().length, 1);
  });
});
