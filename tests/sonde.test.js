// tests/sonde.test.js — sonde rotative 3.20.0 : le catalogue entier est mesuré par lots,
// la position survit au redémarrage, la cause de chaque mesure est conservée et publiée.
// Aucun flux externe n'est contacté : le réseau est simulé ou servi localement.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test, { describe } from 'node:test';

import { probeChannels } from '../server/core/health.js';
import { ProbeLimiter } from '../server/core/health.js';
import { PROBE_NIGHTLY_LIMIT, nextRotatingBatch, probePool, probeStats } from '../server/core/probe-plan.js';
import { lancerRonde } from '../server/core/probe-runner.js';
import { Store } from '../server/core/store.js';
import { freePort, tempDataDir, withServer } from './helpers.js';

/* ------------------------------------------------------------------ unités */

function chaine(id, { status = 'unknown', cors = null, checkedAt = null, reason = '' } = {}) {
  return {
    id,
    name: `Chaîne ${id}`,
    url: `https://exemple.test/${id}.m3u8`,
    health: { status, checkedAt, latencyMs: null, cors, httpStatus: null, consecutiveFailures: 0, reason },
  };
}

describe('Plan de sonde rotative', () => {
  test('les lots successifs couvrent le catalogue sans repasser sur la même chaîne', () => {
    const channels = Array.from({ length: 10 }, (_, index) => chaine(`c${index}`));
    const vus = [];
    let cursor = 0;
    for (let tour = 0; tour < 5; tour += 1) {
      const plan = nextRotatingBatch(channels, { cursor, limit: 2 });
      assert.equal(plan.batch.length, 2);
      vus.push(...plan.batch.map((item) => item.id));
      cursor = plan.nextCursor;
    }
    assert.deepEqual(vus, ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'], 'un tour complet, sans doublon');
    assert.equal(cursor, 0, 'le curseur revient au début après le dernier lot');

    const reprise = nextRotatingBatch(channels, { cursor, limit: 2 });
    assert.deepEqual(reprise.batch.map((item) => item.id), ['c0', 'c1'], 'le tour suivant recommence au début');
  });

  test('un dernier lot plus court termine le tour et ramène le curseur à zéro', () => {
    const channels = Array.from({ length: 7 }, (_, index) => chaine(`d${index}`));
    const plan = nextRotatingBatch(channels, { cursor: 6, limit: 50 });
    assert.equal(plan.batch.length, 1);
    assert.equal(plan.nextCursor, 0);
    assert.equal(plan.roundComplete, true);
    assert.equal(plan.total, 7);
  });

  test('le lot ne dépasse jamais le plafond et ignore les chaînes retirées ou sans adresse', () => {
    const channels = [
      chaine('ok1'),
      { id: 'sans-url', name: 'Sans adresse', url: '', health: {} },
      { id: 'supprimee', name: 'Retirée', url: 'https://exemple.test/x.m3u8', deleted: true, health: {} },
      chaine('ok2'),
    ];
    assert.deepEqual(probePool(channels).map((item) => item.id), ['ok1', 'ok2']);
    const plan = nextRotatingBatch(channels, { cursor: 0, limit: 10_000 });
    assert.equal(plan.batch.length, 2);
    assert.equal(plan.total, 2);
  });

  test('un curseur hors bornes revient dans le catalogue au lieu de sauter un lot', () => {
    const channels = Array.from({ length: 4 }, (_, index) => chaine(`e${index}`));
    assert.deepEqual(nextRotatingBatch(channels, { cursor: 9, limit: 1 }).batch.map((item) => item.id), ['e1']);
    assert.deepEqual(nextRotatingBatch(channels, { cursor: -3, limit: 1 }).batch.map((item) => item.id), ['e1']);
    assert.deepEqual(nextRotatingBatch([], { cursor: 4, limit: 2 }).batch, []);
  });

  test('la photographie de la mesure sépare testées, lisibles et restantes', () => {
    const channels = [
      chaine('a', { status: 'up', cors: true, checkedAt: '2026-10-31T10:00:00.000Z', reason: 'ok' }),
      chaine('b', { status: 'flaky', cors: false, checkedAt: '2026-10-31T11:00:00.000Z', reason: 'cors' }),
      chaine('c', { status: 'down', checkedAt: '2026-10-31T09:00:00.000Z', reason: 'dead' }),
      chaine('d'),
      chaine('e'),
    ];
    const stats = probeStats(channels);
    assert.equal(stats.total, 5);
    assert.equal(stats.measured, 3);
    assert.equal(stats.remaining, 2);
    assert.equal(stats.up, 1);
    assert.equal(stats.readable, 1, 'instable sans CORS : non lisible au navigateur');
    assert.equal(stats.corsMissing, 1);
    assert.equal(stats.lastCheckedAt, '2026-10-31T11:00:00.000Z');
    assert.equal(stats.nightlyLimit, PROBE_NIGHTLY_LIMIT);
    assert.equal(stats.nights, 1, 'deux chaînes restantes tiennent dans une nuit');
  });
});

/* ------------------------------------------------------- ronde sans réseau */

function fausseApp(channels, { fetchImpl } = {}) {
  const sauvegardes = { channels: 0, health: 0, audit: 0 };
  const app = {
    store: {
      channels,
      probe: { cursor: 0, runs: 0, lastAt: null, tested: 0 },
      async saveChannels() { sauvegardes.channels += 1; },
      async saveHealthSnapshot() { sauvegardes.health += 1; },
      async audit() { sauvegardes.audit += 1; },
    },
    probeLimiter: new ProbeLimiter(),
  };
  return { app, sauvegardes, fetchImpl };
}

describe('Ronde sur le catalogue', () => {
  test('deux rondes testent deux lots distincts et la position est conservée', async () => {
    const channels = Array.from({ length: 6 }, (_, index) => chaine(`f${index}`));
    const { app, sauvegardes } = fausseApp(channels);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', {
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
    });
    try {
      const premiere = await lancerRonde(app, { limit: 2, actor: 'scheduler' });
      assert.equal(premiere.tested, 2);
      assert.equal(premiere.up, 2);
      assert.deepEqual(premiere.results.map((item) => item.id), ['f0', 'f1']);
      assert.equal(app.store.probe.cursor, 2);
      assert.equal(app.store.probe.runs, 1);

      const seconde = await lancerRonde(app, { limit: 2, actor: 'scheduler' });
      assert.deepEqual(seconde.results.map((item) => item.id), ['f2', 'f3'], 'aucune chaîne testée deux fois');
      assert.equal(app.store.probe.cursor, 4);
      assert.equal(app.store.probe.runs, 2);
      assert.equal(app.store.probe.tested, 4);
      assert.match(premiere.message, /restent à tester/);
      assert.ok(sauvegardes.health >= 2 && sauvegardes.audit >= 2, 'écriture et journal à chaque ronde');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('le tour se referme : la ronde suivante repart de la première chaîne', async () => {
    const channels = Array.from({ length: 3 }, (_, index) => chaine(`g${index}`));
    const { app } = fausseApp(channels);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 200, headers: { 'access-control-allow-origin': '*' } });
    try {
      await lancerRonde(app, { limit: 3 });
      assert.equal(app.store.probe.cursor, 0);
      const suivante = await lancerRonde(app, { limit: 1 });
      assert.deepEqual(suivante.results.map((item) => item.id), ['g0']);
      assert.equal(suivante.rotation.previousCursor, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('une liste d’identifiants est mesurée sans déplacer la position de la ronde', async () => {
    const channels = [chaine('h0'), chaine('h1'), chaine('h2')];
    const { app } = fausseApp(channels);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 200 });
    try {
      const resultat = await lancerRonde(app, { ids: ['h2'] });
      assert.equal(resultat.tested, 1);
      assert.equal(resultat.results[0].id, 'h2');
      assert.equal(app.store.probe.cursor, 0, 'une sonde ciblée ne change pas le curseur');
      assert.equal(resultat.rotation, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('la cause de chaque mesure est conservée : geo, dead, cors, ok', async () => {
    const channels = [chaine('i0'), chaine('i1'), chaine('i2')];
    const originalFetch = globalThis.fetch;
    let appel = 0;
    globalThis.fetch = async () => {
      appel += 1;
      if (appel === 1) return new Response('', { status: 200, headers: { 'access-control-allow-origin': '*' } });
      if (appel === 2) return new Response('', { status: 403 });
      return new Response('', { status: 404 });
    };
    try {
      await probeChannels(channels, { concurrency: 1, timeoutMs: 1000 });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(channels[0].health.status, 'up');
    assert.equal(channels[0].health.reason, 'ok');
    assert.equal(channels[1].health.status, 'down');
    assert.equal(channels[1].health.reason, 'geo');
    assert.equal(channels[2].health.status, 'down');
    assert.equal(channels[2].health.reason, 'dead');
  });
});

/* -------------------------------------------------- persistance sur disque */

describe('Position de la ronde conservée', () => {
  test('le curseur relu après redémarrage reprend au même endroit', async () => {
    const dir = await tempDataDir({ seed: 'small.m3u' });
    try {
      const premier = new Store({ dataDir: dir, logger: { info() {}, warn() {}, error() {}, debug() {} } });
      await premier.init();
      premier.probe = { cursor: 42, runs: 3, tested: 315, lastAt: '2026-10-30T03:00:00.000Z' };
      await premier.saveHealthSnapshot();
      await premier.flush();

      const second = new Store({ dataDir: dir, logger: { info() {}, warn() {}, error() {}, debug() {} } });
      await second.init();
      assert.equal(second.probe.cursor, 42);
      assert.equal(second.probe.runs, 3);
      assert.equal(second.probe.tested, 315);
      assert.equal(second.probe.lastAt, '2026-10-30T03:00:00.000Z');

      const raw = JSON.parse(await fsp.readFile(path.join(dir, 'health.json'), 'utf8'));
      assert.equal(raw.probe.cursor, 42, 'le curseur est écrit dans health.json');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('un health.json sans curseur démarre proprement à zéro', async () => {
    const dir = await tempDataDir({ seed: 'small.m3u' });
    try {
      await fsp.writeFile(path.join(dir, 'health.json'), JSON.stringify({ version: 3, counts: {}, entries: {} }));
      const store = new Store({ dataDir: dir, logger: { info() {}, warn() {}, error() {}, debug() {} } });
      await store.init();
      assert.deepEqual(store.probe, { cursor: 0, runs: 0, tested: 0, lastAt: null });
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------- routes et site public */

async function fluxLocal() {
  const server = http.createServer((req, res) => {
    if (req.url === '/bon.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*' });
      res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n');
      return;
    }
    if (req.url === '/region.m3u8') { res.writeHead(403); res.end(); return; }
    res.writeHead(404); res.end();
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('Sonde : routes, mesures publiées et filtre de lisibilité', () => {
  test('la console sonde, la ronde garde sa position, le public voit la mesure', async () => {
    const flux = await fluxLocal();
    try {
      await withServer({}, async ({ client, login }) => {
        const { token } = await login();
        const creer = async (name, url) => {
          const created = await client('/api/admin/channels', {
            method: 'POST', token,
            body: { name, url, group: 'News', category: 'info' },
          });
          assert.equal(created.status, 201, created.text);
          return created.json.channel;
        };
        const bon = await creer('Flux bon', `${flux.base}/bon.m3u8`);
        const geo = await creer('Flux région', `${flux.base}/region.m3u8`);
        const mort = await creer('Flux mort', `${flux.base}/absent.m3u8`);

        const sonde = await client('/api/admin/health/probe', {
          method: 'POST', token, body: { ids: [bon.id, geo.id, mort.id] },
        });
        assert.equal(sonde.status, 200, sonde.text);
        assert.equal(sonde.json.tested, 3);
        assert.equal(sonde.json.up, 1);
        assert.equal(sonde.json.down, 2);
        assert.match(sonde.json.message, /restent à tester|testées au moins une fois/);

        const detail = await client(`/api/channels/${bon.id}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.json.channel.health, 'up');
        assert.equal(detail.json.channel.healthDetail.reason, 'ok');
        assert.equal(detail.json.channel.healthDetail.browserPlayable, true);
        assert.match(detail.json.channel.healthCheckedAt, /^\d{4}-\d{2}-\d{2}T/);

        const detailMort = await client(`/api/channels/${mort.id}`);
        assert.equal(detailMort.json.channel.healthDetail.reason, 'dead');
        assert.equal(detailMort.json.channel.healthDetail.browserPlayable, false);

        const mesures = await client('/api/channels?etat=mesures&pageSize=60');
        assert.equal(mesures.status, 200);
        assert.equal(mesures.json.total, 3, 'seules les trois chaînes mesurées');
        const lisibles = await client('/api/channels?etat=lisibles&pageSize=60');
        assert.equal(lisibles.json.total, 1, 'une seule chaîne réellement lisible');

        const avant = await client('/api/admin/health/resume', { token });
        assert.equal(avant.status, 200);
        assert.equal(avant.json.probe.remaining > 0, true);
        assert.equal(typeof avant.json.curseur.cursor, 'number');

        const ronde = await client('/api/admin/health/ronde', { method: 'POST', token, body: { limite: 2, ids: [bon.id, geo.id] } });
        assert.equal(ronde.status, 200, ronde.text);
        assert.equal(ronde.json.tested, 2);

        const config = await client('/api/config');
        assert.equal(config.json.health.measured >= 3, true);
        assert.ok(config.json.health.remaining <= config.json.health.total);
        assert.ok(Object.prototype.hasOwnProperty.call(config.json.health, 'readable'));
      });
    } finally {
      await flux.close();
    }
  });
});

/* ------------------------------------------------------------------- rapport */

describe('Rapport de lisibilité', () => {
  test('le script lit un catalogue local et compte sans réseau', async () => {
    const dir = await tempDataDir({ seed: null });
    try {
      const channels = [
        chaine('j0', { status: 'up', cors: true, checkedAt: '2026-10-31T10:00:00.000Z', reason: 'ok' }),
        chaine('j1'),
      ].map((item) => ({ ...item, categoryLabel: 'Info', number: 1 }));
      await fsp.writeFile(path.join(dir, 'channels.json'), JSON.stringify({ version: 3, channels }));
      const { execFile } = await import('node:child_process');
      const sortie = await new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(process.cwd(), 'scripts', 'rapport-lisibilite.js'), '--json'], {
          env: { ...process.env, DATA_DIR: dir },
        }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
      });
      const rapport = JSON.parse(sortie);
      assert.equal(rapport.total, 2);
      assert.equal(rapport.measured, 1);
      assert.equal(rapport.remaining, 1);
      assert.equal(rapport.readable, 1);
      assert.equal(rapport.categories[0].label, 'Info');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('sans catalogue, le script le dit et sort en erreur', async () => {
    const dir = await tempDataDir({ seed: null });
    try {
      const { execFile } = await import('node:child_process');
      const resultat = await new Promise((resolve) => {
        execFile(process.execPath, [path.join(process.cwd(), 'scripts', 'rapport-lisibilite.js')], {
          env: { ...process.env, DATA_DIR: dir },
        }, (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }));
      });
      assert.equal(resultat.code, 1);
      assert.match(resultat.stderr, /Aucun catalogue/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
