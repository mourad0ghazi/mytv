// server/core/journal.js · journal d'audit traduit en phrases (3.14.0).
// Le fichier d'audit garde des codes techniques : utiles pour chercher, illisibles pour
// décider. Ici, chaque ligne devient une phrase courte, avec son auteur et son heure.
// Aucune donnée nouvelle n'est inventée : on ne reformule que ce qui a été enregistré.

const ACTIONS = {
  'access.link.created': { ton: 'info', phrase: (e) => `Lien d’accès créé${suffixe(e.detail)}` },
  'access.link.revoked': { ton: 'warn', phrase: (e) => `Lien d’accès révoqué${suffixe(e.detail)}` },
  'access.redeem': { ton: 'info', phrase: (e) => `Entrée par lien d’accès${suffixe(e.detail)}` },
  'access.redeem.fail': { ton: 'danger', phrase: (e) => `Lien d’accès refusé${raison(e.result)}` },
  'anime.update': { ton: 'info', phrase: (e) => `Fiche anime modifiée${suffixe(e.detail)}` },
  'autotag.all': { ton: 'info', phrase: () => 'Classification proposée pour tout le catalogue' },
  'backup.create': { ton: 'info', phrase: (e) => `Sauvegarde créée${suffixe(e.detail)}` },
  'backup.manual': { ton: 'info', phrase: (e) => `Sauvegarde créée à la demande${suffixe(e.detail)}` },
  'backup.restore': { ton: 'warn', phrase: (e) => `Restauration d’une sauvegarde${suffixe(e.detail)}` },
  'channel.bulk': { ton: 'warn', phrase: (e) => `Action groupée sur ${compte(e.count)}${actionGroupee(e.detail)}` },
  'channel.create': { ton: 'info', phrase: (e) => `Chaîne ajoutée${suffixe(e.detail)}` },
  'channel.delete': { ton: 'warn', phrase: (e) => `Chaîne retirée${suffixe(e.detail)}` },
  'channel.restore': { ton: 'info', phrase: (e) => `Chaîne restaurée${suffixe(e.detail)}` },
  'channel.tag': { ton: 'info', phrase: (e) => `Catégorie changée${suffixe(e.detail)}` },
  'channel.update': { ton: 'info', phrase: (e) => `Chaîne modifiée${suffixe(e.detail)}` },
  'compte.confirmation': { ton: 'info', phrase: (e) => `Adresse e-mail confirmée${suffixe(e.detail)}` },
  'compte.connexion': { ton: 'info', phrase: (e) => `Connexion à un compte visiteur${suffixe(e.detail)}` },
  'compte.donnees': { ton: 'info', phrase: (e) => `Données de compte mises à jour${suffixe(e.detail)}` },
  'compte.inscription': { ton: 'info', phrase: (e) => `Compte visiteur créé${suffixe(e.detail)}` },
  'compte.mot-de-passe': { ton: 'warn', phrase: () => 'Mot de passe d’un compte visiteur remplacé' },
  'compte.preferences': { ton: 'info', phrase: () => 'Préférences d’affichage enregistrées' },
  'compte.profil': { ton: 'info', phrase: (e) => `Profil de compte modifié${suffixe(e.detail)}` },
  'compte.suppression': { ton: 'warn', phrase: (e) => `Compte visiteur supprimé${suffixe(e.detail)}` },
  'device.added': { ton: 'info', phrase: (e) => `Appareil autorisé${suffixe(e.detail || e.appareil)}` },
  'device.removed': { ton: 'warn', phrase: (e) => `Appareil retiré${suffixe(e.detail || e.appareil)}` },
  'film.update': { ton: 'info', phrase: (e) => `Fiche film modifiée${suffixe(e.detail)}` },
  'health.probe': { ton: 'info', phrase: (e) => `Contrôle des flux lancé${suffixe(e.detail)}` },
  'import.commit': { ton: 'info', phrase: (e) => `Importation appliquée${suffixe(e.detail)}` },
  'import.preview': { ton: 'info', phrase: (e) => `Importation analysée${suffixe(e.detail)}` },
  'import.rollback': { ton: 'warn', phrase: (e) => `Importation annulée${suffixe(e.detail)}` },
  'login.code.fail': { ton: 'danger', phrase: (e) => `Code de connexion refusé${raison(e.result)}` },
  'login.code.sent': { ton: 'info', phrase: () => 'Code de connexion envoyé par e-mail' },
  'login.fail': { ton: 'danger', phrase: (e) => `Connexion refusée${raison(e.result)}` },
  'login.success': { ton: 'info', phrasing: true, phrase: (e) => `Connexion réussie${role(e.role || e.result)}` },
  'logout': { ton: 'info', phrase: () => 'Déconnexion' },
  'mail.test': { ton: 'info', phrase: (e) => `Message de contrôle envoyé${e.result && e.result !== 'ok' ? ` (${e.result})` : ''}` },
  'membre.statut': { ton: 'warn', phrase: (e) => `Statut d’un compte visiteur changé${suffixe(e.detail)}` },
  'migration.export': { ton: 'info', phrase: () => 'Export des données lancé' },
  'password.change': { ton: 'warn', phrase: () => 'Mot de passe changé, sessions fermées' },
  'report.auto-delete': { ton: 'danger', phrase: (e) => `Contenu retiré automatiquement au seuil de signalements${suffixe(e.detail)}` },
  'report.confirm': { ton: 'warn', phrase: (e) => `Signalement confirmé${suffixe(e.detail)}` },
  'report.create': { ton: 'info', phrase: (e) => `Signalement reçu${suffixe(e.detail)}` },
  'report.reject': { ton: 'info', phrase: (e) => `Signalement refusé${suffixe(e.detail)}` },
  'report.reset': { ton: 'info', phrase: (e) => `Compteur de signalements remis à zéro${suffixe(e.detail)}` },
  'rules.update': { ton: 'info', phrase: () => 'Règles de classement modifiées' },
  'sessions.revoke': { ton: 'warn', phrase: () => 'Toutes les sessions fermées' },
  'settings.reset': { ton: 'warn', phrase: () => 'Réglages remis aux valeurs par défaut' },
  'settings.update': { ton: 'info', phrase: (e) => `Réglages modifiés${reglages(e.detail) || suffixe(e.detail)}` },
  'source.create': { ton: 'info', phrase: (e) => `Source ajoutée${suffixe(e.detail)}` },
  'source.delete': { ton: 'warn', phrase: (e) => `Source supprimée${suffixe(e.detail)}` },
  'source.duplicate.arbitrated': { ton: 'warn', phrase: (e) => `Doublon entre sources arbitré par priorité${suffixe(e.detail)}` },
  'source.import': { ton: 'info', phrase: (e) => `Import de source appliqué${suffixe(e.detail)}` },
  'source.import.refused': { ton: 'danger', phrase: (e) => `Import de source refusé${raison(e.result)}${suffixe(e.detail)}` },
  'source.import.reset': { ton: 'warn', phrase: (e) => `Import de source remis à zéro${suffixe(e.detail)}` },
  'source.probe': { ton: 'info', phrase: (e) => `Sonde des sources exécutée${suffixe(e.detail)}` },
  'source.update': { ton: 'info', phrase: (e) => `Source modifiée${suffixe(e.detail)}` },
  'team.create': { ton: 'info', phrase: (e) => `Compte créé${suffixe(e.detail)}` },
  'team.delete': { ton: 'warn', phrase: (e) => `Compte supprimé${suffixe(e.detail)}` },
  'team.update': { ton: 'info', phrase: (e) => `Compte modifié${suffixe(e.detail)}` },
};

