// public/js/app.js · amorçage de la coquille, en-tête, bannières, routeur, enregistrement du service worker.
// Une seule instance d'application : #main est le seul point de montage des vues.

import { api, ApiError, auth } from './api.js?v=3.20.0';
import { consoleHref, loginHref, rememberConsole } from './console.js?v=3.20.0';
import { COPY } from './copy.js?v=3.20.0';
import { h, icon, toast, modal, spinner, debounce } from './ui.js?v=3.20.0';
import { createRouter } from './router.js?v=3.20.0';
import { getPlayer } from './player.js?v=3.20.0';
import { applyTvMode, wireTvKeys, wireInstall } from './tv.js?v=3.20.0';
import { prefs } from './prefs.js?v=3.20.0';
import { BASE, withBase } from './base.js?v=3.20.0';
import { PLAFOND_AMORCAGE, avecPlafond } from './amorcage.js?v=3.20.0';

import { renderHome } from './views/home.js?v=3.20.0';
import { renderGuide } from './views/guide.js?v=3.20.0';
import { renderChannel } from './views/channel.js?v=3.20.0';
import { renderFavorites } from './views/favorites.js?v=3.20.0';
import { renderLogin } from './views/login.js?v=3.20.0';
import { renderAccess } from './views/access.js?v=3.20.0';
import { renderAnime, renderAnimeDetail } from './views/anime.js?v=3.20.0';
import { renderFilms, renderFilmDetail } from './views/films.js?v=3.20.0';
import { renderSearch } from './views/search.js?v=3.20.0';
import { renderCompte } from './views/compte.js?v=3.20.0';

/**
 * Chargements différés : la console d'administration et les pages légales ne sont
 * téléchargées qu'au moment où elles sont ouvertes (premier rendu plus rapide, AC-032).
 */
const loadAdmin = () => import('./views/admin.js?v=3.20.0');
const loadLegal = () => import('./views/legal.js?v=3.20.0');
import { renderNotFound, renderFailure, renderOffline } from './views/error.js?v=3.20.0';

/* Plafond dur de cartes « chaîne » simultanées dans le DOM (§2.4, BUG-12). */
export const MAX_DOM_CARDS = 120;

const state = {
  config: null,
  configAt: 0,
  offline: false,
  booted: false,
  route: null,
  dismissedBanners: new Set(),
  renderToken: 0,
  cleanup: null,
  container: null,
};

const $main = () => document.getElementById('main');

/* ------------------------------------------------------------------ config */

async function loadConfig() {
  const config = await api('/api/config');
  state.config = config;
  state.configAt = Date.now();
  state.offline = false;
  return config;
}

function applyBrand(config) {
  if (!config) return;
  const root = document.documentElement;
  document.title = `${config.brand} · ${config.tagline || COPY.tagline}`;

  document.querySelectorAll('[data-brand], #brand-text, .brand-text').forEach((node) => {
    node.textContent = config.brand || 'StreamTV';
  });
  if (/^#[0-9a-f]{3}([0-9a-f]{6})?$/i.test(config.accent || '')) {
    root.style.setProperty('--accent', config.accent);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#06070b');
  const note = document.querySelector('[data-footer-note]');
  if (note) {
    note.textContent = config.footerNote || '';
    note.hidden = !config.footerNote;
  }
  const legal = document.querySelector('[data-legal-mention]');
  if (legal) legal.textContent = config.legal?.mention || COPY.legal.mention;
  const footerMeta = document.getElementById('footer-meta');
  if (footerMeta) {
    footerMeta.textContent = `${config.brand} v${config.version} · Node.js · zéro dépendance · ${config.totals?.visible ?? 0} chaînes visibles`;
  }
  const logoMark = document.querySelector('.brand-mark');
  if (logoMark && config.logoUrl) {
    const img = h('img', { src: config.logoUrl, alt: '', width: '26', height: '26', loading: 'eager' });
    img.addEventListener('error', () => { img.remove(); }, { once: true });
    logoMark.replaceChildren(img);
  }
}

/* ------------------------------------------------------------------ bannières */

function banner(id, tone, message, actions = []) {
  if (state.dismissedBanners.has(id)) return null;
  const node = h('div', { class: 'banner', dataset: { tone }, id: `banner-${id}` },
    icon(tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : 'shield', 16),
    h('p', { text: message }),
    ...actions,
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Masquer ce message',
      onClick: () => { state.dismissedBanners.add(id); node.remove(); },
    }, icon('close', 14)));
  return node;
}

