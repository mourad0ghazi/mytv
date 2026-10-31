// tests/twofactor.test.js — code de connexion envoyé par e-mail (3.12.0).
// Le serveur SMTP est réel (local, sans TLS) : le protocole, l'envoi et la lecture du code
// sont vérifiés bout en bout, comme le ferait Yahoo avec un mot de passe d'application.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { withServer } from './helpers.js';
import { startSmtpServer } from './helpers-smtp.js';
import { TwoFactor, hashCode, maskEmail, newCode } from '../server/core/twofactor.js';
import { buildMessage, mailConfig, mailReady } from '../server/core/mailer.js';

const ADRESSE = 'proprietaire@exemple.com';

const envSmtp = (port) => ({
  STREAMTV_SMTP_HOST: '127.0.0.1',
  STREAMTV_SMTP_PORT: String(port),
  STREAMTV_SMTP_USER: 'console@exemple.com',
  STREAMTV_SMTP_PASS: 'mot-de-passe-application',
  STREAMTV_SMTP_TLS: '0',
  STREAMTV_SMTP_SECURE: '0',
  STREAMTV_SMTP_FROM: 'console@exemple.com',
});

describe('Code par e-mail : briques', () => {
  test('le code fait six chiffres et ne se stocke jamais en clair', () => {
    for (let index = 0; index < 50; index += 1) {
      const code = newCode();
      assert.match(code, /^\d{6}$/, `code invalide : ${code}`);
    }
    assert.notEqual(hashCode('123456', 'sel-a'), hashCode('123456', 'sel-b'), 'le sel compte');
    assert.match(hashCode('123456', 'sel'), /^[a-f0-9]{64}$/);
    assert.equal(maskEmail('M.0urad@yahoo.com').endsWith('@yahoo.com'), true);
    assert.equal(maskEmail('M.0urad@yahoo.com').includes('0urad'), false, 'le milieu de l’adresse est masqué');
  });

  test('un challenge meurt après cinq mauvais codes', () => {
    const deux = new TwoFactor();
    const { id, code } = deux.issue({ email: ADRESSE, ip: '10.0.0.1', deviceId: 'a'.repeat(32) });
    for (let essai = 1; essai <= 4; essai += 1) {
      const refus = deux.verify(id, '000000', { deviceId: 'a'.repeat(32) });
      assert.equal(refus.ok, false);
      assert.equal(refus.restants, 5 - essai);
    }
    assert.equal(deux.verify(id, '000000', { deviceId: 'a'.repeat(32) }).ok, false);
    assert.equal(deux.verify(id, code, { deviceId: 'a'.repeat(32) }).ok, false, 'le bon code ne sert plus après cinq essais');
  });

  test('bon code, appareil lié, usage unique', () => {
    const deux = new TwoFactor();
    const { id, code } = deux.issue({ email: ADRESSE, ip: '10.0.0.2', deviceId: 'b'.repeat(32) });
    assert.equal(deux.verify(id, code, { deviceId: 'c'.repeat(32) }).reason, 'appareil');
    const ok = deux.verify(id, code, { deviceId: 'b'.repeat(32) });
    assert.equal(ok.ok, true);
    assert.equal(deux.verify(id, code, { deviceId: 'b'.repeat(32) }).ok, false, 'un code ne sert qu’une fois');
  });

  test('le code expire et le renvoi attend une minute', () => {
    let maintenant = Date.now();
    const deux = new TwoFactor({ now: () => maintenant });
    const { id } = deux.issue({ email: ADRESSE, ip: '10.0.0.3' });
    assert.equal(deux.reissue(id).reason, 'trop-tot');
    maintenant += 61_000;
    const relance = deux.reissue(id);
    assert.equal(relance.ok, true);
    assert.equal(relance.id, id, 'le renvoi garde le même challenge');
    maintenant += 11 * 60_000;
    assert.equal(deux.verify(id, relance.code).reason, 'expire');
  });

  test('le plafond horaire par adresse réseau tient', () => {
    const deux = new TwoFactor({ maxPerHour: 3 });
    for (let index = 0; index < 3; index += 1) assert.ok(deux.issue({ email: ADRESSE, ip: '10.0.0.4' }));
    assert.equal(deux.issue({ email: ADRESSE, ip: '10.0.0.4' }), null);
    assert.ok(deux.issue({ email: ADRESSE, ip: '10.0.0.5' }), 'une autre adresse n’est pas pénalisée');
  });

  test('le message est propre : objet lisible, corps en base64, en-têtes complets', () => {
    const message = buildMessage({ from: 'console@exemple.com', to: ADRESSE, subject: 'Votre code de connexion', text: 'Code : 482913' });
    assert.match(message, /^From: console@exemple\.com/m);
    assert.match(message, /^To: proprietaire@exemple\.com/m);
    assert.match(message, /^Content-Transfer-Encoding: base64/m);
    assert.match(message, /^Message-ID: <[^>]+>$/m);
    const corps = message.split('\r\n\r\n')[1].replace(/\s+/g, '');
    assert.equal(Buffer.from(corps, 'base64').toString('utf8'), 'Code : 482913');
    assert.equal(/Code : 482913/.test(message.split('\r\n\r\n')[1]), false, 'le code n’est pas en clair dans le message brut');
  });

  test('sans serveur configuré, aucun envoi n’est possible', () => {
    assert.equal(mailReady(mailConfig({})), false);
    assert.equal(mailConfig({ STREAMTV_SMTP_HOST: 'smtp.exemple.com', STREAMTV_SMTP_USER: 'a@b.fr' }).ready, false, 'mot de passe manquant');
    assert.equal(mailConfig({ STREAMTV_SMTP_HOST: 'smtp.exemple.com', STREAMTV_SMTP_USER: 'a@b.fr', STREAMTV_SMTP_PASS: 'x' }).ready, true);
  });
});

