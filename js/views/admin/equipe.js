// public/js/views/admin/equipe.js · onglet Équipe (3.9.0).
// Comptes nominatifs, cinq rôles, permissions lisibles. Le propriétaire garde son mot de passe.

import { Admin } from '../../api.js?v=3.18.1';
import { h, icon, fmtNumber, spinner, emptyState, toast } from '../../ui.js?v=3.18.1';

function roleBadge(member) {
  const tone = member.role === 'administrateur' ? 'accent' : '';
  return h('span', { class: 'badge', dataset: tone ? { tone } : {} }, member.roleLabel);
}

function dateCourte(iso) {
  if (!iso) return 'jamais';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'jamais' : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function renderEquipe(panel, ctx) {
  panel.replaceChildren(spinner('Chargement de l’équipe…'));
  let data = null;
  try {
    data = await Admin.team();
  } catch (error) {
    panel.replaceChildren(emptyState({
      iconName: error.status === 403 ? 'lock' : 'wifiOff',
      title: error.status === 403 ? 'Votre rôle ne gère pas les comptes' : 'L’équipe n’a pas répondu',
      message: error.status === 403
        ? 'Demandez au propriétaire de modifier votre rôle, ou connectez-vous avec son compte.'
        : error.message || 'Réessayez dans un instant.',
      actionLabel: 'Réessayer',
      onAction: () => renderEquipe(panel, ctx),
    }));
    return;
  }

  const reload = () => renderEquipe(panel, ctx);

  const roleOptions = (selected) => data.roles
    .filter((role) => role.id !== 'proprietaire')
    .map((role) => h('option', { value: role.id, selected: role.id === selected }, role.label));

  const form = h('form', { class: 'console-toolbar', novalidate: true });
  const nameInput = h('input', { type: 'text', id: 'membre-nom', maxlength: '60', required: true, placeholder: 'Prénom et nom' });
  const emailInput = h('input', { type: 'email', id: 'membre-email', maxlength: '120', required: true, placeholder: 'prenom@exemple.com' });
  const roleInput = h('select', { id: 'membre-role', 'aria-label': 'Rôle du nouveau compte' }, roleOptions('editeur'));
  const passwordInput = h('input', { type: 'password', id: 'membre-mot-de-passe', minlength: '10', maxlength: '200', required: true, placeholder: '10 caractères minimum', autocomplete: 'new-password' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus', 15), 'Créer le compte');

  form.append(
    h('div', { class: 'field' }, h('label', { for: 'membre-nom' }, 'Nom affiché'), nameInput),
    h('div', { class: 'field' }, h('label', { for: 'membre-email' }, 'Adresse e-mail'), emailInput),
    h('div', { class: 'field' }, h('label', { for: 'membre-role' }, 'Rôle'), roleInput),
    h('div', { class: 'field' }, h('label', { for: 'membre-mot-de-passe' }, 'Mot de passe initial'), passwordInput),
    h('div', { class: 'field', style: { alignSelf: 'end' } }, submit));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await Admin.addMember({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        role: roleInput.value,
        password: passwordInput.value,
      });
      toast('Compte créé. Transmettez le mot de passe par un canal sûr.', { tone: 'success', duration: 6000 });
      reload();
    } catch (error) {
      toast(error.message || 'Création impossible.', { tone: 'error', duration: 6000 });
      submit.disabled = false;
    }
  });

  const changerRole = async (member, role) => {
    try {
      await Admin.updateMember(member.id, { role });
      toast(`Rôle de ${member.name} : ${data.roles.find((item) => item.id === role)?.label}.`, { tone: 'success' });
      reload();
    } catch (error) {
      toast(error.message || 'Modification refusée.', { tone: 'error' });
    }
  };

  const basculer = async (member) => {
    try {
      await Admin.updateMember(member.id, { disabled: !member.disabled });
      toast(member.disabled ? 'Accès rétabli.' : 'Accès fermé : les sessions du membre sont coupées.', { tone: 'info', duration: 5000 });
      reload();
    } catch (error) {
      toast(error.message || 'Modification refusée.', { tone: 'error' });
    }
  };

  const supprimer = async (member) => {
    if (!window.confirm(`Supprimer définitivement le compte de ${member.name} ?`)) return;
    try {
      await Admin.removeMember(member.id);
      toast('Compte supprimé.', { tone: 'success' });
      reload();
    } catch (error) {
      toast(error.message || 'Suppression refusée.', { tone: 'error' });
    }
  };

  const lignes = data.members.length
    ? data.members.map((member) => h('div', { class: 'team-row', dataset: { desactive: String(member.disabled) } },
      h('span', { class: 'team-avatar', 'aria-hidden': 'true', text: (member.name || '?').slice(0, 2).toUpperCase() }),
      h('div', { class: 'team-id' },
        h('strong', { dir: 'auto', text: member.name }),
        h('span', { class: 'muted', dir: 'ltr', text: member.email })),
      roleBadge(member),
      h('select', {
        class: 'select', 'aria-label': `Rôle de ${member.name}`,
        onChange: (event) => changerRole(member, event.target.value),
      }, roleOptions(member.role)),
      h('span', { class: 'muted team-date' }, `Connexion : ${dateCourte(member.lastLoginAt)}`),
      h('div', { class: 'team-actions' },
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => basculer(member) },
          member.disabled ? 'Rétablir' : 'Fermer l’accès'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Supprimer ${member.name}`, onClick: () => supprimer(member) },
          icon('trash', 14)))))
    : h('p', { class: 'muted' }, 'Aucun compte pour l’instant. Le propriétaire reste seul à se connecter avec son mot de passe.');

  const matrice = h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, 'Permission'),
      data.roles.map((role) => h('th', { class: 'tabular' }, role.label)))),
    h('tbody', {}, data.permissions.map((permission) => h('tr', {},
      h('td', {}, h('code', { text: permission })),
      data.roles.map((role) => h('td', {},
        role.permissions.includes(permission)
          ? h('span', { class: 'perm-ok', title: 'accordée' }, icon('check', 14))
          : h('span', { class: 'perm-no', title: 'refusée' }, 'refusé'))))))));

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Comptes et permissions'),
        h('h2', {}, 'Équipe'),
        h('p', { class: 'muted' }, 'Chaque personne a son propre compte : plus de mot de passe partagé, et un rôle qui limite strictement ce qu’elle peut faire.')),
      h('div', { class: 'console-actions' },
        h('span', { class: 'badge' }, icon('shield', 12), `${fmtNumber(data.members.length)} compte${data.members.length > 1 ? 's' : ''}`),
        h('span', { class: 'badge', dataset: { tone: 'accent' } }, `Vous : ${data.current.memberName}`))),
    h('div', { class: 'console-block' },
      h('h3', {}, 'Ajouter un collaborateur'),
      h('p', { class: 'muted' }, 'Le mot de passe n’est jamais visible après création. Le membre peut être fermé sans être supprimé.'),
      form),
    h('div', { class: 'console-block' },
      h('h3', {}, 'Comptes actifs'),
      lignes),
    h('div', { class: 'console-block' },
      h('h3', {}, 'Ce que chaque rôle autorise'),
      matrice),
    h('p', { class: 'muted', style: { fontSize: '12px' } },
      'Une permission refusée est bloquée par le serveur, pas seulement par l’écran. Fermer un accès coupe immédiatement les sessions du membre.'));
}
