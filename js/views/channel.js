// public/js/views/channel.js · écran 4 : fiche d'une chaîne (détail, variantes, chaînes proches).

import { api } from '../api.js?v=3.18.1';
import { COPY } from '../copy.js?v=3.18.1';
import {
  h, icon, fmtNumber, fmtRelative, spinner, emptyState, logoNode, healthBadge, toast, copyText,
  countryName, languageName,
} from '../ui.js?v=3.18.1';
import { channelCard, paintNow } from '../components.js?v=3.18.1';
import { heureCourte, primeNow } from '../epg-now.js?v=3.18.1';
import { getPlayer } from '../player.js?v=3.18.1';
import { prefs } from '../prefs.js?v=3.18.1';

const BLOCK_COPY = {
  'mixed-content': {
    title: 'Chaîne non lisible sur ce site',
    text: 'Cette chaîne est diffusée en HTTP non sécurisé, que le navigateur bloque sur un site HTTPS.',
    hint: 'La fiche reste consultable et le lien copiable pour un lecteur externe.',
  },
  'ua-required': {
    title: 'Chaîne protégée',
    text: 'Ce flux exige un identifiant technique que le navigateur ne peut pas fournir.',
    hint: 'Utilisez un lecteur externe compatible, ou choisissez une autre variante.',
  },
  geo: {
    title: 'Non disponible dans votre région',
    text: 'La source réserve cette chaîne à un autre pays.',
    hint: 'Les chaînes proches restent accessibles.',
  },
  dead: {
    title: 'Signal indisponible',
    text: 'Le flux ne répond pas. Il a peut-être changé d’adresse.',
    hint: 'Signalez-le : la source sera corrigée sous 72 heures ouvrées.',
  },
  manual: {
    title: 'Lecture désactivée',
    text: 'Cette chaîne a été retirée de la lecture par le propriétaire du catalogue.',
    hint: 'Elle reste visible pour l’administration.',
  },
  license: {
    title: 'Diffusion suspendue',
    text: 'La justification des droits est absente ou retirée à la demande d’un tiers.',
    hint: 'La chaîne sera réévaluée après vérification.',
  },
  adult: {
    title: 'Catégorie adulte',
    text: 'Cette chaîne est masquée par défaut.',
    hint: 'Elle peut être affichée depuis les réglages de l’administration.',
  },
  'empty-url': {
    title: 'Lien manquant',
    text: 'Cette chaîne n’a pas encore d’adresse de flux.',
    hint: 'Un administrateur peut l’ajouter depuis la console.',
  },
};

function metaItem(label, value) {
  if (!value) return null;
  return h('div', { class: 'meta-item' }, h('span', { class: 'meta-label' }, label), h('span', { class: 'meta-value' }, String(value)));
}

