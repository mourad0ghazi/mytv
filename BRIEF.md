# StreamTV, la commande complète

Un seul document. Rien n'est renvoyé à une autre page, rien n'est laissé pour plus tard
sans être nommé. Celui qui exécute lit ceci du début à la fin et fait tout, dans l'ordre
indiqué à la fin. Une difficulté se dit avec son coût ; elle ne se supprime jamais en
silence.

Version en cours : **3.14.0**. Dernière mise en ligne publique :
`https://mourad0ghazi.github.io/myiptv/`.

---

## 1. La demande, adressée à celui qui construit

Vous construisez un site de télévision en ligne et sa console d'administration, pour un
seul propriétaire : Mourad. Le site montre des chaînes, se regarde au doigt sur un
téléphone, et se comporte comme un service payant alors qu'il est gratuit. La console sert
à piloter le catalogue, les gens, les accès et la santé des flux, depuis un ordinateur,
sans jamais exposer son existence à un tiers.

Deux parties, une seule application :

1. **La partie publique**, que tout le monde voit et utilise.
2. **La console**, privée, introuvable par un tiers, réservée au propriétaire.

Elles partagent le même serveur, les mêmes données et le même design. Elles ne partagent
pas la même exigence de discrétion.

Ce que vous devez livrer n'est pas une maquette ni une première version partielle : c'est
l'ensemble décrit ici, qui fonctionne, sans dépendance à installer, sans écran vide et
sans bouton mort.

---

## 2. Le récit, dans l'ordre où les demandes sont venues

1. Une refonte d'affichage : rien de superposé à l'affiche, trois chaînes par ligne sur
   téléphone, un design de la famille Netflix et Apple TV, avec des films et des animes
   arabes.
2. Une console d'administration professionnelle, liée au téléphone de travail, cachée
   derrière un chemin secret, avec le contrôle total et un diagnostic.
3. Un lecteur où aucun bouton ne mente.
4. Un catalogue public publié sur GitHub Pages, la console sur ordinateur, et une
   application installable (PWA), pas d'APK ni d'IPA.
5. Un accès protégé par un code envoyé à `M.0urad@yahoo.com`.
6. Un compte nominatif pour Mourad, avec son nom, son adresse et son rôle.
7. Un domaine, en attente d'un nom réellement disponible.
8. Un document unique, avec ses prix.
9. Puis ce document-ci, qui commande de tout faire.

Trois phrases ont valeur de test, parce qu'elles ont été dites comme des tests :

- « Cette phrase est un test, pas une intention » : trois chaînes par ligne sur téléphone.
  Si l'écran en montre quatre, la livraison est fausse.
- « Comme Netflix » : mêmes options, même qualité, au téléphone comme sur l'ordinateur.
  La version ordinateur est la même page, plus dense et plus lisible. Pas de filtres
  latéraux, pas de bascule grille/liste, pas de tableau de bord éditorial.
- « Rien de superposé à l'affiche » : aucun bouton, badge ou contrôle ne se pose sur
  l'image d'une chaîne. Le programme se lit sans survol, à cause du doigt.

---

## 3. La partie publique

### 3.1 Les sept règles

1. **Aucun contrôle sur l'affiche.** L'image d'une chaîne reste une image. Le nom, la
   catégorie et l'état du flux vivent sous l'image, jamais dessus.
2. **Trois chaînes par ligne sur téléphone**, jusqu'à 619 px de large. Quatre de 620 à
   899 px, six au-delà. Une affiche carrée, un nom sur deux lignes au plus.
3. **Lisible sans survol.** Aucune information capitale ne dépend d'un état de souris.
4. **Un seul accent**, une famille de gris, un rayon, une bordure, une échelle de 4 px,
   aucun texte sous 12 px. Pas de dégradé, pas d'ombre sur ce qui ne flotte pas, pas de
   pastille teintée, pas d'icône décorative, pas d'emoji d'interface.
5. **Pas de couleur par catégorie.** Une catégorie est un mot, pas une teinte.
6. **Le temps réel plutôt que la promesse.** Un rail ne s'affiche que s'il a du contenu ;
   un état vide dit pourquoi et propose l'action qui le remplit.
7. **Tout au clavier comme au doigt.** Focus visible, cibles de 44 px, aucune action
   réservée au survol.

### 3.2 Les ajouts A1 à A8

