# Moteur v3 — Qualité de recherche et vitesse

Date : 2026-11-16. Fait suite à la v2 (`2026-11-16-solver-points-web-design.md`). Demande de l'utilisateur : « fais tous les points 1 et 2 ».

## Intention

Sur les vraies données, le solveur v2 ne prouve jamais l'optimum (écart ≈ 80 %), et une recherche prend 25 à 60 s. L'utilisateur craint de rater de meilleurs stuffs. La v3 doit :

- trouver de meilleurs stuffs ;
- réduire l'écart prouvé, et idéalement prouver l'optimum ;
- aller plus vite ;
- ne rien changer au calcul exact des dégâts, ni au contrat de sortie (format des résultats, page, agent).

## Objectifs (points 1 et 2 validés par l'utilisateur)

1. **Bornes resserrées.** Avant de résoudre, on calcule pour chaque stat utile sa vraie valeur min/max atteignable sous les contraintes et les règles d'emplacement (par LP ou par un calcul combinatoire valide). On les injecte comme bornes des variables et dans les enveloppes de McCormick et les grands M.
2. **Découpage par arme.** L'espace est partitionné par arme (ou par groupe d'armes, plus « sans arme »). Chaque sous-problème est résolu dans un worker, en parallèle. Un sous-problème dont la borne est sous le meilleur connu est élagué. Les résultats sont fusionnés en respectant la diversité globale.
3. **Critique par tranches.** Le taux de critique est fixé par tranche (par exemple 0 %, 100 % et des paliers intermédiaires). Chaque tranche donne un modèle plus simple et plus serré. Le meilleur des tranches est valide seulement si les tranches couvrent tout l'espace : l'exactitude doit être conservée ou le statut dégradé.
4. **Recherche par voisinage (LNS).** À partir du meilleur stuff, on fige k emplacements et le solveur optimise les autres, en boucle, pendant le temps restant. On obtient de meilleurs stuffs même sans preuve.
5. **Fil de calcul chargé en permanence.** Un pool de workers démarre avec le serveur ou la CLI, avec GameData déjà chargé. Plus de rechargement d'environ 1,6 s à chaque recherche.
6. **Parallélisme.** Le pool utilise plusieurs cœurs : `min(nombre de cœurs − 1, config.MAX_SOLVER_WORKERS)`, 4 par défaut. Il sert au découpage par arme : les tranches de critique, qui devaient aussi l'utiliser, ont été retirées (voir « Résultat négatif : tranches de critique »).

## Non-objectifs

- Aucun changement de règle de jeu, de formule de dégâts, de format de résultat, de page ou d'agent (hormis les durées citées).
- Pas de nouvelle dépendance (HiGHS reste le seul solveur).

## Anti-objectifs

- Une borne invalide. Tout resserrement doit rester une borne supérieure valide : un « optimal » faux est pire qu'un « non prouvé ».
- Une régression de qualité ou de temps sur le banc de mesure.
- Une machine figée : le pool laisse au moins un cœur libre.

## Mesure

Un banc de mesure versionné (`scripts/benchmark.js`) exécute des requêtes fixes et écrit un tableau. Il mesure :

- le temps jusqu'au premier stuff ;
- le temps total ;
- le meilleur score et le 10e ;
- le nombre de stuffs `optimal` ;
- l'écart borne/meilleur.

Requêtes fixes :

- Crâ 200 Eau, 11 PA / 6 PM ;
- Iop 200 Terre, 11 PA / 6 PM ;
- Sadida 120 Air, 9 PA / 5 PM ;
- Eniripsa 60 Feu ;
- une requête impossible.

La base de comparaison (v2) est mesurée avant tout changement. Chaque tâche rapporte ses chiffres.

## Choix de Claude

- **Ordre :** banc de mesure → pool de workers et bornes (en parallèle) → découpage par arme et tranches de critique (en parallèle) → LNS → mesure finale et revue globale.
- **Exactitude :** l'évaluateur exact reste l'autorité. Toute borne est validée par les tests force brute existants, plus de nouveaux tests ciblés qui comparent la borne à l'optimum énuméré.
- **Commits :** aucun commit sans demande de l'utilisateur. Le dépôt est public depuis le 2026-11-16, donc le travail reste non commité, comme en v2.

## Résultat négatif : tranches de critique

L'objectif 3 a été implémenté, mesuré, puis retiré. Une tranche découpait la stat de critique, et non la chance, car chaque sort a son propre taux de base. Chaque tranche avait son propre modèle exact, et la preuve globale prenait la plus haute borne des tranches. L'exactitude tenait : les tests force brute passaient tranche par tranche.

