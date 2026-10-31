// tests/client.test.js — contrat de l'interface (§7, §8) vérifié sans navigateur ni dépendance :
// jetons CSS exacts, textes du §8.3, garde-fous clavier, mires, ARIA, limites du DOM.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { ROOT } from './helpers.js';

const read = (relative) => fsp.readFile(path.join(ROOT, relative), 'utf8');

async function listFiles(dir, filter) {
  const out = [];
  for (const entry of await fsp.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(relative, filter));
    else if (!filter || filter(relative)) out.push(relative);
  }
  return out;
}

const css = await read('public/css/app.css');
const copy = await read('public/js/copy.js');
const player = await read('public/js/player.js');
// Le lecteur est réparti sur deux modules depuis 3.18.0 (mires, gestes, panneaux) :
// les contrôles de comportement portent sur l'ensemble, jamais sur un seul fichier.
const lecTeurComplet = `${player}\n${await read('public/js/player-similar.js')}`;
const app = await read('public/js/app.js');
const index = await read('public/index.html');

describe('Feuille de style unique (§7.1)', () => {
  test('jetons exacts : fond, accent, focus, échelle de 4', () => {
    for (const token of ['--bg:#06070b', '--accent:#ff3d71', '--focus:#7cc4ff', '--text:#f2f5fb', '--muted:#97a0b3']) {
      assert.ok(css.includes(token), `jeton manquant : ${token}`);
    }
    for (const scale of ['--s1:4px', '--s2:8px', '--s3:12px', '--s4:16px', '--s5:24px', '--s6:32px', '--s7:48px']) {
      assert.ok(css.includes(scale), `échelle manquante : ${scale}`);
    }
    assert.match(css, /--fs-xs:12px/, 'aucune police sous 12 px');
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
    assert.deepEqual(sizes.filter((size) => size < 12), [], 'une taille de police descend sous 12 px');
  });

  test('une seule feuille, aucun @import, aucune police distante', () => {
    const imports = [...css.matchAll(/@import\s+url\((['"]?)([^)'"]+)\1\)/g)].map((match) => match[2]);
    assert.deepEqual(imports, []);
    assert.equal(/https?:\/\/fonts\./.test(css), false);
    assert.equal(/<link[^>]+stylesheet[^>]+css\/(?!app\.css)/.test(index), false);
  });

  test('quatre points de rupture et aucune largeur fixe sur le corps', () => {
    const breakpoints = [...css.matchAll(/@media\s*\(([^)]+)\)/g)].map((match) => match[1]).join(' | ');
    // §7.4 : ≥ 1280 px, 900–1279 px, 620–899 px, < 620 px.
    for (const width of ['1279', '899', '619']) {
      assert.ok(breakpoints.includes(width), `point de rupture manquant : ${width} px`);
    }
    assert.equal(/max-width:\s*(1023|1024|640|768)px/.test(css), false, 'points de rupture hors cahier des charges');
    assert.equal(/body\s*\{[^}]*width:\s*\d+px/.test(css), false);
  });

  test('les classes utilisées par le JavaScript existent toutes dans la feuille', async () => {
    const files = (await listFiles('public/js', (file) => file.endsWith('.js')));
    const used = new Set();
    for (const file of files) {
      const source = await read(file);
      for (const match of source.matchAll(/class:\s*'([^']+)'/g)) {
        for (const name of match[1].split(/\s+/)) if (name) used.add(name);
      }
      for (const match of source.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) used.add(match[1]);
    }
    const missing = [...used].filter((name) => !name.includes('-loading')
      && !css.includes(`.${name}`)
      && !new RegExp(`\\.${name}(?![\\w-])`).test(css));
    assert.deepEqual(missing.sort(), [], `classes sans style : ${missing.join(', ')}`);
  });

  test('états et variantes stylés : focus, aria, tonalités', () => {
    for (const selector of [':focus-visible', '[aria-pressed="true"]', '[aria-selected="true"]',
      '[data-tone="danger"]', '[data-state="up"]', '.visually-hidden', '.skip-link']) {
      assert.ok(css.includes(selector), `sélecteur absent : ${selector}`);
    }
    assert.match(css, /prefers-reduced-motion/, 'mouvement réduit pris en compte');
    assert.match(css, /@media print|print\b/, 'feuille imprimable');
  });
});

describe('Textes et messages (§8.3, §9)', () => {
  test('les 12 mires existent avec un titre et une explication distincts', () => {
    const titles = new Set();
    const explanations = new Set();
    for (let index = 1; index <= 12; index += 1) {
      const code = `P-${String(index).padStart(2, '0')}`;
      assert.ok(copy.includes(`'${code}':`), `${code} absent du paquet de textes`);
      const block = copy.slice(copy.indexOf(`'${code}':`), copy.indexOf(`'${code}':`) + 700);
      const title = /title:\s*'([^']+)'/.exec(block)?.[1];
      const explanation = /explanation:\s*'([^']+)'/.exec(block)?.[1];
      assert.ok(title && title.length > 4, `${code} sans titre`);
      assert.ok(explanation && explanation.length > 20, `${code} sans explication`);
      titles.add(title);
      explanations.add(explanation);
    }
    assert.equal(titles.size, 12, '12 titres distincts');
    assert.equal(explanations.size, 12, '12 explications distinctes');
    assert.equal(/undefined|\[object|NaN/.test(copy), false, 'aucun artefact technique dans les textes');
  });

  test('aucun jargon technique dans les textes affichés', () => {
    const forbidden = [/\bnull\b/, /undefined/, /\bNaN\b/, /\bHTTP 4\d\d\b/, /CORS/, /fetch/i, /stack/i, /token expiré/i];
    const displayed = copy
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(displayed), false, `texte interdit : ${pattern}`);
    }
  });

  test('le vocabulaire du cahier des charges est respecté', () => {
    for (const phrase of ['Toute ta télévision, dans un seul endroit', 'Mot de passe incorrect', 'Chaîne introuvable']) {
      assert.ok(copy.includes(phrase), `phrase absente : ${phrase}`);
    }
    assert.match(copy, /Aller au contenu/);
    assert.match(index, /Aller au contenu/);
  });

  test('les constats d’erreur du §9 ont une phrase dédiée', async () => {
    const view = await read('public/js/views/error-codes.js');
    for (let index = 1; index <= 20; index += 1) {
      const code = `ERR-${String(index).padStart(2, '0')}`;
      assert.ok(view.includes(code), `${code} absent du catalogue affiché`);
    }
  });
});

