// tests/sources-vod-core.test.js — tests unitaires des modèles Sources, Anime, Films et Réglages (3.18.0).

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { SETTING_COUNT, validateSettings } from '../server/core/settings.js';
import { importFromSource, resetSourceImport } from '../server/core/source-importer.js';
import {
  computeProbeState,
  fetchWithRetry,
  probeSingleSource,
  publicSourcePayload,
  validateSourceInput,
} from '../server/core/sources.js';
import { Store } from '../server/core/store.js';
import { isPublicVodItem, queryAnime, queryFilms } from '../server/core/vod.js';

async function makeTempStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'streamtv-vod-core-'));
  const store = new Store({ dataDir: dir, logger: { error: () => {} } });
  await store.init();
  return { store, dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}

describe('Modèles de données et persistance atomique (3.18.0)', () => {
  test('channels.json, anime.json et films.json partagent le même format atomique', async () => {
    const { store, dir, cleanup } = await makeTempStore();
    try {
      await store.saveChannels('test');
      const animeRaw = JSON.parse(await fsp.readFile(path.join(dir, 'anime.json'), 'utf8'));
      const filmsRaw = JSON.parse(await fsp.readFile(path.join(dir, 'films.json'), 'utf8'));
      const channelsRaw = JSON.parse(await fsp.readFile(path.join(dir, 'channels.json'), 'utf8'));

      for (const doc of [channelsRaw, animeRaw, filmsRaw]) {
        assert.equal(doc.version, 3);
        assert.match(doc.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(typeof doc.count, 'number');
      }
      assert.ok(animeRaw.anime.length >= 3, 'au moins 3 anime réels amorcés');
      assert.ok(filmsRaw.films.length >= 3, 'au moins 3 films réels amorcés');
      assert.equal(animeRaw.anime.every(isPublicVodItem), true, 'tous les anime amorcés ont une licence');
      assert.equal(filmsRaw.films.every(isPublicVodItem), true, 'tous les films amorcés ont une licence');
    } finally {
      await cleanup();
    }
  });

  test('une seule source de vérité pour SETTING_COUNT et validation serveur des nouveaux réglages', () => {
    assert.equal(SETTING_COUNT, 24);
    const valid = validateSettings({ vodEnabled: false, vodGenreRowsMax: 4, sourceRetryBudget: 2 });
    assert.equal(valid.errors.length, 0);
    assert.equal(valid.settings.vodEnabled, false);
    assert.equal(valid.settings.vodGenreRowsMax, 4);
    assert.equal(valid.settings.sourceRetryBudget, 2);

    const outOfRange = validateSettings({ vodGenreRowsMax: 25, sourceRetryBudget: 0 });
    assert.equal(outOfRange.errors.length, 2);

    const nonInteger = validateSettings({ sourceRetryBudget: 2.5 });
    assert.equal(nonInteger.errors.length, 1);

    for (const reserved of ['anime', 'films', 'film', 'sources']) {
      const slugCheck = validateSettings({ adminPath: reserved.padEnd(8, 'x') });
      assert.equal(slugCheck.errors.length, 0);
    }
    const exactReserved = validateSettings({ adminPath: 'mentions-legales' });
    assert.equal(exactReserved.errors.length, 1);
  });

  test('une source sans licence est refusée à la création et à l’import avec un message français explicite', async () => {
    const { store, dir, cleanup } = await makeTempStore();
    try {
      assert.throws(
        () => validateSourceInput({
          nom: 'Source douteuse',
          type: 'vod',
          contenu: 'film',
          url: 'https://example.org/films.json',
          licence: '   ',
          pays: 'FR',
          langue: 'VF',
          actif: true,
          priorite: 50,
        }),
        (err) => err.code === 'ERR-16' && /Licence obligatoire/i.test(err.message),
      );

      // Même si une source en mémoire perd sa licence, l'import la refuse et la journalise.
      const unlicensedSource = {
        id: 'sans-licence',
        nom: 'Catalogue sans licence',
        type: 'vod',
        contenu: 'anime',
        url: 'https://example.org/anime.json',
        licence: '',
        pays: 'INT',
        langue: 'VOSTFR',
        actif: true,
        priorite: 99,
      };

      const countBefore = store.anime.length;
      await assert.rejects(
        () => importFromSource({
          store,
          sourceOrId: unlicensedSource,
          rawPayload: { items: [{ id: 'test-anime', title: 'Test', episodes: [{ number: 1, url: 'https://example.org/1.mp4' }] }] },
        }),
        (err) => err.code === 'ERR-16' && /Import refusé/i.test(err.message) && /aucune licence/i.test(err.message),
      );
      await store.flush();
      assert.equal(store.anime.length, countBefore, 'aucune fiche ajoutée');

      const audit = await fsp.readFile(path.join(dir, 'audit.log'), 'utf8');
      assert.match(audit, /source\.import\.refused/);
    } finally {
      await cleanup();
    }
  });

  test('un doublon entre deux sources est résolu par la priorité et systématiquement journalisé', async () => {
    const { store, dir, cleanup } = await makeTempStore();
    try {
      const sourceBasse = validateSourceInput({
        id: 'miroir-bas',
        nom: 'Miroir secondaire',
        type: 'vod',
        contenu: 'film',
        url: 'https://example.org/bas.json',
        licence: 'Domaine public',
        pays: 'FR',
        langue: 'VOSTFR',
        actif: true,
        priorite: 30,
      });
      const sourceHaute = validateSourceInput({
        id: 'catalogue-maitre',
        nom: 'Catalogue maître restauré',
        type: 'vod',
        contenu: 'film',
        url: 'https://example.org/haut.json',
        licence: 'Creative Commons Attribution 4.0 (CC BY 4.0)',
        pays: 'FR',
        langue: 'VF',
        actif: true,
        priorite: 98,
      });
      store.sources.push(sourceBasse, sourceHaute);
      await store.saveSources('test');

      // 1) Une source de priorité 30 propose « charade » déjà détenu par priorité 85 : 85 gagne.
      const resLow = await importFromSource({
        store,
        sourceOrId: 'miroir-bas',
        rawPayload: {
          items: [{
            id: 'charade',
            title: 'Charade (copie basse définition)',
            year: 1963,
            durationSeconds: 6780,
            genres: ['Thriller'],
            url: 'https://example.org/charade-low.mp4',
            quality: 'SD',
          }],
        },
      });
      assert.equal(resLow.counts.duplicatesArbitrated, 1);
      const afterLow = store.films.find((f) => f.id === 'charade');
      assert.equal(afterLow.title, 'Charade', 'la source de priorité 85 est conservée');
      assert.equal(afterLow.sourceId, 'cinema-patrimoine-dp');
      assert.equal(afterLow.sources.length, 2, 'la seconde source licenciée reste listée sur la fiche');

      // 2) Une source de priorité 98 propose « charade » : 98 gagne et remplace la fiche canonique.
      const resHigh = await importFromSource({
        store,
        sourceOrId: 'catalogue-maitre',
        rawPayload: {
          items: [{
            id: 'charade',
            title: 'Charade (Restauration 4K)',
            year: 1963,
            durationSeconds: 6785,
            genres: ['Thriller', 'Comédie'],
            director: 'Stanley Donen',
            url: 'https://example.org/charade-4k.mp4',
            quality: '4K',
          }],
        },
      });
      assert.equal(resHigh.counts.duplicatesArbitrated, 1);
      const afterHigh = store.films.find((f) => f.id === 'charade');
      assert.equal(afterHigh.title, 'Charade (Restauration 4K)');
      assert.equal(afterHigh.sourceId, 'catalogue-maitre');
      assert.equal(afterHigh.sources[0].sourceId, 'catalogue-maitre');

      await store.flush();
      const audit = await fsp.readFile(path.join(dir, 'audit.log'), 'utf8');
      const matches = audit.match(/source\.duplicate\.arbitrated/g) || [];
      assert.equal(matches.length, 2, 'les deux arbitrages sont journalisés dans audit.log');

      // 3) Remise à zéro du second import : retour propre à l'état précédent.
      const reset = await resetSourceImport({ store, importId: resHigh.id });
      assert.equal(reset.status, 'reinitialise');
      assert.equal(store.films.find((f) => f.id === 'charade').sourceId, 'cinema-patrimoine-dp');
    } finally {
      await cleanup();
    }
  });

  test('budget de tentatives et sonde par source (saine, instable, hors service)', async () => {
    let calls = 0;
    const server = http.createServer((req, res) => {
      if (req.url === '/flaky.json') {
        calls += 1;
        if (calls < 3) {
          res.writeHead(503);
          res.end('indisponible');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      if (req.url === '/ok') {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      res.writeHead(500);
      res.end('ko');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const fetched = await fetchWithRetry(`http://127.0.0.1:${port}/flaky.json`, {
        maxAttempts: 3,
        baseDelayMs: 5,
      });
      assert.equal(fetched.attemptsUsed, 3);

      let saine = {
        id: 's1', nom: 'S1', type: 'vod', contenu: 'film',
        url: `http://127.0.0.1:${port}/ok`, licence: 'CC BY 4.0', pays: 'FR', langue: 'VF', actif: true, priorite: 50,
      };
      saine.sonde = await probeSingleSource(saine);
      assert.equal(saine.sonde.etat, 'saine');
      assert.equal(saine.sonde.joignable, true);
      assert.ok(saine.sonde.tempsReponseMs >= 1);

      let hs = {
        id: 's2', nom: 'S2', type: 'vod', contenu: 'film',
        url: `http://127.0.0.1:${port}/down`, licence: 'CC BY 4.0', pays: 'FR', langue: 'VF', actif: true, priorite: 50,
      };
      hs.sonde = await probeSingleSource(hs);
      assert.equal(hs.sonde.etat, 'hors service');
      assert.equal(hs.sonde.joignable, false);

      // Deux succès puis un échec => taux d'échec 0.333 => instable.
      saine.sonde = await probeSingleSource(saine);
      saine.url = `http://127.0.0.1:${port}/down`;
      saine.sonde = await probeSingleSource(saine);
      assert.equal(saine.sonde.etat, 'instable');

      assert.equal(computeProbeState({ joignable: true, tempsReponseMs: 80, tauxEchec: 0, essais: 3 }), 'saine');
      assert.equal(computeProbeState({ joignable: true, tempsReponseMs: 120, tauxEchec: 0.3, essais: 10 }), 'instable');
      assert.equal(computeProbeState({ joignable: false, tempsReponseMs: 120, tauxEchec: 0.8, essais: 5 }), 'hors service');

      // Aucune fuite de jeton dans la représentation publique.
      const pub = publicSourcePayload({
        ...saine,
        url: 'https://example.org/feed.json?token=secret123&lang=fr',
      });
      assert.equal(pub.url, 'https://example.org/feed.json?lang=fr');
      assert.equal('seedFile' in pub, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('les rangées vides d’anime et de films ne sont jamais produites', async () => {
    const { store, cleanup } = await makeTempStore();
    try {
      const onlySimulcast = store.anime.filter((item) => item.section === 'simulcast');
      const result = queryAnime(onlySimulcast, {});
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].title, 'Simulcast de la saison');

      const emptyFilms = queryFilms([], {});
      assert.deepEqual(emptyFilms.rows, []);
      assert.deepEqual(emptyFilms.byGenre, []);
    } finally {
      await cleanup();
    }
  });
});