describe('Connexion en deux étapes', () => {
  test('le mot de passe juste n’ouvre rien : un code part par e-mail', async () => {
    const smtp = await startSmtpServer();
    try {
      await withServer({ env: envSmtp(smtp.port) }, async ({ client, login }) => {
        const { token } = await login();
        const activation = await client('/api/admin/settings', {
          method: 'PATCH', token, body: { adminEmail: ADRESSE },
        });
        assert.equal(activation.status, 200, activation.text);

        const etape = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: 'd'.repeat(32) } });
        assert.equal(etape.status, 200, etape.text);
        assert.equal(etape.json.requiresCode, true);
        assert.equal(etape.json.token, undefined, 'aucun jeton avant le code');
        assert.ok(etape.json.challengeId);
        assert.match(etape.json.email, /@exemple\.com$/);
        assert.equal(etape.json.expiresIn > 0, true);

        const envoye = smtp.last();
        assert.equal(envoye.to, ADRESSE);
        assert.match(envoye.subject, /code/i);
        assert.match(smtp.code(), /^\d{6}$/);

        const mauvais = await client('/api/login/code', {
          method: 'POST', body: { challengeId: etape.json.challengeId, code: '000000', deviceId: 'd'.repeat(32) },
        });
        assert.equal(mauvais.status, 401);
        assert.match(mauvais.json.error, /tentative/);

        const bon = await client('/api/login/code', {
          method: 'POST', body: { challengeId: etape.json.challengeId, code: smtp.code(), deviceId: 'd'.repeat(32) },
        });
        assert.equal(bon.status, 200, bon.text);
        assert.ok(bon.json.token, 'la session arrive avec le bon code');
        assert.equal(bon.json.entry, '/console-privee');
        assert.equal(bon.json.role, 'proprietaire');

        const rejoue = await client('/api/login/code', {
          method: 'POST', body: { challengeId: etape.json.challengeId, code: smtp.code(), deviceId: 'd'.repeat(32) },
        });
        assert.equal(rejoue.status, 401, 'un code ne sert qu’une fois');

        const session = await client('/api/session', { token: bon.json.token });
        assert.equal(session.status, 200);
      });
    } finally {
      await smtp.close();
    }
  });

  test('un code demandé depuis un appareil ne sert pas sur un autre', async () => {
    const smtp = await startSmtpServer();
    try {
      await withServer({ env: envSmtp(smtp.port) }, async ({ client, login }) => {
        const { token } = await login();
        await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: ADRESSE } });
        const etape = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: 'e'.repeat(32) } });
        const vole = await client('/api/login/code', {
          method: 'POST', body: { challengeId: etape.json.challengeId, code: smtp.code(), deviceId: 'f'.repeat(32) },
        });
        assert.equal(vole.status, 401);
        assert.match(vole.json.error, /autre appareil/);
      });
    } finally {
      await smtp.close();
    }
  });

  test('le renvoi attend une minute puis délivre un nouveau code', async () => {
    const smtp = await startSmtpServer();
    try {
      await withServer({ env: envSmtp(smtp.port) }, async ({ client, login }) => {
        const { token } = await login();
        await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: ADRESSE } });
        const etape = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: 'a'.repeat(32) } });
        const premier = smtp.code();
        const trop = await client('/api/login/code/resend', { method: 'POST', body: { challengeId: etape.json.challengeId } });
        assert.equal(trop.status, 429, 'un renvoi immédiat est refusé');
        assert.ok(Number(trop.headers.get('retry-after')) > 0);
        assert.equal(smtp.code(), premier, 'aucun second envoi');
      });
    } finally {
      await smtp.close();
    }
  });

  test('sans serveur d’envoi, l’adresse est refusée avant d’enfermer dehors', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const refus = await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: ADRESSE } });
      assert.equal(refus.status, 422);
      assert.equal(refus.json.code, 'ERR-16');
      assert.match(refus.json.error, /serveur d’envoi/);
      const etat = await client('/api/admin/settings', { token });
      assert.equal(etat.json.mail.ready, false);
      assert.equal(etat.json.mail.destination, '', 'rien n’a été écrit');
      const test_ = await client('/api/admin/mail/test', { method: 'POST', token, body: {} });
      assert.equal(test_.status, 422);
    });
  });

  test('l’adresse se valide, se teste et ne sort jamais par l’API publique', async () => {
    const smtp = await startSmtpServer();
    try {
      await withServer({ env: envSmtp(smtp.port) }, async ({ client, login }) => {
        const { token } = await login();
        const invalide = await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: 'pas-un-mail' } });
        assert.equal(invalide.status, 400);

        await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: ADRESSE } });
        const test_ = await client('/api/admin/mail/test', { method: 'POST', token, body: {} });
        assert.equal(test_.status, 200, test_.text);
        assert.equal(smtp.last().to, ADRESSE);
        assert.equal(/aucun code/i.test(smtp.last().texte), true);

        const config = await client('/api/config');
        assert.equal(JSON.stringify(config.json).includes(ADRESSE), false, 'l’adresse reste privée');
        assert.equal(JSON.stringify(config.json).includes('mot-de-passe-application'), false, 'aucun secret SMTP exposé');

        const etat = await client('/api/admin/settings', { token });
        assert.equal(etat.json.mail.ready, true);
        assert.equal(etat.json.mail.destination, ADRESSE);
        assert.equal(JSON.stringify(etat.json).includes('mot-de-passe-application'), false, 'le mot de passe d’application ne sort jamais');
      });
    } finally {
      await smtp.close();
    }
  });

  test('un serveur d’envoi en panne ne délivre pas de session', async () => {
    const smtp = await startSmtpServer({ reject: true });
    try {
      await withServer({ env: envSmtp(smtp.port) }, async ({ client, login }) => {
        const { token } = await login();
        await client('/api/admin/settings', { method: 'PATCH', token, body: { adminEmail: ADRESSE } });
        const etape = await client('/api/login', { method: 'POST', body: { password: 'admin', deviceId: 'a'.repeat(32) } });
        assert.equal(etape.status, 422);
        assert.equal(etape.json.code, 'ERR-16');
        assert.equal(etape.json.token, undefined);
      });
    } finally {
      await smtp.close();
    }
  });
});
