// public/js/views/admin/pilotage.js · onglet Pilotage (3.9.0).
// Trois blocs : la conclusion de l'agent, ce qui est réellement regardé, ce qui a été fait.
// Aucune décoration : une couleur d'état, une bordure, des chiffres tabulaires.

import { Admin } from '../../api.js?v=3.22.0';
import { h, icon, fmtNumber, spinner, emptyState, toast } from '../../ui.js?v=3.22.0';
import { statCard } from '../../components.js?v=3.22.0';

const SEVERITE = {
  critique: { label: 'Critique', tone: 'danger', icon: 'alert' },
  avertissement: { label: 'À surveiller', tone: 'warn', icon: 'wifiOff' },
  info: { label: 'Pour information', tone: '', icon: 'news' },
};

const ACTION_LABEL = {
  'login.success': 'Connexion', 'login.fail': 'Connexion refusée',
  'channel.update': 'Chaîne modifiée', 'channel.create': 'Chaîne ajoutée',
  'channel.delete': 'Chaîne supprimée', 'channel.restore': 'Chaîne restaurée',
  'channel.bulk': 'Action groupée', 'settings.update': 'Réglages modifiés',
  'team.create': 'Compte créé', 'team.update': 'Compte modifié', 'team.delete': 'Compte supprimé',
  'report.create': 'Signalement reçu', 'backup.create': 'Sauvegarde', 'import.commit': 'Importation',
};

/** Barres d'usage : hauteur proportionnelle, aucune couleur par série. */
function sparkline(points) {
  if (!points.length) return h('p', { class: 'muted' }, 'Pas encore de lecture enregistrée sur la période.');
  const max = Math.max(...points.map((point) => point.count), 1);
  return h('div', { class: 'spark', role: 'img', 'aria-label': `Activité sur ${points.length} heures, maximum ${max} lectures par heure` },
    points.slice(-48).map((point) => h('span', {
      class: 'spark-bar',
      style: { height: `${Math.max(4, Math.round((point.count / max) * 100))}%` },
      title: `${point.hour.slice(11)} h · ${point.count} lecture${point.count > 1 ? 's' : ''}`,
    })));
}

