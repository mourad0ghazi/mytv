// public/js/vod-ui.js · briques communes aux pages Anime et Films (3.18.0).
// Une seule forme d'affiche, un seul mot de type, une licence toujours visible.
// Aucun contrôle ne se superpose à l'affiche : les commandes vivent sous l'image.

import { withBase } from './base.js?v=3.18.1';
import { h, icon } from './ui.js?v=3.18.1';
import { prefs } from './prefs.js?v=3.18.1';

/** « 1 h 23 min », « 42 min », « 3 min ». Jamais de seconde seule pour une durée de film. */
export function fmtDuration(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (!total) return 'Durée non renseignée';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  if (minutes) return `${minutes} min`;
  return `${total} s`;
}

/** Position de lecture lisible : « 12 min 34 s ». */
export function fmtPosition(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return fmtDuration(total);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

/** Affiche : image si fournie, sinon vignette typographique (jamais d'image brisée). */
function posterNode(item) {
  if (item.poster) {
    const img = h('img', {
      // L'affiche est un fichier du site : elle suit la racine de publication (/mytv/ sur Pages).
      src: withBase(item.poster),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      width: '300',
      height: '450',
    });
    img.addEventListener('error', () => {
      img.replaceWith(initialPoster(item));
    }, { once: true });
    return img;
  }
  return initialPoster(item);
}

function initialPoster(item) {
  const title = String(item.title || '?').trim();
  return h('span', { class: 'vod-initial', 'aria-hidden': 'true', text: title.slice(0, 2).toUpperCase() });
}

/**
 * Carte d'anime ou de film : affiche nue, titre sur deux lignes, type écrit en toutes lettres,
 * licence sous le titre. Le cœur est une commande à côté de l'affiche, jamais dessus.
 */
export function vodCard(item, { onOpen, showProgress = true } = {}) {
  const kind = item.kind === 'anime' || item.type === 'anime' ? 'anime' : 'film';
  const kindLabel = kind === 'anime' ? 'Anime' : 'Film';
  const title = item.title || item.name || '';
  const fav = prefs.isVodFavorite(kind, item.id);
  const progress = showProgress ? prefs.vodProgress(kind, item.id) : 0;

  const favBtn = h('button', {
    class: 'vod-fav', type: 'button',
    'aria-label': fav ? `Retirer ${title} des favoris` : `Ajouter ${title} aux favoris`,
    'aria-pressed': String(fav),
    onClick: (event) => {
      event.stopPropagation();
      const added = prefs.toggleVodFavorite({ ...item, kind });
      favBtn.setAttribute('aria-pressed', String(added));
      favBtn.setAttribute('aria-label', added ? `Retirer ${title} des favoris` : `Ajouter ${title} aux favoris`);
    },
  }, icon('heart', 15));

  const meta = [
    item.year ? String(item.year) : '',
    kind === 'anime'
      ? (item.episodeCount ? `${item.episodeCount} ép.` : '')
      : fmtDuration(item.durationSeconds),
    item.language || '',
  ].filter(Boolean).join(' · ');

  const card = h('article', {
    class: 'vod-card',
    role: 'button',
    tabIndex: 0,
    'aria-label': `${kindLabel} : ${title}${item.year ? `, ${item.year}` : ''}${item.licence ? `, licence ${item.licence}` : ''}`,
    dataset: { vodId: item.id, vodKind: kind },
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(item); }
    },
    onClick: () => onOpen?.(item),
  },
  h('div', { class: 'vod-poster' }, posterNode(item)),
  h('div', { class: 'vod-body' },
    h('p', { class: 'vod-kind', text: kindLabel }),
    h('span', { class: 'vod-title', dir: 'auto', text: title }),
    h('span', { class: 'vod-meta', text: meta || 'Information à compléter' }),
    progress
      ? h('span', { class: 'vod-resume', text: `Reprendre à ${fmtPosition(progress)}` })
      : null,
    h('span', { class: 'vod-licence', text: item.licence ? `Licence : ${item.licence}` : 'Licence non renseignée' }),
    favBtn));
  return card;
}

