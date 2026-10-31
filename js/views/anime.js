// public/js/views/anime.js · parties publiques Anime (3.18.0) : liste et fiche.
// Trois rangées nommées, une rangée vide n'est jamais rendue, trois affiches par ligne
// sur téléphone (vérifié par un test de gabarit, pas à l'œil).

import { api } from '../api.js?v=3.21.0';
import { withBase } from '../base.js?v=3.21.0';
import { COPY } from '../copy.js?v=3.21.0';
import { h, icon, fmtNumber, skeletonGrid, emptyState, spinner, toast } from '../ui.js?v=3.21.0';
import { prefs } from '../prefs.js?v=3.21.0';
import { getPlayer } from '../player.js?v=3.21.0';
import {
  fmtDuration, fmtPosition, sourcesBlock, vodCard, vodFilters, vodPager, vodRow,
} from '../vod-ui.js?v=3.21.0';

const STATUSES = [
  { id: 'en_cours', label: 'En cours' },
  { id: 'termine', label: 'Terminé' },
];

/** Ouvre un épisode, reprend à la seconde mémorisée, enregistre la position en local. */
export function playEpisode({ anime, episode, navigate }) {
  if (!episode || !episode.url) {
    toast('Cet épisode n’a pas encore d’adresse de lecture.', { tone: 'error' });
    return;
  }
  const startAt = prefs.vodProgress('anime', anime.id, episode.id);
  prefs.pushVodHistory({ ...anime, kind: 'anime' }, {
    seconds: startAt,
    durationSeconds: episode.durationSeconds,
    episodeId: episode.id,
  });
  getPlayer().open({
    id: anime.id,
    name: `${anime.title} · ${episode.title}`,
    url: episode.url,
    logo: anime.poster ? withBase(anime.poster) : '',
    quality: episode.quality || 'HD',
    category: 'anime',
    categoryLabel: 'Anime',
    blocked: false,
    variants: [],
  }, {
    queue: [anime.id],
    startAt,
    onTime: (seconds, duration) => {
      prefs.setVodProgress('anime', anime.id, seconds, {
        episodeId: episode.id,
        durationSeconds: duration || episode.durationSeconds,
      });
      prefs.pushVodHistory({ ...anime, kind: 'anime' }, {
        seconds,
        durationSeconds: duration || episode.durationSeconds,
        episodeId: episode.id,
      });
    },
    onClose: () => {
      if (navigate) navigate(`/anime/${anime.id}`, { keepScroll: true });
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

export async function renderAnime(container, ctx) {
  if (ctx.config?.vodEnabled === false) return cataloguesFermes(container, ctx);
  const { config, query, navigate } = ctx;
  const state = {
    genre: query.genre || '',
    year: query.annee || '',
    language: query.langue || '',
    status: query.statut || '',
    page: Math.max(1, Number(query.p) || 1),
  };

  const view = h('div', { class: 'view' });
  container.replaceChildren(view);

  const open = (item) => navigate(`/anime/${item.id}`);
  const setState = (patch) => {
    const next = { ...state, ...patch };
    const params = new URLSearchParams();
    if (next.genre) params.set('genre', next.genre);
    if (next.year) params.set('annee', next.year);
    if (next.language) params.set('langue', next.language);
    if (next.status) params.set('statut', next.status);
    if (next.page > 1) params.set('p', String(next.page));
    const search = params.toString();
    navigate(`/anime${search ? `?${search}` : ''}`);
  };

  const header = h('div', { class: 'section-head' },
    h('div', {},
      h('p', { class: 'eyebrow' }, 'Animation'),
      h('h1', { style: { fontSize: '32px' } }, 'Anime')),
    h('span', { class: 'badge', id: 'anime-count' }, 'Chargement…'));

  const filterHost = h('div', {});
  const rowHost = h('div', { class: 'rails-host' });
  const gridHost = h('div', { class: 'vod-grid', id: 'anime-grid' });
  const pagerHost = h('div', { class: 'more-zone' });

  view.append(
    header,
    filterHost,
    h('p', { class: 'muted vod-intro' },
      'Séries et films d’animation issus de catalogues officiels sous licence libre. La licence de chaque source est affichée sous l’affiche.'),
    rowHost,
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Tout le catalogue'),
        h('h2', {}, 'Toutes les fiches'))),
    gridHost,
    pagerHost);

  const load = async () => {
    gridHost.replaceChildren(skeletonGrid(6));
    pagerHost.replaceChildren();
    rowHost.replaceChildren();
    try {
      const params = new URLSearchParams({ page: String(state.page), pageSize: String(config.pageSize || 48) });
      if (state.genre) params.set('genre', state.genre);
      if (state.year) params.set('annee', state.year);
      if (state.language) params.set('langue', state.language);
      if (state.status) params.set('statut', state.status);
      const payload = await api(`/api/anime?${params}`);
      paint(payload);
    } catch (error) {
      gridHost.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: 'Le catalogue anime n’a pas répondu',
        message: error.message || COPY.states.error.message,
        actionLabel: COPY.actions.retry,
        onAction: load,
      }));
    }
  };

  const paint = (payload) => {
    const count = view.querySelector('#anime-count');
    if (count) {
      count.textContent = payload.total
        ? `${fmtNumber(payload.total)} fiche${payload.total > 1 ? 's' : ''}`
        : 'Aucune fiche';
    }

    filterHost.replaceChildren(vodFilters({
      facets: payload.facets || {},
      state,
      statuses: STATUSES,
      onChange: (patch) => setState({ ...patch, page: 1 }),
    }));

    // Les trois rangées ne sont montrées que si aucun filtre n'est actif : sinon, la grille
    // filtrée est la seule vérité, et aucune rangée vide n'apparaît.
    const filtered = Boolean(state.genre || state.year || state.language || state.status);
    rowHost.replaceChildren();
    if (!filtered) {
      for (const row of payload.rows || []) {
        if (!row.items.length) continue;
        const node = vodRow({ title: row.title, items: row.items, onOpen: open });
        if (node) rowHost.append(node);
      }
    }

    if (!payload.items.length) {
      gridHost.replaceChildren(emptyState({
        iconName: 'search',
        title: payload.total === 0 && !filtered ? 'Aucun anime publié pour l’instant' : 'Aucun anime avec ces filtres',
        message: filtered
          ? 'Retirez un filtre, ou choisissez une autre année : le catalogue reste consultable en entier.'
          : 'Une fiche entre au catalogue quand sa source déclare une licence et au moins un épisode.',
        actionLabel: filtered ? 'Retirer les filtres' : 'Voir les films',
        onAction: filtered
          ? () => setState({ genre: '', year: '', language: '', status: '', page: 1 })
          : () => navigate('/films'),
      }));
      pagerHost.replaceChildren();
      return;
    }

    gridHost.replaceChildren(...payload.items.map((item) => vodCard(item, { onOpen: open })));
    const pager = vodPager(payload.page, payload.pages, payload.total, {
      label: 'anime',
      onChange: (page) => setState({ page }),
    });
    pagerHost.replaceChildren(pager || h('span', {}));
  };

  await load();
  return () => {};
}

