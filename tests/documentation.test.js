// tests/documentation.test.js — la console et sa documentation disent la même chose (3.18.0).
// Trois promesses : chaque onglet a sa section, chaque réglage est décrit, chaque code
// d'audit est expliqué. La comparaison se fait sur le fichier docs/ADMINISTRATION.md,
// seule source de vérité, jamais sur une copie recopiée dans l'interface.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test, { describe } from 'node:test';

import { anchorOf, listSections } from '../server/api/admin-doc.js';
import { AUDIT_ACTION_CODES } from '../server/core/journal.js';
import { SCHEMA } from '../server/core/settings.js';
import { ROOT, withServer } from './helpers.js';

const ADMIN_SOURCE = path.join(ROOT, 'public', 'js', 'views', 'admin.js');
const DOC = path.join(ROOT, 'docs', 'ADMINISTRATION.md');

async function lireDoc() {
  return fsp.readFile(DOC, 'utf8');
}

/** La liste TABS de la console, lue dans la source : l'importer demanderait un navigateur. */
async function ongletsConsole() {
  const source = await fsp.readFile(ADMIN_SOURCE, 'utf8');
  const bloc = /const TABS = \[([\s\S]*?)\n\];/.exec(source);
  assert.ok(bloc, 'la liste TABS est introuvable dans public/js/views/admin.js');
  const onglets = [...bloc[1].matchAll(/\['([a-z-]+)',\s*'([^']+)'\]/g)]
    .map(([, id, label]) => ({ id, label }));
  assert.ok(onglets.length >= 14, `onglets lus : ${onglets.length}`);
  return onglets;
}

describe('Documentation d’administration : une source de vérité (3.18.0)', () => {
  test('chaque onglet de la console a sa section, dans le même ordre', async () => {
    const onglets = await ongletsConsole();
    const markdown = await lireDoc();
    const titres = listSections(markdown).map((section) => section.title);
    assert.deepEqual(titres, onglets.map((onglet) => `Onglet ${onglet.label}`),
      'les sections du document doivent suivre la liste des onglets');
  });

  test('l’ancre de chaque section est celle que la console demande', async () => {
    const onglets = await ongletsConsole();
    const sections = listSections(await lireDoc());
    const attendues = onglets.map((onglet) => `onglet-${anchorOf(onglet.label)}`);
    assert.deepEqual(sections.map((section) => section.anchor), attendues);
    for (const ancre of attendues) {
      assert.equal(anchorOf(ancre), ancre, `ancre stable : ${ancre}`);
    }
    // Deux onglets dont l'identifiant ne suffit pas : l'ancre suit le libellé affiché.
    assert.ok(attendues.includes('onglet-chaines-et-liens'));
    assert.ok(attendues.includes('onglet-importation'));
  });

  test('les 24 réglages sont documentés par leur clef et leur nom français', async () => {
    assert.equal(SCHEMA.length, 25);
    const markdown = await lireDoc();
    for (const item of SCHEMA) {
      assert.ok(markdown.includes(`\`${item.key}\``), `clef non documentée : ${item.key}`);
      assert.ok(markdown.includes(item.label), `nom français non documenté : ${item.label}`);
    }
  });

  test('chaque code d’audit est expliqué dans le document', async () => {
    const markdown = await lireDoc();
    assert.ok(AUDIT_ACTION_CODES.length >= 50, `${AUDIT_ACTION_CODES.length} codes`);
    for (const code of AUDIT_ACTION_CODES) {
      assert.ok(markdown.includes(`\`${code}\``), `code d’audit non documenté : ${code}`);
    }
  });

  test('le document ne promet aucun réglage absent du schéma', async () => {
    const markdown = await lireDoc();
    const cles = new Set(SCHEMA.map((item) => item.key));
    const citees = [...markdown.matchAll(/^\|\s*[^|]+\|\s*`([a-zA-Z]+)`\s*\|/gm)].map((m) => m[1]);
    assert.equal(citees.length, SCHEMA.length, `${citees.length} clefs dans le tableau`);
    for (const clef of citees) assert.ok(cles.has(clef), `clef inconnue dans le document : ${clef}`);
  });
});

describe('Documentation servie par l’API (3.18.0)', () => {
  test('la route exige une session et refuse un visiteur anonyme', async () => {
    await withServer({}, async ({ client }) => {
      const anonyme = await client('/api/admin/documentation');
      assert.equal(anonyme.status, 401);
    });
  });

  test('le propriétaire reçoit le texte, ses sections et ses ancres', async () => {
    await withServer({}, async ({ client, login }) => {
      const { token } = await login();
      const { status, json } = await client('/api/admin/documentation', { token });
      assert.equal(status, 200);
      assert.equal(json.fichier, 'docs/ADMINISTRATION.md');
      assert.ok(json.markdown.startsWith('# '), 'le document commence par un titre');
      assert.equal(json.sections.length, (await ongletsConsole()).length);
      assert.ok(json.sections.some((section) => section.anchor === 'onglet-sources'));
      assert.ok(json.sections.some((section) => section.anchor === 'onglet-anime'));
      assert.ok(json.sections.some((section) => section.anchor === 'onglet-films'));
      assert.match(json.version, /^\d+\.\d+\.\d+$/);
    });
  });
});
