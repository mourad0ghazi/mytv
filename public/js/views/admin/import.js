// public/js/views/admin/import.js · onglet Importation : aperçu obligatoire, puis confirmation unique.
// L'aperçu ne modifie rien ; le commit est sérialisé côté serveur (verrou global, ERR-13).

import { Admin, ApiError } from '../../api.js?v=3.20.0';
import { COPY } from '../../copy.js?v=3.20.0';
import { h, icon, modal, toast, spinner, emptyState, fmtNumber, fmtRelative } from '../../ui.js?v=3.20.0';
import { statCard } from '../../components.js?v=3.20.0';
import { field, confirmModal, apiGuard } from './common.js?v=3.20.0';

/* ------------------------------------------------------------------ importation */

async function renderImport(host, ctx, state, { refreshStats }) {
  const urlInput = h('input', { type: 'url', placeholder: 'https://exemple.com/liste.m3u', 'aria-label': 'Adresse de la liste M3U' });
  const fileInput = h('input', { type: 'file', accept: '.m3u,.m3u8,text/plain', 'aria-label': 'Choisir un fichier M3U' });
  const nameInput = h('input', { type: 'text', placeholder: 'Nom de la source (facultatif)', maxlength: '80', 'aria-label': 'Nom de la source' });
  const previewHost = h('div', {});
  const historyHost = h('div', {});
  let fileText = '';
  let fileName = '';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast('Fichier trop volumineux (maximum 20 Mo).', { tone: 'error' });
      fileInput.value = '';
      return;
    }
    fileText = await file.text();
    fileName = file.name;
    nameInput.value = nameInput.value || file.name;
    toast(`Fichier « ${file.name} » prêt à être analysé.`, { tone: 'success', duration: 3000 });
  });

  const analyse = async (button) => {
    const url = urlInput.value.trim();
    if (!url && !fileText) {
      toast('Indiquez une adresse ou choisissez un fichier M3U.', { tone: 'error' });
      urlInput.focus();
      return;
    }
    button.disabled = true;
    button.replaceChildren(icon('retry', 16), 'Analyse en cours…');
    previewHost.replaceChildren(spinner('Lecture de la source et comparaison au catalogue…'));
    try {
      const preview = await Admin.importPreview(fileText
        ? { text: fileText, name: nameInput.value.trim() || fileName }
        : { url, name: nameInput.value.trim() });
      state.preview = preview;
      renderPreview(preview);
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      previewHost.replaceChildren(h('div', { class: 'banner', dataset: { tone: 'danger' } },
        icon('alert', 16),
        h('div', {},
          h('p', { text: error.message }),
          h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Rien n’a été écrit. Corrigez l’adresse ou le fichier, puis relancez l’analyse.'))));
    } finally {
      button.disabled = false;
      button.replaceChildren(icon('upload', 16), 'Analyser la source');
    }
  };

  const analyseBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('upload', 16), 'Analyser la source');
  analyseBtn.addEventListener('click', () => analyse(analyseBtn));

  const renderPreview = (preview) => {
    const counts = preview.counts;
    const commitBtn = h('button', { class: 'btn btn-primary', type: 'button' },
      icon('check', 16), counts.added || counts.updated ? 'Confirmer l’importation' : 'Aucune nouveauté');
    commitBtn.disabled = !counts.added && !counts.updated;
    commitBtn.addEventListener('click', () => {
      confirmModal({
        title: 'Confirmer l’importation',
        message: `Ajouter ${counts.added} chaîne(s) et mettre à jour ${counts.updated} chaîne(s) existante(s) ? ${counts.keptManual} décision(s) manuelle(s) seront conservées.`,
        confirmLabel: 'Importer',
        danger: false,
        onConfirm: async () => {
          document.querySelector('.modal-backdrop')?.remove();
          commitBtn.disabled = true;
          commitBtn.replaceChildren(icon('retry', 16), 'Importation…');
          try {
            const result = await Admin.importCommit(preview.jobId);
            toast(result.message, { tone: 'success', duration: 9000 });
            previewHost.replaceChildren();
            state.preview = null;
            await ctx.refreshConfig();
            await refreshStats();
            await loadHistory();
          } catch (error) {
            apiGuard(ctx, error);
          } finally {
            commitBtn.disabled = false;
            commitBtn.replaceChildren(icon('check', 16), 'Confirmer l’importation');
          }
        },
      });
    });

    const cancelBtn = h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => { previewHost.replaceChildren(); state.preview = null; } }, COPY.actions.cancel);

    previewHost.replaceChildren(h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Aperçu'),
        h('h2', { style: { fontSize: '20px' } }, `Source : ${preview.sourceName || 'liste'}`)),
        h('span', { class: 'badge' }, icon('clock', 12), `Valable ${Math.round(preview.expiresIn / 60)} minutes`)),
      h('p', { class: 'muted', style: { marginBottom: '16px' } }, COPY.admin?.help?.import || 'L’aperçu ne modifie rien. Rien n’est écrit avant la confirmation.'),
      h('div', { class: 'stat-grid' },
        statCard('Lignes lues', fmtNumber(preview.stats.lines), `${fmtNumber(preview.stats.extinf)} entrées EXTINF`),
        statCard('Uniques', fmtNumber(preview.stats.unique), `${fmtNumber(preview.stats.duplicates)} doublons ignorés`),
        statCard('À ajouter', fmtNumber(counts.added), 'nouvelles chaînes', counts.added ? 'ok' : ''),
        statCard('À mettre à jour', fmtNumber(counts.updated), `${fmtNumber(counts.unchanged)} inchangées`),
        statCard('Verrouillées', fmtNumber(counts.keptManual), 'décisions manuelles', counts.keptManual ? 'warn' : ''),
        statCard('Non lisibles', fmtNumber(counts.blocked), 'HTTP ou protégées', counts.blocked ? 'warn' : '')),
      preview.warnings?.length ? h('div', { style: { marginTop: '14px' } }, preview.warnings.map((warning) => h('div', { class: 'banner', dataset: { tone: 'info' }, style: { marginTop: '6px' } },
        icon('alert', 15), h('p', { text: warning })))) : null,
      preview.sample?.length ? h('div', { style: { marginTop: '16px' } },
        h('h3', { style: { fontSize: '15px', marginBottom: '8px' } }, 'Échantillon des ajouts'),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Catégorie'), h('th', {}, 'Confiance'), h('th', {}, 'Pays'), h('th', {}, 'État'))),
          h('tbody', {}, preview.sample.map((item) => h('tr', {},
            h('td', { dir: 'auto' }, item.name),
            h('td', {}, item.categoryLabel),
            h('td', { class: 'num' }, `${Math.round(item.confidence * 100)} %`),
            h('td', {}, item.country || 'Non renseigné'),
            h('td', {}, item.blocked ? 'Lecture limitée' : 'Lisible'))))))) : null,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '20px', flexWrap: 'wrap' } }, commitBtn, cancelBtn)));
  };

  const loadHistory = async () => {
    historyHost.replaceChildren(spinner('Chargement de l’historique…'));
    try {
      const { ingestions } = await Admin.ingestions();
      if (!ingestions.length) {
        historyHost.replaceChildren(emptyState({
          iconName: 'clock', title: 'Aucune importation',
          message: 'Les importations apparaîtront ici, avec la possibilité de les annuler.',
        }));
        return;
      }
      historyHost.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Source'), h('th', {}, 'Ajouts'), h('th', {}, 'Mises à jour'), h('th', {}, 'Total'), h('th', {}, 'Statut'), h('th', {}, 'Action'))),
        h('tbody', {}, ingestions.map((item) => h('tr', {},
          h('td', { class: 'num' }, fmtRelative(item.at)),
          h('td', { dir: 'auto' }, item.sourceName || 'import'),
          h('td', { class: 'num' }, String(item.counts?.added ?? 0)),
          h('td', { class: 'num' }, String(item.counts?.updated ?? 0)),
          h('td', { class: 'num' }, fmtNumber(item.totalAfter ?? 0)),
          h('td', {}, h('span', { class: 'badge', dataset: { tone: item.status === 'rolledBack' ? 'warn' : 'ok' } },
            item.status === 'rolledBack' ? 'Annulée' : 'Appliquée')),
          h('td', {}, item.status === 'applied' && item.rollbackAvailable !== false ? h('button', {
            class: 'btn btn-quiet btn-sm', type: 'button',
            onClick: () => confirmModal({
              title: 'Annuler cette importation',
              message: 'Les chaînes ajoutées seront retirées et les mises à jour restaurées. Cette action est définitive.',
              confirmLabel: 'Annuler l’importation',
              onConfirm: async () => {
                document.querySelector('.modal-backdrop')?.remove();
                try {
                  const result = await Admin.importRollback(item.id);
                  toast(result.message, { tone: 'success' });
                  await ctx.refreshConfig();
                  await refreshStats();
                  await loadHistory();
                } catch (error) { apiGuard(ctx, error); }
              },
            }),
          }, 'Annuler') : h('span', { class: 'muted' }, 'Non renseigné'))))))));
    } catch (error) {
      apiGuard(ctx, error);
      historyHost.replaceChildren(emptyState({ iconName: 'wifiOff', title: COPY.states.error.title, message: error.message, actionLabel: COPY.actions.retry, onAction: loadHistory }));
    }
  };

  host.replaceChildren(
    h('section', { class: 'panel' },
      h('p', { class: 'eyebrow' }, 'Sources'),
      h('h2', { style: { fontSize: '22px', marginBottom: '4px' } }, 'Importer une liste M3U'),
      h('p', { class: 'muted', style: { marginBottom: '18px' } }, 'Deux étapes obligatoires : l’aperçu ne modifie rien, la confirmation écrit une seule fois. Annulation possible pendant l’heure qui suit.'),
      h('div', { class: 'form-row' },
        field('Adresse de la liste', urlInput, 'HTTPS recommandé, 20 Mo maximum, délai de 20 secondes.'),
        field('Ou fichier M3U', fileInput, 'Le fichier est lu dans votre navigateur puis envoyé une seule fois.')),
      field('Nom de la source', nameInput, 'Apparaît dans l’historique et l’audit.'),
      analyseBtn),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('div', { class: 'section-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Mémoire'), h('h2', { style: { fontSize: '20px' } }, 'Historique des importations'))),
      historyHost),
    previewHost);

  await loadHistory();
}

export { renderImport };
