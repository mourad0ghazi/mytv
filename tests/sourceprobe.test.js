// tests/sourceprobe.test.js — vérification d'une liste avant ingestion (F-20 étendu).
// Aucun réseau externe : un serveur HTTP local joue les flux disponibles, morts et muets.

import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, describe } from 'node:test';

import {
  epgCoverage, isHttpsEntry, overlap, probeUrl, renderPlaylist, schemeBreakdown, verifySource,
} from '../server/core/sourceprobe.js';

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/live.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n');
      return;
    }
    if (req.url === '/mp4') {
      res.writeHead(206, { 'Content-Type': 'video/mp4' });
      res.end('binary');
      return;
    }
    if (req.url === '/slow') return; // ne répond jamais : le délai doit trancher
    if (req.url === '/forbidden') {
      res.writeHead(403);
      res.end('nope');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<html>not found</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const SHORT = { timeoutMs: 250, concurrency: 4 };

describe('Sonde d’un flux isolé', () => {
  test('un manifeste HLS qui répond est « up » et reconnu comme liste', async () => {
    const out = await probeUrl(`${base}/live.m3u8`, SHORT);
    assert.equal(out.status, 'up');
    assert.equal(out.httpStatus, 200);
    assert.equal(out.playlist, true);
    assert.ok(out.latencyMs >= 0);
  });

  test('une réponse partielle (206) suffit à prouver la disponibilité', async () => {
    const out = await probeUrl(`${base}/mp4`, SHORT);
    assert.equal(out.status, 'up');
    assert.equal(out.httpStatus, 206);
  });

  test('404 et 403 sont des échecs, jamais des succès', async () => {
    assert.equal((await probeUrl(`${base}/absent`, SHORT)).status, 'down');
    assert.equal((await probeUrl(`${base}/forbidden`, SHORT)).status, 'down');
  });

  test('un flux muet tombe en délai dépassé, pas en erreur générique', async () => {
    const out = await probeUrl(`${base}/slow`, { timeoutMs: 120 });
    assert.equal(out.status, 'timeout');
    assert.equal(out.httpStatus, 0);
  });

  test('une adresse impossible à résoudre est « error », pas une exception', async () => {
    const out = await probeUrl('http://127.0.0.1:1/rien.m3u8', { timeoutMs: 500 });
    assert.ok(['error', 'timeout'].includes(out.status));
  });
});

describe('Vérification d’une liste', () => {
  // Construite à l'appel : `base` n'existe qu'une fois le serveur local démarré.
  const playlist = () => [
    '#EXTM3U',
    `#EXTINF:-1 tvg-id="Alpha.fr" tvg-logo="${base}/logo.png" group-title="Info",Alpha (720p)`,
    `${base}/live.m3u8`,
    '#EXTINF:-1 group-title="Info",Beta morte',
    `${base}/absent`,
    '#EXTINF:-1 group-title="Info",Gamma interdite',
    `${base}/forbidden`,
    '#EXTINF:-1 group-title="Info",Alpha doublon',
    `${base}/live.m3u8`,
    '#EXTINF:-1 group-title="Info",Delta en clair',
    'http://exemple.invalid/delta.m3u8',
  ].join('\n');

  // Le serveur de test écoute en http:// : on désactive le filtre de schéma pour l'éprouver.
  test('seuls les flux qui répondent sont conservés, doublon compris', async () => {
    const result = await verifySource(playlist(), { ...SHORT, httpsOnly: false, sourceLabel: 'test' });
    assert.equal(result.summary.parseStats.extinf, 5, 'cinq lignes EXTINF lues');
    assert.equal(result.summary.parsed, 4, 'le parseur écarte le doublon exact');
    assert.equal(result.summary.tested, 4, 'quatre adresses distinctes à tester');
    assert.equal(result.kept.length, 1, 'un seul flux répond');
    assert.equal(result.kept[0].name, 'Alpha');
    assert.equal(result.kept[0].probe.status, 'up');
    assert.equal(result.summary.up, 1);
    assert.equal(result.summary.down, 2);
    assert.equal(result.summary.error + result.summary.timeout, 1, 'le domaine inventé échoue proprement');
  });

  test('par défaut, un flux http: est écarté avant même d’être testé', async () => {
    const result = await verifySource(playlist(), { ...SHORT, sourceLabel: 'test' });
    assert.equal(result.summary.skippedHttp, 4, 'tous les flux locaux sont en http:');
    assert.equal(result.summary.tested, 0);
    assert.equal(result.kept.length, 0);
  });

  test('--allow-http rétablit le test des flux en clair', async () => {
    const result = await verifySource(playlist(), { ...SHORT, httpsOnly: false });
    assert.equal(result.summary.skippedHttp, 0);
    assert.equal(result.summary.tested, 4);
  });

  test('une liste vide ne lève pas d’exception', async () => {
    const result = await verifySource('', SHORT);
    assert.equal(result.kept.length, 0);
    assert.equal(result.summary.parsed, 0);
    assert.equal(result.summary.tested, 0);
  });

  test('les flux écartés gardent la trace de leur échec', async () => {
    const result = await verifySource(playlist(), { ...SHORT, httpsOnly: false });
    const codes = result.rejected.map((item) => item.probe.httpStatus).sort();
    // 403 et 404 du serveur local, et 0 pour le domaine inventé (échec réseau, pas HTTP).
    assert.deepEqual(codes, [0, 403, 404]);
  });

  test('la progression est annoncée jusqu’au dernier flux', async () => {
    const seen = [];
    await verifySource(playlist(), { ...SHORT, httpsOnly: false, onProgress: ({ done, total }) => seen.push([done, total]) });
    assert.ok(seen.length >= 2);
    assert.equal(seen.at(-1)[0], seen.at(-1)[1]);
  });
});

describe('Écriture de la liste vérifiée', () => {
  test('l’en-tête porte l’origine, la licence et le décompte', async () => {
    const result = await verifySource('#EXTM3U\n#EXTINF:-1 tvg-id="A.fr",Alpha\n' + `${base}/live.m3u8\n`, { ...SHORT, httpsOnly: false });
    const text = renderPlaylist(result.kept, {
      sourceName: 'romaxa55', sourceUrl: 'https://exemple/', license: 'MIT',
      generatedAt: '2026-10-25T00:00:00.000Z', summary: result.summary,
    });
    assert.ok(text.startsWith('#EXTM3U'));
    assert.match(text, /# source : romaxa55/);
    assert.match(text, /# licence de la liste d'origine : MIT/);
    assert.match(text, /vérifié le 2026-10-25T00:00:00.000Z/);
    assert.match(text, /retenus : 1 sur 1 testés/);
    assert.match(text, /#EXTINF:-1 tvg-id="A\.fr",Alpha/);
    assert.match(text, new RegExp(`${base}/live\\.m3u8`));
  });

  test('un guillemet dans un nom ne casse pas la ligne EXTINF', () => {
    const text = renderPlaylist([
      { name: 'La "bonne" chaîne', url: 'https://exemple/a.m3u8', group: 'Info' },
    ], {});
    assert.match(text, /#EXTINF:-1 group-title="Info",La "bonne" chaîne/);
    assert.equal(text.split('\n').filter((line) => line.startsWith('#EXTINF')).length, 1);
  });

  test('une entrée sans nom reçoit un libellé explicite', () => {
    const text = renderPlaylist([{ name: '', url: 'https://exemple/b.m3u8' }], {});
    assert.match(text, /,Chaîne sans nom/);
  });
});

describe('Indicateurs de qualité d’une source', () => {
  test('répartition https / http', () => {
    const stats = schemeBreakdown([
      { url: 'https://a' }, { url: 'http://b' }, { url: 'https://c' }, { url: 'rtmp://d' },
    ]);
    assert.deepEqual(stats, { https: 2, http: 1, other: 1, total: 4 });
  });

  test('couverture du guide par tvg-id', () => {
    const coverage = epgCoverage([{ tvgId: 'A.fr' }, { tvgId: '' }, { tvgId: 'B.ma' }, {}]);
    assert.deepEqual(coverage, { withId: 2, total: 4, ratio: 0.5 });
  });

  test('recouvrement entre deux sources', () => {
    const a = [{ url: 'https://x/1.m3u8' }, { url: 'https://x/2.m3u8' }, { url: 'https://x/3.m3u8' }];
    const b = [{ url: 'https://x/2.m3u8' }, { url: 'https://y/9.m3u8' }];
    const result = overlap(a, b);
    assert.equal(result.common, 1);
    assert.equal(result.ratio, 0.333);
    assert.equal(result.ratioB, 0.5);
  });

  test('reconnaissance du schéma des entrées', () => {
    assert.equal(isHttpsEntry({ url: 'https://a/b.m3u8' }), true);
    assert.equal(isHttpsEntry({ url: 'http://a/b.m3u8' }), false);
    assert.equal(isHttpsEntry({}), false);
  });
});
