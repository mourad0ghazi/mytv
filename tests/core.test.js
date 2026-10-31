// tests/core.test.js — algorithmes du cahier des charges : parseur, catégorisation, dédoublonnage,
// recherche, pagination, réglages. Aucune dépendance, exécution : node --test tests/.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildChannel, channelId, projectCard, sanitizeChannel, isPublic } from '../server/core/channels.js';
import { categorizeEntry, classify, compileRules, reclassifyAll, reviewQueue } from '../server/core/classify.js';
import { GENRE_GROUPS, CATEGORY_IDS } from '../server/core/constants.js';
import { dedupe, finalizeEntries } from '../server/core/dedupe.js';
import { parseM3U } from '../server/core/m3u.js';
import { buildPredicate, paginate, SearchIndex, sortChannels } from '../server/core/search.js';
import { DEFAULTS, SETTING_COUNT, validateSettings } from '../server/core/settings.js';
import {
  detectCountry, detectLanguage, detectQuality, hueFromId, normalizeKey, normalizeName, normalizeUrl, slug,
} from '../server/core/text.js';
import { ROOT } from './helpers.js';

const fixture = (name) => fsp.readFile(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');

/* ------------------------------------------------------------------ F-01 */

test('F-01 : le parseur ne lève jamais, même sur une entrée vide ou binaire', () => {
  for (const input of ['', null, undefined, '﻿#EXTM3U\n', '\u0000\u0001', '#EXTM3U\n#EXTINF:-1,Seul\n']) {
    assert.doesNotThrow(() => parseM3U(input));
  }
  assert.equal(parseM3U('').entries.length, 0);
  assert.equal(parseM3U('').warnings.length, 1);
});

test('F-01 : BOM, CRLF, attributs, nom complet malgré les virgules', async () => {
  const text = `\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-id="Test.fr" tvg-logo="https://logo.test/a.png" group-title="News",Chaîne, le retour\r\nhttps://stream.test/a.m3u8\r\n`;
  const { entries, stats } = parseM3U(text);
  assert.equal(entries.length, 1);
  assert.equal(stats.extinf, 1);
  const entry = entries[0];
  assert.equal(entry.rawName, 'Chaîne, le retour');
  assert.equal(entry.name, 'Chaîne, le retour');
  assert.equal(entry.tvgId, 'Test.fr');
  assert.equal(entry.logo, 'https://logo.test/a.png');
  assert.equal(entry.group, 'News');
  assert.equal(entry.groupKind, 'genre');
  assert.equal(entry.country, 'FR');
});

test('F-01 : #EXTGRP, EXTVLCOPT User-Agent, URL orpheline et préfixe //', async () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:-1,Groupe par EXTGRP',
    '#EXTGRP:Kids',
    'https://stream.test/extgrp.m3u8',
    '#EXTINF:-1,Protégée',
    '#EXTVLCOPT:http-user-agent=Player/2.0',
    '//stream.test/ua.m3u8',
    'https://stream.test/orpheline.m3u8',
  ].join('\n');
  const { entries, stats } = parseM3U(text);
  assert.equal(stats.extgrp, 1);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].group, 'Kids');
  assert.ok(entries[1].tags.includes('ua-required'));
  assert.equal(entries[1].url, 'https://stream.test/ua.m3u8');
  assert.equal(stats.orphans, 1);
});

test('F-01 : un fichier HLS n’est pas une playlist de chaînes', () => {
  const hls = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment1.ts\n';
  const { entries } = parseM3U(hls);
  assert.equal(entries.length, 0);
});

/* ------------------------------------------------------------------ F-02 → F-07 */

test('F-02 : normalisation d’URL stable', () => {
  assert.equal(normalizeUrl('HTTPS://Example.COM:443/Path/?b=2&a=1#top'), 'https://example.com/Path?a=1&b=2');
  assert.equal(normalizeUrl('//example.com/live.m3u8'), 'https://example.com/live.m3u8');
  assert.equal(normalizeUrl('ftp://example.com/x'), '');
  assert.equal(normalizeUrl('pas une url'), '');
});

