// public/js/views/error.js · page introuvable, panne de chargement, hors ligne.
// Règle d'or : jamais de message d'erreur sans action concrète.

import { COPY } from '../copy.js?v=3.18.1';
import { h, icon, emptyState } from '../ui.js?v=3.18.1';

export function renderNotFound(container, ctx) {
  const { navigate } = ctx;
  const view = h('div', { class: 'view page-error' },
    h('div', { class: 'error-shell' },
      h('p', { class: 'error-code' }, '404'),
      h('h1', { text: COPY.states.notFound.title }),
      h('p', { class: 'muted', text: COPY.states.notFound.message }),
      h('div', { class: 'error-actions' },
        h('a', { class: 'btn btn-primary', href: '/', 'data-link': '' }, icon('tv', 16), COPY.actions.backHome),
        h('a', { class: 'btn btn-ghost', href: '/guide', 'data-link': '' }, icon('list', 16), COPY.actions.openGuide))));
  container.replaceChildren(view);
  return () => {};
}

export function renderFailure(container, ctx, error, { onRetry = null } = {}) {
  const { navigate } = ctx;
  const retry = onRetry || (() => location.reload());
  const view = h('div', { class: 'view page-error' },
    h('div', { class: 'error-shell' },
      h('div', { class: 'empty-icon' }, icon('wifiOff', 26)),
      h('h1', { text: COPY.states.error.title }),
      h('p', { class: 'muted', text: error?.message || COPY.states.error.message }),
      error?.requestId ? h('p', { class: 'count-label' }, `Code de suivi : ${error.requestId}`) : null,
      h('div', { class: 'error-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: retry }, icon('retry', 16), COPY.actions.retry),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => navigate('/') }, COPY.actions.backHome),
        h('a', { class: 'btn btn-quiet', href: '/aide', 'data-link': '' }, 'Voir l’aide'))));
  container.replaceChildren(view);
  return () => {};
}

export function renderOffline(container, ctx) {
  const view = h('div', { class: 'view page-error' },
    h('div', { class: 'error-shell' },
      emptyState({
        iconName: 'wifiOff',
        title: COPY.states.offline.title,
        message: COPY.states.offline.message,
        actionLabel: COPY.states.offline.action,
        onAction: () => {
          if (navigator.onLine) ctx.navigate(location.pathname + location.search, { replace: true });
          else window.location.reload();
        },
      })));
  container.replaceChildren(view);
  return () => {};
}

export function renderMaintenance(container, ctx) {
  const view = h('div', { class: 'view page-error' },
    h('div', { class: 'error-shell' },
      h('div', { class: 'empty-icon' }, icon('settings', 26)),
      h('h1', {}, 'Maintenance en cours'),
      h('p', { class: 'muted' }, COPY.banners.maintenance),
      h('div', { class: 'error-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => ctx.navigate('/') }, icon('retry', 16), COPY.actions.retry),
        h('a', { class: 'btn btn-ghost', href: consoleHref(), 'data-link': '' }, COPY.actions.admin))));
  container.replaceChildren(view);
  return () => {};
}