function renderBanners() {
  const host = document.getElementById('banner-stack');
  if (!host) return;
  const config = state.config;
  const nodes = [];
  if (state.offline) {
    nodes.push(banner('offline', 'danger', COPY.banners.offline, [
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => window.location.reload() }, COPY.actions.retry),
    ]));
  }
  if (config) {
    if (config.defaultPassword) {
      nodes.push(banner('password', 'warn', COPY.banners.defaultPassword));
    }
    if (config.maintenanceMode) {
      nodes.push(banner('maintenance', 'info', COPY.banners.maintenance));
    }
    for (const [index, notice] of (config.notices || []).entries()) {
      nodes.push(banner(`notice-${index}-${notice.slice(0, 12)}`, 'info', notice));
    }
    if (config.totals?.hidden > 0) {
      nodes.push(banner('hidden', 'info', COPY.banners.hiddenChannels(config.totals.hidden), [
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button',
          onClick: () => modal({
            title: 'Chaînes masquées',
            body: h('div', { class: 'prose' },
              h('p', { text: `${config.totals.catalog} chaînes au catalogue, ${config.totals.visible} visibles.` }),
              h('p', { text: config.totals.adultHidden
                ? `${config.totals.adultHidden} chaînes adultes sont masquées par défaut.`
                : 'Des chaînes sont masquées par une décision du propriétaire.' }),
              h('p', { class: 'muted', text: 'Le propriétaire les règle depuis la console, onglet Réglages.' })),
          }),
        }, 'En savoir plus'),
      ]));
    }
  }
  host.replaceChildren(...nodes.filter(Boolean));
}

/* ------------------------------------------------------------------ vues */

function buildContext(route, container) {
  return {
    config: state.config,
    query: route.query,
    params: route.params,
    route,
    navigate: (to, options) => router.navigate(to, options),
    refreshConfig: async () => {
      try {
        const config = await loadConfig();
        applyBrand(config);
        renderBanners();
        syncHeader(config);
        return config;
      } catch (error) {
        handleApiFailure(error);
        return state.config;
      }
    },
    updateBrand: (settings) => {
      if (!state.config) return;
      state.config = { ...state.config, ...settings };
      applyBrand(state.config);
      renderBanners();
    },
    container,
    isOffline: () => state.offline,
    getPlayer,
    prefs,
  };
}

function clearCurrent() {
  const { container } = state;
  if (container) {
    const root = container.lastElementChild;
    if (root) {
      try { root.dispatchEvent(new CustomEvent('streamtv:leave', { bubbles: false })); } catch { /* ignore */ }
    }
    try { container.dispatchEvent(new CustomEvent('streamtv:leave')); } catch { /* ignore */ }
  }
  if (typeof state.cleanup === 'function') {
    try { state.cleanup(); } catch { /* un nettoyage ne doit jamais bloquer une navigation */ }
  }
  state.cleanup = null;
}

function setTitle(route) {
  const brand = state.config?.brand || 'StreamTV';
  const routeName = document.querySelector('#route-announcer');
  const label = route.name === 'channel' ? 'Fiche chaîne' : routeTitleFor(route);
  document.title = route.name === 'home' ? `${brand} · ${state.config?.tagline || 'Toute la télévision'}` : `${label} · ${brand}`;
  if (routeName) routeName.textContent = label;
}

function routeTitleFor(route) {
  const titles = {
    home: 'Catalogue', search: 'Recherche', guide: 'Guide', channel: 'Fiche chaîne',
    anime: 'Anime', animeDetail: 'Fiche anime', films: 'Films', filmDetail: 'Fiche film',
    favorites: 'Favoris et historique', login: 'Connexion administration', admin: 'Administration',
    legal: 'Mentions légales', privacy: 'Confidentialité', report: 'Signaler un contenu',
    help: 'Aide et raccourcis', errors: 'Catalogue des messages', notFound: 'Page introuvable',
  };
  return titles[route.name] || 'StreamTV';
}

