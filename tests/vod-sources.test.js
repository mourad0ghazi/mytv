// tests/vod-sources.test.js — Anime, Films et Sources par HTTP (3.18.0).
// Ce que ces tests tiennent : un catalogue public qui ne montre que des contenus licenciés,
// une source qui ne s'importe jamais sans licence, une priorité qui arbitre les doublons,
// et le seuil de signalements qui retire un anime ou un film comme il retire une chaîne.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { withServer } from './helpers.js';

async function proprietaire(server) {
  const { token } = await server.login();
  return token;
}

describe('Catalogue public Anime et Films (3.18.0)', () => {
  test('GET /api/anime sert trois sections, paginées, avec licence et affiche', async () => {
    await withServer({}, async ({ client }) => {
      const { status, json } = await client('/api/anime');
      assert.equal(status, 200);
      assert.ok(json.total >= 7, `${json.total} anime publiés`);
      assert.equal(json.page, 1);
      assert.ok(json.rows.length >= 1, 'les rangées de sections sont servies');
      assert.ok(json.facets.genres.length > 0, 'les genres alimentent les filtres');
      for (const item of json.items) {
        assert.ok(item.licence, `licence absente sur ${item.id}`);
        assert.ok(item.sourceNom, `source absente sur ${item.id}`);
        assert.equal(item.type, 'anime');
        assert.equal(item.episodeCount >= 1, true, 'une fiche publique a au moins un épisode');
      }
      const sections = new Set(json.items.map((item) => item.section));
      for (const section of sections) {
        assert.ok(['simulcast', 'classiques', 'films_animation'].includes(section));
      }
    });
  });

  test('GET /api/films groupe les genres sans dépasser le réglage', async () => {
    await withServer({}, async ({ client }) => {
      const { status, json } = await client('/api/films');
      assert.equal(status, 200);
      assert.ok(json.total >= 6, `${json.total} films publiés`);
      assert.ok(Array.isArray(json.byGenre), 'les rangées de genres sont servies');
      assert.ok(json.byGenre.length <= 6, 'six rangées par défaut');
      for (const item of json.items) {
        assert.ok(item.licence, `licence absente sur ${item.id}`);
        assert.equal(item.type, 'film');
      }
    });
  });

  test('une fiche se lit par son identifiant, une fiche inconnue répond 404', async () => {
    await withServer({}, async ({ client }) => {
      const anime = await client('/api/anime/morevna');
      assert.equal(anime.status, 200);
      assert.equal(anime.json.anime.id, 'morevna');
      assert.ok(anime.json.anime.episodes.length >= 1);
      assert.equal(anime.json.anime.playable, true);
      assert.ok(anime.json.related.every((item) => item.licence));

      const film = await client('/api/films/charade');
      assert.equal(film.status, 200);
      assert.equal(film.json.film.id, 'charade');
      assert.equal(film.json.film.playable, true);

      assert.equal((await client('/api/anime/inexistant')).status, 404);
      assert.equal((await client('/api/films/inexistant')).status, 404);
    });
  });

  test('les pages /anime et /film existent, une fiche inconnue répond 404', async () => {
    await withServer({}, async ({ client }) => {
      assert.equal((await client('/anime')).status, 200);
      assert.equal((await client('/films')).status, 200);
      assert.equal((await client('/anime/morevna')).status, 200);
      assert.equal((await client('/film/charade')).status, 200);
      assert.equal((await client('/anime/inexistant')).status, 404);
      assert.equal((await client('/film/inexistant')).status, 404);
    });
  });

  test('le réglage vodEnabled ferme les deux catalogues sans casser le reste', async () => {
    await withServer({}, async (server) => {
      const { client } = server;
      const token = await proprietaire(server);
      const ferme = await client('/api/admin/settings', { method: 'PATCH', body: { vodEnabled: false }, token });
      assert.equal(ferme.status, 200);

      const anime = await client('/api/anime');
      assert.equal(anime.json.total, 0);
      assert.deepEqual(anime.json.items, []);
      assert.equal((await client('/api/anime/morevna')).status, 404);
      assert.equal((await client('/api/films/charade')).status, 404);

      const recherche = await client('/api/search?q=charade');
      assert.equal(recherche.json.total, 0, 'la recherche globale n’offre plus de film');

      const ouvert = await client('/api/admin/settings', { method: 'PATCH', body: { vodEnabled: true }, token });
      assert.equal(ouvert.status, 200);
      assert.ok((await client('/api/anime')).json.total >= 7);
    });
  });
});

