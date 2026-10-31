// public/js/views/login.js · écran 6 : connexion administration, un seul mot de passe.
// Messages d'erreur inline, jamais de fenêtre native ; 429 affiche le délai exact.

import { Admin, auth, api, ApiError, deviceId } from '../api.js?v=3.19.0';
import { COPY } from '../copy.js?v=3.19.0';
import { consoleHref, rememberConsole } from '../console.js?v=3.19.0';
import { h, icon, toast } from '../ui.js?v=3.19.0';

export function renderLogin(container, ctx) {
  const { navigate } = ctx;
  const params = new URLSearchParams(location.search);
  const next = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : consoleHref();

  const view = h('div', { class: 'view' });
  const form = h('form', { class: 'login-shell', novalidate: true, autocomplete: 'on' });
  const errorBox = h('div', { class: 'banner', dataset: { tone: 'danger' }, hidden: true, role: 'alert' });
  const errorText = h('p', {});
  errorBox.append(icon('alert', 16), errorText);

  // 3.9.0 : un membre d'équipe se connecte avec son e-mail ; le propriétaire peut le laisser vide.
  const email = h('input', {
    type: 'email', id: 'admin-email', name: 'email', autocomplete: 'username', maxlength: '120',
    'aria-describedby': 'email-help', placeholder: 'vous@exemple.com', value: params.get('email') || '',
  });

  const input = h('input', {
    type: 'password', id: 'admin-password', name: 'password', required: true,
    autocomplete: 'current-password', minlength: '1', maxlength: '200',
    'aria-describedby': 'password-help',
    placeholder: '••••••••',
  });

  const toggle = h('button', {
    class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Afficher le mot de passe',
    onClick: () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      toggle.textContent = visible ? 'Afficher' : 'Masquer';
    },
  }, 'Afficher');

  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('lock', 16), COPY.actions.signIn);

  form.append(
    h('div', { class: 'login-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('shield', 24)),
      h('h1', {}, COPY.login.title),
      h('p', { class: 'muted' }, COPY.login.subtitle)),
    errorBox,
    h('div', { class: 'field' },
      h('label', { for: 'admin-email' }, 'Adresse e-mail'),
      email,
      h('p', { class: 'help', id: 'email-help' }, 'Laissez vide pour le compte propriétaire.')),
    h('div', { class: 'field' },
      h('label', { for: 'admin-password' }, COPY.login.password),
      h('div', { class: 'input-with-action' }, input, toggle),
      h('p', { class: 'help', id: 'password-help' }, COPY.login.hint)),
    submit,
    h('div', { class: 'login-foot' },
      h('a', { class: 'btn btn-quiet btn-sm', href: '/', 'data-link': '' }, icon('chevron', 14, 'style="transform:rotate(180deg)"'), COPY.actions.backHome),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/aide', 'data-link': '' }, 'Aide')));

  const showError = (message) => {
    errorText.textContent = message;
    errorBox.hidden = false;
  };

  const finish = (session) => {
    auth.set(session.token);
    if (session.entry) rememberConsole(session.entry);
    toast(session.role && session.role !== 'proprietaire'
      ? `Connexion réussie : ${session.roleLabel}.`
      : 'Connexion réussie.', { tone: 'success', duration: 3000 });
    if (session.defaultPassword) {
      toast('Mot de passe par défaut actif : changez-le dans l’onglet Sauvegardes.', { tone: 'info', duration: 8000 });
    }
    navigate(session.entry && (next === '/connexion' || !next) ? session.entry : next, { replace: true });
  };

  /**
   * Étape 2 : le mot de passe est juste, la session reste fermée tant que le code
   * envoyé par e-mail n'est pas saisi. Le champ est prévu pour le clavier numérique.
   */
  const showCodeStep = (challenge) => {
    const code = h('input', {
      type: 'text', id: 'admin-code', name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}',
      autocomplete: 'one-time-code', maxlength: '6', required: true, 'aria-describedby': 'code-help',
      placeholder: '000000', style: { letterSpacing: '0.35em', fontSize: '20px' },
    });
    const valider = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('check', 16), 'Valider le code');
    const renvoyer = h('button', { class: 'btn btn-quiet btn-block', type: 'button', disabled: true }, 'Renvoyer un code');
    const compte = h('p', { class: 'help', id: 'code-help' },
      `Code envoyé à ${challenge.email || 'votre adresse'}. Il reste valable dix minutes.`);
    let horloge = null;
    const armer = (depart) => {
      let secondes = Math.max(0, Number(depart) || 0);
      clearInterval(horloge);
      const afficher = () => {
        if (secondes <= 0) {
          renvoyer.disabled = false;
          renvoyer.textContent = 'Renvoyer un code';
          clearInterval(horloge);
          return;
        }
        renvoyer.disabled = true;
        renvoyer.textContent = `Renvoyer un code (${secondes} s)`;
        secondes -= 1;
      };
      afficher();
      horloge = setInterval(afficher, 1000);
    };
    armer(challenge.resendAfter);

    const formCode = h('form', { class: 'login-shell', novalidate: true, autocomplete: 'off' },
      h('div', { class: 'login-head' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('shield', 24)),
        h('h1', {}, 'Code de vérification'),
        h('p', { class: 'muted' }, 'Le mot de passe ne suffit pas : saisissez le code à six chiffres reçu par e-mail.')),
      errorBox,
      h('div', { class: 'field' },
        h('label', { for: 'admin-code' }, 'Code à six chiffres'),
        code,
        compte),
      valider,
      renvoyer,
      h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button',
        onClick: () => { clearInterval(horloge); renderLogin(container, ctx); },
      }, 'Revenir au mot de passe'));

    formCode.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const valeur = code.value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(valeur)) {
        showError('Le code comporte six chiffres.');
        code.focus();
        return;
      }
      valider.disabled = true;
      valider.replaceChildren(icon('retry', 16), 'Vérification…');
      try {
        finish(await Admin.loginCode(challenge.challengeId, valeur));
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          const minutes = Math.max(1, Math.ceil((Number(error.retryAfter || 900) / 60)));
          showError(COPY.login.locked(minutes));
        } else {
          showError(error.message || 'Code refusé.');
        }
        code.select();
      } finally {
        valider.disabled = false;
        valider.replaceChildren(icon('check', 16), 'Valider le code');
      }
    });

    renvoyer.addEventListener('click', async () => {
      renvoyer.disabled = true;
      try {
        const relance = await Admin.resendCode(challenge.challengeId);
        errorBox.hidden = true;
        compte.textContent = `Nouveau code envoyé à ${relance.email || challenge.email || 'votre adresse'}.`;
        toast(relance.message || 'Nouveau code envoyé.', { tone: 'success' });
        armer(relance.resendAfter);
        code.value = '';
        code.focus();
      } catch (error) {
        showError(error.message || 'Renvoi impossible.');
        armer(Number(error.retryAfter) || 60);
      }
    });

    container.replaceChildren(h('div', { class: 'view' }, formCode));
    formCode.querySelector('#admin-code')?.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const password = input.value;
    if (!password) {
      showError(COPY.login.missing);
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.replaceChildren(icon('retry', 16), 'Connexion…');
    try {
      const session = await api('/api/login', { method: 'POST', body: { password, email: email.value.trim(), deviceId: deviceId() } });
      if (session.requiresCode) {
        showCodeStep(session);
        return;
      }
      finish(session);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const minutes = Math.max(1, Math.ceil((Number(error.retryAfter || error.headers?.['retry-after'] || 900) / 60)));
        showError(COPY.login.locked(minutes));
      } else if (error.status === 401) {
        showError(COPY.login.badPassword);
        input.select();
      } else {
        showError(error.message || COPY.login.badPassword);
      }
      input.focus();
    } finally {
      submit.disabled = false;
      submit.replaceChildren(icon('lock', 16), COPY.actions.signIn);
    }
  });

  view.append(form);
  container.replaceChildren(view);
  queueMicrotask(() => (email.value ? input : email).focus({ preventScroll: true }));
  return () => {};
}
