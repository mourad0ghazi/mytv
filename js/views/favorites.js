// public/js/views/favorites.js · écran 5 : favoris et historique, strictement locaux (AC-033).
// Aucune requête réseau : ces listes vivent dans le stockage du navigateur.

import { api } from '../api.js?v=3.20.0';
import { COPY } from '../copy.js?v=3.20.0';
import { h, icon, fmtRelative, emptyState, logoNode, toast, modal } from '../ui.js?v=3.20.0';
import { getPlayer } from '../player.js?v=3.20.0';
import { prefs } from '../prefs.js?v=3.20.0';

function row(item, { onPlay, onOpen, onRemove }) {
  return h('div', { class: 'row-card', dataset: { channelId: item.id } },
    h('span', { class: 'guide-logo' }, logoNode(item, 40)),
    h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
      h('p', { dir: 'auto', style: { fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.name),
      h('p', { class: 'card-sub' },
        `N° ${item.number || 'Non renseigné'}`,
        item.categoryLabel ? ` · ${item.categoryLabel}` : '',
        item.at ? ` · ${fmtRelative(item.at)}` : '')),
    h('button', {
      class: 'btn btn-primary btn-sm', type: 'button', 'aria-label': `Regarder ${item.name}`,
      onClick: () => onPlay(item),
    }, icon('play', 14), COPY.actions.watch),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Ouvrir la fiche de ${item.name}`,
      onClick: () => onOpen(item.id),
    }, icon('chevron', 15)),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Retirer ${item.name}`,
      onClick: () => onRemove(item),
    }, icon('trash', 14)));
}

export async function renderFavorites(container, ctx) {
  const { navigate } = ctx;
  let tab = ctx.query.onglet === 'historique' ? 'history' : 'favorites';
  const view = h('div', { class: 'view' });
  const listHost = h('div', {});
  const tabsBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Favoris et historique' });

  const play = async (item) => {
    try {
      const payload = await api(`/api/channels/${encodeURIComponent(item.id)}`);
      prefs.pushHistory(payload.channel);
      getPlayer().open(payload.channel, { queue: [payload.channel.id] });
    } catch (error) {
      toast(error.status === 404 ? 'Cette chaîne n’est plus au catalogue.' : error.message, { tone: 'error' });
    }
  };

  const open = (id) => navigate(`/chaine/${id}`);

  const remove = (item) => {
    if (tab === 'favorites') prefs.removeFavorite(item.id);
    else prefs.removeHistory(item.id);
    render();
    toast(tab === 'favorites' ? 'Retirée de vos favoris.' : 'Entrée retirée de l’historique.', { tone: 'info', duration: 3000 });
  };

  const render = () => {
    const favorites = prefs.favorites();
    const history = prefs.history();
    tabsBar.replaceChildren(
      h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === 'favorites'),
        onClick: () => { tab = 'favorites'; render(); },
      }, `Favoris (${favorites.length})`),
      h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === 'history'),
        onClick: () => { tab = 'history'; render(); },
      }, `Historique (${history.length})`));

    const list = tab === 'favorites' ? favorites : history;
    const clearBtn = list.length ? h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      onClick: () => modal({
        title: tab === 'favorites' ? 'Vider les favoris' : 'Vider l’historique',
        body: h('div', { class: 'prose' },
          h('p', {}, tab === 'favorites'
            ? `Retirer les ${favorites.length} chaînes favorites de cet appareil ?`
            : `Effacer les ${history.length} entrées d’historique de cet appareil ?`),
          h('p', { class: 'muted' }, 'Cette action ne touche ni le catalogue ni les autres appareils.')),
        actions: [
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => document.querySelector('.modal-backdrop')?.remove() }, COPY.actions.cancel),
          h('button', {
            class: 'btn btn-danger', type: 'button',
            onClick: () => {
              if (tab === 'favorites') prefs.clearFavorites();
              else prefs.clearHistory();
              document.querySelector('.modal-backdrop')?.remove();
              render();
              toast('Liste vidée sur cet appareil.', { tone: 'info' });
            },
          }, 'Vider'),
        ],
      }),
    }, icon('trash', 14), 'Vider') : null;

    const header = h('div', { class: 'toolbar' },
      h('span', { class: 'count-label' },
        tab === 'favorites'
          ? 'Enregistrés sur cet appareil uniquement'
          : '80 dernières chaînes ouvertes, sur cet appareil uniquement'),
      h('span', { class: 'spacer' }),
      clearBtn);

    if (!list.length) {
      listHost.replaceChildren(
        h('div', { class: 'panel' }, header),
        emptyState({
          iconName: tab === 'favorites' ? 'star' : 'clock',
          title: tab === 'favorites' ? COPY.states.favoritesEmpty.title : COPY.states.historyEmpty.title,
          message: tab === 'favorites' ? COPY.states.favoritesEmpty.message : COPY.states.historyEmpty.message,
          actionLabel: tab === 'favorites' ? COPY.states.favoritesEmpty.action : COPY.states.historyEmpty.action,
          onAction: () => navigate(tab === 'favorites' ? '/' : '/guide'),
        }));
      return;
    }

    listHost.replaceChildren(
      h('div', { class: 'panel', style: { padding: '8px' } },
        h('div', { class: 'rows' }, list.map((item) => row(item, { onPlay: play, onOpen: open, onRemove: remove })))),
      h('p', { class: 'muted', style: { marginTop: '12px', fontSize: '13px' } },
        'Ces données restent dans votre navigateur. Aucun compte, aucun envoi au serveur, aucune synchronisation entre appareils.'));
  };

  view.append(
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Ma sélection'),
        h('h1', { style: { fontSize: '30px' } }, 'Favoris et historique')),
      h('span', { class: 'badge', dataset: { tone: 'ok' } }, icon('lock', 12), 'Stockage local')),
    tabsBar,
    listHost);
  container.replaceChildren(view);

  const unsubscribe = prefs.onChange(() => render());
  render();
  return () => unsubscribe();
}
