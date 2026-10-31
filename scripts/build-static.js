#!/usr/bin/env node
// scripts/build-static.js — construit la démonstration statique publiée sur GitHub Pages.
//
//   node scripts/build-static.js --source http://127.0.0.1:3000 --base /myiptv/ --out dist-static
//
// Le script interroge une instance locale du serveur (le vrai site), fige le catalogue dans un
// instantané JSON, recopie le client et remplace `js/api.js` par la couche de lecture seule.
// Aucune dépendance, aucune écriture dans `data/`.

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { versionnerArbre } from './versionner-modules.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const DEFAULTS = { source: 'http://127.0.0.1:3000', base: '/', out: 'dist-static', copyTo: '', pages: 1 };

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') options.source = argv[++index] || options.source;
    else if (arg === '--base') options.base = argv[++index] || options.base;
    else if (arg === '--out') options.out = argv[++index] || options.out;
    else if (arg === '--copy-to') options.copyTo = argv[++index] || options.copyTo;
    else if (arg === '--help' || arg === '-h') options.pages = 0;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.pages) {
  process.stdout.write([
    'Usage : node scripts/build-static.js [options]',
    '',
    '  --source <url>    serveur local à interroger (défaut : http://127.0.0.1:3000)',
    '  --base <chemin>   racine de publication (défaut : / ; GitHub Pages projet : /myiptv/)',
    '  --out <dossier>   dossier de sortie (défaut : dist-static)',
    '  --copy-to <dir>   copie ensuite le résultat dans ce dossier (ex. . pour la racine du dépôt)',
    '',
  ].join('\n'));
  process.exit(0);
}

const base = options.base.endsWith('/') ? options.base : `${options.base}/`;
const outDir = path.resolve(ROOT, options.out);

async function getJson(pathname) {
  const response = await fetch(new URL(pathname, options.source));
  if (!response.ok) throw new Error(`${pathname} → HTTP ${response.status}`);
  return response.json();
}

