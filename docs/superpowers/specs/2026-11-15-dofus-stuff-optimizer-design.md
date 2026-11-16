# Dofus Stuff Optimizer — Conception

Date : 2026-11-15

## Intention

Pouvoir demander depuis le terminal Claude Code, en langage naturel, « le meilleur stuff Eau pour un Crâ 200 avec 11 PA 6 PM et 30 % rés Feu », et obtenir le stuff qui maximise **les dégâts réels sur un tour complet** avec les sorts de la classe, en respectant les contraintes données.

Un modèle de langage ne sait pas trouver de façon fiable l'optimum parmi des millions de combinaisons ni garantir qu'aucune contrainte n'est violée. Le projet sépare donc :

- **un moteur d'optimisation** déterministe en Node.js, qui calcule et garantit le résultat ;
- **un agent Claude Code** spécialisé, qui traduit la demande en requête structurée, lance le moteur et explique le résultat.

## Objectifs

- Synchroniser depuis DofusDB les équipements, panoplies, montures, classes et sorts de Dofus 3, et les mettre en cache localement.
- Pour une classe, un niveau, un profil et des contraintes, trouver le stuff qui maximise les dégâts moyens d'un tour complet.
- Gérer les bonus de panoplie, les conditions d'équipement des items, les règles d'emplacement et les exos PA/PM sur anneaux.
- Rendre le stuff, ses stats totales, le combo de sorts du tour et ses dégâts, plus une ou deux variantes proches.

## Non-objectifs (v1)

- L'API Dofusbook : protégée par Cloudflare (403 hors navigateur), on ne la contourne pas.
- Les points de caractéristiques, les parchemins, la forgemagie autre que l'exo PA/PM sur anneau.
- Les effets de sort indirects : poisons, dégâts selon les PV, buffs, états, invocations, glyphes, pièges.
- Le multi-cible, les résistances de la cible, les boucliers.
- Dofus Retro et Dofus Touch.
- Toute interface autre que le terminal (pas de bot, pas de page web).

## Anti-objectifs

- Présenter comme valide un stuff qui viole une contrainte ou une condition d'item.
- Affirmer qu'un stuff est optimal quand la recherche a été coupée par la limite de temps.
- Un agent qui invente des stats ou des items au lieu de s'appuyer sur la sortie du moteur.

## Contraintes

- JavaScript CommonJS, Node.js 24 (fetch natif). Aucune dépendance sans validation ; tests avec `node:test`.
- Conventions du fichier `CLAUDE.md` global (POO, une classe par fichier, Manager par domaine, `src/main.js` court, `src/config.js`, Prettier 4 espaces, etc.).
- Code, logs et commentaires en anglais ; textes vus par l'utilisateur (réponses de l'agent) en français.
- Emplacement : la racine de ce dépôt.

## Approches envisagées

| Approche                                             | Avantages                                             | Inconvénients                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **A. Recherche exacte avec élagage** (retenue)       | Vrai optimum sur l'ensemble des candidats, vérifiable | Plus long à écrire ; les panoplies compliquent les bornes                                        |
| B. Heuristique (glouton + recherche locale / recuit) | Simple, rapide                                        | Pas de garantie d'optimum, résultats variables                                                   |
| C. Solveur MILP                                      | Optimum garanti sur un modèle linéaire                | La formule de dégâts n'est pas linéaire (carac × base, critique, PA → combo) ; dépendance lourde |

**Choix : A**, avec une limite de temps. Si elle est atteinte, le moteur rend le meilleur stuff trouvé et le signale explicitement (`isOptimal: false`).

## Source de données : DofusDB

API publique `https://api.dofusdb.fr` (pagination `$limit` / `$skip`, filtres type Feathers). DofusDude (`api.dofusdu.de`) a des items plus lisibles mais **pas de sorts**, donc tout vient de DofusDB pour garder des identifiants cohérents.

Endpoints utiles, vérifiés le 2026-11-15 :

