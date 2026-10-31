// public/js/views/admin/settings.js · onglet Réglages : toutes les valeurs du schéma validées avant écriture.
// Un refus n'applique jamais partiellement les autres champs.

import { Admin } from '../../api.js?v=3.19.0';
import { h, icon, modal, toast } from '../../ui.js?v=3.19.0';
import { field, confirmModal, apiGuard } from './common.js?v=3.19.0';

const FIELD_GROUPS = [
  ['Identité', ['brand', 'tagline', 'accent', 'logoUrl', 'pageTitleSuffix', 'footerNote']],
  ['Catalogue', ['pageSize', 'defaultSort', 'confidenceFloor', 'targetTable', 'showHealthBadge']],
  ['Affichage', ['heroMode', 'featuredIds', 'showAdult', 'autoHideAdult']],
  ['Exploitation', ['maintenanceMode', 'epgUrl']],
  ['Anime, films et sources', ['vodEnabled', 'vodGenreRowsMax', 'sourceRetryBudget']],
];

/* ------------------------------------------------------------------ réglages */

async function renderSettings(host, ctx, { refreshStats }) {
  const { settings, schema } = await Admin.settings();
  const values = new Map();
  const inputs = new Map();
  const errorHost = h('div', {});

  const buildControl = (item) => {
    const value = settings[item.key];
    let control;
    if (item.type === 'boolean') {
      control = h('input', { type: 'checkbox', checked: Boolean(value) });
      values.set(item.key, () => control.checked);
      return h('div', { class: 'field' },
        h('label', { class: 'switch' }, control, ` ${item.label}`),
        item.help ? h('p', { class: 'help', text: item.help }) : null);
    }
    if (item.type === 'select') {
      control = h('select', {}, item.options.map((option) => h('option', { value: option.value, selected: option.value === value }, option.label)));
      values.set(item.key, () => control.value);
    } else if (item.type === 'color') {
      const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : accentParDefaut(), 'aria-label': 'Sélecteur de couleur' });
      control = h('input', { type: 'text', value, maxlength: '7', style: { maxWidth: '140px' } });
      color.addEventListener('input', () => { control.value = color.value; applyAccentPreview(color.value); });
      control.addEventListener('input', () => {
        if (/^#[0-9a-f]{6}$/i.test(control.value)) { color.value = control.value; applyAccentPreview(control.value); }
      });
      values.set(item.key, () => control.value.trim());
      return h('div', { class: 'field' },
        h('label', { for: `set-${item.key}` }, item.label),
        h('div', { class: 'color-row' }, color, control),
        item.help ? h('p', { class: 'help', text: item.help }) : null);
    } else if (item.type === 'number') {
      control = h('input', { type: 'number', value: String(value), min: String(item.min ?? 0), max: String(item.max ?? 100), step: String(item.step ?? 1) });
      values.set(item.key, () => Number(control.value));
    } else if (item.type === 'ids') {
      control = h('input', { type: 'text', value: (value || []).join(','), placeholder: 'identifiant1, identifiant2…' });
      values.set(item.key, () => control.value.split(',').map((part) => part.trim()).filter(Boolean));
    } else {
      control = h('input', { type: 'text', value: value || '', maxlength: String(item.maxLength || 200) });
      values.set(item.key, () => control.value.trim());
    }
    control.id = `set-${item.key}`;
    inputs.set(item.key, control);
    return field(item.label, control, item.help);
  };

  const form = h('form', { novalidate: true });
  for (const [title, keys] of FIELD_GROUPS) {
    const group = h('section', { class: 'panel', style: { marginBottom: '14px' } },
      h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, title));
    for (const key of keys) {
      const item = schema.find((entry) => entry.key === key);
      if (item) group.append(buildControl(item));
    }
    form.append(group);
  }

  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 16), 'Enregistrer les réglages');
  const reset = h('button', {
    class: 'btn btn-ghost', type: 'button',
    onClick: () => confirmModal({
      title: 'Réinitialiser les réglages',
      message: `Remettre les ${schema.length} réglages à leurs valeurs d’origine ? Le catalogue et les chaînes restent intacts.`,
      confirmLabel: 'Réinitialiser',
      onConfirm: async () => {
        document.querySelector('.modal-backdrop')?.remove();
        try {
          await Admin.resetSettings();
          await ctx.refreshConfig();
          await refreshStats();
          toast('Réglages réinitialisés.', { tone: 'success' });
          renderSettings(host, ctx, { refreshStats });
        } catch (error) { apiGuard(ctx, error); }
      },
    }),
  }, 'Réinitialiser');

  form.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, save, reset));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorHost.replaceChildren();
    const patch = {};
    for (const [key, getter] of values) patch[key] = getter();
    save.disabled = true;
    try {
      const result = await Admin.saveSettings(patch);
      toast(result.message || 'Réglages enregistrés.', { tone: 'success' });
      await ctx.refreshConfig();
      await refreshStats();
      await renderSettings(host, ctx, { refreshStats });
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      errorHost.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'danger' } },
        icon('alert', 16),
        h('div', {},
          h('p', { text: error.message }),
          error.field ? h('p', { class: 'muted', style: { fontSize: '13px' } }, `Champ concerné : ${error.field}`) : null)));
      save.disabled = false;
    }
  });

  host.replaceChildren(
    h('section', { class: 'panel' },
      h('p', { class: 'eyebrow' }, 'Configuration'),
      h('h2', { style: { fontSize: '22px', marginBottom: '4px' } }, `Les ${schema.length} réglages du site`),
      h('p', { class: 'muted', style: { marginBottom: '16px' } }, 'Chaque valeur est validée avant écriture : un réglage refusé n’est jamais appliqué partiellement.')),
    errorHost,
    form);
}

function applyAccentPreview(accent) {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) {
    document.documentElement.style.setProperty('--accent', accent);
  }
}

export { renderSettings };
