// server/core/messages.js — catalogue exhaustif des 82 messages affichables (§9).
// Chaque entrée reproduit le texte exact du cahier des charges : aucun message n'est inventé
// ailleurs, et un test vérifie les 82 identifiants ainsi que l'absence de jargon technique.

const S = [
  ['ER-S01', 'Votre session a expiré. Reconnectez-vous.', 'jeton absent ou expiré', 'AC-098'],
  ['ER-S02', 'Mot de passe incorrect.', 'saisie fausse', 'manuel'],
  ['ER-S03', 'Trop de tentatives. Réessayez dans {n} minutes.', 'plus de 8 échecs en 15 minutes', 'AC-093'],
  ['ER-S04', 'Chaîne introuvable.', 'identifiant inconnu ou chaîne masquée', 'AC-099'],
  ['ER-S05', 'Cette adresse n’existe pas.', 'route inconnue', 'AC-099'],
  ['ER-S06', 'Action non autorisée sur cette adresse.', 'mauvaise méthode HTTP', '—'],
  ['ER-S07', 'Le formulaire est incomplet ou mal formé.', 'données illisibles', 'AC-090'],
  ['ER-S08', 'Le champ « {champ} » est obligatoire.', 'champ manquant', '—'],
  ['ER-S09', '« {champ} » n’a pas le bon format.', 'valeur invalide', 'AC-035'],
  ['ER-S10', 'Cette chaîne existe déjà dans le catalogue.', 'doublon d’URL', 'AC-014'],
  ['ER-S11', 'Une importation est déjà en cours. Patientez.', 'verrou global', 'AC-019'],
  ['ER-S12', 'Ce fichier n’est pas une liste M3U : aucune chaîne n’a été trouvée.', 'contenu non M3U', 'AC-007'],
  ['ER-S13', 'La source n’a pas répondu à temps. Réessayez plus tard.', 'délai dépassé', 'AC-020'],
  ['ER-S14', 'Fichier trop volumineux (maximum {max}).', 'import énorme', '—'],
  ['ER-S15', 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code {requestId}.', 'exception non prévue', '—'],
  ['ER-S16', 'Le service est momentanément indisponible. Retour prévu : {heure}.', 'maintenance', '—'],
  ['ER-S17', 'Impossible d’appliquer : la chaîne est verrouillée manuellement.', 'décision manuelle protégée', 'AC-041'],
  ['ER-S18', 'Valeur hors limites : la taille de page doit être comprise entre 12 et 60.', 'paramètre absurde', 'AC-030'],
  ['ER-S19', 'La sauvegarde est corrompue. Le catalogue actuel n’a pas été modifié.', 'sauvegarde illisible', 'AC-100'],
  ['ER-S20', 'La restauration a échoué. Le catalogue actuel est intact.', 'erreur pendant la restauration', 'AC-095'],
];

const P = [
  ['P-01', 'Cette chaîne est diffusée en HTTP non sécurisé, que le navigateur bloque sur un site HTTPS.', 'mixed-content'],
  ['P-02', 'Ce flux exige un identifiant technique que le navigateur ne peut pas fournir.', 'ua-required'],
  ['P-03', 'La source refuse les lectures depuis un autre site. Cela ne vient pas de votre connexion.', 'cors'],
  ['P-04', 'Le flux « {nom} » ne répond pas. Il a peut-être changé d’adresse.', 'dead'],
  ['P-05', 'La source réserve cette chaîne à un autre pays.', 'geo'],
  ['P-06', 'Ce flux utilise un encodage que ce navigateur ne sait pas lire. Essayez un autre navigateur ou l’application mobile.', 'codec'],
  ['P-07', 'Le navigateur a besoin d’une action : appuyez sur ▶.', 'autoplay'],
  ['P-08', 'Le composant de lecture n’a pas pu être chargé. Rechargez la page.', 'hls-engine'],
  ['P-09', 'Vérifiez votre connexion. Le catalogue réapparaîtra automatiquement.', 'offline'],
  ['P-10', 'Aucune réponse après 15 secondes.', 'timeout'],
  ['P-11', 'Cette chaîne n’a pas d’adresse de flux. Ajoutez-la dans l’administration.', 'empty-url'],
  ['P-12', 'Une erreur inattendue est survenue ({code}).', 'unknown'],
];

const A = [
  ['ER-A01', 'Aucune chaîne à importer.', 'aperçu vide'],
  ['ER-A02', '0 chaîne importée — l’adresse ne contient pas de fichier M3U.', 'URL erronée'],
  ['ER-A03', 'L’importation a échoué : la source est inaccessible ({code}).', 'lien mort'],
  ['ER-A04', 'Importation interrompue au bout de 120 s. Aucune chaîne n’a été ajoutée.', 'délai global'],
  ['ER-A05', '{added} chaînes seront ajoutées, {updated} seront mises à jour, {ignored} seront ignorées.', 'compte avant confirmation'],
  ['ER-A06', 'Cette adresse est déjà suivie.', 'source en doublon'],
  ['ER-A07', 'Le mot de passe actuel est incorrect.', 'rotation'],
  ['ER-A08', 'Le nouveau mot de passe doit contenir au moins 12 caractères.', 'rotation'],
  ['ER-A09', 'Les deux mots de passe ne correspondent pas.', 'confirmation'],
  ['ER-A10', 'Cette chaîne ne peut pas être supprimée : elle est épinglée.', 'protection'],
  ['ER-A11', 'Sélection trop importante (maximum 500 chaînes par action).', 'action de masse'],
  ['ER-A12', 'Le fichier exporté est vide : aucune chaîne visible.', 'catalogue vide'],
  ['ER-A13', 'Ce numéro de chaîne est déjà utilisé.', 'doublon de numéro'],
  ['ER-A14', 'La source a changé d’adresse (redirection vers {url}). Mettre à jour ?', 'redirection'],
  ['ER-A15', 'Le fichier EPG est invalide : la grille reste vide, les chaînes fonctionnent normalement.', 'XMLTV cassé'],
  ['ER-A16', 'Sonde impossible : aucune chaîne visible.', 'catalogue vide'],
];

const X = [
  ['ER-X01', 'Données non actualisées', 'une requête échoue et l’ancien affichage demeure'],
  ['ER-X02', 'Réglage non enregistré : réessayez.', 'une écriture de fichier échoue'],
  ['ER-X03', 'Pagination non appliquée : signalez-le.', 'pageSize ou page ignorés'],
  ['ER-X04', 'Logo indisponible', 'image 404 ou contenu non image'],
  ['ER-X05', 'Erreur interne journalisée', 'catch vide'],
  ['ER-X06', 'Ressource mise en cache indûment', 'service worker trop large'],
  ['ER-X07', 'Ordre des cartes instable', 'tri non total'],
  ['ER-X08', 'Décision manuelle écrasée', 'recalcul de masse'],
  ['ER-X09', 'Doublons comptés', 'absence de dédoublonnage'],
  ['ER-X10', 'Erreur inattendue non gérée', 'promesse rejetée non capturée'],
  ['ER-X11', 'Mémoire croissante', 'écouteurs non détachés'],
  ['ER-X12', 'Compteur incohérent', 'calcul côté client'],
  ['ER-X13', 'Chaîne masquée réapparue', 'visibilité non préservée'],
  ['ER-X14', 'Horaire décalé', 'fuseau horaire local'],
];

const R = [
  ['ER-R01', 'Thème effondré', 'déclaration CSS invalide'],
  ['ER-R02', 'Texte illisible', 'contraste insuffisant'],
  ['ER-R03', 'Défilement horizontal', 'largeur fixe ou image trop large'],
  ['ER-R04', 'Élément invisible impossible à cliquer', '[hidden] écrasé'],
  ['ER-R05', 'Interface figée après une modale', 'overflow non restauré'],
  ['ER-R06', 'Cartes qui se chevauchent', 'hauteur non réservée'],
  ['ER-R07', 'Saut de mise en page', 'image sans dimensions'],
  ['ER-R08', 'Emoji remplacé par une case vide', 'police système absente'],
  ['ER-R09', 'Compteur affiché deux fois', 'double rendu du libellé'],
  ['ER-R10', 'Libellé tronqué', 'largeur contrainte'],
];

const D = [
  ['ER-D01', 'Chaîne sans nom', 'nom absent'],
  ['ER-D02', 'Deux chaînes portent le même numéro', 'numérotation non atomique'],
  ['ER-D03', 'Le même flux apparaît deux fois', 'dédoublonnage absent'],
  ['ER-D04', 'Catégorie « autre » majoritaire', 'seuil de surveillance dépassé'],
  ['ER-D05', 'Confiance à six décimales', 'arrondi absent'],
  ['ER-D06', 'Nom contenant le suffixe de qualité', 'normalisation absente'],
  ['ER-D07', 'Langue vide alors que le pays est connu', 'table pays → langue absente'],
  ['ER-D08', 'Numéro de chaîne sauté', 'numéros réattribués'],
  ['ER-D09', 'Catalogue corrompu après arrêt brutal', 'écriture non atomique'],
  ['ER-D10', 'Doublons de noms entre pays différents', 'fusion sans contrôle de pays'],
];

function build(family, rows, extra = {}) {
  return rows.map((row) => ({ id: row[0], family, text: row[1], cause: row[2] || '', ...extra }));
}

/** Les 82 messages affichables, dans l'ordre du cahier des charges. */
export const MESSAGES = Object.freeze([
  ...build('serveur', S, { kind: 'erreur' }),
  ...build('lecteur', P, { kind: 'mire' }),
  ...build('administration', A, { kind: 'erreur' }),
  ...build('silencieuse', X, { kind: 'trace' }),
  ...build('rendu', R, { kind: 'symptôme' }),
  ...build('données', D, { kind: 'symptôme' }),
]);

export const MESSAGE_BY_ID = new Map(MESSAGES.map((entry) => [entry.id, entry]));

/** Texte d'un message, avec substitution des valeurs fournies. */
export function messageOf(id, params = {}) {
  const entry = MESSAGE_BY_ID.get(id);
  if (!entry) return '';
  return entry.text.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
}

/** Équivalence entre les 20 codes opposables et les messages du §9.2. */
export const ERR_TO_MESSAGE = Object.freeze({
  'ERR-01': 'ER-S07',
  'ERR-02': 'ER-S08',
  'ERR-03': 'ER-S09',
  'ERR-04': 'ER-S09',
  'ERR-05': 'ER-S12',
  'ERR-06': 'ER-S07',
  'ERR-07': 'ER-S01',
  'ERR-08': 'ER-S02',
  'ERR-09': 'ER-S06',
  'ERR-10': 'ER-S04',
  'ERR-11': 'ER-S05',
  'ERR-12': 'ER-S06',
  'ERR-13': 'ER-S11',
  'ERR-14': 'ER-S10',
  'ERR-15': 'ER-S14',
  'ERR-16': 'ER-S17',
  'ERR-17': 'ER-S03',
  'ERR-18': 'ER-S15',
  'ERR-19': 'ER-S16',
  'ERR-20': 'ER-S13',
});

export const FAMILIES = Object.freeze([
  { id: 'serveur', label: 'Serveur et API', prefix: 'ER-S', count: S.length },
  { id: 'lecteur', label: 'Lecture vidéo', prefix: 'P-', count: P.length },
  { id: 'administration', label: 'Administration et ingestion', prefix: 'ER-A', count: A.length },
  { id: 'silencieuse', label: 'Erreurs silencieuses', prefix: 'ER-X', count: X.length },
  { id: 'rendu', label: 'Rendu et CSS', prefix: 'ER-R', count: R.length },
  { id: 'données', label: 'Données', prefix: 'ER-D', count: D.length },
]);

/** Vue destinée à `/api/errors/catalog` et à la page `/erreurs`. */
export function catalogForClient() {
  return {
    total: MESSAGES.length,
    families: FAMILIES.map((family) => ({
      ...family,
      messages: MESSAGES.filter((entry) => entry.family === family.id)
        .map(({ id, text, cause, kind }) => ({ id, text, cause, kind })),
    })),
  };
}
