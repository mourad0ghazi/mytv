#!/usr/bin/env node
// scripts/measure-tagger.js — mesure du moteur de classement (§2.4, §12).
// Produit : précision par échantillon étiqueté, accord sur les groupes de genre,
// part de « autre », part sous 0,45 et débit de classement — cibles du cahier des charges.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { categorizeEntry, compileRules } from '../server/core/classify.js';
import { CATEGORY_BY_ID } from '../server/core/constants.js';
import { detectCountry, detectLanguage, detectQuality, groupKind, normalizeName } from '../server/core/text.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

const TARGETS = {
  minPerSecond: 5000,
  minAccuracy: 0.9,
  minGenreAgreement: 0.95,
  maxUnder045: 0.3,
  minConfidence: 0.7,
};

/** Étiquettes de référence : nom réel, groupe réel, catégorie attendue. */
const LABELLED = [
  ['beIN Sports 1', 'Sports', 'sport'],
  ['Eurosport 2', 'Sport', 'sport'],
  ['France 24 Français', 'News', 'info'],
  ['Al Jazeera Arabic', 'News', 'info'],
  ['BBC World News', 'News', 'info'],
  ['CNN International', 'News', 'info'],
  ['Cartoon Network', 'Kids', 'enfants'],
  ['Disney Channel', 'Kids', 'enfants'],
  ['Gulli', 'Jeunesse', 'enfants'],
  ['MTV Live', 'Music', 'musique'],
  ['Trace Urban', 'Music', 'musique'],
  ['Rotana Clip', 'Music', 'musique'],
  ['Canal+ Cinéma', 'Cinema', 'cinema'],
  ['TMC', 'Généraliste', 'divertissement'],
  ['TF1', 'Généraliste', 'divertissement'],
  ['M6', 'Généraliste', 'divertissement'],
  ['Arte', 'Culture', 'documentaire'],
  ['National Geographic', 'Documentary', 'documentaire'],
  ['Discovery Channel', 'Documentary', 'documentaire'],
  ['TV5 Monde', 'Généraliste', 'divertissement'],
  ['2M', 'Généraliste', 'divertissement'],
  ['Al Aoula', 'Généraliste', 'divertissement'],
  ['Iqraa', 'Religious', 'religion'],
  ['Quran TV', 'Religious', 'religion'],
  ['TV Culinaire', 'Cooking', 'cuisine'],
  ['TV Tours', 'Travel', 'voyage'],
  ['Santé Plus', 'Health', 'sante'],
  ['Sciences & Vie TV', 'Science', 'sciences'],
  ['Histoire TV', 'Documentary', 'documentaire'],
  ['Série Club', 'Series', 'series'],
  ['Télé Achat', 'Shopping', 'publicite'],
  ['France 3 Régions', 'Regional', 'regional'],
  ['Canal+ Sport 360', 'Sport', 'sport'],
  ['Golf Channel', 'Sport', 'sport'],
  ['Equidia', 'Sport', 'sport'],
  ['Boomerang', 'Kids', 'enfants'],
  ['Nickelodeon', 'Kids', 'enfants'],
  ['MCM', 'Music', 'musique'],
  ['M6 Music', 'Music', 'musique'],
  ['OCS Max', 'Cinema', 'cinema'],
  ['Paramount Channel', 'Cinema', 'cinema'],
];

