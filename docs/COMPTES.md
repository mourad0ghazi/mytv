# Comptes visiteurs — StreamTV 3.19.0

Un compte visiteur garde les favoris, l'historique, les reprises de lecture, les préférences
d'affichage et le suivi des signalements envoyés. Il ne donne **aucun** droit sur la console
d'administration : les deux publics ont deux registres de sessions distincts.

## Cycle de vie

| Étape | Ce qui se passe | Refus |
| --- | --- | --- |
| Inscription | Nom, adresse, mot de passe ; un code à six chiffres part par e-mail | 503 sans serveur d'envoi, 403 si `registrationMode` vaut `ferme`, 409 si l'adresse a déjà un compte actif, 429 au-delà de cinq inscriptions par quart d'heure |
| Confirmation | Le code active le compte et ouvre une session | 400 si le code est faux ou expiré (cinq essais, 15 minutes) |
| Connexion | Adresse et mot de passe ; jeton Bearer de 48 caractères hexadécimaux | 401 générique, 403 si le compte attend encore sa confirmation ou s'il est suspendu |
| Utilisation | Favoris, historique, reprises, préférences, signalements | 401 sans jeton valide |
| Suspension | La console ferme les sessions du compte | 403 à la connexion |
| Suppression | Le compte et ses données personnelles sont retirés | - |

## Mot de passe

- 12 caractères minimum, au moins une lettre et un chiffre.
- Les mots courants (et leurs variantes suivies de chiffres) sont refusés : `motdepasse2026`
  ne passe pas, `Visiteuse2026!` passe.
- scrypt N=16384, r=8, p=1, sel de 16 octets, empreinte de 64 octets. Le mot de passe en clair
  n'est jamais écrit, ni dans `data/users.json`, ni dans le journal.
- Le changement de mot de passe ferme les autres appareils du compte et en ouvre un nouveau.

## Codes et plafonds

| Règle | Valeur |
| --- | --- |
| Durée d'un code | 15 minutes |
| Essais par code | 5 |
| Renvoi | 1 par minute, 8 par heure et par adresse |
| Inscriptions | 5 par adresse IP et par quart d'heure |
| Connexions échouées | 8 avant verrouillage d'un quart d'heure (`Retry-After`) |
| Favoris par compte | 200 |
| Reprises par compte | 100 |
| Signalements suivis | 50 |

Les codes vivent en mémoire : un redémarrage les annule. Aucun code n'est journalisé.

## Données et vie privée

- `data/users.json` contient l'identité déclarée, l'empreinte scrypt, le statut, les dates et
  les données personnelles. Aucune adresse IP n'y est conservée.
- Le fichier est écrit de façon atomique, avec mise en quarantaine s'il devient illisible.
- Les sauvegardes de catalogue (`data/backups/`) ne contiennent **pas** les comptes : une
  restauration de catalogue ne restaure ni ne détruit un compte.
- Aucun compte n'est jamais exposé par l'API publique : ni l'empreinte, ni le sel, ni la liste
  des adresses.
- Le jeton du compte vit dans `sessionStorage` : fermer l'onglet déconnecte le visiteur.
- Le jeton d'administration vit dans une autre clé. Se déconnecter du compte ne ferme pas la
  console, et l'inverse non plus.

## Fusion à la connexion

À la connexion (ou après confirmation), le navigateur envoie son état local
(`prefs.exporter()`) ; le serveur fait l'union avec le compte, puis renvoie l'ensemble que le
navigateur réinstalle. Un favori ajouté sans compte n'est donc pas perdu, et le compte reste
la référence sur un second appareil. L'union est bornée par les plafonds ci-dessus.

## Configuration de l'envoi

L'inscription et la réinitialisation exigent un serveur SMTP. Sans lui, l'inscription répond
503 et rien n'est créé. Variables lues au démarrage :

| Variable | Rôle |
| --- | --- |
| `STREAMTV_SMTP_HOST` | Nom d'hôte du serveur d'envoi |
| `STREAMTV_SMTP_PORT` | Port (465 par défaut, 587 sans TLS implicite) |
| `STREAMTV_SMTP_USER` / `STREAMTV_SMTP_PASS` | Identifiants, facultatifs sur un relais local |
| `STREAMTV_SMTP_FROM` | Expéditeur affiché |
| `STREAMTV_SMTP_TLS` / `STREAMTV_SMTP_SECURE` | `0` pour désactiver STARTTLS ou TLS implicite |

Le même réglage sert au second facteur de la console (`adminEmail`). Retirer les variables
ferme les inscriptions sans toucher aux comptes existants ; `registrationMode` fait la même
chose sans redémarrage.

## Routes

| Méthode et adresse | Effet |
| --- | --- |
| `POST /api/compte/inscription` | Crée un compte en attente et envoie un code |
| `POST /api/compte/verification` | Active le compte et ouvre une session |
| `POST /api/compte/renvoyer-code` | Renvoie un code (réponse générique) |
| `POST /api/compte/connexion` | Ouvre une session |
| `POST /api/compte/sortie` | Ferme la session courante |
| `GET /api/compte/profil` | Compte et données |
| `PATCH /api/compte/profil` | Change le nom affiché |
| `POST /api/compte/mot-de-passe` | Change le mot de passe et rouvre une session |
| `POST /api/compte/code-oublie` | Envoie un code de réinitialisation (réponse générique) |
| `POST /api/compte/reinitialisation` | Remplace le mot de passe avec le code |
| `GET/PUT /api/compte/donnees` | Lit ou fusionne favoris, historique et préférences |
| `PUT /api/compte/preferences` | Enregistre habillage, mode télé et sourdine |
| `POST /api/compte/favoris` | Ajoute ou retire un favori |
| `POST /api/compte/historique` | Enregistre une reprise |
| `GET /api/compte/signalements` | Suit les signalements du compte |
| `GET /api/compte/droits` | Rappelle le rôle `visiteur` et son absence de permissions |

Côté console, permission `team` : `GET /api/admin/membres`, `GET /api/admin/membres/:id`,
`PATCH /api/admin/membres/:id` (statut), `DELETE /api/admin/membres/:id`.

## Vérifier

```bash
npm test                          # 407 tests, dont 11 sur les comptes
node --test tests/comptes.test.js # inscription, codes, sessions, modération
```

Le test ouvre un serveur SMTP local : aucun e-mail ne sort de la machine.
