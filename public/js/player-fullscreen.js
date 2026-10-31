// public/js/player-fullscreen.js · plein écran du lecteur, tous navigateurs confondus.
// Safari sur iPhone n'expose pas requestFullscreen sur un élément : seule la vidéo sait
// passer en plein écran natif. Aucun de ces chemins ne doit lever d'exception : un bouton
// qui ne répond pas est pire qu'un bouton absent.

import { toast } from './ui.js?v=3.20.0';

function elementActif() {
  const doc = document;
  return doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || null;
}

/** Quitte le plein écran s'il est actif. Renvoie true si quelque chose a été quitté. */
export function leaveFullscreen() {
  const doc = document;
  if (!elementActif()) return false;
  try {
    if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  } catch { /* le navigateur a déjà rendu la main */ }
  return true;
}

/** Bascule le plein écran : standard, préfixes WebKit, puis lecture native de la vidéo. */
export function toggleFullscreen(player) {
  const element = player?.overlay;
  if (!element) return;
  if (leaveFullscreen()) return;
  try {
    if (element.requestFullscreen) {
      element.requestFullscreen({ navigationUI: 'hide' }).catch(() => nativeVideo(player));
      return;
    }
    if (element.webkitRequestFullscreen) { element.webkitRequestFullscreen(); return; }
    nativeVideo(player);
  } catch {
    nativeVideo(player);
  }
}

function nativeVideo(player) {
  const video = player?.video;
  if (video?.webkitEnterFullscreen) {
    try { video.webkitEnterFullscreen(); return; } catch { /* refus du système */ }
  }
  toast('Le plein écran n’est pas disponible ici. Tournez le téléphone ou ouvrez le lecteur dans le navigateur.', { tone: 'info' });
}
