// public/js/views/admin/signalements.js · file des signalements et seuil de retrait.
// Une chaîne signalée 1000 fois est supprimée automatiquement au moment du signalement.
// En dessous du seuil, rien n'est retiré : c'est le propriétaire qui décide, ligne par ligne.

import { Admin } from '../../api.js?v=3.18.0';
import { h, icon, toast, emptyState, fmtNumber, fmtRelative } from '../../ui.js?v=3.18.0';
import { statCard } from '../../components.js?v=3.18.0';
import { apiGuard, confirmModal } from './common.js?v=3.18.0';

const STATUS_LABEL = { nouveau: 'En attente', confirme: 'Confirmé', rejete: 'Rejeté' };
const STATUS_TONE = { nouveau: 'warn', confirme: 'ok', rejete: '' };

function meter(count, threshold) {
  const ratio = Math.max(0, Math.min(100, Math.round((count / Math.max(1, threshold)) * 100)));
  return h('div', { class: 'report-meter' },
    h('span', { class: 'report-count', text: `${fmtNumber(count)} / ${fmtNumber(threshold)}` }),
    h('span', { class: 'report-bar', role: 'img', 'aria-label': `${count} signalements sur ${threshold}` },
      h('i', { style: { width: `${ratio}%` }, dataset: { tone: ratio >= 100 ? 'danger' : ratio >= 50 ? 'warn' : '' } })));
}

