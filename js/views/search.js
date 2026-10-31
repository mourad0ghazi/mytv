// public/js/views/search.js · recherche globale : chaînes, anime et films dans une seule liste.
// Chaque résultat dit son type par un mot (Chaîne, Anime, Film), jamais par une couleur.

import { api } from '../api.js?v=3.20.0';
import { withBase } from '../base.js?v=3.20.0';
import { COPY } from '../copy.js?v=3.20.0';
import { h, icon, fmtNumber, emptyState, spinner, logoNode } from '../ui.js?v=3.20.0';
import { prefs } from '../prefs.js?v=3.20.0';

const KIND_TONE = { chaine: 'Chaîne', anime: 'Anime', film: 'Film' };

function resultRow(result, { navigate }) {
  const media = result.poster
    ? h('span', { class: 'search-result-media' },
      h('img', { src: withBase(result.poster), alt: '', loading: 'lazy', decoding: 'async', width: '64', height: '96' }))
    : h('span', { class: 'search-result-media' }, h('span', { class: 'vod-initial', 'aria-hidden': 'true', text: (result.title || '?').slice(0, 2).toUpperCase() }));

  return h('li', { class: 'search-result' },
    media,
    h('div', { class: 'search-result-text' },
      h('p', { class: 'search-result-kind', text: KIND_TONE[result.kind] || 'Contenu' }),
      h('p', { class: 'search-result-title', dir: 'auto', text: result.title }),
      h('p', { class: 'search-result-sub', text: result.subtitle || '' }),
      result.licence ? h('p', { class: 'search-result-licence', text: `Licence : ${result.licence}` }) : null),
    h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      'aria-label': `Ouvrir ${result.title}`,
      onClick: () => navigate(result.href),
    }, 'Ouvrir', icon('chevron', 14)));
}

export async function renderSearch(container, ctx) {
  const { navigate, query } = ctx;
  const q = String(query.q || '').trim();
  const view = h('div', { class: 'view' });
  container.replaceChildren(view);

  view.append(h('div', { class: 'section-head' },
    h('div', {},
      h('p', { class: 'eyebrow' }, 'Recherche'),
      h('h1', { style: { fontSize: '30px' }, dir: 'auto' }, q ? `Résultats pour « ${q} »` : 'Rechercher')),
    h('span', { class: 'badge', id: 'search-count' }, q ? 'Recherche…' : 'Aucun terme')));

  if (!q) {
    view.append(emptyState({
      iconName: 'search',
      title: 'Indiquez un mot',
      message: 'La recherche couvre les chaînes en direct, les anime et les films. Elle ignore les accents et les majuscules.',
      actionLabel: 'Retour au catalogue',
      onAction: () => navigate('/'),
    }));
    return () => {};
  }

  const listHost = h('div', {});
  view.append(listHost, h('p', { class: 'muted vod-intro' },
    'Chaque résultat indique sa famille par un mot : Chaîne, Anime ou Film. Les trois catalogues partagent la même recherche.'));
  listHost.replaceChildren(spinner('Recherche en cours…'));

  try {
    const payload = await api(`/api/search?q=${encodeURIComponent(q)}&limit=36`);
    const count = view.querySelector('#search-count');
    if (count) {
      count.textContent = payload.total
        ? `${fmtNumber(payload.total)} résultat${payload.total > 1 ? 's' : ''}`
        : 'Aucun résultat';
    }
    if (!payload.results.length) {
      listHost.replaceChildren(emptyState({
        iconName: 'search',
        title: COPY.states.searchEmpty.title,
        message: `Aucune chaîne, aucun anime et aucun film ne correspond à « ${q} ». Essayez un mot plus court.`,
        actionLabel: 'Retour au catalogue',
        onAction: () => navigate('/'),
      }));
      return () => {};
    }
    prefs.pushSearch(q);
    const families = ['chaine', 'anime', 'film'].map((kind) => ({
      kind,
      label: KIND_TONE[kind],
      items: payload.results.filter((result) => result.kind === kind),
    })).filter((family) => family.items.length);

    listHost.replaceChildren(...families.map((family) => h('section', { class: 'vod-block' },
      h('div', { class: 'section-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, family.label),
          h('h2', {}, `${family.label}${family.items.length > 1 ? 's' : ''} · ${family.items.length}`))),
      h('ul', { class: 'search-results' }, family.items.map((result) => resultRow(result, { navigate }))))));
  } catch (error) {
    listHost.replaceChildren(emptyState({
      iconName: 'wifiOff',
      title: 'La recherche n’a pas abouti',
      message: error.message || COPY.states.error.message,
      actionLabel: COPY.actions.retry,
      onAction: () => renderSearch(container, ctx),
    }));
  }
  return () => {};
}
