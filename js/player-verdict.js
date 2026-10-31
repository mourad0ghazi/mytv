// public/js/player-verdict.js : ce que la lecture réelle apprend au catalogue (3.22.0).
// Le lecteur ne raconte pas d'histoires : il dit « ça lit » ou « ça ne lit pas », et pourquoi.
// Un seul verdict par ouverture : le serveur n'a pas à recevoir de bavardage.

import { verdictLecture } from './api.js?v=3.22.0';

/**
 * Cause réelle d'un échec, telle que le catalogue doit l'enregistrer.
 * 403 : restriction de zone. 404/410 : adresse morte. Aucune réponse : CORS si le serveur
 * sait relire ce flux, sinon réseau mort. Un délai n'est jamais rangé avec une adresse morte.
 */
export function causeEchec(code, data = null, { relayUrl = '' } = {}) {
  const details = String(data?.details || '');
  if (code === 'P-05' || code === 403) return 'geo';
  if (code === 'P-04' || code === 404 || code === 410) return 'dead';
  if (code === 'P-06') return 'codec';
  if (details.includes('TimeOut') || code === 'P-10') return 'timeout';
  if (code === 'P-03' || code === 0) return relayUrl ? 'cors' : 'dead';
  return 'dead';
}

/** Guetteur de verdict : une seule parole par ouverture, remise à zéro par une relance. */
export function createVerdictGuard(channelId, relayUrl = '') {
  let parle = false;
  return {
    /** Une image est apparue : le flux fonctionne depuis ce navigateur. */
    reussite() {
      if (parle) return false;
      parle = true;
      verdictLecture(channelId, 'ok');
      return true;
    },
    /** Plus aucune piste : l'échec est réel, avec sa cause. */
    echec(code, data = null) {
      if (parle) return false;
      parle = true;
      verdictLecture(channelId, 'echec', causeEchec(code, data, { relayUrl }));
      return true;
    },
    relance() {
      parle = false;
    },
    get aParle() {
      return parle;
    },
  };
}
