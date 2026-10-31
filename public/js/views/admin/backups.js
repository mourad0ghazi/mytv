// public/js/views/admin/backups.js · onglet Sauvegardes : création immédiate, rotation 7+4, restauration confirmée.
// Toute restauration exige le mot « RESTAURER » et une empreinte SHA-256 valide.

import { Admin, auth, download } from '../../api.js?v=3.20.0';
import { loginHref } from '../../console.js?v=3.20.0';
import { h, icon, modal, toast, emptyState, fmtDate, fmtNumber } from '../../ui.js?v=3.20.0';
import { statCard } from '../../components.js?v=3.20.0';
import { field, confirmModal, apiGuard } from './common.js?v=3.20.0';

/* ------------------------------------------------------------------ F-24 : sortie SQL */

/** État de préparation de la bascule PostgreSQL, sans jamais la déclencher depuis l'interface. */
function migrationPanel(migration) {
  const plan = migration || { thresholdChannels: 30000, channels: 0, ratio: 0, atThreshold: false, targetTable: 0 };
  const percentage = Math.round((plan.ratio || 0) * 100);
  const tone = plan.atThreshold ? 'warn' : 'ok';
  return h('section', { class: 'panel', style: { marginTop: '16px' } },
    h('div', { class: 'section-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Passage à l’échelle'), h('h2', { style: { fontSize: '20px' } }, 'Sortie vers PostgreSQL 15')),
      h('span', { class: 'badge', dataset: { tone } },
        icon(plan.atThreshold ? 'alert' : 'check', 12),
        plan.atThreshold ? 'Seuil atteint' : `${percentage} % du seuil`)),
    h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Le stockage JSON reste la référence jusqu’à 30 000 chaînes. Au-delà, la migration produit un schéma et des INSERT rejouables, que psql applique : elle est réversible (aller-retour vérifié) et idempotente.'),
    h('div', { class: 'stat-grid' },
      statCard('Chaînes', fmtNumber(plan.channels), `seuil ${fmtNumber(plan.thresholdChannels)}`, plan.atThreshold ? 'warn' : 'ok'),
      statCard('Table cible', plan.targetTable ? fmtNumber(plan.targetTable) : 'non définie', 'réglage targetTable'),
      statCard('Schéma', plan.schemaVersion || 'streamtv-sql-1', 'PostgreSQL 15', 'ok'),
      statCard('Réversibilité', plan.reversible ? 'oui' : 'non', 'aller-retour vérifié', plan.reversible ? 'ok' : 'warn')),
    h('p', { class: 'muted', style: { margin: '12px 0 0' } },
      h('span', { class: 'tabular' }, 'node scripts/migrate.js --plan'),
      ' · puis --write pour produire schema.sql, data.sql et manifest.json.'),
  );
}

/* ------------------------------------------------------------------ sauvegardes */