describe('Sources publiques (3.18.0)', () => {
  test('GET /api/sources ne publie que des sources actives et licenciées, sans secret', async () => {
    await withServer({}, async ({ client }) => {
      const { status, json } = await client('/api/sources');
      assert.equal(status, 200);
      assert.ok(json.total >= 6);
      const ids = json.sources.map((source) => source.id);
      assert.equal(new Set(ids).size, ids.length, 'aucune source en double');
      for (const source of json.sources) {
        assert.ok(source.licence, `licence absente sur ${source.id}`);
        assert.equal(source.actif, true);
        assert.equal(/token=|api[_-]?key=|@/.test(source.url || ''), false, `secret dans ${source.id}`);
      }
      const anime = await client('/api/sources?contenu=anime');
      assert.ok(anime.json.sources.every((source) => source.contenu === 'anime'));
      assert.ok(anime.json.total >= 2);
    });
  });

  test('la recherche globale nomme la famille de chaque résultat', async () => {
    await withServer({}, async ({ client }) => {
      const film = await client('/api/search?q=charade');
      assert.equal(film.status, 200);
      assert.equal(film.json.results[0].kind, 'film');
      assert.equal(film.json.results[0].kindLabel, 'Film');
      assert.ok(film.json.results[0].licence);

      const anime = await client('/api/search?q=morevna');
      assert.ok(anime.json.results.some((item) => item.kind === 'anime'));

      const vide = await client('/api/search?q=');
      assert.equal(vide.json.total, 0);
      assert.deepEqual(vide.json.results, []);
    });
  });
});