function markNav(route) {
  const map = {
    home: 'home', search: 'home', guide: 'guide', anime: 'anime', animeDetail: 'anime',
    films: 'films', filmDetail: 'films', favorites: 'favorites', help: 'help', errors: 'help',
    admin: 'admin', login: 'admin',
  };
  const active = map[route.name] || '';
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function renderRoute(route) {
  const main = $main();
  if (!main) return;
  const token = ++state.renderToken;

  clearCurrent();
  markNav(route);
  setTitle(route);
  state.route = route;

  if (state.offline && route.name !== 'errors') {
    const container = h('div', {});
    main.replaceChildren(container);
    state.container = container;
    state.cleanup = renderOffline(container, buildContext(route, container));
    return;
  }

  if (state.config?.maintenanceMode && route.name !== 'admin' && route.name !== 'login' && route.name !== 'help') {
    const container = h('div', {});
    main.replaceChildren(container);
    state.container = container;
    state.cleanup = maintenanceNotice(container);
    return;
  }

  // Conteneur neuf : une vue périmée écrit dans un nœud détaché, jamais dans l'écran courant.
  const container = h('div', { class: 'route-host' });
  main.replaceChildren(container);
  state.container = container;
  const ctx = buildContext(route, container);

  try {
    let cleanup = null;
    switch (route.name) {
      case 'home':
        cleanup = await renderHome(container, ctx);
        break;
      case 'search':
        cleanup = await renderSearch(container, ctx);
        break;
      case 'guide':
        cleanup = await renderGuide(container, ctx);
        break;
      case 'channel':
        cleanup = await renderChannel(container, ctx, route.params.id);
        break;
      case 'anime':
        cleanup = await renderAnime(container, ctx);
        break;
      case 'animeDetail':
        cleanup = await renderAnimeDetail(container, ctx, route.params.id);
        break;
      case 'films':
        cleanup = await renderFilms(container, ctx);
        break;
      case 'filmDetail':
        cleanup = await renderFilmDetail(container, ctx, route.params.id);
        break;
      case 'favorites':
        cleanup = await renderFavorites(container, ctx);
        break;
      case 'login':
        cleanup = await renderLogin(container, ctx);
        break;
      case 'compte':
        cleanup = await renderCompte(container, ctx, 'compte');
        break;
      case 'compteInscription':
        cleanup = await renderCompte(container, ctx, 'inscription');
        break;
      case 'compteConnexion':
        cleanup = await renderCompte(container, ctx, 'connexion');
        break;
      case 'access':
        cleanup = await renderAccess(container, ctx, route.params.token);
        break;
      case 'admin': {
        const { renderAdmin } = await loadAdmin();
        cleanup = await renderAdmin(container, ctx);
        break;
      }
      case 'legal':
      case 'privacy':
      case 'report':
      case 'help':
      case 'errors': {
        const views = await loadLegal();
        const render = {
          legal: views.renderLegal, privacy: views.renderPrivacy, report: views.renderReport,
          help: views.renderHelp, errors: views.renderErrors,
        }[route.name];
        cleanup = await render(container, ctx);
        break;
      }
      default:
        cleanup = renderNotFound(container, ctx);
    }
    if (token !== state.renderToken) {
      // Navigation plus récente : on jette le nettoyage de la vue périmée.
      return;
    }
    state.cleanup = typeof cleanup === 'function' ? cleanup : null;
    syncSearchInput(route);
  } catch (error) {
    if (token !== state.renderToken) return;
    handleApiFailure(error, container, route);
  }
}

function maintenanceNotice(container) {
  const view = h('div', { class: 'view page-error' },
    h('div', { class: 'error-shell' },
      h('div', { class: 'empty-icon' }, icon('settings', 26)),
      h('h1', {}, 'Maintenance en cours'),
      h('p', { class: 'muted' }, COPY.banners.maintenance),
      h('p', { class: 'muted' }, 'Le catalogue est momentanément fermé. Revenez dans quelques minutes.'),
      h('div', { class: 'error-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => renderRoute(state.route) }, icon('retry', 16), COPY.actions.retry),
        h('a', { class: 'btn btn-ghost', href: consoleHref(), 'data-link': '' }, COPY.actions.admin))));
  container.replaceChildren(view);
  return () => {};
}

function handleApiFailure(error, container = null, route = null) {
  if (error?.name === 'AbortError') return;
  const isAuth = error instanceof ApiError && (error.code === 'ERR-07' || error.status === 401);
  if (isAuth) {
    if (state.route?.name === 'admin') {
      toast(COPY.login.expired, { tone: 'error' });
      router.navigate(loginHref(), { replace: true });
      return;
    }
    auth.clear();
  }
  if (navigator.onLine === false) {
    state.offline = true;
    renderBanners();
  }
  const host = container || $main();
  if (!host) return;
  const isNotFound = error instanceof ApiError && (error.status === 404 || error.code === 'ERR-10');
  const view = h('div', {});
  host.replaceChildren(view);
  if (isNotFound && route?.name === 'channel') {
    renderFailure(view, buildContext(route, view), error, { onRetry: () => router.navigate('/guide') });
    return;
  }
  renderFailure(view, buildContext(route || state.route, view), error, {
    onRetry: () => renderRoute(state.route),
  });
}

/* ------------------------------------------------------------------ en-tête */

function syncSearchInput(route) {
  const input = document.getElementById('search-input');
  if (!input) return;
  const q = route?.query?.q || '';
  if (input.value !== q) input.value = q;
  toggleClear();
}

function toggleClear() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  if (input && clear) clear.hidden = !input.value;
}

function syncHeader(config) {
  // Les entrées Anime et Films suivent le réglage : fermées, elles quittent les deux barres.
  const vodActif = config?.vodEnabled !== false;
  document.querySelectorAll('[data-nav="anime"], [data-nav="films"]').forEach((node) => {
    node.hidden = !vodActif;
  });
  const input = document.getElementById('search-input');
  if (input && config) {
    input.setAttribute('placeholder', `Rechercher parmi ${config.totals?.visible ?? 0} chaînes, un pays, une catégorie…`);
  }
  // L'entrée de la console reste invisible : elle n'apparaît qu'au navigateur qui a déjà
  // franchi le chemin privé, et seulement s'il a une session ouverte.
  const adminLink = document.querySelector('[data-nav="admin"]');
  if (adminLink) {
    const ouvert = auth.isSignedIn() && Boolean(state.gate?.admin);
    adminLink.hidden = !ouvert;
    if (ouvert) {
      adminLink.setAttribute('href', consoleHref());
      adminLink.textContent = 'Console';
      adminLink.setAttribute('aria-label', 'Console, session ouverte');
    }
  }
}

/* ------------------------------------------------------------------ suggestions de recherche */

/**
 * Liste de suggestions conforme au contrat §7.3 : `role="searchbox"` + `aria-autocomplete="list"`,
 * `role="listbox"` pour le panneau, `aria-activedescendant` pour la navigation au clavier.
 * Fermeture par Échap, sélection par Entrée, aucune requête si la saisie fait moins de 2 caractères.
 */
const suggest = {
  items: [],
  active: -1,
  controller: null,
  open: false,
  input: null,
  panel: null,
  query: '',

  init() {
    this.input = document.getElementById('search-input');
    this.panel = document.getElementById('search-suggestions');
    if (!this.input || !this.panel) return;
    this.input.addEventListener('input', () => this.queue());
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    this.panel.addEventListener('mousedown', (event) => event.preventDefault());
  },

  queue() {
    clearTimeout(this.timer);
    const value = this.input.value.trim();
    if (value.length < 2) { this.close(); return; }
    this.timer = setTimeout(() => this.fetch(value), 220);
  },

  /**
   * La recherche globale couvre les trois familles. Chaque suggestion porte son type
   * écrit en toutes lettres : « Chaîne », « Anime », « Film ». Aucune couleur de catégorie.
   */
  async fetch(query) {
    this.query = query;
    this.controller?.abort();
    this.controller = new AbortController();
    try {
      const payload = await api(`/api/search?q=${encodeURIComponent(query)}&limit=7`, { signal: this.controller.signal });
      if (this.input.value.trim() !== query) return;
      this.items = (payload.results || []).slice(0, 7);
      this.active = -1;
      this.render();
    } catch {
      this.close();
    }
  },

  render() {
    if (!this.items.length) { this.close(); return; }
    this.panel.replaceChildren(
      h('p', { class: 'search-suggest-head' }, `Suggestions pour « ${this.query} »`),
      ...this.items.map((item, index) => h('button', {
        class: 'search-suggest-item',
        type: 'button',
        role: 'option',
        id: `search-option-${index}`,
        'aria-selected': 'false',
        dataset: { channelId: item.id, kind: item.kind },
        onClick: () => this.choose(index),
      },
      h('span', { class: 'search-suggest-num tabular' },
        item.kind === 'chaine' && item.number ? String(item.number).padStart(3, '0') : ''),
      h('span', { class: 'search-suggest-name', dir: 'auto' }, item.title),
      // Le type est un mot : la famille se lit, elle ne se devine pas à une teinte.
      h('span', { class: 'search-suggest-cat' }, `${item.kindLabel} · ${item.subtitle || ''}`.trim()))));
    this.panel.hidden = false;
    this.open = true;
    this.input.setAttribute('aria-expanded', 'true');
  },

  onKey(event) {
    if (!this.open) return;
    const count = this.items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + delta + count) % count;
      this.highlight();
      return;
    }
    if (event.key === 'Enter' && this.active >= 0) {
      event.preventDefault();
      this.choose(this.active);
      return;
    }
    if (event.key === 'Escape') {
      this.close();
      this.input.blur();
    }
  },

  highlight() {
    const options = [...this.panel.querySelectorAll('[role="option"]')];
    options.forEach((option, index) => {
      const selected = index === this.active;
      option.setAttribute('aria-selected', String(selected));
      option.classList.toggle('is-active', selected);
    });
    const activeOption = options[this.active];
    if (activeOption) {
      this.input.setAttribute('aria-activedescendant', activeOption.id);
      activeOption.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  },

  choose(index) {
    const item = this.items[index];
    this.close();
    if (!item) return;
    this.input.value = '';
    toggleClear();
    router.navigate(item.href || `/chaine/${item.id}`);
  },

  close() {
    if (!this.panel) return;
    this.open = false;
    this.active = -1;
    this.items = [];
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.input?.setAttribute('aria-expanded', 'false');
    this.input?.removeAttribute('aria-activedescendant');
  },
};