export async function renderChannel(container, ctx, id) {
  const { navigate, config } = ctx;
  container.replaceChildren(spinner('Chargement de la chaîne…'));
  let payload;
  try {
    payload = await api(`/api/channels/${encodeURIComponent(id)}`);
  } catch (error) {
    container.replaceChildren(emptyState({
      iconName: error.status === 404 ? 'search' : 'wifiOff',
      title: error.status === 404 ? 'Cette chaîne n’existe plus' : COPY.states.error.title,
      message: error.status === 404
        ? 'Le lien est peut-être ancien. Le catalogue, lui, fonctionne toujours.'
        : error.message,
      actionLabel: COPY.actions.backHome,
      onAction: () => navigate('/'),
    }));
    return () => {};
  }

  const channel = payload.channel;
  const { related } = payload;
  const view = h('div', { class: 'view' });
  const isFavorite = prefs.isFavorite(channel.id);

  const favoriteBtn = h('button', {
    class: 'btn btn-ghost fav-btn', type: 'button', 'aria-pressed': String(isFavorite),
    onClick: () => {
      const nowFavorite = prefs.toggleFavorite(channel);
      favoriteBtn.setAttribute('aria-pressed', String(nowFavorite));
      favoriteBtn.replaceChildren(
        icon('heart', 16),
        nowFavorite ? COPY.actions.removeFavorite : COPY.actions.addFavorite,
      );
      toast(nowFavorite ? 'Ajoutée à vos favoris sur cet appareil.' : 'Retirée de vos favoris.', { tone: 'info', duration: 3000 });
    },
  }, icon('heart', 16), isFavorite ? COPY.actions.removeFavorite : COPY.actions.addFavorite);

  const playButton = h('button', {
    class: 'btn btn-primary', type: 'button',
    onClick: () => {
      if (!channel.playable) {
        const info = BLOCK_COPY[channel.blockedReason] || BLOCK_COPY.dead;
        toast(info.text, { tone: 'error', duration: 6000 });
        return;
      }
      prefs.pushHistory(channel);
      getPlayer().open(channel, { queue: [channel.id] });
    },
  }, icon('play', 16), channel.playable ? COPY.actions.watch : 'Lecture indisponible');

  const copyBtn = h('button', {
    class: 'btn btn-ghost', type: 'button',
    onClick: async () => {
      const done = await copyText(channel.url);
      toast(done ? COPY.actions.copied : 'Le lien n’a pas pu être copié. Sélectionnez-le à la main.', { tone: done ? 'success' : 'error' });
    },
  }, icon('copy', 16), COPY.actions.copy);

  // Bandeau de programme : ce qui passe, ce qui suit. Rempli après coup, jamais bloquant.
  const programmeStrip = h('div', { class: 'feature-now', 'aria-live': 'polite' },
    h('p', { class: 'feature-now-head' },
      h('span', { class: 'feature-live' }, h('i', { 'aria-hidden': 'true' }), 'En direct'),
      h('span', { class: 'feature-now-hours' }, '…')),
    h('p', { class: 'feature-now-title' }, 'Programme en cours'),
    h('div', { class: 'feature-next' }));

  const peindreProgramme = (grille) => {
    const programmes = grille?.programmes || [];
    const direct = programmes.find((item) => item.live);
    if (!direct) {
      programmeStrip.dataset.state = 'empty';
      programmeStrip.querySelector('.feature-now-title').textContent = 'Programme non communiqué par la chaîne.';
      programmeStrip.querySelector('.feature-now-hours').textContent = '';
      programmeStrip.querySelector('.feature-live')?.remove();
      return;
    }
    programmeStrip.dataset.state = 'live';
    programmeStrip.querySelector('.feature-now-title').textContent = direct.title;
    programmeStrip.querySelector('.feature-now-hours').textContent = `${heureCourte(direct.start)} – ${heureCourte(direct.stop)}`;
    const suite = programmeStrip.querySelector('.feature-next');
    const suivants = programmes.filter((item) => !item.live && Date.parse(item.start) > Date.now()).slice(0, 3);
    if (!suivants.length) {
      suite.append(h('p', { class: 'muted feature-next-empty' }, 'Le guide ne donne pas la suite.'));
      return;
    }
    suite.replaceChildren(
      h('p', { class: 'feature-next-label' }, 'À suivre'),
      ...suivants.map((item) => h('div', { class: 'feature-next-row' },
        h('span', { class: 'feature-next-hours tabular' }, heureCourte(item.start)),
        h('span', { class: 'feature-next-title', dir: 'auto' }, item.title))));
  };

  api(`/api/epg?ids=${encodeURIComponent(channel.id)}&hours=8`)
    .then((grille) => {
      const ligne = (grille?.grid || []).find((item) => item.id === channel.id);
      peindreProgramme(ligne);
    })
    .catch(() => { programmeStrip.dataset.state = 'off'; });

  const hero = h('section', { class: 'detail' },
    h('div', { class: 'detail-hero' },
      h('div', { class: 'detail-logo' }, logoNode(channel, 96)),
      h('div', { style: { flex: '1 1 280px', minWidth: 0 } },
        h('p', { class: 'eyebrow' }, `${channel.categoryLabel} · chaîne ${channel.number}`),
        h('h1', { dir: 'auto', style: { fontSize: 'clamp(26px,4vw,40px)' } }, channel.name),
        h('div', { class: 'chips', style: { marginTop: '10px' } },
          h('span', { class: 'badge', dataset: { tone: 'accent' } }, channel.categoryLabel),
          channel.quality !== 'AUTO' ? h('span', { class: 'badge' }, channel.quality) : null,
          channel.country ? h('span', { class: 'badge' }, countryName(channel.country)) : null,
          channel.language ? h('span', { class: 'badge' }, languageName(channel.language)) : null,
          healthBadge(channel.health),
          channel.featured ? h('span', { class: 'badge', dataset: { tone: 'warn' } }, 'En vedette') : null),
        h('div', { class: 'hero-actions', style: { marginTop: '18px' } }, playButton, favoriteBtn, copyBtn),
        programmeStrip),
    ),
    channel.blocked ? (() => {
      const info = BLOCK_COPY[channel.blockedReason] || BLOCK_COPY.dead;
      return h('div', { class: 'banner', dataset: { tone: 'warn' }, style: { marginTop: '18px' } },
        icon('alert', 16),
        h('div', {},
          h('p', { style: { fontWeight: '600' } }, info.title),
          h('p', { class: 'muted', style: { fontSize: '13px' } }, info.text),
          h('p', { class: 'muted', style: { fontSize: '13px' } }, info.hint)));
    })() : null,
    h('details', { class: 'tech' },
      h('summary', {}, 'Informations techniques de la chaîne'),
      h('div', { class: 'meta-grid' },
      metaItem('Numéro', channel.number),
      metaItem('Qualité', channel.quality === 'AUTO' ? 'Automatique' : channel.quality),
      metaItem('Pays', channel.country ? countryName(channel.country) : 'Non précisé'),
      metaItem('Langue', channel.language ? languageName(channel.language) : 'Non précisée'),
      metaItem('Groupe d’origine', channel.group || 'Non renseigné'),
      metaItem('Identifiant EPG', channel.epgId || 'Non renseigné'),
      metaItem('Source', channel.sourceId || 'Non renseigné'),
      metaItem('Ajoutée', fmtRelative(channel.lastSeenInSourceAt)),
      metaItem('Classement', `${Math.round((channel.confidence || 0) * 100)} % de confiance · ${channel.categorySource}`),
      metaItem('Droits', channel.licenseNote || 'Non renseigné'))),
    h('div', { class: 'panel', style: { marginTop: '18px' } },
      h('h2', { style: { fontSize: '16px', marginBottom: '10px' } }, 'Adresse du flux'),
      h('div', { class: 'url-box' },
        h('code', { dir: 'ltr', text: channel.url || 'Non renseigné' }),
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button',
          onClick: async () => { const done = await copyText(channel.url); toast(done ? COPY.actions.copied : 'Copie impossible.', { tone: done ? 'success' : 'error' }); },
        }, icon('copy', 14))),
      h('p', { class: 'muted', style: { marginTop: '8px', fontSize: '12px' } },
        'Cette adresse n’est pas retransmise par StreamTV : elle est lue directement chez la source.')),

    payload.variants?.length ? h('section', { style: { marginTop: '24px' } },
      h('div', { class: 'section-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Autres flux'), h('h2', {}, 'Variantes disponibles'))),
      h('div', { class: 'rows' }, payload.variants.map((variant) => h('div', { class: 'variant' },
        h('span', { dir: 'auto', text: variant.name }),
        h('span', { class: 'badge' }, variant.quality),
        h('span', { class: 'health-dot', dataset: { state: variant.health }, 'aria-hidden': 'true' }),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onClick: () => {
            prefs.pushHistory(channel);
            getPlayer().open({ ...channel, id: variant.id, name: `${channel.name} · ${variant.quality}`, url: variant.url, quality: variant.quality, blocked: false });
          },
        }, icon('play', 14), COPY.actions.watch))))) : null,

    payload.alternatives?.length ? h('section', { style: { marginTop: '24px' } },
      h('div', { class: 'section-head' }, h('div', {},
        h('p', { class: 'eyebrow' }, 'Recherche multi-sources'),
        h('h2', {}, 'Autres sources de la même chaîne'))),
      h('p', { class: 'muted', style: { fontSize: '13px' } },
        'Retrouvée dans une autre source ingérée, par identifiant de guide ou par nom normalisé. Si le flux principal ne répond pas, le lecteur l’essaie automatiquement.'),
      h('div', { class: 'rows' }, payload.alternatives.map((alt) => h('div', { class: 'variant' },
        h('span', { dir: 'auto', text: alt.name }),
        h('span', { class: 'badge' }, alt.match === 'tvg-id' ? 'Même identifiant' : 'Même nom'),
        h('span', { class: 'badge' }, alt.quality),
        alt.blockedReason ? h('span', { class: 'badge', dataset: { tone: 'warn' } }, 'Lecture limitée') : null,
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', disabled: Boolean(alt.blockedReason),
          onClick: () => {
            prefs.pushHistory(channel);
            getPlayer().open({ ...channel, url: alt.url, quality: alt.quality, blocked: false, alternatives: [] });
          },
        }, icon('play', 14), COPY.actions.watch))))) : null,

    related?.length ? h('section', { style: { marginTop: '32px' } },
      h('div', { class: 'section-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Dans la même catégorie'), h('h2', {}, `Autres chaînes · ${channel.categoryLabel}`)),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/?cat=${encodeURIComponent(channel.category)}`, 'data-link': '' }, 'Tout voir')),
      h('div', { class: 'grid' }, related.map((item) => {
        const card = channelCard(item, {
          showHealth: config.showHealthBadge,
          onOpen: () => navigate(`/chaine/${item.id}`),
          onPlay: (target) => { prefs.pushHistory(target); getPlayer().open(target, { queue: related.map((c) => c.id) }); },
        });
        card.dataset.channelId = item.id;
        return card;
      }))) : null,

    h('div', { style: { marginTop: '28px', display: 'flex', gap: '12px', flexWrap: 'wrap' } },
      h('a', { class: 'btn btn-quiet btn-sm', href: '/', 'data-link': '' }, icon('chevron', 14, 'style="transform:rotate(180deg)"'), COPY.actions.backHome),
      h('a', { class: 'btn btn-quiet btn-sm', href: `/signaler?chaine=${encodeURIComponent(channel.name)}`, 'data-link': '' }, icon('alert', 14), 'Signaler cette chaîne'),
      h('span', { class: 'count-label', style: { marginLeft: 'auto' } },
        `Catalogue : ${fmtNumber(config.totals.visible)} chaînes visibles sur ${fmtNumber(config.totals.catalog)}`)));

  view.append(hero);
  container.replaceChildren(view);
  // Les chaînes proches affichent leur programme, comme partout ailleurs.
  primeNow((related || []).map((item) => item.id))
    .then(() => paintNow(view))
    .catch(() => { paintNow(view); });
  return () => {};
}
