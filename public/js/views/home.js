// public/js/views/home.js · écran 1 : accueil et catalogue paginé.
// ≤ 60 chaînes par réponse, ≤ 120 cartes dans le DOM, squelettes pendant le chargement.

import { api } from '../api.js?v=3.22.0';
import { COPY } from '../copy.js?v=3.22.0';
import { h, icon, fmtNumber, skeletonGrid, emptyState, spinner, modal, logoNode, toast } from '../ui.js?v=3.22.0';
import { channelCard, categoryChips, hiddenNotice, paintNow } from '../components.js?v=3.22.0';
import { getPlayer } from '../player.js?v=3.22.0';
import { prefs } from '../prefs.js?v=3.22.0';
import { nowFor, heureCourte, progression, primeNow } from '../epg-now.js?v=3.22.0';
import { mountRails } from './rails.js?v=3.22.0';

/** Ligne de programme du héros : remplacée dès que le guide répond, jamais bloquante. */
function programmeLine(channel) {
  if (channel.blocked) {
    return h('p', { class: 'hero-programme', text: 'Lecture limitée sur ce site. La fiche donne la raison et une alternative.' });
  }
  const node = h('p', { class: 'hero-programme', text: 'Programme en cours : chargement du guide…' });
  nowFor(channel.id).then((programme) => {
    if (!programme) {
      node.textContent = 'Programme non communiqué par la chaîne.';
      return;
    }
    const pct = Math.round(progression(programme) * 100);
    node.replaceChildren(
      h('strong', { text: programme.title }),
      h('span', { text: ` · ${heureCourte(programme.start)} – ${heureCourte(programme.stop)} · ${pct} % écoulé` }));
  }).catch(() => { node.textContent = 'Programme non communiqué par la chaîne.'; });
  return node;
}

function heroBlock(hero, { config, openChannel, openPlayer }) {
  const featured = hero.channels?.[0];
  if (!featured) {
    return h('section', { class: 'hero' },
      h('div', { class: 'hero-pattern', 'aria-hidden': 'true' }),
      h('div', { class: 'hero-body' },
        h('div', { class: 'hero-logo' }, h('span', { class: 'hero-initial', text: 'ST' })),
        h('div', { class: 'hero-text' },
          h('p', { class: 'eyebrow' }, 'Bienvenue'),
          h('h1', { text: config.brand }),
          h('p', { text: config.tagline }),
          h('div', { class: 'hero-actions' },
            h('a', { class: 'btn btn-primary', href: '/guide', 'data-link': '' }, icon('list', 16), 'Parcourir le guide'),
            h('a', { class: 'btn btn-ghost', href: '/favoris', 'data-link': '' }, icon('heart', 16), 'Mes favoris')))));
  }
  const rail = (hero.channels || []).slice(1, 6);
  return h('section', { class: 'hero', 'aria-label': 'Chaîne mise en avant' },
    h('div', { class: 'hero-pattern', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-body' },
      h('div', { class: 'hero-logo' }, logoNode(featured)),
      h('div', { class: 'hero-text' },
        h('p', { class: 'eyebrow' }, hero.mode === 'featured' ? 'En vedette' : 'À découvrir'),
        h('h1', { text: featured.name, dir: 'auto' }),
        h('p', { text: `Chaîne ${featured.number}${featured.country ? ` · ${featured.country}` : ''}${featured.quality !== 'AUTO' ? ` · ${featured.quality}` : ''}` }),
        h('div', { class: 'hero-cast' },
          h('span', { class: 'hero-live' }, h('i', { 'aria-hidden': 'true' }), 'En direct'),
          h('span', { class: 'badge' }, `${featured.categoryLabel}`)),
        programmeLine(featured),
        h('div', { class: 'hero-meta' },
          h('span', { class: 'badge', dataset: { tone: 'accent' } }, icon('check', 13), config.maintenanceMode ? 'Catalogue en maintenance' : 'Disponible maintenant'),
          featured.blocked ? h('span', { class: 'badge', dataset: { tone: 'danger' } }, icon('lock', 13), 'Lecture limitée') : null),
        h('div', { class: 'hero-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openPlayer(featured) }, icon('play', 16), COPY.actions.watch),
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => openChannel(featured.id) }, 'Voir la fiche'),
          // Entrée du guide depuis l'accueil : les rangées de programmes restent à un geste.
          h('a', { class: 'btn btn-quiet', href: '/guide', 'data-link': '' },
            icon('list', 16), 'Le guide des programmes')))),
    rail.length ? h('div', { class: 'hero-rail', 'aria-label': 'Autres suggestions' },
      rail.map((channel) => h('button', {
        class: 'hero-mini', type: 'button', onClick: () => openChannel(channel.id),
        'aria-label': `Ouvrir ${channel.name}`,
      }, logoNode(channel), channel.name))) : null);
}