| N° | Ajout | Ce que cela veut dire concrètement | État |
|----|-------|------------------------------------|------|
| A1 | Accueil utile dès la première visite | Bandeau du moment, puis rails : continuer à regarder, pour vous, ce soir, par pays. Un rail vide disparaît. | Fait depuis la 3.10.0 |
| A2 | Trois colonnes au téléphone | Grille 3/4/6, affiche carrée, aucun chevauchement. Vérifié par test de design et par capture. | Fait depuis la 3.10.0 |
| A3 | Filtres qui ne laissent pas dans le vide | Pays, langue, qualité combinables. Si la combinaison ne donne rien, l'écran nomme chaque filtre actif et propose de le retirer un par un. | **Fait en 3.14.0** |
| A4 | Recherche tolérante | Sans accents ni majuscules, avec suggestions quand aucun résultat ne sort, et un état vide qui propose un mot voisin. | Fait depuis la 3.11.0 |
| A5 | Lecteur honnête | Lecture, pause, son, plein écran, qualité, chaîne suivante. Aucun bouton sans effet : ce qui n'est pas disponible n'est pas affiché. | Fait depuis la 3.12.0 |
| A6 | Signalements | Depuis une chaîne, un signalement en deux gestes. Au-delà de 1 000 signalements, retrait immédiat ; en dessous, retrait après confirmation du propriétaire. | Fait depuis la 3.12.0 |
| A7 | PWA installable | Manifeste, icônes, service worker, mode hors ligne partiel, mode TV. Aucun APK, aucun IPA. | Fait depuis la 3.12.0 |
| A8 | Mentions et licence | Chaque flux affiche sa provenance. beIN Sports n'apparaît qu'avec un flux officiel gratuit, jamais depuis un annuaire de revente, avec la note de licence correspondante. | Fait depuis la 3.13.0 |

---

## 4. La console privée

### 4.1 Les sept règles

1. **Introuvable par un tiers.** Aucun lien public ne mène à la console. Le chemin est un
   slug de 8 à 40 caractères, modifiable, jamais deviné, jamais listé dans un plan de site.
2. **Fermée par défaut.** Mot de passe, puis code à six chiffres envoyé par e-mail quand
   cette protection est active. Cinq essais, dix minutes, puis refus temporisé.
3. **Vérifiée par le serveur.** Chaque règle affichée à l'écran est appliquée par l'API.
   Masquer un bouton ne protège rien : l'appel direct doit échouer aussi.
4. **Chaque action laisse une trace lisible.** Le journal dit ce qui s'est passé, en
   français, avec l'heure et l'auteur. Un code technique n'est jamais la seule trace.
5. **Le travail se fait sur un appareil autorisé.** Jusqu'à huit appareils, un verrou
   activable, une révocation immédiate.
6. **Aucune destruction sans retour.** Toute suppression est réversible pendant la fenêtre
   de rétention ; une sauvegarde se restaure depuis l'écran.
7. **Une seule manière de faire chaque chose.** Un onglet, une action, un bouton nommé
   comme l'action.

### 4.2 Les ajouts B1 à B10

| N° | Ajout | Ce que cela veut dire concrètement | État |
|----|-------|------------------------------------|------|
| B1 | Journal en phrases | Les 37 codes émis deviennent des phrases, avec heure, auteur et ton. Un code inconnu reste visible, qualifié d'action technique. | **Fait en 3.14.0** |
| B2 | Premier lancement | Quatre étapes : votre nom, votre mot de passe, le code de connexion, cet appareil. Le passage est obligatoire tant que le mot de passe de démonstration vit. | **Fait en 3.14.0** |
| B3 | Nom du propriétaire partout | « Console de Mourad », signature du journal, plus jamais le mot « admin » comme nom d'auteur. | **Fait en 3.14.0** |
| B4 | Diagnostic actionnable | Score sur 100, constats classés critique, avertissement, information, chacun avec le lien qui corrige. | Fait depuis la 3.12.0 |
| B5 | Rôles réels | Cinq rôles, dix permissions, appliqués par le serveur sur chaque route. | Fait depuis la 3.13.0 |
| B6 | Appareils et verrou | Huit appareils, appareil courant signalé, révocation immédiate. | Fait depuis la 3.12.0 |
| B7 | Sauvegardes | Sauvegarde manuelle, planifiée, restauration avec contrôle d'intégrité. | Fait depuis la 3.11.0 |
| B8 | Importation maîtrisée | Aperçu avant engagement, rapport ligne par ligne, retour arrière possible. | Fait depuis la 3.11.0 |
| B9 | Accès par lien | Jeton de 64 caractères, empreinte seule en base, rôle porté par le lien, durée et nombre d'ouvertures, révocation. | Fait depuis la 3.13.0 |
| B10 | Aucun écran muet | Chaque vue dit ce qu'elle fait, ce qui manque et quoi faire ensuite, y compris le premier lancement. | **Fait en 3.14.0** |

