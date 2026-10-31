#!/usr/bin/env node
// scripts/probe-source.js — « garder seulement les liens qui marchent ».
//
//   node scripts/probe-source.js --url https://romaxa55.github.io/world_ip_tv/output/index.m3u \
//        --out data/sources/verifies.m3u
//
// Le script télécharge une liste, rejoue le parseur du site, déduplique, teste chaque flux
// (8 en parallèle, 6 s au plus) et n'écrit que ceux qui répondent. Rien n'est ajouté au
// catalogue : la sortie est une liste M3U à importer depuis la console (onglet Importation),
// ou à passer à `node scripts/ingest.js --file … --commit`.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { LIMITS, VERSION } from '../server/core/constants.js';
import {
  epgCoverage, renderPlaylist, schemeBreakdown, verifySource,
} from '../server/core/sourceprobe.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const USAGE = `probe-source.js — vérifie une liste M3U et n'en garde que les flux qui répondent

Usage :
  node scripts/probe-source.js --url <adresse> [options]
  node scripts/probe-source.js --file <chemin> [options]

Options :
  --out <chemin>       liste vérifiée à écrire (défaut : data/sources/verifies.m3u)
  --limit <n>          ne teste que les n premiers flux (0 = tous)
  --concurrency <n>    flux testés en parallèle (défaut : ${LIMITS.probeConcurrency})
  --timeout <ms>       délai par flux (défaut : ${LIMITS.probeTimeoutMs})
  --allow-http         conserve les flux http: (écartés par défaut sur un site HTTPS)
  --min-up <ratio>     refuse d'écrire si moins de ce ratio répond (défaut : 0.02)
  --json               résumé machine sur la sortie standard, sans texte
  --no-write           n'écrit rien, affiche seulement le décompte
  --help               cette aide
`;

function parseArgs(argv) {
  const options = {
    url: '', file: '', out: 'data/sources/verifies.m3u', limit: 0,
    concurrency: LIMITS.probeConcurrency, timeout: LIMITS.probeTimeoutMs,
    httpsOnly: true, minUp: 0.02, json: false, write: true, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--file') options.file = argv[++index] || '';
    else if (arg === '--out') options.out = argv[++index] || options.out;
    else if (arg === '--limit') options.limit = Math.max(0, Number(argv[++index]) || 0);
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number(argv[++index]) || LIMITS.probeConcurrency);
    else if (arg === '--timeout') options.timeout = Math.max(1000, Number(argv[++index]) || LIMITS.probeTimeoutMs);
    else if (arg === '--min-up') options.minUp = Math.min(1, Math.max(0, Number(argv[++index]) || 0));
    else if (arg === '--allow-http') options.httpsOnly = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-write') options.write = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function readSource(options) {
  if (options.file) {
    const target = path.resolve(ROOT, options.file);
    return { text: await fsp.readFile(target, 'utf8'), label: path.basename(target), origin: '' };
  }
  if (!/^https:\/\//i.test(options.url)) {
    throw new Error('--url exige une adresse HTTPS (une liste en clair serait refusée).');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs);
  try {
    const response = await fetch(options.url, {
      signal: controller.signal,
      headers: { Accept: 'application/x-mpegURL, application/vnd.apple.mpegurl, text/plain, */*' },
    });
    if (!response.ok) throw new Error(`la source a répondu ${response.status}`);
    const text = await response.text();
    if (text.length > LIMITS.fetchMaxBytes) throw new Error('fichier trop volumineux');
    return { text, label: new URL(options.url).host, origin: options.url };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('la source n’a pas répondu à temps');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.url && !options.file)) {
    process.stdout.write(USAGE);
    process.exit(options.help ? 0 : 1);
  }

  const source = await readSource(options);
  const schemes = schemeBreakdown((await import('../server/core/m3u.js')).parseM3U(source.text).entries);

  let lastShown = 0;
  const started = Date.now();
  const result = await verifySource(source.text, {
    sourceLabel: source.label,
    httpsOnly: options.httpsOnly,
    concurrency: options.concurrency,
    timeoutMs: options.timeout,
    limit: options.limit,
    onProgress: ({ done, total }) => {
      if (options.json) return;
      const percent = Math.floor((done / total) * 100);
      if (percent >= lastShown + 10 || done === total) {
        lastShown = percent - (percent % 10);
        process.stdout.write(`\r  testés ${done}/${total} (${percent} %)`);
      }
    },
  });
  if (!options.json) process.stdout.write('\n');

  const { summary } = result;
  const keptSchemes = schemeBreakdown(result.kept);
  const coverage = epgCoverage(result.kept);
  const upRatio = summary.tested ? summary.up / summary.tested : 0;
  const generatedAt = new Date().toISOString();

  const report = {
    version: VERSION,
    source: { label: source.label, url: source.origin },
    generatedAt,
    elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    entries: schemes,
    ...summary,
    upRatio: Number(upRatio.toFixed(3)),
    keptSchemes,
    epgCoverage: coverage,
  };

  if (upRatio < options.minUp && summary.tested > 0) {
    report.refused = `moins de ${Math.round(options.minUp * 100)} % des flux répondent : rien n’a été écrit`;
  } else if (options.write && result.kept.length) {
    const target = path.resolve(ROOT, options.out);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, renderPlaylist(result.kept, {
      sourceName: source.label,
      sourceUrl: source.origin,
      license: source.label.includes('romaxa') ? 'MIT' : 'voir la source',
      generatedAt,
      summary,
    }));
    report.written = path.relative(ROOT, target);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `Liste    : ${source.label}`,
      `Entrées  : ${summary.parsed} lues, ${summary.afterDedupe} après déduplication (${schemes.https} https, ${schemes.http} http)`,
      `Testés   : ${summary.tested} flux en ${report.elapsedSeconds} s`,
      `Retenus  : ${summary.up} (${Math.round(upRatio * 100)} %) — ${summary.down} indisponibles, ${summary.timeout} sans réponse, ${summary.error} injoignables`,
      `Écartés  : ${summary.skippedHttp} flux HTTP simple (bloqués par le navigateur en HTTPS)`,
      `Guide    : ${coverage.withId}/${coverage.total} flux portent un identifiant de programme (tvg-id)`,
      ...(keptSchemes.http ? [`Attention : ${keptSchemes.http} flux http: conservés (--allow-http).`] : []),
      report.refused ? `Refusé   : ${report.refused}` : null,
      report.written
        ? `Écrit    : ${report.written} — à importer depuis la console (Importation) ou par scripts/ingest.js`
        : (report.refused ? 'Aucune écriture.' : 'Aucune écriture (--no-write ou aucun flux retenu).'),
    ].filter(Boolean);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Vérification impossible : ${error.message}\n`);
  process.exit(1);
});