export async function renderPilotage(panel, ctx) {
  panel.replaceChildren(spinner('Analyse du site…'));
  let diagnostic = null;
  let analytics = null;
  let journal = null;
  try {
    [diagnostic, analytics, journal] = await Promise.all([
      Admin.diagnostic(),
      Admin.analytics(168).catch(() => null),
      Admin.audit(40).catch(() => ({ entries: [] })),
    ]);
  } catch (error) {
    panel.replaceChildren(emptyState({
      iconName: 'wifiOff',
      title: 'Le pilotage n’a pas répondu',
      message: error.message || 'Réessayez dans un instant.',
      actionLabel: 'Réessayer',
      onAction: () => renderPilotage(panel, ctx),
    }));
    return;
  }

  const chiffres = diagnostic.chiffres;
  const kpis = h('div', { class: 'stat-grid' },
    statCard('Note du site', `${diagnostic.score}/100`, diagnostic.verdict.split('.')[0], diagnostic.score >= 85 ? 'ok' : diagnostic.score >= 60 ? 'warn' : 'danger'),
    statCard('Chaînes publiées', fmtNumber(chiffres.visibles), `${fmtNumber(chiffres.total)} au total`),
    statCard('En panne', fmtNumber(chiffres.down), `${fmtNumber(chiffres.bloquees)} bloquées`),
    statCard('Jamais mesurées', fmtNumber(chiffres.inconnues), 'sonde à lancer', chiffres.inconnues > chiffres.total / 2 ? 'warn' : ''),
    statCard('Sans guide', fmtNumber(chiffres.sansGuide), 'aucun programme affichable'),
    statCard('Lectures (7 j)', fmtNumber(analytics?.totalFenetre || 0), `${fmtNumber(analytics?.totalGeneral || 0)} depuis l’origine`));

  const constats = h('div', { class: 'agent-list' },
    diagnostic.constats.length
      ? diagnostic.constats.map((constat) => {
        const sev = SEVERITE[constat.severite] || SEVERITE.info;
        return h('article', { class: 'agent-item', dataset: { severite: constat.severite } },
          h('span', { class: 'agent-badge' }, icon(sev.icon, 13), sev.label),
          h('div', { class: 'agent-body' },
            h('h3', {}, constat.titre),
            h('p', { class: 'muted' }, constat.detail),
            h('p', { class: 'agent-action' }, icon('chevron', 13), constat.action)),
          constat.lien ? h('a', { class: 'btn btn-ghost btn-sm', href: constat.lien, 'data-link': '' }, 'Traiter') : null);
      })
      : h('p', { class: 'muted' }, 'Aucun défaut détecté. Le site est prêt pour le public.'));

  const top = h('div', { class: 'rows' },
    analytics?.parChaine?.length
      ? analytics.parChaine.slice(0, 10).map((item, index) => h('div', { class: 'variant' },
        h('span', { class: 'tabular muted', text: String(index + 1).padStart(2, '0') }),
        h('span', { dir: 'auto', text: item.name }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'badge tabular' }, `${fmtNumber(item.count)} lecture${item.count > 1 ? 's' : ''}`)))
      : h('p', { class: 'muted' }, analytics?.exemple || 'Aucune lecture enregistrée pour le moment.'));

  // Journal lisible : une phrase par ligne, l'heure, l'auteur. Aucun code technique affiché
  // quand le serveur sait la traduire ; sinon il reste tel quel, sans jargon ajouté.
  const activite = h('div', { class: 'journal' },
    journal.entries.length
      ? journal.entries.slice(0, 14).map((entry) => h('div', { class: 'journal-row', dataset: { ton: entry.ton || 'info' } },
        h('span', { class: 'journal-heure tabular', text: String(entry.at || '').slice(11, 16) }),
        h('span', { class: 'journal-phrase', dir: 'auto', text: entry.phrase || ACTION_LABEL[entry.action] || entry.action }),
        h('span', { class: 'journal-acteur muted', text: entry.actor || 'admin' })))
      : h('p', { class: 'muted' }, 'Le journal est vide : la première action apparaîtra ici.'));

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Agent de contrôle'),
        h('h2', {}, 'Pilotage du site'),
        h('p', { class: 'muted' }, 'L’agent lit l’état réel du catalogue, hiérarchise ce qui gêne les visiteurs et propose l’action attendue. Il ne modifie rien.')),
      h('div', { class: 'console-actions' },
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onClick: () => renderPilotage(panel, ctx),
        }, icon('retry', 14), 'Relancer l’analyse'),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onClick: async () => {
            try {
              const rapport = [
                `StreamTV · note ${diagnostic.score}/100`,
                diagnostic.verdict,
                '',
                ...diagnostic.constats.map((item) => `[${item.severite}] ${item.titre} : ${item.detail} → ${item.action}`),
                '',
                `Lectures 7 jours : ${analytics?.totalFenetre || 0}`,
                `Top : ${(analytics?.parChaine || []).slice(0, 5).map((item) => `${item.name} (${item.count})`).join(', ') || 'aucune'}`,
              ].join('\n');
              await navigator.clipboard.writeText(rapport);
              toast('Rapport copié : collez-le dans un message ou un document.', { tone: 'success' });
            } catch {
              toast('Copie impossible sur ce navigateur.', { tone: 'error' });
            }
          },
        }, icon('copy', 14), 'Copier le rapport'))),
    kpis,
    h('div', { class: 'console-block' },
      h('h3', {}, `Conclusion de l’agent · ${diagnostic.constats.length} constat${diagnostic.constats.length > 1 ? 's' : ''}`),
      constats),
    h('div', { class: 'console-grid' },
      h('div', { class: 'console-block' },
        h('h3', {}, 'Ce qui est regardé'),
        sparkline(analytics?.parHeure || []),
        top),
      h('div', { class: 'console-block' },
        h('div', { class: 'block-head' },
          h('h3', {}, 'Dernières actions'),
          h('span', { class: 'muted', text: 'en clair' })),
        activite)),
    h('p', { class: 'muted', style: { fontSize: '12px' } },
      `Analyse du ${new Date(diagnostic.genereLe).toLocaleString('fr-FR')} · les compteurs de lecture sont anonymes : un identifiant de chaîne, aucune adresse.`));
}
