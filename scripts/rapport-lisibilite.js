#!/usr/bin/env node
// scripts/rapport-lisibilite.js · état de lecture du catalogue, sans réseau (3.20.0).
// Répond à une question simple : sur les chaînes publiées, combien ont été mesurées,
// combien répondent, combien sont lisibles dans un navigateur, et combien restent à tester.
//
//   node scripts/rapport-lisibilite.js              rapport lisible
//   node scripts/rapport-lisibilite.js --json       même contenu, pour un script
//   DATA_DIR=/data node scripts/rapport-lisibilite.js
//
// Ce script ne sonde rien : il lit data/channels.json. Pour mesurer, utiliser
// `node scripts/probe-chaines.js` ou la ronde de la console.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { probeStats } from '../server/core/probe-plan.js';

const DATA = process.env.DATA_DIR || 'data';
// Un tube fermé prématurément (| head) n'est pas une erreur du rapport.
process.stdout.on('error', (error) => { if (error.code === 'EPIPE') process.exit(0); });
const json = process.argv.includes('--json');

async function lireCatalogue() {
  try {
    const raw = await fsp.readFile(path.join(DATA, 'channels.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return { channels: Array.isArray(parsed.channels) ? parsed.channels : [], updatedAt: parsed.updatedAt || null };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    process.stderr.write(`Aucun catalogue dans ${path.join(DATA, 'channels.json')}.\n`
      + 'Démarrez le serveur une première fois (npm start) pour créer le catalogue, puis relancez ce rapport.\n');
    process.exit(1);
  }
}

function parCategorie(channels) {
  const table = new Map();
  for (const channel of channels) {
    if (!channel.url || channel.deleted) continue;
    const label = channel.categoryLabel || 'Sans catégorie';
    const entry = table.get(label) || { sources: 0, up: 0, flaky: 0, down: 0, unknown: 0 };
    entry.sources += 1;
    const status = channel.health?.status || 'unknown';
    entry[status] = (entry[status] || 0) + 1;
    table.set(label, entry);
  }
  return [...table.entries()]
    .map(([label, entry]) => ({ label, ...entry }))
    .sort((a, b) => b.sources - a.sources);
}

function phrase(stats) {
  const lignes = [];
  lignes.push(`Chaînes publiées          : ${stats.total}`);
  lignes.push(`Mesurées au moins une fois : ${stats.measured}`);
  lignes.push(`Jamais testées             : ${stats.remaining}`);
  lignes.push('');
  lignes.push(`Disponibles                : ${stats.up}`);
  lignes.push(`Instables                  : ${stats.flaky}`);
  lignes.push(`Indisponibles              : ${stats.down}`);
  lignes.push(`Lisibles au navigateur     : ${stats.readable}`);
  lignes.push(`Sans en-tête CORS          : ${stats.corsMissing}`);
  lignes.push('');
  lignes.push(`Dernier relevé             : ${stats.lastCheckedAt || 'aucun'}`);
  lignes.push(`Lot nocturne               : ${stats.nightlyLimit} chaînes, ${stats.nights} nuit(s) pour finir le tour`);
  if (!stats.up && !stats.flaky) {
    lignes.push('');
    lignes.push('Aucune chaîne mesurée disponible : lancer une ronde (console, onglet Santé) ou');
    lignes.push('`node scripts/probe-chaines.js --limite 150 --commit`.');
  }
  return lignes.join('\n');
}

const { channels, updatedAt } = await lireCatalogue();
const stats = probeStats(channels);
const categories = parCategorie(channels);
const rapport = { dataDir: DATA, updatedAt, ...stats, categories };

if (json) {
  process.stdout.write(`${JSON.stringify(rapport, null, 2)}\n`);
} else {
  process.stdout.write(`${phrase(stats)}\n\nPar catégorie (testées / total) :\n`);
  for (const entry of categories) {
    const testees = entry.up + entry.flaky + entry.down;
    process.stdout.write(`  ${entry.label.padEnd(26, ' ')} ${String(testees).padStart(5)} / ${String(entry.sources).padStart(5)}\n`);
  }
}
