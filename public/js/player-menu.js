// public/js/player-menu.js · menus du lecteur : options du pouce et rappel des raccourcis.
// Extraits pour garder player.js sous la limite de 900 lignes et un seul rôle par fichier.

import { COPY } from './copy.js?v=3.20.0';
import { h, icon, modal } from './ui.js?v=3.20.0';

/** Habillages proposés par le lecteur : les mêmes sur ordinateur et sur téléphone. */
const HABILLAGES = [
  { id: 'cadre', label: 'Cadre TV' },
  { id: 'plein', label: 'Plein écran' },
  { id: 'minimal', label: 'Minimal' },
];

/** Menu du pouce : les commandes rares du lecteur, regroupées au même endroit. */
export function openPlayerOptions(player) {
  modal({
    title: 'Options de lecture',
    body: h('div', { class: 'player-options' },
      h('div', { class: 'field' },
        h('label', { for: 'player-level' }, 'Qualité du flux'),
        player.levelSelect),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Habillage'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Habillage du lecteur' },
          HABILLAGES.map((habillage) => h('button', {
            class: 'chip', type: 'button',
            'aria-pressed': String(player.overlay?.dataset.skin === habillage.id),
            onClick: (event) => {
              player.setSkin(habillage.id);
              for (const bouton of event.currentTarget.parentElement.children) {
                bouton.setAttribute('aria-pressed', String(bouton === event.currentTarget));
              }
            },
          }, habillage.label)))),
      h('div', { class: 'rows' },
        h('button', {
          class: 'btn btn-ghost btn-block', type: 'button',
          onClick: () => player.toggleSimilar(),
        }, icon('grid', 16), 'Chaînes similaires'),
        h('button', {
          class: 'btn btn-ghost btn-block', type: 'button',
          onClick: () => player.pictureInPicture(),
        }, icon('pip', 16), 'Image dans l’image'),
        h('button', {
          class: 'btn btn-ghost btn-block', type: 'button',
          onClick: () => openShortcuts(),
        }, icon('settings', 16), 'Raccourcis et aide'))),
  });
}

/** Rappel des raccourcis clavier du lecteur. */
export function openShortcuts() {
  const list = COPY.player.shortcuts.map(([keys, label]) => h('div', { class: 'variant' },
    h('span', {}, h('span', { class: 'kbd', text: keys })),
    h('span', { class: 'muted', text: label })));
  modal({ title: 'Raccourcis du lecteur', body: h('div', {}, list) });
}
