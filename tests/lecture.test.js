// tests/lecture.test.js — verdicts de lecture (3.22.0) : la lecture réelle nourrit le
// catalogue, avec des seuils bornés, sans identité et sans blocage massif possible.
// Le diagnostic de chaîne est exercé contre un diffuseur local, jamais contre Internet.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test, { describe } from 'node:test';

import {
  LECTURE_BLOCAGES_HEURE_MAX,
  LECTURE_JOUR_MAX,
  PlaybackLedger,
  applyPlaybackFailure,
  applyPlaybackSuccess,
  empreinteVisiteur,
  lectureStats,
  seuilPour,
} from '../server/core/playback.js';
import { defaultHealth, projectCard, projectDetail } from '../server/core/channels.js';
import { LIMITS } from '../server/core/constants.js';
import { freePort, tempDataDir, withServer } from './helpers.js';

const ROOT = process.cwd();

function chaine(extra = {}) {
  return {
    id: 'abc12345',
    name: 'Chaîne test',
    url: 'https://exemple.test/live.m3u8',
    variants: [],
    tags: [],
    deleted: false,
    visible: true,
    health: defaultHealth(),
    ...extra,
  };
}

/* ------------------------------------------------------------------ unités */

describe('Seuils de lecture', () => {
  test('un refus certain bloque plus vite qu’une panne ambiguë', () => {
    assert.equal(seuilPour('dead'), 2);
    assert.equal(seuilPour('geo'), 2);
    assert.equal(seuilPour('cors'), 3);
    assert.equal(seuilPour('timeout'), 3);
  });

  test('un échec est compté par chaîne et par cause', () => {
    const ledger = new PlaybackLedger();
    assert.equal(ledger.register('c1', 'dead').reached, false);
    const second = ledger.register('c1', 'dead');
    assert.equal(second.reached, true);
    assert.equal(second.causes.dead, 2);
    assert.equal(ledger.register('c1', 'cors').reached, false, 'une autre cause repart de zéro');
    assert.equal(ledger.register('c2', 'dead').reached, false, 'les chaînes sont indépendantes');
  });

  test('un même visiteur ne compte qu’une fois par chaîne et par fenêtre', () => {
    const ledger = new PlaybackLedger();
    assert.equal(ledger.admit('203.0.113.5', 'c1').ok, true);
    const doublon = ledger.admit('203.0.113.5', 'c1');
    assert.equal(doublon.ok, false);
    assert.equal(doublon.raison, 'doublon');
    assert.equal(ledger.admit('203.0.113.5', 'c2').ok, true, 'une autre chaîne reste possible');
    assert.equal(ledger.admit('198.51.100.7', 'c1').ok, true, 'un autre visiteur compte');
  });

  test('la fenêtre expirée autorise un nouveau comptage', () => {
    let instant = Date.parse('2026-10-31T10:00:00.000Z');
    const ledger = new PlaybackLedger({ now: () => instant });
    assert.equal(ledger.admit('203.0.113.5', 'c1').ok, true);
    instant += 7 * 3600_000;
    assert.equal(ledger.admit('203.0.113.5', 'c1').ok, true);
  });

  test('le plafond journalier par visiteur est opposable', () => {
    const ledger = new PlaybackLedger();
    for (let index = 0; index < LECTURE_JOUR_MAX; index += 1) {
      assert.equal(ledger.admit('203.0.113.9', `c${index}`).ok, true);
    }
    const refus = ledger.admit('203.0.113.9', 'c-last');
    assert.equal(refus.ok, false);
    assert.equal(refus.raison, 'plafond');
  });

  test('le nombre de blocages par heure est borné', () => {
    const ledger = new PlaybackLedger();
    for (let index = 0; index < LECTURE_BLOCAGES_HEURE_MAX; index += 1) {
      assert.equal(ledger.peutBloquer(), true);
    }
    assert.equal(ledger.peutBloquer(), false);
  });

  test('l’empreinte ne conserve pas l’adresse en clair', () => {
    const empreinte = empreinteVisiteur('203.0.113.5');
    assert.equal(empreinte.length, 16);
    assert.ok(!empreinte.includes('203.0.113.5'));
    assert.equal(empreinteVisiteur('203.0.113.5'), empreinte, 'stable pour un même visiteur');
    assert.notEqual(empreinteVisiteur('203.0.113.6'), empreinte);
  });
});

