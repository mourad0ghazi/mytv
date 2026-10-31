// server/core/constants.js — référentiels fermés : 18 catégories, qualités, limites, tri.
// Toute valeur hors de ces tables est refusée à l'écriture (ERR-04).

export const VERSION = '3.18.0';
export const SPEC_VERSION = '2.0';

export const CATEGORIES = [
  { id: 'info', label: 'Info & Actualités', short: 'Info' },
  { id: 'sport', label: 'Sport', short: 'Sport' },
  { id: 'cinema', label: 'Cinéma', short: 'Cinéma' },
  { id: 'series', label: 'Séries & Fiction', short: 'Séries' },
  { id: 'enfants', label: 'Jeunesse', short: 'Jeunesse' },
  { id: 'musique', label: 'Musique', short: 'Musique' },
  { id: 'divertissement', label: 'Divertissement', short: 'Divertissement' },
  { id: 'documentaire', label: 'Documentaire', short: 'Documentaire' },
  { id: 'education', label: 'Éducation', short: 'Éducation' },
  { id: 'cuisine', label: 'Cuisine', short: 'Cuisine' },
  { id: 'voyage', label: 'Voyage & Nature', short: 'Voyage' },
  { id: 'sante', label: 'Santé & Bien-être', short: 'Santé' },
  { id: 'sciences', label: 'Sciences & Tech', short: 'Sciences' },
  { id: 'religion', label: 'Religion', short: 'Religion' },
  { id: 'regional', label: 'Régions & Local', short: 'Régions' },
  { id: 'adulte', label: 'Adulte', short: 'Adulte' },
  { id: 'publicite', label: 'Téléachat & Boutique', short: 'Téléachat' },
  { id: 'autre', label: 'Autre', short: 'Autre' },
];

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));

/** Groupes de playlist → catégorie. Le groupe est comparé normalisé (minuscules, sans accents). */
export const GENRE_GROUPS = {
  news: 'info', info: 'info', information: 'info', actualites: 'info', actualite: 'info',
  infos: 'info', noticias: 'info', nachrichten: 'info', journal: 'info', press: 'info',
  أخبار: 'info', إخبارية: 'info',

  sport: 'sport', sports: 'sport', sportsfr: 'sport', football: 'sport', soccer: 'sport',
  tennis: 'sport', golf: 'sport', nba: 'sport', nfl: 'sport', ufc: 'sport', moto: 'sport',
  رياضة: 'sport', رياضي: 'sport',

  movies: 'cinema', movie: 'cinema', cinema: 'cinema', films: 'cinema', film: 'cinema',
  cine: 'cinema', cinéma: 'cinema', أفلام: 'cinema', aflam: 'cinema',

  series: 'series', 'tv series': 'series', drama: 'series', dramas: 'series', fiction: 'series',
  novela: 'series', novelas: 'series', feuilleton: 'series', مسلسلات: 'series', دراما: 'series',

  kids: 'enfants', children: 'enfants', jeunesse: 'enfants', cartoon: 'enfants', cartoons: 'enfants',
  animation: 'enfants', junior: 'enfants', baby: 'enfants', اطفال: 'enfants', أطفال: 'enfants', كرتون: 'enfants',

  music: 'musique', musique: 'musique', musical: 'musique', mtv: 'musique', clips: 'musique',
  radio: 'musique', radios: 'musique', موسيقى: 'musique', اغاني: 'musique', أغاني: 'musique',

  entertainment: 'divertissement', divertissement: 'divertissement', comedy: 'divertissement',
  comedie: 'divertissement', humour: 'divertissement', variety: 'divertissement', show: 'divertissement',
  shows: 'divertissement', family: 'divertissement', ترفيه: 'divertissement',

  documentary: 'documentaire', documentaire: 'documentaire', documentaries: 'documentaire',
  docs: 'documentaire', discovery: 'documentaire', history: 'documentaire', وثائقي: 'documentaire',

  education: 'education', educational: 'education', educationfr: 'education', school: 'education',
  learning: 'education', didactic: 'education', تعليم: 'education', تعليمية: 'education',

  cooking: 'cuisine', cuisine: 'cuisine', food: 'cuisine', culinary: 'cuisine', gastronomie: 'cuisine',
  مطبخ: 'cuisine', طبخ: 'cuisine',

  travel: 'voyage', voyage: 'voyage', voyages: 'voyage', nature: 'voyage', outdoor: 'voyage',
  tourism: 'voyage', weather: 'voyage', meteo: 'voyage', سفر: 'voyage', سياحة: 'voyage',

  lifestyle: 'sante', health: 'sante', sante: 'sante', santé: 'sante', fitness: 'sante',
  wellness: 'sante', yoga: 'sante', صحة: 'sante',

  science: 'sciences', sciences: 'sciences', technology: 'sciences', tech: 'sciences',
  tech24: 'sciences', space: 'sciences', علوم: 'sciences', تكنولوجيا: 'sciences',

  religious: 'religion', religion: 'religion', islam: 'religion', islamic: 'religion',
  quran: 'religion', coran: 'religion', sunnah: 'religion', christian: 'religion',
  church: 'religion', gospel: 'religion', catholic: 'religion', bible: 'religion',
  دين: 'religion', قرآن: 'religion', القرآن: 'religion', اسلامي: 'religion', إسلامي: 'religion',

  regional: 'regional', local: 'regional', regions: 'regional', régional: 'regional',
  provincial: 'regional', city: 'regional', محلي: 'regional', جهوي: 'regional',

  xxx: 'adulte', adult: 'adulte', adulte: 'adulte', adults: 'adulte', erotic: 'adulte',
  porn: 'adulte', '18+': 'adulte',

  shop: 'publicite', shopping: 'publicite', teleshopping: 'publicite', teleshop: 'publicite',
  teleachat: 'publicite', téléachat: 'publicite', qvc: 'publicite', بيع: 'publicite', تسوق: 'publicite',
};

