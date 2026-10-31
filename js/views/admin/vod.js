// public/js/views/admin/vod.js · onglets Anime et Films de la console (3.18.0).
// Quatre constats chiffrés, une liste par source, et les derniers ajouts. Chaque fiche
// peut être publiée, retirée ou corrigée ; une fiche sans licence reste impossible à publier.

import { Admin } from '../../api.js?v=3.20.0';
import { COPY } from '../../copy.js?v=3.20.0';
import { h, icon, fmtNumber, fmtRelative, spinner, emptyState, toast } from '../../ui.js?v=3.20.0';
import { statCard } from '../../components.js?v=3.20.0';
import { apiGuard } from './common.js?v=3.20.0';
import { docLink } from './doc.js?v=3.20.0';

const TEXTES = {
  anime: {
    titre: 'Catalogue Anime',
    eyebrow: 'Animation',
    doc: 'onglet-anime',
    sansContenu: 'Sans épisode',
    url: '/anime',
  },
  film: {
    titre: 'Catalogue Films',
    eyebrow: 'Cinéma',
    doc: 'onglet-films',
    sansContenu: 'Sans source lisible',
    url: '/films',
  },
};

function liste(items, { vide, action = null }) {
  if (!items.length) return h('p', { class: 'muted', text: vide });
  return h('div', { class: 'rows' }, items.slice(0, 24).map((item) => h('div', { class: 'variant' },
    h('span', { dir: 'auto' }, item.title),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted', text: item.sourceId }),
    action ? action(item) : null)));
}

export async function renderVodAdmin(panel, ctx, kind) {
  const textes = TEXTES[kind] || TEXTES.anime;
  panel.replaceChildren(spinner('Chargement du catalogue…'));

  const charger = () => (kind === 'anime' ? Admin.adminAnime() : Admin.adminFilms());
  let data = null;
  try {
    data = await charger();
  } catch (error) {
    if (apiGuard(ctx, error, { silent: true })) return;
    panel.replaceChildren(emptyState({
      iconName: 'wifiOff',
      title: 'Cet onglet n’a pas répondu',
      message: error.message || 'Réessayez dans un instant.',
      actionLabel: COPY.actions.retry,
      onAction: () => renderVodAdmin(panel, ctx, kind),
    }));
    return;
  }

  const reload = () => renderVodAdmin(panel, ctx, kind);

  const basculer = async (item) => {
    try {
      const patch = { visible: !(item.visible !== false) };
      const result = kind === 'anime'
        ? await Admin.updateAnime(item.id, patch)
        : await Admin.updateFilm(item.id, patch);
      toast(result.message || 'Fiche mise à jour.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      toast(error.message || 'La modification n’a pas abouti.', { tone: 'error', duration: 7000 });
    }
  };

  const restaurer = async (item) => {
    try {
      const result = await Admin.restoreVod(kind, item.id);
      toast(result.message || 'Fiche remise en catalogue.', { tone: 'success' });
      await reload();
    } catch (error) {
      if (apiGuard(ctx, error)) return;
      toast(error.message || 'La remise en catalogue a échoué.', { tone: 'error', duration: 7000 });
    }
  };

  const derniers = h('div', { class: 'rows' },
    data.derniersAjouts.length
      ? data.derniersAjouts.map((item) => h('div', { class: 'variant' },
        h('span', { class: 'badge', dataset: { tone: item.visible ? 'ok' : 'warn' } }, item.visible ? 'Publiée' : 'Retirée'),
        h('span', { dir: 'auto', text: item.title }),
        h('span', { class: 'muted' },
          `${item.year || 'année inconnue'} · ${item.language || 'langue inconnue'} · ${item.licence || 'licence absente'}`),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted', text: item.sourceNom || item.sourceId }),
        h('span', { class: 'muted', text: fmtRelative(item.createdAt) }),
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button',
          onClick: () => basculer(item),
        }, icon(item.visible ? 'lock' : 'check', 13), item.visible ? 'Retirer' : 'Publier'),
        item.deleted
          ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => restaurer(item) }, 'Remettre en catalogue')
          : null))
      : h('p', { class: 'muted' }, 'Aucun ajout enregistré pour l’instant.'));

  panel.replaceChildren(
    h('div', { class: 'console-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, textes.eyebrow),
        h('h2', {}, textes.titre),
        h('p', { class: 'muted' },
          'Compteurs par source, contenus incomplets, licences absentes et derniers ajouts. Le contenu publié se règle fiche par fiche.')),
      h('div', { class: 'console-actions' },
        h('a', { class: 'btn btn-ghost btn-sm', href: textes.url, 'data-link': '' }, icon('external', 14), 'Voir la page publique'),
        docLink(textes.doc))),

    h('div', { class: 'stat-grid' },
      statCard('Fiches', fmtNumber(data.total), `${fmtNumber(data.publicCount)} publiées`),
      statCard('Sans affiche', fmtNumber(data.sansAffiche.count), 'le gabarit affiche une vignette typographique',
        data.sansAffiche.count ? 'warn' : ''),
      statCard(textes.sansContenu, fmtNumber(data.sansEpisode.count), 'invisible côté public',
        data.sansEpisode.count ? 'danger' : ''),
      statCard('Sans licence', fmtNumber(data.sansLicence.count), 'bloquées à la publication',
        data.sansLicence.count ? 'danger' : 'ok')),

    h('div', { class: 'console-grid' },
      h('div', { class: 'console-block' },
        h('h3', {}, 'Par source'),
        data.parSource.length
          ? h('div', { class: 'rows' }, data.parSource.map((row) => h('div', { class: 'variant' },
            h('span', { dir: 'auto' }, row.nom),
            h('span', { class: 'spacer' }),
            h('span', { class: 'badge tabular' }, `${fmtNumber(row.count)} fiche${row.count > 1 ? 's' : ''}`))))
          : h('p', { class: 'muted' }, 'Aucune source ne déclare ce contenu.')),
      h('div', { class: 'console-block' },
        h('h3', {}, textes.sansContenu),
        liste(data.sansEpisode.items, { vide: 'Toutes les fiches ont un contenu lisible.' }))),

    h('div', { class: 'console-grid' },
      h('div', { class: 'console-block' },
        h('h3', {}, 'Sans licence'),
        liste(data.sansLicence.items, { vide: 'Toutes les fiches portent une licence identifiée.' })),
      h('div', { class: 'console-block' },
        h('h3', {}, 'Sans affiche'),
        liste(data.sansAffiche.items, { vide: 'Toutes les fiches ont une affiche.' }))),

    h('section', { class: 'console-block' },
      h('h3', {}, 'Derniers ajouts'),
      derniers),

    h('p', { class: 'muted', style: { fontSize: '12px' } },
      'Une fiche sans licence ne peut pas être publiée : le serveur refuse, même si le bouton est forcé.'));
}
