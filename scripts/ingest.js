#!/usr/bin/env node
// scripts/ingest.js — importation en ligne de commande (§5 F-20, §10 exploitation).
// Usage : node scripts/ingest.js --file liste.m3u [--url https://…] [--commit] [--json]
// Sans --commit, rien n'est écrit : on affiche l'aperçu, exactement comme l'interface.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Store } from '../server/core/store.js';
import { SearchIndex } from '../server/core/search.js';
import { Ingest } from '../server/core/ingest.js';
import { VERSION } from '../server/core/constants.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

function parseArgs(argv) {
  const options = { file: '', url: '', commit: false, json: false, name: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file' || arg === '-f') options.file = argv[++index] || '';
    else if (arg === '--url' || arg === '-u') options.url = argv[++index] || '';
    else if (arg === '--name' || arg === '-n') options.name = argv[++index] || '';
    else if (arg === '--commit') options.commit = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function usage() {
  return [
    'Importation StreamTV',
    '',
    '  node scripts/ingest.js --file <liste.m3u>            aperçu, aucune écriture',
    '  node scripts/ingest.js --file <liste.m3u> --commit   applique l’importation',
    '  node scripts/ingest.js --url <https://…/liste.m3u>   télécharge puis analyse',
    '',
    '  --name <libellé>   nom donné à la source',
    '  --json             sortie lisible par une machine',
    '',
    'Variables : DATA_DIR (dossier de données), STREAMTV_ACTOR (auteur journalisé).',
  ].join('\n');
}

function line(label, value) {
  return `${label.padEnd(22, '.')} ${value}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.file && !options.url)) {
    process.stdout.write(`${usage()}\n`);
    process.exit(options.help ? 0 : 1);
  }

  const logger = { info: () => {}, warn: () => {}, error: (message) => process.stderr.write(`${message}\n`) };
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();
  const index = new SearchIndex().rebuild(store.channels.filter((channel) => !channel.deleted));
  const ingest = new Ingest({
    store, index, logger, siteProtocol: 'https:', dataDir: DATA_DIR,
  });

  let text = '';
  if (options.file) {
    text = await fsp.readFile(path.resolve(options.file), 'utf8');
  }

  const actor = process.env.STREAMTV_ACTOR || 'cli';
  const started = Date.now();
  const preview = await ingest.preview({
    text,
    url: options.url,
    name: options.name || (options.file ? path.basename(options.file) : ''),
    actor,
    ip: 'local',
    requestId: `cli-${started.toString(36)}`,
  });

  const output = {
    mode: options.commit ? 'commit' : 'aperçu',
    version: VERSION,
    source: preview.sourceName,
    jobId: preview.jobId,
    counts: preview.counts,
    totalBefore: preview.totalBefore,
    totalAfter: preview.totalAfter,
    blocked: preview.counts.blocked,
    warnings: preview.warnings,
    sample: preview.sample.slice(0, 5).map((entry) => ({
      name: entry.name, category: entry.categoryLabel, confidence: entry.confidence, quality: entry.quality,
    })),
  };

  if (options.commit) {
    const applied = await ingest.commit(preview.jobId, { actor, ip: 'local', requestId: output.jobId });
    output.applied = applied;
    output.counts = applied.counts;
    output.totalAfter = applied.totalAfter;
    output.durationMs = Date.now() - started;
    await store.flush();
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write([
      line('Source', output.source),
      line('Mode', output.mode),
      line('Entrées lues', output.counts.entries),
      line('Nouvelles chaînes', output.counts.added),
      line('Mises à jour', output.counts.updated),
      line('Décisions manuelles', output.counts.keptManual),
      line('Inchangées', output.counts.unchanged),
      line('Bloquées à la lecture', output.blocked),
      line('Catalogue avant', output.totalBefore),
      line('Catalogue après', output.totalAfter),
      output.durationMs !== undefined ? line('Durée', `${output.durationMs} ms`) : '',
      '',
      'Échantillon :',
      ...output.sample.map((entry) => `  · ${entry.name} — ${entry.category} (${Math.round(entry.confidence * 100)} %, ${entry.quality})`),
      ...output.warnings.map((warning) => `  ! ${warning}`),
      options.commit ? '' : '\nAucune écriture : relancez avec --commit pour appliquer.',
      '',
    ].filter(Boolean).join('\n'));
  }
}

main().catch((error) => {
  process.stderr.write(`Importation impossible : ${error.message}\n`);
  process.exit(1);
});
