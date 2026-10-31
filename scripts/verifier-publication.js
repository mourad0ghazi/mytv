#!/usr/bin/env node
// scripts/verifier-publication.js — contrôle de l'adresse publiée (GitHub Pages).
//
//   node scripts/verifier-publication.js --base https://mourad0ghazi.github.io/mytv/
//
// Une démonstration statique peut être en ligne et servir autre chose que ce que le dépôt
// contient : une page restée à l'ancienne version, un instantané absent, une affiche perdue
// dans un sous-dossier. Ce script interroge l'adresse réelle et le dit, contrôle par contrôle.
// Aucune dépendance, aucune écriture. Sortie 0 si tout passe, 1 sinon.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE_PAR_DEFAUT = 'https://mourad0ghazi.github.io/mytv/';
const DELAI_MS = 15_000;

const checks = [];
function check(nom, ok, detail = '') {
  checks.push({ nom, ok: Boolean(ok), detail: String(detail).slice(0, 160) });
}

function normaliser(adresse) {
  const texte = String(adresse || BASE_PAR_DEFAUT).trim();
  return texte.endsWith('/') ? texte : `${texte}/`;
}

async function lire(url, { binaire = false } = {}) {
  try {
    const reponse = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'cache-control': 'no-cache' },
    });
    const corps = binaire ? Buffer.from(await reponse.arrayBuffer()) : await reponse.text();
    return { status: reponse.status, type: reponse.headers.get('content-type') || '', corps };
  } catch (erreur) {
    return { status: 0, type: '', corps: '', erreur: erreur.message };
  }
}

async function verifier(base) {
  const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const cheminBase = new URL(base).pathname;

  const accueil = await lire(base);
  check('adresse joignable', accueil.status === 200, accueil.erreur || `HTTP ${accueil.status}`);
  const page = typeof accueil.corps === 'string' ? accueil.corps : '';

  check('racine de publication déclarée', page.includes(`<base href="${cheminBase}">`), cheminBase);

  const meta = page.match(/<meta name="streamtv-version" content="([^"]+)">/);
  check('version de la page', meta && meta[1] === version, meta ? meta[1] : 'absente');

  const modules = [...page.matchAll(/(?:src|href)="[^"]*js\/[\w./-]+\.js\?v=([\d.]+)"/g)].map((m) => m[1]);
  check('modules versionnés', modules.length >= 2 && modules.every((v) => v === version),
    `${modules.length} module(s), ${[...new Set(modules)].join(', ')}`);

  const worker = await lire(`${base}sw.js`);
  check('worker publié', worker.status === 200 && String(worker.corps).includes(`streamtv-v${version}`),
    `HTTP ${worker.status}`);

  const couche = await lire(`${base}js/api.js`);
  const texteCouche = String(couche.corps);
  check('couche de lecture figée', couche.status === 200 && texteCouche.includes(`'${version}'`)
    && !texteCouche.includes('__BUILD_VERSION__'), `HTTP ${couche.status}`);

  for (const [nom, fichier] of [['anime', 'anime'], ['films', 'films']]) {
    const instantane = await lire(`${base}demo/${fichier}.json`);
    let donnees = null;
    try { donnees = JSON.parse(instantane.corps); } catch { donnees = null; }
    const items = donnees?.items || [];
    check(`instantané ${nom}`, instantane.status === 200 && items.length >= 1,
      `HTTP ${instantane.status}, ${items.length} fiche(s)`);
    check(`${nom} publiés avec licence`, items.length > 0 && items.every((item) => Boolean(item.licence)),
      `${items.filter((item) => !item.licence).length} sans licence`);
  }

  const sources = await lire(`${base}demo/sources.json`);
  let listeSources = null;
  try { listeSources = JSON.parse(sources.corps); } catch { listeSources = null; }
  const publiees = listeSources?.sources || [];
  check('sources publiées licenciées', sources.status === 200 && publiees.length >= 1
    && publiees.every((source) => Boolean(source.licence)), `${publiees.length} source(s)`);

  const anime = await lire(`${base}demo/anime.json`);
  let premiere = '';
  try { premiere = JSON.parse(anime.corps)?.items?.[0]?.poster || ''; } catch { premiere = ''; }
  const affiche = premiere ? await lire(`${base}${premiere.replace(/^\//, '')}`, { binaire: true }) : { status: 0 };
  check('affiche servie sous la racine', Boolean(premiere) && affiche.status === 200,
    premiere ? `${premiere} → HTTP ${affiche.status}` : 'aucune affiche dans l’instantané');

  const lienProfond = await lire(`${base}anime`);
  const corpsProfond = String(lienProfond.corps || '');
  check('lien profond rendu par la coquille', corpsProfond.includes(`<base href="${cheminBase}">`),
    `HTTP ${lienProfond.status}`);

  return version;
}

function rapport(base, version) {
  const lignes = [`Adresse vérifiée : ${base}`, ''];
  for (const entree of checks) {
    lignes.push(`  ${entree.ok ? '✓' : '✗'} ${entree.nom}${entree.detail ? ` — ${entree.detail}` : ''}`);
  }
  const echecs = checks.filter((entree) => !entree.ok);
  lignes.push('', echecs.length
    ? `${checks.length - echecs.length}/${checks.length} contrôles réussis, ${echecs.length} échec(s).`
    : `${checks.length}/${checks.length} contrôles réussis. Version publiée : ${version}.`);
  if (echecs.length) {
    lignes.push('', 'À vérifier :');
    for (const entree of echecs) lignes.push(`  · ${entree.nom}${entree.detail ? ` (${entree.detail})` : ''}`);
    lignes.push('', 'Si l’adresse répond 404 : activer GitHub Pages (Settings → Pages → Deploy from a branch,');
    lignes.push('branche main, dossier /), puis relancer ce contrôle après une à deux minutes.');
  }
  return lignes.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'Usage : node scripts/verifier-publication.js [options]',
      '',
      `  --base <url>   adresse publiée (défaut : ${BASE_PAR_DEFAUT})`,
      '  --json         sortie machine',
      '',
    ].join('\n'));
    return 0;
  }
  const index = args.indexOf('--base');
  const base = normaliser(index >= 0 ? args[index + 1] : BASE_PAR_DEFAUT);
  const version = await verifier(base);
  const echecs = checks.filter((entree) => !entree.ok).length;

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ base, version, ok: echecs === 0, checks }, null, 2)}\n`);
  } else {
    process.stdout.write(`${rapport(base, version)}\n`);
  }
  return echecs === 0 ? 0 : 1;
}

process.exitCode = await main();