function wireHeader() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');

  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = input.value.trim();
      if (!q) { router.navigate('/'); return; }
      // Le guide garde sa recherche interne ; partout ailleurs, la recherche est globale
      // et couvre chaînes, anime et films.
      if (state.route?.name === 'guide') router.navigate(`/guide?q=${encodeURIComponent(q)}`);
      else router.navigate(`/recherche?q=${encodeURIComponent(q)}`);
      window.dispatchEvent(new CustomEvent('streamtv:search', { detail: { q } }));
    });
    input.addEventListener('input', debounce(() => {
      toggleClear();
      if (state.route?.name === 'home' || state.route?.name === 'search') {
        window.dispatchEvent(new CustomEvent('streamtv:search', { detail: { q: input.value.trim() } }));
      }
    }, 320));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        input.value = '';
        toggleClear();
        input.blur();
        if (state.route?.name === 'home' || state.route?.name === 'search') router.navigate('/');
      }
    });
  }
  if (clear && input) {
    clear.addEventListener('click', () => {
      input.value = '';
      toggleClear();
      input.focus();
      if (state.route?.name === 'home' || state.route?.name === 'search') router.navigate('/');
    });
  }

  suggest.init();

  const shortcuts = document.getElementById('shortcuts-btn');
  if (shortcuts) shortcuts.addEventListener('click', openShortcuts);
  const favoriteShortcut = document.getElementById('fav-shortcut');
  if (favoriteShortcut) favoriteShortcut.addEventListener('click', () => router.navigate('/favoris'));

  // Barre d'onglets mobile : « Rechercher » ramène en haut et place le curseur dans le champ.
  const tabSearch = document.getElementById('tabbar-search');
  if (tabSearch) {
    tabSearch.addEventListener('click', () => {
      if (state.route?.name !== 'home' && state.route?.name !== 'search') router.navigate('/');
      const input = document.getElementById('search-input');
      if (!input) return;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      input.focus({ preventScroll: true });
    });
  }
}

