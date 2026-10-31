// public/js/views/admin/sources.js · onglet Sources (3.18.0).
// Liste, état de la sonde, priorité réglable, activation, licence éditable, import manuel
// avec retour d'état, historique des imports. Aucune source sans licence n'est importable.

import { Admin } from '../../api.js?v=3.20.0';
import { COPY } from '../../copy.js?v=3.20.0';
import { h, icon, fmtNumber, fmtRelative, spinner, emptyState, toast } from '../../ui.js?v=3.20.0';
import { apiGuard, field } from './common.js?v=3.20.0';
import { docLink } from './doc.js?v=3.20.0';

const CONTENU_LABEL = { chaine: 'Chaînes', anime: 'Anime', film: 'Films' };
const TYPE_LABEL = { direct: 'Direct', vod: 'Vidéo à la demande' };
const ETAT_LABEL = {
  saine: { text: 'Saine', tone: 'ok' },
  instable: { text: 'Instable', tone: 'warn' },
  'hors service': { text: 'Hors service', tone: 'danger' },
  inconnue: { text: 'Non testée', tone: '' },
};

function probeBadge(sonde) {
  const etat = ETAT_LABEL[sonde?.etat] || ETAT_LABEL.inconnue;
  const detail = sonde?.verifieLe
    ? `${fmtRelative(sonde.verifieLe)} · ${sonde.tempsReponseMs ? `${sonde.tempsReponseMs} ms` : 'sans mesure'} · échec ${Math.round((sonde.tauxEchec || 0) * 100)} % sur ${sonde.essais} essai${sonde.essais > 1 ? 's' : ''}`
    : 'Aucune sonde lancée';
  return h('div', { class: 'source-probe' },
    h('span', { class: 'badge', dataset: { tone: etat.tone } }, etat.text),
    h('span', { class: 'muted source-probe-detail', text: detail }),
    sonde?.erreur ? h('span', { class: 'muted source-probe-detail', text: sonde.erreur }) : null);
}

function sourceRow(source, { onChange, onImport, onDelete, onProbe, busy }) {
  const licenceInput = h('input', {
    type: 'text', value: source.licence || '', maxlength: '160',
    'aria-label': `Licence de la source ${source.nom}`,
    onChange: (event) => onChange(source.id, { licence: event.target.value.trim() }),
  });
  const prioriteInput = h('input', {
    type: 'number', value: String(source.priorite), min: '1', max: '100', step: '1',
    'aria-label': `Priorité de la source ${source.nom}`,
    onChange: (event) => onChange(source.id, { priorite: Number(event.target.value) }),
  });
  const actifInput = h('input', {
    type: 'checkbox', checked: Boolean(source.actif),
    'aria-label': `Activer la source ${source.nom}`,
    onChange: (event) => onChange(source.id, { actif: event.target.checked }),
  });

  return h('article', { class: 'source-row', dataset: { licence: source.licence ? 'ok' : 'manquante' } },
    h('div', { class: 'source-head' },
      h('div', { class: 'source-title' },
        h('p', { class: 'source-nom', dir: 'auto', text: source.nom }),
        h('p', { class: 'source-meta muted' },
          `${TYPE_LABEL[source.type] || source.type} · ${CONTENU_LABEL[source.contenu] || source.contenu} · ${source.pays} · ${source.langue}`,
          source.importable ? '' : ' · licence manquante, import bloqué')),
      probeBadge(source.sonde)),
    h('div', { class: 'source-grid' },
      field('Licence affichée', licenceInput, 'Obligatoire pour importer. Recopiez la licence exacte de la source.'),
      field('Priorité (1 à 100)', prioriteInput, 'À doublon, la priorité la plus haute gagne ; l’arbitrage est journalisé.'),
      h('div', { class: 'field' },
        h('label', { class: 'switch' }, actifInput, ' Source active'),
        h('p', { class: 'help', text: 'Une source désactivée reste listée, mais son import est refusé.' }))),
    h('div', { class: 'source-actions' },
      h('span', { class: 'muted source-counts' },
        `Chaînes : ${fmtNumber(source.contenus?.chains || 0)} · Anime : ${fmtNumber(source.contenus?.anime || 0)} · Films : ${fmtNumber(source.contenus?.films || 0)}`,
        source.lastIngestAt ? ` · dernier import ${fmtRelative(source.lastIngestAt)}` : ' · jamais importée'),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', disabled: busy,
        onClick: () => onProbe([source.id]),
      }, icon('retry', 14), 'Sonder'),
      h('button', {
        class: 'btn btn-primary btn-sm', type: 'button', disabled: busy || !source.importable,
        title: source.importable ? '' : 'Renseignez une licence pour autoriser l’import',
        onClick: () => onImport(source.id),
      }, icon('download', 14), 'Importer'),
      h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', disabled: busy, id: `supprimer-${source.id}`,
        onClick: () => onDelete(source),
      }, icon('trash', 14), 'Supprimer')));
}

