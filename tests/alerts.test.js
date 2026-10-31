// tests/alerts.test.js — §10.4 : les douze seuils d'alerte, leur évaluation et leur exposition dans la console.
// Une alerte doit toujours porter une valeur, un seuil et une action : sinon c'est du bruit.

import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, test } from 'node:test';

import { ALERT_RULES, alertSummary, evaluateAlerts } from '../server/core/alerts.js';
import { EpgCache } from '../server/core/epg.js';
import { startServer, tempDataDir } from './helpers.js';

const ids = (report) => report.items.map((item) => item.id);

describe('Règles d’alerte (§10.4)', () => {
  test('douze règles, chacune avec gravité, seuil et action', () => {
    assert.equal(ALERT_RULES.length, 12);
    const seen = new Set();
    for (const rule of ALERT_RULES) {
      assert.ok(!seen.has(rule.id), `${rule.id} en double`);
      seen.add(rule.id);
      assert.ok(['warn', 'error'].includes(rule.severity), `${rule.id} : gravité invalide`);
      assert.ok(rule.action.length > 20, `${rule.id} : action trop vague`);
      assert.ok(rule.label.length > 10, `${rule.id} : libellé trop court`);
    }
  });

  test('une situation saine ne déclenche rien', () => {
    const report = evaluateAlerts({
      catalogVariationPct: 0.4, lowConfidencePct: 2.5, downPct: 3, flakyPct: 4, autrePct: 0.2,
      ingestFailures: 0, authFailures15min: 1, diskFreeBytes: 40 * 1024 ** 3, jobDurationMs: 12_000,
      backupAgeHours: 3, storeBytes: 4 * 1024 ** 2, renderCards: 48,
    });
    assert.equal(report.level, 'ok');
    assert.equal(report.count, 0);
    assert.deepEqual(report.items, []);
  });

  test('chaque seuil se déclenche au-delà, jamais en deçà', () => {
    const cases = [
      ['catalog.jump', { catalogVariationPct: 6 }, { catalogVariationPct: 5 }],
      ['catalog.lowConfidence', { lowConfidencePct: 11 }, { lowConfidencePct: 10 }],
      ['health.down', { downPct: 41 }, { downPct: 40 }],
      ['health.flaky', { flakyPct: 26 }, { flakyPct: 25 }],
      ['ingest.failures', { ingestFailures: 2 }, { ingestFailures: 1 }],
      ['auth.fail', { authFailures15min: 21 }, { authFailures15min: 20 }],
      ['disk.free', { diskFreeBytes: 500 * 1024 ** 2 }, { diskFreeBytes: 2 * 1024 ** 3 }],
      ['job.duration', { jobDurationMs: 95_000 }, { jobDurationMs: 80_000 }],
      ['backup.age', { backupAgeHours: 27 }, { backupAgeHours: 20 }],
      ['store.size', { storeBytes: 41 * 1024 ** 2 }, { storeBytes: 20 * 1024 ** 2 }],
      ['render.cards', { renderCards: 121 }, { renderCards: 60 }],
      ['category.autre', { autrePct: 16 }, { autrePct: 12 }],
    ];
    for (const [id, above, below] of cases) {
      assert.ok(ids(evaluateAlerts(above)).includes(id), `${id} devrait se déclencher au-dessus du seuil`);
      assert.equal(ids(evaluateAlerts(below)).includes(id), false, `${id} ne doit pas se déclencher sous le seuil`);
    }
  });

  test('les alertes bloquantes passent devant et fixent le niveau', () => {
    const report = evaluateAlerts({ downPct: 60, autrePct: 20, lowConfidencePct: 30 });
    assert.equal(report.level, 'error');
    assert.equal(report.items[0].severity, 'error');
    assert.ok(ids(report).includes('health.down'));
    assert.equal(report.count >= 3, true);
    for (const item of report.items) {
      assert.equal(typeof item.action, 'string');
      assert.equal(Number.isFinite(item.value), true);
      assert.equal(Number.isFinite(item.threshold), true);
    }
  });

  test('une valeur absente ne déclenche pas d’alerte fantôme', () => {
    const report = evaluateAlerts({});
    assert.equal(report.count, 0, 'sans métrique, aucun seuil ne peut être franchi');
    assert.equal(alertSummary(report).label, 'Aucune alerte');
  });
});

