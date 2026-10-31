/* public/js/coquille.js · script classique, exécuté avant le module de l'application (3.17.0).
   Rôle unique : empêcher qu'une page neuve tourne avec le code d'une version ancienne.
   Le service worker d'une publication précédente peut servir du JavaScript mis en cache ;
   la page, elle, vient du réseau. Ce script compare la version inscrite dans la page à celle
   de la dernière visite : si elles diffèrent, il retire les workers et leurs caches, puis
   recharge une seule fois. Sans cette précaution, l'écran peut rester sur son chargement.
   Aucune dépendance, aucun accès réseau : il ne fait que nettoyer et recharger. */
(function coquille() {
  var CLE = 'streamtv.coquille';
  var meta = document.querySelector('meta[name="streamtv-version"]');
  var version = meta && meta.getAttribute('content') ? meta.getAttribute('content').trim() : '';
  if (!version) return;

  var connue = null;
  try { connue = window.localStorage.getItem(CLE); } catch (erreur) { return; }
  // Même version que la dernière visite : rien à faire, et surtout aucune boucle de rechargement.
  if (connue === version) return;
  try { window.localStorage.setItem(CLE, version); } catch (erreur) { return; }

  var workers = ('serviceWorker' in navigator)
    ? navigator.serviceWorker.getRegistrations().catch(function () { return []; })
    : Promise.resolve([]);
  var cachesConnus = (window.caches && window.caches.keys)
    ? window.caches.keys().catch(function () { return []; })
    : Promise.resolve([]);

  Promise.all([workers, cachesConnus]).then(function (resultats) {
    var enregistrements = resultats[0] || [];
    var noms = resultats[1] || [];
    // Rien à nettoyer (première visite) : on ne recharge pas pour rien.
    if (!enregistrements.length && !noms.length) return null;
    return Promise.all([
      Promise.all(enregistrements.map(function (enregistrement) {
        return enregistrement.unregister().catch(function () { return false; });
      })),
      Promise.all(noms.map(function (nom) {
        return window.caches.delete(nom).catch(function () { return false; });
      })),
    ]);
  }).then(function (nettoye) {
    if (nettoye) window.location.reload();
  }).catch(function () {
    /* Un navigateur qui refuse le nettoyage ne doit pas bloquer l'affichage. */
  });
}());
