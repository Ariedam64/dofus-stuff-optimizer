# Dofus stuff optimizer

Outil qui cherche les meilleurs stuffs Dofus (équipements, exos et points de caractéristiques) pour une classe, un niveau et un élément, selon des contraintes (PA, PM, critique, résistances, objets imposés ou exclus). Les données viennent de DofusDB. La recherche renvoie plusieurs stuffs vraiment différents (10 par défaut, jusqu'à 20), chacun avec son combo du tour, ses dégâts, la répartition des points et un lien Dofusbook. Elle s'utilise en ligne de commande, via une page web locale ou via l'agent Claude Code.

## Prérequis

- Node.js 24
- `npm install` (une seule dépendance : `highs`, le solveur MILP en WebAssembly)

## Utilisation

Synchroniser les données (une première fois, puis de temps en temps) :

```
npm run sync
```

### Page web locale

```
npm run web
```

Le serveur écoute sur `127.0.0.1:5173` et ouvre le navigateur. Il ne répond qu'à sa propre page : une requête venant d'un autre site (en-tête `Origin` ou `Host` étranger) ou un `POST /api/optimize` qui n'est pas en `Content-Type: application/json` est refusé. Le formulaire (classe, niveau, élément, PA et PM minimaux, résistances, critique, parchemins, exo PA et exo PM sur les anneaux, diversité, objets imposés ou exclus) est à gauche ; les stuffs apparaissent à droite au fil de l'eau, avec leurs icônes, leurs stats clés, leur combo du tour et un bouton Dofusbook. Une seule recherche à la fois : en lancer une nouvelle annule la précédente. Une requête impossible (objets imposés incompatibles, objet au-dessus du niveau, champ invalide) est refusée tout de suite avec un message en français.

Ouvrir un lien Dofusbook remplace le brouillon Dofusbook local de votre navigateur.

### Ligne de commande

Le résultat JSON est écrit sur la sortie standard (environ 55 à 60 s avec les réglages par défaut) :

```
npm start -- optimize --query tests/fixtures/craWater200.json
```

### Format de la requête

```json
{
    "breed": "Crâ",
    "level": 200,
    "profile": { "elements": ["water"], "minCriticalRate": null },
    "constraints": {
        "minAp": 11,
        "minMp": 6,
        "minResistances": { "fire": 30 },
        "excludedItemIds": [],
        "requiredItemIds": []
    },
    "ringExos": { "ap": true, "mp": true },
    "resultCount": 10,
    "useScrolls": true,
    "diversity": { "minDifferentItems": 5 },
    "timeLimitMs": 60000
}
```

- `breed` : classe en français (Crâ, Iop, Sram…).
- `level` : de 1 à 200.
- `profile.elements` : exactement un élément parmi `water`, `earth`, `fire`, `air`, `neutral`.
- `profile.minCriticalRate` : critique minimal (profil « do crit »), `null` pour l'ignorer.
- `constraints` : PA et PM minimaux (au plus 12 PA et 6 PM, voir « Plafonds du jeu »), résistances minimales en %, identifiants d'objets exclus ou imposés. Tout est optionnel. Un champ inconnu (ex. `minAP`) est refusé. Les objets imposés doivent exister, être de niveau inférieur ou égal à celui du personnage et pouvoir être portés ensemble (une arme, deux anneaux, six dofus/trophées, une prysmaradite, pas de bouclier avec une arme à deux mains), sinon la requête est refusée.
- `ringExos` : autorise séparément l'exo PA (`ap`) et l'exo PM (`mp`) sur les anneaux (chacun vrai par défaut). L'ancien `allowRingExos` (booléen, les deux à la fois) reste accepté, mais pas en même temps que `ringExos`.
- `resultCount` : nombre de stuffs renvoyés (10 par défaut, de 1 à 20). `topCount` reste accepté comme ancien nom.
- `useScrolls` : parchemins de +100 dans chacune des 6 caractéristiques (vrai par défaut).
- `diversity.minDifferentItems` : un stuff diffère des mieux classés par son arme, ou par au moins ce nombre d'objets sur 16 (5 par défaut, de 1 à 16).
- `timeLimitMs` : durée maximale de la recherche (60000 par défaut, de 5000 à 300000 ms ; la page le règle en secondes, de 5 à 300). Le minimum de 5 s couvre le rechargement des données par le moteur (environ 1,6 s) et la recherche de départ.

### Points de caractéristiques

Le personnage dispose de 5 x (niveau - 1) points (995 au niveau 200). Force, Intelligence, Chance et Agilité coûtent 1 point par point jusqu'à 100, 2 jusqu'à 200, 3 jusqu'à 300, puis 4 ; Vitalité coûte 1 et Sagesse 3. Le moteur répartit les points en même temps qu'il choisit les objets : le minimum pour les conditions des objets, le reste dans la caractéristique de l'élément.

### Plafonds du jeu

Le jeu limite un personnage à 12 PA, 6 PM et 9 PO : ce que l'équipement donne au-delà est ignoré, mais les objets restent portables. Le moteur joue le tour avec au plus 12 PA et affiche les PA, PM et PO plafonnés. Les conditions des objets (CP, CM…) lisent les totaux bruts. Une requête demandant plus de 12 PA ou 6 PM minimum est refusée (« Le jeu limite à 12 PA et 6 PM »).

### Sortie

La sortie contient `isOptimal`, `elapsedMs`, `reason`, `dataSyncedAt`, les stuffs (`results`), les sorts ignorés (`ignoredSpells`) et les objets exclus (`unsupportedItems`, `unobtainableItems`). Chaque stuff porte `score`, `solverStatus`, `optimalityGapPercent`, `items`, `stats`, `pointsAllocation`, `turn`, `assumedCriteria` et `dofusbookUrl`.

- `solverStatus: "optimal"` : optimum prouvé ; `"gap"` : non prouvé, les dégâts sont à au plus `optimalityGapPercent` % (10 % au plus) du meilleur possible ; `"heuristic"` : meilleur stuff trouvé, non prouvé.
- `reason: "no-valid-stuff"` : aucune combinaison ne respecte les contraintes (prouvé) ; `"time-limit-reached"` : recherche coupée par le temps imparti, sans preuve.
- Si le solveur HiGHS échoue (chargement impossible, erreur interne), un message `❌` est écrit sur stderr et la recherche rend les meilleurs stuffs déjà trouvés, en `"heuristic"`, avec `reason: "time-limit-reached"`.
- Les objets dominés sont écartés avant la recherche : les stuffs sont construits avec les objets non dominés.

## Agent Claude Code

Le fichier `.claude/agents/stuff-optimizer.md` définit l'agent `stuff-optimizer`. Depuis la racine du projet dans Claude Code, demandez par exemple :

> Meilleur stuff Eau pour un Crâ 200, 11 PA 6 PM

L'agent écrit la requête dans `queries/last-query.json`, lance le moteur et répond en français : jusqu'à 20 stuffs différents (10 par défaut) avec exos, répartition des points, combo du tour, lien Dofusbook et avertissements. Il propose de lancer `npm run sync` si les données sont absentes ou anciennes.

## Limites connues

- Un seul élément par calcul.
- Avec un trophée à condition « bonus de panoplie < 2 », le stuff porte au maximum 2 objets d'une même panoplie ; plusieurs de ces trophées peuvent être portés ensemble.
- Des objets sont écartés d'office et comptés sur la page : ceux dont une condition n'est pas gérée (« Écartés : conditions non gérées ») et ceux réservés à un joueur nommé, aux MJ ou aux serveurs Ankarton (code `OS`) (« Réservés »). Le détail des noms s'ouvre au clic. Un objet imposé n'est jamais écarté.
- Les arrondis du jeu ne sont pas modélisés.
- Les dégâts sont calculés sur une cible à 0 % de résistance.
- En pratique, le solveur ne prouve pas l'optimum sur les vraies données, même à bas niveau : les stuffs sont `heuristic` (meilleur trouvé, non prouvé), avec un écart au meilleur possible trop grand pour être chiffré.
- Une seule forgemagie est gérée : l'exo PA/PM sur les anneaux.

## Licence et mentions

- Code sous licence MIT (voir `LICENSE`).
- Projet de fan non officiel, sans lien avec Ankama, DofusDB ou Dofusbook. Dofus est une marque d'Ankama.
- Les données de jeu viennent de l'API publique DofusDB (`npm run sync`) et ne sont pas incluses dans ce dépôt.
