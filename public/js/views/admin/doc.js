// public/js/views/admin/doc.js · documentation d'administration dans la console (3.18.0).
// Le texte vient du fichier docs/ADMINISTRATION.md, servi par le serveur : aucune copie
// manuelle, donc aucun risque de divergence entre le fichier et l'écran.
// Aucune balise n'est construite à partir d'une chaîne : chaque nœud est créé par h(),
// et le texte passe par textContent.

import { Admin } from '../../api.js?v=3.19.0';
import { anchorOf } from '../../doc-anchor.js?v=3.19.0';
import { h, icon, modal } from '../../ui.js?v=3.19.0';

/** Découpe un fragment Markdown en nœuds : texte, `code`, **gras**, [lien](adresse). */
export function inlineNodes(text) {
  const nodes = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) nodes.push(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1]) nodes.push(h('code', { text: match[1].slice(1, -1) }));
    else if (match[2]) nodes.push(h('strong', { text: match[2].slice(2, -2) }));
    else nodes.push(h('a', { href: match[5], text: match[4] }));
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
  return nodes;
}

/** Rend un sous-ensemble de Markdown : titres, paragraphes, listes, tableaux, code, citations. */
export function renderMarkdown(markdown) {
  const lines = String(markdown || '').split('\n');
  const out = [];
  const paragraph = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(h('p', {}, inlineNodes(paragraph.join(' '))));
    paragraph.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (/^```/.test(line)) {
      flushParagraph();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(h('pre', {}, h('code', { text: code.join('\n') })));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(4, heading[1].length);
      out.push(h(`h${level}`, { id: anchorOf(heading[2]), text: heading[2] }));
      index += 1;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flushParagraph();
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(lines[index].trim());
        index += 1;
      }
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const bodyRows = rows.slice(1).filter((row) => !/^\|[\s:|-]+\|$/.test(row));
      out.push(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, cells(rows[0] || '').map((cell) => h('th', {}, inlineNodes(cell))))),
        h('tbody', {}, bodyRows.map((row) => h('tr', {}, cells(row).map((cell) => h('td', {}, inlineNodes(cell)))))))));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(inlineNodes(lines[index].replace(/^\s*[-*]\s+/, '')));
        index += 1;
      }
      out.push(h('ul', {}, items.map((children) => h('li', {}, children))));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(inlineNodes(lines[index].replace(/^\s*\d+\.\s+/, '')));
        index += 1;
      }
      out.push(h('ol', {}, items.map((children) => h('li', {}, children))));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      out.push(h('blockquote', {}, inlineNodes(quote.join(' '))));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();

  return h('div', { class: 'prose doc-prose' }, out);
}

let cache = null;

/**
 * Ouvre la documentation à la section demandée. Chaque onglet de la console appelle
 * cette fonction avec son ancre : le lien mène au bon passage, pas au début du fichier.
 */
export async function openDocumentation(anchor = '') {
  let payload = cache;
  if (!payload) {
    payload = await Admin.documentation();
    cache = payload;
  }
  const body = h('div', { class: 'doc-body' }, renderMarkdown(payload.markdown));
  const dialog = modal({ title: payload.titre || 'Administration', body, wide: true });
  if (anchor) {
    const target = body.querySelector(`#${CSS.escape(anchor)}`);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      target.classList.add('doc-target');
    }
  }
  return dialog;
}

/** Lien discret vers le passage documenté d'un onglet. */
export function docLink(anchor, label = 'Documentation de cet onglet') {
  return h('button', {
    class: 'doc-link', type: 'button',
    onClick: () => openDocumentation(anchor).catch(() => {}),
  }, icon('doc', 14), label);
}
