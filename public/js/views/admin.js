// public/js/views/admin.js · écran 7 : console d'administration, sept onglets.
// La coquille ne rend que les compteurs et les onglets ; chaque onglet vit dans views/admin/.

import { Admin, auth } from '../api.js?v=3.21.0';
import { COPY } from '../copy.js?v=3.21.0';
import { h, icon, fmtNumber, spinner, emptyState } from '../ui.js?v=3.21.0';
import { statCard } from '../components.js?v=3.21.0';

import { renderCatalogue } from './admin/catalogue.js?v=3.21.0';
import { renderImport } from './admin/import.js?v=3.21.0';
import { renderSettings } from './admin/settings.js?v=3.21.0';
import { renderHealth } from './admin/health.js?v=3.21.0';
import { renderBackups } from './admin/backups.js?v=3.21.0';
import { renderLiens } from './admin/liens.js?v=3.21.0';
import { renderSignalements } from './admin/signalements.js?v=3.21.0';
import { renderPilotage } from './admin/pilotage.js?v=3.21.0';
import { renderEquipe } from './admin/equipe.js?v=3.21.0';
import { renderMembres } from './admin/membres.js?v=3.21.0';
import { renderAppareils } from './admin/appareils.js?v=3.21.0';
import { renderAcces } from './admin/acces.js?v=3.21.0';
import { renderPremierLancement } from './admin/premier-lancement.js?v=3.21.0';
import { renderSources } from './admin/sources.js?v=3.21.0';
import { renderVodAdmin } from './admin/vod.js?v=3.21.0';
import { anchorOf } from '../doc-anchor.js?v=3.21.0';
import { openDocumentation } from './admin/doc.js?v=3.21.0';

/**
 * Onglets de la console, dans l'ordre d'usage. Chaque onglet documenté existe ici, et
 * réciproquement : `tests/documentation.test.js` compare cette liste à docs/ADMINISTRATION.md.
 */
const TABS = [
  ['pilotage', 'Pilotage'],
  ['catalogue', 'Catalogue'],
  ['liens', 'Chaînes et liens'],
  ['anime', 'Anime'],
  ['films', 'Films'],
  ['sources', 'Sources'],
  ['signalements', 'Signalements'],
  ['import', 'Importation'],
  ['reglages', 'Réglages'],
  ['sante', 'Santé'],
  ['sauvegardes', 'Sauvegardes'],
  ['equipe', 'Équipe'],
  ['membres', 'Membres'],
  ['appareils', 'Appareils'],
  ['acces', 'Accès'],
];