---

## 5. Les onze onglets de la console

| Onglet | Ce qu'on y fait | Ce que l'écran doit dire |
|--------|-----------------|--------------------------|
| **Pilotage** | Vue d'ensemble : catalogue, visibilité, santé, sessions, journal récent. | Combien, et surtout ce qui ne va pas, avec le lien vers la correction. |
| **Catalogue** | Chercher, filtrer, éditer une chaîne, choisir les vedettes, masquer en lot. | Le nombre exact avant l'action, et le résultat après. |
| **Chaînes et liens** | Le flux de chaque chaîne : adresse, qualité, pays, langue, dernier contrôle. | L'état du flux, pas seulement son adresse. |
| **Signalements** | Traiter les signalements reçus, confirmer, rejeter, retirer. | Le seuil de retrait automatique et le compte courant. |
| **Importation** | Charger un fichier M3U, prévisualiser, importer, annuler. | Ce qui va entrer, ce qui va être ignoré et pourquoi. |
| **Réglages** | Les 21 clés : marque, accroche, accent, logo, pagination, tri, catégorie adulte, vedettes, bandeau, guide, note de pied, maintenance, objectif, seuil de confiance, suffixe de titre, chemin secret, verrou d'appareil, adresse du code, nom du propriétaire, et les deux qui suivent leur propre écran. | Le nom de chaque réglage en français, jamais sa clef technique. |
| **Santé** | Douze seuils surveillés, dernier contrôle, latence, erreurs. | Ce qui est cassé, depuis quand, et quoi faire. |
| **Sauvegardes** | Créer, télécharger, restaurer, vérifier. | La date, la taille, l'intégrité, et le risque d'une restauration. |
| **Équipe** | Cinq rôles, dix permissions, ajout d'un collaborateur par nom et adresse. | Ce que le rôle autorise, en clair, avant l'envoi. |
| **Appareils** | Huit appareils, verrou, révocation. | Lequel est celui depuis lequel vous travaillez. |
| **Accès** | Liens d'entrée temporaires, rôle, durée, ouvertures, révocation. | Que le lien ne s'affiche qu'une fois, et pourquoi. |

---

## 6. L'accès privé

- **Chemin secret** : `/` suivi d'un slug de 8 à 40 caractères, modifiable dans Réglages,
  qui casse immédiatement les anciens signets. Valeur livrée : `console-privee`, à changer.
- **Mot de passe** : douze caractères au moins, une lettre, un chiffre. Changer le mot de
  passe ferme toutes les autres sessions.
- **Code par e-mail** : six chiffres, dix minutes, cinq essais, envoyé à l'adresse du
  propriétaire. L'envoi exige un serveur SMTP configuré ; sans configuration, le code
  n'est pas promis, l'écran le dit.
- **Lien d'accès** : 64 caractères, une seule ou une poignée d'ouvertures, de 15 minutes à
  7 jours, rôle porté par le lien, empreinte SHA-256 seule en base, 20 liens actifs au
  maximum, révocation immédiate.
- **Cookie de session** : 24 heures, `HttpOnly`, `SameSite=Strict`, `Secure` dès que le
  site est en HTTPS.
- **Appareil de travail** : jusqu'à 8 appareils, verrou activable, révocation unitaire.

---

## 7. Les règles non négociables

1. **Zéro dépendance d'exécution.** Node.js natif, aucun paquet en `dependencies`. Les
   outils de test et de capture ne comptent pas : ils ne partent pas en production.
2. **900 lignes au maximum par fichier.** Au-delà, on sépare avant d'ajouter.
3. **Le nombre de tests ne baisse jamais.** Chaque ajout vient avec ses tests, écrits en
   même temps, et chaque test échoue vraiment quand la fonctionnalité manque.
