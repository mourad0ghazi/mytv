#!/usr/bin/env node
// scripts/backup.js — sauvegarde immédiate ou planifiée (§10.3).
// Usage : node scripts/backup.js [--weekly] [--list] [--json]
// Écrit data/backups/catalogue-AAAAMMJJ-HHMMSS.json + empreinte .sha256, applique la rétention 7+4.

import path from 'node:path';
import process from 'node:process';

import { Store } from '../server/core/store.js';
import { LIMITS } from '../server/core/constants.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

function parseArgs(argv) {
  return {
    weekly: argv.includes('--weekly'),
    list: argv.includes('--list'),
    json: argv.includes('--json'),
  };
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const logger = { info: () => {}, warn: () => {}, error: (message) => process.stderr.write(`${message}\n`) };
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();

  if (options.list) {
    const backups = await store.listBackups();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ backups, retention: { daily: LIMITS.backupDaily, weekly: LIMITS.backupWeekly } }, null, 2)}\n`);
      return;
    }
    if (!backups.length) {
      process.stdout.write('Aucune sauvegarde disponible.\n');
      return;
    }
    process.stdout.write(`Sauvegardes (${backups.length}) — rétention ${LIMITS.backupDaily} quotidiennes + ${LIMITS.backupWeekly} hebdomadaires\n\n`);
    for (const backup of backups) {
      const verified = await store.verifyBackup(backup.file);
      process.stdout.write([
        `  ${backup.file}`,
        `    date       ${backup.date}`,
        `    taille     ${human(backup.size)}`,
        `    empreinte  ${verified.ok ? 'vérifiée' : `invalide (${verified.reason})`}`,
        backup.weekly ? '    type       hebdomadaire' : '',
      ].filter(Boolean).join('\n') + '\n');
    }
    process.stdout.write('\n');
    return;
  }

  const started = performance.now();
  const backup = await store.backup(options.weekly ? 'weekly' : 'manual');
  const elapsed = Math.round(performance.now() - started);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...backup, durationMs: elapsed }, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Sauvegarde créée : ${backup.file}`,
      `  chaînes     ${store.channels.length}`,
      `  taille      ${human(backup.size)}`,
      `  empreinte   ${backup.sha256}`,
      `  durée       ${elapsed} ms`,
      `  rétention   ${LIMITS.backupDaily} quotidiennes + ${LIMITS.backupWeekly} hebdomadaires`,
      '',
    ].join('\n'));
  }
}

main().catch((error) => {
  process.stderr.write(`Sauvegarde impossible : ${error.message}\n`);
  process.exit(1);
});
