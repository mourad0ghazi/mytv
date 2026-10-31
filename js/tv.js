// public/js/tv.js · mode télévision et installation sur l'écran d'accueil (3.8.0).
// Aucune dépendance : détection de l'appareil, navigation à la télécommande, invite PWA.
// Le mode TV ne change jamais le contenu : il agrandit le texte et élargit les cibles.

import { api } from './api.js?v=3.19.0';
import { h, toast } from './ui.js?v=3.19.0';
import { prefs } from './prefs.js?v=3.19.0';
import { getPlayer } from './player.js?v=3.19.0';

/** Appareils qui se pilotent à la télécommande, pas au doigt. */
const TV_UA = /Android TV|Google ?TV|Smart-?TV|Tizen|webOS|NetCast|HbbTV|BRAVIA|AFT[A-Z0-9]|Roku|AppleTV/i;

export function isTvDevice() {
  const params = new URLSearchParams(location.search);
  if (params.get('tv') === '1') return true;
  if (params.get('tv') === '0') return false;
  if (prefs.tvMode() === 'on') return true;
  if (prefs.tvMode() === 'off') return false;
  return TV_UA.test(navigator.userAgent || '');
}

/** Rend le mode TV visible : classe sur <html>, texte agrandi, consigne discrète. */
export function applyTvMode() {
  if (!isTvDevice()) return false;
  document.documentElement.classList.add('is-tv');
  document.body.classList.add('tv-mode');
  const header = document.querySelector('.site-header .header-inner');
  if (header && !document.getElementById('tv-hint')) {
    header.append(h('p', { class: 'tv-hint', id: 'tv-hint' },
      h('kbd', {}, 'Flèches'), h('span', {}, 'pour choisir,'), h('kbd', {}, 'OK'), h('span', {}, 'pour ouvrir,'),
      h('kbd', {}, 'Retour'), h('span', {}, 'pour revenir en arrière')));
  }
  return true;
}

/** Éléments atteignables au pavé directionnel, dans l'ordre du document. */
function focusables() {
  const player = document.getElementById('player-root');
  const scope = player && player.childElementCount ? player : document;
  return [...scope.querySelectorAll('a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]')]
    .filter((node) => {
      if (node.hasAttribute('hidden') || node.disabled) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

function moveFocus(direction) {
  const list = focusables();
  if (!list.length) return;
  const current = document.activeElement;
  const index = list.indexOf(current);
  if (index < 0) { list[0].focus(); return; }
  const next = list[index + direction];
  if (next) next.focus({ preventScroll: false });
}

/** Chaîne par numéro : la même règle que le guide, sans quitter la page. */
async function openNumber(number) {
  try {
    const payload = await api(`/api/channels/search?q=${encodeURIComponent(String(number))}&pageSize=60`);
    const match = (payload.channels || []).find((channel) => channel.number === Number(number));
    if (!match) {
      toast(`Aucune chaîne ne porte le numéro ${number}.`, { tone: 'error', duration: 4000 });
      return;
    }
    const full = await api(`/api/channels/${match.id}`);
    getPlayer().open(full.channel, { queue: [match.id] });
  } catch (error) {
    toast(error.message || 'Numéro indisponible.', { tone: 'error', duration: 4000 });
  }
}

/**
 * Télécommande : flèches = déplacement, OK = validation, Retour = page précédente,
 * chiffres = numéro de chaîne, lecture/pause = lecteur.
 */
export function wireTvKeys() {
  if (!document.body.classList.contains('tv-mode')) return () => {};
  let buffer = '';
  let timer = null;
  const onKey = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target && target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); return; }
    if (event.key === 'Backspace' || event.key === 'GoBack' || event.key === 'BrowserBack') {
      if (document.getElementById('player-root')?.childElementCount) return; // le lecteur garde la main
      event.preventDefault();
      history.length > 1 ? history.back() : null;
      return;
    }
    if (event.key === 'MediaPlayPause') {
      event.preventDefault();
      getPlayer().toggle();
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      buffer += event.key;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const number = Number(buffer);
        buffer = '';
        if (number > 0) openNumber(number);
      }, 900);
    }
  };
  document.addEventListener('keydown', onKey);
  return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); };
}

/**
 * Invite d'installation : bouton réel quand le navigateur l'autorise,
 * marche à suivre écrite pour iOS, qui n'expose aucune invite.
 */
export function wireInstall() {
  let deferred = null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;

  const paint = () => {
    const button = document.getElementById('install-btn');
    if (!button) return;
    button.hidden = standalone;
    button.disabled = !deferred && !isIos;
    if (isIos) {
      button.textContent = 'Installer sur iPhone ou iPad';
    } else if (deferred) {
      button.textContent = 'Installer l’application';
    } else {
      button.textContent = 'Installation indisponible sur ce navigateur';
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    paint();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('#install-btn');
    if (!button) return;
    if (isIos) {
      toast('Sur iPhone : Partager, puis « Sur l’écran d’accueil ».', { tone: 'info', duration: 8000 });
      return;
    }
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice?.outcome === 'accepted') toast('Application installée.', { tone: 'success' });
    deferred = null;
    paint();
  });

  window.addEventListener('appinstalled', () => toast('Application installée.', { tone: 'success' }));
  paint();
  return paint;
}
