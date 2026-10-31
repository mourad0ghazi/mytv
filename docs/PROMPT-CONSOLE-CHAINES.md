# Prompt professionnel : contrôle des chaînes et des liens VLC

Ce document est un cahier des charges utilisable tel quel. Il décrit la console
« Chaînes et liens » de StreamTV : ce qu'elle montre, ce qu'elle permet, ce qu'elle
interdit, et comment on prouve qu'elle est finie. Il peut être remis à un développeur
ou collé en tête d'une session de développement.

Version de référence : StreamTV 3.7.0.

---

## 1. Rôle du document

Tu construis une console d'administration pour un catalogue de chaînes de télévision
en direct. Le propriétaire du site doit pouvoir, sans lire de documentation technique :

1. voir **toutes** les chaînes, y compris masquées et supprimées ;
2. voir l'**adresse exacte** de chaque flux et de chacune de ses variantes ;
3. **copier** cette adresse, la coller dans VLC, ou télécharger un fichier `m3u` ;
4. savoir si le flux **répond** : code HTTP, latence, CORS, nombre d'échecs de suite ;
5. voir combien de fois la chaîne a été **signalée**, et si elle approche du seuil de retrait ;
6. **décider** : masquer, supprimer, restaurer, remettre un compteur à zéro.

La console est en **lecture seule sur le catalogue**. Toute écriture passe par les
routes du catalogue, déjà existantes, qui écrivent une ligne d'audit et sauvegardent
de façon atomique. La console ne réinvente aucune écriture.

---

## 2. Contraintes non négociables

| Contrainte | Règle |
|---|---|
| Dépendances | Node.js 20 LTS, modules natifs uniquement. Client en modules ES, sans bundler. |
| Volume | 900 lignes maximum par fichier source. |
| Sécurité | Toutes les routes de la console exigent un jeton `Bearer` de 48 hexadécimaux. Aucune donnée de flux accessible sans session. |
| Persistance | Fichiers JSON, écriture `tmp → fsync → rename`. Aucun verrou applicatif bloquant. |
| Erreurs | Messages en français, jamais de trace technique, toujours une action possible. |
| Audit | Chaque décision (masquer, supprimer, restaurer, remettre à zéro) laisse une ligne dans `audit.log` avec l'identifiant de la chaîne. |
| Accessibilité | Contraste AA, focus visible, ordre de tabulation identique à l'ordre visuel, tableaux avec `<th scope>`. |
| Rendu | Aucune ombre, aucun dégradé, un seul accent. La couleur ne code que l'état. |

---

## 3. Ce que la console affiche

### 3.1 Bandeau d'indicateurs

Six nombres, mis à jour à chaque chargement :

- **Chaînes** : total actif, avec le nombre de masquées en légende.
- **Liens en ligne** : chaînes visibles, avec le nombre de flux `https`.
- **Supprimées** : total supprimé, avec le nombre de bloquées.
- **Signalées** : chaînes ayant au moins un signalement, avec le seuil en légende.
- **Variantes** : total des flux de secours.
- **Http bloqués en navigateur** : flux `http://`, lisibles dans VLC seulement.

### 3.2 Filtres

Sept contrôles, combinables, appliqués côté serveur :

| Filtre | Valeurs |
|---|---|
| Recherche | nom, pays, identifiant (insensible aux accents) |
| Catégorie | les 18 catégories du contrat |
| État | toutes, visibles, masquées, bloquées, supprimées, signalées |
| Santé | toutes, disponibles, instables, injoignables, non testées |
| Protocole | `https`, `http`, `rtsp`, `rtmp`, `udp`, autre |
| Source | identifiant de la source d'ingestion |
| Tri | numéro, nom, signalements, santé, dernière modification |

La recherche est temporisée à 260 ms. Changer un filtre ramène à la page 1.

### 3.3 Tableau

Une ligne par chaîne, cinq colonnes :

