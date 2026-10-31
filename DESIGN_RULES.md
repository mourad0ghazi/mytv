# Règles de design StreamTV

Document de référence opposable. Toute interface livrée respecte ces règles, et
`tests/design.test.js` les vérifie automatiquement à chaque exécution de `npm test`.
Une règle qui n'est pas vérifiée automatiquement est une intention, pas une règle.

## 1. Anti-AI Slop : ce qui est interdit

| Interdit | Pourquoi | Alternative retenue |
| --- | --- | --- |
| Dégradé (linéaire, radial, conique) | signature visuelle des interfaces générées, aucune information portée | aplat de `--bg`, `--bg-2`, `--panel`, `--panel-strong` |
| Texte en dégradé | illisible en petit corps, impossible à contraster correctement | couleur unie, contraste AA |
| Ombre sur un élément qui ne flotte pas | suggère une profondeur qui n'existe pas | bordure `--line`, fond `--panel` |
| Déplacement, mise à l'échelle, halo au survol | promesse d'animation gratuite, gêne la lecture | changement de bordure et de fond, 140 ms |
| Icône « sparkle » et étoiles décoratives | marqueur d'interface générée | icônes existantes : `heart`, `check`, `grid`, `star` (notation uniquement) |
| Emoji dans l'interface | rendu variable, non contrôlable | texte ou icône SVG |
| Pastille teintée par catégorie | couleur sans signification stable | une seule couleur d'état : `--accent` |
| Tirets cadratins dans la copie | typographie d'article, pas d'interface | virgule, deux-points, point médian |

## 2. Une seule échelle

- Un accent : `--accent`. Il sert aux actions primaires, à l'état actif et à l'état « en direct ».
- Une famille de gris : `--bg`, `--bg-2`, `--panel`, `--panel-strong`, `--text`, `--muted`, `--line`.
- Un rayon : `--r-sm`, `--r-md`, `--r-lg`, `--r-pill`.
- Une bordure : `1px solid var(--line)`. Les contours au focus font exception (`--focus`, 3 px).
- Espacement : échelle de 4 px, jetons `--s1` à `--s7`. Aucune valeur improvisée.
- Largeur de lecture : 1280 px maximum. Au-delà, le contenu est centré.

## 3. État avant décoration

- Le cœur des favoris est en couleur d'état : gris au repos, `--accent` une fois activé.
- « En direct » est une pastille avec un point `--accent` ; elle est figée en
  `prefers-reduced-motion: reduce`.
- La santé d'un flux utilise `--ok`, `--warn`, `--accent` (danger) et un contour, jamais une ombre.
- Une carte sans programme affiche un texte explicite, jamais un espace vide.

## 4. Accessibilité vérifiée

- Aucun texte sous 12 px.
- Cibles tactiles : 44 px minimum ; 56 px en mode télévision.
- Focus visible : 3 px, jamais supprimé.
- Animations coupées si le système le demande.
- Tout contenu animé (pastille, progression) a un équivalent texte.

## 5. Ce que le test refuse

`tests/design.test.js` échoue si l'un des cas suivants apparaît dans `public/css/app.css`
ou dans le JavaScript du client :

1. `gradient` sous quelque forme que ce soit ;
2. `box-shadow`, `translateY`, `scale(` ou `filter: blur(` dans une règle `:hover` ;
3. le caractère `—` (cadratin) ;
4. les icônes `sparkles` ou `star4` ;
5. une `font-size` inférieure à 12 px ;
6. un `max-width` de page supérieur à 1280 px ;
7. une couleur hexadécimale hors des jetons déclarés dans `:root` ;
8. un `!important` hors de la feuille d'impression ;
9. une règle de survol qui modifie `transform` ;
10. un emoji dans un littéral de chaîne du client.