test('F-03/F-04/F-05/F-06 : nom, qualité, identifiant, teinte', () => {
  assert.equal(normalizeName('Ma Chaîne (720p) [Not 24/7] HD'), 'Ma Chaîne');
  assert.equal(normalizeName('  Bein  SPORTS  | BACKUP '), 'Bein SPORTS');
  assert.equal(detectQuality('France 24 HD', ''), 'HD');
  assert.equal(detectQuality('Cinéma 4K', ''), '4K');
  assert.equal(detectQuality('Chaîne simple', ''), 'AUTO');
  assert.equal(slug('Chaîne du Maroc'), 'chaine-du-maroc');
  assert.equal(hueFromId('abc123abc123'), hueFromId('abc123abc123'));
  assert.ok(hueFromId('abc123abc123') >= 0 && hueFromId('abc123abc123') < 360);
  assert.equal(normalizeKey('Café  Crème'), 'cafe creme');
});

test('F-12/F-13 : pays et langue depuis le tvg-id et le groupe', () => {
  assert.equal(detectCountry({ tvgId: 'Channel.ma@HD', group: '', name: '' }), 'MA');
  assert.equal(detectCountry({ tvgId: '', group: 'France', name: '' }), 'FR');
  assert.equal(detectCountry({ tvgId: '', group: '', name: 'Maroc TV' }), 'MA');
  assert.equal(detectLanguage({ tvgId: 'Channel.ma', name: 'القناة' }), 'ar');
  assert.equal(detectLanguage({ tvgId: '', name: 'Chaîne', country: 'FR' }), 'fr');
});

/* ------------------------------------------------------------------ F-08 → F-11 */

test('F-08/F-10 : groupes de genre reconnus, casse et accents ignorés', () => {
  const table = compileRules();
  for (const group of ['News', 'Actualités', 'أخبار', 'SPORTS', 'Cinéma', 'Jeunesse', 'Musique', 'Documentary']) {
    const key = Object.keys(GENRE_GROUPS).find((entry) => normalizeKey(entry) === normalizeKey(group));
    assert.ok(key, `groupe non couvert : ${group}`);
  }
  const result = classify({ name: 'Sans indice', group: 'Sport' }, { table });
  assert.equal(result.category, 'sport');
  assert.equal(result.source, 'genre');
  assert.ok(result.confidence >= 0.85);
});

test('F-11 : la confiance reste dans [0,15 ; 0,95] et produit une justification', () => {
  const table = compileRules();
  const names = ['beIN Sports 1', 'France 24', 'Cartoon Network', 'M6', 'TV 7', 'Rotana Clip', 'القناة الأولى'];
  for (const name of names) {
    const result = classify({ name, group: 'General' }, { table });
    assert.ok(result.confidence >= 0.15 && result.confidence <= 0.95, `${name} → ${result.confidence}`);
    assert.ok(result.reasons.length > 0, `${name} sans raison`);
    assert.ok(CATEGORY_IDS.includes(result.category));
  }
});

test('F-10 : la décision manuelle est absolue', () => {
  const table = compileRules();
  const result = classify({ name: 'beIN Sports', group: 'Sports', category: 'cuisine', manualOverride: true }, { table });
  assert.equal(result.category, 'cuisine');
  assert.equal(result.source, 'manual');
  assert.equal(result.confidence, 0.99);
});

test('F-11 : reclassement en lot sans toucher aux décisions manuelles', () => {
  const channels = [
    { id: 'a', name: 'beIN Sports', group: 'Sports', category: 'autre', confidence: 0.3, manualOverride: false, reasons: [] },
    { id: 'b', name: 'Chaîne verrouillée', group: 'Sports', category: 'cuisine', confidence: 1, manualOverride: true, reasons: [] },
  ];
  const changed = reclassifyAll(channels, { table: compileRules() });
  assert.equal(changed, 1);
  assert.equal(channels[0].category, 'sport');
  assert.equal(channels[0].categoryLabel, 'Sport');
  assert.equal(channels[1].category, 'cuisine');
});