1. **Numéro** en chasse fixe.
2. **Chaîne** : logo, nom, catégorie, pays, qualité, puis les badges utiles
   (`Supprimée`, `Masquée`, `Retirée sur signalement`, `Verrou`, `Vedette`).
3. **Santé** : pastille d'état, code HTTP et latence quand ils existent.
4. **Flux** : protocole, hôte cliquable, nombre de variantes. Un clic déplie
   l'adresse complète, les variantes, l'identifiant, le `tvg-id`, la source,
   la note de droits, le nom d'origine et la date de dernière mesure.
5. **Signalements** : nombre et jauge vers le seuil.
6. **Actions** : copier le lien, copier la ligne M3U, télécharger une fiche `m3u`,
   ouvrir dans VLC, tester le flux, ouvrir la fiche publique.

Pagination de 25 lignes, avec compteur « page X sur Y » et total de résultats.

---

## 4. Les liens VLC, cas par cas

Il faut être exact, sinon la console ment :

| Situation | Ce qui marche | Ce que la console fait |
|---|---|---|
| `https://…m3u8` avec CORS | navigateur et VLC | affiche `https`, copie et lecture directe |
| `https://…m3u8` sans CORS | VLC seulement | affiche `https`, signale l'absence de CORS dans la santé |
| `http://…m3u8` | VLC seulement | affiche `http` en avertissement, rappelle que le navigateur bloque le contenu mixte |
| `rtsp://`, `rtmp://`, `udp://` | VLC seulement | affiche le protocole, jamais de bouton de lecture web |
| Flux mort | ni l'un ni l'autre | affiche l'état mesuré et le nombre d'échecs consécutifs |

Trois boutons, trois usages distincts :

- **Lien** : copie l'URL brute dans le presse-papiers.
- **M3U** : copie la ligne `#EXTINF` complète avec `tvg-id`, `tvg-logo`, `group-title`.
- **Fiche** : télécharge un fichier contenant cette seule chaîne, à double-cliquer dans VLC.
- **VLC** : tente le schéma `vlc://`. Le texte d'aide précise que cela fonctionne
  quand VLC est installé sur l'appareil et que, sur ordinateur, la fiche `m3u` est
  la voie normale.

L'export global « Exporter pour VLC » télécharge la liste complète au format `m3u`,
avec l'adresse du guide si elle est configurée.

---

## 5. Signalements et seuil

### 5.1 Règle métier

- Un signalement est **enregistré**, pas appliqué.
- Un même visiteur ne compte **qu'une fois par 24 h et par chaîne** (empreinte
  d'adresse tronquée, jamais l'adresse en clair).
- Le formulaire public accepte **cinq envois par heure et par adresse**.
- Au **1000ᵉ signalement**, la chaîne est **supprimée immédiatement**, sans
  intervention. C'est la seule action automatique du système.
- La suppression est **réversible** : la fiche reste, l'onglet Catalogue propose
  « Restaurer ».
- Le seuil est réglable au démarrage par `STREAMTV_SEUIL_SIGNALEMENTS` (jamais
  moins de 2). Il n'est pas dans les 17 réglages du contrat.

### 5.2 Onglet Signalements

- Quatre indicateurs : total, en attente, confirmés, rejetés, plus le nombre de
  chaînes au seuil.
- Un encadré explique le seuil et rappelle que tout est journalisé.
- Tableau des chaînes signalées, trié par nombre décroissant, avec jauge
  `n / seuil` et trois actions : **Masquer**, **Zéro**, **Fiche**.
- Journal des 40 derniers signalements : référence `SIG-00042`, motif, date
  relative, message, et deux boutons **Confirmer** / **Rejeter**.
- Chaque décision est confirmée par une modale pour les actions destructives.

### 5.3 Suivi public

`GET /api/report/SIG-00042` renvoie l'état du signalement sans authentification,
pour que le visiteur puisse suivre sa référence. Aucune adresse, aucun message
d'autrui n'est exposé.

---

