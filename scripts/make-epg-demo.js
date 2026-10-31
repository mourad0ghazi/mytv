// scripts/make-epg-demo.js — fabrique un guide XMLTV de démonstration, sans réseau.
// Il sert à prouver F-23 de bout en bout : même analyse que pour un guide acheté,
// mêmes règles d'appariement, aucun contenu factice présenté comme réel.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'data', 'channels.json');
const TARGET = path.join(ROOT, 'public', 'epg-demo.xml');

const GRID_BY_CATEGORY = {
  info: ['Le journal', 'Édition spéciale', 'Le débat', 'Revue de presse', 'Reportage', 'Le point économique'],
  sport: ['Avant-match', 'Direct : championnat', 'Le résumé', 'Magazine du sport', 'Débat sport', 'Multiplex'],
  cinema: ['Film du soir', 'Classique restauré', 'Court-métrage', 'Making-of', 'Séance culte', 'Ciné-club'],
  series: ['Épisode 1', 'Épisode 2', 'Inédit', 'Intégrale', 'Making-of de la série', 'Saison précédente'],
  jeunesse: ['Dessin animé', 'Atelier créatif', 'Le quiz des petits', 'Aventure', 'Chanson', 'École à la maison'],
  musique: ['Clip du moment', 'Top 20', 'Concert', 'Acoustique', 'Découverte', 'Playlist de nuit'],
  documentaire: ['Grand format', 'Histoire', 'Nature', 'Sciences', 'Société', 'Portrait'],
  divertissement: ['Jeu du soir', 'Talk-show', 'Talents', 'Humour', 'Téléréalité', 'Best-of'],
  religion: ['Culte', 'Enseignement', 'Lecture du jour', 'Chants', 'Entretien', 'Prière du soir'],
  cuisine: ['Recette du jour', 'Atelier pâtisserie', 'Marché', 'Chef invité', 'Astuces', 'Dégustation'],
  voyage: ['Évasion', 'Carnet de route', 'Ville à ville', 'Randonnée', 'Îles', 'Trains du monde'],
  éducation: ['Cours du soir', 'Méthode', 'Langues', 'Sciences faciles', 'Histoire expliquée', 'Orientation'],
  santé: ['Bien-être', 'Consultation', 'Nutrition', 'Sport santé', 'Témoignages', 'Prévention'],
  sciences: ['Découverte', 'Espace', 'Vivant', 'Technologies', 'Expérience', 'Futur'],
  téléachat: ['Sélection maison', 'Offre du jour', 'Cuisine pratique', 'Beauté', 'Sport à la maison', 'High-tech'],
  autre: ['Programme de la chaîne', 'Rediffusion', 'Magazine', 'Entracte', 'Le direct continue', 'Soirée'],
};

function slotTitles(category) {
  return GRID_BY_CATEGORY[category] || GRID_BY_CATEGORY.autre;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00 +0000`;
}

async function main() {
  const raw = await fsp.readFile(SOURCE, 'utf8');
  const parsed = JSON.parse(raw);
  const channels = (Array.isArray(parsed) ? parsed : parsed.channels || [])
    .filter((channel) => !channel.deleted && !channel.blocked && (channel.epgId || channel.tvgId))
    .slice(0, 300);

  // Grille de 48 heures à partir de l'heure pleine précédente, 16 créneaux de 3 heures.
  // Deux jours de marge : un guide figé dans un site statique se périme, la démonstration
  // reste lisible le lendemain d'une publication.
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - (start.getUTCHours() % 3));

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="StreamTV demo grid">',
  ];
  for (const channel of channels) {
    const id = channel.epgId || String(channel.tvgId).split('@')[0];
    lines.push(`  <channel id="${xmlEscape(id)}"><display-name>${xmlEscape(channel.name)}</display-name>`
      + `${channel.logo ? `<icon src="${xmlEscape(channel.logo)}"/>` : ''}</channel>`);
  }
  for (const channel of channels) {
    const id = channel.epgId || String(channel.tvgId).split('@')[0];
    const titles = slotTitles(channel.category);
    for (let slot = 0; slot < 16; slot += 1) {
      const from = new Date(start.getTime() + slot * 3 * 3600_000);
      const to = new Date(from.getTime() + 3 * 3600_000);
      // Décalage par chaîne : deux chaînes de même catégorie ne diffusent pas le même titre.
      const title = titles[(slot + (channel.number || 0)) % titles.length];
      lines.push(`  <programme start="${stamp(from)}" stop="${stamp(to)}" channel="${xmlEscape(id)}">`
        + `<title lang="fr">${xmlEscape(title)}</title>`
        + `<desc lang="fr">${xmlEscape(`${title} — ${channel.name}. Grille de démonstration, à remplacer par un fournisseur réel.`)}</desc>`
        + `<category lang="fr">${xmlEscape(channel.categoryLabel || 'Programme')}</category>`
        + '</programme>');
    }
  }
  lines.push('</tv>');
  const content = `${lines.join('\n')}\n`;
  await fsp.writeFile(TARGET, content, 'utf8');
  process.stdout.write(`guide de démonstration : ${channels.length} chaînes, `
    + `${channels.length * 16} programmes, ${Buffer.byteLength(content)} octets\n`);
  process.stdout.write(`fichier : ${path.relative(ROOT, TARGET)}\n`);
  process.stdout.write('activation : Réglages → epgUrl = /epg-demo.xml\n');
  process.stdout.write('durée : 48 heures à partir du dernier multiple de 3 heures\n');
}

main().catch((error) => {
  process.stderr.write(`échec de génération : ${error.message}\n`);
  process.exitCode = 1;
});
