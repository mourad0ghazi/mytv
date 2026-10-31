// server/api/admin-probe.js · sondes de disponibilité (3.20.0).
// Deux gestes distincts :
//   · « probe » mesure la file des chaînes jamais testées, prioritaire ;
//   · « ronde » avance dans tout le catalogue par lots rotatifs, position retenue sur disque.
// Le plafond de 300 sondes par minute et le journal d'audit sont communs aux deux.

import { lectureStats } from '../core/playback.js';
import { probeStats } from '../core/probe-plan.js';
import { lancerRonde, lancerSondeNonTestees } from '../core/probe-runner.js';

function limite(value, max = 100, defaut = 40) {
  const nombre = Number(value);
  if (!Number.isFinite(nombre)) return defaut;
  return Math.max(1, Math.min(max, Math.floor(nombre)));
}

// Le routeur reçu est celui de la console : il déduit déjà l'authentification et la
// permission de chaque couple méthode + chemin. Aucune permission n'est élargie ici.
export function registerProbeRoutes(router, app) {
  // EP-31 — sonde de la file « jamais testée ».
  router.post('/api/admin/health/probe', async ({ body, ip, requestId }) => {
    const result = await lancerSondeNonTestees(app, {
      limit: limite(body?.limit),
      ids: Array.isArray(body?.ids) ? body.ids.slice(0, 100) : null,
      actor: 'admin',
      ip,
      requestId,
    });
    return { body: result, cache: 'no-store' };
  });

  // 3.20.0 — ronde rotative : le lot suivant du catalogue, curseur conservé.
  router.post('/api/admin/health/ronde', async ({ body, ip, requestId }) => {
    const result = await lancerRonde(app, {
      limit: limite(body?.limite ?? body?.limit, 300, 150),
      ids: Array.isArray(body?.ids) ? body.ids.slice(0, 100) : null,
      actor: 'admin',
      ip,
      requestId,
    });
    return { body: result, cache: 'no-store' };
  });

  // Photographie de la mesure, sans sonder : ce qui est testé, ce qui reste, ce qui est lisible.
  router.get('/api/admin/health/resume', () => ({
    body: {
      probe: probeStats(app.store.channels, { withProbe: false }),
      lecture: lectureStats(app.store.channels),
      curseur: app.store.probe,
      seuilEchecs: 3,
    },
    cache: 'no-store',
  }));
}