export async function renderSignalements(panel, ctx, state, { stats } = {}) {
  const view = h('div', { class: 'console' });
  panel.replaceChildren(view);
  const kpis = h('div', { class: 'stat-grid' });
  const seuilBox = h('div', { class: 'callout' });
  const tableShell = h('div', { class: 'table-shell' });
  const journalShell = h('div', { class: 'console-block' });

  async function load() {
    tableShell.replaceChildren(h('p', { class: 'muted console-loading' }, 'Chargement des signalements…'));
    try {
      const data = await Admin.reports({ limit: '80' });
      paint(data);
    } catch (error) {
      if (apiGuard(ctx, error, { silent: true })) return;
      tableShell.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: 'La file n’a pas répondu',
        message: error.message || 'Réessayez dans un instant.',
        actionLabel: 'Réessayer',
        onAction: load,
      }));
    }
  }

  async function decide(action, id, nom) {
    try {
      if (action === 'confirm') await Admin.confirmReport(id);
      else await Admin.rejectReport(id, '');
      toast(action === 'confirm' ? `« ${nom} » est masquée.` : `Signalement de « ${nom} » rejeté.`, {
        tone: action === 'confirm' ? 'warn' : 'success',
      });
      stats?.();
      await load();
    } catch (error) {
      apiGuard(ctx, error);
    }
  }

  function paint(data) {
    kpis.replaceChildren(
      statCard('Signalements', fmtNumber(data.signalements), `${data.total} chaîne${data.total > 1 ? 's' : ''} concernée${data.total > 1 ? 's' : ''}`, ''),
      statCard('En attente', fmtNumber(data.enAttente), 'à trancher', data.enAttente ? 'warn' : ''),
      statCard('Confirmés', fmtNumber(data.confirmes), 'chaînes masquées', ''),
      statCard('Rejetés', fmtNumber(data.rejetes), 'chaînes maintenues', ''),
      statCard('Au seuil', fmtNumber(data.auSeuil), 'suppression automatique', data.auSeuil ? 'danger' : ''));

    seuilBox.replaceChildren(
      icon('shield', 20),
      h('div', {},
        h('p', { class: 'callout-title' }, `Retrait automatique à ${fmtNumber(data.seuil)} signalements`),
        h('p', { class: 'muted' },
          'Au signalement qui atteint le seuil, la chaîne est supprimée du catalogue sans intervention. '
          + 'La suppression reste réversible depuis l’onglet Catalogue, et chaque décision est journalisée. '
          + 'Un même visiteur ne compte qu’une fois par jour et par chaîne, et le formulaire accepte cinq envois par heure.')),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', onClick: load,
      }, icon('retry', 14), 'Rafraîchir'));

    if (!data.channels.length) {
      tableShell.replaceChildren(emptyState({
        title: 'Aucune chaîne signalée',
        message: 'Le formulaire public est disponible à l’adresse /signaler. Chaque signalement apparaîtra ici.',
        actionLabel: 'Ouvrir le formulaire',
        onAction: () => ctx.navigate('/signaler'),
      }));
      journalShell.replaceChildren();
      return;
    }

    const head = h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Chaîne'),
      h('th', { scope: 'col' }, 'Signalements'),
      h('th', { scope: 'col' }, 'État'),
      h('th', { scope: 'col' }, 'Dernier'),
      h('th', { scope: 'col' }, 'Décision')));

    const rows = data.channels.map((row) => {
      const nom = row.name;
      const decision = h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button', disabled: row.deleted ? 'disabled' : null,
          'aria-label': `Masquer ${nom} après vérification`,
          onClick: () => confirmModal({
            title: 'Masquer la chaîne',
            message: `« ${nom} » sera masquée du site public. La fiche reste dans le catalogue et peut être rétablie.`,
            confirmLabel: 'Masquer la chaîne',
            onConfirm: async () => {
              const dernier = data.reports.find((report) => report.channelId === row.channelId && report.status === 'nouveau');
              if (dernier) await decide('confirm', dernier.ref, nom);
              else {
                try { await Admin.update(row.channelId, { visible: false, blockedReason: 'retrait-signalement' }); toast(`« ${nom} » est masquée.`, { tone: 'warn' }); await load(); } catch (error) { apiGuard(ctx, error); }
              }
            },
          }),
        }, icon('close', 14), 'Masquer'),
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button', disabled: row.deleted ? 'disabled' : null,
          'aria-label': `Remettre à zéro les signalements de ${nom}`,
          onClick: () => confirmModal({
            title: 'Remettre le compteur à zéro',
            message: `Les ${fmtNumber(row.count)} signalements de « ${nom} » seront effacés. La chaîne n’est pas modifiée.`,
            confirmLabel: 'Remettre à zéro',
            danger: false,
            onConfirm: async () => {
              try {
                await Admin.resetReports(row.channelId);
                toast(`Compteur de « ${nom} » remis à zéro.`, { tone: 'success' });
                await load();
              } catch (error) { apiGuard(ctx, error); }
            },
          }),
        }, icon('retry', 14), 'Zéro'),
        h('a', { class: 'btn btn-quiet btn-sm', href: `/chaine/${row.channelId}`, 'data-link': '' }, icon('tv', 14), 'Fiche'));

      return h('tr', {},
        h('td', {},
          h('p', { class: 'link-name', text: nom }),
          h('p', { class: 'link-meta', text: row.number ? `Chaîne n° ${row.number}` : 'numéro inconnu' }),
          row.deleted ? h('span', { class: 'badge', dataset: { tone: 'danger' } }, 'Supprimée') : null),
        h('td', {}, meter(row.count, data.seuil),
          row.seuilAtteint ? h('p', { class: 'link-meta' }, 'seuil atteint') : null),
        h('td', {}, h('span', { class: 'badge', dataset: { tone: STATUS_TONE[row.status] || '' } }, STATUS_LABEL[row.status] || row.status)),
        h('td', {}, h('span', { class: 'link-meta', text: row.lastAt ? fmtRelative(row.lastAt) : 'jamais' })),
        h('td', {}, decision));
    });

    tableShell.replaceChildren(h('table', { class: 'data-table' }, head, h('tbody', {}, rows)));

    const entries = data.reports.slice(0, 40).map((report) => h('article', { class: 'journal-entry' },
      h('div', { class: 'journal-head' },
        h('code', { class: 'mono', text: report.ref }),
        h('span', { class: 'badge', dataset: { tone: STATUS_TONE[report.status] || '' } }, STATUS_LABEL[report.status] || report.status),
        h('span', { class: 'link-meta', text: fmtRelative(report.at) })),
      h('p', { class: 'journal-title', text: `${report.channelName} · ${report.reasonLabel}` }),
      report.message ? h('p', { class: 'journal-body', text: report.message }) : null,
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button', disabled: report.status !== 'nouveau' ? 'disabled' : null,
          onClick: () => decide('confirm', report.ref, report.channelName),
        }, icon('check', 14), 'Confirmer'),
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button', disabled: report.status !== 'nouveau' ? 'disabled' : null,
          onClick: () => decide('reject', report.ref, report.channelName),
        }, icon('close', 14), 'Rejeter'))));

    journalShell.replaceChildren(
      h('h3', {}, 'Derniers signalements'),
      h('p', { class: 'muted' }, 'Chaque ligne porte une référence. La même référence est visible par le visiteur qui l’a envoyée.'),
      entries.length ? h('div', { class: 'journal' }, entries) : h('p', { class: 'muted' }, 'Aucun signalement récent.'));
  }

  view.append(
    h('div', { class: 'console-head' },
      h('div', {},
        h('h2', {}, 'Signalements'),
        h('p', { class: 'muted' }, 'Le site enregistre, vous décidez. Seul le seuil de retrait automatique agit sans vous.'))),
    kpis,
    seuilBox,
    tableShell,
    journalShell);

  await load();
}
