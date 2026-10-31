// public/js/views/admin/premier-lancement.js · premier lancement (3.14.0).
// Tant que le nom du propriétaire manque ou que le mot de passe de démonstration est actif,
// la console ouvre sur ce passage obligé : un nom, un mot de passe à soi, puis l'appareil.
// Chaque étape appelle le vrai serveur ; rien n'est simulé, tout est vérifiable.

import { Admin } from '../../api.js?v=3.18.0';
import { h, icon, toast } from '../../ui.js?v=3.18.0';

/** Marque d'étape : faite, en cours, à faire. Une seule forme, un seul ton. */
function marque(etape) {
  if (etape.fait) return h('span', { class: 'etape-marque', dataset: { etat: 'fait' }, 'aria-label': 'faite' }, icon('check', 13));
  return h('span', { class: 'etape-marque', dataset: { etat: 'attente' }, 'aria-label': 'à faire' });
}

function etapeBloc(etape, contenu) {
  return h('section', { class: 'etape', dataset: { fait: String(etape.fait) } },
    h('div', { class: 'etape-tete' },
      marque(etape),
      h('div', {},
        h('h3', {}, etape.titre),
        h('p', { class: 'muted' }, etape.aide))),
    etape.fait ? null : contenu);
}

export async function renderPremierLancement(container, ctx, precharge = null) {
  let etat = precharge;
  if (!etat) {
    try {
      etat = await Admin.setup();
    } catch {
      return false;
    }
  }
  if (etat.termine) return false;

  const view = h('div', { class: 'view page-setup' });
  const errorBox = h('div', { class: 'banner', dataset: { tone: 'danger' }, hidden: true, role: 'alert' });
  const errorText = h('p', {});
  errorBox.append(icon('alert', 16), errorText);

  const dire = (message) => {
    errorText.textContent = message;
    errorBox.hidden = !message;
  };

  /* ---------------------------------------------------------------- 1. le nom */
  const nom = h('input', {
    type: 'text', id: 'setup-nom', maxlength: '60', autocomplete: 'name',
    placeholder: 'Mourad', value: etat.nom || '',
  });
  const enregistrerNom = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enregistrer mon nom');
  enregistrerNom.addEventListener('click', async () => {
    enregistrerNom.disabled = true;
    try {
      await Admin.saveIdentity(nom.value.trim());
      toast('Nom enregistré : il signera vos actions.', { tone: 'success' });
      await renderPremierLancement(container, ctx);
    } catch (error) {
      dire(error.message || 'Nom refusé.');
      enregistrerNom.disabled = false;
    }
  });

  /* --------------------------------------------------------- 2. le mot de passe */
  const actuel = h('input', {
    type: 'password', id: 'setup-actuel', autocomplete: 'current-password', maxlength: '200',
    placeholder: etat.motDePasseParDefaut ? 'admin' : 'mot de passe actuel',
  });
  const nouveau = h('input', {
    type: 'password', id: 'setup-nouveau', autocomplete: 'new-password', minlength: '12', maxlength: '200',
    placeholder: '12 caractères minimum',
  });
  const confirmation = h('input', {
    type: 'password', id: 'setup-confirmation', autocomplete: 'new-password', maxlength: '200',
    placeholder: 'répétez le mot de passe',
  });
  const changeMotDePasse = h('button', { class: 'btn btn-primary', type: 'button' }, 'Choisir ce mot de passe');
  changeMotDePasse.addEventListener('click', async () => {
    dire('');
    if (nouveau.value !== confirmation.value) {
      dire('Les deux mots de passe ne sont pas identiques.');
      confirmation.focus();
      return;
    }
    changeMotDePasse.disabled = true;
    try {
      await Admin.password(actuel.value, nouveau.value, confirmation.value);
      toast('Mot de passe changé. Toutes les autres sessions sont fermées.', { tone: 'success', duration: 7000 });
      await renderPremierLancement(container, ctx);
    } catch (error) {
      dire(error.message || 'Changement refusé.');
      changeMotDePasse.disabled = false;
    }
  });

  /* ------------------------------------------------------------- 3. le code */
  const courriel = h('input', {
    type: 'email', id: 'setup-courriel', maxlength: '120', autocomplete: 'email',
    placeholder: 'vous@exemple.com', value: etat.adresse || '',
  });
  const enregistrerCode = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Activer le code');
  enregistrerCode.addEventListener('click', async () => {
    enregistrerCode.disabled = true;
    try {
      await Admin.saveSettings({ adminEmail: courriel.value.trim() });
      toast('Code de connexion activé.', { tone: 'success' });
      await renderPremierLancement(container, ctx);
    } catch (error) {
      dire(error.message || 'Adresse refusée. Un serveur d’envoi doit être configuré.');
      enregistrerCode.disabled = false;
    }
  });

  /* ----------------------------------------------------------- 4. l'appareil */
  const autoriser = h('button', { class: 'btn btn-primary', type: 'button' }, icon('phone', 15), 'Autoriser cet appareil');
  autoriser.addEventListener('click', async () => {
    autoriser.disabled = true;
    try {
      await Admin.addDevice(navigator.platform || 'Appareil de travail');
      toast('Appareil autorisé.', { tone: 'success' });
      await renderPremierLancement(container, ctx);
    } catch (error) {
      dire(error.message || 'Appareil refusé.');
      autoriser.disabled = false;
    }
  });

  const etapes = Object.fromEntries(etat.etapes.map((etape) => [etape.id, etape]));

  view.append(
    h('div', { class: 'setup-shell' },
      h('p', { class: 'eyebrow' }, 'Premier lancement'),
      h('h1', {}, 'Votre console, à votre nom'),
      h('p', { class: 'muted' },
        'Deux étapes suffisent pour que cette console ne soit plus celle de personne : un nom, et un mot de passe qui n’est pas celui de démonstration. Les deux suivantes sont recommandées.'),
      h('ol', { class: 'setup-progress' },
        etat.etapes.map((etape) => h('li', { dataset: { fait: String(etape.fait) } },
          marque(etape), h('span', { text: etape.titre })))),
      errorBox,

      etapeBloc(etapes.identite,
        h('div', { class: 'console-toolbar' },
          h('div', { class: 'field' }, h('label', { for: 'setup-nom' }, 'Nom du propriétaire'), nom),
          h('div', { class: 'field', style: { alignSelf: 'end' } }, enregistrerNom))),

      etapeBloc(etapes['mot-de-passe'],
        h('div', { class: 'console-toolbar' },
          h('div', { class: 'field' }, h('label', { for: 'setup-actuel' }, 'Mot de passe actuel'), actuel),
          h('div', { class: 'field' }, h('label', { for: 'setup-nouveau' }, 'Nouveau mot de passe'), nouveau),
          h('div', { class: 'field' }, h('label', { for: 'setup-confirmation' }, 'Confirmation'), confirmation),
          h('div', { class: 'field', style: { alignSelf: 'end' } }, changeMotDePasse)),
        h('p', { class: 'help' }, etat.regleMotDePasse.aide)),

      etapeBloc(etapes.code,
        h('div', { class: 'console-toolbar' },
          h('div', { class: 'field' }, h('label', { for: 'setup-courriel' }, 'Adresse qui reçoit le code'), courriel),
          h('div', { class: 'field', style: { alignSelf: 'end' } }, enregistrerCode))),

      etapeBloc(etapes.appareil,
        h('div', { class: 'console-toolbar' },
          h('p', { class: 'muted' }, 'Cet appareil sera le seul à pouvoir ouvrir la console quand le verrou sera activé.'),
          autoriser)),

      h('div', { class: 'setup-pied' },
        h('button', {
          class: 'btn btn-quiet', type: 'button',
          onClick: () => {
            // Passer n'efface rien : le rappel reste visible dans la console pour cette session.
            try { sessionStorage.setItem('streamtv.setup.ignore', '1'); } catch { /* stockage indisponible */ }
            ctx.navigate(`${location.pathname}?onglet=pilotage`, { replace: true });
          },
        }, 'Plus tard, ouvrir la console'),
        h('span', { class: 'muted' },
          `Adresse de cette console : /${etat.chemin}`))));

  container.replaceChildren(view);
  queueMicrotask(() => {
    const cible = !etapes.identite.fait ? nom : !etapes['mot-de-passe'].fait ? actuel : courriel;
    cible?.focus({ preventScroll: true });
  });
  return true;
}
