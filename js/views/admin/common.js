// public/js/views/admin/common.js · briques partagées des cinq onglets.
// Chaque élément produit ici est vérifié par tests/client.test.js (styles présents, ARIA).

import { COPY } from '../../copy.js?v=3.20.0';
import { loginHref } from '../../console.js?v=3.20.0';
import { h, icon, modal, toast } from '../../ui.js?v=3.20.0';
import { ApiError, auth } from '../../api.js?v=3.20.0';

function field(label, control, help = '') {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    help ? h('p', { class: 'help', text: help }) : null);
}

function confirmModal({ title, message, confirmLabel = 'Confirmer', danger = true, onConfirm, requireWord = '' }) {
  let input = null;
  const body = h('div', { class: 'prose' },
    h('p', { text: message }),
    requireWord ? h('div', { class: 'field' },
      h('label', { for: 'confirm-word' }, `Tapez « ${requireWord} » pour confirmer`),
      (input = h('input', { id: 'confirm-word', type: 'text', autocomplete: 'off' }))) : null);
  return modal({
    title,
    body,
    actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => document.querySelector('.modal-backdrop')?.remove() }, COPY.actions.cancel),
      h('button', {
        class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button',
        onClick: async (event) => {
          if (requireWord && input?.value.trim() !== requireWord) {
            toast(`Tapez « ${requireWord} » pour confirmer.`, { tone: 'error' });
            input?.focus();
            return;
          }
          event.currentTarget.disabled = true;
          await onConfirm(event.currentTarget);
        },
      }, confirmLabel),
    ],
  });
}

function apiGuard(ctx, error, { silent = false } = {}) {
  if (error instanceof ApiError && error.status === 401) {
    auth.clear();
    toast('Votre session a expiré. Reconnectez-vous.', { tone: 'error' });
    ctx.navigate(loginHref(), { replace: true });
    return true;
  }
  if (!silent) toast(error.message || 'L’action n’a pas abouti.', { tone: 'error', duration: 7000 });
  return false;
}

export { field, confirmModal, apiGuard };
