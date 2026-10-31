// public/js/doc-anchor.js · l'ancre d'un titre, calculée de la même façon partout (3.18.0).
// Le serveur décrit les sections de docs/ADMINISTRATION.md avec cette fonction ; la console
// s'en sert pour ouvrir le bon passage. Une seule règle, donc aucune ancre divergente.

/** « Onglet Chaînes et liens » devient « onglet-chaines-et-liens ». */
export function anchorOf(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