describe('Lecteur (§8.3)', () => {
  test('machine à états : 7 états, une seule reprise automatique', () => {
    for (const state of ['IDLE', 'PREPARING', 'PLAYING', 'PAUSED', 'BUFFERING', 'RETRYING', 'ERROR']) {
      assert.ok(player.includes(`'${state}'`), `état manquant : ${state}`);
    }
    assert.match(player, /this\.attempts < 1/, 'une seule reprise');
    assert.match(player, /clearTimeout\(this\.retryTimer\)/);
    assert.equal(/attempts < [2-9]/.test(player), false, 'aucune boucle de reprise');
  });

  test('les 12 codes de mire sont atteignables et les blocages traduits', () => {
    for (let index = 1; index <= 12; index += 1) {
      const code = `P-${String(index).padStart(2, '0')}`;
      assert.ok(lecTeurComplet.includes(code), `${code} jamais déclenché`);
    }
    assert.match(lecTeurComplet, /'mixed-content': 'P-01'/);
    assert.match(lecTeurComplet, /'ua-required': 'P-02'/);
    assert.match(lecTeurComplet, /dead: 'P-04'/);
    assert.match(lecTeurComplet, /manual: 'P-11'/);
  });

  test('HLS natif prioritaire, hls.js local, aucun rechargement de page', () => {
    assert.match(player, /canPlayType\('application\/vnd\.apple\.mpegurl'\)/);
    assert.match(player, /window\.Hls/);
    assert.equal(/https?:\/\/[^'"]*hls\.min\.js/.test(player), false, 'hls.js est servi localement');
    assert.match(player, /manifestLoadingMaxRetry:\s*0/);
  });

  test('lecture d’une chaîne : l’URL n’arrive qu’après la requête de fiche', () => {
    assert.match(player, /api\(`\/api\/channels\/\$\{channelOrId\}`\)/);
    assert.match(player, /if \(channel && !channel\.url\)/);
  });

  test('contrôles accessibles : libellés, clavier, aria', () => {
    assert.match(player, /aria-label/);
    assert.match(player, /aria-live/);
    assert.match(player, /role:\s*'dialog'/);
    assert.match(player, /Escape/);
    assert.match(player, /aria-modal/);
  });
});

describe('Raccourcis clavier et garde-fous (BUG-03)', () => {
  test('les raccourcis sont ignorés dans les champs de saisie', () => {
    assert.match(app, /isEditingField/);
    const guard = /const isEditingField[\s\S]{0,600}/.exec(app)?.[0] || '';
    assert.match(guard, /INPUT/);
    assert.match(guard, /TEXTAREA/);
    assert.match(guard, /SELECT/);
    assert.match(guard, /isContentEditable/);
    assert.match(guard, /role="textbox"|role=\\"textbox\\"/);
  });

  test('raccourci de recherche « / » et aide « ? », sans interférer avec la saisie', () => {
    assert.match(copy, /\['\/',\s*'Aller à la recherche'\]/);
    assert.match(copy, /\['\?',\s*'Afficher cette aide'\]/);
    assert.match(app, /key === '\/'/);
  });

  test('Échap ferme la couche active, sans quitter la page', () => {
    assert.match(player, /Escape/);
    assert.match(app, /Escape/);
  });
});

describe('Routage client et rendu', () => {
  test('12 routes connues et un repli 404 explicite', async () => {
    const router = await read('public/js/router.js');
    const names = [...router.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
    for (const route of ['home', 'search', 'guide', 'channel', 'favorites', 'login', 'admin',
      'legal', 'privacy', 'report', 'help', 'errors']) {
      assert.ok(names.includes(route), `route manquante : ${route}`);
    }
    assert.match(router, /notFound/);
    assert.match(router, /history\.pushState/);
  });

  test('plafond de 120 cartes et pagination respectée côté client', async () => {
    const home = await read('public/js/views/home.js');
    const guide = await read('public/js/views/guide.js');
    assert.match(app, /MAX_DOM_CARDS\s*=\s*120/);
    assert.match(`${home}${guide}`, /pageSize/);
    // Tout pageSize demandé au serveur reste sous le plafond de 60 (EP-03).
    const sizes = [...`${home}${guide}`.matchAll(/pageSize[^\n]{0,40}?(\d{2,3})/g)].map((match) => Number(match[1]));
    assert.ok(sizes.length > 0, 'aucun pageSize détecté');
    for (const size of sizes) assert.ok(size <= 60, `pageSize ${size} dépasse 60`);
  });

  test('carte : état lisible, programme au survol et aperçu muet', async () => {
    const components = await read('public/js/components.js');
    const preview = await read('public/js/preview.js');
    const now = await read('public/js/epg-now.js');
    // Aucun état muet : chaque carte porte une phrase d'état (jamais un simple point gris).
    assert.match(components, /export function stateLabel/);
    for (const phrase of ['Vérifiée récemment', 'En cours de vérification', 'Indisponible à l’instant', 'Réservée à un pays']) {
      assert.ok(components.includes(phrase), `état manquant : ${phrase}`);
    }
    assert.match(components, /class: 'card-hover'/);
    assert.match(components, /En ce moment/);
    // L'aperçu est muet, unique et borné dans le temps (budget réseau AC-089).
    assert.match(preview, /video\.muted = true/);
    assert.match(preview, /DUREE_MAX = 20_000/);
    assert.match(preview, /hover: none/);
    assert.match(preview, /export function stopPreview/);
    // « En ce moment » ne part pas au chargement : une requête par lot, mise en cache.
    assert.match(now, /\/api\/epg\/now\?ids=/);
    assert.match(now, /DUREE_CACHE/);
  });

  test('mobile : barre d’onglets et rails de recommandations distincts du PC', async () => {
    const rails = await read('public/js/views/rails.js');
    // Cinq onglets, libellés français, cibles tactiles assurées par le CSS.
    const tabbar = index.slice(index.indexOf('class="tabbar"'), index.indexOf('</nav>', index.indexOf('class="tabbar"')));
    for (const label of ['Accueil', 'Anime', 'Films', 'Rechercher', 'Favoris']) {
      assert.ok(tabbar.includes(`>${label}<`), `onglet manquant : ${label}`);
    }
    assert.match(css, /\.tabbar\{display:none\}/);
    assert.match(css, /max-width:619px\)\{[\s\S]{0,400}\.tabbar\{display:grid/);
    // Rails : historique local d'abord, affinités ensuite, repli éditorial sinon.
    assert.match(rails, /Continuer à regarder/);
    assert.match(rails, /Pour vous/);
    assert.match(rails, /prefs\.history\(\)/);
    assert.match(css, /\.rail-track\{/);
  });

  test('carte, recherche, pager : contrats DOM du §7.3', async () => {
    const components = await read('public/js/components.js');
    const home = await read('public/js/views/home.js');
    // <article role="button" tabindex="0" aria-label="{nom}, {catégorie}, chaîne {numéro}">
    assert.match(components, /class: 'card', role: 'button'/);
    assert.match(components, /chaîne \$\{channel\.number\}/);
    assert.match(components, /tabIndex: 0/);
    // Recherche : role="searchbox" + aria-autocomplete="list" + croix + liste de suggestions.
    assert.match(index, /role="searchbox"/);
    assert.match(index, /aria-autocomplete="list"/);
    assert.match(index, /id="search-suggestions"[^>]*role="listbox"|role="listbox"[^>]*id="search-suggestions"/);
    assert.match(index, /id="search-clear"/);
    // Pager : « Page 3 sur 254 · 12 181 chaînes » + précédent/suivant.
    assert.match(home, /Page \$\{fmtNumber\(page\)\} sur \$\{fmtNumber\(pages\)\}/);
    assert.match(home, /'Page précédente'/);
    assert.match(home, /'Page suivante'/);
    // « Charger plus » obligatoire sur l'écran 1, sous le plafond de 120 cartes du DOM.
    assert.match(home, /COPY\.actions\.loadMore/);
    assert.match(home, /CARD_LIMIT = 120/);
  });

  test('états vides et actions : textes opposables du §7.5', () => {
    assert.match(copy, /'Aucune chaîne pour l’instant'/);
    assert.match(copy, /Ajoutez votre première chaîne dans l’administration\./);
    assert.match(copy, /Cette catégorie est vide pour le moment/);
    assert.match(copy, /Revenez au catalogue complet\./);
    assert.match(copy, /message: 'Cliquez sur l’étoile d’une chaîne\.'/);
    assert.match(copy, /'Vous n’avez rien regardé récemment\.'/);
    assert.match(copy, /Toutes les chaînes ont été vérifiées\./);
    assert.match(copy, /loadMore: 'Charger plus'/);
  });

  test('OSD du lecteur : nom, numéro, catégorie, qualité — rien d’autre', () => {
    assert.match(player, /this\.osd = h\('div'/);
    assert.match(player, /channel\.categoryLabel/);
    assert.match(player, /channel\.quality/);
    assert.equal(/class: 'osd'[\s\S]{0,400}healthLabel/.test(player), false, 'l’OSD n’affiche pas l’état de santé');
    // Toute mire propose au moins deux actions (§7.3), même quand la table n’en cite qu’une.
    assert.match(lecTeurComplet, /if \(ids\.length < 2 && !ids\.includes\('copy'\)\) ids\.push\('copy'\)/);
  });

  test('usage tactile : cibles de 44 px, survol neutralisé, encoches respectées', () => {
    // Sur un écran sans survol, la pastille de lecture est visible : aucun tap manqué.
    const coarse = css.slice(css.indexOf('@media (hover:none), (pointer:coarse)'));
    assert.ok(css.includes('@media (hover:none), (pointer:coarse)'), 'bloc tactile absent');
    // Aucune commande ne recouvre l'affiche : la carte n'expose que son contenu.
    assert.equal(/\.card-play\{/.test(css), false, 'plus de bouton posé sur le logo');
    assert.match(coarse, /\.chip\{min-height:44px\}/);
    assert.match(coarse, /\.btn-sm\{min-height:44px/);
    assert.match(coarse, /\.player-btn\{width:46px; height:46px\}/);
    // Le survol ne reste pas collé après un tap.
    assert.match(coarse, /\.card:hover\{transform:none/);
    // Encoches et barre d'accueil : marges internes calculées, jamais fixes.
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /env\(safe-area-inset-left\)/);
    // Hauteur dynamique d'abord, repli 100vh pour les navigateurs anciens.
    assert.match(css, /min-height:100vh; min-height:100dvh/);
    // Pas de zoom iOS : les champs font au moins 16 px sur mobile.
    assert.match(css, /@media \(max-width:899px\)\{[\s\S]{0,200}input,select,textarea\{font-size:16px\}/);
    // Le guide reste lisible à 320 px : libellé masqué, santé conservée.
    assert.match(css, /\.guide-row \.btn-label\{display:none\}/);
    assert.match(css, /\.guide-health\{/);
  });

  test('lecteur tactile : tap, glissement de volume et de chaîne, écouteurs détachés', () => {
    assert.match(player, /bindGestures\(stage\)/);
    assert.match(lecTeurComplet, /touchstart/);
    assert.match(lecTeurComplet, /touchmove/);
    assert.match(lecTeurComplet, /touchend/);
    assert.match(lecTeurComplet, /onZap\(dx < 0 \? 1 : -1\)/);
    assert.match(lecTeurComplet, /onVolume\(gesture\.volume - dy \/ 240\)/);
    assert.match(player, /detachGestures\?\.\(\)/, 'les écouteurs tactiles doivent être détachés');
    // Un tap alterne l'affichage de l'OSD, il ne relance pas la lecture.
    assert.match(player, /hideOsd\(\)/);
  });

  test('échappement systématique : pas de innerHTML avec des données', async () => {
    const files = await listFiles('public/js', (file) => file.endsWith('.js'));
    for (const file of files) {
      const source = await read(file);
      for (const match of source.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
        const value = match[1].trim();
        assert.ok(value.startsWith('`<svg') || value.includes('svg'), `${file} écrit du HTML non statique : ${value.slice(0, 60)}`);
      }
      assert.equal(/insertAdjacentHTML/.test(source), false, `${file} utilise insertAdjacentHTML`);
    }
  });

  test('ARIA : régions vivantes, titres de page, focus géré', async () => {
    assert.match(index, /aria-live="polite"/);
    assert.match(index, /role="status"/);
    assert.match(app, /document\.title/);
    assert.match(app, /main\.focus|focus\(\)/);
    assert.match(index, /<main[^>]+id="main"/);
    // Chaque écran porte son titre de niveau 1 (un seul par vue).
    for (const view of ['home', 'guide', 'channel', 'favorites', 'login', 'admin', 'legal', 'error']) {
      const source = await read(`public/js/views/${view}.js`);
      assert.match(source, /h1|'h1'/, `${view}.js sans titre de niveau 1`);
    }
  });

  test('préférences locales uniquement (favoris, historique, volume)', async () => {
    const prefs = await read('public/js/prefs.js');
    assert.match(prefs, /localStorage/);
    assert.equal(/\/api\/(favoris|favorites|history)/.test(prefs), false, 'aucun favori envoyé au serveur');
    assert.match(prefs, /removeFavorite/);
    assert.match(prefs, /removeHistory/);
  });
});

describe('Console de pilotage et équipe (3.9.0)', () => {
  test('neuf onglets, Pilotage en premier', async () => {
    const admin = await read('public/js/views/admin.js');
    const ordered = [...admin.matchAll(/\['(\w+)',\s*'/g)].map((found) => found[1]);
    assert.equal(ordered[0], 'pilotage', 'le pilotage passe avant le catalogue');
    for (const onglet of ['pilotage', 'catalogue', 'liens', 'signalements', 'import', 'reglages', 'sante', 'sauvegardes', 'equipe']) {
      assert.ok(ordered.includes(onglet), `onglet ${onglet} absent`);
    }
  });

  test('pilotage : verdict, constats actionnables, usage, journal', async () => {
    const vue = await read('public/js/views/admin/pilotage.js');
    assert.match(vue, /diagnostic/);
    assert.match(vue, /analytics/);
    assert.match(vue, /audit/);
    assert.match(vue, /'Traiter'/);
    assert.match(vue, /Copier le rapport/);
    // chaque constat porte un lien vers l'écran qui le corrige
    assert.match(vue, /constat\.lien/);
  });

  test('équipe : rôles, création, fermeture d’accès, matrice', async () => {
    const vue = await read('public/js/views/admin/equipe.js');
    // Les rôles viennent du serveur : l'écran les rend, il ne les réinvente pas.
    assert.match(vue, /data\.roles/);
    const contrat = await read('server/core/team.js');
    for (const role of ['proprietaire', 'administrateur', 'editeur', 'moderateur', 'analyste']) {
      assert.match(contrat, new RegExp(`\\b${role}: \\{`), `rôle ${role} absent du contrat serveur`);
    }
    assert.match(vue, /Admin\.addMember/);
    assert.match(vue, /Fermer l’accès/);
    assert.match(vue, /permissions/);
    // aucun mot de passe affiché après création
    assert.equal(/password\s*\)\s*textContent/.test(vue), false);
  });

  test('cartes : programme permanent et logos propres', async () => {
    const components = await read('public/js/components.js');
    // La ligne de programme est dans la carte, pas seulement dans le panneau de survol.
    assert.match(components, /class: 'card-now'/);
    assert.match(components, /export function paintNow/);
    assert.match(components, /primeNow/);
    // Le logo n'est ni bridé ni filtré : mise à l'échelle contenue sur fond uni.
    assert.equal(/filter:\s*drop-shadow/.test(css.match(/\.card-media img\{[^}]*\}/)?.[0] || ''), false,
      'aucune ombre sur un logo');
    assert.match(css, /\.card-media img\{[^}]*object-fit:contain/);
  });

  test('téléphone : trois chaînes par ligne, cible d’appui suffisante, rien au survol seul', async () => {
    assert.match(css, /@media \(max-width:619px\)\{[\s\S]{0,160}\.grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    // Le cœur garde 32 px visuels mais 48 px de zone d'appui.
    assert.match(css, /\.card-fav\{top:-2px; right:-2px; width:32px; height:32px/);
    assert.match(css, /\.card-fav::before\{content:""; position:absolute; inset:-8px\}/);
    // L'entrée des cartes respecte le mouvement réduit.
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,120}\.card\{animation:none\}/);
  });

  test('expérience visiteur : carte propre, fiche façon plateforme', async () => {
    const components = await read('public/js/components.js');
    const fiche = await read('public/js/views/channel.js');
    // Aucune commande sur l'affiche : ni voile, ni disque, ni bouton flottant.
    assert.equal(/card-play/.test(css), false, 'aucune commande posée sur le logo');
    assert.equal(/class: 'card-play'/.test(components), false, 'aucun bouton de lecture dans la carte');
    // Sur téléphone, trois colonnes et une affiche carrée.
    assert.match(css, /@media \(max-width:619px\)\{[\s\S]{0,120}\.grid\{grid-template-columns:repeat\(3/);
    // La fiche porte un bandeau de programme et un « à suivre ».
    assert.match(fiche, /feature-now/);
    assert.match(fiche, /À suivre/);
    assert.match(fiche, /\/api\/epg\?ids=/);
    // Les informations techniques restent accessibles, sans faire la une.
    assert.match(fiche, /class: 'tech'/);
    assert.match(css, /\.tech\{/);
    // Le héros mène au guide.
    assert.match(await read('public/js/views/home.js'), /Le guide des programmes/);
    assert.match(components, /card-now/);
  });

  test('connexion : e-mail facultatif, libellé de rôle', async () => {
    const login = await read('public/js/views/login.js');
    assert.match(login, /admin-email/);
    assert.match(login, /type="email"|'email'/);
    assert.match(login, /roleLabel/);
    assert.match(login, /Laissez vide/);
  });
});

describe('PWA et résilience hors ligne', () => {
  test('manifeste installable et icônes locales', async () => {
    const manifest = JSON.parse(await read('public/manifest.webmanifest'));
    for (const icon of manifest.icons) {
      const file = icon.src.replace(/^\//, '');
      await fsp.access(path.join(ROOT, 'public', file));
    }
    assert.equal(manifest.icons.every((icon) => icon.src.startsWith('/icons/')), true);
  });

  test('page hors ligne dédiée, sans script inline', async () => {
    const offline = await read('public/offline.html');
    assert.match(offline, /hors ligne|connexion/i);
    assert.equal(/<script(?![^>]*src=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(offline), false);
    await fsp.access(path.join(ROOT, 'public/js/offline.js'));
  });

  test('les modules ES n’utilisent que des imports relatifs', async () => {
    const files = await listFiles('public/js', (file) => file.endsWith('.js'));
    for (const file of files) {
      const source = await read(file);
      for (const match of source.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)) {
        assert.match(match[1], /^\.\.?\//, `${file} importe ${match[1]} hors du site`);
      }
      assert.equal(/require\(/.test(source), false, `${file} utilise require`);
    }
  });
});

describe('Console privée (3.11.0)', () => {
  test('aucun lien public ne mène à l’administration', async () => {
    const files = await listFiles('public/js', (file) => file.endsWith('.js'));
    for (const file of files) {
      const source = await read(file);
      assert.equal(/href:\s*['"]\/(?:admin|administration)/.test(source), false, `${file} expose /admin`);
      assert.equal(/navigate\(\s*['"]\/(?:admin|administration)/.test(source), false, `${file} navigue vers /admin`);
      assert.equal(/location\.assign\(\s*['"]\/(?:admin|administration)/.test(source), false, `${file} redirige vers /admin`);
      assert.equal(/next=\/(?:admin|administration)/.test(source), false, `${file} ramène vers /admin après connexion`);
    }
    const html = await read('public/index.html');
    assert.equal(/href="\/(?:admin|administration)"/.test(html), false, 'index.html ne lie pas /admin');
    assert.match(html, /data-nav="admin"[^>]*hidden/, 'l’entrée de la console est masquée par défaut');
  });

  test('le routeur ne reconnaît la console que sur le chemin retenu', async () => {
    const router = await read('public/js/router.js');
    assert.match(router, /consolePath\(\)/);
    assert.equal(/pattern:\s*\/\^\\\/\(\?:admin\|administration\)/.test(router), false, 'plus de route /admin publique');
    const consoleModule = await read('public/js/console.js');
    assert.match(consoleModule, /streamtv\.console/);
    assert.match(consoleModule, /\[a-z0-9-\]\{8,40\}/);
    assert.match(consoleModule, /export function consoleHref/);
  });

  test('l’identifiant d’appareil est local, aléatoire et envoyé à la connexion', async () => {
    const api = await read('public/js/api.js');
    assert.match(api, /crypto\.getRandomValues/);
    assert.match(api, /streamtv\.device/);
    assert.match(api, /\^\[a-f0-9\]\{32\}\$/);
    assert.match(api, /deviceId: deviceId\(\)/, 'la connexion porte l’identifiant');
  });

  test('onglet Appareils : verrou, chemin secret et lien direct', async () => {
    const admin = await read('public/js/views/admin.js');
    const ordered = [...admin.matchAll(/\['(\w+)',\s*'/g)].map((found) => found[1]);
    assert.ok(ordered.includes('appareils'), 'onglet appareils absent');
    assert.match(admin, /renderAppareils/);

    const vue = await read('public/js/views/admin/appareils.js');
    for (const appel of ['Admin.devices', 'Admin.addDevice', 'Admin.removeDevice', 'Admin.saveSettings']) {
      assert.ok(vue.includes(appel), `${appel} non utilisé`);
    }
    assert.match(vue, /id: 'chemin-console'/);
    assert.match(vue, /id: 'verrou-appareil'/);
    assert.match(vue, /Copier le lien/);
    assert.match(vue, /adminPath/);
    assert.match(vue, /adminDeviceLock/);
    assert.equal(vue.includes('—'), false, 'cadratin dans la vue Appareils');
    assert.equal(/confirm\(/.test(vue), true, 'le retrait d’un appareil demande confirmation');
  });

  test('le serveur ne sert le site sur le chemin secret qu’avec son cookie', async () => {
    const index = await read('server/index.js');
    assert.match(index, /stv_entry=1/);
    assert.match(index, /HttpOnly/);
    assert.match(index, /SameSite=Strict/);
    assert.equal(/'\/(?:admin|administration)'/.test(index), false, 'plus de route /admin côté serveur');
  });
});

describe('Code de connexion par e-mail (3.12.0)', () => {
  test('la connexion demande le code avant d’ouvrir la session', async () => {
    const vue = await read('public/js/views/login.js');
    assert.match(vue, /requiresCode/);
    assert.match(vue, /Admin\.loginCode/);
    assert.match(vue, /Admin\.resendCode/);
    assert.match(vue, /id: 'admin-code'/);
    assert.match(vue, /autocomplete: 'one-time-code'/);
    assert.match(vue, /inputmode: 'numeric'/);
    assert.match(vue, /maxlength: '6'/);
    assert.match(vue, /Renvoyer un code/);
    // Le jeton n'est posé qu'après le code : la fonction de fin est la seule à écrire auth.set.
    const poses = [...vue.matchAll(/auth\.set\(/g)];
    assert.equal(poses.length, 1, 'un seul point d’écriture du jeton');
    assert.equal(vue.includes('deviceId()'), true, 'le code est lié à l’appareil');
  });

  test('l’adresse du code se règle dans la console, avec un test d’envoi', async () => {
    const vue = await read('public/js/views/admin/appareils.js');
    assert.match(vue, /Admin\.testMail/);
    assert.match(vue, /adminEmail/);
    assert.match(vue, /id: 'admin-email'/);
    assert.match(vue, /STREAMTV_SMTP_HOST/, 'l’écran explique quoi configurer');
    assert.match(vue, /Envoyer un test/);
    const api = await read('public/js/api.js');
    for (const appel of ['loginCode', 'resendCode', 'testMail']) assert.ok(api.includes(appel), `${appel} absent`);
  });

  test('l’icône enveloppe existe et reste une icône de trait', async () => {
    const ui = await read('public/js/ui.js');
    assert.match(ui, /^\s+mail: '/m);
    assert.equal(/sparkles/.test(ui), false);
  });
});

describe('Accès par lien (3.13.0)', () => {
  test('le lien ouvre la console sans mot de passe, une seule fois', async () => {
    const vue = await read('public/js/views/access.js');
    assert.match(vue, /redeemAccess/);
    assert.match(vue, /auth\.set\(session\.token\)/);
    assert.match(vue, /replace: true/, 'le jeton disparaît de la barre d’adresse');
    assert.match(vue, /rememberConsole/);
    assert.match(vue, /Lien non valable/);

    const router = await read('public/js/router.js');
    assert.match(router, /\/\^\\\/acces\\\/\(\[a-f0-9\]\{64\}\)/, 'la route du lien accepte un jeton de 64 caractères');
    const api = await read('public/js/api.js');
    assert.match(api, /api\/access\/redeem/);
    assert.match(api, /createAccessLink/);
    assert.match(api, /revokeAccessLink/);
  });

  test('l’onglet Accès crée, copie et révoque', async () => {
    const admin = await read('public/js/views/admin.js');
    const ordered = [...admin.matchAll(/\['(\w+)',\s*'/g)].map((found) => found[1]);
    assert.ok(ordered.includes('acces'), 'onglet Accès absent');
    const vue = await read('public/js/views/admin/acces.js');
    assert.match(vue, /Admin\.createAccessLink/);
    assert.match(vue, /Admin\.revokeAccessLink/);
    assert.match(vue, /Copier le lien/);
    assert.match(vue, /afficheUneFois|une seule fois/, 'l’écran prévient que le lien ne se relit pas');
    assert.match(vue, /confirm\(/, 'la révocation demande confirmation');
    assert.equal(vue.includes('—'), false, 'cadratin dans la copie');
  });

  test('le serveur ne stocke que l’empreinte du jeton', async () => {
    const serveur = await read('server/api/admin-access.js');
    assert.match(serveur, /linkDigest\(token\)/);
    assert.match(serveur, /afficheUneFois: true/);
    const publicApi = await read('server/api/public.js');
    assert.match(publicApi, /api\/access\/redeem/);
    assert.match(publicApi, /linkUsable/);
    assert.equal(/accessLinks\.push\(\{[^}]*token:/.test(publicApi), false, 'aucun jeton écrit en clair');
  });
});
