#!/usr/bin/env node
// scripts/probe-chaines.js — mesure la disponibilité des chaînes et corrige les blocages.
//
// Une étiquette n'est pas une mesure : ce script sonde réellement chaque flux (concurrence 8,
// délai 6 s, en-tête Range pour ne pas télécharger la vidéo), puis applique la règle du site :
//   · 200/206 sans CORS  → lisible hors navigateur (CORS), laissée lisible ;
//   · 403 / 451          → bloquée « geo » APRÈS 3 échecs consécutifs ;
//   · 404 / 410          → bloquée « dead » APRÈS 3 échecs consécutifs ;
//   · succès             → débloque ce que la mesure contredit (étiquette « geo » d'origine).
//
// Usage :
//   node scripts/probe-chaines.js                    500 chaînes jamais testées
//   node scripts/probe-chaines.js --tout             tout le catalogue
//   node scripts/probe-chaines.js --limite 200       lot de 200
//   node scripts/probe-chaines.js --id db4e9e37edfa  une seule chaîne
//   node scripts/probe-chaines.js --commit           écrit data/channels.json (sinon aperçu)
//
// Variables : DATA_DIR (dossier de données), STREAMTV_ACTOR (auteur journalisé).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/core/store.js';
import { probeChannels } from '../server/core/health.js';
import { LIMITS } from '../server/core/constants.js';

const DATA_DIR = process.env.DATA_DIR || 'data';

function lireOptions(argv) {
  const options = { limite: 500, tout: false, ids: [], commit: false, concurrent: LIMITS.probeConcurrency, timeout: LIMITS.probeTimeoutMs };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tout') options.tout = true;
    else if (a === '--commit') options.commit = true;
    else if (a === '--limite') options.limite = Math.max(1, Number(argv[++i]) || 500);
    else if (a === '--id') options.ids.push(argv[++i]);
    else if (a === '--concurrent') options.concurrent = Math.min(16, Math.max(1, Number(argv[++i]) || 8));
    else if (a === '--timeout') options.timeout = Math.max(1000, Number(argv[++i]) || 6000);
    else if (a === '--aide' || a === '-h') options.aide = true;
  }
  return options;
}

function barre(faits, total) {
  const largeur = 22;
  const plein = Math.round((faits / Math.max(1, total)) * largeur);
  process.stdout.write(`\r  [${'█'.repeat(plein)}${'·'.repeat(largeur - plein)}] ${faits}/${total}`);
}

async function principal() {
  const options = lireOptions(process.argv.slice(2));
  if (options.aide) {
    process.stdout.write('node scripts/probe-chaines.js [--tout | --limite N | --id ID]… [--commit]\n');
    return;
  }

  const logger = { info: () => {}, warn: () => {}, error: (m) => process.stderr.write(`${m}\n`) };
  const store = new Store({ dataDir: DATA_DIR, logger });
  await store.init();

  const vivantes = store.channels.filter((channel) => !channel.deleted && channel.url);
  let cible = vivantes;
  if (options.ids.length) {
    const voulues = new Set(options.ids);
    cible = vivantes.filter((channel) => voulues.has(channel.id));
  } else if (!options.tout) {
    // Par défaut : ce que personne n'a jamais testé, puis le plus ancien.
    const jamais = vivantes.filter((channel) => !channel.health?.checkedAt);
    const anciennes = vivantes
      .filter((channel) => channel.health?.checkedAt)
      .sort((a, b) => new Date(a.health.checkedAt) - new Date(b.health.checkedAt));
    cible = [...jamais, ...anciennes].slice(0, options.limite);
  }

  if (!cible.length) {
    process.stdout.write('  aucune chaîne à sonder\n');
    return;
  }

  process.stdout.write(`  ${cible.length} chaîne(s) à sonder · ${options.concurrent} en parallèle · délai ${options.timeout} ms\n\n`);
  let faits = 0;
  const resultat = await probeChannels(cible, {
    concurrency: options.concurrent,
    timeoutMs: options.timeout,
    onResult: () => { faits += 1; barre(faits, cible.length); },
  });
  process.stdout.write('\n\n');

  const parRaison = {};
  for (const ligne of resultat.results) {
    const cle = `${ligne.status}/${ligne.reason}`;
    parRaison[cle] = (parRaison[cle] || 0) + 1;
  }
  const libelles = {
    'up/ok': 'lisibles (HTTP OK)',
    'flaky/cors': 'répondent sans en-tête CORS (bloquées par le navigateur)',
    'flaky/slow': 'lentes (plus de 4 s)',
    'flaky/server': 'serveur en erreur 5xx',
    'flaky/http': 'autre code HTTP',
    'down/geo': 'refus 403/451 (zone ou jeton)',
    'down/dead': '404/410 (liens morts)',
    'down/unreachable': 'injoignables ou délai dépassé',
  };
  for (const [cle, n] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${libelles[cle] || cle}\n`);
  }

  const bloquee = cible.filter((channel) => channel.blocked).length;
  const mesurees = cible.filter((channel) => channel.health?.checkedAt).length;
  process.stdout.write(`\n  lisible : ${resultat.up} sur ${resultat.tested} (${Math.round((resultat.up / resultat.tested) * 100)} %)\n`);
  process.stdout.write(`  bloquées après mesure : ${bloquee} · mesurées : ${mesurees}\n`);

  const exemple = resultat.results.find((ligne) => ligne.reason === 'geo');
  if (exemple) process.stdout.write(`  exemple de refus par zone : ${exemple.name} (HTTP ${exemple.httpStatus})\n`);

  if (!options.commit) {
    process.stdout.write('\n  Aperçu seul : relancez avec --commit pour enregistrer.\n');
    return;
  }
  await store.saveChannels('health.probe');
  await store.saveHealthSnapshot();
  await store.audit('health.probe', {
    actor: process.env.STREAMTV_ACTOR || 'cli',
    ip: 'local',
    count: resultat.tested,
    detail: `${resultat.up} ok / ${resultat.flaky} instables / ${resultat.down} hs · ${bloquee} bloquées après mesure`,
  });
  process.stdout.write(`  enregistré : ${path.join(DATA_DIR, 'channels.json')}\n`);
}

principal().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
