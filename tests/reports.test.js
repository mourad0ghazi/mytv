// tests/reports.test.js — signalements de contenu : compteur, seuil de retrait, décisions.
// Vérifie la règle du propriétaire : rien n'est retiré avant le seuil, et au seuil la
// suppression est immédiate, réversible et journalisée.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { withServer } from './helpers.js';
import {
  applyDecision, countFor, emptyState, hashIp, recordReport, reportThreshold, summarize,
} from '../server/core/reports.js';

const chaine = (extra = {}) => ({
  id: 'abc123def456', name: 'Chaine Test', number: 7, visible: true, deleted: false,
  blocked: false, blockedReason: '', manualOverride: '', variants: [], ...extra,
});

describe('Compteur de signalements (cœur)', () => {
  test('le seuil par défaut est de 1000 et reste réglable', () => {
    delete process.env.STREAMTV_SEUIL_SIGNALEMENTS;
    assert.equal(reportThreshold(), 1000);
    process.env.STREAMTV_SEUIL_SIGNALEMENTS = '25';
    assert.equal(reportThreshold(), 25);
    process.env.STREAMTV_SEUIL_SIGNALEMENTS = '1';
    assert.equal(reportThreshold(), 1000, 'une valeur absurde retombe sur le défaut');
    delete process.env.STREAMTV_SEUIL_SIGNALEMENTS;
  });

  test('un même visiteur ne compte qu’une fois par 24 h', () => {
    const state = emptyState();
    const channel = chaine();
    const first = recordReport({ state, channel, ip: '203.0.113.9', threshold: 3 });
    const again = recordReport({ state, channel, ip: '203.0.113.9', threshold: 3, now: Date.now() + 1000 });
    assert.equal(first.duplicate, false);
    assert.equal(again.duplicate, true, 'le doublon est reconnu');
    assert.equal(again.count, 1, 'le compteur ne bouge pas');
    assert.equal(countFor(state, channel.id), 1);
    const autreIp = recordReport({ state, channel, ip: '198.51.100.4', threshold: 3 });
    assert.equal(autreIp.count, 2, 'une autre adresse compte');
  });

  test('le seuil déclenche la suppression, pas avant', () => {
    const state = emptyState();
    const channel = chaine();
    const un = recordReport({ state, channel, ip: 'a', threshold: 3 });
    const deux = recordReport({ state, channel, ip: 'b', threshold: 3 });
    const trois = recordReport({ state, channel, ip: 'c', threshold: 3 });
    assert.equal(un.shouldDelete, false);
    assert.equal(deux.shouldDelete, false);
    assert.equal(trois.shouldDelete, true, 'au 3e signalement, le retrait est demandé');
    assert.equal(trois.count, 3);
    assert.match(trois.ref, /^SIG-\d{5}$/);
  });

  test('l’empreinte d’adresse ne conserve pas l’adresse', () => {
    const empreinte = hashIp('203.0.113.9');
    assert.equal(empreinte.length, 16);
    assert.equal(empreinte.includes('203.0.113'), false);
    assert.equal(empreinte, hashIp('203.0.113.9'), 'stable pour dédoublonner');
  });

  test('confirmer masque la chaîne et protège la décision', () => {
    const state = emptyState();
    const channel = chaine();
    recordReport({ state, channel, ip: 'c', reason: 'droits', threshold: 1000 });
    const report = state.reports[0];
    const { channelChanged } = applyDecision({ state, report, action: 'confirm', channel });
    assert.equal(channelChanged, true);
    assert.equal(channel.visible, false);
    assert.equal(channel.manualOverride, 'retrait-signalement');
    assert.equal(channel.blockedReason, 'retrait-signalement');
    assert.equal(report.status, 'confirme');
  });

  test('rejeter laisse la chaîne en ligne', () => {
    const state = emptyState();
    const channel = chaine();
    recordReport({ state, channel, ip: 'c', threshold: 1000 });
    applyDecision({ state, report: state.reports[0], action: 'reject', channel });
    assert.equal(channel.visible, true);
    assert.equal(state.reports[0].status, 'rejete');
  });

  test('le résumé classe les chaînes par nombre de signalements', () => {
    const state = emptyState();
    const a = chaine({ id: 'aaaaaaaaaaaa', name: 'Alpha' });
    const b = chaine({ id: 'bbbbbbbbbbbb', name: 'Beta' });
    recordReport({ state, channel: a, ip: '1', threshold: 1000 });
    recordReport({ state, channel: b, ip: '2', threshold: 1000 });
    recordReport({ state, channel: b, ip: '3', threshold: 1000 });
    const resume = summarize(state, { channels: [a, b], threshold: 1000 });
    assert.equal(resume.total, 2);
    assert.equal(resume.signalements, 3);
    assert.equal(resume.channels[0].name, 'Beta', 'la plus signalée en tête');
    assert.equal(resume.channels[0].count, 2);
  });
});

