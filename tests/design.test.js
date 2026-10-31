// tests/design.test.js — les règles de DESIGN_RULES.md, vérifiées sans navigateur.
// Chaque test vise une règle numérotée du document ; une règle non testée n'existe pas.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CSS = path.join(ROOT, 'public', 'css', 'app.css');
const JS_DIR = path.join(ROOT, 'public', 'js');

async function readCss() {
  return fsp.readFile(CSS, 'utf8');
}

async function walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

async function readClient() {
  const files = await walk(JS_DIR);
  const pairs = await Promise.all(files.map(async (file) => [path.relative(ROOT, file), await fsp.readFile(file, 'utf8')]));
  return new Map(pairs);
}

/** Blocs de déclaration CSS : { selecteur, corps, index }. */
function rules(css) {
  const list = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match = re.exec(css);
  while (match) {
    list.push({ selector: match[1].trim(), body: match[2], index: match.index });
    match = re.exec(css);
  }
  return list;
}

describe('Design : Anti-AI Slop (règles 1 à 4)', () => {
  test('règle 1 : aucun dégradé, ni dans la feuille ni dans le client', async () => {
    const css = await readCss();
    assert.equal(/gradient/i.test(css), false, 'dégradé détecté dans app.css');
    for (const [file, source] of await readClient()) {
      assert.equal(/gradient/i.test(source), false, `dégradé détecté dans ${file}`);
    }
  });

  test('règle 2 : aucun survol ne déplace, ne met à l’échelle, ni n’ajoute d’ombre', async () => {
    const css = await readCss();
    const offenses = [];
    for (const rule of rules(css)) {
      if (!rule.selector.includes(':hover')) continue;
      const body = rule.body;
      const transform = /transform\s*:\s*([^;}]+)/i.exec(body);
      if (transform && !/^none$/i.test(transform[1].trim())) offenses.push(`${rule.selector} → transform:${transform[1].trim()}`);
      if (/translateY\(|translate3d\(|scale\(|scaleY\(|rotate\(/i.test(body)) offenses.push(`${rule.selector} → mouvement`);
      if (/box-shadow\s*:\s*(?!none)/i.test(body)) offenses.push(`${rule.selector} → ombre`);
      if (/filter\s*:\s*blur/i.test(body)) offenses.push(`${rule.selector} → flou`);
    }
    assert.deepEqual(offenses, [], `survols interdits : ${offenses.join(' | ')}`);
  });

  test('règle 3 : aucun tiret cadratin dans la copie affichée', async () => {
    const css = await readCss();
    assert.equal(css.includes('—'), false, 'cadratin dans app.css');
    for (const [file, source] of await readClient()) {
      assert.equal(source.includes('—'), false, `cadratin dans ${file}`);
    }
  });

  test('règle 4 : icônes décoratives bannies', async () => {
    for (const [file, source] of await readClient()) {
      assert.equal(/sparkles/.test(source), false, `icône sparkle dans ${file}`);
      assert.equal(/star4/.test(source), false, `icône étoile décorative dans ${file}`);
      assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(source), false, `emoji dans ${file}`);
    }
  });
});

describe('Design : échelle unique (règles 5 à 8)', () => {
  test('règle 5 : aucune taille de texte sous 12 px', async () => {
    const css = await readCss();
    for (const match of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      assert.ok(Number(match[1]) >= 12, `font-size:${match[1]}px`);
    }
    for (const [file, source] of await readClient()) {
      for (const match of source.matchAll(/fontSize\s*:\s*['"](\d+(?:\.\d+)?)px['"]/g)) {
        assert.ok(Number(match[1]) >= 12, `fontSize ${match[1]}px dans ${file}`);
      }
    }
  });

  test('règle 6 : la largeur de contenu ne dépasse pas 1280 px', async () => {
    const css = await readCss();
    for (const match of css.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      assert.ok(Number(match[1]) <= 1280, `max-width:${match[1]}px`);
    }
  });

  test('règle 7 : aucune couleur hexadécimale hors des jetons', async () => {
    const css = await readCss();
    const root = /:root\{([\s\S]*?)\n\}/.exec(css);
    assert.ok(root, 'bloc :root introuvable');
    const horsJetons = css.slice(0, root.index) + css.slice(root.index + root[0].length);
    const autorisees = new Set(['#000', '#fff']);
    const fautives = [...new Set(horsJetons.match(/#[0-9a-fA-F]{3,8}/g) || [])]
      .filter((value) => !autorisees.has(value.toLowerCase()));
    assert.deepEqual(fautives, [], `couleurs hors jetons : ${fautives.join(', ')}`);
    const jetons = new Set((root[1].match(/#[0-9a-fA-F]{3,8}/g) || []).map((value) => value.toLowerCase()));
    assert.ok(jetons.has('#ff3d71'), 'accent absent des jetons');
  });

  test('règle 8 : !important réservé à quatre usages documentés', async () => {
    const css = await readCss();
    const lines = css.split('\n');
    const autorisees = [/^\[hidden\]/, /^\.visually-hidden/, /prefers-reduced-motion/, /^\*,\*::before/, /^\.site-header,\.site-footer/];
    lines.forEach((line, index) => {
      if (!line.includes('!important')) return;
      assert.ok(autorisees.some((pattern) => pattern.test(line.trim())),
        `!important ligne ${index + 1} : ${line.trim().slice(0, 80)}`);
    });
  });
});

describe('Design : état et sobriété (règles 9 et 10)', () => {
  test('règle 9 : une seule couleur d’accent, déclarée une fois', async () => {
    const css = await readCss();
    const declarations = [...css.matchAll(/--accent\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
    assert.equal(declarations.length, 1, `--accent déclaré ${declarations.length} fois`);
    const clients = await readClient();
    for (const [file, source] of clients) {
      assert.equal(/accent\s*:\s*['"]#/.test(source), false, `accent codé en dur dans ${file}`);
      assert.equal(/#ff3d71/i.test(source), false, `couleur d'accent en dur dans ${file}`);
    }
  });

  test('règle 10 : le cœur suit l’état, pas la décoration', async () => {
    const css = await readCss();
    assert.match(css, /\.card-fav\[aria-pressed="true"\]\{color:var\(--accent\)\}/);
    assert.match(css, /\.card-fav\[aria-pressed="true"\] \.icon svg path\{fill:currentColor\}/);
    const fond = /\.card-fav\{[^}]*background:([^;}]+)/.exec(css);
    assert.ok(fond, 'le cœur doit poser un fond lisible sur l’image');
    assert.equal(/accent|#[0-9a-f]/i.test(fond[1]), false, 'le fond du cœur ne doit pas être teinté');
  });
});

describe('Design : grille Anime et Films sur téléphone (3.18.0)', () => {
  test('trois affiches par ligne à 375 px, sans rien couper', async () => {
    const css = await readCss();
    const bloc = /@media \(max-width:619px\)\{\s*\.vod-grid\{([^}]*)\}/.exec(css);
    assert.ok(bloc, 'le bloc téléphone de .vod-grid est absent');
    assert.match(bloc[1], /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
      'trois colonnes égales, jamais de largeur fixe');
    assert.match(bloc[1], /gap:var\(--s4\) var\(--s2\)/, 'l’espacement reste sur l’échelle de 4 px');
  });

  test('aucun contrôle posé sur l’affiche, le texte reste lisible sans survol', async () => {
    const css = await readCss();
    const affiche = /\.vod-poster\{([^}]*)\}/.exec(css);
    assert.ok(affiche, '.vod-poster est absent');
    assert.equal(/position:absolute/.test(affiche[1]), false, 'aucun contrôle en superposition');
    assert.match(affiche[1], /aspect-ratio:2\/3/, 'l’affiche garde son rapport');
    assert.equal(/\.vod-poster[^{]*\.(?:btn|vod-fav|icon)\b/.test(css), false,
      'un bouton ou un cœur ne se pose jamais sur l’affiche');
    assert.match(css, /\.vod-body\{[^}]*display:flex/, 'le texte est sous l’affiche, dans son bloc');
  });

  test('ordinateur : la même page, seulement plus dense', async () => {
    const css = await readCss();
    assert.match(css, /@media \(min-width:900px\)\{\s*\.vod-row-track\{grid-auto-columns:minmax\(168px,1fr\)\}/,
      'les rangées s’élargissent sans changer de structure');
    assert.equal(/vod-(?:filters|grid)[^{]*\{[^}]*position:fixed/.test(css), false,
      'aucun panneau latéral fixe');
  });
});