export async function renderAdmin(container, ctx) {
  const view = h('div', { class: 'view' });
  container.replaceChildren(view);

  if (!auth.token()) {
    view.append(h('div', { class: 'login-shell' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('lock', 24)),
      h('h1', {}, 'Administration verrouillée'),
      h('p', { class: 'muted' }, 'Connectez-vous pour gérer le catalogue, les réglages et les sauvegardes.'),
      h('a', { class: 'btn btn-primary btn-block', href: `/connexion?next=${encodeURIComponent(location.pathname)}`, 'data-link': '' }, icon('lock', 16), COPY.actions.signIn),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/', 'data-link': '' }, 'Revenir au catalogue')));
    return () => {};
  }

  // Premier lancement : un nom et un mot de passe à soi avant tout travail.
  // Le passage est proposé une fois par session : la console reste utilisable, mais le
  // rappel demeure dans le pilotage tant que les deux étapes obligatoires ne sont pas faites.
  // État du premier lancement lu une seule fois : il sert au passage obligé et au nom affiché.
  let etatSetup = null;
  try {
    etatSetup = await Admin.setup();
  } catch {
    etatSetup = null;
  }

  const passageIgnore = (() => {
    try { return sessionStorage.getItem('streamtv.setup.ignore') === '1'; } catch { return false; }
  })();
  if (!passageIgnore) {
    const passage = await renderPremierLancement(container, ctx, etatSetup).catch(() => false);
    if (passage) return () => {};
  }

  let stats = null;
  try {
    stats = await Admin.stats();
  } catch (error) {
    if (apiGuard(ctx, error, { silent: true })) return () => {};
    view.replaceChildren(emptyState({
      iconName: 'wifiOff',
      title: 'La console n’a pas répondu',
      message: error.message || 'Réessayez dans un instant.',
      actionLabel: COPY.actions.retry,
      onAction: () => renderAdmin(container, ctx),
    }));
    return () => {};
  }

  const state = {
    tab: TABS.some(([id]) => id === ctx.query.onglet) ? ctx.query.onglet : 'pilotage',
    page: 1,
    q: '',
    category: '',
    visibility: 'all',
    selection: new Set(),
    preview: null,
    probe: null,
  };

  const panel = h('div', { class: 'admin-panel' });
  const tabsBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Onglets de l’administration' });
  const kpis = h('div', { class: 'stat-grid' });

  const refreshStats = async () => {
    try {
      stats = await Admin.stats();
      renderKpis();
    } catch (error) {
      apiGuard(ctx, error, { silent: true });
    }
  };

  const renderKpis = () => {
    kpis.replaceChildren(
      statCard('Chaînes actives', fmtNumber(stats.active), `${fmtNumber(stats.visible)} visibles`, 'ok'),
      statCard('Masquées', fmtNumber(stats.hidden), `${fmtNumber(stats.deleted)} supprimées`, stats.hidden ? 'warn' : ''),
      statCard('Disponibles', fmtNumber(stats.health.up), `${fmtNumber(stats.health.unknown)} non testées`),
      statCard('Confiance', `${Math.round((stats.confidence.average || 0) * 100)} %`, `seuil ${Math.round(stats.confidence.floor * 100)} %`),
      statCard('Moteur', `${fmtNumber(stats.confidence.engine.vitesse)} ch/s`, `accord ${Math.round(stats.confidence.engine.accordGenre * 100)} %`),
      statCard('Mémoire disque', `${(stats.storage.sizeTotal / 1024 / 1024).toFixed(1)} Mo`, 'JSON atomique'));
  };

  // Un lien vers le passage documenté de l'onglet courant : la console et le fichier
  // docs/ADMINISTRATION.md disent la même chose, sans recopie manuelle.
  const docHost = h('div', { class: 'admin-doc' });
  const renderDocLink = () => {
    const label = TABS.find(([id]) => id === state.tab)?.[1] || '';
    // L'ancre se calcule sur le libellé, comme le titre de la section dans le document :
    // « Chaînes et liens » mène à onglet-chaines-et-liens, « Importation » à onglet-importation.
    docHost.replaceChildren(h('button', {
      class: 'doc-link', type: 'button',
      onClick: () => openDocumentation(`onglet-${anchorOf(label)}`).catch(() => {}),
    }, icon('doc', 14), `Documentation : ${label}`));
  };

  const renderTabs = () => {
    renderDocLink();
    tabsBar.replaceChildren(...TABS.map(([id, label]) => h('button', {
      class: 'tab', type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(state.tab === id),
      'aria-controls': 'admin-panel',
      onClick: () => {
        state.tab = id;
        history.replaceState(history.state, '', `${location.pathname.replace(/\/$/, '')}?onglet=${id}`);
        renderTabs();
        renderPanel();
      },
    }, label)));
  };

  const renderPanel = async () => {
    panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
    panel.replaceChildren(spinner('Chargement…'));
    try {
      if (state.tab === 'pilotage') await renderPilotage(panel, ctx);
      else if (state.tab === 'anime') await renderVodAdmin(panel, ctx, 'anime');
      else if (state.tab === 'films') await renderVodAdmin(panel, ctx, 'film');
      else if (state.tab === 'sources') await renderSources(panel, ctx, state, { refreshStats });
      else if (state.tab === 'equipe') await renderEquipe(panel, ctx);
      else if (state.tab === 'membres') await renderMembres(panel, ctx);
      else if (state.tab === 'appareils') await renderAppareils(panel, ctx);
      else if (state.tab === 'acces') await renderAcces(panel, ctx);
      else if (state.tab === 'catalogue') await renderCatalogue(panel, ctx, state, { refreshStats, stats: () => stats });
      else if (state.tab === 'liens') await renderLiens(panel, ctx, state, { stats: () => stats });
      else if (state.tab === 'signalements') await renderSignalements(panel, ctx, state, { stats: () => stats });
      else if (state.tab === 'import') await renderImport(panel, ctx, state, { refreshStats });
      else if (state.tab === 'reglages') await renderSettings(panel, ctx, { refreshStats });
      else if (state.tab === 'sante') await renderHealth(panel, ctx, state, { refreshStats, stats: () => stats });
      else if (state.tab === 'sauvegardes') await renderBackups(panel, ctx, { refreshStats, stats: () => stats });
    } catch (error) {
      if (apiGuard(ctx, error, { silent: true })) return;
      panel.replaceChildren(emptyState({
        iconName: 'wifiOff',
        title: 'Cet onglet n’a pas pu se charger',
        message: error.message || 'Réessayez.',
        actionLabel: COPY.actions.retry,
        onAction: renderPanel,
      }));
    }
  };

  view.append(
    h('div', { class: 'admin-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, etatSetup?.nom ? `Console de ${etatSetup.nom}` : 'Console'),
        h('h1', { style: { fontSize: 'clamp(26px,3.4vw,34px)' } }, 'Administration')),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('span', { class: 'badge', dataset: { tone: stats.sessions ? 'ok' : 'warn' } }, icon('shield', 12), `${stats.sessions} session${stats.sessions > 1 ? 's' : ''}`),
        h('a', { class: 'btn btn-ghost btn-sm', href: '/', 'data-link': '' }, icon('tv', 14), 'Voir le site'))),
    kpis,
    tabsBar,
    docHost,
    panel);

  renderKpis();
  renderTabs();
  await renderPanel();
  return () => {};
}
