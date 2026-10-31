// public/js/views/access.js · ouverture de la console par un lien (3.13.0).
// Le lien reçu par message porte un jeton : il est échangé une fois contre une session,
// puis l'adresse est nettoyée pour que le jeton ne reste pas dans l'historique du navigateur.

import { auth, ApiError, redeemAccess } from '../api.js?v=3.18.1';
import { consolePath, rememberConsole } from '../console.js?v=3.18.1';
import { h, icon, spinner } from '../ui.js?v=3.18.1';

export async function renderAccess(container, ctx, token) {
  const view = h('div', { class: 'view' });
  const shell = h('div', { class: 'login-shell' },
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('link', 24)),
    h('h1', {}, 'Ouverture de la console'),
    h('p', { class: 'muted' }, 'Vérification du lien…'));
  view.append(shell);
  container.replaceChildren(view);

  if (!token) {
    shell.replaceChildren(
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('alert', 24)),
      h('h1', {}, 'Lien incomplet'),
      h('p', { class: 'muted' }, 'L’adresse ne contient pas de jeton. Demandez un nouveau lien.'),
      h('a', { class: 'btn btn-primary btn-block', href: '/', 'data-link': '' }, 'Revenir au catalogue'));
    return () => {};
  }

  try {
    const session = await redeemAccess(token);
    auth.set(session.token);
    rememberConsole(session.entry || consolePath());
    // Le jeton disparaît de la barre d'adresse : un lien d'accès ne survit pas à son usage.
    const destination = session.entry || '/';
    ctx.navigate(destination, { replace: true });
    shell.replaceChildren(spinner('Ouverture de la console…'));
  } catch (error) {
    const message = error instanceof ApiError
      ? error.message
      : 'Le lien n’a pas pu être vérifié. Vérifiez votre connexion.';
    shell.replaceChildren(
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('lock', 24)),
      h('h1', {}, 'Lien non valable'),
      h('p', { class: 'muted', text: message }),
      h('p', { class: 'muted' }, 'Demandez un nouveau lien d’accès au propriétaire de la console.'),
      h('a', { class: 'btn btn-primary btn-block', href: '/connexion', 'data-link': '' }, 'Se connecter avec un mot de passe'),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/', 'data-link': '' }, 'Revenir au catalogue'));
  }
  return () => {};
}