Mesures sur Crâ 200 Eau, 11 PA / 6 PM :

- **Relaxation LP.** Elle vaut 8 798 sans tranches. Les tranches basses descendent jusqu'à 6 640, mais la tranche de critique la plus haute reste vers 8 570, soit −2,6 %. La preuve doit couvrir toutes les tranches, et les meilleurs stuffs réels sont justement dans cette tranche haute (critique de 47 à 115, dont 7 sur 10 au-dessus de 90).
- **Borne MILP à temps égal.** Elle passe de 7 476 (un modèle, 20 s) à 7 445 (5 tranches de 10 s, donc 50 s en tout).
- **Écart prouvé.** Il passe de 53,0 % à 52,0 %, pour les mêmes stuffs. En échange, le premier stuff arrive 2,5 à 3,6 s plus tard et le total prend 2 à 24 s de plus. Le banc ne gagne aucun score.

Pourquoi : l'écart ne vient pas du critique. Il vient de deux relaxations du modèle :

- **Les produits « nombre de lancers × dégâts ».** La relaxation prend des fractions de lancer avec des dégâts par lancer autour de 60–70 % de leur borne, et obtient ainsi environ 1,5 fois les lancers pour les mêmes PA.
- **Les bits des facteurs %.** Par exemple, 1,56 % de dommages à distance sont comptés comme un facteur ×1,16.

Découper par tranches de la stat principale (élément + puissance) ne bouge pas non plus la relaxation.

Le découpage par tranches a donc été retiré, car on ne garde pas d'abstraction « au cas où ». Seule reste une borne plus fine des dégâts d'un lancer selon la plage de chance de critique atteignable. Elle est valide, testée, et ne coûte rien.

## Résultat négatif : recherche par voisinage (LNS)

L'objectif 4 a été implémenté, mesuré, puis retiré.

À partir du meilleur stuff, la recherche gardait tous les objets sauf ceux de 2 emplacements libérés. Les dofus et les anneaux passaient en premier. Le solveur résolvait ensuite le modèle exact de ce voisinage, en 400 ms au plus. Elle ne gardait que les améliorations strictes, notées par l'évaluateur exact, et respectait les coupes de diversité. Elle ne prouvait rien.

Elle ne tournait que lorsque la phase exacte ne prouvait pas le stuff, sur 25 % de la tranche de temps de chaque stuff. L'exactitude tenait : les tests force brute passaient, et les statuts restaient honnêtes.

Banc (`npm run bench`, lancé seul). Chaque case donne le temps total (s), le meilleur score et le 10e.

| requête | sans LNS | avec LNS | v2 |
| --- | --- | --- | --- |
| cra-200-water | 21,9 / 4312,4 / 3991,4 | 22,8 / 4312,4 / 3991,4 | 29,6 / 4213,2 / 3862,3 |
| iop-200-earth | 21,5 / 4353,4 / 4096,1 | 22,6 / 4375,7 / 4114,1 | 30,5 / 4122,1 / 3728,3 |
| sadida-120-air | 21,5 / 1630,1 / 1548,6 | 22,6 / 1630,1 / 1548,6 | 53,2 / 1630,1 / 1584 |
| eniripsa-60-fire | 14,3 / 675 / 660,5 | **22,4** / 675 / 662,1 | 16,3 / 667,1 / 657,5 |
| cra-200-water-one-ring-exo | 21,7 / 4288,9 / 3994,8 | **22,5** / 4312,4 / 3969,7 | 21,9 / 4134,4 / 3561,8 |
| impossible-cra-1-water | 0,0 | 0,0 | 1,1 |

Pourquoi le LNS a été retiré :

- **Le temps.** Chaque partition tourne alors jusqu'à son échéance, car le LNS consomme le temps qui restait libre. Eniripsa 60 passe de 14,3 s à 22,4 s, et la requête avec un exo PA passe de 21,7 s à 22,5 s : les deux deviennent plus lentes que la v2. Le premier stuff arrive aussi 0,3 à 0,8 s plus tard.
- **Le gain.** Il est de l'ordre du bruit d'une mesure à l'autre : +0,5 % sur deux meilleurs scores, et un 10e score tantôt meilleur, tantôt moins bon. L'heuristique et la phase exacte trouvent déjà des stuffs proches du meilleur, et la recherche découpée par arme en trouve davantage.
- **Le budget.** Hors banc, une rotation complète des paires d'emplacements (45 voisinages, 1 s chacun) a fait passer un stuff de 4193,3 à 4332,9. Il faut pour cela bien plus de temps qu'une recherche n'en accorde à un stuff.

La recherche par voisinage a donc été retirée, car on ne garde pas d'abstraction « au cas où ».