describe('Application du verdict au catalogue', () => {
  test('un échec bloque la chaîne au seuil du catalogue, cause comprise', () => {
    const sujet = chaine();
    applyPlaybackFailure(sujet, { cause: 'geo', now: new Date('2026-10-31T12:00:00.000Z') });
    assert.equal(sujet.health.status, 'down');
    assert.equal(sujet.health.reason, 'geo');
    assert.equal(sujet.health.source, 'lecture');
    assert.equal(sujet.health.checkedAt, '2026-10-31T12:00:00.000Z');
    // Sans cela, la normalisation du catalogue ramènerait « down » à « flaky ».
    assert.ok(sujet.health.consecutiveFailures >= LIMITS.downAfterFailures);
  });

  test('une lecture réussie vaut mesure, CORS compris', () => {
    const sujet = chaine();
    applyPlaybackFailure(sujet, { cause: 'cors' });
    applyPlaybackSuccess(sujet);
    assert.equal(sujet.health.status, 'up');
    assert.equal(sujet.health.reason, 'ok');
    assert.equal(sujet.health.cors, true);
    assert.equal(sujet.health.consecutiveFailures, 0);
  });

  test('la console peut compter ce qui n’a été jugé que par des visiteurs', () => {
    const liste = [
      chaine({ health: { ...defaultHealth(), status: 'down', source: 'lecture' } }),
      chaine({ health: { ...defaultHealth(), status: 'up', source: 'lecture' } }),
      chaine({ health: { ...defaultHealth(), status: 'down', source: '' } }),
    ];
    assert.deepEqual(lectureStats(liste), { down: 1, up: 1 });
  });

  test('une restriction de zone déclarée par la liste d’origine est publiée', () => {
    const geo = chaine({ tags: ['geo', 'hls'] });
    assert.equal(projectCard(geo).geoRestricted, true);
    assert.equal(projectDetail(geo, { showAdult: false, autoHideAdult: true }, 'https:').geoRestricted, true);
    assert.equal(projectCard(chaine()).geoRestricted, false);
  });
});

/* ------------------------------------------------------------------ routes */

async function servir(handler) {
  const serveur = http.createServer(handler);
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  return {
    port: serveur.address().port,
    close: () => new Promise((resolve) => serveur.close(resolve)),
  };
}

function lecteur(client, channelId, verdict, cause = '', ip = '203.0.113.1') {
  return client('/api/events/lecture', {
    method: 'POST',
    body: cause ? { channelId, verdict, cause } : { channelId, verdict },
    headers: { 'x-forwarded-for': ip },
  });
}