test('F-11 : la file « à vérifier » respecte le seuil et exclut les décisions manuelles', () => {
  const channels = [
    { id: 'a', name: 'A', category: 'autre', categoryLabel: 'Autre', confidence: 0.2, reasons: ['r'], manualOverride: false, number: 1, group: '' },
    { id: 'b', name: 'B', category: 'autre', categoryLabel: 'Autre', confidence: 0.3, reasons: ['r'], manualOverride: true, number: 2, group: '' },
    { id: 'c', name: 'C', category: 'info', categoryLabel: 'Info', confidence: 0.9, reasons: ['r'], manualOverride: false, number: 3, group: 'News' },
  ];
  const queue = reviewQueue(channels, 0.45);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'a');
});

test('Règles personnalisées : un mot-clé ajouté gagne', () => {
  const table = compileRules({ cuisine: ['streamtv special'] });
  const entry = { name: 'StreamTV Special', group: 'General', tvgId: '', rawName: 'StreamTV Special' };
  const result = categorizeEntry(entry, table);
  assert.equal(result.category, 'cuisine');
});

/* ------------------------------------------------------------------ F-09 / F-21 */

test('F-09 : trois passes de dédoublonnage, variantes fusionnées', async () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="News",Même Chaîne',
    'https://a.test/1.m3u8',
    '#EXTINF:-1 group-title="News",Même Chaîne',
    'https://b.test/1.m3u8',
    '#EXTINF:-1 group-title="News",Même Chaine',
    'https://a.test/1.m3u8?utm=1',
    '#EXTINF:-1 group-title="News",Autre Chaîne',
    'https://c.test/2.m3u8',
  ].join('\n');
  const parsed = parseM3U(text);
  const result = dedupe(parsed.entries);
  assert.ok(result.entries.length <= 2, `attendu ≤ 2, obtenu ${result.entries.length}`);
  assert.ok(result.stats.mergedVariants >= 1);
  const merged = result.entries.find((entry) => entry.variants?.length);
  assert.ok(merged);
  assert.ok(merged.variants.length <= 5);
});

test('F-09 : les entrées finalisées portent un identifiant stable', async () => {
  const parsed = parseM3U(await fixture('small.m3u'));
  const final = finalizeEntries(dedupe(parsed.entries).entries);
  for (const entry of final) {
    assert.match(entry.id, /^[a-f0-9]{12}$/);
    assert.equal(entry.id, channelId(entry.urlNormalized));
  }
});

/* ------------------------------------------------------------------ F-17 → F-19 */

test('F-17/F-18 : recherche insensible aux accents, aux casse et aux préfixes', () => {
  const channels = [
    { id: '1', number: 1, name: 'Café Télé', category: 'divertissement', categoryLabel: 'Divertissement', group: 'General', tvgName: '', country: 'FR', language: 'fr', tags: [], health: {} },
    { id: '2', number: 2, name: 'Maroc 2M', category: 'info', categoryLabel: 'Info', group: 'News', tvgName: '', country: 'MA', language: 'ar', tags: [], health: {} },
    { id: '3', number: 3, name: 'beIN Sports 1', category: 'sport', categoryLabel: 'Sport', group: 'Sports', tvgName: '', country: 'QA', language: 'ar', tags: [], health: {} },
  ];
  const index = new SearchIndex().rebuild(channels);
  assert.equal(index.search('cafe').length, 1);
  assert.equal(index.search('CAFÉ').length, 1);
  assert.equal(index.search('maroc').length, 1);
  assert.equal(index.search('mar').length, 1);
  assert.equal(index.search('bein').length, 1);
  assert.equal(index.search('zzz').length, 0);
  assert.ok(index.suggestions('ca').length >= 0);
});

test('F-19 : contrat de pagination (pageSize borné, hasMore, pages)', () => {
  const list = Array.from({ length: 130 }, (_, index) => ({ number: index + 1 }));
  const page = paginate(list, 1, 60);
  assert.equal(page.pageSize, 60);
  assert.equal(page.pages, 3);
  assert.equal(page.items.length, 60);
  assert.equal(page.hasMore, true);
  const last = paginate(list, 99, 60);
  assert.equal(last.page, 3);
  assert.equal(last.hasMore, false);
  assert.equal(paginate(list, 1, 500).pageSize, 60, 'plafond de 60');
  assert.equal(paginate(list, 1, 1).pageSize, 1);
});