function importRow(record, { onReset, busy }) {
  const statut = {
    applied: { label: 'Appliqué', tone: 'ok' },
    reinitialise: { label: 'Remis à zéro', tone: 'warn' },
  }[record.status] || { label: record.status, tone: '' };
  return h('div', { class: 'variant import-row' },
    h('span', { class: 'tabular muted', text: String(record.at || '').slice(0, 16).replace('T', ' ') }),
    h('span', { dir: 'auto' }, record.sourceNom || record.sourceId),
    h('span', { class: 'badge' }, CONTENU_LABEL[record.contenu] || record.contenu),
    h('span', { class: 'muted' },
      `${record.counts?.added || 0} ajouts · ${record.counts?.updated || 0} mises à jour · ${record.counts?.duplicatesArbitrated || 0} doublons`),
    h('span', { class: 'badge', dataset: { tone: statut.tone } }, statut.label),
    record.rollbackAvailable && record.status === 'applied'
      ? h('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', disabled: busy,
        onClick: () => onReset(record),
      }, icon('retry', 13), 'Remettre à zéro')
      : h('span', { class: 'muted', text: 'Aucune action possible' }));
}

export async function renderSources(panel, ctx, state = {}, helpers = {}) {
  panel.replaceChildren(spinner('Chargement des sources…'));
  let data = null;
  try {
    data = await Admin.sources();
  } catch (error) {
    if (apiGuard(ctx, error, { silent: true })) return;
    panel.replaceChildren(emptyState({
      iconName: 'wifiOff',
      title: 'Les sources n’ont pas répondu',
      message: error.message || 'Réessayez dans un instant.',
      actionLabel: COPY.actions.retry,
      onAction: () => renderSources(panel, ctx, state, helpers),
    }));
    return;
  }

  let busy = false;
  let retour = h('div', {});

  const signaler = (message, tone = 'success') => {
    retour.replaceChildren(h('div', { class: 'banner', dataset: { tone: tone === 'success' ? 'info' : tone }, role: 'status' },
      icon(tone === 'error' ? 'alert' : 'check', 16), h('p', { text: message })));
  };

  const reload = () => renderSources(panel, ctx, state, helpers);

  const onChange = async (id, patch) => {
    if (busy) return;
    busy = true;
    try {
      const result = await Admin.updateSource(id, patch);
      toast(result.message || 'Source mise à jour.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'La modification n’a pas abouti.', 'danger');
    } finally {
      busy = false;
    }
  };

  const onProbe = async (ids) => {
    if (busy) return;
    busy = true;
    panel.replaceChildren(spinner('Sonde en cours… quatre sources testées en parallèle.'));
    try {
      const result = await Admin.probeSources(ids);
      busy = false;
      await reload();
      toast(result.message || 'Sonde terminée.', { tone: 'success' });
    } catch (error) {
      busy = false;
      await reload();
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'La sonde n’a pas abouti.', 'danger');
    }
  };

  const onImport = async (id) => {
    if (busy) return;
    busy = true;
    retour.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'info' } },
      icon('download', 16), h('p', { text: 'Import en cours : lecture de la source, contrôle de licence, écriture atomique en fin de lot.' })));
    try {
      const result = await Admin.importSource(id);
      busy = false;
      signaler(`${result.message} Tentatives réseau : ${result.attemptsUsed}.`, 'success');
      await reload();
    } catch (error) {
      busy = false;
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'L’import n’a pas abouti.', 'danger');
      await reload();
    }
  };

  const onDelete = async (source) => {
    const ok = globalThis.confirm(`Supprimer la source « ${source.nom} » ? Les contenus déjà importés restent au catalogue.`);
    if (!ok) return;
    busy = true;
    try {
      const result = await Admin.deleteSource(source.id);
      toast(result.message || 'Source supprimée.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'La suppression n’a pas abouti.', 'danger');
    } finally {
      busy = false;
    }
  };

  const onReset = async (record) => {
    const ok = globalThis.confirm(`Remettre à zéro l’import du ${String(record.at).slice(0, 16).replace('T', ' ')} ? Les contenus ajoutés par cet import seront retirés, et les mises à jour restaurées.`);
    if (!ok) return;
    busy = true;
    try {
      const result = await Admin.resetSourceImport(record.id);
      toast(result.message || 'Import remis à zéro.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'La remise à zéro n’a pas abouti.', 'danger');
    } finally {
      busy = false;
    }
  };

  // Formulaire d'ajout : la licence est demandée avec le reste, jamais après.
  const nomInput = h('input', { type: 'text', id: 'source-nom', maxlength: '80', required: true });
  const contenuSelect = h('select', { id: 'source-contenu' },
    Object.entries(CONTENU_LABEL).map(([value, label]) => h('option', { value }, label)));
  const typeSelect = h('select', { id: 'source-type' },
    Object.entries(TYPE_LABEL).map(([value, label]) => h('option', { value }, label)));
  const urlInput = h('input', { type: 'url', id: 'source-url', maxlength: '500', placeholder: 'https://…' });
  const licenceInput = h('input', { type: 'text', id: 'source-licence', maxlength: '160', required: true, placeholder: 'Creative Commons Attribution 4.0 (CC BY 4.0)' });
  const paysInput = h('input', { type: 'text', id: 'source-pays', maxlength: '3', value: 'INT' });
  const langueInput = h('select', { id: 'source-langue' },
    ['VOSTFR', 'VF', 'VO', 'fr', 'en', 'multi'].map((value) => h('option', { value }, value)));
  const prioInput = h('input', { type: 'number', id: 'source-priorite', min: '1', max: '100', step: '1', value: '60' });
  const form = h('form', { class: 'toolbar-card', novalidate: true },
    h('h3', { style: { fontSize: '16px', marginBottom: '8px' } }, 'Ajouter une source'),
    h('div', { class: 'form-row' },
      field('Nom de la source', nomInput),
      field('Contenu', contenuSelect)),
    h('div', { class: 'form-row' },
      field('Type', typeSelect),
      field('Adresse du flux ou du manifeste', urlInput, 'HTTPS obligatoire. Un manifeste JSON pour un anime ou un film.')),
    h('div', { class: 'form-row' },
      field('Licence (obligatoire)', licenceInput, 'Une source sans licence est refusée par le serveur, pas seulement par l’écran.'),
      field('Pays', paysInput)),
    h('div', { class: 'form-row' },
      field('Langue', langueInput),
      field('Priorité (1 à 100)', prioInput)),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus', 15), 'Ajouter la source')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await Admin.createSource({
        nom: nomInput.value.trim(),
        contenu: contenuSelect.value,
        type: typeSelect.value,
        url: urlInput.value.trim(),
        licence: licenceInput.value.trim(),
        pays: paysInput.value.trim() || 'INT',
        langue: langueInput.value,
        priorite: Number(prioInput.value),
        actif: true,
      });
      toast(result.message || 'Source ajoutée.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      signaler(error.message || 'La source n’a pas pu être ajoutée.', 'danger');
    }
  });

  const sourcesHost = h('div', { class: 'source-list' },
    data.sources.map((source) => sourceRow(source, { onChange, onImport, onDelete, onProbe, busy })));

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Catalogue'),
        h('h2', {}, 'Sources et licences'),
        h('p', { class: 'muted' },
          'Chaque source déclare sa licence, sa priorité et son contenu. Sans licence, l’import est refusé et journalisé.')),
      h('div', { class: 'console-actions' },
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onClick: () => onProbe(data.sources.map((source) => source.id)),
        }, icon('retry', 14), 'Sonder toutes les sources'),
        docLink('onglet-sources'))),
    retour,
    h('div', { class: 'callout' },
      h('div', {},
        h('p', { class: 'callout-title' }, 'Règle de licence'),
        h('p', { class: 'muted' },
          'Une source sans licence renseignée est refusée à l’import, avec un message explicite et une ligne d’audit « source.import.refused ». À doublon, la priorité la plus haute gagne ; l’arbitrage est écrit dans le journal.'))),
    sourcesHost,
    h('section', { class: 'console-block' },
      h('h3', {}, 'Ajouter une source'),
      form),
    h('section', { class: 'console-block' },
      h('h3', {}, `Historique des imports · ${data.imports.length}`),
      data.imports.length
        ? h('div', { class: 'rows' }, data.imports.map((record) => importRow(record, { onReset, busy })))
        : h('p', { class: 'muted' }, 'Aucun import de source enregistré. Le premier apparaîtra ici, avec ses compteurs.')));
}
