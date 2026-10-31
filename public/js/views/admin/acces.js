// public/js/views/admin/acces.js · onglet Accès (3.13.0).
// Un lien, un rôle, une durée : celui qui reçoit le lien entre dans la console sans mot de passe.
// Le jeton n'est affiché qu'à la création, puis il n'existe plus nulle part.

import { Admin } from '../../api.js?v=3.19.0';
import { copyText, h, icon, spinner, emptyState, toast, fmtNumber } from '../../ui.js?v=3.19.0';
import { apiGuard } from './common.js?v=3.19.0';

const DUREES = [
  [15, '15 minutes'],
  [60, '1 heure'],
  [60 * 6, '6 heures'],
  [60 * 24, '24 heures'],
  [60 * 24 * 7, '7 jours'],
];

const ETATS = {
  actif: ['Actif', 'accent'],
  expire: ['Expiré', 'warn'],
  epuise: ['Épuisé', 'warn'],
  revoque: ['Révoqué', ''],
};

function dateHeure(iso) {
  if (!iso) return 'jamais';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'jamais';
  return date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function renderAcces(panel, ctx) {
  panel.replaceChildren(spinner('Chargement des liens d’accès…'));

  let data = null;
  try {
    data = await Admin.accessLinks();
  } catch (error) {
    if (apiGuard(ctx, error, { silent: true })) return;
    panel.replaceChildren(emptyState({
      iconName: error.status === 403 ? 'lock' : 'wifiOff',
      title: error.status === 403 ? 'Votre rôle ne gère pas les accès' : 'Les liens n’ont pas répondu',
      message: error.status === 403
        ? 'Seul le propriétaire crée et révoque les liens d’accès.'
        : error.message || 'Réessayez dans un instant.',
      actionLabel: 'Réessayer',
      onAction: () => renderAcces(panel, ctx),
    }));
    return;
  }

  const reload = () => renderAcces(panel, ctx);
  const lienCree = h('div', { class: 'console-block', hidden: true });

  // Formulaire de création
  const etiquette = h('input', { type: 'text', id: 'lien-etiquette', maxlength: '40', placeholder: 'Mourad, téléphone' });
  const role = h('select', { id: 'lien-role', 'aria-label': 'Rôle accordé par le lien' },
    h('option', { value: 'administrateur' }, 'Administrateur (tout, sauf l’équipe)'),
    h('option', { value: 'editeur' }, 'Éditeur (catalogue et importation)'),
    h('option', { value: 'moderateur' }, 'Modérateur (catalogue et signalements)'),
    h('option', { value: 'analyste' }, 'Analyste (lecture et mesure)'));
  const duree = h('select', { id: 'lien-duree', 'aria-label': 'Durée de validité' },
    DUREES.map(([minutes, label]) => h('option', { value: String(minutes), selected: minutes === 60 }, label)));
  const usages = h('input', {
    type: 'number', id: 'lien-usages', min: '1', max: String(data.usagesMax), value: '1', step: '1',
  });
  const creer = h('button', { class: 'btn btn-primary', type: 'button' }, icon('link', 15), 'Créer le lien');

  creer.addEventListener('click', async () => {
    creer.disabled = true;
    try {
      const reponse = await Admin.createAccessLink({
        label: etiquette.value.trim(),
        role: role.value,
        minutes: Number(duree.value),
        maxUses: Number(usages.value) || 1,
      });
      const champ = h('input', {
        type: 'text', id: 'lien-cree', readonly: true, value: reponse.lien, 'aria-label': 'Lien d’accès à copier',
      });
      const copier = h('button', { class: 'btn btn-primary', type: 'button' }, icon('copy', 15), 'Copier le lien');
      copier.addEventListener('click', async () => {
        const ok = await copyText(reponse.lien);
        toast(ok ? 'Lien copié. Envoyez-le à la personne concernée.' : reponse.lien, {
          tone: ok ? 'success' : 'info', duration: ok ? 5000 : 14_000,
        });
      });
      lienCree.hidden = false;
      lienCree.replaceChildren(
        h('h3', {}, 'Votre lien, affiché une seule fois'),
        h('p', { class: 'muted' }, 'Transmettez-le par un canal sûr. Il n’est plus affiché après avoir quitté cet écran. Toute personne qui l’ouvre entre dans la console avec le rôle choisi.'),
        h('div', { class: 'lien-console' }, h('code', { text: reponse.lien })),
        champ,
        h('div', { class: 'console-toolbar' }, copier));
      champ.hidden = true;
      toast('Lien créé.', { tone: 'success' });
      data = await Admin.accessLinks();
      dessinerListe();
    } catch (error) {
      toast(error.message || 'Création impossible.', { tone: 'error', duration: 8000 });
    } finally {
      creer.disabled = false;
    }
  });

  const revoquer = async (link) => {
    if (!window.confirm(`Révoquer « ${link.label} » ? Les personnes qui ont ce lien ne pourront plus entrer.`)) return;
    try {
      await Admin.revokeAccessLink(link.id);
      toast('Lien révoqué.', { tone: 'success' });
      reload();
    } catch (error) {
      toast(error.message || 'Révocation impossible.', { tone: 'error', duration: 7000 });
    }
  };

  const liste = h('div', { class: 'lien-liste' });

  const dessinerListe = () => {
    const links = data.links || [];
    if (!links.length) {
      liste.replaceChildren(h('p', { class: 'muted' }, 'Aucun lien pour l’instant. Créez-en un pour ouvrir la console sans mot de passe.'));
      return;
    }
    liste.replaceChildren(...links.map((link) => {
      const [etat, ton] = ETATS[link.state] || ETATS.actif;
      return h('div', { class: 'lien-row', dataset: { etat: link.state } },
        h('div', { class: 'lien-id' },
          h('strong', { dir: 'auto', text: link.label }),
          h('span', { class: 'muted' },
            `${link.roleLabel} · ${fmtNumber(link.uses)} / ${fmtNumber(link.maxUses)} usage${link.maxUses > 1 ? 's' : ''} · expire le ${dateHeure(link.expiresAt)}`)),
        h('span', { class: 'badge', dataset: ton ? { tone: ton } : {} }, etat),
        link.state === 'actif'
          ? h('button', {
            class: 'btn btn-quiet btn-sm', type: 'button',
            'aria-label': `Révoquer ${link.label}`,
            onClick: () => revoquer(link),
          }, 'Révoquer')
          : h('span', { class: 'muted lien-vide' }, ''));
    }));
  };
  dessinerListe();

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Accès par lien'),
        h('h2', {}, 'Accès'),
        h('p', { class: 'muted' }, 'Un lien ouvre la console à celui qui le possède, sans mot de passe. Vous décidez du rôle, de la durée et du nombre d’utilisations, et vous fermez l’accès à tout moment.')),
      h('div', { class: 'console-actions' },
        h('span', { class: 'badge' }, icon('link', 12), `${fmtNumber((data.links || []).filter((l) => l.state === 'actif').length)} actif${(data.links || []).filter((l) => l.state === 'actif').length > 1 ? 's' : ''}`),
        data.verrou
          ? h('span', { class: 'badge', dataset: { tone: 'warn' } }, 'Verrou d’appareil actif')
          : h('span', { class: 'badge' }, 'Verrou d’appareil levé'))),

    h('div', { class: 'console-block' },
      h('h3', {}, 'Créer un lien'),
      h('p', { class: 'muted' }, `Adresse de la console : /${data.chemin}. Le lien fonctionne sur téléphone, tablette et ordinateur.`),
      h('div', { class: 'console-toolbar' },
        h('div', { class: 'field' }, h('label', { for: 'lien-etiquette' }, 'À qui ce lien est destiné'), etiquette),
        h('div', { class: 'field' }, h('label', { for: 'lien-role' }, 'Rôle accordé'), role),
        h('div', { class: 'field' }, h('label', { for: 'lien-duree' }, 'Durée de validité'), duree),
        h('div', { class: 'field' }, h('label', { for: 'lien-usages' }, 'Ouvertures autorisées'), usages),
        h('div', { class: 'field', style: { alignSelf: 'end' } }, creer)),
      data.verrou
        ? h('p', { class: 'help' }, 'Le verrou d’appareil est actif : un lien administrateur ne s’ouvre que sur un appareil déjà enregistré. Les liens éditeur, modérateur et analyste ne sont pas concernés.')
        : h('p', { class: 'help' }, 'Le verrou d’appareil est levé : le lien s’ouvre depuis n’importe quel appareil. Activez-le dans l’onglet Appareils pour restreindre.')),

    lienCree,

    h('div', { class: 'console-block' },
      h('h3', {}, 'Liens existants'),
      liste),

    h('p', { class: 'muted', style: { fontSize: '12px' } },
      'Le serveur ne conserve qu’une empreinte du jeton : un lien perdu ne peut pas être relu, il se remplace. Une ouverture est inscrite au journal.'));
}
