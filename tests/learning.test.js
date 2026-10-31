// tests/learning.test.js — F-22 : apprendre des corrections, sans jamais écraser une règle manuelle.
// On vérifie la formule (TF-IDF simple), les bornes de poids, le silence sous le seuil de support,
// la priorité du manuel, et l'effet réel sur le classement d'une chaîne.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { compileRules, classify } from '../server/core/classify.js';
import {
  STOPWORDS, effectiveRules, learnFromCorrections, mergeRules, tokenizeName,
} from '../server/core/learning.js';
import { startServer, tempDataDir } from './helpers.js';

const weightOf = (entry) => Number(String(entry).split('|')[1]);

describe('Découpage des noms (F-22)', () => {
  test('la qualité, les chiffres seuls et les mots vides disparaissent', () => {
    assert.deepEqual(tokenizeName('Cinema Palace HD'), ['cinema', 'palace']);
    assert.deepEqual(tokenizeName('Al Aoula 4K'), ['aoula']);
    assert.deepEqual(tokenizeName('TV 1080 HD'), []);
    assert.deepEqual(tokenizeName('  '), []);
  });

  test('les accents et la casse sont neutralisés, les doublons retirés', () => {
    assert.deepEqual(tokenizeName('Télé Cinéma TÉLÉ'), ['tele', 'cinema']);
    assert.ok(STOPWORDS.has('tv'));
    assert.ok(!STOPWORDS.has('sport'));
  });
});

