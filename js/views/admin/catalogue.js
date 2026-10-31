// public/js/views/admin/catalogue.js · onglet Catalogue : table paginée, actions groupées, fiche d'édition.
// Aucune donnée métier n'est recalculée ici : l'API reste la seule source de vérité.

import { Admin, ApiError } from '../../api.js?v=3.18.0';
import { COPY } from '../../copy.js?v=3.18.0';
import {
  h, icon, modal, toast, emptyState, spinner, fmtNumber, logoNode, healthBadge, debounce,
} from '../../ui.js?v=3.18.0';
import { field, confirmModal, apiGuard } from './common.js?v=3.18.0';

/* ------------------------------------------------------------------ catalogue */

async function renderCatalogue(host, ctx, state, { refreshStats }) {
  const toolbar = h('div', { class: 'toolbar-card' });
  const bulkBar = h('div', {});
  const tableHost = h('div', {});
  host.replaceChildren(toolbar, bulkBar, tableHost);

  const search = h('input', {
    type: 'search', placeholder: 'Rechercher un nom, un pays, un numéro…', 'aria-label': 'Rechercher dans le catalogue',
    value: state.q,
    onInput: debounce((event) => { state.q = event.target.value.trim(); state.page = 1; load(); }, 300),
  });
  const category = h('select', {
    class: 'select', 'aria-label': 'Filtrer par catégorie',
    onChange: (event) => { state.category = event.target.value; state.page = 1; load(); },
  }, h('option', { value: '' }, 'Toutes les catégories'),
  ...ctx.config.categories.map((item) => h('option', { value: item.id }, `${item.label} (${fmtNumber(item.count)})`)));
  const visibility = h('select', {
    class: 'select', 'aria-label': 'Filtrer par visibilité',
    onChange: (event) => { state.visibility = event.target.value; state.page = 1; load(); },
  }, [['all', 'Toutes les chaînes'], ['public', 'Visibles seulement'], ['hidden', 'Masquées seulement'], ['deleted', 'Supprimées']]
    .map(([value, label]) => h('option', { value }, label)));

  const createBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => channelModal(ctx, null, { onDone: () => load(true) }) },
    icon('plus', 14), 'Nouvelle chaîne');
  const autotagBtn = h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    onClick: () => confirmModal({
      title: 'Reclasser tout le catalogue',
      message: 'Recalculer la catégorie de toutes les chaînes non verrouillées ? Les décisions manuelles sont conservées.',
      confirmLabel: 'Reclasser',
      danger: false,
      onConfirm: async () => {
        document.querySelector('.modal-backdrop')?.remove();
        try {
          const result = await Admin.autotag();
          toast(result.message, { tone: 'success' });
          await refreshStats();
          load(true);
        } catch (error) { apiGuard(ctx, error); }
      },
    }),
  }, icon('grid', 14), 'Reclasser');

  toolbar.append(
    h('div', { class: 'toolbar-card-row' }, search, category, visibility),
    h('div', { class: 'toolbar-card-row', style: { justifyContent: 'flex-end' } }, autotagBtn, createBtn));

  const renderBulk = () => {
    if (!state.selection.size) { bulkBar.replaceChildren(); return; }
    const ids = [...state.selection];
    const act = async (action, value = undefined) => {
      try {
        const result = await Admin.bulk(ids, action, value);
        toast(result.message, { tone: 'success' });
        state.selection.clear();
        await refreshStats();
        load(true);
      } catch (error) { apiGuard(ctx, error); }
    };
    bulkBar.replaceChildren(h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'Actions sur la sélection' },
      h('strong', { text: `${ids.length} chaîne${ids.length > 1 ? 's' : ''} sélectionnée${ids.length > 1 ? 's' : ''}` }),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => act('hide') }, 'Masquer'),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => act('show') }, 'Afficher'),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => act('feature') }, 'En vedette'),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => act('unfeature') }, 'Retirer vedette'),
      h('select', {
        class: 'select', 'aria-label': 'Changer la catégorie de la sélection',
        onChange: (event) => { if (event.target.value) act('category', event.target.value); },
      }, h('option', { value: '' }, 'Catégorie…'), ctx.config.categories.map((item) => h('option', { value: item.id }, item.label))),
      h('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        onClick: () => confirmModal({
          title: 'Supprimer la sélection',
          message: `Retirer ${ids.length} chaînes du catalogue ? Elles pourront être restaurées une par une.`,
          confirmLabel: 'Supprimer',
          onConfirm: async () => { document.querySelector('.modal-backdrop')?.remove(); await act('delete'); },
        }),
      }, 'Supprimer'),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { state.selection.clear(); renderBulk(); load(true); } }, 'Désélectionner')));
  };

  const load = async (resetScroll = false) => {
    tableHost.replaceChildren(spinner('Chargement du catalogue…'));
    renderBulk();
    try {
      const payload = await Admin.channels({
        page: String(state.page),
        pageSize: '60',
        q: state.q,
        category: state.category,
        visibility: state.visibility,
      });
      if (!payload.channels.length) {
        tableHost.replaceChildren(emptyState({
          iconName: 'database',
          title: 'Aucune chaîne ne correspond',
          message: state.q ? `Aucun résultat pour « ${state.q} ».` : 'Ce filtre ne renvoie aucune chaîne.',
          actionLabel: 'Réinitialiser les filtres',
          onAction: () => {
            state.q = ''; state.category = ''; state.visibility = 'all'; state.page = 1;
            search.value = ''; category.value = ''; visibility.value = 'all';
            load();
          },
        }));
        return;
      }
      const all = h('input', {
        type: 'checkbox', 'aria-label': 'Sélectionner les 60 chaînes de cette page',
        onChange: (event) => {
          for (const channel of payload.channels) {
            if (event.target.checked) state.selection.add(channel.id);
            else state.selection.delete(channel.id);
          }
          tableHost.querySelectorAll('tbody input[type="checkbox"]').forEach((box) => { box.checked = event.target.checked; });
          renderBulk();
        },
      });
      const table = h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { style: { width: '36px' } }, all),
          h('th', {}, 'N°'), h('th', {}, 'Chaîne'), h('th', {}, 'Catégorie'), h('th', {}, 'Confiance'),
          h('th', {}, 'Santé'), h('th', {}, 'Visible'), h('th', {}, 'Actions'))),
        h('tbody', {}, payload.channels.map((channel) => {
          const box = h('input', {
            type: 'checkbox', 'aria-label': `Sélectionner ${channel.name}`,
            onChange: (event) => {
              if (event.target.checked) state.selection.add(channel.id);
              else state.selection.delete(channel.id);
              renderBulk();
            },
          });
          if (state.selection.has(channel.id)) box.checked = true;
          const toggleVisible = h('input', {
            type: 'checkbox', role: 'switch', checked: channel.visible && !channel.deleted,
            'aria-label': `Afficher ${channel.name} sur le site`,
            onChange: async (event) => {
              try {
                await Admin.update(channel.id, { visible: event.target.checked });
                toast(event.target.checked ? 'Chaîne visible.' : 'Chaîne masquée.', { tone: 'success', duration: 2500 });
                await refreshStats();
              } catch (error) {
                event.target.checked = !event.target.checked;
                apiGuard(ctx, error);
              }
            },
          });
          return h('tr', {},
            h('td', {}, box),
            h('td', { class: 'num' }, String(channel.number)),
            h('td', { style: { minWidth: '220px' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('span', { class: 'guide-logo' }, logoNode(channel, 26)),
                h('span', { dir: 'auto', text: channel.name }),
                channel.manualOverride ? h('span', { class: 'badge', title: 'Décision manuelle protégée' }, icon('lock', 11)) : null,
                channel.featured ? h('span', { class: 'badge', dataset: { tone: 'warn' } }, icon('star', 11)) : null,
                channel.blocked ? h('span', { class: 'badge', dataset: { tone: 'danger' } }, icon('alert', 11)) : null)),
            h('td', {}, h('span', { text: channel.categoryLabel }),
              h('span', { class: 'card-sub' }, channel.categorySource === 'manual' ? 'manuel' : channel.categorySource)),
            h('td', { class: 'num' }, `${Math.round((channel.confidence || 0) * 100)} %`),
            h('td', {}, healthBadge(channel.health)),
            h('td', {}, toggleVisible),
            h('td', {},
              h('div', { style: { display: 'flex', gap: '2px' } },
                h('button', {
                  class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Ouvrir la fiche de ${channel.name}`,
                  onClick: () => ctx.navigate(`/chaine/${channel.id}`),
                }, icon('external', 14)),
                h('button', {
                  class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Modifier ${channel.name}`,
                  onClick: () => channelModal(ctx, channel.id, { onDone: () => load(true) }),
                }, icon('edit', 14)),
                h('button', {
                  class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Supprimer ${channel.name}`,
                  onClick: () => confirmModal({
                    title: 'Supprimer la chaîne',
                    message: `Retirer « ${channel.name} » du catalogue ? Vous pourrez annuler pendant 10 secondes.`,
                    confirmLabel: 'Supprimer',
                    onConfirm: async () => {
                      document.querySelector('.modal-backdrop')?.remove();
                      try {
                        const result = await Admin.remove(channel.id);
                        await refreshStats();
                        load(true);
                        toast(result.message, {
                          tone: 'success', duration: 10000, actionLabel: 'Annuler',
                          onAction: async () => {
                            try {
                              await Admin.restore(channel.id);
                              toast('Chaîne restaurée.', { tone: 'success' });
                              await refreshStats();
                              load(true);
                            } catch (error) { apiGuard(ctx, error); }
                          },
                        });
                      } catch (error) { apiGuard(ctx, error); }
                    },
                  }),
                }, icon('trash', 14)))));
        })));
      tableHost.replaceChildren(
        h('div', { class: 'table-wrap' }, table),
        h('div', { class: 'toolbar', style: { marginTop: '12px' } },
          h('span', { class: 'count-label' }, `${fmtNumber(payload.total)} chaînes · page ${payload.page} sur ${payload.pages}`),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: payload.page <= 1, onClick: () => { state.page -= 1; load(); } }, 'Précédent'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !payload.hasMore, onClick: () => { state.page += 1; load(); } }, 'Suivant')));
      if (resetScroll) tableHost.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      apiGuard(ctx, error);
      tableHost.replaceChildren(emptyState({
        iconName: 'wifiOff', title: COPY.states.error.title, message: error.message,
        actionLabel: COPY.actions.retry, onAction: () => load(),
      }));
    }
  };

  await load();
}

async function channelModal(ctx, id, { onDone }) {
  let channel = null;
  if (id) {
    try {
      const payload = await Admin.channel(id);
      channel = payload.channel;
    } catch (error) {
      apiGuard(ctx, error);
      return;
    }
  }
  const categories = ctx.config.categories;
  const name = h('input', { type: 'text', value: channel?.name || '', maxlength: '80', required: true });
  const url = h('input', { type: 'url', value: channel?.url || '', placeholder: 'https://exemple.com/flux.m3u8', required: true });
  const logo = h('input', { type: 'url', value: channel?.logo || '', placeholder: 'https://exemple.com/logo.png' });
  const group = h('input', { type: 'text', value: channel?.group || '', maxlength: '120' });
  const number = h('input', { type: 'number', min: '1', max: '99999', value: channel ? String(channel.number) : '', placeholder: 'Automatique' });
  const quality = h('select', {}, ['AUTO', 'SD', 'HD', 'FHD', '4K', '8K'].map((value) => h('option', { value, selected: channel?.quality === value }, value === 'AUTO' ? 'Automatique' : value)));
  const category = h('select', {}, h('option', { value: '' }, 'Laisser le moteur décider'),
    categories.map((item) => h('option', { value: item.id, selected: channel?.category === item.id }, item.label)));
  const license = h('select', {}, ['libre accès public', 'accord de distribution', 'catalogue propre', 'retiré · demande de tiers']
    .map((value) => h('option', { value, selected: channel?.licenseNote === value }, value)));
  const visible = h('input', { type: 'checkbox', checked: channel ? channel.visible : true });
  const featured = h('input', { type: 'checkbox', checked: Boolean(channel?.featured) });
  const notes = h('textarea', { maxlength: '500' }, channel?.notes || '');
  const errorBox = h('p', { class: 'field-error', hidden: true, role: 'alert' });

  const box = modal({
    title: id ? 'Modifier la chaîne' : 'Ajouter une chaîne',
    body: h('div', {},
      field('Nom de la chaîne', name, 'Les suffixes de qualité sont retirés automatiquement.'),
      field('Adresse du flux', url, 'http, https, rtsp, rtmp ou udp. Une adresse HTTP sera signalée comme non lisible sur un site HTTPS.'),
      h('div', { class: 'form-row' }, field('Numéro', number, 'Vide = prochain numéro libre.'), field('Qualité', quality)),
      h('div', { class: 'form-row' }, field('Catégorie', category, 'Choisir une catégorie crée une décision manuelle protégée.'), field('Droits', license, 'Une chaîne retirée est masquée immédiatement.')),
      h('div', { class: 'form-row' }, field('Groupe d’origine', group), field('Logo (HTTPS)', logo)),
      h('div', { class: 'form-row' },
        h('label', { class: 'switch' }, visible, 'Visible dans le catalogue'),
        h('label', { class: 'switch' }, featured, 'Mettre en vedette')),
      field('Note privée', notes, 'Jamais affichée aux visiteurs.'),
      errorBox),
    actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => box.close() }, COPY.actions.cancel),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: async (event) => {
          errorBox.hidden = true;
          const button = event.currentTarget;
          button.disabled = true;
          const payload = {
            name: name.value.trim(),
            url: url.value.trim(),
            logo: logo.value.trim(),
            group: group.value.trim(),
            quality: quality.value,
            licenseNote: license.value,
            visible: visible.checked,
            featured: featured.checked,
            notes: notes.value.trim(),
          };
          if (category.value) payload.category = category.value;
          if (number.value) payload.number = Number(number.value);
          try {
            if (id) {
              if (!category.value) delete payload.category;
              await Admin.update(id, payload);
              toast('Chaîne enregistrée.', { tone: 'success' });
            } else {
              await Admin.create(payload);
              toast('Chaîne ajoutée au catalogue.', { tone: 'success' });
            }
            box.close();
            await onDone?.();
          } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
            button.disabled = false;
            if (error.field) {
              const target = { name, url, logo, group, number, quality, category, licenseNote: license, notes }[error.field];
              target?.focus?.();
            }
          }
        },
      }, id ? COPY.actions.save : 'Créer'),
    ],
  });
}

export { renderCatalogue, channelModal };
