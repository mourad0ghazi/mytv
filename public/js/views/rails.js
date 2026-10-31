// public/js/views/rails.js · rails de recommandations de l'accueil.
// Trois sources, aucune donnée envoyée : historique local, favoris, et à défaut
// les catégories les plus fournies du catalogue (repli éditorial identique pour tous).

import { api } from '../api.js?v=3.22.0';
import { h, icon } from '../ui.js?v=3.22.0';
import { channelCard, paintNow } from '../components.js?v=3.22.0';
import { prefs } from '../prefs.js?v=3.22.0';
import { nowCached, primeNow } from '../epg-now.js?v=3.22.0';

const MAX_RAIL = 10;

function railShell({ eyebrow, title, moreHref, moreLabel }) {
  const track = h('div', { class: 'rail-track' });
  const section = h('section', { class: 'rail', 'aria-label': title },
    h('div', { class: 'rail-head' },
      h('div', {},
        eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
        h('h2', { class: 'rail-title', text: title })),
      moreHref ? h('a', { class: 'rail-more', href: moreHref, 'data-link': '' }, moreLabel || 'Tout voir', icon('chevron', 14)) : null),
    track);
  return { section, track };
}

function miniToChannel(item) {
  return {
    id: item.id, number: item.number, name: item.name, logo: item.logo,
    category: item.category, categoryLabel: item.categoryLabel, hue: item.hue,
    health: item.health || 'unknown', blocked: Boolean(item.blocked), quality: item.quality || 'AUTO',
    country: item.country || '', tvgId: '', url: '',
  };
}

/** Affinités : catégories les plus regardées, pondérées par la récence. */
function affinites() {
  const poids = new Map();
  const historique = prefs.history();
  historique.forEach((item, index) => {
    if (!item.category) return;
    poids.set(item.category, (poids.get(item.category) || 0) + Math.max(1, 8 - index));
  });
  for (const favori of prefs.favorites()) {
    if (favori.category) poids.set(favori.category, (poids.get(favori.category) || 0) + 6);
  }
  return [...poids.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
}

function poserCartes(track, chaines, { openChannel, openPlayer }) {
  track.replaceChildren(...chaines.slice(0, MAX_RAIL).map((chaine) => channelCard(chaine, {
    onOpen: (channel) => openChannel(channel.id),
    onPlay: (channel) => openPlayer(channel),
  })));
  // Les rails montrent le programme sans survol, dès que le guide a répondu.
  primeNow(chaines.map((chaine) => chaine.id))
    .then(() => paintNow(track))
    .catch(() => { /* guide muet : la ligne reste « non communiqué » */ });
}

/**
 * Monte les rails disponibles. Chaque rail disparaît s'il n'a rien à montrer :
 * un appareil neuf ne voit jamais de bloc vide.
 */
export async function mountRails(host, { config, openChannel, openPlayer, navigate }) {
  const rails = [];

  const historique = prefs.history().slice(0, MAX_RAIL);
  if (historique.length) {
    const { section, track } = railShell({
      eyebrow: 'Reprendre', title: 'Continuer à regarder', moreHref: '/favoris', moreLabel: 'Mon historique',
    });
    poserCartes(track, historique.map(miniToChannel), { openChannel, openPlayer });
    rails.push(section);
  }

  const affinite = affinites();
  const categories = affinite.length
    ? affinite.slice(0, 2)
    : [...(config.categories || [])].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 1).map((c) => c.id);

  if (categories.length) {
    const vus = new Set(prefs.history().map((item) => item.id));
    try {
      const lots = await Promise.all(categories.map((cat) => api(`/api/channels?cat=${encodeURIComponent(cat)}&pageSize=12&sort=confidence`)
        .then((payload) => payload.channels || [])
        .catch(() => [])));
      const melange = [];
      const pris = new Set();
      // Alternance des catégories : le rail ne ressemble pas à une liste d'un seul genre.
      for (let i = 0; i < 12; i += 1) {
        for (const lot of lots) {
          const candidat = lot[i];
          if (!candidat || pris.has(candidat.id) || vus.has(candidat.id)) continue;
          pris.add(candidat.id);
          melange.push(candidat);
        }
      }
      if (melange.length) {
        const { section, track } = railShell({
          eyebrow: affinite.length ? 'D’après vos habitudes' : 'À découvrir',
          title: 'Pour vous',
          moreHref: categories[0] ? `/?cat=${encodeURIComponent(categories[0])}` : '/',
          moreLabel: 'Tout voir',
        });
        poserCartes(track, melange, { openChannel, openPlayer });
        rails.push(section);
      }
    } catch { /* rail facultatif : jamais bloquant */ }
  }

  // « Ce soir » : ce qui passe vraiment au moment de la visite, guide à l'appui.
  try {
    const vivant = await api('/api/channels?pageSize=40&sort=confidence').then((payload) => payload.channels || []).catch(() => []);
    if (vivant.length) {
      await primeNow(vivant.map((channel) => channel.id));
      const auProgramme = vivant.filter((channel) => nowCached(channel.id));
      const choisis = [
        ...auProgramme.filter((channel) => ['sport', 'cinema', 'series'].includes(channel.category)),
        ...auProgramme,
      ].filter((channel, index, liste) => liste.findIndex((item) => item.id === channel.id) === index).slice(0, MAX_RAIL);
      if (choisis.length >= 4) {
        const { section, track } = railShell({
          eyebrow: 'Au programme', title: 'Ce soir', moreHref: '/guide', moreLabel: 'Ouvrir le guide',
        });
        poserCartes(track, choisis, { openChannel, openPlayer });
        rails.push(section);
      }
    }
  } catch { /* guide indisponible : le rail s'efface, rien d'autre */ }

  // « Par pays » : un échantillon volontairement divers, pas un classement par volume.
  const pays = [...(config.countries || [])].slice(0, 6);
  if (pays.length >= 2) {
    try {
      const lots = await Promise.all(pays.map((paysItem) => api(`/api/channels?country=${encodeURIComponent(paysItem.code)}&pageSize=6&sort=confidence`)
        .then((payload) => payload.channels || [])
        .catch(() => [])));
      const melange = [];
      const pris = new Set();
      for (let rang = 0; rang < 6 && melange.length < MAX_RAIL; rang += 1) {
        for (const lot of lots) {
          const candidat = lot[rang];
          if (!candidat || pris.has(candidat.id)) continue;
          pris.add(candidat.id);
          melange.push(candidat);
          if (melange.length >= MAX_RAIL) break;
        }
      }
      if (melange.length >= 4) {
        const { section, track } = railShell({
          eyebrow: 'Autour du monde', title: 'Par pays', moreHref: '/guide', moreLabel: 'Tout le guide',
        });
        poserCartes(track, melange, { openChannel, openPlayer });
        rails.push(section);
      }
    } catch { /* rail facultatif */ }
  }

  if (!rails.length) return;
  host.append(...rails);
  if (typeof navigate === 'function') {
    // Rien à faire : les liens utilisent la délégation globale du routeur.
  }
}
