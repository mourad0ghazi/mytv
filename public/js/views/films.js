// public/js/views/films.js · parties publiques Films (3.18.0) : liste et fiche.
// Un film n'est pas une chaîne : pas de guide, pas de direct, mais une durée, une année,
// des genres et une reprise de lecture à la seconde.

import { api } from '../api.js?v=3.19.0';
import { withBase } from '../base.js?v=3.19.0';
import { COPY } from '../copy.js?v=3.19.0';
import { h, icon, fmtNumber, skeletonGrid, emptyState, spinner, toast } from '../ui.js?v=3.19.0';
import { prefs } from '../prefs.js?v=3.19.0';
import { getPlayer } from '../player.js?v=3.19.0';
import {
  fmtDuration, fmtPosition, sourcesBlock, vodCard, vodFilters, vodPager, vodRow,
} from '../vod-ui.js?v=3.19.0';

/** Ouvre le film, reprend à la seconde mémorisée, enregistre la position en local. */
export function playFilm({ film, navigate }) {
  if (!film || !film.url) {
    toast('Ce film n’a pas encore d’adresse de lecture.', { tone: 'error' });
    return;
  }
  const startAt = prefs.vodProgress('film', film.id);
  prefs.pushVodHistory({ ...film, kind: 'film' }, {
    seconds: startAt,
    durationSeconds: film.durationSeconds,
  });
  getPlayer().open({
    id: film.id,
    name: film.title,
    url: film.url,
    logo: film.poster ? withBase(film.poster) : '',
    quality: film.quality || 'HD',
    category: 'cinema',
    categoryLabel: 'Film',
    blocked: false,
    variants: [],
  }, {
    queue: [film.id],
    startAt,
    onTime: (seconds, duration) => {
      prefs.setVodProgress('film', film.id, seconds, {
        durationSeconds: duration || film.durationSeconds,
      });
      prefs.pushVodHistory({ ...film, kind: 'film' }, {
        seconds,
        durationSeconds: duration || film.durationSeconds,
      });
    },
    onClose: () => {
      if (navigate) navigate(`/film/${film.id}`, { keepScroll: true });
    },
  }).catch(() => {
    toast('La lecture n’a pas pu démarrer. Réessayez dans un instant.', { tone: 'error' });
  });
}


/** Réglage fermé : la page le dit, elle ne fait pas croire à un catalogue vide. */
function cataloguesFermes(container, ctx) {
  container.replaceChildren(emptyState({
    iconName: 'lock',
    title: 'Catalogues anime et films fermés',
    message: 'Le propriétaire les a désactivés depuis la console. Le catalogue des chaînes reste disponible.',
    actionLabel: 'Voir les chaînes',
    onAction: () => ctx.navigate('/'),
  }));
  return () => {};
}

/* ------------------------------------------------------------------ liste */