describe('Console des sources (3.18.0)', () => {
  test('la liste exige une session et rappelle la licence obligatoire', async () => {
    await withServer({}, async (server) => {
      assert.equal((await server.client('/api/admin/sources')).status, 401);
      const token = await proprietaire(server);
      const { status, json } = await server.client('/api/admin/sources', { token });
      assert.equal(status, 200);
      assert.equal(json.licenceObligatoire, true);
      assert.ok(json.sources.every((source) => 'importable' in source));
      assert.ok(json.sources.every((source) => source.contenus && typeof source.contenus.total === 'number'));
    });
  });

  test('créer une source sans licence est refusé, avec licence elle est acceptée', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      const sansLicence = await server.client('/api/admin/sources', {
        method: 'POST', token,
        body: { nom: 'Source sans droits', contenu: 'film', url: 'https://exemple.test/flux.json' },
      });
      assert.equal(sansLicence.status, 422);
      assert.match(sansLicence.json.error, /licence/i);

      const mauvaiseUrl = await server.client('/api/admin/sources', {
        method: 'POST', token,
        body: { nom: 'Source test', contenu: 'film', url: 'http://exemple.test/flux.json', licence: 'CC BY 4.0' },
      });
      assert.equal(mauvaiseUrl.status, 400, 'une adresse non HTTPS est refusée');

      const creee = await server.client('/api/admin/sources', {
        method: 'POST', token,
        body: {
          nom: 'Source test', contenu: 'film', url: 'https://exemple.test/flux.json',
          licence: 'CC BY 4.0', priorite: 40, langue: 'VF',
        },
      });
      assert.equal(creee.status, 201);
      assert.equal(creee.json.source.licence, 'CC BY 4.0');
      assert.equal(creee.json.source.importable, true);

      const doublon = await server.client('/api/admin/sources', {
        method: 'POST', token,
        body: { id: 'source-test', nom: 'Doublon', contenu: 'film', url: 'https://exemple.test/2.json', licence: 'CC BY 4.0' },
      });
      assert.equal(doublon.status, 422, 'un identifiant déjà pris est refusé');

      const priorite = await server.client('/api/admin/sources/source-test', {
        method: 'PATCH', token, body: { priorite: 0 },
      });
      assert.equal(priorite.status, 400);

      const supprimee = await server.client('/api/admin/sources/source-test', { method: 'DELETE', token });
      assert.equal(supprimee.status, 200);
      const propre = await server.client('/api/admin/sources/catalogue-propre', { method: 'DELETE', token });
      assert.equal(propre.status, 422, 'la source des ajouts manuels reste en place');
    });
  });

  test('une source désactivée ne s’importe pas', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      const off = await server.client('/api/admin/sources/anime-classiques-dp', {
        method: 'PATCH', token, body: { actif: false },
      });
      assert.equal(off.status, 200);
      const refus = await server.client('/api/admin/sources/anime-classiques-dp/import', {
        method: 'POST', token, body: { payload: '[]' },
      });
      assert.equal(refus.status, 422);
      assert.match(refus.json.error, /désactivée/i);
    });
  });

  test('importer un anime déjà présent arbitre par priorité, jamais au hasard', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      // anime-classiques-dp (priorité 85) tente de remplacer une fiche détenue par
      // anime-ouverts-cc (priorité 90) : la fiche en place reste, l'arbitrage est journalisé.
      const payload = JSON.stringify([
        { id: 'morevna', title: 'Projet Morevna', licence: 'Domaine public', episodes: [] },
        { id: 'sans-droits', title: 'Sans droits', licence: '', episodes: [] },
      ]);
      const { status, json } = await server.client('/api/admin/sources/anime-classiques-dp/import', {
        method: 'POST', token, body: { payload },
      });
      assert.equal(status, 200);
      assert.equal(json.counts.duplicatesArbitrated, 1, 'un doublon entre deux sources');
      assert.equal(json.counts.skippedUnlicensed, 1, 'une fiche sans licence n’entre pas');
      assert.equal(json.arbitrations[0].winner, 'anime-ouverts-cc');
      assert.equal(json.arbitrations[0].loser, 'anime-classiques-dp');
      assert.equal(json.arbitrations[0].replaced, false);

      const fiche = await server.client('/api/admin/anime/morevna', { token });
      assert.equal(fiche.json.anime.sourceId, 'anime-ouverts-cc', 'la source prioritaire conserve la fiche');
      assert.equal((await server.client('/api/anime/sans-droits')).status, 404);

      const imports = await server.client('/api/admin/sources/imports', { token });
      assert.ok(imports.json.imports.some((record) => record.id === json.id && record.status === 'applied'));
      const reset = await server.client(`/api/admin/sources/imports/${json.id}/reset`, { method: 'POST', token });
      assert.equal(reset.status, 200);
      const encore = await server.client(`/api/admin/sources/imports/${json.id}/reset`, { method: 'POST', token });
      assert.equal(encore.status, 422, 'un import ne s’annule pas deux fois');
    });
  });

  test('un import de chaînes ajoute les entrées licenciées et journalise l’arbitrage', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      const m3u = [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="essai.1" group-title="Info",Chaîne d’essai',
        'https://exemple.test/essai.m3u8',
      ].join('\n');
      const premier = await server.client('/api/admin/sources/iptv-org/import', {
        method: 'POST', token, body: { payload: m3u },
      });
      assert.equal(premier.status, 200);
      assert.ok(premier.json.counts.added + premier.json.counts.updated >= 1);

      const second = await server.client('/api/admin/sources/iptv-org/import', {
        method: 'POST', token, body: { payload: m3u },
      });
      assert.equal(second.status, 200);
      assert.equal(second.json.counts.added, 0, 'une même source met à jour, elle ne duplique pas');

      const recherche = await server.client('/api/search?q=Cha%C3%AEne%20d%E2%80%99essai');
      assert.ok(recherche.json.results.some((item) => item.kind === 'chaine'));
    });
  });
});

