// public/js/views/legal.js · pages d'information : mentions, confidentialité, signalement, aide, messages.
// Aucune de ces pages ne modifie l'état du site : elles sont lisibles hors connexion après un premier passage.

import { Public } from '../api.js?v=3.18.0';
import { COPY } from '../copy.js?v=3.18.0';
import { h, icon, fmtDate, toast, copyText } from '../ui.js?v=3.18.0';
import { ERRORS_CODES, catalogCount, loadMessageCatalog } from './error-codes.js?v=3.18.0';

const UPDATED = '2026-10-25';

/** Adresse de contact : celle de l'instance si elle en déclare une, aucune sinon. */
function contactOf(config) {
  return String(config?.legal?.contact || '').trim();
}

function page(title, eyebrow, sections, { config } = {}) {
  const brand = config?.brand || 'StreamTV';
  return h('div', { class: 'view' },
    h('div', { class: 'section-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, eyebrow),
        h('h1', { style: { fontSize: 'clamp(28px,4vw,38px)' } }, title)),
      h('span', { class: 'badge' }, icon('clock', 12), `Mise à jour le ${fmtDate(UPDATED)}`)),
    h('div', { class: 'prose', style: { maxWidth: '74ch' } }, sections),
    h('div', { class: 'toolbar', style: { marginTop: '32px' } },
      h('a', { class: 'btn btn-ghost btn-sm', href: '/', 'data-link': '' }, icon('chevron', 14, 'style="transform:rotate(180deg)"'), COPY.actions.backHome),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/aide', 'data-link': '' }, 'Aide & raccourcis'),
      h('span', { class: 'count-label', style: { marginLeft: 'auto' } }, `${brand} · document public`)));
}

const section = (title, ...content) => h('section', { style: { marginTop: '28px' } },
  h('h2', { style: { fontSize: '20px', marginBottom: '10px' } }, title),
  ...content);

const paragraph = (text, className = '') => h('p', { class: className, text });
const list = (items) => h('ul', { class: 'prose-list' }, items.map((item) => h('li', { text: item })));

