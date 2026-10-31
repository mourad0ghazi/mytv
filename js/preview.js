// public/js/preview.js · aperçu muet au survol, puis coupure (AC-089 : budget réseau).
// Un seul flux à la fois, jamais au doigt, jamais sur une chaîne déclarée indisponible,
// coupure automatique après 20 s. Le son reste coupé : l'aperçu informe, il n'impose rien.

const DELAI_SURVOL = 650;
const DUREE_MAX = 20_000;

let hote = null;
let video = null;
let minuteur = null;
let arret = null;
let actif = null;

function supporte() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(hover: none)').matches;
}

function nettoie() {
  clearTimeout(minuteur);
  clearTimeout(arret);
  minuteur = null;
  arret = null;
  if (video) {
    try { video.pause(); } catch { /* déjà arrêtée */ }
    video.removeAttribute('src');
    video.load?.();
    video.remove();
    video = null;
  }
  if (hote) {
    hote.classList.remove('card-previewing');
    hote = null;
  }
  actif = null;
}

/** Coupe immédiatement l'aperçu courant (navigation, changement de page, lecteur ouvert). */
export function stopPreview() {
  nettoie();
}

function demarrer(carte, chaine) {
  if (!supporte()) return;
  if (actif === chaine.id) return;
  nettoie();
  if (!chaine?.url || chaine.blocked || chaine.health === 'down') return;
  actif = chaine.id;
  hote = carte;
  video = document.createElement('video');
  video.className = 'card-preview';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('aria-hidden', 'true');
  video.setAttribute('tabindex', '-1');
  video.src = chaine.url;
  video.addEventListener('error', nettoie, { once: true });
  carte.prepend(video);
  carte.classList.add('card-previewing');
  const promesse = video.play?.();
  if (promesse && typeof promesse.catch === 'function') promesse.catch(() => { /* autoplay refusé : on reste sur le logo */ });
  arret = setTimeout(nettoie, DUREE_MAX);
}

/**
 * Branche l'aperçu sur une carte. `survol` est facultatif : les mobiles n'ont pas de survol,
 * l'appelant peut passer une fonction qui décide (par exemple désactiver en données réduites).
 */
export function attacherPreview(carte, chaine, { autorise = () => true } = {}) {
  if (!supporte()) return;
  carte.addEventListener('pointerenter', () => {
    if (!autorise()) return;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => demarrer(carte, chaine), DELAI_SURVOL);
  });
  carte.addEventListener('pointerleave', nettoie);
  carte.addEventListener('focus', () => { if (autorise()) demarrer(carte, chaine); });
  carte.addEventListener('blur', nettoie);
}
