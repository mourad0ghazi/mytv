// tests/relais.test.js — relais HLS 3.21.0 : liste blanche licenciée, réécriture des
// playlists, fragments servis, refus opposables. Aucun accès réseau externe : le diffuseur
// est un serveur local.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test, { describe } from 'node:test';

import {
  RELAY_LIMITS,
  createGate,
  fetchRelay,
  hostOf,
  relayAllowlist,
  relayInfo,
  relayPath,
  relayTarget,
  rewritePlaylist,
} from '../server/core/relay.js';
import { sortChannels } from '../server/core/search.js';
import { freePort, tempDataDir, withServer } from './helpers.js';

/* ------------------------------------------------------------------ unités */

function boutique(channel) {
  return { channels: [channel], sources: [] };
}

function chaine(url, { licence = 'libre accès public', sourceId = '' } = {}) {
  return { id: 'c1', url, variants: [], licenseNote: licence, sourceId, deleted: false };
}

describe('Liste blanche du relais', () => {
  test('les hôtes des chaînes licenciées sont admis, les autres non', () => {
    const store = boutique(chaine('https://cdn.exemple.test/live.m3u8'));
    store.channels.push(chaine('https://sans-licence.test/live.m3u8', { licence: '' }));
    const allowed = relayAllowlist(store);
    assert.equal(allowed.has('cdn.exemple.test'), true);
    assert.equal(allowed.has('sans-licence.test'), false);
  });

  test('une source licenciée suffit quand la fiche ne porte pas de note', () => {
    const store = {
      channels: [chaine('https://cdn.exemple.test/live.m3u8', { licence: '', sourceId: 'src-1' })],
      sources: [{ id: 'src-1', licence: 'CC0 1.0' }],
    };
    assert.equal(relayAllowlist(store).has('cdn.exemple.test'), true);
  });

  test('une adresse hors liste blanche est refusée', () => {
    assert.throws(() => relayTarget('https://ailleurs.test/x.m3u8', new Set(['cdn.exemple.test'])), /autorisée/);
  });

  test('HTTP et les adresses illisibles sont refusés', () => {
    const allowed = new Set(['cdn.exemple.test']);
    assert.throws(() => relayTarget('http://cdn.exemple.test/x.m3u8', allowed), /format/);
    assert.throws(() => relayTarget('javascript:alert(1)', allowed), /format/);
    assert.throws(() => relayTarget('', allowed), /format/);
  });

  test('une adresse IP littérale n’est jamais relayée', () => {
    assert.throws(() => relayTarget('https://51.15.2.3/x.m3u8', new Set(['51.15.2.3'])), /autorisée/);
  });

  test('la boucle locale en HTTP passe seulement quand l’essai local l’autorise', () => {
    const allowed = new Set(['127.0.0.1']);
    assert.throws(() => relayTarget('http://127.0.0.1:8080/x.m3u8', allowed), /HTTPS/);
    assert.equal(relayTarget('http://127.0.0.1:8080/x.m3u8', allowed, { insecure: true }).port, '8080');
  });

  test('hostOf ignore une adresse illisible', () => {
    assert.equal(hostOf('pas une adresse'), '');
    assert.equal(hostOf('https://CDN.Exemple.test/x'), 'cdn.exemple.test');
  });
});

describe('Réécriture des playlists', () => {
  const makeUrl = (absolute) => `/relais?u=${encodeURIComponent(absolute)}`;

  test('les adresses relatives et absolues passent par le relais', () => {
    const source = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'chunks/index.m3u8',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://cdn.exemple.test/audio.m3u8"',
      'https://cdn.exemple.test/autre.m3u8',
    ].join('\n');
    const sortie = rewritePlaylist(source, { baseUrl: 'https://cdn.exemple.test/live/master.m3u8', makeUrl });
    assert.match(sortie, /^#EXTM3U$/m);
    assert.ok(sortie.includes(`/relais?u=${encodeURIComponent('https://cdn.exemple.test/live/chunks/index.m3u8')}`));
    assert.ok(sortie.includes(`URI="/relais?u=${encodeURIComponent('https://cdn.exemple.test/audio.m3u8')}"`));
    assert.ok(sortie.includes(`/relais?u=${encodeURIComponent('https://cdn.exemple.test/autre.m3u8')}`));
  });

  test('les clés et l’initialisation sont réécrites aussi', () => {
    const source = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:4.0,',
      'seg1.ts',
    ].join('\n');
    const sortie = rewritePlaylist(source, { baseUrl: 'https://cdn.exemple.test/v/stream.m3u8', makeUrl });
    assert.ok(sortie.includes(`URI="/relais?u=${encodeURIComponent('https://cdn.exemple.test/v/init.mp4')}"`));
    assert.ok(sortie.includes(`URI="/relais?u=${encodeURIComponent('https://cdn.exemple.test/v/key.bin')}"`));
    assert.ok(sortie.includes('/relais?u=' + encodeURIComponent('https://cdn.exemple.test/v/seg1.ts')));
  });

  test('un hôte hors liste blanche reste en clair, jamais relayé', () => {
    const source = ['#EXTM3U', 'https://ailleurs.test/x.ts'].join('\n');
    const sortie = rewritePlaylist(source, {
      baseUrl: 'https://cdn.exemple.test/live.m3u8',
      makeUrl,
      allowlist: new Set(['cdn.exemple.test']),
    });
    assert.equal(sortie, source);
  });

  test('une adresse de données n’est pas touchée', () => {
    const source = '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="data:text/vtt;base64,QQ=="';
    assert.equal(rewritePlaylist(source, { baseUrl: 'https://cdn.exemple.test/x.m3u8', makeUrl }), source);
  });
});