test('Tri : numéro, nom, catégorie, confiance', () => {
  const channels = [
    { number: 3, name: 'Beta', category: 'sport', confidence: 0.4, createdAt: '2026-01-01', quality: 'HD' },
    { number: 1, name: 'Alpha', category: 'info', confidence: 0.9, createdAt: '2026-02-01', quality: 'FHD' },
    { number: 2, name: 'Gamma', category: 'enfants', confidence: 0.7, createdAt: '2025-12-01', quality: 'SD' },
  ];
  assert.deepEqual(sortChannels(channels, 'number').map((c) => c.number), [1, 2, 3]);
  assert.deepEqual(sortChannels(channels, 'name').map((c) => c.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(sortChannels(channels, 'confidence').map((c) => c.number), [1, 2, 3]);
  assert.deepEqual(sortChannels(channels, 'recent').map((c) => c.number), [1, 3, 2]);
});

/* ------------------------------------------------------------------ contrat de chaîne */

test('A1–A10 : une chaîne nettoyée respecte le contrat', () => {
  const entry = {
    rawName: 'Test (720p)', name: 'Test', url: 'https://example.com/x.m3u8',
    urlNormalized: 'https://example.com/x.m3u8', logo: 'https://example.com/l.png',
    group: 'News', groupKind: 'genre', tvgId: 'Test.fr', tvgName: 'Test', quality: 'HD',
    country: 'FR', language: 'fr', tags: ['https'], position: 0,
  };
  const channel = buildChannel({
    entry, number: 1, category: { id: 'info', label: 'Info & Actualités' },
    classification: { category: 'info', confidence: 0.9, source: 'genre', reasons: ['groupe News'] },
    sourceId: 'test', siteProtocol: 'https:',
  });
  assert.equal(channel.id, channelId(entry.urlNormalized));
  assert.equal(channel.categoryLabel, 'Info & Actualités');
  const { channel: clean, fixes } = sanitizeChannel(channel, { siteProtocol: 'https:' });
  assert.ok(clean);
  assert.deepEqual(fixes, []);
  assert.equal(clean.number, 1);
  assert.ok(Array.isArray(clean.tags) && clean.tags.length > 0);
  const card = projectCard(clean);
  assert.equal(card.url, undefined, 'la carte ne transporte jamais l’URL');
  assert.ok(card.name && card.id && card.categoryLabel);
});

test('A3/A4/A5 : les incohérences sont corrigées, pas propagées', () => {
  const base = {
    id: 'deadbeefdead', number: 0, name: 'X', rawName: 'X', url: 'https://x.test/a.m3u8',
    urlNormalized: 'https://x.test/a.m3u8', category: 'info', confidence: 0.8,
    reasons: [], tags: [], health: { status: 'down', consecutiveFailures: 0 }, blocked: false,
    blockedReason: '',
  };
  const broken = sanitizeChannel({
    ...base, category: 'inexistante', confidence: 4, tags: null,
  }, { siteProtocol: 'https:' });
  assert.ok(broken.fixes.includes('A3'), 'identifiant recalculé');
  assert.ok(broken.fixes.includes('A4'), 'catégorie remplacée');
  assert.equal(broken.channel.category, 'autre');
  assert.ok(broken.channel.confidence <= 1);
  assert.ok(broken.fixes.includes('A7'), 'tags reconstruits');
  assert.deepEqual(broken.channel.tags, []);
  assert.equal(broken.channel.health.status, 'flaky', 'santé incohérente corrigée');

  const outOfRange = sanitizeChannel({ ...base, id: channelId(base.urlNormalized), number: 1, confidence: 4 });
  assert.ok(outOfRange.fixes.includes('A5'));
  assert.ok(outOfRange.channel.confidence <= 1);

  const negative = sanitizeChannel({ ...base, id: channelId(base.urlNormalized), number: 1, confidence: -1 });
  assert.ok(negative.fixes.includes('A5'));
});

test('A4 : visibilité adulte calculée par les réglages', () => {
  const channel = { visible: true, category: 'adulte' };
  assert.equal(isPublic(channel, { showAdult: false, autoHideAdult: true }), false);
  assert.equal(isPublic(channel, { showAdult: true, autoHideAdult: true }), true);
  assert.equal(isPublic({ visible: false, category: 'info' }, { showAdult: true, autoHideAdult: false }), false);
});

/* ------------------------------------------------------------------ réglages */

test('Réglages : toutes les clés de SETTING_COUNT, validation globale, aucune écriture partielle', () => {
  assert.equal(Object.keys(DEFAULTS).length, SETTING_COUNT);
  assert.equal(SETTING_COUNT, 24);
  const good = validateSettings({ brand: 'Ma TV', pageSize: 24, accent: '#123abc' });
  assert.equal(good.errors.length, 0);
  assert.equal(good.settings.brand, 'Ma TV');
  assert.equal(good.settings.pageSize, 24);

  const bad = validateSettings({ pageSize: 999, accent: 'rouge' });
  assert.equal(bad.errors.length, 2);
  assert.equal(bad.settings.pageSize, DEFAULTS.pageSize, 'la valeur refusée n’est jamais appliquée');
  assert.equal(bad.settings.accent, DEFAULTS.accent);

  const ids = validateSettings({ featuredIds: ['a', 'b'] }, { existingIds: new Set(['a']) });
  assert.equal(ids.errors.length, 1);
  assert.match(ids.errors[0].message, /format|obligatoire|compris/i);
});

test('Réglages : bornes exactes de pageSize et d’accent', () => {
  for (const value of [12, 48, 60]) {
    assert.equal(validateSettings({ pageSize: value }).errors.length, 0, `pageSize ${value}`);
  }
  for (const value of [11, 61, 0, -5]) {
    assert.ok(validateSettings({ pageSize: value }).errors.length > 0, `pageSize ${value}`);
  }
  for (const value of ['#fff', '#FFFFFF', '#ff3d71']) {
    assert.equal(validateSettings({ accent: value }).errors.length, 0, `accent ${value}`);
  }
  for (const value of ['red', '#12345', 'ff3d71']) {
    assert.ok(validateSettings({ accent: value }).errors.length > 0, `accent ${value}`);
  }
});

test('Filtres : catégorie, pays, langue, qualité, visibilité', () => {
  const channels = [
    { id: '1', category: 'info', country: 'FR', language: 'fr', quality: 'HD', health: { status: 'up' }, visible: true, featured: false },
    { id: '2', category: 'sport', country: 'MA', language: 'ar', quality: 'FHD', health: { status: 'down' }, visible: true, featured: true },
  ];
  const settings = { showAdult: false, autoHideAdult: true };
  assert.equal(channels.filter(buildPredicate({ category: 'info' }, settings)).length, 1);
  assert.equal(channels.filter(buildPredicate({ country: 'ma' }, settings)).length, 1);
  assert.equal(channels.filter(buildPredicate({ quality: 'FHD' }, settings)).length, 1);
  assert.equal(channels.filter(buildPredicate({ health: 'down' }, settings)).length, 1);
  assert.equal(channels.filter(buildPredicate({ featured: true }, settings)).length, 1);
});

/* ------------------------------------------------------------------ fixtures §5.1 */

test('Fixtures F-01 : simple.m3u donne 3 entrées propres', async () => {
  const { entries, stats } = parseM3U(await fixture('simple.m3u'));
  assert.equal(entries.length, 3);
  assert.equal(stats.orphans, 0);
  assert.equal(stats.invalidUrls, 0);
  assert.equal(entries[2].name, 'Troisième Chaîne');
});

test('Fixtures F-01 : crlf-bom.m3u conserve BOM, CRLF, arabe et virgules', async () => {
  const { entries } = parseM3U(await fixture('crlf-bom.m3u'));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'قناة المغرب الأولى');
  assert.equal(entries[1].rawName, 'Canal 5, el canal');
  assert.equal(entries[2].name, 'Chaîne "Junior"');
  assert.equal(entries[2].quality, 'HD');
});

test('Fixtures F-01 : #EXTGRP ne déborde pas sur l’entrée suivante', async () => {
  const { entries } = parseM3U(await fixture('groupes-implicites.m3u'));
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.equal(entries.length, 4);
  assert.equal(byName['Avant EXTGRP'].group, '');
  assert.equal(byName['Après EXTGRP'].group, 'Documentaire');
  assert.equal(byName['Le groupe explicite gagne'].group, 'Sport');
  assert.equal(byName['Sans groupe'].group, '');
});

test('Fixtures F-01 : deux extraits réels de 2 000 lignes, sans exception', async () => {
  for (const name of ['iptvorg-extrait.m3u', 'romaxa-extrait.m3u']) {
    const text = await fixture(name);
    const started = performance.now();
    const { entries, stats } = parseM3U(text);
    const elapsed = performance.now() - started;
    assert.equal(entries.length, 1000, `${name} : entrées`);
    assert.equal(stats.urls, 1000);
    assert.equal(stats.invalidUrls, 0);
    assert.ok(elapsed < 1000, `${name} : ${Math.round(elapsed)} ms`);
    for (const entry of entries) {
      assert.match(entry.url, /^https?:\/\//);
      assert.ok(entry.name.length > 0);
    }
  }
});

test('Fixtures F-01 : l’extrait avec pièges détecte ua-required et //', async () => {
  const { entries, stats } = parseM3U(await fixture('romaxa-extrait.m3u'));
  assert.ok(stats.uaRequired >= 100);
  const withUa = entries.filter((entry) => entry.tags.includes('ua-required'));
  assert.equal(withUa.length, stats.uaRequired);
  assert.ok(withUa.every((entry) => entry.tags.includes('ua-required')));
  assert.ok(entries.every((entry) => entry.url.startsWith('https://')));
});

/* ------------------------------------------------------------------ arabe, langue, qualité */

test('AC-026 : la langue ne se déduit pas du pays', () => {
  assert.equal(detectLanguage({ tvgId: 'AlJazeeraEnglish.qa', name: 'Al Jazeera English', country: 'QA' }), 'en');
  assert.equal(detectLanguage({ tvgId: 'AlJazeera.qa', name: 'الجزيرة', country: 'QA' }), 'ar');
  assert.equal(detectLanguage({ tvgId: 'France24.fr', name: 'France 24 Français', country: 'FR' }), 'fr');
});

test('AC-029 : un nom arabe est classé en religion et en arabe', () => {
  const table = compileRules();
  const result = classify({ name: 'قناة القرآن الكريم', group: 'ديني', tvgId: '' }, { table });
  assert.equal(result.category, 'religion');
  assert.ok(result.confidence >= 0.5);
  const entry = {
    name: 'قناة القرآن الكريم', rawName: 'قناة القرآن الكريم', group: 'ديني', groupKind: 'genre',
    tvgId: '', tags: [], quality: 'AUTO', country: 'MA', language: 'ar',
  };
  const categorised = categorizeEntry(entry, table);
  assert.equal(categorised.category, 'religion');
});

test('AC-046/AC-047 : recherche arabe et par pays dans l’index', () => {
  const channels = [
    { id: 'a', number: 1, name: 'الجزيرة', category: 'info', categoryLabel: 'Info & Actualités', group: 'News', tvgName: 'Al Jazeera', country: 'QA', language: 'ar', tags: [], health: {} },
    { id: 'b', number: 2, name: '2M Monde', category: 'divertissement', categoryLabel: 'Divertissement', group: 'Généraliste', tvgName: '', country: 'MA', language: 'ar', tags: [], health: {} },
  ];
  const index = new SearchIndex().rebuild(channels);
  assert.equal(index.search('الجزيرة').length, 1, 'recherche en arabe');
  assert.equal(index.search('جزيرة').length, 1, 'recherche partielle en arabe');
  assert.equal(index.search('maroc').length, 1, 'le pays est cherché par son nom français');
  assert.equal(index.search('qatar').length, 1);
});

test('AC-025 : la meilleure qualité gagne lors de la fusion des variantes', async () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Sport",Même Chaîne (SD)',
    'https://a.test/sd.m3u8',
    '#EXTINF:-1 group-title="Sport",Même Chaîne (FHD)',
    'https://a.test/fhd.m3u8',
  ].join('\n');
  const result = dedupe(parseM3U(text).entries);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].quality, 'FHD');
  assert.ok(result.entries[0].variants.length >= 1);
});
