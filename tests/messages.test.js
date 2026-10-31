// tests/messages.test.js — §9 : les 82 messages sont présents, exacts, sans jargon, et servis par l'API.
// Ce fichier vérifie aussi la correspondance entre les 20 codes opposables (§6.3) et les 82 messages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ERR_TO_MESSAGE, FAMILIES, MESSAGES, MESSAGE_BY_ID, catalogForClient, messageOf,
} from '../server/core/messages.js';
import { ERRORS } from '../server/core/errors.js';
import { startServer, tempDataDir } from './helpers.js';

const EXPECTED_IDS = [
  ...Array.from({ length: 20 }, (_, index) => `ER-S${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 12 }, (_, index) => `P-${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `ER-A${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 14 }, (_, index) => `ER-X${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `ER-R${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `ER-D${String(index + 1).padStart(2, '0')}`),
];

/** Textes contrôlés mot pour mot : les plus visibles du cahier des charges. */
const EXACT = {
  'ER-S01': 'Votre session a expiré. Reconnectez-vous.',
  'ER-S02': 'Mot de passe incorrect.',
  'ER-S04': 'Chaîne introuvable.',
  'ER-S05': 'Cette adresse n’existe pas.',
  'ER-S06': 'Action non autorisée sur cette adresse.',
  'ER-S07': 'Le formulaire est incomplet ou mal formé.',
  'ER-S12': 'Ce fichier n’est pas une liste M3U : aucune chaîne n’a été trouvée.',
  'ER-S11': 'Une importation est déjà en cours. Patientez.',
  'ER-S15': 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code {requestId}.',
  'P-01': 'Cette chaîne est diffusée en HTTP non sécurisé, que le navigateur bloque sur un site HTTPS.',
  'P-03': 'La source refuse les lectures depuis un autre site. Cela ne vient pas de votre connexion.',
  'P-06': 'Ce flux utilise un encodage que ce navigateur ne sait pas lire. Essayez un autre navigateur ou l’application mobile.',
  'P-07': 'Le navigateur a besoin d’une action : appuyez sur ▶.',
  'P-11': 'Cette chaîne n’a pas d’adresse de flux. Ajoutez-la dans l’administration.',
};

const JARGON = [
  /\bnull\b/i, /\bundefined\b/i, /\bNaN\b/, /TypeError/, /ReferenceError/, /SyntaxError/,
  /\bstack\b/i, /\btrace\b/i, /ECONN/, /ENOENT/, /\bEAI_AGAIN\b/, /\/api\//, /\.js\b/,
  /\bHTTP\/1\.[01]\b/, /\berrno\b/i, /\bSQL\b/i, /\bJSON\b/,
];

describe('Catalogue des 82 messages (§9)', () => {
  test('les 82 identifiants sont présents, une seule fois, dans l’ordre du cahier des charges', () => {
    assert.equal(MESSAGES.length, 82);
    assert.deepEqual(MESSAGES.map((entry) => entry.id), EXPECTED_IDS);
    const ids = new Set(MESSAGES.map((entry) => entry.id));
    assert.equal(ids.size, 82, 'aucun doublon');
    for (const id of EXPECTED_IDS) assert.ok(MESSAGE_BY_ID.has(id), `${id} absent de l’index`);
  });

  test('chaque message porte une famille, un texte et une cause', () => {
    const familyIds = new Set(FAMILIES.map((family) => family.id));
    for (const entry of MESSAGES) {
      assert.ok(familyIds.has(entry.family), `${entry.id} : famille inconnue`);
      assert.equal(typeof entry.text, 'string');
      assert.ok(entry.text.trim().length >= 8, `${entry.id} : texte trop court`);
      assert.ok(entry.cause.trim().length > 0, `${entry.id} : cause manquante`);
      assert.equal(/\s$/.test(entry.text), false, `${entry.id} : espace final`);
    }
  });

  test('les familles annoncent le bon nombre de messages', () => {
    const counts = Object.fromEntries(FAMILIES.map((family) => [family.id, MESSAGES.filter((entry) => entry.family === family.id).length]));
    assert.deepEqual(counts, {
      serveur: 20, lecteur: 12, administration: 16, silencieuse: 14, rendu: 10, données: 10,
    });
    for (const family of FAMILIES) assert.equal(family.count, counts[family.id], `${family.id} : compte incohérent`);
    assert.equal(FAMILIES.reduce((total, family) => total + family.count, 0), 82);
  });

  test('les textes les plus visibles sont exacts, mot pour mot', () => {
    for (const [id, text] of Object.entries(EXACT)) {
      assert.equal(MESSAGE_BY_ID.get(id).text, text, `${id} : texte modifié`);
    }
  });

  test('aucun message ne laisse passer de jargon technique', () => {
    for (const entry of MESSAGES) {
      for (const pattern of JARGON) {
        assert.equal(pattern.test(entry.text), false, `${entry.id} contient du jargon : ${pattern}`);
      }
      assert.equal(/[<>{}]/.test(entry.text.replace(/\{\w+\}/g, '')), false, `${entry.id} : balise ou accolade résiduelle`);
    }
  });

  test('les variables sont substituées et jamais laissées vides', () => {
    assert.equal(messageOf('ER-S08', { champ: 'nom' }), 'Le champ « nom » est obligatoire.');
    assert.equal(messageOf('ER-S15', { requestId: 'req-42' }), 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code req-42.');
    assert.equal(messageOf('ER-S03', { n: 7 }), 'Trop de tentatives. Réessayez dans 7 minutes.');
    assert.match(messageOf('ER-S15', {}), /\{requestId\}/, 'sans valeur, la variable reste visible');
    assert.equal(messageOf('ER-S99'), '', 'un identifiant inconnu ne produit pas de texte');
  });

  test('les 20 codes opposables renvoient tous vers un message existant', () => {
    for (const code of Object.keys(ERRORS)) {
      const target = ERR_TO_MESSAGE[code];
      assert.ok(target, `${code} n’a pas de message associé`);
      assert.ok(MESSAGE_BY_ID.has(target), `${code} renvoie vers ${target}, inconnu`);
    }
    assert.equal(Object.keys(ERR_TO_MESSAGE).length, 20);
  });

  test('le catalogue client expose les 6 familles et les 82 messages', () => {
    const client = catalogForClient();
    assert.equal(client.total, 82);
    assert.equal(client.families.length, 6);
    assert.equal(client.families.reduce((total, family) => total + family.messages.length, 0), 82);
    for (const family of client.families) {
      assert.ok(family.label.length > 3);
      for (const message of family.messages) assert.deepEqual(Object.keys(message).sort(), ['cause', 'id', 'kind', 'text']);
    }
  });
});

describe('Catalogue des messages servi par l’API', () => {
  test('/api/errors/catalog expose les 82 messages et les 20 codes', async (t) => {
    const dataDir = await tempDataDir();
    const server = await startServer({ dataDir });
    t.after(async () => {
      await server.stop();
    });
    const response = await server.client('/api/errors/catalog');
    const body = response.json;
    assert.equal(response.status, 200);
    assert.ok(body, 'réponse JSON attendue');
    assert.equal(body.total, 82);
    assert.equal(body.families.length, 6);
    assert.equal(body.count, 20);
    const ids = body.families.flatMap((family) => family.messages.map((message) => message.id));
    assert.deepEqual(ids, EXPECTED_IDS);
    for (const message of body.errors) {
      assert.ok(message.message.length > 5);
      assert.ok(message.status >= 400);
    }
  });
});