describe('Informations publiées sur le relais', () => {
  test('une chaîne relayable annonce son adresse, une autre non', () => {
    const store = boutique(chaine('https://cdn.exemple.test/live.m3u8'));
    assert.deepEqual(relayInfo(store, store.channels[0]), { available: true, url: relayPath('c1') });
    store.channels.push(chaine('https://sans-licence.test/live.m3u8', { licence: '' }));
    assert.deepEqual(relayInfo(store, store.channels[1]), { available: false, url: '' });
  });

  test('le chemin d’un fragment porte son adresse encodée', () => {
    assert.equal(relayPath('abc', 'https://cdn.exemple.test/a b.ts'), '/api/relais/abc/s?u=https%3A%2F%2Fcdn.exemple.test%2Fa%20b.ts');
  });
});

describe('Garde du relais', () => {
  test('au-delà du plafond, la requête est refusée au lieu de saturer la mémoire', async () => {
    const gate = createGate(1);
    let liberer;
    const premier = gate.run(() => new Promise((resolve) => { liberer = resolve; }));
    await Promise.resolve();
    await assert.rejects(gate.run(async () => 'jamais'), /Trop de tentatives/);
    liberer();
    await premier;
    assert.equal(gate.inFlight, 0);
  });

  test('une playlist trop grosse est refusée', async () => {
    const serveur = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end(Buffer.alloc(RELAY_LIMITS.playlistBytes + 10, 35));
    });
    await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = serveur.address();
      await assert.rejects(
        fetchRelay(new URL(`http://127.0.0.1:${port}/gros.m3u8`), { maxBytes: RELAY_LIMITS.playlistBytes }),
        /volumineux/,
      );
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
    }
  });
});

/* --------------------------------------------------------------- intégration */

async function diffuseur(port) {
  const playlists = new Map();
  const serveur = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/live/master.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nchunks/index.m3u8\n');
      return;
    }
    if (url.pathname === '/live/chunks/index.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end([
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:4',
        '#EXTINF:4.0,',
        'seg1.ts',
        '#EXTINF:4.0,',
        'https://hors-liste.test/intrus.ts',
      ].join('\n'));
      return;
    }
    if (url.pathname === '/live/chunks/seg1.ts') {
      const fragment = Buffer.alloc(188 * 2, 0);
      fragment[0] = 0x47;
      fragment[188] = 0x47;
      playlists.set('segments', (playlists.get('segments') || 0) + 1);
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.end(fragment);
      return;
    }
    if (url.pathname === '/redirection.m3u8') {
      res.writeHead(302, { location: '/live/master.m3u8' });
      res.end();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('absent');
  });
  await new Promise((resolve) => serveur.listen(port, '127.0.0.1', resolve));
  return { serveur, playlists };
}