export const AUDIT_ACTION_CODES = Object.freeze(Object.keys(ACTIONS));

// Libellés des réglages : le journal parle comme l'écran, pas comme le fichier.
const REGLAGES = {
  brand: 'nom du site', tagline: 'accroche', accent: 'couleur d’accent', logoUrl: 'logo',
  pageSize: 'chaînes par page', defaultSort: 'tri par défaut', showAdult: 'catégorie adulte',
  autoHideAdult: 'masquage automatique', featuredIds: 'chaînes en vedette', heroMode: 'bandeau',
  showHealthBadge: 'état des flux', epgUrl: 'adresse du guide', footerNote: 'note de pied de page',
  maintenanceMode: 'mode maintenance', targetTable: 'objectif de catalogue',
  confidenceFloor: 'seuil de confiance', pageTitleSuffix: 'suffixe de titre',
  adminPath: 'adresse secrète', adminDeviceLock: 'verrou d’appareil', adminEmail: 'adresse du code',
  adminName: 'nom du propriétaire', vodEnabled: 'catalogues anime et films',
  vodGenreRowsMax: 'rangées par genre', sourceRetryBudget: 'budget de tentatives',
};

// Actions groupées, dites comme sur le bouton.
const ACTIONS_GROUPEES = {
  hide: 'masquer', show: 'afficher', delete: 'retirer', restore: 'restaurer',
  category: 'changer de catégorie', tag: 'changer de catégorie', visibility: 'changer la visibilité',
  masquer: 'masquer', afficher: 'afficher', supprimer: 'retirer',
};