describe('Signalement par HTTP', () => {
  test('POST /api/report enregistre sans masquer, puis supprime au seuil', async () => {
    await withServer({ env: { STREAMTV_SEUIL_SIGNALEMENTS: '3' } }, async ({ client, login }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];

      const un = await client('/api/report', { method: 'POST', body: { channelId: cible.id, reason: 'droits' } });
      assert.equal(un.status, 201);
      assert.equal(un.json.count, 1);
      assert.equal(un.json.deleted, false);
      assert.equal(un.json.threshold, 3);

      const deux = await client('/api/report', {
        method: 'POST', body: { channelId: cible.id, reason: 'droits' },
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      assert.equal(deux.json.count, 2, 'une seconde adresse compte');
      assert.equal(deux.json.deleted, false);

      const trois = await client('/api/report', {
        method: 'POST', body: { channelId: cible.id, reason: 'droits' },
        headers: { 'x-forwarded-for': '198.51.100.8' },
      });
      assert.equal(trois.status, 201);
      assert.equal(trois.json.deleted, true, 'au seuil, la chaîne est retirée');
      assert.equal(trois.json.count, 3);

      const apres = await client(`/api/channels/${cible.id}`);
      assert.equal(apres.status, 404, 'la chaîne supprimée n’est plus publique');

      const { token } = await login();
      const admin = await client('/api/admin/channels?visibility=deleted', { token });
      assert.ok(admin.json.channels.some((channel) => channel.id === cible.id), 'elle reste récupérable');

      const restaure = await client(`/api/admin/channels/${cible.id}/restore`, { method: 'POST', body: {}, token });
      assert.equal(restaure.status, 200);
      assert.equal(restaure.json.channel.deleted, false);
    });
  });

  test('un motif inconnu est refusé, une chaîne inconnue aussi', async () => {
    await withServer({}, async ({ client }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];
      const motif = await client('/api/report', { method: 'POST', body: { channelId: cible.id, reason: 'nimportequoi' } });
      assert.equal(motif.status, 400);
      const absente = await client('/api/report', { method: 'POST', body: { name: 'Chaine Qui N Existe Pas 12345', reason: 'autre' } });
      assert.equal(absente.status, 404);
    });
  });

  test('plus de cinq signalements par heure renvoie 429', async () => {
    await withServer({}, async ({ client }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];
      let dernier = 0;
      for (let i = 0; i < 7; i += 1) {
        const reponse = await client('/api/report', {
          method: 'POST', body: { channelId: cible.id, reason: 'autre' },
          headers: { 'x-forwarded-for': '203.0.113.50' },
        });
        dernier = reponse.status;
      }
      assert.equal(dernier, 429, 'la limite par heure est appliquée');
    });
  });

  test('la référence d’un signalement se consulte', async () => {
    await withServer({}, async ({ client }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];
      const cree = await client('/api/report', { method: 'POST', body: { channelId: cible.id, reason: 'flux' } });
      const suivi = await client(`/api/report/${cree.json.ref}`);
      assert.equal(suivi.status, 200);
      assert.equal(suivi.json.ref, cree.json.ref);
      assert.equal(suivi.json.status, 'nouveau');
      const inconnu = await client('/api/report/SIG-99999');
      assert.equal(inconnu.status, 404);
    });
  });
});