async function renderBackups(host, ctx, { refreshStats, stats }) {
  const current = stats();
  const listHost = h('div', {});

  const createBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('database', 14), 'Sauvegarder maintenant');
  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const result = await Admin.backup();
      toast(result.message, { tone: 'success', duration: 6000 });
      await refreshStats();
      await renderBackups(host, ctx, { refreshStats, stats });
    } catch (error) { apiGuard(ctx, error); }
    finally { createBtn.disabled = false; }
  });

  const list = current.backupList || [];
  if (!list.length) {
    listHost.replaceChildren(emptyState({
      iconName: 'database', title: 'Aucune sauvegarde',
      message: 'Créez une sauvegarde avant toute modification importante.',
      actionLabel: 'Sauvegarder maintenant', onAction: () => createBtn.click(),
    }));
  } else {
    listHost.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Fichier'), h('th', {}, 'Date'), h('th', {}, 'Taille'), h('th', {}, 'Empreinte'), h('th', {}, 'Action'))),
      h('tbody', {}, list.map((backup) => h('tr', {},
        h('td', { style: { fontFamily: 'ui-monospace, monospace', fontSize: '12px' } }, backup.file),
        h('td', { class: 'num' }, backup.date || fmtDate(backup.createdAt)),
        h('td', { class: 'num' }, `${Math.round((backup.size || 0) / 1024)} Ko`),
        h('td', { style: { fontFamily: 'ui-monospace, monospace', fontSize: '12px' } }, (backup.sha256 || '').slice(0, 16) || 'Non renseigné'),
        h('td', {}, h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button',
          onClick: () => confirmModal({
            title: 'Restaurer une sauvegarde',
            message: `Remplacer le catalogue actuel par la sauvegarde du ${backup.date} ? Une sauvegarde de sécurité est créée automatiquement avant le remplacement.`,
            confirmLabel: 'Restaurer',
            requireWord: 'RESTAURER',
            onConfirm: async () => {
              document.querySelector('.modal-backdrop')?.remove();
              try {
                const result = await Admin.restoreBackup(backup.file);
                toast(result.message, { tone: 'success', duration: 9000 });
                await ctx.refreshConfig();
                await refreshStats();
                await renderBackups(host, ctx, { refreshStats, stats });
              } catch (error) { apiGuard(ctx, error); }
            },
          }),
        }, 'Restaurer'))))))));
  }

  const exportM3U = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('download', 14), 'Exporter M3U');
  exportM3U.addEventListener('click', async () => {
    try { await download('/api/admin/export.m3u', 'streamtv.m3u'); toast('Export M3U prêt : ouvrez-le dans VLC.', { tone: 'success' }); }
    catch (error) { apiGuard(ctx, error); }
  });
  const exportJson = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('download', 14), 'Exporter JSON');
  exportJson.addEventListener('click', async () => {
    try { await download('/api/admin/export.json', 'streamtv.json'); toast('Export JSON prêt.', { tone: 'success' }); }
    catch (error) { apiGuard(ctx, error); }
  });

  const currentPwd = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'pwd-current' });
  const nextPwd = h('input', { type: 'password', autocomplete: 'new-password', minlength: '12', required: true, id: 'pwd-next' });
  const confirmPwd = h('input', { type: 'password', autocomplete: 'new-password', required: true, id: 'pwd-confirm' });
  const passwordForm = h('form', { novalidate: true },
    h('div', { class: 'form-row' },
      field('Mot de passe actuel', currentPwd),
      field('Nouveau mot de passe', nextPwd, '12 caractères minimum, lettres et chiffres, différent de l’ancien.')),
    field('Confirmer', confirmPwd),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, icon('shield', 14), 'Changer le mot de passe'));
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (nextPwd.value !== confirmPwd.value) {
      toast('Les deux mots de passe ne correspondent pas.', { tone: 'error' });
      return;
    }
    try {
      const result = await Admin.password(currentPwd.value, nextPwd.value, confirmPwd.value);
      toast(result.message, { tone: 'success', duration: 9000 });
      auth.clear();
      setTimeout(() => ctx.navigate(loginHref(), { replace: true }), 1200);
    } catch (error) { apiGuard(ctx, error); }
  });

  host.replaceChildren(
    h('section', { class: 'panel' },
      h('div', { class: 'section-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, 'Continuité'),
          h('h2', { style: { fontSize: '20px' } }, 'Sauvegardes du catalogue')),
        createBtn),
      h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'Écriture atomique, rotation 7 quotidiennes + 4 hebdomadaires, empreinte SHA-256 vérifiée avant toute restauration.'),
      listHost,
      h('div', { style: { marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, exportM3U, exportJson)),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('p', { class: 'eyebrow' }, 'Sécurité'),
      h('h2', { style: { fontSize: '20px', marginBottom: '4px' } }, 'Mot de passe et sessions'),
      h('p', { class: 'muted', style: { marginBottom: '14px' } },
        `Scrypt N=16384, jeton 48 caractères, durée glissante 12 heures, ${current.sessions} session(s) active(s) sur 5 autorisées.`),
      passwordForm,
      h('div', { style: { marginTop: '14px' } }, h('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        onClick: () => confirmModal({
          title: 'Fermer toutes les sessions',
          message: 'Fermer toutes les sessions ouvertes, y compris celle-ci ? Vous devrez vous reconnecter.',
          confirmLabel: 'Tout fermer',
          onConfirm: async () => {
            document.querySelector('.modal-backdrop')?.remove();
            try {
              const result = await Admin.revokeSessions();
              auth.clear();
              toast(result.message, { tone: 'info' });
              ctx.navigate(loginHref(), { replace: true });
            } catch (error) { apiGuard(ctx, error); }
          },
        }),
      }, icon('lock', 14), 'Fermer toutes les sessions'))),
    migrationPanel(current.migration),
    h('section', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, 'Occupation du stockage'),
      h('div', { class: 'stat-grid' },
        Object.entries(current.storage?.sizes || {}).map(([file, size]) => statCard(
          file, `${Math.round(size / 1024)} Ko`,
          size > 40 * 1024 * 1024 ? 'migration PostgreSQL requise' : 'JSON atomique',
          size > 40 * 1024 * 1024 ? 'warn' : '')),
        statCard('Total', `${((current.storage?.sizeTotal || 0) / 1024 / 1024).toFixed(1)} Mo`, 'toutes données'))));
}

export { renderBackups };