function measure(channels) {
  const table = compileRules();
  const started = performance.now();
  const results = channels.map((channel) => categorizeEntry({
    name: channel.name,
    rawName: channel.rawName || channel.name,
    group: channel.group || '',
    groupKind: channel.groupKind || groupKind(channel.group || ''),
    tvgId: channel.tvgId || '',
    tags: channel.tags || [],
    quality: channel.quality || detectQuality(channel.name, channel.url || ''),
    country: channel.country || '',
    language: channel.language || 'und',
  }, table));
  const elapsed = performance.now() - started;

  const bucket = {};
  for (const [index, result] of results.entries()) {
    const key = result.category;
    bucket[key] = (bucket[key] || 0) + 1;
    void index;
  }
  const total = results.length || 1;
  const under045 = results.filter((result) => result.confidence < 0.45).length;
  const autre = results.filter((result) => result.category === 'autre').length;
  const mean = results.reduce((sum, result) => sum + result.confidence, 0) / total;

  const evalTable = compileRules();
  let correct = 0;
  let genreAgreement = 0;
  let genreTotal = 0;
  const errors = [];
  for (const [name, group, expected] of LABELLED) {
    const entry = {
      name: normalizeName(name),
      rawName: name,
      group,
      groupKind: groupKind(group),
      tvgId: '',
      tags: [],
      quality: 'AUTO',
      country: detectCountry({ tvgId: '', group, name }),
      language: detectLanguage({ tvgId: '', name, group }),
    };
    const result = categorizeEntry(entry, evalTable);
    if (result.category === expected) correct += 1;
    else errors.push(`${name} (${group}) → ${result.category} au lieu de ${expected}`);
    if (groupKind(group) === 'genre') {
      genreTotal += 1;
      if (result.category === expected) genreAgreement += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: channels.length,
    throughput: Math.round((channels.length / Math.max(elapsed, 0.001)) * 1000),
    durationMs: Math.round(elapsed),
    categories: Object.fromEntries(Object.entries(bucket).sort(([, a], [, b]) => b - a)),
    autreRate: Number((autre / total).toFixed(4)),
    under045: Number((under045 / total).toFixed(4)),
    meanConfidence: Number(mean.toFixed(3)),
    labelled: {
      count: LABELLED.length,
      accuracy: Number((correct / LABELLED.length).toFixed(3)),
      genreAgreement: Number((genreAgreement / Math.max(genreTotal, 1)).toFixed(3)),
      mismatches: errors,
    },
    unknownCategories: Object.keys(bucket).filter((id) => !CATEGORY_BY_ID[id]),
  };
}

async function main() {
  const file = path.join(DATA_DIR, 'channels.json');
  let channels = [];
  try {
    const payload = JSON.parse(await fsp.readFile(file, 'utf8'));
    channels = Array.isArray(payload.channels) ? payload.channels : [];
  } catch {
    process.stderr.write(`Aucun catalogue lisible dans ${file}.\nLancez d’abord « npm start » ou « node scripts/ingest.js --file … --commit ».\n`);
    process.exit(1);
  }

  const report = measure(channels);
  const verdicts = {
    débit: report.throughput >= TARGETS.minPerSecond,
    précision: report.labelled.accuracy >= TARGETS.minAccuracy,
    'accord genre': report.labelled.genreAgreement >= TARGETS.minGenreAgreement,
    'sous 0,45': report.under045 <= TARGETS.maxUnder045,
    '« autre »': report.autreRate === 0,
    confiance: report.meanConfidence >= TARGETS.minConfidence,
    catégories: report.unknownCategories.length === 0,
  };

  process.stdout.write([
    `Mesure du moteur — ${new Date(report.generatedAt).toLocaleString('fr-FR')}`,
    `Chaînes analysées        ${report.sampleSize}`,
    `Débit                    ${report.throughput.toLocaleString('fr-FR')} chaînes/s (cible ≥ ${TARGETS.minPerSecond.toLocaleString('fr-FR')})`,
    `Confiance moyenne        ${report.meanConfidence}`,
    `Part sous 0,45           ${(report.under045 * 100).toFixed(1)} % (cible ≤ ${TARGETS.maxUnder045 * 100} %)`,
    `Part « autre »           ${(report.autreRate * 100).toFixed(1)} % (cible 0 %)`,
    `Précision échantillon    ${(report.labelled.accuracy * 100).toFixed(1)} % sur ${report.labelled.count} étiquettes`,
    `Accord groupes de genre  ${(report.labelled.genreAgreement * 100).toFixed(1)} %`,
    '',
    'Répartition :',
    ...Object.entries(report.categories).map(([id, count]) => `  ${(CATEGORY_BY_ID[id]?.label || id).padEnd(24)} ${String(count).padStart(6)}`),
    '',
    'Verdicts :',
    ...Object.entries(verdicts).map(([label, ok]) => `  ${ok ? '✓' : '✗'} ${label}`),
    ...(report.labelled.mismatches.length ? ['', 'Désaccords :', ...report.labelled.mismatches.map((line) => `  - ${line}`)] : []),
    '',
  ].join('\n'));

  const failed = Object.entries(verdicts).filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length) {
    process.stderr.write(`Cibles non tenues : ${failed.join(', ')}.\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Mesure impossible : ${error.message}\n`);
  process.exit(1);
});