describe('Alertes exposées par la console', () => {
  test('/api/admin/stats renvoie les alertes et leurs métriques', async (t) => {
    const dataDir = await tempDataDir();
    const server = await startServer({ dataDir });
    t.after(async () => { await server.stop(); });

    const login = await server.login();
    assert.equal(login.status, 200, 'connexion administrateur');
    const response = await server.client('/api/admin/stats', { token: login.token });
    assert.equal(response.status, 200);
    const alerts = response.json.alerts;
    assert.ok(alerts, 'bloc alerts absent des statistiques');
    assert.ok(['ok', 'warn', 'error'].includes(alerts.level));
    assert.ok(Array.isArray(alerts.items));
    for (const key of ['downPct', 'flakyPct', 'autrePct', 'lowConfidencePct', 'storeBytes', 'backupAgeHours']) {
      assert.ok(key in alerts.metrics, `${key} manquant dans les métriques`);
    }
    assert.equal(typeof alerts.metrics.downPct, 'number');
  });
});

describe('Guide des programmes servi par l’API', () => {
  test('sans adresse configurée, /api/epg explique et ne casse rien', async (t) => {
    const dataDir = await tempDataDir();
    const server = await startServer({ dataDir });
    t.after(async () => { await server.stop(); });
    const response = await server.client('/api/epg');
    assert.equal(response.status, 200);
    assert.equal(response.json.enabled, false);
    assert.match(response.json.message, /guide/i);
  });

  test('une adresse injoignable produit une grille vide et un message, sans erreur 500', async (t) => {
    const dataDir = await tempDataDir();
    const server = await startServer({ dataDir });
    t.after(async () => { await server.stop(); });
    const login = await server.login();
    const patched = await server.client('/api/admin/settings', {
      method: 'PATCH', token: login.token, body: { epgUrl: 'https://127.0.0.1:9/guide.xml' },
    });
    assert.equal(patched.status, 200, patched.text);
    const response = await server.client('/api/epg');
    assert.equal(response.status, 200, 'une panne d’EPG ne doit jamais produire d’erreur 500');
    assert.equal(response.json.enabled, true);
    assert.equal(response.json.valid, false);
    assert.match(response.json.message, /guide|grille/i);
    assert.deepEqual(response.json.grid, []);
    assert.equal(/(ECONN|fetch failed|undefined|null)/.test(response.json.message), false);
  });

  test('le cache sait consommer un guide réel servi en HTTP local', async (t) => {
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');
    const { gzipSync } = await import('node:zlib');
    const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url));
    const gz = gzipSync(xml);
    const local = createServer((req, res) => {
      if (req.url.startsWith('/guide.xml.gz')) {
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
        res.end(gz);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(xml);
    });
    await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => local.close(resolve)));
    const { port } = local.address();

    const plain = new EpgCache({ ttlMs: 1000 });
    const first = await plain.load(`http://127.0.0.1:${port}/guide.xml`);
    assert.equal(first.ok, true, first.message);
    assert.equal(first.parsed.stats.programmes, 3);

    const compressed = new EpgCache({ ttlMs: 1000 });
    const second = await compressed.load(`http://127.0.0.1:${port}/guide.xml.gz`);
    assert.equal(second.ok, true, 'le gzip est reconnu à la signature, pas à l’extension');
    assert.equal(second.parsed.stats.programmes, 3);
  });

  test('un guide invalide n’empêche pas le reste du site de répondre', async (t) => {
    const { createServer } = await import('node:http');
    const local = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Page d’erreur du fournisseur</body></html>');
    });
    await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => local.close(resolve)));
    const { port } = local.address();
    const cache = new EpgCache({ ttlMs: 1000 });
    const result = await cache.load(`http://127.0.0.1:${port}/guide.xml`);
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 20);
  });
});

test('un port fermé provoque un refus immédiat, pas une attente de 15 secondes', async () => {
  const probe = net.connect({ port: 9, host: '127.0.0.1' });
  const refused = await new Promise((resolve) => {
    probe.once('error', () => resolve(true));
    probe.once('connect', () => { probe.destroy(); resolve(false); });
  });
  assert.equal(refused, true, 'le port 9 doit être fermé : le test suivant est valide');
});