const ROLES = {
  proprietaire: ' du propriétaire',
  administrateur: ' d’un administrateur',
  editeur: ' d’un éditeur',
  moderateur: ' d’un modérateur',
  analyste: ' d’un analyste',
};

function suffixe(detail) {
  const texte = String(detail || '').replace(/\s+/g, ' ').trim();
  return texte ? ` : ${texte.slice(0, 160)}` : '';
}

function raison(result) {
  const texte = String(result || '').replace(/\s+/g, ' ').trim();
  if (!texte || texte === 'ok') return '';
  return ` (${texte.slice(0, 120)})`;
}

/** « adminName,adminEmail » devient « nom du propriétaire, adresse du code ». */
function reglages(detail) {
  const clefs = String(detail || '').split(',').map((clef) => clef.trim()).filter(Boolean);
  if (!clefs.length) return '';
  const lisible = clefs.map((clef) => REGLAGES[clef] || clef).join(', ');
  return ` : ${lisible}`;
}

/** « masquer » devient « Masquer », et le reste de la phrase suit. */
function actionGroupee(detail) {
  const texte = String(detail || '').trim();
  if (!texte) return '';
  const clef = Object.keys(ACTIONS_GROUPEES).find((item) => texte.toLowerCase().startsWith(item));
  if (!clef) return suffixe(texte);
  return ` : ${ACTIONS_GROUPEES[clef]}${texte.slice(clef.length)}`;
}

function role(valeur) {
  return ROLES[String(valeur || '')] || '';
}

function compte(count) {
  const nombre = Number(count);
  if (!Number.isFinite(nombre) || nombre <= 0) return 'des chaînes';
  return nombre === 1 ? '1 chaîne' : `${nombre} chaînes`;
}

/** Heure courte, fuseau du serveur : le journal se lit dans l'ordre du jour. */
export function heureCourte(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Jour lisible, pour séparer deux journées dans une liste longue. */
export function jourLisible(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const aujourdhui = new Date();
  const memeJour = date.toDateString() === aujourdhui.toDateString();
  if (memeJour) return 'Aujourd’hui';
  const hier = new Date(aujourdhui.getTime() - 86_400_000);
  if (date.toDateString() === hier.toDateString()) return 'Hier';
  // L'année n'apparaît que si elle n'est pas celle en cours : une date récente se lit court.
  const memeAnnee = date.getFullYear() === aujourdhui.getFullYear();
  return date.toLocaleDateString('fr-FR', memeAnnee
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Transforme une ligne du journal en phrase. Une action inconnue n'est jamais masquée :
 * elle est affichée telle quelle, sans jargon ajouté.
 */
export function describeAuditEntry(entry) {
  const base = entry && typeof entry === 'object' ? entry : {};
  const action = String(base.action || '');
  const fiche = ACTIONS[action];
  const brute = fiche ? fiche.phrase(base) : `Action technique : ${action || 'sans nom'}`;
  return {
    at: base.at || '',
    heure: heureCourte(base.at),
    jour: jourLisible(base.at),
    acteur: String(base.actor || 'admin').slice(0, 60),
    action,
    ton: fiche ? fiche.ton : 'info',
    // Une phrase connue commence par une majuscule ; une action inconnue reste telle quelle.
    phrase: fiche ? brute.replace(/^([a-zà-ÿ])/, (lettre) => lettre.toUpperCase()) : brute,
    result: base.result || 'ok',
    reconnu: Boolean(fiche),
  };
}

/** Version lisible d'une liste, dans l'ordre reçu. */
export function describeAudit(entries) {
  return (Array.isArray(entries) ? entries : []).map(describeAuditEntry);
}
