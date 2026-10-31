// public/js/components.js · composants partagés : carte, pastilles, en-tête de section.

import { h, icon, logoNode, healthLabel } from './ui.js?v=3.18.1';
import { prefs } from './prefs.js?v=3.18.1';
import { COPY } from './copy.js?v=3.18.1';
import { attacherPreview } from './preview.js?v=3.18.1';
import { nowCached, nowFor, heureCourte, progression, guideDisponible } from './epg-now.js?v=3.18.1';

/** Motif de non-lecture, en français et en trois mots (§9.4). */
export function reasonLabel(reason) {
  return {
    'mixed-content': 'Flux HTTP bloqué',
    'ua-required': 'Lecteur externe requis',
    geo: 'Réservée à un pays',
    dead: 'Signal indisponible',
    manual: 'Retrait manuel',
    license: 'Diffusion suspendue',
    adult: 'Contenu adulte masqué',
  }[reason] || 'Lecture indisponible';
}

/** État lisible d'une chaîne : la carte ne montre jamais un simple point gris. */
/**
 * Ligne de programme des cartes : peinte depuis le cache du guide, sans requête.
 * Les vues appellent primeNow() pour le lot visible, puis paintNow().
 */
export function paintNow(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const ligne of root.querySelectorAll('.card-now')) {
    if (ligne.dataset.state === 'blocked') continue;
    const carte = ligne.closest('.card');
    const id = carte?.dataset?.channelId;
    if (!id) continue;
    const titre = ligne.querySelector('.card-now-title');
    const heures = ligne.querySelector('.card-now-hours');
    const barre = ligne.querySelector('.card-now-bar');
    if (!guideDisponible()) {
      // Aucun guide configuré : la ligne disparaît au lieu de répéter « non communiqué ».
      ligne.dataset.state = 'off';
      continue;
    }
    const programme = nowCached(id);
    if (!programme) {
      ligne.dataset.state = 'empty';
      if (titre) titre.textContent = 'Programme non communiqué';
      if (heures) heures.textContent = '';
      if (barre) barre.style.width = '0%';
      continue;
    }
    ligne.dataset.state = 'live';
    if (titre) titre.textContent = programme.title;
    if (heures) heures.textContent = `${heureCourte(programme.start)} – ${heureCourte(programme.stop)}`;
    if (barre) barre.style.width = `${Math.round(progression(programme) * 100)}%`;
  }
}

export function stateLabel(channel) {
  if (channel.blocked) return { text: reasonLabel(channel.blockedReason), tone: 'danger' };
  if (channel.health === 'down') return { text: 'Indisponible à l’instant', tone: 'danger' };
  if (channel.health === 'flaky') return { text: 'Flux instable', tone: 'warn' };
  if (channel.health === 'up') return { text: 'Vérifiée récemment', tone: 'ok' };
  return { text: 'En cours de vérification', tone: '' };
}

