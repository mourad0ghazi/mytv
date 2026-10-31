// public/js/views/guide.js · écran 2 : guide de zapping, liste dense + filtres par catégorie.
// ≤ 60 lignes par page, jamais plus de 120 nœuds de chaîne dans le DOM.

import { api } from '../api.js?v=3.18.0';
import { COPY } from '../copy.js?v=3.18.0';
import {
  h, icon, fmtNumber, skeletonGrid, emptyState, logoNode, healthLabel, toast, debounce,
} from '../ui.js?v=3.18.0';
import { getPlayer } from '../player.js?v=3.18.0';
import { prefs } from '../prefs.js?v=3.18.0';

const ROWS_PER_PAGE = 60;

/** Heure locale courte : « 20:30 ». */
function clock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * F-23 · complète la liste avec le programme en cours, sans bloquer l'affichage.
 * Si le guide est absent, rien ne change : aucune ligne n'est perdue, aucun message d'erreur n'apparaît.
 */
async function paintGuide(host, listHost) {
  let payload = null;
  try {
    payload = await api('/api/epg?hours=8');
  } catch {
    return;
  }
  if (!payload?.enabled || !payload.valid || !Array.isArray(payload.grid)) return;
  for (const row of payload.grid) {
    const node = listHost.querySelector(`[data-epg-channel="${row.id}"]`);
    if (!node || !row.programmes.length) continue;
    const current = row.programmes.find((programme) => programme.live) || row.programmes[0];
    // Ligne « maintenant » : pastille, horaires complets et progression, comme sur les cartes.
    const debut = new Date(current.start).getTime();
    const fin = new Date(current.stop).getTime();
    const pct = Number.isFinite(debut) && Number.isFinite(fin) && fin > debut
      ? Math.max(0, Math.min(100, Math.round(((Date.now() - debut) / (fin - debut)) * 100))) : 0;
    const barre = h('i', { style: { width: `${pct}%` } });
    node.replaceChildren(
      current.live ? h('span', { class: 'live-pill' }, h('i', { 'aria-hidden': 'true' }), 'En direct') : null,
      h('span', { text: `${clock(current.start)} – ${clock(current.stop)} · ${current.title}` }),
      h('span', { class: 'card-bar guide-bar' }, barre));
    node.hidden = false;
    node.title = current.description || `${current.title} (${clock(current.start)} – ${clock(current.stop)})`;
  }
  if (host) host.dataset.epg = 'ready';
}

function guideRow(channel, { onPlay, onOpen, tabIndex = -1, onNavigate }) {
  const row = h('div', { class: 'guide-row', dataset: { channelId: channel.id } },
    h('span', { class: 'guide-num tabular', text: String(channel.number).padStart(3, '0') }),
    h('span', { class: 'guide-logo' }, logoNode(channel, 34)),
    h('span', { class: 'guide-name', dir: 'auto' },
      h('span', { text: channel.name }),
      h('span', { class: 'card-sub' },
        channel.categoryLabel,
        channel.country ? ` · ${channel.country}` : '',
        channel.quality !== 'AUTO' ? ` · ${channel.quality}` : ''),
      h('span', { class: 'guide-now', dataset: { epgChannel: channel.id }, hidden: true })),
    h('span', { class: 'card-sub guide-health', title: healthLabel(channel.health) },
      h('span', { class: 'health-dot', dataset: { state: channel.health }, 'aria-hidden': 'true' }),
      ` ${healthLabel(channel.health)}`),
    h('button', {
      class: 'btn btn-primary btn-sm', type: 'button', tabIndex: -1,
      'aria-label': `Regarder ${channel.name}`,
      onClick: (event) => { event.stopPropagation(); onPlay(channel); },
    }, icon('play', 14), h('span', { class: 'btn-label' }, COPY.actions.watch)),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', tabIndex: -1,
      'aria-label': `Fiche de ${channel.name}`,
      onClick: (event) => { event.stopPropagation(); onOpen(channel.id); },
    }, icon('chevron', 15)));
  row.tabIndex = tabIndex;
  row.setAttribute('aria-label', `${channel.name}, ${channel.categoryLabel || 'catégorie inconnue'}, chaîne ${channel.number}`);
  row.addEventListener('click', () => onPlay(channel));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPlay(channel); return; }
    if (event.key === 'i' || event.key === 'I') { event.preventDefault(); onOpen(channel.id); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      onNavigate?.(event.key === 'Home' ? 0 : event.key === 'End' ? -1 : event.key === 'ArrowDown' ? 1 : -1, event.key);
    }
  });
  return row;
}