function openShortcuts() {
  const rows = COPY.player.shortcuts.map(([keys, label]) => h('div', { class: 'variant' },
    h('kbd', { class: 'kbd' }, keys), h('span', {}, label)));
  modal({
    title: 'Raccourcis clavier',
    body: h('div', {},
      h('div', { class: 'rows' }, rows),
      h('p', { class: 'muted', style: { marginTop: '12px' } },
        'Les raccourcis sont désactivés pendant la saisie dans un champ de texte.'),
      h('div', { class: 'rows', style: { marginTop: '12px' } },
        h('div', { class: 'variant' }, h('kbd', { class: 'kbd' }, '/'), h('span', {}, 'Aller à la recherche')),
        h('div', { class: 'variant' }, h('kbd', { class: 'kbd' }, '?'), h('span', {}, 'Afficher cette aide')))),
    actions: [h('a', { class: 'btn btn-ghost', href: '/aide', 'data-link': '' }, 'Aide complète')],
  });
}

/**
 * Un raccourci global ne doit jamais voler une frappe (BUG-03).
 * Champs de formulaire, zones éditables et lecteurs de contenu sont tous couverts.
 */
const isEditingField = (target) => {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
  if (target.isContentEditable === true || target.getAttribute?.('contenteditable') === 'true') return true;
  return Boolean(target.closest?.('[contenteditable="true"], [role="textbox"]'));
};

function wireKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      const backdrop = document.querySelector('.modal-backdrop');
      if (backdrop) return; // la modale gère elle-même Échap
      const player = document.getElementById('player-root');
      if (player && player.childElementCount) return; // le lecteur gère Échap
      return;
    }
    if (isEditingField(event.target)) return;
    if (event.key === '/') {
      const input = document.getElementById('search-input');
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      openShortcuts();
    }
  });
}

/* ------------------------------------------------------------------ hors ligne */

function wireNetwork() {
  window.addEventListener('online', async () => {
    state.offline = false;
    renderBanners();
    toast('Connexion rétablie.', { tone: 'success', duration: 3000 });
    try {
      const config = await loadConfig();
      applyBrand(config);
      syncHeader(config);
      renderBanners();
      if (state.route) renderRoute(state.route);
    } catch { /* nouvel essai à la prochaine navigation */ }
  });
  window.addEventListener('offline', () => {
    state.offline = true;
    renderBanners();
    toast(COPY.states.offline.title, { tone: 'error', duration: 8000 });
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.config) return;
    const age = Date.now() - state.configAt;
    if (age < 60_000 || !navigator.onLine) return;
    try {
      const config = await loadConfig();
      applyBrand(config);
      renderBanners();
    } catch { /* on garde la configuration en mémoire */ }
  });
}

function wireAuthEvents() {
  window.addEventListener('auth:expired', () => {
    if (state.route?.name === 'admin') {
      toast(COPY.login.expired, { tone: 'error', duration: 6000 });
      router.navigate(loginHref(), { replace: true });
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error instanceof ApiError) {
      handleApiFailure(error);
      event.preventDefault();
      return;
    }
    toast('Une action n’a pas abouti. Réessayez.', { tone: 'error' });
  });
}

/* ------------------------------------------------------------------ démarrage */

/**
 * Lit la porte de la console : si ce navigateur a déjà ouvert le chemin privé, le serveur
 * le lui rend et le routeur reconnaît la page. Un visiteur quelconque n'obtient rien.
 */
async function readGate() {
  try {
    const gate = await api('/api/admin/gate', { timeout: 6000 });
    state.gate = { admin: Boolean(gate.admin), deviceLock: Boolean(gate.deviceLock) };
    if (gate.admin && gate.path) rememberConsole(gate.path);
  } catch {
    state.gate = state.gate || { admin: false, deviceLock: false };
  }
  return state.gate;
}