4. **Aucun texte d'attente.** Pas de « à venir », pas de TODO, pas de bouton qui ne fait
   rien, pas de libellé technique affiché à l'utilisateur.
5. **Aucun contrôle superposé à l'affiche.**
6. **Trois chaînes par ligne sur téléphone.** C'est un test, pas une intention.
7. **Vérification côté serveur** de chaque réglage et de chaque exigence d'administration.
8. **Aucun flux de revente.** beIN Sports et équivalents : flux officiel gratuit
   uniquement, avec note de licence, sinon absence.
9. **Signalement** : plus de 1 000, retrait immédiat ; en dessous, retrait après
   confirmation du propriétaire.
10. **Langue** : les écrans, les erreurs et les phrases du journal sont en français.

---

## 8. L'exploitation, et ce que cela coûte

| Poste | Coût | Remarque |
|-------|------|----------|
| Hébergement du catalogue public (GitHub Pages) | 0 € | Déjà en place, publication en une minute. |
| Nom de domaine `.com` | 10 à 15 € par an | En attente d'un nom disponible ; « IPTV.com » n'est pas achetable. |
| Certificat HTTPS (Let's Encrypt) | 0 € | Automatique sur un serveur avec nom de domaine. |
| Serveur applicatif (petit, 512 Mo, Fly.io) | 0 à 5 $ par mois | Suffit pour la console et l'API ; le site public reste statique. |
| Serveur applicatif (Render, offre starter) | environ 7 $ par mois | Plus simple à administrer, un peu plus cher. |
| Tunnel gratuit pour exposer la console depuis un PC | 0 € | Solution de travail, pas de production. |
| Mot de passe applicatif Yahoo pour l'envoi du code | 0 € | Obligatoire : le mot de passe principal ne fonctionne pas. |

Trois choses ne s'achètent pas et doivent être dites : un compte ne se crée pas à la place
de son propriétaire ; un mot de passe d'application ne s'invente pas ; un domaine déjà
pris ne se réserve pas.

---

## 9. Ce que veut dire « livré »

Une fonctionnalité est livrée quand les six conditions sont vraies :

1. Elle existe sur le site public en ligne et dans la console, pas seulement sur un poste.
2. Un test automatique la couvre, et ce test échoue si on l'enlève.
3. L'écran est lisible au téléphone et au clavier, sans survol.
4. Le serveur applique la règle, pas seulement l'écran.
5. Aucun état vide ne reste muet : il dit pourquoi et propose l'action suivante.
6. La version est notée dans le journal des versions, et la publication est refaite.

---

## 10. L'ordre de travail, à suivre sans le changer

1. **La partie publique d'abord.** Grille et affiches, rails, filtres et états vides,
   recherche, lecteur, signalements, mentions. Rien de la console tant que la partie
   publique n'est pas juste au téléphone.
2. **La console ensuite.** Sept règles, onze onglets, journal lisible, premier lancement,
   rôles, appareils, sauvegardes, accès.
3. **Les ajouts enfin**, A1 à A8 puis B1 à B10, un par un, chacun avec son test.
4. **La mise en ligne.** Version notée, tests complets au vert, catalogue statique
   reconstruit, publication GitHub Pages, vérification à l'adresse publique.

Une étape ne se saute pas. Une difficulté se dit avec son coût, dans ce document ou dans
la réponse qui l'accompagne, jamais en la retirant.

---

## 11. Où en est le travail, à la date de ce document

**Livré et en ligne :** la refonte d'affichage (3.10.0), la console et son diagnostic
(3.11.0 et 3.12.0), le lecteur, les signalements, la PWA, les liens d'accès (3.13.0),
et depuis la 3.14.0 le journal en phrases, le premier lancement, le nom du propriétaire
en tête de console et les états vides de filtres.

**Reste à faire, dans l'ordre :** la totalité des points marqués « à faire » ci-dessus,
puis la mise en ligne de la console sur un serveur avec nom de domaine, la création du
compte nominatif par son propriétaire, et le mot de passe applicatif Yahoo sans lequel le
code par e-mail ne peut pas partir.

**Trois choses dépendent de vous, pas du code :** créer votre compte dans Équipe, saisir
votre mot de passe à vous au premier lancement, et fournir le mot de passe applicatif de
votre boîte Yahoo le jour où vous voudrez le code par e-mail.
