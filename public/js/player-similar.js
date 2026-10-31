// public/js/player-similar.js · chaînes proches et mires du lecteur (3.18.0).
// Extrait de player.js pour garder chaque fichier sous 900 lignes : ici, uniquement
// la construction du DOM des panneaux et des mires, sans état de lecture.

import { COPY } from './copy.js?v=3.21.0';
import { h, icon } from './ui.js?v=3.21.0';

/** Code de mire correspondant à un motif de blocage connu. */
export function mireForBlocked(blocked) {
  return {
    'mixed-content': 'P-01',
    'ua-required': 'P-02',
    geo: 'P-05',
    dead: 'P-04',
    manual: 'P-11',
  }[blocked] || 'P-12';
}

/** Bloc « nouvelle tentative » affiché quand le lecteur reprend le flux. */
export function mireRetryNode({ title, explanation }) {
  return h('div', { class: 'mire' },
    h('div', { class: 'mire-inner' },
      h('div', { class: 'mire-icon' }, icon('retry', 26)),
      h('p', { class: 'mire-code', text: 'Nouvelle tentative' }),
      h('h2', { text: title }),
      h('p', { text: explanation })));
}

/** Boutons d'une mire : au moins deux actions, la principale mise en avant. */
export function mireActionNodes(actions, handlers) {
  const ids = [...actions];
  if (ids.length < 2 && !ids.includes('copy')) ids.push('copy');
  return ids.map((action) => {
    const label = {
      next: COPY.actions.next, retry: COPY.actions.retry, copy: COPY.actions.copy,
      report: COPY.actions.report, admin: COPY.actions.admin, reload: COPY.actions.reload,
      play: COPY.actions.watch,
    }[action] || action;
    const primary = action === 'retry' || action === 'play' || action === 'next';
    return h('button', {
      class: `btn ${primary ? 'btn-primary' : 'btn-ghost'}`, type: 'button',
      onClick: () => handlers[action]?.(),
    }, label);
  });
}

/** Mire complète : code, titre, explication, actions. */
export function mireNode({ mire, explanation, actions }) {
  return h('div', { class: 'mire', role: 'alertdialog', 'aria-label': mire.title },
    h('div', { class: 'mire-inner' },
      h('div', { class: 'mire-icon' }, icon('alert', 26)),
      h('p', { class: 'mire-code', text: mire.code }),
      h('h2', { text: mire.title }),
      h('p', { text: explanation }),
      h('div', { class: 'mire-actions' }, actions)));
}

/** Rail de chaînes proches, avec un texte explicite quand il n'y a rien à proposer. */
export function similarBlock(title, items, empty, onPick) {
  return h('div', { class: 'similar-block' },
    h('h3', { text: title }),
    items.length
      ? h('div', { class: 'similar-track' }, items.map((item) => h('button', {
        class: 'similar-item', type: 'button', onClick: () => onPick(item.id),
        'aria-label': `Lire ${item.name}`,
      }, h('strong', { text: item.name }),
      h('span', { text: `#${item.number} · ${item.categoryLabel || item.category || ''}` }))))
      : h('p', { class: 'player-sub', text: empty }));
}

/** Panneau complet : deux raccourcis, deux rails, l'état technique. */
export function similarPanel({ proches, veine, onNext, onPick, onSimilaire }) {
  return [
    h('div', { class: 'similar-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: onNext },
        icon('next', 15), 'Chaîne suivante'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: onSimilaire },
        icon('grid', 15), 'Similaire')),
    similarBlock('Chaînes similaires', proches, 'Aucune chaîne de la même famille dans le catalogue.', onPick),
    similarBlock('Dans la même veine', veine, 'Pas de déclinaison connue pour ce nom.', onPick),
    h('div', { class: 'stream-info' },
      h('span', {}, 'Résolution ', h('b', { text: 'inconnue' })),
      h('span', {}, 'Débit ', h('b', { text: 'non communiqué' })),
      h('span', {}, 'Codec ', h('b', { text: 'non communiqué' }))),
  ];
}

/**
 * Gestes tactiles du lecteur : glissement vertical pour le volume, horizontal pour changer
 * de chaîne, tap pour l'OSD. Rend une fonction de détachement, jamais un écouteur orphelin.
 */
export function wireGestures(surface, { onVolume, onZap, onTap, getVolume, getState }) {
  if (!surface) return () => {};
  let gesture = { x: 0, y: 0, time: 0, volume: 0, armed: false, moved: false };

  const point = (event) => (event.touches ? event.touches[0] : event);
  const begin = (event) => {
    if (event.pointerType === 'mouse') return; // souris : les commandes suffisent
    const start = point(event);
    gesture = { x: start.clientX, y: start.clientY, time: Date.now(), volume: getVolume(), armed: true, moved: false };
  };
  const move = (event) => {
    if (!gesture.armed) return;
    const now = point(event);
    const dx = now.clientX - gesture.x;
    const dy = now.clientY - gesture.y;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    gesture.moved = true;
    if (Math.abs(dy) > Math.abs(dx)) onVolume(gesture.volume - dy / 240);
    if (event.cancelable) event.preventDefault();
  };
  const end = (event) => {
    if (!gesture.armed) return;
    gesture.armed = false;
    const last = point(event);
    const dx = (last?.clientX ?? gesture.x) - gesture.x;
    const dy = (last?.clientY ?? gesture.y) - gesture.y;
    const elapsed = Date.now() - gesture.time;
    if (gesture.moved && Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy)) {
      onZap(dx < 0 ? 1 : -1);
      return;
    }
    if (!gesture.moved && elapsed < 400) onTap(getState());
  };

  surface.addEventListener('touchstart', begin, { passive: true });
  surface.addEventListener('touchmove', move, { passive: false });
  surface.addEventListener('touchend', end, { passive: true });
  return () => {
    surface.removeEventListener('touchstart', begin);
    surface.removeEventListener('touchmove', move);
    surface.removeEventListener('touchend', end);
  };
}