async function boot() {
  const main = $main();
  if (main) {
    main.replaceChildren(spinner('Chargement du catalogue…'));
  }
  try {
    const [config] = await Promise.all([loadConfig(), readGate()]);
    applyBrand(config);
    syncHeader(config);
    state.booted = true;
  } catch (error) {
    const container = h('div', {});
    if (main) main.replaceChildren(container);
    renderFailure(container, { navigate: (to) => router.navigate(to) }, error, { onRetry: () => boot() });
    if (navigator.onLine === false) {
      state.offline = true;
      renderBanners();
    }
    return false;
  }
  renderBanners();
  return true;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Un onglet déjà piloté par un worker : si une nouvelle version prend la main, on recharge
  // une seule fois, tout de suite. C'est ce qui évite qu'une coquille ancienne serve un site
  // nouveau, situation où l'écran restait sur « Recherche en cours ».
  const dejaPilote = Boolean(navigator.serviceWorker.controller);
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!dejaPilote || recharge) return;
    recharge = true;
    window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(withBase('sw.js'), { scope: BASE });
    // Une version en attente n'attend pas la fermeture des onglets.
    registration.waiting?.postMessage({ type: 'skip-waiting' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') registration.waiting?.postMessage({ type: 'skip-waiting' });
      });
    });
    // Vérification de mise à jour à chaque retour sur l'onglet, sans réseau superflu.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch {
    // Le site fonctionne sans service worker : aucune action utilisateur requise.
  }
}

let paintInstall = () => {};

const router = createRouter({
  render: renderRoute,
  announce: (route) => {
    const live = document.getElementById('route-announcer');
    if (live) live.textContent = `${routeTitleFor(route)} · page chargée`;
    paintInstall();
  },
});

/**
 * Sortie de secours : quand la page n'a rien reçu au bout du plafond, elle cesse d'attendre
 * et propose deux gestes utiles. Aucun écran de chargement ne reste définitif.
 */
function ecranDeSecours() {
  const main = $main();
  if (!main) return;
  const bouton = (libelle, action, principale = false) => h('button', {
    class: principale ? 'btn btn-primary' : 'btn btn-ghost', type: 'button', onClick: action,
  }, libelle);
  main.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon('alert', 24)),
    h('h3', {}, 'Le catalogue n’est pas arrivé'),
    h('p', {
      text: `La page a attendu ${Math.round(PLAFOND_AMORCAGE / 1000)} secondes sans recevoir les données. `
        + 'Le plus souvent, le navigateur garde une copie ancienne du site : le second bouton la retire.',
    }),
    h('div', { class: 'empty-actions' },
      bouton('Réessayer', () => window.location.reload(), true),
      bouton('Forcer la mise à jour', () => { forcerMiseAJour(); })))));
}

/** Retire les service workers et leurs caches, puis recharge : le site repart du réseau. */
async function forcerMiseAJour() {
  try {
    const enregistrements = await navigator.serviceWorker.getRegistrations();
    await Promise.all(enregistrements.map((enregistrement) => enregistrement.unregister().catch(() => false)));
  } catch { /* navigateur sans service worker */ }
  try {
    const noms = await caches.keys();
    await Promise.all(noms.map((nom) => caches.delete(nom).catch(() => false)));
  } catch { /* stockage de caches indisponible */ }
  window.location.reload();
}

async function main() {
  wireHeader();
  wireKeyboard();
  wireNetwork();
  wireAuthEvents();
  // L'amorçage est borné : au-delà du plafond, on montre une issue au lieu d'attendre.
  const issue = await avecPlafond(boot(), { ms: PLAFOND_AMORCAGE });
  if (issue === 'depasse') {
    document.documentElement.classList.remove('is-booting');
    document.documentElement.classList.add('is-ready');
    ecranDeSecours();
    return;
  }
  if (issue) router.start();
  document.getElementById('boot-screen')?.remove();
  document.documentElement.classList.remove('is-booting');
  document.documentElement.classList.add('is-ready');
  applyTvMode();
  wireTvKeys();
  paintInstall = wireInstall();
  registerServiceWorker();

  window.__streamtv = {
    version: state.config?.version || '',
    get config() { return state.config; },
    navigate: (to) => router.navigate(to),
    refresh: () => router.refresh(),
    player: () => getPlayer(),
    state,
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