- `items` : `id`, `typeId`, `level`, `itemSetId`, `criterions` (ex. `PA<12`, `cv<100`, opérateurs `&` / `|`), `possibleEffects` (`effectId`, `diceNum` = min, `diceSide` = max).
- `item-types` : `typeId` → nom et `superTypeId` (sert à déduire l'emplacement).
- `item-sets` : `items`, `effects[n - 1]` = bonus quand `n` items de la panoplie sont portés (`effects[0]`, presque toujours vide, correspond à 1 item ; vérifié le 2026-11-15).
- `breeds` : les 19 classes, `breedSpellsId`.
- `spells` → `spellLevels` (ids de grades) → `spell-levels` : `apCost`, `minRange`, `range`, `criticalHitProbability`, `maxCastPerTurn`, `maxCastPerTarget`, `minPlayerLevel`, `effects` et `criticalEffect`.
- `spell-variants` : paires de sorts alternatifs d'une classe (un seul des deux est équipable).

Effets de dégâts d'un sort : `effectId` 96 Eau, 97 Terre, 98 Air, 99 Feu, 100 Neutre. Les effets de stats des items (PA, PM, carac, puissance, dommages fixes, dommages élémentaires, critique, dommages critiques, % dommages sorts / mêlée / distance…) passent par une table de correspondance `effectId` → stat, à établir et vérifier sur les données.

La synchronisation écrit des fichiers JSON dans `data/` (ignoré par git). Le moteur tourne ensuite entièrement hors ligne.

## Requête au moteur

Le moteur se lance en CLI, par exemple `node src/main.js optimize --query query.json`, et rend du JSON sur la sortie standard. Exemple de requête :

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
    "allowRingExos": true,
    "topCount": 3
}
```

Profils :

- **Stuff Eau / Air / …** : seuls les sorts (et la ligne d'arme) de l'élément choisi comptent dans le combo.
- **Do crit** : on garde les sorts de l'élément choisi et on impose un taux de critique minimum (`minCriticalRate`, ex. 60 %). _(Choix de Claude)_ : ce seuil porte sur le % critique de la fiche personnage, c'est-à-dire celui du stuff, sans le critique de base des sorts.

## Calcul des dégâts

Pour chaque ligne de dégâts d'un sort, dans l'élément du profil :

- normal = base × (100 + carac de l'élément + puissance) / 100 + dommages fixes + dommages de l'élément ;
- critique = même formule avec la base critique, plus les dommages critiques ;
- les deux sont ensuite multipliés par (1 + % dommages sorts) et par (1 + % dommages distance ou mêlée), selon la portée du sort ;
- la base est la moyenne de min et max ;
- dégâts moyens = (1 − p) × normal + p × critique, avec p = min(critique du sort + critique du stuff, 100 %).

Valeurs de base du personnage : 6 PA, plus 1 au niveau 100 (soit 7 PA), et 3 PM, aucun point de carac.

Lignes de dégâts prises en compte _(choix de Claude)_ : uniquement les dégâts directs sur la cible principale, sans condition (état, distance, marque, nombre de lancers) et sans tirage aléatoire. Les lignes de vol de vie (`effectId` 91 à 95) comptent comme des dégâts de leur élément. Les sorts qui n'ont aucune ligne retenue sortent du combo. La sortie liste les sorts ignorés, pour qu'on voie ce qui manque.

L'ordre exact des arrondis et des multiplicateurs est à vérifier contre le jeu (ou un simulateur fiable) avant de figer les tests.

## Tour complet

Un sac à dos borné sur les PA du stuff : on choisit le nombre de lancers de chaque sort pour maximiser la somme des dégâts moyens. Les règles :

- PA total dépensé ≤ PA du stuff ;
- lancers par sort ≤ `maxCastPerTurn` et ≤ `maxCastPerTarget` (une seule cible) ;
- un seul sort par paire de variantes ;
- l'arme équipée compte comme une action de plus : son coût en PA, ses lancers par tour, ses lignes de dégâts dans l'élément du profil et son critique propre, avec les % de dommages d'armes au lieu des % de dommages sorts ;
- seulement les sorts dont `minPlayerLevel` ≤ niveau, avec le grade le plus haut disponible ;
- relances et temps de recharge ignorés (un seul tour, sorts disponibles).

## Règles du stuff

- **Emplacements** :
    - 1 amulette, 2 anneaux, 1 ceinture, 1 paire de bottes, 1 chapeau, 1 cape ;
    - 1 monture ou familier (familier, montilier, dragodinde, muldo, volkorne) ;
    - 1 arme, 1 bouclier ;
    - 6 emplacements de Dofus, trophées ou prysmaradite.
- **Jets des items** : les stats sont prises au jet max, comme sur Dofusbook (stuff « parfait »). Les stats négatives prennent leur pire valeur. Ces valeurs servent au score, aux contraintes et aux conditions.
- **Familiers et montures** : on inclut les familiers et montiliers, nourris au maximum, ainsi que les dragodindes, muldos et volkornes. Dans Dofus 3, les montures sont des items comme les autres (`typeId` 331, 332 et 333) avec des stats fixes. Elles passent donc par l'endpoint `items` et ne demandent aucune source dédiée (vérifié le 2026-11-15).
- **Doublons** : un même item ne peut pas être porté deux fois (anneaux, Dofus).
- **Niveau** : un item ne peut pas dépasser le niveau du personnage.
- **Conditions** : les `criterions` sont évaluées sur les stats finales du stuff, exos compris. Exemple : `PA<12`. _(Choix de Claude)_ : les conditions qui ne portent pas sur les stats (alignement, quête, succès, classe, abonnement) sont considérées comme remplies. Elles sont signalées dans la sortie, et l'agent les mentionne.
- **Exos sur anneaux** : un exo PA ou PM par anneau au maximum. On ne peut pas exo PA un anneau qui donne déjà du PA, ni exo PM un anneau qui donne déjà du PM. Le moteur décide lui-même où les exos rapportent le plus.
- **Panoplies** : le bonus correspond au nombre d'items de la panoplie portés.

## Recherche (approche A)

1. **Pré-filtre** des items par emplacement : niveau, exclusions, et suppression des items dominés sur les stats qui comptent pour la requête (éléments du profil, PA, PM, résistances contraintes). Un item de panoplie n'est pas considéré comme dominé uniquement sur ses stats propres.
2. **Branch-and-bound** sur les emplacements. La borne supérieure est la somme des meilleures contributions possibles des emplacements restants, plus les meilleurs bonus de panoplie atteignables. Une branche qui ne peut ni battre le meilleur score ni satisfaire une contrainte est coupée.
3. **Évaluation d'une feuille** : stats totales → conditions → contraintes → exos → combo du tour → score.
4. **Limite de temps** dans `config.js` ; on garde le top N.

## Agent Claude Code

Fichier `.claude/agents/stuff-optimizer.md` dans le projet. Il :

- connaît les règles et le vocabulaire Dofus (profils, exos, contraintes) ;
- construit la requête JSON, lance le moteur et ne s'appuie que sur sa sortie ;
- pose une question si la classe ou le niveau manquent ;
- répond en français : stuff par emplacement avec exos, stats totales, combo du tour et dégâts, variantes proches avec leur coût en dégâts, et un avertissement si `isOptimal` vaut `false` ;
- peut lancer la synchronisation si les données manquent ou sont anciennes.

## Laissé au constructeur

- Le découpage précis en classes et fichiers, dans le respect des conventions.
- Le format exact de la sortie JSON du moteur.
- La table de correspondance `effectId` → stat, ainsi que le mapping `typeId` → emplacement.
- Le rythme et la politesse de la synchronisation (pagination, délai entre requêtes, en-tête User-Agent générique).
- Les techniques d'élagage et le choix de la borne, tant que le résultat reste exact sur l'ensemble des candidats.