/** Rangée horizontale de cartes. Une rangée sans contenu n'est jamais construite. */
export function vodRow({ title, subtitle = '', items = [], onOpen, moreHref = '', moreLabel = 'Tout voir' }) {
  if (!items.length) return null;
  return h('section', { class: 'vod-row', 'aria-label': title },
    h('div', { class: 'rail-head' },
      h('div', {},
        subtitle ? h('p', { class: 'eyebrow', text: subtitle }) : null,
        h('h2', { class: 'rail-title', text: title })),
      moreHref ? h('a', { class: 'rail-more', href: moreHref, 'data-link': '' }, moreLabel, icon('chevron', 14)) : null),
    h('div', { class: 'vod-row-track' },
      items.map((item) => vodCard(item, { onOpen }))));
}

/** Barre de filtres en haut de page : mêmes contrôles sur téléphone et sur ordinateur. */
export function vodFilters({ facets, state, onChange, statuses = null }) {
  const select = (label, name, values, current, { format = null } = {}) => h('label', { class: 'vod-filter' },
    h('span', { class: 'vod-filter-label', text: label }),
    h('select', {
      class: 'select',
      value: current || '',
      onChange: (event) => onChange({ [name]: event.target.value }),
    },
    h('option', { value: '' }, 'Tous'),
    values.map((value) => h('option', { value: String(value), selected: String(value) === String(current) },
      format ? format(value) : String(value)))));

  const controls = [
    select('Genre', 'genre', facets.genres || [], state.genre),
    select('Année', 'year', facets.years || [], state.year),
    select('Langue', 'language', facets.languages || [], state.language),
  ];

  if (statuses) {
    controls.push(h('label', { class: 'vod-filter' },
      h('span', { class: 'vod-filter-label', text: 'Statut' }),
      h('select', {
        class: 'select',
        value: state.status || '',
        onChange: (event) => onChange({ status: event.target.value }),
      },
      h('option', { value: '' }, 'Tous'),
      statuses.map((entry) => h('option', { value: entry.id, selected: entry.id === state.status }, entry.label)))));
  }

  const actifs = [
    state.genre ? { clef: 'Genre', champ: 'genre' } : null,
    state.year ? { clef: 'Année', champ: 'year' } : null,
    state.language ? { clef: 'Langue', champ: 'language' } : null,
    state.status ? { clef: 'Statut', champ: 'status' } : null,
    state.q ? { clef: 'Recherche', champ: 'q' } : null,
  ].filter(Boolean);

  return h('div', { class: 'vod-filters', role: 'group', 'aria-label': 'Filtres' },
    controls,
    actifs.length
      ? h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button',
        onClick: () => onChange(Object.fromEntries(actifs.map((entry) => [entry.champ, '']))),
      }, icon('close', 14), `Retirer les ${actifs.length} filtre${actifs.length > 1 ? 's' : ''}`)
      : null);
}

/** Pagination identique à celle du catalogue : même mécanisme, aucun second système. */
export function vodPager(page, pages, total, { label, onChange }) {
  if (pages <= 1) return null;
  return h('nav', { class: 'pager', 'aria-label': 'Pagination' },
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', disabled: page <= 1,
      'aria-label': 'Page précédente', onClick: () => onChange(page - 1),
    }, icon('chevron', 15, 'style="transform:rotate(180deg)"'), 'Précédent'),
    h('p', { class: 'pager-label tabular', 'aria-live': 'polite' },
      `Page ${page} sur ${pages} · ${new Intl.NumberFormat('fr-FR').format(total)} ${label}`),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', disabled: page >= pages,
      'aria-label': 'Page suivante', onClick: () => onChange(page + 1),
    }, 'Suivant', icon('chevron', 15)));
}

/** Sources disponibles avec leur licence : visible là où le contenu est proposé. */
export function sourcesBlock(sources = []) {
  if (!sources.length) {
    return h('div', { class: 'callout' },
      h('div', {},
        h('p', { class: 'callout-title' }, 'Aucune source publiée'),
        h('p', { class: 'muted' }, 'Ce contenu ne peut pas être lu tant qu’aucune source licenciée n’est déclarée.')));
  }
  return h('ul', { class: 'vod-sources' },
    sources.map((source) => h('li', { class: 'vod-source' },
      h('span', { class: 'vod-source-nom', text: source.nom || source.sourceId }),
      h('span', { class: 'vod-source-licence', text: `Licence : ${source.licence}` }),
      h('span', { class: 'vod-source-meta', text: `${source.language} · ${source.quality}${source.priorite ? ` · priorité ${source.priorite}` : ''}` }))));
}