describe('Apprentissage des corrections (F-22)', () => {
  const corrections = [
    { name: 'Al Aoula Sport', from: 'divertissement', to: 'sport' },
    { name: 'Sport 360', from: 'divertissement', to: 'sport' },
    { name: 'Bein Sport News', from: 'info', to: 'sport' },
    { name: 'Cinema Palace', from: 'divertissement', to: 'cinema' },
    { name: 'Cinema Club', from: 'divertissement', to: 'cinema' },
    { name: 'Cinema Sport', from: 'sport', to: 'cinema' },
  ];

  test('un terme récurrent devient une règle pondérée dans la bonne catégorie', () => {
    const { rules, stats } = learnFromCorrections(corrections);
    assert.ok(rules.sport.includes('sport|0.69') || rules.sport.some((entry) => entry.startsWith('sport|')));
    assert.ok(rules.cinema.some((entry) => entry.startsWith('cinema|')));
    assert.equal(stats.corrections, 6);
    assert.equal(stats.usable, 6);
    assert.equal(stats.categories, 2);
    assert.equal(stats.minSupport, 2);
  });

  test('les poids restent dans [0,30 ; 0,90], donc sous une règle manuelle (1)', () => {
    const { rules } = learnFromCorrections(corrections);
    for (const entries of Object.values(rules)) {
      for (const entry of entries) {
        const weight = weightOf(entry);
        assert.ok(Number.isFinite(weight), `poids illisible : ${entry}`);
        assert.ok(weight >= 0.3 && weight <= 0.9, `poids hors bornes : ${entry}`);
      }
    }
  });

  test('un terme vu une seule fois n’apprend rien (support minimal 2)', () => {
    const { rules, stats } = learnFromCorrections([{ name: 'Unique Chaîne', to: 'musique' }]);
    assert.deepEqual(rules, {});
    assert.equal(stats.usable, 1);
    assert.equal(stats.terms, 0);
  });

  test('une correction vers « autre » n’apprend rien, une catégorie inconnue non plus', () => {
    const { rules } = learnFromCorrections([
      { name: 'Sport 1', to: 'autre' }, { name: 'Sport 2', to: 'autre' },
      { name: 'Sport 3', to: 'inexistante' }, { name: 'Sport 4', to: 'inexistante' },
    ]);
    assert.deepEqual(rules, {});
  });

  test('un terme partagé entre deux catégories est moins fort qu’un terme exclusif', () => {
    const { rules } = learnFromCorrections(corrections);
    const shared = weightOf(rules.sport.find((entry) => entry.startsWith('sport|')));
    const exclusive = weightOf(rules.cinema.find((entry) => entry.startsWith('cinema|')));
    assert.ok(exclusive > shared, `cinema (${exclusive}) devrait dépasser sport (${shared})`);
  });

  test('le nombre de termes par catégorie est plafonné', () => {
    const many = Array.from({ length: 90 }, (_, index) => ({ name: `Sport Mot${index}`, to: 'sport' }));
    const { rules } = learnFromCorrections(many, { maxPerCategory: 10, minSupport: 2 });
    assert.ok(rules.sport.length <= 10, `${rules.sport.length} termes retenus`);
  });

  test('les règles manuelles ne sont jamais affaiblies ni dupliquées', () => {
    const { rules } = learnFromCorrections(corrections);
    const merged = mergeRules({ sport: ['sport|1', 'rugby'] }, rules);
    assert.equal(merged.sport[0], 'sport|1');
    assert.equal(merged.sport.filter((entry) => entry.split('|')[0] === 'sport').length, 1, 'aucun doublon');
    const table = compileRules(merged);
    assert.equal(table.get('sport').get('sport'), 1, 'le poids manuel reste 1');
  });

  test('effectiveRules combine manuel et appris dans cet ordre', () => {
    const learning = { rules: { sport: ['rugby|1'] }, learned: { sport: ['sport|0.5'] } };
    assert.deepEqual(effectiveRules(learning).sport, ['rugby|1', 'sport|0.5']);
    assert.deepEqual(effectiveRules({}), {});
  });

  test('l’apprentissage change réellement le classement d’une chaîne ambiguë', () => {
    const channel = { name: 'Zeta Sport', group: '', tvgId: '', category: '', manualOverride: false };
    const before = classify(channel, { table: compileRules({}) });
    const after = classify(channel, { table: compileRules(mergeRules({}, learnFromCorrections(corrections).rules)) });
    assert.equal(before.category, 'sport', 'le lexique de base connaît déjà « sport »');
    assert.equal(after.category, 'sport');
    assert.ok(after.confidence >= before.confidence, 'la confiance ne baisse pas');

    // Sur un terme inconnu du lexique de base, l'apprentissage fait basculer la décision.
    const unknown = [
      { name: 'Zorglub 1', to: 'musique' }, { name: 'Zorglub 2', to: 'musique' },
    ];
    const learned = learnFromCorrections(unknown, { minSupport: 2 }).rules;
    const without = classify({ name: 'Zorglub Live' }, { table: compileRules({}) });
    const withLearning = classify({ name: 'Zorglub Live' }, { table: compileRules(mergeRules({}, learned)) });
    assert.equal(without.category, 'autre');
    assert.equal(withLearning.category, 'musique');
    assert.ok(withLearning.reasons.some((reason) => reason.includes('zorglub')), 'la justification cite le terme appris');
  });
});

describe('Apprentissage branché sur l’administration', () => {
  test('deux corrections identiques créent des règles apprises visibles et persistées', async (t) => {
    const dataDir = await tempDataDir();
    const server = await startServer({ dataDir });
    t.after(async () => { await server.stop(); });

    const login = await server.login();
    const list = await server.client('/api/admin/channels?pageSize=3', { token: login.token });
    assert.equal(list.status, 200);
    const ids = list.json.channels.slice(0, 2).map((channel) => channel.id);

    for (const id of ids) {
      const response = await server.client(`/api/admin/channels/${id}/tag`, {
        method: 'POST', token: login.token, body: { category: 'musique' },
      });
      assert.equal(response.status, 200, response.text);
    }

    const rules = await server.client('/api/admin/rules', { token: login.token });
    assert.equal(rules.status, 200);
    assert.ok(rules.json.learnedStats.corrections >= 2, 'les corrections sont comptées');
    assert.ok(rules.json.learnedStats.usable >= 1);
    assert.equal(typeof rules.json.learned, 'object');
    assert.equal(rules.json.custom && typeof rules.json.custom, 'object', 'les règles manuelles restent séparées');
  });
});
