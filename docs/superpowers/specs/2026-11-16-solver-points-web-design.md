# Dofus Stuff Optimizer v2 — Solveur, points de caractéristiques, page web

Date : 2026-11-16. Fait suite à `2026-11-15-dofus-stuff-optimizer-design.md` (v1, livrée : 201 tests, moteur « recherche locale + branch-and-bound », agent Claude Code).

## Intention

La v1 trouve un bon stuff en environ 1 s, mais ne prouve presque jamais l'optimum au niveau 200, et une demande prend environ 40 s. L'utilisateur craint qu'elle passe à côté de meilleurs stuffs. Elle ignore aussi les points de caractéristiques du personnage, ce qui fausse les dégâts et rejette à tort les items à condition de carac (98 items de niveau 150+, surtout des armes).

La v2 doit :

- trouver plus vite de meilleurs stuffs, avec une preuve ou un écart d'optimalité chiffré ;
- répartir les points de caractéristiques ;
- proposer dix stuffs vraiment différents ;
- offrir une page web locale pour régler la recherche et voir les résultats, avec un lien Dofusbook par stuff pour les visualiser et les modifier.

L'agent Claude Code reste en place et profite de tout cela.

## Objectifs

1. **Nouveau moteur** fondé sur un solveur MILP (HiGHS via le paquet npm `highs`), sur le principe de Sola-Ray/dofus-optimizer : maximiser une borne du logarithme des dégâts grâce à des coupes tangentes successives (Kelley). Le moteur renvoie un statut « optimal prouvé », ou l'écart restant.
2. **Points de caractéristiques** :
    - points disponibles : 5 × (niveau − 1), soit 995 au niveau 200 ;
    - coût par point identique pour toutes les classes (données `breeds.statsPointsFor*`) : Force, Intelligence, Chance et Agilité coûtent 1 jusqu'à 100, 2 jusqu'à 200, 3 jusqu'à 300, 4 au-delà ; Vitalité 1 ; Sagesse 3 ;
    - parchemins optionnels : +100 dans chacune des 6 caracs ;
    - le moteur choisit la répartition en même temps que les items, en respectant les conditions des items (« Agilité > 300 »…).
3. **Dix stuffs différents** : chaque stuff retenu diffère de tous ceux classés avant lui par l'arme, ou par au moins 5 items sur 16 (seuil réglable). Chaque stuff est publié dès qu'il est trouvé, dans une limite globale de 60 s (réglable).
4. **Page web locale**, disposition A validée : formulaire à gauche, cartes de stuffs à droite, mises à jour au fil de l'eau.
5. **Lien Dofusbook par stuff**, au format d'import « roxx-solver », avec les items, les exos, la classe, le niveau, le nom, les points répartis et les parchemins.
6. L'agent et la ligne de commande exposent les mêmes nouveautés (10 stuffs, points, liens).
7. La page permet d'imposer ou d'exclure des items par leur nom.

## Non-objectifs

- Plusieurs éléments dans un même stuff (toujours un seul élément en v2).
- La forgemagie autre que l'exo PA/PM sur les anneaux.
- Les résistances de la cible, le multi-cible, les sorts à effets indirects (inchangé par rapport à la v1).
- Un hébergement en ligne de la page, ou des comptes utilisateur : la page tourne en local.
- Appeler l'API Dofusbook. Le lien est ouvert par le navigateur de l'utilisateur, comme un import normal.

## Anti-objectifs

- Afficher des dégâts ou des stats qui ne viennent pas de l'évaluateur exact. Le solveur propose, l'évaluateur exact de la v1 (`StuffEvaluator`, combo par sac à dos) calcule le score affiché.
- Annoncer « optimal » sans preuve du solveur, ou si le modèle du solveur approxime une partie des dégâts.
- Un lien Dofusbook dont les stats diffèrent de notre fiche, à arrondis près.
- Une page qui reste figée pendant la minute de calcul.

## Contraintes