/* ------------------------------------------------------------------ fiche */

function episodeRow(anime, episode, ctx) {
  const progress = prefs.vodProgress('anime', anime.id, episode.id);
  const percent = episode.durationSeconds
    ? Math.min(100, Math.round((progress / episode.durationSeconds) * 100))
    : 0;
  return h('li', { class: 'episode-row' },
    h('div', { class: 'episode-main' },
      h('p', { class: 'episode-title' },
        h('span', { class: 'episode-num tabular', text: `Ép. ${episode.number}` }),
        h('span', { class: 'episode-name', dir: 'auto', text: episode.title })),
      h('p', { class: 'episode-meta' },
        `${fmtDuration(episode.durationSeconds)} · ${episode.language} · ${episode.quality}`,
        progress ? ` · repris à ${fmtPosition(progress)}` : '')),
    percent ? h('div', { class: 'episode-bar', role: 'img', 'aria-label': `${percent} % de l’épisode déjà vu` },
      h('i', { style: { width: `${percent}%` } })) : null,
    h('button', {
      class: 'btn btn-primary btn-sm', type: 'button',
      'aria-label': `${progress ? 'Reprendre' : 'Regarder'} l’épisode ${episode.number} de ${anime.title}`,
      onClick: () => playEpisode({ anime, episode, navigate: ctx.navigate }),
    }, icon('play', 14), progress ? 'Reprendre' : 'Regarder'));
}

