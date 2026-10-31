// public/js/views/error-codes.js · les 20 codes opposables (§6.3) et les 6 familles du §9.
// Les textes du §9 ne sont pas recopiés ici : ils viennent de /api/errors/catalog, seule source.
// Ce module ne fait que décrire les familles (ordre, libellé, promesse faite au lecteur).

import { api } from '../api.js?v=3.18.0';

export const ERRORS_CODES = [
  { code: 'ERR-01', status: 400, message: 'Le formulaire est incomplet ou mal formé. Réessayez.' },
  { code: 'ERR-02', status: 400, message: 'Le champ « {champ} » est obligatoire.' },
  { code: 'ERR-03', status: 400, message: '« {champ} » doit être compris entre {min} et {max}.' },
  { code: 'ERR-04', status: 400, message: '« {champ} » n’a pas le bon format.' },
  { code: 'ERR-05', status: 400, message: 'Ce fichier n’est pas une liste M3U : aucune chaîne n’a été trouvée.' },
  { code: 'ERR-06', status: 400, message: 'La requête a été refusée : données illisibles.' },
  { code: 'ERR-07', status: 401, message: 'Votre session a expiré. Reconnectez-vous.' },
  { code: 'ERR-08', status: 401, message: 'Mot de passe incorrect.' },
  { code: 'ERR-09', status: 403, message: 'Cette action n’est pas autorisée.' },
  { code: 'ERR-10', status: 404, message: 'Chaîne introuvable.' },
  { code: 'ERR-11', status: 404, message: 'Cette adresse n’existe pas.' },
  { code: 'ERR-12', status: 405, message: 'Action non autorisée sur cette adresse.' },
  { code: 'ERR-13', status: 409, message: 'Une importation est déjà en cours. Patientez.' },
  { code: 'ERR-14', status: 409, message: 'Cette chaîne existe déjà dans le catalogue.' },
  { code: 'ERR-15', status: 413, message: 'Fichier trop volumineux (maximum {max}).' },
  { code: 'ERR-16', status: 422, message: 'Impossible d’appliquer : {raison}.' },
  { code: 'ERR-17', status: 429, message: 'Trop de tentatives. Réessayez dans {n} minutes.' },
  { code: 'ERR-18', status: 500, message: 'Une erreur interne est survenue. Réessayez ; si elle persiste, signalez-la avec le code {requestId}.' },
  { code: 'ERR-19', status: 503, message: 'Le service est momentanément indisponible. Retour prévu : {heure}.' },
  { code: 'ERR-20', status: 504, message: 'La source n’a pas répondu à temps. Réessayez plus tard.' },
];

/** Ce que chaque famille promet au lecteur : à qui elle parle, et ce qu'elle évite. */
export const FAMILY_META = [
  {
    id: 'serveur',
    label: 'Serveur et API',
    promise: 'Ce que le service répond quand une demande ne peut pas aboutir : le message dit quoi faire, jamais comment le serveur est construit.',
  },
  {
    id: 'lecteur',
    label: 'Lecture vidéo',
    promise: 'Les douze mires du lecteur. Chacune explique la cause réelle · HTTP bloqué, source fermée, identifiant exigé · et propose une action.',
  },
  {
    id: 'administration',
    label: 'Administration et ingestion',
    promise: 'Importations, source muette, verrou déjà pris, sauvegarde illisible : l’administrateur sait toujours si le catalogue a changé.',
  },
  {
    id: 'silencieuse',
    label: 'Erreurs silencieuses',
    promise: 'Ce qui n’arrive jamais jusqu’à l’écran mais doit apparaître dans le journal : valeurs négatives, cache trompeur, trace technique exposée.',
  },
  {
    id: 'rendu',
    label: 'Rendu et interface',
    promise: 'Les défauts visuels qui rendent le site inutilisable : texte illisible, icône cassée, douze mille cartes, focus invisible.',
  },
  {
    id: 'données',
    label: 'Données',
    promise: 'Les défauts de catalogue : doublons, catégorie « autre » majoritaire, nom pollué par la qualité, fichier corrompu après arrêt brutal.',
  },
];

/** Charge le catalogue (§9) · la seule copie des 82 textes vit sur le serveur. */
export async function loadMessageCatalog() {
  const catalog = await api('/api/errors/catalog');
  const families = Array.isArray(catalog.families) ? catalog.families : [];
  return {
    total: Number(catalog.total) || 0,
    families: FAMILY_META.map((meta) => {
      const family = families.find((item) => item.id === meta.id);
      return {
        ...meta,
        count: family?.messages?.length || 0,
        messages: (family?.messages || []).map((entry) => ({
          id: entry.id,
          text: entry.text,
          cause: entry.cause || '',
          kind: entry.kind || '',
        })),
      };
    }),
  };
}

/** Compte les messages réellement chargés (utilisé par les tests et le rendu). */
export function catalogCount(catalog) {
  return (catalog?.families || []).reduce((total, family) => total + family.messages.length, 0);
}
