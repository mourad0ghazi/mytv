// scripts/versionner-modules.js — inscrit la version du logiciel dans l'adresse des modules.
//
// Le défaut qu'il répare : un navigateur garde js/app.js en mémoire. Une page neuve, servie
// par le réseau, exécute alors l'ancien code, et l'écran tourne sans fin. Une adresse qui
// change à chaque version (js/app.js?v=3.17.0) ne peut pas être servie depuis une copie
// ancienne : le fichier est obligatoirement relu.
//
// Le script est idempotent : il remplace la version déjà inscrite au lieu d'en ajouter une.
// Il ne touche ni au dossier vendor/, ni aux adresses extérieures, ni aux fichiers de données.
// Mode --check : n'écrit rien, sort en erreur si un fichier n'est pas à jour (utilisé par les tests).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Imports statiques et dynamiques de modules relatifs : `from './x.js'`, `import('./x.js')`. */
const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"?#]+\.js)(?:\?[^'"]*)?\2/g;

/** Balises qui chargent un module du site : jamais une adresse extérieure, jamais vendor/. */
const BALISE = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?:\.{0,2}\/)?js\/[^"?#]+\.js)(?:\?[^"]*)?"/g;

function remplacerImports(source, version) {
  return source.replace(IMPORT, (_tout, avant, quote, chemin) => `${avant}${quote}${chemin}?v=${version}${quote}`);
}

function remplacerBalises(source, version) {
  return source.replace(BALISE, (_tout, avant, chemin) => `${avant}${chemin}?v=${version}"`);
}

/** Contenu d'un module une fois versionné. Fonction pure, testable seule. */
export function versionnerModule(source, version) {
  return remplacerImports(String(source), version);
}

/** Contenu d'une page HTML une fois les modules versionnés. Fonction pure, testable seule. */
export function versionnerPage(source, version) {
  return remplacerBalises(String(source), version);
}

async function listerModules(dossier) {
  const trouves = [];
  let entrees;
  try {
    entrees = await fsp.readdir(dossier, { withFileTypes: true });
  } catch {
    return trouves;
  }
  for (const entree of entrees) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === 'vendor') continue;
      trouves.push(...await listerModules(complet));
    } else if (entree.isFile() && entree.name.endsWith('.js')) {
      trouves.push(complet);
    }
  }
  return trouves;
}

/** Relatif à la racine du dépôt, pour un journal lisible. */
function nomCourt(fichier, root) {
  return path.relative(root, fichier).split(path.sep).join('/');
}

/**
 * Versionne un arbre servi : ses modules (js/, sans vendor/) et sa page index.html.
 * C'est la brique commune au dépôt et à la sortie de construction.
 * Rend la liste des fichiers réellement modifiés, en nom court pour un journal lisible.
 */
export async function versionnerArbre({ dossier, version, ecrire = true, racine = dossier } = {}) {
  const modifiees = [];

  for (const fichier of await listerModules(path.join(dossier, 'js'))) {
    const avant = await fsp.readFile(fichier, 'utf8');
    const apres = versionnerModule(avant, version);
    if (apres === avant) continue;
    modifiees.push(nomCourt(fichier, racine));
    if (ecrire) await fsp.writeFile(fichier, apres);
  }

  // Toutes les pages qui chargent un module : la page principale, la page d'erreur publiée
  // et la page hors ligne. En oublier une suffirait à rouvrir le défaut par cette porte.
  for (const nom of ['index.html', '404.html', 'offline.html']) {
    const page = path.join(dossier, nom);
    let avant;
    try {
      avant = await fsp.readFile(page, 'utf8');
    } catch {
      continue;
    }
    const apres = versionnerPage(avant, version);
    if (apres === avant) continue;
    modifiees.push(nomCourt(page, racine));
    if (ecrire) await fsp.writeFile(page, apres);
  }

  return modifiees;
}

/**
 * Versionne les deux arbres servis : public/ (source du serveur Node) et la copie publiée à la
 * racine du dépôt (celle que GitHub Pages sert). Rend la liste des fichiers réellement modifiés.
 */
export async function versionner({ root = ROOT, version, ecrire = true } = {}) {
  const modifiees = [];
  for (const dossier of [path.join(root, 'public'), root]) {
    modifiees.push(...await versionnerArbre({ dossier, version, ecrire, racine: root }));
  }
  return modifiees;
}

async function main(argv = process.argv.slice(2)) {
  const root = ROOT;
  const { version } = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  const verifier = argv.includes('--check');
  const modifiees = await versionner({ root, version, ecrire: !verifier });

  if (verifier) {
    if (modifiees.length) {
      process.stderr.write(`Adresses non versionnées (${modifiees.length}) :\n`);
      for (const fichier of modifiees) process.stderr.write(`  ${fichier}\n`);
      process.stderr.write(`Lancez : node scripts/versionner-modules.js (version ${version})\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Adresses à jour : version ${version}, aucun module oublié.\n`);
    return;
  }

  process.stdout.write(modifiees.length
    ? `${modifiees.length} fichier(s) mis à la version ${version} :\n  ${modifiees.join('\n  ')}\n`
    : `Déjà à jour : version ${version}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((erreur) => {
    process.stderr.write(`${erreur.message}\n`);
    process.exitCode = 1;
  });
}