export async function renderAnimeDetail(container, ctx, id) {
  if (ctx.config?.vodEnabled === false) return cataloguesFermes(container, ctx);
  const { navigate } = ctx;
  container.replaceChildren(spinner('Chargement de la fiche…'));
  let payload;
  try {
    payload = await api(`/api/anime/${encodeURIComponent(id)}`);
  } catch (error) {
    container.replaceChildren(emptyState({
      iconName: error.status === 404 ? 'search' : 'wifiOff',
      title: error.status === 404 ? 'Cet anime n’est plus au catalogue' : COPY.states.error.title,
      message: error.status === 404 ? 'Il a peut-être été retiré par son ayant droit.' : (error.message || COPY.states.error.message),
      actionLabel: 'Revenir aux anime',
      onAction: () => navigate('/anime'),
    }));
    return () => {};
  }

  const anime = payload.anime;
  const firstEpisode = anime.episodes[0];
  const mainProgress = firstEpisode ? prefs.vodProgress('anime', anime.id, firstEpisode.id) : 0;
  const anyProgress = anime.episodes
    .map((episode) => ({ episode, seconds: prefs.vodProgress('anime', anime.id, episode.id) }))
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)[0];

  const favBtn = h('button', {
    class: 'btn btn-ghost', type: 'button',
    'aria-pressed': String(prefs.isVodFavorite('anime', anime.id)),
    onClick: (event) => {
      const button = event.currentTarget;
      const added = prefs.toggleVodFavorite({ ...anime, kind: 'anime' });
      button.setAttribute('aria-pressed', String(added));
      button.replaceChildren(icon('heart', 16), added ? COPY.actions.removeFavorite : COPY.actions.addFavorite);
      toast(added ? 'Anime ajouté à vos favoris sur cet appareil.' : 'Anime retiré de vos favoris.', { tone: 'info', duration: 3000 });
    },
  }, icon('heart', 16), prefs.isVodFavorite('anime', anime.id) ? COPY.actions.removeFavorite : COPY.actions.addFavorite);

  const resumeTarget = anyProgress || (firstEpisode ? { episode: firstEpisode, seconds: mainProgress } : null);
  const watchLabel = resumeTarget && resumeTarget.seconds
    ? `Reprendre à ${fmtPosition(resumeTarget.seconds)}`
    : 'Regarder le premier épisode';

  const detail = h('div', { class: 'view vod-detail' },
    h('nav', { class: 'breadcrumb', 'aria-label': 'Fil d’Ariane' },
      h('a', { href: '/anime', 'data-link': '' }, 'Anime'),
      h('span', { 'aria-hidden': 'true' }, '/'),
      h('span', { text: anime.title })),
    h('section', { class: 'vod-hero' },
      h('div', { class: 'vod-hero-poster' },
        anime.poster
          ? h('img', { src: withBase(anime.poster), alt: '', width: '300', height: '450' })
          : h('span', { class: 'vod-initial', 'aria-hidden': 'true', text: anime.title.slice(0, 2).toUpperCase() })),
      h('div', { class: 'vod-hero-text' },
        h('p', { class: 'eyebrow' }, 'Anime'),
        h('h1', { style: { fontSize: 'clamp(26px,4vw,40px)' }, text: anime.title }),
        h('p', { class: 'vod-original', dir: 'auto', text: `Titre original : ${anime.originalTitle}` }),
        h('p', { class: 'vod-facts' },
          `${anime.year} · ${anime.studio} · ${anime.episodeCount} épisode${anime.episodeCount > 1 ? 's' : ''} · ${anime.language}`,
          anime.statusLabel ? ` · ${anime.statusLabel}` : ''),
        h('p', { class: 'vod-genres' }, (anime.genres || []).join(' · ') || 'Genre non renseigné'),
        anime.synopsis ? h('p', { class: 'vod-synopsis', text: anime.synopsis }) : null,
        h('p', { class: 'vod-licence-line', text: `Licence affichée : ${anime.licence}` }),
        h('div', { class: 'vod-hero-actions' },
          h('button', {
            class: 'btn btn-primary', type: 'button', disabled: !anime.playable,
            onClick: () => {
              const target = resumeTarget?.episode || firstEpisode;
              if (target) playEpisode({ anime, episode: target, navigate });
            },
          }, icon('play', 16), anime.playable ? watchLabel : 'Aucun épisode publié'),
          favBtn,
          h('button', {
            class: 'btn btn-quiet', type: 'button',
            onClick: () => navigate('/anime'),
          }, icon('chevron', 15, 'style="transform:rotate(180deg)"'), 'Tous les anime')))),

    h('section', { class: 'vod-block' },
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Programme'),
        h('h2', {}, 'Épisodes'))),
      anime.episodes.length
        ? h('ol', { class: 'episode-list' }, anime.episodes.map((episode) => episodeRow(anime, episode, ctx)))
        : h('p', { class: 'callout' }, 'Aucun épisode n’est publié pour cette fiche.')),

    h('section', { class: 'vod-block' },
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Droits'),
        h('h2', {}, 'Sources disponibles'))),
      sourcesBlock(anime.sources)),

    (payload.related || []).length
      ? h('section', { class: 'vod-block' },
        h('div', { class: 'section-head' }, h('div', {},
          h('p', { class: 'eyebrow' }, 'Dans la même veine'),
          h('h2', {}, 'À voir aussi'))),
        h('div', { class: 'vod-grid' },
          payload.related.map((item) => vodCard(item, { onOpen: (entry) => navigate(`/anime/${entry.id}`) }))))
      : null);

  container.replaceChildren(detail);
  return () => {};
}