export async function renderFilms(container, ctx) {
  if (ctx.config?.vodEnabled === false) return cataloguesFermes(container, ctx);
  const { config, query, navigate } = ctx;
  const state = {
    genre: query.genre || '',
    year: query.annee || '',
    language: query.langue || '',
    page: Math.max(1, Number(query.p) || 1),
  };

  const view = h('div', { class: 'view' });
  container.replaceChildren(view);

  const open = (item) => navigate(`/film/${item.id}`);
  const setState = (patch) => {
    const next = { ...state, ...patch };
    const params = new URLSearchParams();
    if (next.genre) params.set('genre', next.genre);
    if (next.year) params.set('annee', next.year);
    if (next.language) params.set('langue', next.language);
    if (next.page > 1) params.set('p', String(next.page));
    const search = params.toString();
    navigate(`/films${search ? `?${search}` : ''}`);
  };

  const header = h('div', { class: 'section-head' },
    h('div', {},
      h('p', { class: 'eyebrow' }, 'Cinéma'),
      h('h1', { style: { fontSize: '32px' } }, 'Films')),
    h('span', { class: 'badge', id: 'films-count' }, 'Chargement…'));

  const filterHost = h('div', {});
  const rowHost = h('div', { class: 'rails-host' });
  const gridHost = h('div', { class: 'vod-grid', id: 'films-grid' });
  const pagerHost = h('div', { class: 'more-zone' });

  view.append(
    header,
    filterHost,
    h('p', { class: 'muted vod-intro' },
      'Longs et courts métrages de catalogues officiels sous licence libre. Pas de direct, pas de guide : une durée, une année, des genres. La lecture reprend où vous l’avez laissée, sur cet appareil.'),
    rowHost,
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Tout le catalogue'),
        h('h2', {}, 'Tous les films'))),
    gridHost,
    pagerHost);

  const renderResume = () => {
    const history = prefs.vodHistory().filter((entry) => entry.kind === 'film');
    if (!history.length) return null;
    return vodRow({
      title: 'À reprendre',
      subtitle: 'Votre historique local',
      items: history.slice(0, 12).map((entry) => ({
        id: entry.id,
        kind: 'film',
        title: entry.title,
        poster: entry.poster,
        year: entry.year,
        durationSeconds: entry.durationSeconds,
        licence: 'Voir la fiche',
        language: '',
      })),
      onOpen: open,
      moreHref: '/favoris?onglet=historique',
      moreLabel: 'Mon historique',
    });
  };

  const load = async () => {
    gridHost.replaceChildren(skeletonGrid(6));
    pagerHost.replaceChildren();
    rowHost.replaceChildren();
    try {
      const params = new URLSearchParams({ page: String(state.page), pageSize: String(config.pageSize || 48) });
      if (state.genre) params.set('genre', state.genre);
      if (state.year) params.set('annee', state.year);
      if (state.language) params.set('langue', state.language);
      const payload = await api(`/api/films?${params}`);
      paint(payload);
    } catch (error) {
      gridHost.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: 'Le catalogue de films n’a pas répondu',
        message: error.message || COPY.states.error.message,
        actionLabel: COPY.actions.retry,
        onAction: load,
      }));
    }
  };

  const paint = (payload) => {
    const count = view.querySelector('#films-count');
    if (count) {
      count.textContent = payload.total
        ? `${fmtNumber(payload.total)} film${payload.total > 1 ? 's' : ''}`
        : 'Aucun film';
    }

    filterHost.replaceChildren(vodFilters({
      facets: payload.facets || {},
      state,
      onChange: (patch) => setState({ ...patch, page: 1 }),
    }));

    const filtered = Boolean(state.genre || state.year || state.language);
    rowHost.replaceChildren();
    if (!filtered) {
      const reprise = renderResume();
      if (reprise) rowHost.append(reprise);
      for (const row of payload.rows || []) {
        if (!row.items.length) continue;
        const node = vodRow({
          title: row.title,
          items: row.items,
          onOpen: open,
          moreHref: row.genre ? `/films?genre=${encodeURIComponent(row.genre)}` : '',
        });
        if (node) rowHost.append(node);
      }
    }

    if (!payload.items.length) {
      gridHost.replaceChildren(emptyState({
        iconName: 'search',
        title: filtered ? 'Aucun film avec ces filtres' : 'Aucun film publié pour l’instant',
        message: filtered
          ? 'Retirez un filtre : le catalogue complet reste consultable en un geste.'
          : 'Un film entre au catalogue quand sa source déclare une licence et une adresse de lecture.',
        actionLabel: filtered ? 'Retirer les filtres' : 'Voir les anime',
        onAction: filtered
          ? () => setState({ genre: '', year: '', language: '', page: 1 })
          : () => navigate('/anime'),
      }));
      pagerHost.replaceChildren();
      return;
    }

    gridHost.replaceChildren(...payload.items.map((item) => vodCard(item, { onOpen: open })));
    const pager = vodPager(payload.page, payload.pages, payload.total, {
      label: 'film' + (payload.total > 1 ? 's' : ''),
      onChange: (page) => setState({ page }),
    });
    pagerHost.replaceChildren(pager || h('span', {}));
  };

  await load();
  const offListe = prefs.onChange((type) => {
    if (type === 'history' && !state.genre && !state.year && !state.language) {
      rowHost.replaceChildren();
      const reprise = renderResume();
      if (reprise) rowHost.append(reprise);
    }
  });
  return () => offListe();
}

/* ------------------------------------------------------------------ fiche */