describe('Console des chaînes et des liens', () => {
  test('l’inventaire exige une session', async () => {
    await withServer({}, async ({ client }) => {
      const anonyme = await client('/api/admin/links');
      assert.equal(anonyme.status, 401);
      const anonymeReports = await client('/api/admin/reports');
      assert.equal(anonymeReports.status, 401);
    });
  });

  test('l’inventaire expose l’URL, le protocole, les variantes et les compteurs', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const { status, json } = await client('/api/admin/links?pageSize=5', { token });
      assert.equal(status, 200);
      assert.equal(json.channels.length, 5);
      const ligne = json.channels[0];
      for (const champ of ['url', 'protocol', 'health', 'variants', 'reports', 'visible', 'blocked', 'sourceId', 'licenseNote']) {
        assert.ok(champ in ligne, `champ manquant : ${champ}`);
      }
      assert.ok(['https', 'http', 'rtsp', 'rtmp', 'udp', 'autre'].includes(ligne.protocol));
      assert.equal(typeof json.counts.protocols.https, 'number');
      assert.equal(json.reportThreshold, 1000);
      assert.ok(Array.isArray(json.sources));
    });
  });

  test('les filtres de la console réduisent l’inventaire', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const tout = await client('/api/admin/links?pageSize=1', { token });
      const supprimees = await client('/api/admin/links?visibility=deleted&pageSize=1', { token });
      assert.equal(supprimees.json.total, 0);
      const https = await client('/api/admin/links?protocol=http&pageSize=1', { token });
      assert.equal(https.json.total, tout.json.counts.protocols.http, 'le filtre de protocole est exact');
      const sante = await client('/api/admin/links?health=up&pageSize=1', { token });
      assert.equal(sante.json.total, tout.json.counts.health.up);
    });
  });

  test('confirmer puis rejeter un signalement depuis l’administration', async () => {
    await withServer({}, async ({ client, login }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];
      const cree = await client('/api/report', { method: 'POST', body: { channelId: cible.id, reason: 'illicite' } });

      const { token } = await login();
      const file = await client('/api/admin/reports', { token });
      assert.equal(file.status, 200);
      assert.ok(file.json.reports.some((report) => report.ref === cree.json.ref));
      assert.equal(file.json.seuil, 1000);

      const confirme = await client(`/api/admin/reports/${cree.json.ref}/confirm`, { method: 'POST', body: {}, token });
      assert.equal(confirme.status, 200);
      assert.equal(confirme.json.status, 'confirme');
      assert.equal((await client(`/api/channels/${cible.id}`)).status, 404, 'la chaîne confirmée est masquée');

      const seconde = (await client('/api/channels?pageSize=2')).json.channels[1];
      const autre = await client('/api/report', { method: 'POST', body: { channelId: seconde.id, reason: 'categorie' } });
      const rejet = await client(`/api/admin/reports/${autre.json.ref}/reject`, { method: 'POST', body: { note: 'erreur de classement' }, token });
      assert.equal(rejet.json.status, 'rejete');
      assert.equal((await client(`/api/channels/${seconde.id}`)).status, 200, 'un rejet ne masque rien');
    });
  });

  test('le compteur d’une chaîne peut être remis à zéro', async () => {
    await withServer({}, async ({ client, login }) => {
      const page = await client('/api/channels?pageSize=1');
      const cible = page.json.channels[0];
      await client('/api/report', { method: 'POST', body: { channelId: cible.id, reason: 'autre' } });
      const { token } = await login();
      const remise = await client(`/api/admin/reports/${cible.id}/reset`, { method: 'POST', body: {}, token });
      assert.equal(remise.status, 200);
      assert.equal(remise.json.reports, 0);
      const file = await client('/api/admin/reports', { token });
      assert.equal(file.json.signalements, 0);
    });
  });
});
