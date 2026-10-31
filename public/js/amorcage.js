// public/js/amorcage.js · plafond d'attente de l'amorçage (3.17.0).
// Un écran de chargement n'a pas le droit d'être définitif. Ce module borne l'attente et
// laisse l'appelant décider de ce qu'il montre ensuite. Il est testé seul, sans navigateur.

/** Quinze secondes : au-delà, une page qui n'a rien reçu n'a plus de raison d'attendre. */
export const PLAFOND_AMORCAGE = 15_000;

/**
 * Rend une promesse, mais jamais plus longtemps que `ms`.
 * - travail réussit : la valeur est rendue telle quelle ;
 * - travail échoue : l'erreur est propagée ;
 * - travail trop lent : rend `valeurDeDepassement` (une chaîne dédiée par défaut).
 * La minuterie est toujours arrêtée, pour ne pas garder le processus éveillé.
 */
export function avecPlafond(travail, { ms = PLAFOND_AMORCAGE, valeurDeDepassement = 'depasse' } = {}) {
  return new Promise((resolve, reject) => {
    let fini = false;
    const minuterie = setTimeout(() => {
      if (fini) return;
      fini = true;
      resolve(valeurDeDepassement);
    }, Math.max(0, Number(ms) || 0));
    Promise.resolve(travail).then(
      (valeur) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuterie);
        resolve(valeur);
      },
      (erreur) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuterie);
        reject(erreur);
      },
    );
  });
}
