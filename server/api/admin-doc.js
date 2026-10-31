// server/api/admin-doc.js — la documentation d'administration servie à la console (3.18.0).
// Une seule source de vérité : docs/ADMINISTRATION.md. La console l'affiche telle quelle,
// section par section ; aucun texte n'est recopié à la main dans l'interface.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { anchorOf } from '../../public/js/doc-anchor.js';
import { AppError } from '../core/errors.js';

export { anchorOf };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = path.join(ROOT, 'docs', 'ADMINISTRATION.md');

/** Titres de niveau 2, avec leur ancre stable (slug du titre). */
export function listSections(markdown) {
  const sections = [];
  for (const line of String(markdown || '').split('\n')) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const title = match[1];
    sections.push({ title, anchor: anchorOf(title) });
  }
  return sections;
}

export async function readDocumentation() {
  try {
    return await fsp.readFile(DOC_PATH, 'utf8');
  } catch {
    throw new AppError('ERR-16', {
      message: 'La documentation d’administration est introuvable sur ce serveur (docs/ADMINISTRATION.md).',
    });
  }
}

export function registerDocumentationRoutes(router, app) {
  router.get('/api/admin/documentation', async () => {
    const markdown = await readDocumentation();
    return {
      body: {
        titre: 'Administration StreamTV',
        fichier: 'docs/ADMINISTRATION.md',
        sections: listSections(markdown),
        markdown,
        version: app.version,
      },
      cache: 'no-store',
    };
  }, { auth: true, permission: 'catalogue.read' });
}
