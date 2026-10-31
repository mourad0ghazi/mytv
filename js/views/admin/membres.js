// public/js/views/admin/membres.js · onglet Membres (3.19.0).
// Les comptes visiteurs se modèrent ici : consulter, suspendre, réactiver, supprimer.
// La console ne voit jamais un mot de passe ni une empreinte : seulement l'identité déclarée.

import { Admin } from '../../api.js?v=3.20.0';
import { h, icon, fmtNumber, spinner, emptyState, toast, modal } from '../../ui.js?v=3.20.0';

function dateCourte(iso) {
  if (!iso) return 'jamais';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'jamais' : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statutBadge(membre) {
  const tone = membre.status === 'actif' ? 'ok' : membre.status === 'suspendu' ? 'danger' : 'warn';
  return h('span', { class: 'badge', dataset: { tone } }, membre.statusLabel);
}

export async function renderMembres(panel, ctx) {
  panel.replaceChildren(spinner('Chargement des comptes…'));
  const state = { page: 1, q: '', statut: '' };

  let data = null;
  const charger = async () => {
    data = await Admin.membres({ page: state.page, pageSize: 20, q: state.q, statut: state.statut });
    return data;
  };
  try {
    await charger();
  } catch (error) {
    panel.replaceChildren(emptyState({
      iconName: error.status === 403 ? 'lock' : 'wifiOff',
      title: error.status === 403 ? 'Votre rôle ne gère pas les comptes' : 'Les comptes n’ont pas répondu',
      message: error.status === 403
        ? 'La permission « Comptes » est réservée au propriétaire.'
        : error.message || 'Réessayez dans un instant.',
      actionLabel: 'Réessayer',
      onAction: () => renderMembres(panel, ctx),
    }));
    return;
  }

  const liste = h('div', {});
  const pager = h('div', { class: 'pager' });
  const recherche = h('input', {
    type: 'search', id: 'membre-recherche', placeholder: 'Nom ou adresse e-mail', maxlength: '120',
    value: state.q, 'aria-label': 'Rechercher un compte visiteur',
  });
  const filtre = h('select', { id: 'membre-statut', 'aria-label': 'Filtrer par statut' },
    ...[['', 'Tous les statuts'], ['actif', 'Actifs'], ['attente', 'En attente'], ['suspendu', 'Suspendus']]
      .map(([valeur, label]) => h('option', { value: valeur, selected: state.statut === valeur }, label)));

  const suspendre = (membre) => {
    const cible = membre.status === 'suspendu' ? 'actif' : 'suspendu';
    modal({
      title: cible === 'suspendu' ? `Suspendre ${membre.name} ?` : `Réactiver ${membre.name} ?`,
      body: h('p', {}, cible === 'suspendu'
        ? 'Ses sessions sont fermées immédiatement. Le compte et ses données restent en place, il ne peut plus se connecter.'
        : 'Le compte retrouve l’accès à son espace. Ses favoris et son historique sont intacts.'),
      actions: [
        { label: 'Annuler', kind: 'quiet' },
        {
          label: cible === 'suspendu' ? 'Suspendre' : 'Réactiver',
          kind: 'primary',
          onClick: async () => {
            try {
              const result = await Admin.updateMembre(membre.id, { statut: cible });
              toast(result.message, { tone: 'success', duration: 5000 });
              await rafraichir();
            } catch (error) {
              toast(error.message, { tone: 'error', duration: 6000 });
            }
          },
        },
      ],
    });
  };

  const supprimer = (membre) => {
    modal({
      title: `Supprimer ${membre.name} ?`,
      body: h('div', {},
        h('p', {}, 'Le compte et ses données personnelles (favoris, historique, signalements suivis) sont retirés. Cette action est définitive.'),
        h('p', { class: 'help' }, membre.email)),
      actions: [
        { label: 'Annuler', kind: 'quiet' },
        {
          label: 'Supprimer',
          kind: 'danger',
          onClick: async () => {
            try {
              const result = await Admin.removeMembre(membre.id);
              toast(result.message, { tone: 'success', duration: 5000 });
              await rafraichir();
            } catch (error) {
              toast(error.message, { tone: 'error', duration: 6000 });
            }
          },
        },
      ],
    });
  };

  const ligne = (membre) => h('div', { class: 'row-card', dataset: { membreId: membre.id } },
    h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
      h('p', { style: { fontWeight: '600' } }, membre.name),
      h('p', { class: 'card-sub' }, membre.email, ' · ', `${fmtNumber(membre.favoritesCount)} favoris · ${fmtNumber(membre.historyCount)} reprises`),
      h('p', { class: 'card-sub' }, `Inscrit le ${dateCourte(membre.createdAt)} · dernière connexion ${dateCourte(membre.lastLoginAt)}`)),
    statutBadge(membre),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button',
      'aria-label': membre.status === 'suspendu' ? `Réactiver ${membre.name}` : `Suspendre ${membre.name}`,
      onClick: () => suspendre(membre),
    }, membre.status === 'suspendu' ? 'Réactiver' : 'Suspendre'),
    h('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Supprimer ${membre.name}`,
      onClick: () => supprimer(membre),
    }, icon('trash', 14)));

  const rendre = () => {
    liste.replaceChildren(
      data.members.length
        ? h('div', {}, ...data.members.map(ligne))
        : emptyState({
          iconName: 'news',
          title: 'Aucun compte visiteur',
          message: state.q || state.statut
            ? 'Aucun compte ne correspond à ce filtre.'
            : 'Les visiteurs peuvent créer un compte depuis la page Compte, une fois l’envoi d’e-mail configuré.',
        }));
    pager.replaceChildren(
      h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', disabled: data.page <= 1,
        onClick: async () => { state.page = Math.max(1, data.page - 1); await rafraichir(); },
      }, 'Précédent'),
      h('span', { class: 'muted' }, `Page ${data.page} sur ${data.pages} · ${fmtNumber(data.total)} compte${data.total > 1 ? 's' : ''}`),
      h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', disabled: data.page >= data.pages,
        onClick: async () => { state.page = Math.min(data.pages, data.page + 1); await rafraichir(); },
      }, 'Suivant'));
  };

  const rafraichir = async () => {
    try {
      await charger();
      rendre();
    } catch (error) {
      toast(error.message, { tone: 'error', duration: 6000 });
    }
  };

  recherche.addEventListener('input', () => {
    clearTimeout(recherche._minuteur);
    recherche._minuteur = setTimeout(async () => {
      state.q = recherche.value.trim();
      state.page = 1;
      await rafraichir();
    }, 250);
  });
  filtre.addEventListener('change', async () => {
    state.statut = filtre.value;
    state.page = 1;
    await rafraichir();
  });

  panel.replaceChildren(
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Visiteurs'),
        h('h2', {}, 'Comptes visiteurs')),
      h('span', { class: 'badge' }, `${fmtNumber(data.counts.actif)} actifs · ${fmtNumber(data.counts.attente)} en attente`)),
    h('div', { class: 'console-toolbar' },
      h('div', { class: 'field' }, h('label', { for: 'membre-recherche' }, 'Rechercher'), recherche),
      h('div', { class: 'field' }, h('label', { for: 'membre-statut' }, 'Statut'), filtre)),
    liste,
    pager,
    h('p', { class: 'help' }, 'Un compte visiteur n’ouvre aucun droit sur la console. Il conserve ses favoris, son historique, ses reprises et ses préférences d’affichage.'));
  rendre();
  return () => {};
}
