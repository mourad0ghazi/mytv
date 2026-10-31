// tests/probe.test.js — la mesure prime sur l'étiquette (F-16 étendu) :
// une chaîne annoncée géo-bloquée qui répond est rendue à la lecture, une chaîne qui
// n'échoue qu'une fois n'est pas bloquée, et seule une mesure 403/451 suivie de trois
// échecs consécutifs autorise la mention « réservée à un pays ».

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { describe } from 'node:test';

import { probeChannels } from '../server/core/health.js';
import { LIMITS } from '../server/core/constants.js';

function chaine(extra = {}) {
  return {
    id: 'chaine-test', number: 1, name: 'Chaîne de test', url: '', tags: [],
    blocked: false, blockedReason: '', manualOverride: false,
    health: { status: 'unknown', checkedAt: null, latencyMs: null, cors: null, httpStatus: null, consecutiveFailures: 0 },
    ...extra,
  };
}

async function withMock(routes, run) {
  const server = createServer((req, res) => {
    const route = routes[req.url.split('?')[0]];
    if (!route) { res.writeHead(404); res.end(); return; }
    route(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Sonde de disponibilité : la mesure prime sur l’étiquette', () => {
  test('une chaîne étiquetée « géo-bloquée » qui répond est débloquée', async () => {
    await withMock({
      '/ok.m3u8': (req, res) => {
        res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n');
      },
    }, async (base) => {
      const channel = chaine({
        url: `${base}/ok.m3u8`,
        blocked: true,
        blockedReason: 'geo',
        tags: ['geo'],
      });
      const resultat = await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      assert.equal(resultat.up, 1);
      assert.equal(channel.blocked, false, 'la mesure contredit l’étiquette : la chaîne doit être lisible');
      assert.equal(channel.blockedReason, '');
      assert.equal(channel.health.status, 'up');
      assert.ok(channel.health.checkedAt, 'la date de mesure est enregistrée');
      assert.equal(channel.health.consecutiveFailures, 0);
      // L'étiquette d'origine reste dans les tags : trace de ce que disait la source.
      assert.ok(channel.tags.includes('geo'));
    });
  });

  test('un refus 403 unique ne bloque pas encore la chaîne', async () => {
    await withMock({
      '/geo.m3u8': (req, res) => { res.writeHead(403); res.end('nope'); },
    }, async (base) => {
      const channel = chaine({ url: `${base}/geo.m3u8` });
      const resultat = await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      assert.equal(resultat.down, 1);
      assert.equal(channel.health.status, 'down');
      assert.equal(channel.health.consecutiveFailures, 1);
      assert.equal(channel.blocked, false, 'un seul échec ne suffit pas');
    });
  });

  test('trois refus 403 consécutifs bloquent avec la raison « geo »', async () => {
    await withMock({
      '/geo.m3u8': (req, res) => { res.writeHead(403); res.end('nope'); },
    }, async (base) => {
      const channel = chaine({ url: `${base}/geo.m3u8` });
      for (let i = 0; i < LIMITS.downAfterFailures; i += 1) {
        await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      }
      assert.equal(channel.health.consecutiveFailures, LIMITS.downAfterFailures);
      assert.equal(channel.blocked, true);
      assert.equal(channel.blockedReason, 'geo');
    });
  });

  test('trois 404 consécutifs bloquent avec la raison « dead », pas « geo »', async () => {
    await withMock({
      '/mort.m3u8': (req, res) => { res.writeHead(404); res.end(); },
    }, async (base) => {
      const channel = chaine({ url: `${base}/mort.m3u8` });
      for (let i = 0; i < LIMITS.downAfterFailures; i += 1) {
        await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      }
      assert.equal(channel.blocked, true);
      assert.equal(channel.blockedReason, 'dead');
    });
  });

  test('une décision manuelle n’est jamais écrasée par la sonde', async () => {
    await withMock({
      '/geo.m3u8': (req, res) => { res.writeHead(403); res.end('nope'); },
    }, async (base) => {
      const channel = chaine({ url: `${base}/geo.m3u8`, blocked: true, blockedReason: 'manual', manualOverride: true });
      for (let i = 0; i < LIMITS.downAfterFailures + 1; i += 1) {
        await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      }
      assert.equal(channel.blockedReason, 'manual', 'le verrou manuel reste en place');
    });
  });

  test('un flux qui répond sans en-tête CORS est signalé « cors », pas « down »', async () => {
    await withMock({
      '/sans-cors.m3u8': (req, res) => {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n');
      },
    }, async (base) => {
      const channel = chaine({ url: `${base}/sans-cors.m3u8` });
      const resultat = await probeChannels([channel], { concurrency: 1, timeoutMs: 2000 });
      assert.equal(channel.health.status, 'flaky');
      assert.equal(resultat.results[0].reason, 'cors');
      assert.equal(channel.blocked, false, 'un défaut de CORS ne bloque pas la fiche');
    });
  });
});