/** Un seul arrêt de tabulation pour la liste : les flèches déplacent le focus (roving tabindex). */
function roving(rows) {
  let current = 0;
  const focus = (index) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!target) return;
    rows[current].tabIndex = -1;
    current = rows.indexOf(target);
    target.tabIndex = 0;
    target.focus({ preventScroll: false });
  };
  return (direction, key) => {
    if (key === 'Home') return focus(0);
    if (key === 'End') return focus(rows.length - 1);
    focus(current + direction);
  };
}

export async function renderGuide(container, ctx) {
  const { config, query, navigate } = ctx;
  const state = { page: 1, cat: query.cat || '', q: (query.q || '').trim() };
  const view = h('div', { class: 'view' });

  const player = () => getPlayer();
  const openPlayer = (channel) => {
    const ids = [...container.querySelectorAll('[data-channel-id]')].map((node) => node.dataset.channelId);
    player().open(channel, { queue: ids.length ? ids : [channel.id] });
    prefs.pushHistory(channel);
  };
  const openChannel = (id) => navigate(`/chaine/${id}`);

  // Télécommande numérique : un numéro, une chaîne.
  const jumpInput = h('input', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '5',
    'aria-label': 'Aller à un numéro de chaîne', placeholder: 'N°', class: 'jump-input',
  });
  const jump = async () => {
    const value = jumpInput.value.trim();
    if (!/^\d{1,5}$/.test(value)) {
      toast('Saisissez un numéro de chaîne, par exemple 42.', { tone: 'error' });
      jumpInput.focus();
      return;
    }
    try {
      const payload = await api(`/api/channels/search?q=${encodeURIComponent(value)}&pageSize=60`);
      const match = payload.channels.find((channel) => channel.number === Number(value));
      if (!match) {
        toast(`Aucune chaîne ne porte le numéro ${value}.`, { tone: 'error' });
        return;
      }
      const full = await api(`/api/channels/${match.id}`);
      openPlayer(full.channel);
    } catch (error) {
      toast(error.message, { tone: 'error' });
    }
  };
  jumpInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); jump(); }
  });
  const jumpBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: jump }, 'Aller');

  const sidebar = h('aside', { class: 'guide-side', id: 'guide-filters', 'aria-label': 'Catégories du guide' });
  const filterBtn = h('button', {
    class: 'btn btn-ghost btn-sm guide-filter-btn', type: 'button',
    'aria-expanded': 'false', 'aria-controls': 'guide-filters',
  }, icon('list', 14), 'Filtres');
  filterBtn.addEventListener('click', () => {
    const open = sidebar.dataset.open === 'true';
    sidebar.dataset.open = String(!open);
    filterBtn.setAttribute('aria-expanded', String(!open));
  });
  const listHost = h('div', { class: 'guide-list', id: 'guide-list' });
  const count = h('span', { class: 'count-label', 'aria-live': 'polite' });

  view.append(
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Zapping'),
        h('h1', { style: { fontSize: '30px' } }, 'Le guide')),
      h('div', { class: 'toolbar', style: { margin: 0 } },
        filterBtn,
        h('label', { class: 'visually-hidden', for: 'jump-input' }, 'Aller à un numéro de chaîne'),
        h('div', { class: 'jump', id: 'jump' }, jumpInput, jumpBtn))),
    h('div', { class: 'guide-wrap' }, sidebar, h('div', {}, h('div', { class: 'toolbar' }, count), listHost)));

  container.replaceChildren(view);

  const renderSidebar = () => {
    const total = config.categories.reduce((sum, category) => sum + category.count, 0);
    sidebar.replaceChildren(
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(!state.cat),
        onClick: () => { state.cat = ''; state.page = 1; renderSidebar(); load(); },
      }, 'Tout', h('span', { class: 'chip-count' }, fmtNumber(total))),
      ...config.categories.filter((category) => category.count > 0).map((category) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(state.cat === category.id),
        onClick: () => { state.cat = category.id; state.page = 1; renderSidebar(); load(); },
      }, category.short, h('span', { class: 'chip-count' }, fmtNumber(category.count)))));
  };

  let lastPayload = null;
  const load = async () => {
    listHost.replaceChildren(skeletonGrid(8));
    try {
      const params = new URLSearchParams({ page: String(state.page), pageSize: String(ROWS_PER_PAGE) });
      if (state.cat) params.set('category', state.cat);
      if (state.q) params.set('q', state.q);
      const payload = await api(`/api/channels?${params}`);
      lastPayload = payload;
      count.textContent = payload.total
        ? `${fmtNumber(payload.total)} chaînes · page ${payload.page} sur ${payload.pages}`
        : 'Aucune chaîne';
      if (!payload.channels.length) {
        listHost.replaceChildren(emptyState({
          iconName: 'list',
          title: COPY.states.categoryEmpty.title,
          message: COPY.states.categoryEmpty.message,
          actionLabel: COPY.states.categoryEmpty.action,
          onAction: () => { state.cat = ''; state.q = ''; state.page = 1; renderSidebar(); load(); },
        }));
        return;
      }
      const rowElements = payload.channels.map((channel, index) => guideRow(channel, {
        onPlay: openPlayer, onOpen: openChannel, tabIndex: index === 0 ? 0 : -1,
        onNavigate: (direction, key) => moveFocus(direction, key),
      }));
      const moveFocus = roving(rowElements);
      const rows = h('div', { class: 'rows', role: 'list', 'aria-label': 'Chaînes du guide' }, rowElements);
      const pager = h('div', { class: 'toolbar', style: { justifyContent: 'center', marginTop: '16px' } },
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', disabled: payload.page <= 1,
          onClick: () => { state.page -= 1; load(); },
        }, icon('chevron', 15, 'style="transform:rotate(180deg)"'), 'Précédent'),
        h('span', { class: 'count-label' }, `Page ${payload.page} sur ${payload.pages}`),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', disabled: !payload.hasMore,
          onClick: () => { state.page += 1; load(); },
        }, 'Suivant', icon('chevron', 15)));
      listHost.replaceChildren(
        h('p', { class: 'count-label guide-hint' },
          '↑ ↓ pour parcourir · Entrée pour regarder · I pour la fiche · / pour chercher'),
        rows, pager);
      void paintGuide(view, listHost);
      // §7.2 écran 2 : focus initial dans la liste (sans le voler à un clic de l'utilisateur).
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const neutral = !active || active === document.body || active.id === 'main' || active === document.documentElement;
        if (neutral) rowElements[0]?.focus({ preventScroll: true });
      });
    } catch (error) {
      listHost.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: COPY.states.error.title,
        message: error.message || COPY.states.error.message,
        actionLabel: COPY.actions.retry,
        onAction: load,
      }));
    }
  };

  // Recherche depuis l'en-tête : filtre le guide sans quitter l'écran.
  const onSearch = debounce((event) => {
    state.q = event.detail?.q || '';
    state.page = 1;
    load();
  }, 260);
  window.addEventListener('streamtv:search', onSearch);
  view.addEventListener('streamtv:leave', () => window.removeEventListener('streamtv:search', onSearch));

  renderSidebar();
  await load();
  return () => window.removeEventListener('streamtv:search', onSearch);
}