export function channelCard(channel, { onOpen, onPlay, showHealth = true } = {}) {
  const fav = prefs.isFavorite(channel.id);
  const favBtn = h('button', {
    class: 'card-fav', type: 'button',
    'aria-label': fav ? COPY.actions.removeFavorite : COPY.actions.addFavorite,
    'aria-pressed': String(fav),
    onClick: (event) => {
      event.stopPropagation();
      const added = prefs.toggleFavorite(channel);
      favBtn.setAttribute('aria-pressed', String(added));
      favBtn.setAttribute('aria-label', added ? COPY.actions.removeFavorite : COPY.actions.addFavorite);
      favBtn.replaceChildren(icon('heart', 15));
    },
  }, icon('heart', 15));

  const flags = [];
  if (channel.blocked) {
    flags.push(h('span', { class: 'badge card-flag', dataset: { tone: 'danger' }, title: 'Cette chaîne ne peut pas être lue sur ce site' },
      icon('lock', 12), channel.blocked === 'mixed-content' ? 'HTTP' : 'Bloquée'));
  }
  if (channel.featured) {
    flags.push(h('span', { class: 'badge card-flag', dataset: { tone: 'accent' } }, 'Vedette'));
  }

  // Contrat §7.3 : <article role="button" tabindex="0" aria-label="{nom}, {catégorie}, chaîne {numéro}">.
  // Les commandes internes gardent leurs propres libellés et stoppent la propagation.
  const etat = stateLabel(channel);
  const barre = h('i', { style: { width: '0%' } });
  const survol = h('div', { class: 'card-hover', 'aria-hidden': 'true' },
    h('p', { class: `card-hover-state${etat.tone ? ` is-${etat.tone}` : ''}` }, h('span', { class: 'health-dot', dataset: { state: channel.blocked ? 'down' : (channel.health || 'unknown') } }), etat.text),
    h('p', { class: 'card-hover-programme' }, 'En ce moment : chargement du guide…'),
    h('span', { class: 'card-bar' }, barre),
    h('p', { class: 'card-hover-reason' }, channel.blocked ? 'La fiche explique pourquoi et propose une alternative.' : ''));

  const remplirProgramme = () => {
    if (channel.blocked) {
      survol.lastChild.textContent = 'Cette chaîne ne peut pas être lue ici. La fiche donne la raison et une alternative.';
      return;
    }
    const deja = nowCached(channel.id);
    const poser = (programme) => {
      if (!programme) {
        survol.children[1].textContent = 'Programme non communiqué par la chaîne.';
        return;
      }
      const pct = Math.round(progression(programme) * 100);
      survol.children[1].textContent = `${programme.title} · ${heureCourte(programme.start)} – ${heureCourte(programme.stop)}`;
      barre.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };
    if (deja !== null) { poser(deja); return; }
    nowFor(channel.id).then(poser).catch(() => { /* guide muet : on n'invente rien */ });
  };

  const card = h('article', {
    class: 'card', role: 'button', 'aria-label': `${channel.name}, ${channel.categoryLabel || 'catégorie inconnue'}, chaîne ${channel.number}, ${etat.text}`,
    tabIndex: 0,
    dataset: { blocked: channel.blocked || '' },
    style: { '--hue': String(channel.hue ?? 320) },
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(channel); }
    },
    onClick: () => onOpen?.(channel),
    onPointerEnter: remplirProgramme,
    onFocus: remplirProgramme,
  },
  h('div', { class: 'card-media' }, logoNode(channel), favBtn, ...flags),
  h('div', { class: 'card-body' },
    h('span', { class: 'card-num' },
      showHealth ? h('span', { class: 'health-dot', dataset: { state: channel.blocked ? 'down' : (channel.health || 'unknown') }, title: healthLabel(channel.health), 'aria-hidden': 'true' }) : null,
      `#${channel.number}`,
      channel.quality && channel.quality !== 'AUTO' ? h('span', { class: 'badge', style: { padding: '1px 6px', fontSize: 'var(--fs-xs)' } }, channel.quality) : null),
    h('span', { class: 'card-name', dir: 'auto', text: channel.name }),
    h('span', { class: 'card-sub', dir: 'auto', text: `${channel.categoryLabel || 'Non classée'}${channel.country ? ` · ${channel.country}` : ''}` })),
  // Ligne de programme permanente : lisible sans survol, sur téléphone comme sur ordinateur.
  // Le contenu est posé par paintNow() dès que le guide a répondu pour le lot de cartes.
  h('span', { class: 'card-now', dataset: { state: channel.blocked ? 'blocked' : 'loading' } },
    h('span', { class: 'card-now-head' },
      channel.blocked ? null : h('span', { class: 'card-now-live' }, 'En direct'),
      h('span', { class: 'card-now-hours' }, channel.blocked ? '' : '…')),
    h('span', { class: 'card-now-title' }, channel.blocked ? 'Lecture limitée sur ce site' : 'Programme en cours'),
    h('span', { class: 'card-bar' }, h('i', { class: 'card-now-bar' }))),
  survol);
  // L'identifiant est porté par la carte : programmes, file de lecture et favoris s'y raccrochent.
  card.dataset.channelId = channel.id;
  attacherPreview(card, channel);
  return card;
}

export function categoryChips(categories, active, onSelect) {
  const total = categories.reduce((sum, c) => sum + (c.count || 0), 0);
  const chips = [h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(!active),
    onClick: () => onSelect(''),
  }, 'Tout', h('span', { class: 'chip-count' }, String(total)))];
  for (const category of categories) {
    chips.push(h('button', {
      class: 'chip', type: 'button',
      'aria-pressed': String(active === category.id),
      disabled: !category.count,
      title: category.count ? `${category.count} chaînes` : 'Aucune chaîne dans cette catégorie',
      onClick: () => onSelect(category.id),
    }, category.label, h('span', { class: 'chip-count' }, String(category.count || 0))));
  }
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer par catégorie' }, chips);
}

export function sectionHead(eyebrow, title, extra = null) {
  return h('div', { class: 'section-head' },
    h('div', {}, eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null, h('h2', { text: title })),
    extra);
}

export function hiddenNotice(hidden, onExplain) {
  if (!hidden) return null;
  return h('button', { class: 'chip', type: 'button', onClick: onExplain, title: 'Pourquoi ce nombre diffère du catalogue complet' },
    icon('lock', 13), COPY.banners.hiddenChannels(hidden));
}

export function statCard(label, value, hint = '', tone = '') {
  return h('div', { class: 'stat', dataset: tone ? { tone } : {} },
    h('p', { class: 'stat-label', text: label }),
    h('p', { class: 'stat-value', text: value }),
    hint ? h('p', { class: 'stat-hint', text: hint }) : null);
}