/** Texte cherchable : nom, catégorie, pays, langue, groupe, tags, numéro (accents retirés). */
function haystack(channel) {
  return [
    channel.name,
    channel.rawName,
    channel.categoryLabel,
    channel.country,
    channel.language,
    channel.group,
    channel.quality,
    String(channel.number),
    ...(channel.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function copyTree(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else await fsp.copyFile(source, target);
  }
}

/** Réécrit les URL internes pour qu'elles se résolvent contre <base href>. */
function localize(html) {
  return html
    .replace('href="/"', 'href="./"')
    .replace(/(\b(?:href|src|content|action)=")\/(?![/#])/g, '$1');
}

async function main() {
  process.stdout.write(`Source    : ${options.source}\n`);
  process.stdout.write(`Base      : ${base}\n`);

  const health = await getJson('/healthz').catch((error) => {
    throw new Error(`Le serveur ne répond pas (${error.message}). Lancez « node server/index.js » d'abord.`);
  });

  const config = await getJson('/api/config');
  const errors = await getJson('/api/errors/catalog');
  const epg = await getJson('/api/epg?hours=24').catch(() => ({ enabled: false }));

  const cards = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await getJson(`/api/channels?page=${page}&pageSize=60&sort=number`);
    cards.push(...payload.channels);
    pages = payload.pages;
    page += 1;
  } while (page <= pages);
  process.stdout.write(`Catalogue : ${cards.length} chaînes\n`);

  const details = new Map();
  await pool(cards, 8, async (card) => {
    try {
      const payload = await getJson(`/api/channels/${encodeURIComponent(card.id)}`);
      details.set(card.id, payload.channel);
    } catch {
      details.set(card.id, card);
    }
  });

  const catalog = cards.map((card) => ({
    card,
    detail: details.get(card.id) || card,
    hay: haystack(card),
  }));

  // Anime et Films : listes publiques complètes, puis fiche détaillée de chaque entrée.
  async function collectVod(kind) {
    const items = [];
    let facets = {};
    let page = 1;
    let pages = 1;
    do {
      const payload = await getJson(`/api/${kind}?page=${page}&pageSize=60`);
      items.push(...(payload.items || []));
      facets = payload.facets || facets;
      pages = payload.pages || 1;
      page += 1;
    } while (page <= pages);
    return { items, facets };
  }
  const anime = await collectVod('anime');
  const films = await collectVod('films');
  const animeDetails = {};
  const filmDetails = {};
  await pool(anime.items, 4, async (item) => {
    animeDetails[item.id] = await getJson(`/api/anime/${encodeURIComponent(item.id)}`).catch(() => null);
  });
  await pool(films.items, 4, async (item) => {
    filmDetails[item.id] = await getJson(`/api/films/${encodeURIComponent(item.id)}`).catch(() => null);
  });
  const sources = await getJson('/api/sources').catch(() => ({ total: 0, sources: [] }));
  process.stdout.write(`Anime     : ${anime.items.length} fiches\n`);
  process.stdout.write(`Films     : ${films.items.length} fiches\n`);

  // « En ce moment » : programmes en cours pour toutes les chaînes, par lots de 60.
  // Sans guide configuré, le fichier reste vide et les cartes n'affichent aucun programme.
  let now = { enabled: false, now: [] };
  if (epg && epg.enabled) {
    const ids = cards.map((card) => card.id);
    const collecte = [];
    for (let i = 0; i < ids.length; i += 60) {
      const lot = ids.slice(i, i + 60);
      try {
        const payload = await getJson(`/api/epg/now?ids=${encodeURIComponent(lot.join(','))}`);
        if (payload && payload.enabled) collecte.push(...(payload.now || []));
      } catch { /* un lot manquant ne bloque pas la construction */ }
    }
    now = { enabled: true, now: collecte };
    process.stdout.write(`Guide     : ${collecte.length} programmes en cours\n`);
  }

  await fsp.rm(outDir, { recursive: true, force: true });
  await copyTree(PUBLIC_DIR, outDir);

  const demoDir = path.join(outDir, 'demo');
  await fsp.mkdir(demoDir, { recursive: true });
  // Deux fichiers, deux usages : « cards.json » suffit au premier écran (cartes et index de
  // recherche), « catalog.json » garde les détails et n'est ouvert qu'à l'ouverture d'une fiche.
  const cartes = catalog.map((entree) => ({ card: entree.card, hay: entree.hay }));
  await fsp.writeFile(path.join(demoDir, 'cards.json'), JSON.stringify(cartes));
  await fsp.writeFile(path.join(demoDir, 'catalog.json'), JSON.stringify(catalog));
  await fsp.writeFile(path.join(demoDir, 'config.json'), JSON.stringify({
    ...config,
    demo: true,
    totals: { ...config.totals, demo: cards.length },
  }));
  await fsp.writeFile(path.join(demoDir, 'errors.json'), JSON.stringify(errors));
  await fsp.writeFile(path.join(demoDir, 'epg.json'), JSON.stringify(epg));
  await fsp.writeFile(path.join(demoDir, 'epg-now.json'), JSON.stringify(now));
  await fsp.writeFile(path.join(demoDir, 'anime.json'), JSON.stringify(anime));
  await fsp.writeFile(path.join(demoDir, 'films.json'), JSON.stringify(films));
  await fsp.writeFile(path.join(demoDir, 'anime-details.json'), JSON.stringify(animeDetails));
  await fsp.writeFile(path.join(demoDir, 'film-details.json'), JSON.stringify(filmDetails));
  await fsp.writeFile(path.join(demoDir, 'sources.json'), JSON.stringify(sources));

  // Coquille : base de déploiement, chemins relatifs, bandeau de démonstration, repli 404 (SPA).
  const indexFile = path.join(outDir, 'index.html');
  let html = await fsp.readFile(indexFile, 'utf8');
  html = localize(html);
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<base href="${base}">`);
  const strip = `<p class="demo-strip" role="note">Démonstration publique en lecture seule · catalogue réel de ${cards.length} chaînes · la console d’administration nécessite le serveur Node</p>`;
  html = html.replace('<body>', `<body>\n${strip}`);
  await fsp.writeFile(indexFile, html);
  // Même traitement pour la page hors ligne : chemins relatifs, sans base (elle vit à côté).
  const offlineFile = path.join(outDir, 'offline.html');
  await fsp.writeFile(offlineFile, localize(await fsp.readFile(offlineFile, 'utf8')));
  await fsp.writeFile(path.join(outDir, '404.html'), html);
  await fsp.writeFile(path.join(outDir, '.nojekyll'), '');

  // Feuille de style : une seule règle ajoutée, aux jetons existants.
  const cssFile = path.join(outDir, 'css', 'app.css');
  const css = await fsp.readFile(cssFile, 'utf8');
  await fsp.writeFile(cssFile, `${css}\n.demo-strip{margin:0; padding:var(--s2) var(--s4); background:var(--bg-2); color:var(--muted);
  border-bottom:1px solid var(--line); font-size:var(--fs-xs); text-align:center}\n`);

  // Manifeste : portée et icônes relatives à la racine de publication.
  const manifestFile = path.join(outDir, 'manifest.webmanifest');
  const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
  manifest.id = base;
  manifest.scope = base;
  manifest.start_url = `${base}?utm_source=pwa`;
  manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace(/^\//, '') }));
  manifest.shortcuts = (manifest.shortcuts || []).map((shortcut) => ({ ...shortcut, url: shortcut.url.replace(/^\//, '') }));
  await fsp.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  // Le service worker lit sa portée de publication : il n'est plus réécrit ici. La réécriture
  // aveugle des chemins avait déjà transformé « /api/ » en « api/ », désactivant une règle.

  // Couche de lecture : instantané JSON au lieu de l'API, avec la version de la publication
  // inscrite dans les adresses de données (aucune copie ancienne ne peut être resservie).
  const demoApi = await fsp.readFile(path.join(ROOT, 'scripts', 'templates', 'demo-api.js'), 'utf8');
  await fsp.writeFile(path.join(outDir, 'js', 'api.js'), demoApi.replaceAll('__BUILD_VERSION__', health.version));

  // Dernier geste de la construction : la version inscrite dans l'adresse de chaque module.
  // Sans elle, un navigateur qui garde un js/app.js ancien exécute du code périmé sur une page
  // neuve ; c'est ce défaut qui laissait l'écran sur « Chargement du catalogue… » (3.17.0).
  const versionnes = await versionnerArbre({ dossier: outDir, version: health.version });

  const sizes = await Promise.all(['index.html', 'js/api.js', 'demo/cards.json', 'demo/catalog.json'].map(async (name) => {
    const stat = await fsp.stat(path.join(outDir, name));
    return `${name} ${(stat.size / 1024).toFixed(0)} Ko`;
  }));
  process.stdout.write(`Sortie    : ${path.relative(ROOT, outDir)} (${sizes.join(' · ')})\n`);
  process.stdout.write(`Version   : ${health.version} · ${cards.length} chaînes · base ${base}\n`);
  process.stdout.write(`Adresses  : ${versionnes.length} fichier(s) versionné(s) · v=${health.version}\n`);

  if (options.copyTo) {
    const target = path.resolve(ROOT, options.copyTo);
    for (const entry of await fsp.readdir(outDir)) {
      const source = path.join(outDir, entry);
      const destination = path.join(target, entry);
      await fsp.rm(destination, { recursive: true, force: true });
      await fsp.cp(source, destination, { recursive: true });
    }
    process.stdout.write(`Publié    : ${path.relative(ROOT, target) || '.'} (fichiers statiques)\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Construction impossible : ${error.message}\n`);
  process.exit(1);
});