/**
 * Pagination §7.3 : « Page 3 sur 254 · 12 181 chaînes » + précédent/suivant.
 * Masquée quand il n'y a qu'une page ; « suivant » désactivé sur la dernière.
 */
function pager(page, pages, total, onChange) {
  if (pages <= 1) return null;
  const label = `Page ${fmtNumber(page)} sur ${fmtNumber(pages)} · ${fmtNumber(total)} chaîne${total > 1 ? 's' : ''}`;
  return h('nav', { class: 'pager', 'aria-label': 'Pagination du catalogue' },
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', disabled: page <= 1,
      'aria-label': 'Page précédente', onClick: () => onChange(page - 1),
    }, icon('chevron', 15, 'style="transform:rotate(180deg)"'), 'Précédent'),
    h('p', { class: 'pager-label tabular', 'aria-live': 'polite' }, label),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', disabled: page >= pages,
      'aria-label': 'Page suivante', onClick: () => onChange(page + 1),
    }, 'Suivant', icon('chevron', 15)));
}

export async function renderHome(container, ctx) {
  const { config, query, navigate } = ctx;
  const state = {
    q: (query.q || '').trim(),
    cat: query.cat || '',
    sort: query.sort || config.defaultSort || 'number',
    page: Math.max(1, Number(query.p) || 1),
    fav: query.fav === '1',
    // 3.20.0 : « flux vérifiés » ne garde que les chaînes réellement mesurées disponibles.
    verif: query.verif === '1',
  };
  const openPlayer = (channel) => {
    const queue = [...container.querySelectorAll('[data-channel-id]')].map((el) => el.dataset.channelId);
    getPlayer().open(channel, { queue: queue.length ? queue : [channel.id] });
  };
  const openChannel = (id) => navigate(`/chaine/${id}`);

  const setParam = (patch, { resetPage = true } = {}) => {
    const next = { ...state, ...patch };
    if (resetPage) next.page = 1;
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.cat) params.set('cat', next.cat);
    if (next.sort && next.sort !== config.defaultSort) params.set('sort', next.sort);
    if (next.fav) params.set('fav', '1');
    if (next.verif) params.set('verif', '1');
    if (next.page > 1) params.set('p', String(next.page));
    const search = params.toString();
    navigate(`/${search ? `?${search}` : ''}`, { replace: false, keepScroll: false });
  };

  const view = h('div', { class: 'view' });
  container.replaceChildren(view);

  const showHero = !state.q && !state.cat && !state.fav && !state.verif && state.page === 1;
  if (showHero && config.hero) {
    view.append(heroBlock(config.hero, { config, openChannel, openPlayer }));
  }
  // Rails de recommandations : historique local d'abord, puis affinités (ou repli éditorial).
  if (showHero) {
    const railsHost = h('div', { class: 'rails-host' });
    view.append(railsHost);
    mountRails(railsHost, { config, openChannel, openPlayer, navigate }).catch(() => { /* jamais bloquant */ });
  }

  const resultsHost = h('div', {});
  const headerHost = h('div', {});

  if (!state.q) {
    headerHost.append(
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Le catalogue'),
        h('h2', {}, state.cat
          ? (config.categories.find((c) => c.id === state.cat)?.label || 'Catégorie')
          : 'Toutes les chaînes'))),
      categoryChips(config.categories, state.cat, (cat) => setParam({ cat })));
  } else {
    headerHost.append(h('div', { class: 'section-head' }, h('div', {},
      h('p', { class: 'eyebrow' }, 'Recherche'),
      h('h2', { dir: 'auto' }, `Résultats pour « ${state.q} »`))));
  }
  view.append(headerHost);

  const toolbar = h('div', { class: 'toolbar' },
    h('span', { class: 'count-label', id: 'result-count', 'aria-live': 'polite' }, 'Recherche en cours…'),
    hiddenNotice(config.totals.hidden, () => modal({
      title: COPY.banners.hiddenChannels(config.totals.hidden),
      body: h('div', { class: 'prose' },
        h('p', { text: `${fmtNumber(config.totals.catalog)} chaînes sont dans le catalogue, ${fmtNumber(config.totals.visible)} sont visibles ici.` }),
        h('p', { text: config.totals.adultHidden
          ? `${fmtNumber(config.totals.adultHidden)} chaînes de catégorie adulte sont masquées par défaut (réglage « autoHideAdult »).`
          : 'Certaines chaînes sont masquées par une décision du propriétaire.' }),
        h('p', { class: 'muted', text: 'Le propriétaire les affiche depuis la console, onglet Réglages.' })),
    })),
    h('button', {
      class: 'btn btn-ghost btn-sm fav-filter', type: 'button', id: 'fav-filter',
      'aria-pressed': String(state.fav),
      'aria-label': state.fav ? 'Afficher toutes les chaînes' : 'Afficher seulement mes favoris',
      onClick: () => setParam({ fav: state.fav ? '' : '1' }),
    }, icon('heart', 15), 'Mes favoris',
      h('span', { class: 'fav-count', id: 'fav-count', text: String(prefs.favorites().length) })),
    h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', id: 'verif-filter',
      'aria-pressed': String(state.verif),
      'aria-label': state.verif ? 'Afficher toutes les chaînes' : 'Afficher seulement les flux mesurés disponibles',
      onClick: () => setParam({ verif: state.verif ? '' : '1' }),
    }, icon('shield', 15), 'Flux vérifiés'),
    h('span', { class: 'spacer' }),
    h('label', { class: 'visually-hidden', for: 'sort-select' }, 'Trier les chaînes'),
    h('select', {
      class: 'select', id: 'sort-select', value: state.sort,
      onChange: (event) => setParam({ sort: event.target.value }),
    },
    [['number', 'Numéro'], ['name', 'Nom'], ['category', 'Catégorie'], ['recent', 'Ajout récent'], ['confidence', 'Confiance'], ['lisibilite', 'Lisibilité']]
      .map(([value, label]) => h('option', { value, selected: value === state.sort }, label))));
  view.append(toolbar);
  view.append(resultsHost);

  // §2.4 : jamais plus de 120 cartes dans le DOM ; « Charger plus » ajoute sans recharger.
  const CARD_LIMIT = 120;
  let data = null;
  let shown = 0;
  let nextPage = state.page;
  const gridHost = h('div', { class: 'grid', id: 'catalog-grid' });
  const moreHost = h('div', { class: 'more-zone', id: 'more-zone' });

  const announce = (payload) => {
    const counter = container.querySelector('#result-count');
    if (!counter) return;
    counter.textContent = payload.total
      ? `${fmtNumber(shown)} chaîne${shown > 1 ? 's' : ''} affichée${shown > 1 ? 's' : ''} sur ${fmtNumber(payload.total)}`
      : 'Aucun résultat';
  };

  const paintMore = (payload, { first = false } = {}) => {
    moreHost.replaceChildren();
    if (!payload || !payload.channels.length) return;
    const pagination = pager(payload.page, payload.pages, payload.total, (target) => setParam({ page: target }, { resetPage: false }));
    if (payload.hasMore) {
      if (shown >= CARD_LIMIT) {
        moreHost.append(h('p', { class: 'count-label' },
          `Limite de ${CARD_LIMIT} cartes atteinte. Affinez la recherche, changez de catégorie ou passez à la page suivante.`));
      } else {
        const remaining = Math.max(0, payload.total - shown);
        const button = h('button', { class: 'btn btn-ghost', type: 'button' },
          icon('chevron', 15, 'style="transform:rotate(90deg)"'),
          `${COPY.actions.loadMore} · ${fmtNumber(remaining)} restante${remaining > 1 ? 's' : ''}`);
        button.addEventListener('click', () => loadMore(button));
        moreHost.append(button);
      }
    } else if (first) {
      moreHost.append(h('p', { class: 'count-label' }, 'Vous avez atteint la fin du catalogue.'));
    }
    if (pagination) moreHost.append(pagination);
  };

  const appendCards = (payload) => {
    const room = CARD_LIMIT - shown;
    const slice = payload.channels.slice(0, room);
    for (const channel of slice) {
      const card = channelCard(channel, { onOpen: () => openChannel(channel.id), onPlay: openPlayer, showHealth: config.showHealthBadge });
      card.dataset.channelId = channel.id;
      gridHost.append(card);
    }
    shown += slice.length;
    nextPage = payload.page + 1;
    announce(payload);
    paintMore(payload, { first: shown === slice.length });
    // Programmes du lot visible : une requête au maximum, jamais bloquante pour l'affichage.
    primeNow(slice.map((channel) => channel.id))
      .then(() => paintNow(gridHost))
      .catch(() => { /* guide muet : la ligne reste « non communiqué » */ });
  };

  const loadMore = async (button) => {
    button.disabled = true;
    button.replaceChildren(icon('retry', 14), 'Chargement…');
    try {
      const params = new URLSearchParams({
        page: String(nextPage), pageSize: String(config.pageSize || 48), sort: state.sort,
      });
      if (state.cat) params.set('category', state.cat);
      if (state.q) params.set('q', state.q);
      if (state.verif) params.set('etat', 'lisibles');
      const payload = state.q
        ? await api(`/api/channels/search?${params}`)
        : await api(`/api/channels?${params}`);
      appendCards(payload);
    } catch (error) {
      moreHost.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'danger' }, role: 'status' },
        icon('alert', 16),
        h('p', { text: error.message || 'Le chargement a échoué. Réessayez dans quelques instants.' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => paintMore(data, { first: true }) }, COPY.actions.retry)));
    }
  };

  /** Filtre « Mes favoris » : rendu local, aucune requête, état de santé inconnu assumé. */
  const renderFavoris = () => {
    const favoris = prefs.favorites();
    const counter = container.querySelector('#result-count');
    if (counter) {
      counter.textContent = favoris.length
        ? `${favoris.length} chaîne${favoris.length > 1 ? 's' : ''} en favori`
        : 'Aucun favori pour le moment';
    }
    if (!favoris.length) {
      resultsHost.replaceChildren(h('div', { class: 'fav-empty' },
        icon('heart', 26),
        h('p', { style: { fontWeight: '600' } }, 'Aucune chaîne en favori'),
        h('p', { class: 'muted' }, 'Le cœur d’une affiche suffit : la chaîne reste ici, sur cet appareil.'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => setParam({ fav: '' }) }, 'Parcourir le catalogue')));
      return;
    }
    gridHost.replaceChildren(...favoris.map((item) => {
      const card = channelCard({ ...item, health: 'unknown', blocked: false, quality: 'AUTO' }, {
        onOpen: (channel) => openChannel(channel.id),
        onPlay: (channel) => openPlayer(channel),
      });
      card.dataset.channelId = item.id;
      return card;
    }));
    moreHost.replaceChildren();
    resultsHost.replaceChildren(gridHost, moreHost);
    primeNow(favoris.map((item) => item.id))
      .then(() => paintNow(gridHost))
      .catch(() => { /* guide muet : rien à peindre */ });
  };

  const load = async () => {
    if (state.fav) { renderFavoris(); return; }
    resultsHost.replaceChildren(skeletonGrid(12));
    shown = 0;
    nextPage = state.page;
    try {
      const params = new URLSearchParams({
        page: String(state.page), pageSize: String(config.pageSize || 48), sort: state.sort,
      });
      if (state.cat) params.set('category', state.cat);
      if (state.verif) params.set('etat', 'lisibles');
      let payload;
      if (state.q) {
        params.set('q', state.q);
        payload = await api(`/api/channels/search?${params}`);
        prefs.pushSearch(state.q);
      } else {
        payload = await api(`/api/channels?${params}`);
      }
      data = payload;
      renderResults(payload);
    } catch (error) {
      resultsHost.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: COPY.states.error.title,
        message: error.message || COPY.states.error.message,
        actionLabel: COPY.actions.retry,
        onAction: load,
      }));
    }
  };

  const renderResults = (payload) => {
    const count = container.querySelector('#result-count');
    if (count && !payload.total) count.textContent = 'Aucun résultat';
    if (!payload.channels.length) {
      if (state.verif) {
        // Le filtre dit la vérité : aucune chaîne n'a encore été mesurée disponible.
        resultsHost.replaceChildren(emptyState({
          iconName: 'shield',
          title: 'Aucun flux vérifié pour le moment',
          message: 'La sonde teste les chaînes par lots. Tant qu’une chaîne n’a pas été mesurée disponible, elle n’apparaît pas ici.',
          actionLabel: 'Afficher tout le catalogue',
          onAction: () => setParam({ verif: '' }),
        }));
      } else if (state.q) {
        resultsHost.replaceChildren(emptyState({
          iconName: 'search',
          title: COPY.states.searchEmpty.title,
          message: `Aucune chaîne ne correspond à « ${state.q} ». Essayez un autre mot ou effacez les filtres.`,
          actionLabel: 'Effacer la recherche',
          onAction: () => { document.getElementById('search-input').value = ''; setParam({ q: '' }); },
        }));
        if (payload.meta?.suggestions?.length) {
          resultsHost.append(h('div', { style: { textAlign: 'center', marginTop: '16px' } },
            h('p', { class: 'muted' }, 'Peut-être cherchiez-vous :'),
            h('div', { class: 'chips', style: { justifyContent: 'center' } },
              payload.meta.suggestions.map((word) => h('button', {
                class: 'chip', type: 'button', onClick: () => setParam({ q: word }),
              }, word)))));
        }
      } else if (state.cat) {
        resultsHost.replaceChildren(emptyState({
          iconName: 'grid',
          title: COPY.states.categoryEmpty.title,
          message: COPY.states.categoryEmpty.message,
          actionLabel: COPY.states.categoryEmpty.action,
          onAction: () => setParam({ cat: '' }),
        }));
      } else if (state.country || state.lang || state.quality) {
        // État vide utile : la liste est vide parce que les filtres la vident. On dit
        // lesquels sont actifs et on les retire d'un geste, plutôt que de laisser le vide.
        const filtres = [
          state.country ? { clef: 'pays', valeur: state.country, clear: () => setParam({ country: '' }) } : null,
          state.lang ? { clef: 'langue', valeur: state.lang, clear: () => setParam({ lang: '' }) } : null,
          state.quality ? { clef: 'qualité', valeur: state.quality, clear: () => setParam({ quality: '' }) } : null,
        ].filter(Boolean);
        resultsHost.replaceChildren(emptyState({
          iconName: 'filter',
          title: COPY.states.filterEmpty.title,
          message: COPY.states.filterEmpty.message,
          actionLabel: COPY.states.filterEmpty.action,
          onAction: () => setParam({ country: '', lang: '', quality: '' }),
        }));
        if (filtres.length) {
          resultsHost.append(h('div', { class: 'chips', style: { justifyContent: 'center', marginTop: '12px' } },
            filtres.map((filtre) => h('button', {
              class: 'chip', type: 'button',
              title: `Retirer le filtre ${filtre.clef}`,
              onClick: filtre.clear,
            }, `${filtre.clef} : ${filtre.valeur} · retirer`))));
        }
      } else {
        resultsHost.replaceChildren(emptyState({
          iconName: 'tv',
          title: COPY.states.emptyCatalog.title,
          message: COPY.states.emptyCatalog.message,
          actionLabel: COPY.states.emptyCatalog.action,
          onAction: () => navigate('/guide'),
        }));
      }
      return;
    }

    gridHost.replaceChildren();
    resultsHost.replaceChildren(gridHost, moreHost);
    appendCards(payload);
  };

  const desabonner = prefs.onChange(() => {
    const badge = container.querySelector('#fav-count');
    if (badge) badge.textContent = String(prefs.favorites().length);
    if (state.fav) renderFavoris();
  });

  await load();

  // Synchronisation avec la barre de recherche de l'en-tête.
  const input = document.getElementById('search-input');
  if (input) input.value = state.q;
  const onSearch = (event) => {
    const value = event.detail?.q ?? '';
    setParam({ q: value });
  };
  window.addEventListener('streamtv:search', onSearch);
  view.addEventListener('streamtv:leave', () => window.removeEventListener('streamtv:search', onSearch));
  return () => {
    window.removeEventListener('streamtv:search', onSearch);
    desabonner();
  };
}