## 6. Contrat des routes

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/api/report` | public | enregistrer un signalement, supprimer au seuil |
| GET | `/api/report/:ref` | public | suivre une référence |
| GET | `/api/admin/links` | session | inventaire paginé et filtré |
| GET | `/api/admin/console/meta` | session | protocoles, états, tris, seuil |
| GET | `/api/admin/reports` | session | file et compteurs |
| POST | `/api/admin/reports/:id/confirm` | session | masquer la chaîne |
| POST | `/api/admin/reports/:id/reject` | session | classer sans suite |
| POST | `/api/admin/reports/:channelId/reset` | session | remettre le compteur à zéro |

Réponses : JSON, `cache: no-store` pour tout ce qui est administré. Toute erreur
suit le contrat `{ error, code, requestId, field }`.

---

## 7. États de l'écran

Il faut écrire les quatre états, pas seulement le cas nominal :

| État | Ce que voit le propriétaire |
|---|---|
| Chargement | ligne « Chargement de l'inventaire… », boutons inactifs |
| Vide | « Aucune chaîne ne correspond », bouton « Tout afficher » qui remet les filtres à zéro |
| Erreur | « L'inventaire n'a pas répondu », message français, bouton « Réessayer » |
| Session expirée | retour à la connexion, message explicite, aucun formulaire perdu en silence |

---

## 8. Recette : ce qui doit être vrai à la fin

1. `GET /api/admin/links` sans jeton renvoie **401**.
2. Avec jeton, il renvoie **toutes** les chaînes, y compris supprimées, avec `url`,
   `protocol`, `variants`, `health`, `reports`.
3. Les filtres `protocol` et `health` renvoient exactement le nombre annoncé
   par les compteurs.
4. `POST /api/report` renvoie **201** avec une référence `SIG-…`, sans masquer la chaîne.
5. Le même visiteur qui signale deux fois la même chaîne ne fait pas bouger le compteur.
6. Au seuil, la chaîne disparaît de `/api/channels` **et** reste dans
   `/api/admin/channels?visibility=deleted`.
7. `restore` la remet en ligne, `reset` remet le compteur à zéro.
8. Chaque décision écrit une ligne dans `audit.log`.
9. Aucune adresse IP en clair dans `data/reports.json`.
10. `npm test` passe en entier, et les tests existants restent verts.

---

## 9. Ce que la console ne fait pas

- Elle ne modifie ni le nom, ni l'URL, ni la catégorie : c'est l'onglet Catalogue,
  avec aperçu de classement et verrou manuel.
- Elle n'ingère aucune liste : c'est l'onglet Importation, avec aperçu obligatoire.
- Elle ne supprime rien en masse sur un simple filtre : une suppression passe
  toujours par une confirmation écrite.
- Elle n'invente pas d'état : une chaîne jamais mesurée reste « non testée ».

---

## 10. Prompt prêt à coller

> Tu maintiens StreamTV, catalogue de chaînes IPTV en direct, Node.js 20 sans
> dépendance, client en modules ES. Ajoute une console d'administration
> « Chaînes et liens », en lecture seule sur le catalogue, qui affiche toutes les
> chaînes avec leur adresse de flux, leurs variantes, leur protocole, leur santé
> mesurée et leur nombre de signalements. Permets de copier l'URL, de copier la
> ligne M3U, de télécharger une fiche `m3u` par chaîne, de tester un flux, et
> d'exporter la liste complète pour VLC. Ajoute un onglet « Signalements » : un
> signalement est enregistré sans être appliqué, dédoublonné par visiteur et par
> jour, limité à cinq par heure, et au 1000ᵉ signalement la chaîne est supprimée
> automatiquement, de façon réversible et journalisée. Toutes les routes
> d'administration exigent un jeton Bearer. Respecte les contraintes suivantes :
> 900 lignes par fichier, fichiers JSON à écriture atomique, messages d'erreur en
> français, contrastes AA, focus visible, aucune ombre ni dégradé, un seul accent.
> Livre avec les tests : accès refusé sans session, filtres exacts, seuil,
> dédoublonnage, décisions, audit. Ne casse aucun test existant.