export async function renderFilmDetail(container, ctx, id) {
  if (ctx.config?.vodEnabled === false) return cataloguesFermes(container, ctx);
  const { navigate } = ctx;
  container.replaceChildren(spinner('Chargement de la fiche…'));
  let payload;
  try {
    payload = await api(`/api/films/${encodeURIComponent(id)}`);
  } catch (error) {
    container.replaceChildren(emptyState({
      iconName: error.status === 404 ? 'search' : 'wifiOff',
      title: error.status === 404 ? 'Ce film n’est plus au catalogue' : COPY.states.error.title,
      message: error.status === 404 ? 'Il a peut-être été retiré par son ayant droit.' : (error.message || COPY.states.error.message),
      actionLabel: 'Revenir aux films',
      onAction: () => navigate('/films'),
    }));
    return () => {};
  }

  const film = payload.film;
  const progress = prefs.vodProgress('film', film.id);
  const fav = prefs.isVodFavorite('film', film.id);

  const favBtn = h('button', {
    class: 'btn btn-ghost', type: 'button',
    'aria-pressed': String(fav),
    onClick: (event) => {
      const button = event.currentTarget;
      const added = prefs.toggleVodFavorite({ ...film, kind: 'film' });
      button.setAttribute('aria-pressed', String(added));
      button.replaceChildren(icon('heart', 16), added ? COPY.actions.removeFavorite : COPY.actions.addFavorite);
      toast(added ? 'Film ajouté à vos favoris sur cet appareil.' : 'Film retiré de vos favoris.', { tone: 'info', duration: 3000 });
    },
  }, icon('heart', 16), fav ? COPY.actions.removeFavorite : COPY.actions.addFavorite);

  const percent = film.durationSeconds && progress
    ? Math.min(100, Math.round((progress / film.durationSeconds) * 100))
    : 0;

  const detail = h('div', { class: 'view vod-detail' },
    h('nav', { class: 'breadcrumb', 'aria-label': 'Fil d’Ariane' },
      h('a', { href: '/films', 'data-link': '' }, 'Films'),
      h('span', { 'aria-hidden': 'true' }, '/'),
      h('span', { text: film.title })),
    h('section', { class: 'vod-hero' },
      h('div', { class: 'vod-hero-poster' },
        film.poster
          ? h('img', { src: withBase(film.poster), alt: '', width: '300', height: '450' })
          : h('span', { class: 'vod-initial', 'aria-hidden': 'true', text: film.title.slice(0, 2).toUpperCase() })),
      h('div', { class: 'vod-hero-text' },
        h('p', { class: 'eyebrow' }, 'Film'),
        h('h1', { style: { fontSize: 'clamp(26px,4vw,40px)' }, text: film.title }),
        h('p', { class: 'vod-original', dir: 'auto', text: `Titre original : ${film.originalTitle}` }),
        h('p', { class: 'vod-facts' },
          `${film.year} · ${fmtDuration(film.durationSeconds)} · ${film.language}`,
          film.director ? ` · Réalisation : ${film.director}` : ''),
        h('p', { class: 'vod-genres' }, (film.genres || []).join(' · ') || 'Genre non renseigné'),
        film.synopsis ? h('p', { class: 'vod-synopsis', text: film.synopsis }) : null,
        progress
          ? h('div', { class: 'vod-resume-block' },
            h('p', { class: 'vod-resume-line', text: `Reprise possible à ${fmtPosition(progress)} (${percent} % du film).` }),
            h('div', { class: 'episode-bar', role: 'img', 'aria-label': `${percent} % du film déjà vu` },
              h('i', { style: { width: `${percent}%` } })))
          : null,
        h('p', { class: 'vod-licence-line', text: `Licence affichée : ${film.licence}` }),
        h('div', { class: 'vod-hero-actions' },
          h('button', {
            class: 'btn btn-primary', type: 'button', disabled: !film.playable,
            onClick: () => playFilm({ film, navigate }),
          }, icon('play', 16),
          !film.playable
            ? 'Aucune source lisible'
            : progress ? `Reprendre à ${fmtPosition(progress)}` : 'Regarder depuis le début'),
          favBtn,
          h('button', {
            class: 'btn btn-quiet', type: 'button',
            onClick: () => navigate('/films'),
          }, icon('chevron', 15, 'style="transform:rotate(180deg)"'), 'Tous les films')))),

    h('section', { class: 'vod-block' },
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Droits'),
        h('h2', {}, 'Sources disponibles'))),
      sourcesBlock(film.sources)),

    (payload.related || []).length
      ? h('section', { class: 'vod-block' },
        h('div', { class: 'section-head' }, h('div', {},
          h('p', { class: 'eyebrow' }, 'Dans la même veine'),
          h('h2', {}, 'À voir aussi'))),
        h('div', { class: 'vod-grid' },
          payload.related.map((item) => vodCard(item, { onOpen: (entry) => navigate(`/film/${entry.id}`) }))))
      : null);

  container.replaceChildren(detail);
  return () => {};
}