- Node.js 24, CommonJS. **Une seule nouvelle dépendance autorisée : `highs`** (MIT, environ 4 Mo, WebAssembly), validée par l'utilisateur. Rien d'autre sans accord : ni framework web, ni bundler.
- Conventions du fichier `CLAUDE.md` global.
- Pas de commit (consigne de l'utilisateur) : le travail reste non commité, seulement ajouté à l'index git.
- Ne pas copier le code de Sola-Ray (dépôt sans licence) : on reprend la méthode, pas le code.
- Données DofusDB inchangées (`data/`). Il faut garder l'URL d'image de chaque item (`img`) et de chaque sort, pour la page.

## Approches envisagées

| Approche                                                                    | Avantages                                                                                                                                    | Inconvénients                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **A. MILP HiGHS avec coupes tangentes sur log(dégâts)** (retenue)           | Toutes nos règles sont linéaires. Preuve ou écart chiffré. Déjà éprouvée sur Dofus 3 en JS (Sola-Ray). La diversité s'ajoute par des coupes. | Ajoute une dépendance. Modéliser exactement le combo du tour et le critique demande du soin. |
| B. Notre branch-and-bound avec des bornes linéaires façon Genshin Optimizer | Pas de dépendance, exact.                                                                                                                    | Gros travail de recherche, gain incertain.                                                   |
| C. Recuit simulé / recherche locale seulement                               | Simple et rapide.                                                                                                                            | Aucune preuve, c'est précisément la crainte de l'utilisateur.                                |
| D. CP-SAT (cpsat-js)                                                        | Exact (référence : wakfu-autobuilder).                                                                                                       | Paquet jeune de 12,8 Mo. Preuves lentes au haut niveau (3,5 min).                            |

**Choix de l'utilisateur : A** (« utilise sola ray »).

## Décisions prises avec l'utilisateur

- Page et agent coexistent.
- Disposition A. Le formulaire contient :
    - classe et niveau max ;
    - élément ;
    - PA et PM min, résistances min, critique min ;
    - parchemins oui/non ;
    - seuil de diversité ;
    - bouton « Lancer ».
- Chaque carte de stuff montre :
    - le rang et les dégâts par tour ;
    - les 16 icônes, les exos entourés (bleu PA, vert PM) ;
    - les stats clés ;
    - le combo du tour avec les icônes des sorts ;
    - le bouton « Dofusbook ».
- Durée max d'une recherche : 1 min, avec affichage au fil de l'eau.
- Dix stuffs « vraiment différents ».
- Règle des trophées « bonus de panoplie < 2 » : au plus 2 items par panoplie quand un tel trophée est porté. Plusieurs de ces trophées sont autorisés (Ruling 17 de la v1).

## Propositions de Claude (à valider pendant la lecture)

1. **Le solveur propose, l'évaluateur exact tranche.** Chaque stuff sorti par HiGHS est réévalué par `StuffEvaluator`, avec ses points et ses parchemins. Le score affiché et le classement viennent de cet évaluateur. L'écart d'optimalité du solveur est affiché à part.
2. **Diversité par coupes.** Après chaque stuff trouvé, on ajoute une contrainte qui interdit les stuffs « trop proches » : même arme et moins de 5 items différents. On relance le solveur en partant de la solution précédente. Chaque stuff trouvé est publié immédiatement.
3. **Point de départ.** La recherche locale de la v1, adaptée aux points de carac, fournit une première solution au solveur et sert de secours si HiGHS échoue. Le branch-and-bound de la v1 est retiré (remplacé par le solveur).
4. **Répartition des points.**
    - Une variable par palier de coût et par carac (pas besoin de binaires, les coûts croissent).
    - Les parchemins s'ajoutent en constante.
    - Les conditions des items portent sur les stats totales : base + parchemins + items + panoplies + exos.
    - Les points non nécessaires aux conditions vont là où ils maximisent les dégâts. Pour un seul élément, c'est la carac de l'élément, mais le solveur le décide lui-même.
5. **Format de lien Dofusbook** (import « roxx-solver », décodé depuis leur code le 2026-11-16 et testé avec succès sur un vrai stuff Crâ) :
    - URL `https://www.dofusbook.net/desktop/fr/equipement/roxx-solver/objets?stuff=<base64url sans padding>` ;
    - octet de version 1, puis des blocs étiquetés :
        - **1** : uint16 = ((niveau − 1) × 20 + classe) × 2 + sexe, avec classe = breedId − 1 pour les ids ≤ 18, sinon breedId − 2 ;
        - **2** : masque uint16 des 16 emplacements, puis un id Ankama uint16 par bit. Ordre des emplacements : arme, bouclier, chapeau, amulette, anneau 1, anneau 2, ceinture, cape, bottes, familier/monture, dofus 1 à 6 ;
        - **3** : masque uint8 des 6 caracs, puis les points **dépensés**, codés sur 10 bits chacun, dans l'ordre vi, fo, in, ch, ag, sa ;
        - **4** : masque uint8, puis la valeur de parchemin (uint8) de chaque carac présente ;
        - **5** : masque uint16, puis pour chaque item : nombre de lignes, puis index de stat (uint8) et valeur (int16). PA = index 8, PM = index 9 ;
        - **7** : longueur uint8, puis le nom en UTF-8.
    - Le lien ouvert remplace le brouillon local Dofusbook de l'utilisateur. La page doit le signaler.
6. **Serveur web.**
    - Module `http` natif de Node. `npm run web` démarre le serveur sur `127.0.0.1` et ouvre le navigateur.
    - Endpoints :
        - `GET /` : la page ;
        - `GET /api/meta` : classes, éléments, `dataSyncedAt` ;
        - `POST /api/optimize` : flux SSE d'événements `progress`, `stuff`, `done` et `error`.
    - Page en HTML, CSS et JS natifs, sans build. Icônes chargées depuis les URL d'images DofusDB.
    - Une seule recherche à la fois : une nouvelle recherche annule la précédente.
7. **CLI et requête.** La requête JSON gagne les champs `useScrolls` (défaut true), `resultCount` (défaut 10), `diversity.minDifferentItems` (défaut 5) et `timeLimitMs` (défaut 60000). Le résultat gagne pour chaque stuff :
    - `pointsAllocation` (points dépensés et valeur obtenue par carac) ;
    - `scrolls` ;
    - `dofusbookUrl` ;
    - `solverStatus` (`optimal`, `gap`, `heuristic`) ;
    - `optimalityGapPercent`.

## Précisions après relecture du constructeur

**Format Dofusbook** (relu dans leur code le 2026-11-16, fonction de décodage `Jc`) :

- Les entiers uint16 et int16 sont en gros-boutiste (lecture `DataView` par défaut).
- Bloc 3 :
    - les valeurs sur 10 bits sont lues bit de poids fort en premier, à partir de l'octet qui suit le masque ;
    - le bloc occupe `ceil(n × 10 / 8)` octets ;
    - `n` est le nombre de bits à 1 du masque ;
    - les valeurs sont les **points dépensés**, pas la valeur de carac obtenue.
- Les blocs sont facultatifs et peuvent venir dans n'importe quel ordre. Une étiquette inconnue arrête la lecture.
- Les lignes du bloc 5 **s'ajoutent** à l'item (`fmItems`). Vérifié : avec un exo PM, l'anneau garde ses autres stats et le total passe à 6 PM.
- Sans bloc 5, les items importés sont au **jet max**. Vérifié : les stats Dofusbook sont identiques à notre fiche (11 PA, 6 PM, Chance 990, Do Eau 222, 58 % critique).

**Cas de référence pour les tests.** Crâ niveau 200, 16 items, exo PM sur l'anneau 1 et exo PA sur l'anneau 2, nom « Optimiseur Cra Eau » :

```
AQEfKAL__4YbSQyGGla4LdpOEUimVrk9TYIPG4M_iDGSMaxV9DXIBQAwAQkAAQEIAAEHEk9wdGltaXNldXIgQ3JhIEVhdQ
```

Il a été produit par l'encodeur jetable `scratchpad/spike/encode.js` et validé dans Dofusbook. Les blocs 3 et 4 (points et parchemins) n'ont pas encore été testés en vrai. Le constructeur doit les valider dans Dofusbook, ce que le contrôleur fera dans Chrome.

**Décisions de l'utilisateur (2026-11-16) :**

- **Variantes +1 PA / +1 PM retirées.** Les 10 stuffs variés et le formulaire les remplacent, et toute la minute de calcul leur est consacrée. On retire `#runVariants` et la clé `variants` du résultat, et on met à jour l'agent.
- **Imposer ou exclure des items depuis la page.** Le formulaire a deux champs, avec autocomplétion sur le nom français, alimentés par un endpoint `GET /api/items?q=…`. Les items introuvables, impossibles à obtenir ou au-dessus du niveau sont signalés.

**Choix de Claude :**

- `topCount` devient `resultCount`. `topCount` reste accepté comme alias, pour ne pas casser les anciennes requêtes. L'agent utilise `resultCount`.
- Le champ global `isOptimal` est conservé. Il vaut `true` seulement si la liste entière est prouvée : chaque stuff est optimal sous les coupes de diversité, et la recherche n'a pas été coupée. Chaque stuff porte aussi `solverStatus` et `optimalityGapPercent`.
- Diversité : un emplacement vide compte comme un « item » dans la comparaison. Deux anneaux échangés comptent comme identiques (on compare des ensembles d'items).

## Laissé au constructeur

- La modélisation exacte des dégâts dans le MILP. Il faut traiter :
    - le combo du tour, par exemple un choix binaire de rotation par niveau de PA avec ses propres coupes, ou une résolution par paire PA/rotation en élaguant celles dont la borne est sous le meilleur connu ;
    - le critique, par tranches de taux ou décomposition binaire ;
    - les facteurs % sorts / armes / distance / mêlée.

    Exigence : si une partie est approximée, le statut ne peut pas être `optimal`.

- Les coupes de validité pour les panoplies (variables « n items portés »), les grands M des conditions et les OU dans les conditions.
- La tolérance d'écart, les budgets de temps par stuff, le parallélisme éventuel (`worker_threads`).
- Le style visuel exact de la page, qui doit rester proche de la maquette validée (thème sombre façon Dofusbook).
- Le découpage en fichiers et en classes, dans le respect des conventions.
