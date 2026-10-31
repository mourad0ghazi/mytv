// public/js/views/compte.js · espace visiteur : inscription, confirmation, connexion, profil (3.19.0).
// Un compte visiteur n'ouvre aucun droit d'administration. Le code de confirmation part par
// e-mail ; l'écran ne l'affiche jamais et ne le garde pas en mémoire au-delà de la saisie.

import { COPY } from '../copy.js?v=3.22.0';
import { h, icon, toast, emptyState } from '../ui.js?v=3.22.0';
import { statCard } from '../components.js?v=3.22.0';
import {
  Compte, compteSession, ouvrirSession, synchroniserCompte,
} from '../compte.js?v=3.22.0';

function banner() {
  const box = h('div', { class: 'banner', dataset: { tone: 'danger' }, hidden: true, role: 'alert' });
  const text = h('p', {});
  box.append(icon('alert', 16), text);
  return {
    box,
    show(message) { text.textContent = message; box.hidden = false; },
    hide() { box.hidden = true; },
  };
}

function champ(id, label, input, help = '') {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    help ? h('p', { class: 'help' }, help) : null);
}

/** Repère lisible : longueur, lettre, chiffre. Aucune promesse de sécurité au-delà. */
export function completudeMotDePasse(value) {
  const texte = String(value || '');
  const manques = [];
  if (texte.length < 12) manques.push('12 caractères');
  if (!/[a-zA-Z]/.test(texte)) manques.push('une lettre');
  if (!/[0-9]/.test(texte)) manques.push('un chiffre');
  if (!texte) return { phrase: '12 caractères minimum, avec lettres et chiffres.', niveau: '' };
  if (manques.length) return { phrase: `Il manque : ${manques.join(', ')}.`, niveau: 'warn' };
  return { phrase: 'Longueur et variété suffisantes.', niveau: 'ok' };
}

function champMotDePasse(id, label, { help = '12 caractères minimum, avec lettres et chiffres.', value = '' } = {}) {
  const input = h('input', {
    type: 'password', id, name: id, autocomplete: 'new-password',
    minlength: '12', maxlength: '200', required: true, value,
  });
  const jauge = h('p', { class: 'help', 'aria-live': 'polite' });
  const maj = () => {
    const etat = completudeMotDePasse(input.value);
    jauge.textContent = etat.phrase;
    jauge.dataset.tone = etat.niveau;
  };
  input.addEventListener('input', maj);
  maj();
  return { input, node: champ(id, label, input, help) };
}

function lien(href, texte, icone = '') {
  return h('a', { class: 'btn btn-quiet btn-sm', href, 'data-link': '' }, icone ? icon(icone, 14) : null, texte);
}

/* ------------------------------------------------------------------ inscription */

