// public/js/views/admin/appareils.js · onglet Appareils (3.11.0).
// La console n'est joignable que depuis les appareils enregistrés ici. L'adresse secrète
// se lit et se change au même endroit, sans jargon.

import { Admin } from '../../api.js?v=3.21.0';
import { copyText, h, icon, spinner, emptyState, toast } from '../../ui.js?v=3.21.0';
import { apiGuard } from './common.js?v=3.21.0';

function dateHeure(iso) {
  if (!iso) return 'jamais vu';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'jamais vu';
  return date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function renderAppareils(panel, ctx) {
  panel.replaceChildren(spinner('Chargement des appareils…'));

  let data = null;
  let reglages = null;
  try {
    [data, reglages] = await Promise.all([Admin.devices(), Admin.settings()]);
  } catch (error) {
    if (apiGuard(ctx, error, { silent: true })) return;
    panel.replaceChildren(emptyState({
      iconName: error.status === 403 ? 'lock' : 'wifiOff',
      title: error.status === 403 ? 'Votre rôle ne gère pas les appareils' : 'Les appareils n’ont pas répondu',
      message: error.status === 403
        ? 'Seul le propriétaire et les administrateurs ouvrent cet onglet.'
        : error.message || 'Réessayez dans un instant.',
      actionLabel: 'Réessayer',
      onAction: () => renderAppareils(panel, ctx),
    }));
    return;
  }

  const reload = () => renderAppareils(panel, ctx);
  const actuel = data.devices.find((device) => device.current);
  const messagerie = reglages?.mail || { ready: false, destination: '', host: '', from: '' };

  // Retirer un appareil : geste rare, donc confirmation explicite.
  const retirer = async (device) => {
    const message = device.current
      ? `Cet appareil est celui que vous utilisez. Après retrait, la console restera ouverte ici jusqu’à la prochaine déconnexion, puis elle demandera un appareil autorisé. Continuer ?`
      : `Retirer « ${device.label} » de la liste ?`;
    if (!window.confirm(message)) return;
    try {
      await Admin.removeDevice(device.id);
      toast('Appareil retiré.', { tone: 'success' });
      reload();
    } catch (error) {
      toast(error.message || 'Retrait refusé.', { tone: 'error', duration: 6000 });
    }
  };

  const ajouter = h('button', { class: 'btn btn-primary', type: 'button' }, icon('plus', 15), 'Autoriser cet appareil');
  ajouter.addEventListener('click', async () => {
    ajouter.disabled = true;
    try {
      const label = `${navigator.platform || 'Appareil'} · ${new Date().toLocaleDateString('fr-FR')}`;
      const reponse = await Admin.addDevice(label);
      toast(reponse.already ? 'Cet appareil était déjà autorisé.' : 'Appareil autorisé.', { tone: 'success' });
      reload();
    } catch (error) {
      toast(error.message || 'Ajout impossible.', { tone: 'error', duration: 6000 });
      ajouter.disabled = false;
    }
  });

  // Verrou : une seule case, un seul état lisible.
  const verrou = h('input', { type: 'checkbox', id: 'verrou-appareil', checked: Boolean(data.lock) });
  verrou.addEventListener('change', async () => {
    verrou.disabled = true;
    try {
      await Admin.saveSettings({ adminDeviceLock: verrou.checked });
      toast(verrou.checked
        ? 'Verrou actif : seuls les appareils listés ouvrent la console.'
        : 'Verrou levé : le mot de passe suffit à se connecter.', { tone: 'success', duration: 6000 });
      reload();
    } catch (error) {
      verrou.checked = !verrou.checked;
      verrou.disabled = false;
      toast(error.message || 'Changement refusé.', { tone: 'error', duration: 7000 });
    }
  });

  // Adresse secrète : lecture, puis changement sur demande.
  const chemin = h('input', {
    type: 'text', id: 'chemin-console', value: data.path, minlength: '8', maxlength: '40',
    autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'chemin-aide',
  });
  const lien = () => `${location.origin}/${data.path}`;
  const copier = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('link', 15), 'Copier le lien');
  copier.addEventListener('click', async () => {
    const ok = await copyText(lien());
    toast(ok ? 'Lien de la console copié.' : lien(), { tone: ok ? 'success' : 'info', duration: ok ? 4000 : 12_000 });
  });

  const enregistrer = h('button', { class: 'btn btn-primary', type: 'button' }, 'Changer l’adresse');
  enregistrer.addEventListener('click', async () => {
    const valeur = chemin.value.trim().toLowerCase();
    if (valeur === data.path) {
      toast('Cette adresse est déjà la vôtre.', { tone: 'info' });
      return;
    }
    enregistrer.disabled = true;
    try {
      await Admin.saveSettings({ adminPath: valeur });
      toast(`Nouvelle adresse : /${valeur}. Rechargez la page depuis ce chemin.`, { tone: 'success', duration: 9000 });
      reload();
    } catch (error) {
      toast(error.message || 'Adresse refusée.', { tone: 'error', duration: 7000 });
      enregistrer.disabled = false;
    }
  });

  const courriel = h('input', {
    type: 'email', id: 'admin-email', maxlength: '120', autocomplete: 'email', spellcheck: 'false',
    'aria-describedby': 'courriel-aide', placeholder: 'vous@exemple.com',
    value: messagerie.destination || '',
  });
  const enregistrerCourriel = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enregistrer l’adresse');
  enregistrerCourriel.addEventListener('click', async () => {
    enregistrerCourriel.disabled = true;
    try {
      const valeur = courriel.value.trim();
      await Admin.saveSettings({ adminEmail: valeur });
      toast(valeur ? `Code de connexion activé vers ${valeur}.` : 'Code de connexion désactivé.', {
        tone: 'success', duration: 6000,
      });
      reload();
    } catch (error) {
      toast(error.message || 'Adresse refusée.', { tone: 'error', duration: 8000 });
      enregistrerCourriel.disabled = false;
    }
  });

  const testerEnvoi = h('button', { class: 'btn btn-ghost', type: 'button', disabled: !messagerie.ready || !messagerie.destination },
    icon('mail', 15), 'Envoyer un test');
  testerEnvoi.addEventListener('click', async () => {
    testerEnvoi.disabled = true;
    try {
      const reponse = await Admin.testMail();
      toast(reponse.message || 'Message de contrôle envoyé.', { tone: 'success', duration: 8000 });
    } catch (error) {
      toast(error.message || 'Envoi impossible.', { tone: 'error', duration: 10_000 });
    } finally {
      testerEnvoi.disabled = !messagerie.ready || !messagerie.destination;
    }
  });

  const listes = data.devices.length
    ? data.devices.map((device) => h('div', { class: 'device-row', dataset: { courant: String(device.current) } },
      h('span', { class: 'device-mark', 'aria-hidden': 'true' }, icon('phone', 16)),
      h('div', { class: 'device-id' },
        h('strong', { dir: 'auto', text: device.label }),
        h('span', { class: 'muted' },
          `${device.current ? 'Cet appareil · ' : ''}ajouté le ${dateHeure(device.addedAt)} · vu le ${dateHeure(device.lastSeenAt)}`)),
      device.current ? h('span', { class: 'badge', dataset: { tone: 'accent' } }, 'Vous') : null,
      h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button',
        'aria-label': `Retirer ${device.label}`,
        onClick: () => retirer(device),
      }, icon('trash', 14))))
    : h('p', { class: 'muted' }, 'Aucun appareil autorisé pour l’instant. Autorisez celui que vous utilisez, puis activez le verrou.');

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Accès privé'),
        h('h2', {}, 'Appareils'),
        h('p', { class: 'muted' }, 'La console porte une adresse secrète et n’accepte que les appareils que vous autorisez. Même avec le bon mot de passe, un appareil inconnu reste dehors.')),
      h('div', { class: 'console-actions' },
        h('span', { class: 'badge' }, icon('phone', 12), `${data.devices.length} / 8 appareils`),
        h('span', { class: 'badge', dataset: data.lock ? { tone: 'accent' } : {} }, data.lock ? 'Verrou actif' : 'Verrou levé'))),

    h('div', { class: 'console-block' },
      h('h3', {}, 'Adresse de la console'),
      h('p', { class: 'muted' }, 'C’est le seul chemin qui ouvre cette console. Gardez-le pour vous et ne le partagez qu’avec vos appareils.'),
      h('p', { class: 'lien-console' }, h('code', { text: lien() })),
      h('div', { class: 'console-toolbar' },
        h('div', { class: 'field' }, h('label', { for: 'chemin-console' }, 'Chemin'), chemin),
        h('div', { class: 'field', style: { alignSelf: 'end' } }, enregistrer, copier)),
      h('p', { class: 'help', id: 'chemin-aide' },
        `Adresse actuelle : /${data.path}. De 8 à 40 caractères : lettres minuscules, chiffres et tirets.`)),

    h('div', { class: 'console-block' },
      h('h3', {}, 'Verrou d’appareil'),
      h('div', { class: 'switch-line' },
        verrou,
        h('label', { for: 'verrou-appareil' },
          h('strong', {}, 'N’accepter que les appareils listés'),
          h('span', { class: 'muted' }, ' Le verrou se pose après l’enregistrement d’au moins un appareil, pour ne jamais vous enfermer dehors.')))),

    h('div', { class: 'console-block' },
      h('h3', {}, 'Code de connexion par e-mail'),
      h('p', { class: 'muted' }, messagerie.destination
        ? `Chaque connexion depuis un appareil autorisé demande un code à six chiffres envoyé à ${messagerie.destination}. Le mot de passe seul n’ouvre plus la console.`
        : 'Facultatif, et recommandé : un code à six chiffres envoyé à votre adresse. Le mot de passe seul ne suffira plus.'),
      h('div', { class: 'console-toolbar' },
        h('div', { class: 'field' },
          h('label', { for: 'admin-email' }, 'Adresse qui reçoit le code'),
          courriel),
        h('div', { class: 'field', style: { alignSelf: 'end' } }, enregistrerCourriel),
        h('div', { class: 'field', style: { alignSelf: 'end' } }, testerEnvoi)),
      h('p', { class: 'help', id: 'courriel-aide' },
        messagerie.ready
          ? `Serveur d’envoi configuré : ${messagerie.host}${messagerie.from ? ` (expéditeur ${messagerie.from})` : ''}.`
          : 'Aucun serveur d’envoi configuré : renseignez STREAMTV_SMTP_HOST, STREAMTV_SMTP_USER et STREAMTV_SMTP_PASS sur le serveur, puis redémarrez.')),

    h('div', { class: 'console-block' },
      h('h3', {}, 'Appareils autorisés'),
      h('div', { class: 'console-toolbar' },
        h('p', { class: 'muted' }, actuel
          ? 'Cet appareil est déjà autorisé.'
          : 'Cet appareil n’est pas encore autorisé : ajoutez-le avant d’activer le verrou.'),
        ajouter),
      listes),

    h('p', { class: 'muted', style: { fontSize: '12px' } },
      'Chaque appareil est reconnu par une empreinte calculée sur cet identifiant local, jamais par son adresse réseau. Retirer un appareil ferme ses sessions à la prochaine connexion.'));
}