describe('Route de verdict de lecture', () => {
  test('les signalements se cumulent jusqu’au blocage, puis une lecture réussie débloque', async () => {
    await withServer({}, async (server) => {
      const liste = await server.client('/api/channels?pageSize=3');
      assert.equal(liste.status, 200, liste.text);
      const id = liste.json.channels[0].id;

      const premier = await lecteur(server.client, id, 'echec', 'dead', '203.0.113.10');
      assert.equal(premier.status, 200, premier.text);
      assert.equal(premier.json.bloque, false);
      assert.equal(premier.json.seuil, 2);
      assert.match(premier.json.message, /1 signalement/);

      const doublon = await lecteur(server.client, id, 'echec', 'dead', '203.0.113.10');
      assert.equal(doublon.json.compte, false, 'le même visiteur ne compte pas deux fois');

      const second = await lecteur(server.client, id, 'echec', 'dead', '203.0.113.11');
      assert.equal(second.json.bloque, true);
      assert.match(second.json.message, /bloquée/);

      const fiche = await server.client(`/api/channels/${id}`);
      assert.equal(fiche.json.channel.health, 'down');
      assert.equal(fiche.json.channel.healthReason, 'dead');
      assert.equal(fiche.json.channel.healthDetail.browserPlayable, false);

      const reussite = await lecteur(server.client, id, 'ok', '', '203.0.113.12');
      assert.equal(reussite.json.compte, true);
      const apres = await server.client(`/api/channels/${id}`);
      assert.equal(apres.json.channel.health, 'up');
      assert.equal(apres.json.channel.healthDetail.browserPlayable, true);
    });
  });

  test('un échec ambigu demande trois signalements, pas deux', async () => {
    await withServer({}, async (server) => {
      const id = (await server.client('/api/channels?pageSize=1')).json.channels[0].id;
      const un = await lecteur(server.client, id, 'echec', 'cors', '198.51.100.1');
      const deux = await lecteur(server.client, id, 'echec', 'cors', '198.51.100.2');
      const trois = await lecteur(server.client, id, 'echec', 'cors', '198.51.100.3');
      assert.deepEqual([un.json.seuil, deux.json.seuil, trois.json.seuil], [3, 3, 3]);
      assert.deepEqual([un.json.bloque, deux.json.bloque, trois.json.bloque], [false, false, true]);
    });
  });

  test('les refus sont explicites : verdict, cause, chaîne inconnue', async () => {
    await withServer({}, async (server) => {
      const id = (await server.client('/api/channels?pageSize=1')).json.channels[0].id;
      const sansVerdict = await server.client('/api/events/lecture', { method: 'POST', body: { channelId: id } });
      assert.equal(sansVerdict.status, 400);
      assert.equal(sansVerdict.json.code, 'ERR-04');
      assert.equal(sansVerdict.json.field, 'verdict');

      const mauvaiseCause = await lecteur(server.client, id, 'echec', 'pas-une-cause');
      assert.equal(mauvaiseCause.status, 400);
      assert.equal(mauvaiseCause.json.field, 'cause');

      const inconnue = await lecteur(server.client, 'ffffffffff', 'ok');
      assert.equal(inconnue.status, 404);
      assert.equal(inconnue.json.code, 'ERR-10');

      const identifiantBidon = await lecteur(server.client, 'x', 'ok');
      assert.equal(identifiantBidon.status, 400);
    });
  });

  test('un refus de verdict n’exige ni compte ni session', async () => {
    await withServer({}, async (server) => {
      const id = (await server.client('/api/channels?pageSize=1')).json.channels[0].id;
      const reponse = await lecteur(server.client, id, 'ok');
      assert.equal(reponse.status, 200);
      assert.equal(reponse.headers.get('cache-control'), 'no-store');
    });
  });
});

/* ------------------------------------------------------------------ CORS du relais */