describe('Relais HTTP', () => {
  test('une chaîne dont le diffuseur refuse le navigateur est relue par le serveur', async () => {
    const dir = await tempDataDir({ seed: null });
    const port = await freePort();
    const { serveur, playlists } = await diffuseur(port);
    await fsp.writeFile(path.join(dir, 'seed', 'seed.m3u'), [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="relais.test" group-title="Test",Chaîne relayée',
      `http://127.0.0.1:${port}/live/master.m3u8`,
    ].join('\n'));
    try {
      await withServer({ dataDir: dir, env: { STREAMTV_RELAIS_HTTP: '1' } }, async (server) => {
        const liste = await server.client('/api/channels?pageSize=5');
        const chaineRelayee = liste.json.channels[0];
        assert.ok(chaineRelayee, liste.text);

        const fiche = await server.client(`/api/channels/${chaineRelayee.id}`);
        assert.equal(fiche.json.channel.relay.available, true);
        assert.equal(fiche.json.channel.relay.url, `/api/relais/${chaineRelayee.id}/flux.m3u8`);

        const master = await server.client(`/api/relais/${chaineRelayee.id}/flux.m3u8`);
        assert.equal(master.status, 200, master.text);
        assert.match(master.headers.get('content-type'), /mpegurl/);
        const adresseVariante = new RegExp(`/api/relais/${chaineRelayee.id}/s\\?u=([^\\s]+)`).exec(master.text)[1];
        const varianteAbsolue = decodeURIComponent(adresseVariante);
        assert.equal(varianteAbsolue, `http://127.0.0.1:${port}/live/chunks/index.m3u8`);

        const variante = await server.client(`/api/relais/${chaineRelayee.id}/s?u=${adresseVariante}`);
        assert.equal(variante.status, 200, variante.text);
        assert.match(variante.text, /seg1\.ts/);
        // L'intrus hors liste blanche reste en clair : le relais ne le sert jamais.
        assert.match(variante.text, /https:\/\/hors-liste\.test\/intrus\.ts/);
        const adresseFragment = new RegExp(`/api/relais/${chaineRelayee.id}/s\\?u=[^\\s]+seg1\\.ts`).exec(variante.text)[0];

        const fragment = await server.client(adresseFragment);
        assert.equal(fragment.status, 200);
        assert.equal(fragment.headers.get('content-type'), 'video/mp2t');
        assert.equal(fragment.headers.get('cache-control'), 'private, max-age=4');
        assert.equal(fragment.text.length > 0, true);
        assert.equal(playlists.get('segments'), 1);
      });
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('les refus sont explicites : hors liste, adresse absente, chaîne inconnue, redirection', async () => {
    const dir = await tempDataDir({ seed: null });
    const port = await freePort();
    const { serveur } = await diffuseur(port);
    await fsp.writeFile(path.join(dir, 'seed', 'seed.m3u'), [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="relais.test",Chaîne relayée',
      `http://127.0.0.1:${port}/live/master.m3u8`,
    ].join('\n'));
    try {
      await withServer({ dataDir: dir, env: { STREAMTV_RELAIS_HTTP: '1' } }, async (server) => {
        const liste = await server.client('/api/channels?pageSize=5');
        const id = liste.json.channels[0].id;

        const horsListe = await server.client(`/api/relais/${id}/s?u=${encodeURIComponent('https://ailleurs.test/x.m3u8')}`);
        assert.equal(horsListe.status, 403);
        assert.equal(horsListe.json.code, 'ERR-09');

        const absente = await server.client(`/api/relais/${id}/s`);
        assert.equal(absente.status, 400);
        assert.equal(absente.json.code, 'ERR-02');

        const inconnue = await server.client('/api/relais/000000000000/flux.m3u8');
        assert.equal(inconnue.status, 404);
        assert.equal(inconnue.json.code, 'ERR-10');

        const redirection = await server.client(`/api/relais/${id}/s?u=${encodeURIComponent(`http://127.0.0.1:${port}/redirection.m3u8`)}`);
        assert.equal(redirection.status, 403);
        assert.equal(redirection.json.code, 'ERR-09');

        const introuvable = await server.client(`/api/relais/${id}/s?u=${encodeURIComponent(`http://127.0.0.1:${port}/absent.m3u8`)}`);
        assert.equal(introuvable.status, 422);
        assert.equal(introuvable.json.code, 'ERR-16');
      });
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('sans l’autorisation d’essai, un flux HTTP n’est pas relayé', async () => {
    const dir = await tempDataDir({ seed: null });
    const port = await freePort();
    const { serveur } = await diffuseur(port);
    await fsp.writeFile(path.join(dir, 'seed', 'seed.m3u'), [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="relais.test",Chaîne relayée',
      `http://127.0.0.1:${port}/live/master.m3u8`,
    ].join('\n'));
    try {
      await withServer({ dataDir: dir }, async (server) => {
        const liste = await server.client('/api/channels?pageSize=5');
        const id = liste.json.channels[0].id;
        const fiche = await server.client(`/api/channels/${id}`);
        assert.equal(fiche.json.channel.relay.available, false);
        const refus = await server.client(`/api/relais/${id}/flux.m3u8`);
        assert.equal(refus.status, 400);
        assert.equal(refus.json.code, 'ERR-04');
      });
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ tri */

describe('Tri par lisibilité', () => {
  test('les flux mesurés joignables passent devant, les hors service derrière', () => {
    const base = (id, number, health) => ({ id, number, name: id, health, category: 'info', confidence: 0.5, quality: 'SD', createdAt: '' });
    const list = [
      base('b', 2, 'down'),
      base('a', 1, 'unknown'),
      base('c', 3, 'up'),
      base('d', 4, 'flaky'),
    ];
    assert.deepEqual(sortChannels(list, 'lisibilite').map((item) => item.id), ['c', 'd', 'a', 'b']);
    assert.deepEqual(sortChannels(list, 'inconnu').map((item) => item.id), ['a', 'b', 'c', 'd']);
  });
});