function vueInscription(container, ctx) {
  const view = h('div', { class: 'view' });
  const form = h('form', { class: 'login-shell', novalidate: true });
  const alerte = banner();
  const nom = h('input', { type: 'text', id: 'compte-nom', name: 'name', maxlength: '60', required: true, autocomplete: 'name', placeholder: 'Prénom et nom' });
  const courriel = h('input', { type: 'email', id: 'compte-email', name: 'email', maxlength: '120', required: true, autocomplete: 'email', placeholder: 'vous@exemple.com' });
  const { input: motDePasse, node: champSecret } = champMotDePasse('compte-mot-de-passe', 'Mot de passe');
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('plus', 16), 'Créer mon compte');

  form.append(
    h('div', { class: 'login-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('mail', 24)),
      h('h1', {}, 'Créer un compte'),
      h('p', { class: 'muted' }, 'Vos favoris, votre historique et vos reprises vous suivront d’un appareil à l’autre.')),
    alerte.box,
    champ('compte-nom', 'Nom affiché', nom),
    champ('compte-email', 'Adresse e-mail', courriel, 'Un code à six chiffres y sera envoyé pour confirmer le compte.'),
    champSecret,
    submit,
    h('div', { class: 'login-foot' },
      h('a', { class: 'btn btn-quiet btn-sm', href: '/compte/connexion', 'data-link': '' }, 'J’ai déjà un compte'),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/compte', 'data-link': '' }, 'Mon espace')));

  const alerteDeux = banner();
  const code = h('input', { type: 'text', id: 'compte-code', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'one-time-code', placeholder: '123456' });
  const valider = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('check', 16), 'Confirmer mon adresse');
  const renvoyer = h('button', {
    class: 'btn btn-quiet btn-sm', type: 'button',
    onClick: async () => {
      try {
        const result = await Compte.renvoyerCode(courriel.value.trim());
        toast(result.message, { tone: 'info', duration: 5000 });
      } catch (error) {
        alerteDeux.show(error.message);
      }
    },
  }, 'Renvoyer le code');
  const stepTwo = h('form', { class: 'login-shell', hidden: true, novalidate: true },
    h('div', { class: 'login-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('mail', 24)),
      h('h1', {}, 'Vérifiez votre boîte'),
      h('p', { class: 'muted' }, 'Saisissez le code reçu pour activer le compte.')),
    alerteDeux.box,
    champ('compte-code', 'Code à six chiffres', code, 'Il expire au bout de quinze minutes.'),
    valider,
    h('div', { class: 'login-foot' }, renvoyer, lien('/compte/connexion', 'Se connecter')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alerte.hide();
    submit.disabled = true;
    try {
      const result = await Compte.inscription({
        name: nom.value.trim(),
        email: courriel.value.trim(),
        password: motDePasse.value,
      });
      toast(result.message, { tone: 'success', duration: 6000 });
      form.hidden = true;
      stepTwo.hidden = false;
      code.focus();
    } catch (error) {
      alerte.show(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  stepTwo.addEventListener('submit', async (event) => {
    event.preventDefault();
    alerteDeux.hide();
    valider.disabled = true;
    try {
      const result = await Compte.verifier(courriel.value.trim(), code.value.trim());
      ouvrirSession(result);
      await synchroniserCompte().catch(() => null);
      toast(result.message, { tone: 'success', duration: 5000 });
      ctx.navigate('/compte', { replace: true });
    } catch (error) {
      alerteDeux.show(error.message);
      valider.disabled = false;
    }
  });

  view.append(form, stepTwo);
  container.replaceChildren(view);
  return () => {};
}

/* -------------------------------------------------------------------- connexion */

function vueConnexion(container, ctx) {
  const view = h('div', { class: 'view' });
  const form = h('form', { class: 'login-shell', novalidate: true });
  const alerte = banner();
  const courriel = h('input', { type: 'email', id: 'compte-email', name: 'email', maxlength: '120', required: true, autocomplete: 'username', placeholder: 'vous@exemple.com' });
  const motDePasse = h('input', { type: 'password', id: 'compte-mot-de-passe', name: 'password', required: true, autocomplete: 'current-password', maxlength: '200', placeholder: '••••••••' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('lock', 16), COPY.actions.signIn);

  const alerteOubli = banner();
  const code = h('input', { type: 'text', id: 'oubli-code', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'one-time-code', placeholder: '123456' });
  const { input: nouveau, node: champNouveau } = champMotDePasse('oubli-nouveau', 'Nouveau mot de passe');
  const validerOubli = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Choisir ce mot de passe');
  const formOubli = h('form', { class: 'login-shell', novalidate: true, hidden: true },
    h('div', { class: 'login-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('mail', 24)),
      h('h1', {}, 'Mot de passe oublié'),
      h('p', { class: 'muted' }, 'Un code à six chiffres part vers votre adresse.')),
    alerteOubli.box,
    champ('oubli-code', 'Code de réinitialisation', code),
    champNouveau,
    validerOubli);

  const boutonOubli = h('button', {
    class: 'btn btn-quiet btn-sm', type: 'button',
    onClick: async () => {
      alerte.hide();
      try {
        const result = await Compte.codeOublie(courriel.value.trim());
        toast(result.message, { tone: 'info', duration: 6000 });
        formOubli.hidden = false;
        code.focus();
      } catch (error) {
        alerte.show(error.message);
      }
    },
  }, 'Mot de passe oublié');

  form.append(
    h('div', { class: 'login-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('lock', 24)),
      h('h1', {}, 'Se connecter'),
      h('p', { class: 'muted' }, 'Retrouvez vos favoris, votre historique et vos reprises.')),
    alerte.box,
    champ('compte-email', 'Adresse e-mail', courriel),
    champ('compte-mot-de-passe', 'Mot de passe', motDePasse),
    submit,
    h('div', { class: 'login-foot' },
      boutonOubli,
      h('a', { class: 'btn btn-quiet btn-sm', href: '/compte/inscription', 'data-link': '' }, 'Créer un compte')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alerte.hide();
    submit.disabled = true;
    try {
      const result = await Compte.connexion(courriel.value.trim(), motDePasse.value);
      ouvrirSession(result);
      await synchroniserCompte().catch(() => null);
      toast(result.message, { tone: 'success', duration: 4000 });
      ctx.navigate('/compte', { replace: true });
    } catch (error) {
      alerte.show(error.message);
      submit.disabled = false;
      // Compte encore en attente : le code se saisit sur la page d'inscription.
      if (error.status === 403 && /Confirmez/.test(error.message)) {
        ctx.navigate('/compte/inscription', { replace: true });
      }
    }
  });

  formOubli.addEventListener('submit', async (event) => {
    event.preventDefault();
    alerteOubli.hide();
    validerOubli.disabled = true;
    try {
      const result = await Compte.reinitialiser({
        email: courriel.value.trim(),
        code: code.value.trim(),
        password: nouveau.value,
      });
      ouvrirSession(result);
      await synchroniserCompte().catch(() => null);
      toast(result.message, { tone: 'success', duration: 5000 });
      ctx.navigate('/compte', { replace: true });
    } catch (error) {
      alerteOubli.show(error.message);
      validerOubli.disabled = false;
    }
  });

  view.append(form, formOubli);
  container.replaceChildren(view);
  return () => {};
}

/* ---------------------------------------------------------------------- espace */

async function vueEspace(container, ctx) {
  const view = h('div', { class: 'view' });
  container.replaceChildren(view);
  if (!compteSession.isSignedIn()) {
    view.append(emptyState({
      iconName: 'lock',
      title: 'Votre espace vous attend',
      message: 'Créez un compte pour retrouver vos favoris, votre historique et vos reprises sur tous vos appareils.',
      actionLabel: 'Créer un compte',
      onAction: () => ctx.navigate('/compte/inscription'),
    }), h('p', { class: 'muted', style: { textAlign: 'center' } },
      lien('/compte/connexion', 'J’ai déjà un compte')));
    return () => {};
  }

  let profil = null;
  try {
    profil = await Compte.profil();
  } catch (error) {
    view.append(emptyState({
      iconName: 'wifiOff',
      title: 'Le compte n’a pas répondu',
      message: error.message || 'Réessayez dans un instant.',
      actionLabel: COPY.actions.retry,
      onAction: () => vueEspace(container, ctx),
    }));
    return () => {};
  }

  const compte = profil.compte;
  const alerte = banner();
  const statut = h('span', { class: 'badge', dataset: { tone: compte.status === 'actif' ? 'ok' : 'warn' } }, compte.statusLabel);
  const compteurs = h('div', { class: 'stat-grid' });
  const renderCompteurs = () => {
    compteurs.replaceChildren(
      statCard('Favoris', String(compte.favoritesCount), 'chaînes, anime et films'),
      statCard('Reprises', String(compte.historyCount), 'positions enregistrées'),
      statCard('Signalements suivis', String(compte.reportsCount), 'envoyés en étant connecté'));
  };

  // Préférences d'affichage : trois réglages qui changent réellement l'écran.
  const skin = h('select', { id: 'compte-skin' },
    ...[['cadre', 'Cadre'], ['plein', 'Plein écran'], ['minimal', 'Minimal']]
      .map(([valeur, label]) => h('option', { value: valeur, selected: compte.preferences.skin === valeur }, label)));
  const tvMode = h('select', { id: 'compte-tv' },
    ...[['auto', 'Automatique'], ['on', 'Toujours'], ['off', 'Jamais']]
      .map(([valeur, label]) => h('option', { value: valeur, selected: compte.preferences.tvMode === valeur }, label)));
  const sourdine = h('input', { type: 'checkbox', id: 'compte-sourdine', checked: compte.preferences.sourdine });
  const enregistrer = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), 'Enregistrer mes préférences');
  const formPrefs = h('form', { class: 'console-toolbar', novalidate: true },
    champ('compte-skin', 'Habillage du lecteur', skin),
    champ('compte-tv', 'Mode télévision', tvMode),
    h('div', { class: 'field' },
      h('label', { for: 'compte-sourdine' }, 'Démarrer en sourdine'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, sourdine, h('span', { class: 'help' }, 'Son coupé par défaut'))),
    h('div', { class: 'field', style: { alignSelf: 'end' } }, enregistrer));

  formPrefs.addEventListener('submit', async (event) => {
    event.preventDefault();
    alerte.hide();
    enregistrer.disabled = true;
    try {
      const result = await Compte.preferences({
        skin: skin.value,
        tvMode: tvMode.value,
        sourdine: sourdine.checked,
      });
      compte.preferences = result.preferences;
      toast(result.message, { tone: 'success', duration: 4000 });
    } catch (error) {
      alerte.show(error.message);
    } finally {
      enregistrer.disabled = false;
    }
  });

  const nomInput = h('input', { type: 'text', id: 'compte-nom', maxlength: '60', value: compte.name });
  const renommer = h('button', { class: 'btn btn-quiet', type: 'submit' }, 'Mettre à jour');
  const formNom = h('form', { novalidate: true },
    champ('compte-nom', 'Nom affiché', nomInput),
    h('div', { class: 'field' }, renommer));
  formNom.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await Compte.renommer(nomInput.value.trim());
      compte.name = result.compte.name;
      toast(result.message, { tone: 'success', duration: 4000 });
    } catch (error) {
      alerte.show(error.message);
    }
  });

  const actuel = h('input', { type: 'password', id: 'compte-actuel', autocomplete: 'current-password', maxlength: '200', required: true });
  const { input: nouveau } = champMotDePasse('compte-nouveau', 'Nouveau mot de passe');
  const changer = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('lock', 15), 'Changer le mot de passe');
  const formSecret = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'compte-actuel' }, 'Mot de passe actuel'), actuel),
    champ('compte-nouveau', 'Nouveau mot de passe', nouveau),
    h('div', { class: 'field' }, changer));
  formSecret.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await Compte.motDePasse(actuel.value, nouveau.value);
      if (result.token) compteSession.set(result.token, compte.name);
      toast(result.message, { tone: 'success', duration: 5000 });
      actuel.value = '';
      nouveau.value = '';
    } catch (error) {
      alerte.show(error.message);
    }
  });

  const listeSignalements = h('div', {});
  try {
    const suivi = await Compte.signalements();
    listeSignalements.append(
      h('h2', {}, `Mes signalements (${suivi.signalements.length})`),
      suivi.signalements.length
        ? h('div', {}, ...suivi.signalements.map((item) => h('div', { class: 'row-card' },
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('p', { style: { fontWeight: '600' } }, `${item.ref} · ${item.name || 'Contenu'}`),
            h('p', { class: 'card-sub' }, `${item.type} · ${item.status}`)),
          h('a', { class: 'btn btn-quiet btn-sm', href: `/signaler?ref=${encodeURIComponent(item.ref)}`, 'data-link': '' }, 'Suivre'))))
        : h('p', { class: 'muted' }, 'Aucun signalement rattaché à ce compte. Les signalements envoyés en étant connecté apparaissent ici.'));
  } catch {
    listeSignalements.append(h('p', { class: 'muted' }, 'Les signalements n’ont pas pu être chargés.'));
  }

  const sortie = h('button', {
    class: 'btn btn-quiet', type: 'button',
    onClick: async () => {
      try { await Compte.sortie(); } catch { /* le jeton est retiré quand même */ }
      compteSession.clear();
      toast('Vous êtes déconnecté.', { tone: 'info', duration: 3000 });
      ctx.navigate('/');
    },
  }, icon('close', 15), 'Se déconnecter');

  renderCompteurs();
  view.append(
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Mon compte'),
        h('h1', {}, compte.name)),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' } }, statut, sortie)),
    alerte.box,
    h('p', { class: 'muted' }, `${compte.email} · membre depuis le ${new Date(compte.createdAt).toLocaleDateString('fr-FR')}`),
    compteurs,
    h('div', { class: 'card' }, h('h2', {}, 'Préférences d’affichage'), formPrefs),
    h('div', { class: 'card' }, h('h2', {}, 'Profil'), formNom),
    h('div', { class: 'card' }, h('h2', {}, 'Mot de passe'),
      h('p', { class: 'help' }, 'Le changement ferme les autres appareils connectés à ce compte.'), formSecret),
    h('div', { class: 'card' }, listeSignalements),
    h('p', { class: 'muted' }, 'Un compte visiteur ne donne aucun droit sur la console d’administration.'));
  return () => {};
}

export async function renderCompte(container, ctx, mode = 'compte') {
  if (mode === 'inscription') return vueInscription(container, ctx);
  if (mode === 'connexion') return vueConnexion(container, ctx);
  return vueEspace(container, ctx);
}
