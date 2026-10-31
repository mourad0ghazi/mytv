#!/usr/bin/env node
// scripts/masquer-a-risque.mjs — applique aux chaînes les étiquettes de leur source, sans
// jamais les confondre avec une mesure.
//
// Une chaîne dont la source dit « [Geo-blocked] » ou « [Not 24/7] » n'est pas forcément
// illisible ici : c'est une déclaration, pas un constat. Le script ne bloque donc plus sur
// cette foi. Il enregistre l'étiquette dans les tags (`annonce-geo`, `annonce-24-7`) et
// **rend à la lecture** ce qui avait été bloqué sans mesure, puis laisse la sonde
// (`npm run sonde`) décider sur des faits.
//
//   node scripts/masquer-a-risque.mjs                  aperçu, aucune écriture
//   node scripts/masquer-a-risque.mjs --commit         applique au catalogue
//   node scripts/masquer-a-risque.mjs --bloquer-not247 bloque malgré tout les non permanentes
//
// Variables : DATA_DIR (dossier de données). Une sauvegarde est écrite avant modification.

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = process.env.DATA_DIR || 'data';
const commit = process.argv.includes('--commit');
const bloquerNot247 = process.argv.includes('--bloquer-not247');
const fichier = join(DATA, 'channels.json');

let doc;
try {
  doc = JSON.parse(readFileSync(fichier, 'utf8'));
} catch {
  process.stderr.write(`Catalogue illisible ou absent : ${fichier}\n`);
  process.exit(1);
}
const chans = doc.channels || doc;

let annonces = 0;
let rendues = 0;
let bloquees = 0;

for (const c of chans) {
  if (c.deleted) continue;
  const tags = new Set(c.tags || []);
  const annonceGeo = tags.has('geo');
  const annonce24 = tags.has('not-24-7');
  if (annonceGeo || annonce24) annonces += 1;

  const jamaisTestee = !c.health?.checkedAt;
  const bloqueParEtiquette = c.blocked && (c.blockedReason === 'geo' || c.blockedReason === 'dead');

  // 1. Une chaîne bloquée sur simple étiquette et jamais mesurée est rendue à la lecture.
  if (bloqueParEtiquette && jamaisTestee && !c.manualOverride) {
    c.blocked = false;
    c.blockedReason = '';
    rendues += 1;
  }

  // 2. L'étiquette reste visible, sous un nom qui dit ce qu'elle est.
  if (annonceGeo) tags.add('annonce-geo');
  if (annonce24) tags.add('annonce-24-7');
  c.tags = [...tags].slice(0, 12);

  // 3. Exception explicite : bloquer les non permanentes, en le demandant.
  if (bloquerNot247 && annonce24 && !c.blocked && !c.manualOverride) {
    c.blocked = true;
    c.blockedReason = 'dead';
    bloquees += 1;
  }
}

const lisibles = chans.filter((c) => !c.blocked && !c.deleted).length;
const mesurees = chans.filter((c) => c.health?.checkedAt).length;
process.stdout.write(`  étiquettes repérées ...... ${annonces} (dont ${chans.filter((c) => (c.tags || []).includes('annonce-geo')).length} « géo-bloquée »)\n`);
process.stdout.write(`  rendues à la lecture ..... ${rendues}\n`);
process.stdout.write(`  bloquées sur demande ..... ${bloquees}\n`);
process.stdout.write(`  chaînes mesurées ......... ${mesurees} sur ${chans.length}\n`);
process.stdout.write(`  lisibles ................. ${lisibles} sur ${chans.length}\n`);

if (!commit) {
  process.stdout.write('\n  Aperçu seul : relancez avec --commit pour écrire.\n');
} else {
  copyFileSync(fichier, `${fichier}.avant-etiquettes`);
  writeFileSync(fichier, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`  écrit : ${fichier} (sauvegarde : ${fichier}.avant-etiquettes)\n`);
}
