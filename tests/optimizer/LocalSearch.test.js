const test = require("node:test");
const assert = require("node:assert/strict");
const LocalSearch = require("../../src/optimizer/LocalSearch");
const SearchSpace = require("../../src/optimizer/SearchSpace");
const StuffRanking = require("../../src/optimizer/StuffRanking");
const ItemSet = require("../../src/data/ItemSet");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { buildItem, buildWeapon, buildContext } = require("./optimizerFixture");

const { AP, CHANCE } = CHARACTERISTIC;
const REQUIRED_AP = 9;
const SET_ID = 1;
const SET_BONUS_CHANCE = 300;
const OPTIMISTIC_POINT_CHANCE = 498;

function runLocalSearch(context, nowFn = Date.now) {
    const ranking = new StuffRanking(context.query.resultCount);
    const localSearch = new LocalSearch({
        searchSpace: new SearchSpace({ candidates: context.candidates, query: context.query }),
        evaluator: context.evaluator,
        ranking,
        nowFn,
    });
    return { result: localSearch.run(Infinity), ranking };
}

test("warm start finds a valid stuff when constraints require AP items", () => {
    const context = buildContext({
        allowRingExos: false,
        constraints: { minAp: REQUIRED_AP },
        items: [
            buildWeapon({ stats: [[CHANCE, 80]] }),
            buildItem({ slot: "hat", stats: [[CHANCE, 120]] }),
            buildItem({ slot: "hat", stats: [[AP, 1]] }),
            buildItem({ slot: "ring", stats: [[CHANCE, 90]] }),
            buildItem({ slot: "ring", stats: [[CHANCE, 70]] }),
            buildItem({ slot: "ring", stats: [[AP, 1]] }),
            buildItem({ slot: "boots", stats: [[CHANCE, 60]] }),
        ],
    });
    const { result, ranking } = runLocalSearch(context);
    assert.equal(result.violation, 0);
    assert.equal(ranking.evaluations.length, 1);
    const best = ranking.evaluations[0];
    assert.ok(best.stats.get(AP) >= REQUIRED_AP);
    assert.equal(best.score, result.score);
});

test("local search improves on the greedy fill", () => {
    // Greedy fills boots first and takes the big chance boots; swapping them for the set boots then pays off.
    const set = new ItemSet({
        id: SET_ID,
        name: "set",
        itemIds: [],
        bonusesByCount: [new Stats(), new Stats([[CHANCE, SET_BONUS_CHANCE]])],
    });
    const context = buildContext({
        sets: [set],
        allowRingExos: false,
        items: [
            buildItem({ slot: "boots", stats: [[CHANCE, 100]] }),
            buildItem({ slot: "boots", setId: SET_ID }),
            buildItem({ slot: "hat", stats: [[CHANCE, 30]], setId: SET_ID }),
            buildItem({ slot: "hat", stats: [[CHANCE, 20]] }),
        ],
    });
    const { result } = runLocalSearch(context);
    assert.equal(result.items.filter((item) => item.setId === SET_ID).length, 2);
});

test("greedy fill stops when the warm start budget is spent", () => {
    let nowMs = 0;
    const nowFn = () => {
        nowMs += 1;
        return nowMs;
    };
    const context = buildContext({
        allowRingExos: false,
        items: [buildItem({ slot: "hat", stats: [[CHANCE, 10]] }), buildItem({ slot: "boots", stats: [[CHANCE, 10]] })],
    });
    const ranking = new StuffRanking(context.query.resultCount);
    const searchSpace = new SearchSpace({ candidates: context.candidates, query: context.query });
    const result = new LocalSearch({ searchSpace, evaluator: context.evaluator, ranking, nowFn }).run(0);
    assert.deepEqual(result.items, []);
    assert.equal(ranking.evaluations.length, 1);
});

test("local search can wear several pk trophies", () => {
    const buildTrophy = () => buildItem({ slot: "dofus", criterion: "pk<2", stats: [[CHANCE, 50]] });
    const context = buildContext({ allowRingExos: false, items: [buildTrophy(), buildTrophy(), buildTrophy()] });
    const { result } = runLocalSearch(context);
    assert.equal(result.items.length, 3);
});

test("invalid stuffs are scored with the optimistic points and scrolls", () => {
    const context = buildContext({ allowRingExos: false, items: [buildItem({ slot: "hat", stats: [[CHANCE, 10]] })] });
    const measuredChances = [];
    const evaluator = {
        evaluate: () => null,
        measureViolation: () => 1,
        buildActionGroups: () => [],
        computeStats: (items) => context.evaluator.computeStats(items),
        optimisticPointStats: new Stats([[CHANCE, OPTIMISTIC_POINT_CHANCE]]),
        computeUpperBound: (stats) => {
            measuredChances.push(stats.get(CHANCE));
            return 0;
        },
    };
    const searchSpace = new SearchSpace({ candidates: context.candidates, query: context.query });
    const ranking = new StuffRanking(context.query.resultCount);
    new LocalSearch({ searchSpace, evaluator, ranking, nowFn: Date.now }).run(Infinity);
    assert.ok(measuredChances.length > 0);
    assert.ok(measuredChances.every((chance) => chance >= OPTIMISTIC_POINT_CHANCE));
});