describe('CORS du relais', () => {
  test('sans origine tierce autorisée, aucune en-tête n’est ouverte', async () => {
    await withServer({}, async (server) => {
      const id = (await server.client('/api/channels?pageSize=1')).json.channels[0].id;
      const reponse = await server.client(`/api/relais/${id}/flux.m3u8`, { headers: { origin: 'https://tiers.test' } });
      assert.equal(reponse.headers.get('access-control-allow-origin'), null);
      const preflight = await server.client(`/api/relais/${id}/flux.m3u8`, { method: 'OPTIONS', headers: { origin: 'https://tiers.test' } });
      assert.notEqual(preflight.status, 200, 'le préflight n’accorde rien à une origine non autorisée');
    });
  });

  test('une origine déclarée reçoit l’accord et l’accès inter-sites, pas une autre', async () => {
    await withServer({ env: { STREAMTV_ORIGINES_PUBLIQUES: 'https://tiers.test' } }, async (server) => {
      const id = (await server.client('/api/channels?pageSize=1')).json.channels[0].id;

      const preflight = await server.client(`/api/relais/${id}/flux.m3u8`, { method: 'OPTIONS', headers: { origin: 'https://tiers.test' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://tiers.test');
      assert.match(preflight.headers.get('access-control-allow-methods'), /GET/);

      const autre = await server.client(`/api/relais/${id}/flux.m3u8`, { method: 'OPTIONS', headers: { origin: 'https://pirate.test' } });
      assert.notEqual(autre.headers.get('access-control-allow-origin'), 'https://pirate.test');

      const refus = await server.client(`/api/relais/${id}/flux.m3u8`, { headers: { origin: 'https://pirate.test' } });
      assert.equal(refus.headers.get('access-control-allow-origin'), null);
    });
  });

  test('le reste du site garde sa politique « same-origin »', async () => {
    await withServer({ env: { STREAMTV_ORIGINES_PUBLIQUES: 'https://tiers.test' } }, async (server) => {
      const reponse = await server.client('/api/config', { headers: { origin: 'https://tiers.test' } });
      assert.equal(reponse.headers.get('cross-origin-resource-policy'), 'same-origin');
      assert.equal(reponse.headers.get('access-control-allow-origin'), null);
    });
  });
});

/* ------------------------------------------------------------------ diagnostic */

function lancer(chemin, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'diagnostic-chaine.js'), ...chemin], {
      env: { ...process.env, ...env },
      timeout: 30_000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}

async function catalogueAvec(dir, url) {
  const channels = [{
    id: 'diag0001',
    name: 'Chaîne de test',
    url,
    tags: [],
    health: defaultHealth(),
    licenseNote: 'libre accès public',
    deleted: false,
  }];
  await fsp.writeFile(path.join(dir, 'channels.json'), JSON.stringify({ version: 3, channels }));
}

describe('Diagnostic d’une chaîne', () => {
  test('un flux sain est reconnu, en-têtes CORS compris', async () => {
    const diffuseur = await servir((req, res) => {
      if (req.url === '/live.m3u8') {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*' });
        res.end('#EXTM3U\n#EXTINF:4,\nseg1.ts\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp2t', 'access-control-allow-origin': '*' });
      res.end(Buffer.alloc(4));
    });
    const dir = await tempDataDir({ seed: null });
    try {
      await catalogueAvec(dir, `http://127.0.0.1:${diffuseur.port}/live.m3u8`);
      const resultat = await lancer(['Chaîne de test'], { DATA_DIR: dir });
      assert.equal(resultat.code, 0, resultat.stdout + resultat.stderr);
      assert.match(resultat.stdout, /Verdict : UP/);
      assert.match(resultat.stdout, /fragment\s+.*HTTP 200/);
    } finally {
      await diffuseur.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('un flux sans en-tête CORS est nommé : le relais peut le lire', async () => {
    const diffuseur = await servir((req, res) => {
      if (req.url === '/live.m3u8') {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4,\nseg1.ts\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.end(Buffer.alloc(4));
    });
    const dir = await tempDataDir({ seed: null });
    try {
      await catalogueAvec(dir, `http://127.0.0.1:${diffuseur.port}/live.m3u8`);
      const resultat = await lancer(['diag0001'], { DATA_DIR: dir });
      assert.equal(resultat.code, 1);
      assert.match(resultat.stdout, /Verdict : CORS/);
      assert.match(resultat.stdout, /relais du serveur peut le lire/);
    } finally {
      await diffuseur.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('un refus 403 est une restriction de zone, pas une panne', async () => {
    const diffuseur = await servir((req, res) => { res.writeHead(403); res.end('non'); });
    const dir = await tempDataDir({ seed: null });
    try {
      await catalogueAvec(dir, `http://127.0.0.1:${diffuseur.port}/live.m3u8`);
      const resultat = await lancer(['diag0001', '--json'], { DATA_DIR: dir });
      const rapport = JSON.parse(resultat.stdout);
      assert.equal(rapport.conclusion.verdict, 'geo');
      assert.match(rapport.conclusion.action, /Restriction de zone/);
    } finally {
      await diffuseur.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('une adresse expirée est reconnue comme morte', async () => {
    const diffuseur = await servir((req, res) => { res.writeHead(404); res.end('absent'); });
    const dir = await tempDataDir({ seed: null });
    try {
      await catalogueAvec(dir, `http://127.0.0.1:${diffuseur.port}/live.m3u8`);
      const resultat = await lancer(['diag0001', '--json'], { DATA_DIR: dir });
      assert.equal(JSON.parse(resultat.stdout).conclusion.verdict, 'dead');
    } finally {
      await diffuseur.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('sans catalogue, le script le dit et sort en erreur', async () => {
    const dir = await tempDataDir({ seed: null });
    try {
      const resultat = await lancer(['diag0001'], { DATA_DIR: dir });
      assert.equal(resultat.code, 1);
      assert.match(resultat.stderr, /Aucun catalogue/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('une chaîne inconnue est refusée avec des pistes, sans réseau', async () => {
    const dir = await tempDataDir({ seed: null });
    try {
      await catalogueAvec(dir, 'https://exemple.test/x.m3u8');
      const resultat = await lancer(['chaîne qui n’existe pas'], { DATA_DIR: dir });
      assert.equal(resultat.code, 1);
      assert.match(resultat.stderr, /Aucune chaîne ne correspond/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
