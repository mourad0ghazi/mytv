// tests/epg.test.js — F-23 : guide XMLTV tolérant, gzip, dates, grille et cache.
// Le guide ne doit jamais casser le site : un fichier invalide produit un message, pas une exception.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { describe, test } from 'node:test';

import {
  EpgCache, buildEpg, decodeEpgBody, decodeEntities, epgKeys, invalidEpgMessage, parseXmltv, parseXmltvDate,
} from '../server/core/epg.js';
import { messageOf } from '../server/core/messages.js';
import { ROOT } from './helpers.js';

const fixture = () => fsp.readFile(`${ROOT}/tests/fixtures/guide.xml`, 'utf8');

const VALID = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="A.fr"><display-name>A</display-name></channel>
  <programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="A.fr"><title>Midi</title></programme>
</tv>`;

describe('Décodage du corps EPG', () => {
  test('un corps gzip est détecté par son en-tête, pas par son extension', () => {
    const raw = Buffer.from(VALID, 'utf8');
    const decoded = decodeEpgBody(gzipSync(raw));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.gzip, true);
    assert.equal(decoded.text, VALID);
  });

  test('un corps en clair reste lisible', () => {
    const decoded = decodeEpgBody(Buffer.from(VALID, 'utf8'));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.gzip, false);
  });

  test('un fichier au-delà de 20 Mo est refusé avec un message clair', () => {
    const huge = Buffer.alloc(21 * 1024 * 1024, 0x20);
    const decoded = decodeEpgBody(huge);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.reason, 'taille');
    assert.match(decoded.message, /20 Mo/);
  });

  test('un corps qui n’est pas du texte est refusé', () => {
    const decoded = decodeEpgBody(Buffer.from([0x00, 0xff, 0xfe, 0x00]));
    assert.equal(decoded.ok, false);
    assert.equal(decoded.reason, 'binaire');
    assert.ok(decoded.message.length > 10);
  });

  test('un gzip tronqué est refusé sans exception', () => {
    const gz = gzipSync(Buffer.from(VALID, 'utf8')).subarray(0, 20);
    const decoded = decodeEpgBody(gz);
    assert.equal(decoded.ok, false);
    assert.ok(decoded.message.length > 10);
  });
});

describe('Dates XMLTV', () => {
  test('la forme canonique donne l’instant UTC', () => {
    assert.equal(parseXmltvDate('20261025120000 +0000'), '2026-10-25T12:00:00.000Z');
    assert.equal(parseXmltvDate('20261025120000'), '2026-10-25T12:00:00.000Z');
  });

  test('les fuseaux sont respectés dans les deux sens', () => {
    assert.equal(parseXmltvDate('20261025140000 +0200'), '2026-10-25T12:00:00.000Z');
    assert.equal(parseXmltvDate('20261025080000 -0400'), '2026-10-25T12:00:00.000Z');
  });

  test('une date absurde renvoie une chaîne vide au lieu de casser la grille', () => {
    assert.equal(parseXmltvDate('hier soir'), '');
    assert.equal(parseXmltvDate(''), '');
    assert.equal(parseXmltvDate('19000101000000 +0000'), '', 'hors bornes 1970–2200');
  });
});

describe('Analyse XMLTV', () => {
  test('la fixture donne 2 chaînes, 3 programmes et 1 ligne ignorée', async () => {
    const parsed = parseXmltv(await fixture());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.stats.channels, 2);
    assert.equal(parsed.stats.programmes, 3);
    assert.equal(parsed.stats.skipped, 1, 'une date illisible est ignorée, pas fatale');
    assert.equal(parsed.channels[0].name, 'Alpha News');
    assert.equal(parsed.channels[0].icon, 'https://example.com/alpha.png');
  });

  test('les programmes sont triés par début, fuseaux confondus', async () => {
    const parsed = parseXmltv(await fixture());
    const starts = parsed.programmes.map((entry) => entry.start);
    assert.deepEqual(starts, [...starts].sort());
    assert.equal(parsed.programmes[0].title, 'Football : direct');
  });

  test('les entités et les accents sont décodés une seule fois', async () => {
    const parsed = parseXmltv(await fixture());
    const journal = parsed.programmes.find((entry) => entry.title === 'Le journal de midi');
    assert.match(journal.description, /l’actualité de la mi-journée & les reportages/);
    assert.equal(decodeEntities('A &amp;amp; B'), 'A &amp; B');
    assert.equal(decodeEntities('&#233;t&#xe9;'), 'été');
  });

  test('un document sans &lt;tv&gt; est refusé, un XML cassé aussi', () => {
    assert.equal(parseXmltv('<html><body>Erreur 404</body></html>').ok, false);
    assert.equal(parseXmltv('<tv><programme').ok, false);
    assert.equal(parseXmltv('').ok, false);
  });

  test('un programme sans fin reçoit 30 minutes au lieu de disparaître', () => {
    const parsed = parseXmltv('<tv><programme start="20261025120000 +0000" channel="A"><title>X</title></programme></tv>');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.programmes[0].stop, '2026-10-25T12:30:00.000Z');
  });

  test('le plafond de programmes protège la mémoire', () => {
    const rows = Array.from({ length: 200_005 }, (_, index) => (
      `<programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="A"><title>${index}</title></programme>`
    )).join('');
    const parsed = parseXmltv(`<tv>${rows}</tv>`);
    assert.equal(parsed.stats.programmes, 200_000);
  });

  test('le fichier invalide produit le message ER-A15 du catalogue', () => {
    const message = invalidEpgMessage();
    assert.equal(message, messageOf('ER-A15'));
    assert.match(message, /grille/i);
    assert.equal(/\bnull\b|\bundefined\b/.test(message), false);
  });
});

describe('Correspondance des chaînes', () => {
  test('epgId, tvgId et variantes de casse sont équivalents', () => {
    const keys = epgKeys({ epgId: 'AlphaNews.fr', tvgId: 'AlphaNews.fr' });
    assert.ok(keys.includes('alphanews.fr'));
    assert.ok(epgKeys({ tvgId: 'AlphaNews.fr@HD' }).includes('alphanews.fr'), 'la qualité est retirée');
    assert.ok(epgKeys({ epgId: ' AlphaNews.fr ' }).includes('alphanews.fr'), 'les espaces sont ignorés');
  });

  test('la grille relie chaque chaîne à ses programmes et marque le direct', async () => {
    const parsed = parseXmltv(await fixture());
    const channels = [
      { id: 'a', number: 1, name: 'Alpha', tvgId: 'AlphaNews.fr' },
      { id: 'b', number: 2, name: 'Beta', epgId: 'BetaSport.ma' },
      { id: 'c', number: 3, name: 'Sans guide', tvgId: '' },
    ];
    const grid = buildEpg(channels, parsed, {
      from: Date.parse('2026-10-25T10:00:00Z'),
      to: Date.parse('2026-10-25T14:00:00Z'),
      now: Date.parse('2026-10-25T10:45:00Z'),
    });
    assert.equal(grid.matched, 2);
    assert.equal(grid.channels, 3);
    assert.equal(grid.programmes, 3);
    const alpha = grid.grid.find((row) => row.id === 'a');
    assert.deepEqual(alpha.programmes.map((entry) => entry.title), ['Le journal de midi', 'Débat']);
    const beta = grid.grid.find((row) => row.id === 'b');
    assert.equal(beta.programmes[0].live, true, 'le programme en cours est marqué');
    const none = grid.grid.find((row) => row.id === 'c');
    assert.deepEqual(none.programmes, []);
  });

  test('un identifiant de programme suffixé par la qualité reste apparié', () => {
    const parsed = parseXmltv('<tv><programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="Alpha.fr@HD"><title>Midi</title></programme></tv>');
    const grid = buildEpg([{ id: 'a', number: 1, name: 'Alpha', tvgId: 'Alpha.fr' }], parsed, {
      from: Date.parse('2026-10-25T11:00:00Z'), to: Date.parse('2026-10-25T14:00:00Z'),
    });
    assert.equal(grid.matched, 1);
    assert.equal(grid.grid[0].programmes[0].title, 'Midi');
  });

  test('une chaîne sans guide ne fait pas échouer la grille', () => {
    const grid = buildEpg([{ id: 'x', number: 1, name: 'X' }], { programmes: [] }, {});
    assert.equal(grid.matched, 0);
    assert.equal(grid.grid[0].programmes.length, 0);
  });
});

describe('Cache EPG', () => {
  test('une source injoignable produit le message ER-A15 sans exception', async () => {
    const cache = new EpgCache({ ttlMs: 1000, timeoutMs: 200 });
    const result = await cache.load('http://127.0.0.1:9/guide.xml');
    assert.equal(result.ok, false);
    assert.match(result.message, /guide|grille/i);
    assert.equal(/(ECONN|fetch failed|ENOTFOUND)/.test(result.message), false, 'aucune trace réseau');
    assert.ok(cache.stats().error.length > 0, 'l’erreur reste consultable dans les statistiques');
  });

  test('une adresse vide est refusée immédiatement', async () => {
    const cache = new EpgCache();
    const result = await cache.load('');
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 10);
  });

  test('un guide livré avec le site est lu sur le disque, sans réseau', async () => {
    const cache = new EpgCache({ publicDir: `${ROOT}/public` });
    const result = await cache.load('/epg-demo.xml');
    assert.equal(result.ok, true, result.message);
    // Guide de démonstration : 300 chaînes non bloquées, 16 créneaux de 3 h chacune.
    assert.equal(result.parsed.stats.channels, 300);
    assert.equal(result.parsed.stats.programmes >= 4800, true);
  });

  test('un chemin hors du dossier public est refusé', async () => {
    const cache = new EpgCache({ publicDir: `${ROOT}/public` });
    const escape = await cache.load('/../server/index.js');
    assert.equal(escape.ok, false, 'aucune remontée de dossier');
    const missing = await cache.load('/guide-inexistant.xml');
    assert.equal(missing.ok, false);
    assert.match(missing.message, /guide|grille/i);
  });

  test('le cache expose son état et sa fraîcheur', async () => {
    const cache = new EpgCache({ ttlMs: 60_000 });
    const absent = await cache.load('');
    assert.equal(absent.ok, false, 'sans URL configurée, pas de guide');
    assert.equal(cache.isFresh(''), false);
    const stats = cache.stats();
    assert.deepEqual(Object.keys(stats).sort(), ['channels', 'error', 'fetchedAt', 'programmes', 'source']);
    assert.equal(stats.programmes, 0);
    assert.equal(stats.fetchedAt, null);
  });

  test('le délai est respecté et le verrou évite deux téléchargements', async () => {
    let calls = 0;
    const cache = new EpgCache({
      ttlMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode(VALID).buffer };
      },
    });
    const [first, second] = await Promise.all([cache.load('https://exemple.test/g.xml'), cache.load('https://exemple.test/g.xml')]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(calls, 1, 'un seul téléchargement simultané');
    const cached = await cache.load('https://exemple.test/g.xml');
    assert.equal(cached.cached, true);
    assert.equal(calls, 1, 'le cache TTL évite un second appel');
    assert.equal(cache.stats().programmes, 1);
  });
});