export function renderLegal(container, ctx) {
  const config = ctx.config;
  container.replaceChildren(page('Mentions légales', 'Cadre juridique', [
    paragraph(config.legal?.mention || COPY.legal.mention),
    section('Éditeur du site',
      paragraph(contactOf(config)
        ? `Le catalogue ${config.brand} est édité par un éditeur indépendant. Contact : ${contactOf(config)}.`
        : `Le catalogue ${config.brand} est édité par un éditeur indépendant. Cette installation ne publie pas d’adresse de contact : le formulaire de signalement reste le canal officiel.`),
      paragraph('Directeur de la publication : l’éditeur. Hébergement : infrastructure mutualisée de l’éditeur, Union européenne.')),
    section('Nature du service',
      paragraph('StreamTV est un catalogue de liens : il référence des adresses de flux publiées par leurs ayants droit ou par des sources tierces.'),
      paragraph('Aucun fichier vidéo n’est hébergé, enregistré, transcodé ou retransmis par ce service. Le lecteur se connecte directement à la source.')),
    section('Propriété intellectuelle',
      paragraph('Les marques, noms et logos des chaînes appartiennent à leurs propriétaires respectifs. Leur présence dans le catalogue est descriptive et informative.'),
      paragraph('Le code, les textes et l’identité visuelle du site sont protégés. Toute reproduction intégrale sans autorisation est interdite.')),
    section('Responsabilité',
      paragraph('Le catalogue peut évoluer, être incomplet ou contenir des liens devenus indisponibles : l’éditeur ne garantit ni la disponibilité ni la conformité des flux tiers.'),
      paragraph('Chaque chaîne porte une justification des droits dans le catalogue. Une chaîne sans justification est masquée.')),
    section('Signalement et retrait',
      paragraph('Tout signalement est enregistré immédiatement et examiné sous 72 heures ouvrées. La chaîne est retirée dès que le signalement est confirmé. Une chaîne signalée 1000 fois est retirée automatiquement.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '/signaler', 'data-link': '' }, icon('alert', 14), 'Ouvrir la procédure de signalement')),
    section('Crédits techniques',
      paragraph('Node.js 20, modules natifs uniquement. Client HTML/CSS/JS en modules ES, sans cadriciel ni bundler. hls.js 1.5.17, bibliothèque libre (Apache-2.0), incluse dans le dépôt.'),
      paragraph('Listes de chaînes et métadonnées de démonstration : iptv-org, publiées sous licence CC0.')),
  ], { config }));
  return () => {};
}

export function renderPrivacy(container, ctx) {
  container.replaceChildren(page('Confidentialité', 'Vos données', [
    paragraph('Cette version de StreamTV ne crée aucun compte visiteur et ne dépose aucun traceur.'),
    section('Ce qui reste sur votre appareil',
      list([
        'Vos favoris, votre historique de lecture, le volume et les dernières recherches.',
        'Ces données sont stockées dans le stockage local de votre navigateur, sous le préfixe « streamtv. ».',
        'Elles ne sont jamais envoyées au serveur et ne sont pas synchronisées entre appareils.',
        'Les vider est immédiat depuis la page Favoris (« Vider ») ou en effaçant les données du site.',
      ])),
    section('Ce que le serveur enregistre',
      list([
        'Des journaux techniques sans adresse IP pour les visiteurs : méthode, adresse, code de réponse, durée. Conservation 14 jours.',
        'Le journal d’audit des actions d’administration (horodatage, action, identifiants de chaînes) : conservation 90 jours, adresse IP incluse pour la sécurité.',
        'Aucun contenu regardé, aucune recherche, aucun identifiant publicitaire.',
      ])),
    section('Cookies et stockage',
      list([
        'Aucun cookie de mesure d’audience, aucun cookie publicitaire, aucun bouton social tiers.',
        'Le service worker conserve les fichiers du site et les réponses publiques du catalogue pour l’affichage hors ligne.',
        'La session d’administration utilise le stockage de session du navigateur : elle disparaît à la fermeture de l’onglet.',
      ])),
    section('Vos droits',
      paragraph('Vous pouvez lire, exporter ou supprimer les données locales à tout moment : elles sont visibles dans l’onglet Stockage de votre navigateur, et les boutons « Vider » les effacent.'),
      paragraph(contactOf(ctx.config)
        ? `Pour les journaux d’audit et toute question : ${contactOf(ctx.config)}. Réponse sous 30 jours.`
        : 'Pour les journaux d’audit et toute question, utilisez le formulaire de signalement : il laisse une trace horodatée, consultable par l’éditeur.')),
    section('Sécurité',
      list([
        'Mot de passe administrateur protégé par scrypt (N=16384, r=8, p=1) et sel aléatoire de 128 bits.',
        'Jeton de session 48 caractères hexadécimaux, durée de vie glissante de 12 heures, cinq sessions simultanées au maximum.',
        'En-têtes de sécurité stricts : CSP, HSTS, nosniff, frame-ancestors, Permissions-Policy.',
      ])),
  ], { config: ctx.config }));
  return () => {};
}

export function renderReport(container, ctx) {
  const config = ctx.config || {};
  const contact = contactOf(config);
  const channelName = ctx.query.chaine || '';
  const input = h('input', { type: 'text', id: 'report-channel', value: channelName, maxlength: '120', required: true });
  const url = h('input', { type: 'url', id: 'report-url', placeholder: 'https://…', maxlength: '300' });
  const email = h('input', { type: 'email', id: 'report-email', placeholder: 'vous@exemple.fr', maxlength: '120' });
  const reason = h('select', { id: 'report-reason' },
    [['droits', 'Droits d’auteur'], ['illicite', 'Contenu illicite'], ['flux', 'Flux indisponible'], ['categorie', 'Mauvaise catégorie'], ['autre', 'Autre']]
      .map(([value, label]) => h('option', { value }, label)));
  const message = h('textarea', { id: 'report-message', maxlength: '900', placeholder: 'Précisez le motif, la chaîne et la date constatée.' });
  const result = h('div', { class: 'banner', dataset: { tone: 'info' }, hidden: true, role: 'status' });
  const demo = Boolean(config.demo);
  const submit = h('button', {
    class: 'btn btn-primary', type: 'submit', disabled: demo ? 'disabled' : null,
    title: demo ? 'La démonstration statique ne peut pas enregistrer de signalement.' : '',
  }, icon('alert', 16), demo ? 'Indisponible en démonstration' : 'Envoyer le signalement');
  const demoNotice = demo
    ? h('div', { class: 'banner', dataset: { tone: 'info' } },
      icon('alert', 16),
      h('div', {}, h('p', { text: 'Cette page est une démonstration statique : aucun signalement n’est enregistré ici.' }),
        h('p', { class: 'muted', style: { fontSize: '13px' } },
          'Sur une installation complète, le formulaire enregistre le signalement avec une référence de suivi et alimente la file de l’administration.')))
    : null;

  const form = h('form', { novalidate: true },
    h('div', { class: 'form-row' },
      h('div', { class: 'field' }, h('label', { for: 'report-channel' }, 'Chaîne concernée'), input),
      h('div', { class: 'field' }, h('label', { for: 'report-reason' }, 'Motif'), reason)),
    h('div', { class: 'form-row' },
      h('div', { class: 'field' }, h('label', { for: 'report-url' }, 'Adresse du flux (facultatif)'), url),
      h('div', { class: 'field' }, h('label', { for: 'report-email' }, 'Votre adresse (facultatif)'), email)),
    h('div', { class: 'field' }, h('label', { for: 'report-message' }, 'Précisions'), message),
    h('p', { class: 'help' }, 'Le signalement est enregistré sur ce serveur, avec une référence de suivi. Aucune adresse IP complète n’est conservée, seulement une empreinte pour éviter les doublons.'),
    h('div', { class: 'toolbar', style: { marginTop: '12px' } }, submit),
    result);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) {
      toast('Indiquez le nom de la chaîne concernée.', { tone: 'error' });
      input.focus();
      return;
    }
    submit.disabled = true;
    try {
      const reponse = await Public.report({
        name: input.value.trim(),
        reason: reason.value,
        message: message.value,
        email: email.value,
      });
      result.hidden = false;
      result.dataset.tone = reponse.deleted ? 'warn' : 'ok';
      result.replaceChildren(icon(reponse.deleted ? 'alert' : 'check', 16), h('div', {},
        h('p', { text: reponse.message }),
        h('p', { class: 'muted', style: { fontSize: '13px' } },
          `Référence ${reponse.ref} · ${reponse.count} signalement${reponse.count > 1 ? 's' : ''} sur un seuil de ${reponse.threshold}.`),
        h('p', { class: 'muted', style: { fontSize: '13px' } },
          'Le retrait intervient après vérification, sous 72 heures ouvrées. Une chaîne qui atteint le seuil est retirée immédiatement.'),
        h('button', {
          class: 'btn btn-quiet btn-sm', type: 'button',
          onClick: async () => {
            const done = await copyText(reponse.ref);
            toast(done ? 'Référence copiée.' : 'Copie impossible.', { tone: done ? 'success' : 'error' });
          },
        }, icon('copy', 14), 'Copier la référence')));
      form.reset();
    } catch (error) {
      result.hidden = false;
      result.dataset.tone = 'danger';
      result.replaceChildren(icon('alert', 16), h('div', {},
        h('p', { text: error.message || 'Le signalement n’a pas pu être enregistré.' }),
        contact
          ? h('p', { class: 'muted', style: { fontSize: '13px' } }, `Vous pouvez aussi écrire à ${contact}.`)
          : h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Réessayez dans un instant ; si le problème persiste, prévenez l’éditeur du site.')));
    } finally {
      submit.disabled = false;
    }
  });

  const contactBlock = contact
    ? section('Contact direct', paragraph(`Si le formulaire ne fonctionne pas, écrivez à ${contact} en indiquant le nom exact de la chaîne, son numéro et le motif.`))
    : section('Contact direct', paragraph('Cette installation ne publie pas d’adresse de contact. Utilisez le formulaire : il enregistre votre signalement sur le serveur et vous rend une référence de suivi.'));

  container.replaceChildren(page('Signaler un contenu', 'Retrait sous 72 heures', [
    paragraph('Un doute sur les droits d’un flux, un contenu illicite ou une chaîne mal classée ? Ce canal est prioritaire et documenté.'),
    section('Ce que nous faisons', list([
      'Le signalement est enregistré immédiatement avec une référence de suivi, sans être appliqué.',
      'Le retrait est décidé après vérification, sous 72 heures ouvrées, et journalisé avec la date et l’identifiant de la chaîne.',
      `Une chaîne qui atteint ${new Intl.NumberFormat('fr-FR').format(config.reportThreshold || 1000)} signalements est retirée automatiquement du catalogue.`,
      'Une suppression reste réversible : la fiche est conservée et peut être rétablie.',
    ])),
    demoNotice,
    section('Formulaire', form),
    contactBlock,
  ], { config }));
  return () => {};
}

export function renderHelp(container, ctx) {
  const config = ctx.config;
  container.replaceChildren(page('Aide & raccourcis', 'Mode d’emploi', [
    paragraph('StreamTV se pilote au clavier comme à la télécommande. Tout ce qui suit fonctionne sur ordinateur, tablette et téléphone.'),
    section('Les quatre gestes utiles', list([
      'Chercher : la barre accepte les accents, les apostrophes, l’arabe et les numéros de chaîne. « cafe » trouve « Café ».',
      'Filtrer : les pastilles de catégories se combinent avec le tri et la pagination.',
      'Regarder : un clic sur une carte lance la lecture en superposition ; Échap ferme le lecteur.',
      'Retrouver : le cœur range la chaîne dans vos favoris, sur cet appareil uniquement. Le bouton « Mes favoris » filtre tout le catalogue.',
    ])),
    section('Raccourcis du lecteur',
      h('div', { class: 'rows' }, COPY.player.shortcuts.map(([keys, label]) => h('div', { class: 'variant' },
        h('span', { class: 'kbd', text: keys }), h('span', { class: 'muted', text: label }))))),
    section('Raccourcis généraux', list([
      '/ : placer le curseur dans la recherche',
      '? : afficher la liste des raccourcis',
      'Échap : fermer une fenêtre, puis le lecteur',
      'Les raccourcis sont ignorés pendant la saisie dans un champ de texte.',
    ])),
    section('Questions fréquentes',
      h('h3', { style: { marginTop: '12px' } }, 'Une chaîne affiche « non testée »'),
      paragraph('Aucune sonde n’a encore mesuré ce flux. Ce n’est pas une erreur : lancez une sonde depuis l’administration, onglet Santé.'),
      h('h3', { style: { marginTop: '12px' } }, '« Chaîne non lisible sur ce site »'),
      paragraph('Le flux est diffusé en HTTP alors que le site est en HTTPS : le navigateur bloque ce mélange. La mire propose la chaîne suivante ou la copie du lien pour un lecteur externe.'),
      h('h3', { style: { marginTop: '12px' } }, 'Le catalogue affiche moins de chaînes que le nombre total'),
      paragraph('Certaines chaînes sont masquées : catégorie adulte ou décision du propriétaire. Le badge « chaînes masquées » donne le compte exact et le lien vers le réglage.'),
      h('h3', { style: { marginTop: '12px' } }, 'Pourquoi les favoris ne suivent-ils pas d’un appareil à l’autre ?'),
      paragraph('Ils sont stockés localement, sans compte : c’est le choix de confidentialité de cette version.')),
    section('Installer sur l’écran d’accueil',
      paragraph('StreamTV s’installe comme une application : plein écran, icône sur l’écran d’accueil, aucune boutique, aucun compte.'),
      h('div', { class: 'install-row' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', id: 'install-btn', hidden: true }, 'Installer l’application')),
      h('p', { class: 'install-note', text: 'Android et ordinateur : touchez le bouton ci-dessus, ou le menu du navigateur puis « Installer l’application ». iPhone et iPad : bouton Partager, puis « Sur l’écran d’accueil ». Télévision : le mode télévision s’active seul sur Android TV, Tizen et webOS ; sinon ouvrez le site avec ?tv=1.' })),
    section('Mode télévision', list([
      'Flèches : déplacer le focus. OK : ouvrir la chaîne ou lancer la lecture.',
      'Retour : revenir à la page précédente. Échap : fermer le lecteur.',
      'Chiffres : taper le numéro d’une chaîne lance sa lecture.',
      'Texte agrandi, cibles de 56 px minimum et focus visible de 3 px.',
    ])),
    section('Accessibilité',
      list([
        'Navigation complète au clavier, focus visible de 3 px, ordre de tabulation logique.',
        'Contrastes conformes AA : texte principal sur fond sombre, textes secondaires ≥ 4,5:1.',
        'Aucun texte inférieur à 12 px, cibles tactiles de 44 px minimum.',
        'Animations désactivées si votre système le demande (prefers-reduced-motion).',
        'Lecteur d’écran : chaque changement de page est annoncé, chaque image décorative est ignorée.',
      ])),
    section('Besoin d’aide ?',
      paragraph(contactOf(ctx.config)
        ? `Écrivez à ${contactOf(ctx.config)} ou consultez le catalogue des messages dans la page « Erreurs ».`
        : 'Consultez le catalogue des messages dans la page « Erreurs », ou passez par le formulaire de signalement.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '/erreurs', 'data-link': '' }, icon('alert', 14), 'Catalogue des messages')),
  ], { config }));
  return () => {};
}


function messageFamilySection(family) {
  const heading = `${family.label} · ${family.messages.length} message${family.messages.length > 1 ? 's' : ''}`;
  const rows = family.messages.map((entry) => h('tr', {},
    h('td', { class: 'tabular' }, entry.id),
    h('td', { dir: 'auto' }, entry.text),
    h('td', { class: 'muted', dir: 'auto' }, entry.cause || 'Non renseigné')));
  return section(heading,
    paragraph(family.promise, 'muted'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Message affiché'), h('th', {}, 'Déclencheur'))),
      h('tbody', {}, rows))));
}

export async function renderErrors(container, ctx) {
  const mires = Object.values(COPY.player.mires);
  let catalog = { total: 0, families: [] };
  let catalogError = '';
  try {
    catalog = await loadMessageCatalog();
  } catch (error) {
    catalogError = error?.message || 'Le catalogue des messages n’a pas pu être chargé.';
  }
  const loaded = catalogCount(catalog);
  const families = catalog.families.filter((family) => family.messages.length);
  // L'affichage précède le chargement : la table des 20 codes reste lisible même hors ligne.
  container.replaceChildren(page('Catalogue des messages', 'Transparence', [
    paragraph('Chaque message du site porte un code stable, une cause unique et au moins une action possible. Les textes ci-dessous sont les textes affichés, mot pour mot.'),
    section('Règle d’or',
      paragraph('Aucune erreur n’est affichée sans action concrète : changer de chaîne, réessayer, copier le lien, signaler, ou revenir au catalogue.')),
    section('Les six familles du catalogue',
      paragraph('Les erreurs ne sont pas rangées par gravité mais par endroit où elles se produisent : c’est ce qui permet de retrouver la bonne page, puis le bon code.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Famille'), h('th', {}, 'Préfixe'), h('th', {}, 'Messages'), h('th', {}, 'Ce qu’elle couvre'))),
        h('tbody', {}, [
          ...catalog.families.map((family) => h('tr', {},
            h('td', { dir: 'auto' }, family.label),
            h('td', { class: 'tabular' }, family.messages[0]?.id?.replace(/\d+$/, '') || 'Non renseigné'),
            h('td', { class: 'tabular' }, String(family.messages.length)),
            h('td', { class: 'muted', dir: 'auto' }, family.promise))),
        ]))),
      catalogError
        ? h('div', { class: 'banner', dataset: { tone: 'danger' }, role: 'status' },
          icon('alert', 16),
          h('p', { text: `Le détail des messages n’a pas pu être chargé : ${catalogError}` }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => renderErrors(container, ctx) }, icon('retry', 14), 'Réessayer'))
        : h('p', { class: 'count-label', style: { marginTop: '12px' } },
          `${loaded} message${loaded > 1 ? 's' : ''} documenté${loaded > 1 ? 's' : ''} sur ${catalog.total || loaded}`)),
    ...families.map(messageFamilySection),
    section('Lecteur · les 12 mires',
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Titre'), h('th', {}, 'Cause'), h('th', {}, 'Action'))),
        h('tbody', {}, mires.map((mire) => h('tr', {},
          h('td', { class: 'tabular' }, mire.code),
          h('td', { dir: 'auto' }, mire.title),
          h('td', { class: 'muted' }, mire.explanation),
          h('td', { class: 'muted' }, mire.actions.join(' · ')))))))),
    section('Service · les 20 codes d’erreur',
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Statut'), h('th', {}, 'Message'))),
        h('tbody', {}, ERRORS_CODES.map((entry) => h('tr', {},
          h('td', { class: 'tabular' }, entry.code),
          h('td', { class: 'tabular' }, String(entry.status)),
          h('td', { dir: 'auto' }, entry.message))))))),
    section('Trois niveaux de protection',
      list([
        'Le client : messages français, aucune trace technique, actions directes.',
        'L’API : codes opposables, identifiant de requête pour le support, champ fautif indiqué.',
        'Le serveur : validation en sept étapes, journal d’audit, écriture atomique, sauvegardes vérifiées.',
      ])),
    section('Signaler un message inattendu',
      paragraph('Copiez l’identifiant de requête affiché avec le message et envoyez-le avec le formulaire de signalement.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '/signaler', 'data-link': '' }, icon('alert', 14), 'Signaler')),
  ], { config: ctx.config }));
  return () => {};
}