describe('Console Anime et Films (3.18.0)', () => {
  test('les résumés de console comptent les fiches par source', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      assert.equal((await server.client('/api/admin/anime')).status, 401);
      const anime = await server.client('/api/admin/anime', { token });
      assert.equal(anime.status, 200);
      assert.equal(anime.json.kind, 'anime');
      assert.equal(anime.json.total, 7);
      assert.equal(anime.json.parSource.length >= 2, true);
      assert.equal(anime.json.sansLicence.count, 0);
      const films = await server.client('/api/admin/films', { token });
      assert.equal(films.status, 200);
      assert.equal(films.json.total, 6);
    });
  });

  test('une fiche sans licence ne se publie pas, et redevient publique avec sa licence', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      const prive = await server.client('/api/admin/anime/morevna', {
        method: 'PATCH', token, body: { licence: '' },
      });
      assert.equal(prive.status, 200);
      assert.equal(prive.json.anime.visible, false);
      assert.equal((await server.client('/api/anime/morevna')).status, 404, 'un contenu sans licence disparaît du public');

      const refus = await server.client('/api/admin/anime/morevna', {
        method: 'PATCH', token, body: { visible: true },
      });
      assert.equal(refus.status, 422);
      assert.match(refus.json.error, /licence/i);

      const repare = await server.client('/api/admin/anime/morevna', {
        method: 'PATCH', token, body: { licence: 'Creative Commons Attribution 3.0 (CC BY 3.0)', visible: true },
      });
      assert.equal(repare.status, 200);
      assert.equal((await server.client('/api/anime/morevna')).status, 200);
    });
  });

  test('les champs inconnus et les valeurs hors table sont refusés', async () => {
    await withServer({}, async (server) => {
      const token = await proprietaire(server);
      const champ = await server.client('/api/admin/films/charade', {
        method: 'PATCH', token, body: { url: 'https://ailleurs.test/film.mp4' },
      });
      assert.equal(champ.status, 400);
      assert.match(champ.json.error, /url/i);

      const section = await server.client('/api/admin/anime/morevna', {
        method: 'PATCH', token, body: { section: 'nimporte-quoi' },
      });
      assert.equal(section.status, 400);

      const langue = await server.client('/api/admin/films/charade', {
        method: 'PATCH', token, body: { language: 'Klingon' },
      });
      assert.equal(langue.status, 400);
    });
  });

  test('au seuil de signalements, un anime est retiré, puis restauré depuis la console', async () => {
    await withServer({ env: { STREAMTV_SEUIL_SIGNALEMENTS: '3' } }, async (server) => {
      const { client } = server;
      const cible = 'morevna';
      const adresses = ['203.0.113.11', '203.0.113.12', '203.0.113.13'];
      const reponses = [];
      for (const adresse of adresses) {
        reponses.push(await client('/api/report', {
          method: 'POST',
          headers: { 'x-forwarded-for': adresse },
          body: { animeId: cible, reason: 'droits' },
        }));
      }
      assert.equal(reponses[0].json.deleted, false);
      assert.equal(reponses[1].json.deleted, false);
      assert.equal(reponses[2].json.deleted, true, 'au troisième signalement, l’anime est retiré');
      assert.equal((await client(`/api/anime/${cible}`)).status, 404);

      const token = await proprietaire(server);
      const compteurs = await client('/api/admin/vod/reports?type=anime', { token });
      assert.ok(compteurs.json.rows.some((row) => row.id === `anime:${cible}` && row.count === 3));

      const restaure = await client(`/api/admin/vod/anime/${cible}/restore`, { method: 'POST', token, body: {} });
      assert.equal(restaure.status, 200);
      assert.equal((await client(`/api/anime/${cible}`)).status, 200);

      const remis = await client(`/api/admin/vod/anime/${cible}/reports/reset`, { method: 'POST', token, body: {} });
      assert.equal(remis.status, 200);
      assert.equal(remis.json.reports, 0);
    });
  });

  test('au seuil de signalements, un film est retiré et reste récupérable', async () => {
    await withServer({ env: { STREAMTV_SEUIL_SIGNALEMENTS: '2' } }, async (server) => {
      const { client } = server;
      const reponses = [];
      for (const adresse of ['198.51.100.21', '198.51.100.22']) {
        reponses.push(await client('/api/report', {
          method: 'POST',
          headers: { 'x-forwarded-for': adresse },
          body: { filmId: 'charade', reason: 'droits' },
        }));
      }
      assert.equal(reponses[1].json.deleted, true);
      assert.equal((await client('/api/films/charade')).status, 404);

      const token = await proprietaire(server);
      const fiche = await client('/api/admin/films/charade', { token });
      assert.equal(fiche.json.film.deleted, true, 'la fiche reste dans la console');
      const restaure = await client('/api/admin/vod/film/charade/restore', { method: 'POST', token, body: {} });
      assert.equal(restaure.status, 200);
      assert.equal((await client('/api/films/charade')).status, 200);
    });
  });
});