/** Groupes génériques : ils n'apportent aucune information de genre, on passe à l'étape suivante. */
export const GENERIC_GROUPS = new Set([
  'general', 'generale', 'général', 'générale', 'misc', 'miscellaneous', 'other', 'others',
  'autre', 'autres', 'undefined', 'null', 'none', 'divers', 'tv', 'television', 'chaînes',
  'channels', 'chaines', 'default', 'all', 'public', 'عام', 'عامة',
]);

/** Indices de genre portés par le tvg-id (suffixe ou segment). */
export const TVG_GENRE_HINTS = {
  news: 'info', sport: 'sport', sports: 'sport', kids: 'enfants', movies: 'cinema',
  cinema: 'cinema', music: 'musique', documentary: 'documentaire', education: 'education',
  cooking: 'cuisine', travel: 'voyage', lifestyle: 'sante', religious: 'religion',
};

export const QUALITIES = ['SD', 'HD', 'FHD', '4K', '8K', 'AUTO'];
export const QUALITY_RANK = { AUTO: 0, SD: 1, HD: 2, FHD: 3, '4K': 4, '8K': 5 };

export const SORTS = ['number', 'name', 'category', 'recent', 'confidence', 'quality'];

export const LIMITS = {
  maxBodyPublic: 1024,
  maxBodyAdmin: 256 * 1024,
  maxBodyImport: 20 * 1024 * 1024,
  pageSizeDefault: 48,
  pageSizeMin: 12,
  pageSizeMax: 60,
  maxPage: 10000,
  maxFeatured: 8,
  maxVariants: 6,
  fetchTimeoutMs: 20000,
  fetchMaxBytes: 20 * 1024 * 1024,
  importMaxMs: 120000,
  probeConcurrency: 8,
  probeTimeoutMs: 6000,
  probePerMinute: 300,
  downAfterFailures: 3,
  sessionsMax: 5,
  loginFailsMax: 8,
  loginWindowMs: 15 * 60 * 1000,
  auditRetentionDays: 90,
  backupDaily: 7,
  backupWeekly: 4,
  domCardsMax: 120,
  searchMinLength: 1,
  searchMaxLength: 80,
  nameMax: 80,
  groupMax: 120,
  urlMax: 2048,
  logoMax: 512,
  notesMax: 500,
  tagMax: 24,
  reportsSuppression: 1000,
  reportsPerHour: 5,
  reportMessageMax: 900,
};

export const SORT_LABELS = {
  number: 'Numéro de chaîne',
  name: 'Nom',
  category: 'Catégorie',
  recent: 'Ajout récent',
  confidence: 'Confiance de classement',
  quality: 'Qualité',
};

export const LICENSE_NOTES = [
  'libre accès public',
  'accord de distribution',
  'catalogue propre',
  'retiré — demande de tiers',
];

export const QUALITY_LABELS = { AUTO: 'Automatique', SD: 'SD', HD: 'HD', FHD: 'Full HD', '4K': '4K', '8K': '8K' };
