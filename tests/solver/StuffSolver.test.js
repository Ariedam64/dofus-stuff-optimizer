const test = require("node:test");
const assert = require("node:assert/strict");
const StuffSolver = require("../../src/solver/StuffSolver");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SLOT } = require("../../src/data/slots");
const { buildRandomCase, RANDOM_CASE_COUNT, FIRST_SEED } = require("./randomCases");
const {
    buildSpell,
    buildItem,
    buildWeapon,
    buildSet,
    buildContext,
    bruteForce,
    isDiverse,
    collect,
} = require("./solverFixture");

const LONG_DEADLINE_MS = 120000;
const SCORE_TOLERANCE = 1e-6;
const DIVERSE_RESULT_COUNT = 4;
const MIN_DIFFERENT_ITEMS = 3;
const PAST_MS = 1000;
const MAX_ITEMS_PER_SET_WITH_TROPHY = 2;
// The simple context reaches 9 AP at most (7 base, an AP hat, one ring exo).
const UNREACHABLE_MIN_AP = 12;
// Seeds whose optimum changes when one exo is disabled, some of them still using the other exo.
const SINGLE_EXO_SEEDS = [1002, 1015, 1017, 1018, 1019, 1021, 1037];
const SINGLE_EXO_CASES = SINGLE_EXO_SEEDS.flatMap((seed) => [
    { seed, ringExos: { ap: false, mp: true }, disabledExo: "ap" },
    { seed, ringExos: { ap: true, mp: false }, disabledExo: "mp" },
]);

function buildSolver(context) {
    return new StuffSolver(context);
}

function solveWithLongDeadline(context, options = {}) {
    return collect(buildSolver(context).solveDiverse({ deadlineMs: Date.now() + LONG_DEADLINE_MS, ...options }));
}

function assertSameScore(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) <= SCORE_TOLERANCE * Math.max(1, Math.abs(expected)), message);
}

test("first yield matches the brute-force optimum on random fixtures", async () => {
    for (let index = 0; index < RANDOM_CASE_COUNT; index++) {
        const seed = FIRST_SEED + index;
        const context = buildRandomCase(seed);
        const [best] = bruteForce(context);
        const yields = await solveWithLongDeadline(context);
        if (!best) {
            assert.equal(yields.length, 0, `seed ${seed}: no valid stuff expected`);
            continue;
        }
        assert.equal(yields.length, 1, `seed ${seed}: one yield expected`);
        const [first] = yields;
        assertSameScore(first.evaluation.score, best.score, `seed ${seed}: ${first.evaluation.score} vs ${best.score}`);
        assert.equal(first.solverStatus, "optimal", `seed ${seed}`);
        assert.equal(first.optimalityGapPercent, 0, `seed ${seed}`);
        assertSameScore(first.upperBound, best.score, `seed ${seed}: bound ${first.upperBound}`);
    }
});

test("first yield matches the brute-force optimum with the AP exo or the MP exo disabled", async () => {
    for (const { seed, ringExos, disabledExo } of SINGLE_EXO_CASES) {
        const label = `seed ${seed} without ${disabledExo} exo`;
        const context = buildRandomCase(seed, { ringExos });
        const [best] = bruteForce(context);
        const [first, ...others] = await solveWithLongDeadline(context);
        assert.ok(best && first && others.length === 0, `${label}: one yield expected`);
        assertSameScore(first.evaluation.score, best.score, `${label}: ${first.evaluation.score} vs ${best.score}`);
        assert.equal(first.solverStatus, "optimal", label);
        const exoKeys = first.evaluation.exos.map((exo) => exo.characteristic);
        assert.ok(!exoKeys.includes(disabledExo), `${label}: got exos ${exoKeys}`);
    }
});

function findBestDiverse(all, previousItems) {
    return all.find((evaluation) =>
        previousItems.every((items) => isDiverse(items, evaluation.items, MIN_DIFFERENT_ITEMS)),
    );
}

test("each diverse yield is the best stuff respecting the rule against the earlier ones", async () => {
    for (let index = 0; index < RANDOM_CASE_COUNT / 2; index++) {
        const seed = FIRST_SEED + index;
        const context = buildRandomCase(seed);
        context.query.resultCount = DIVERSE_RESULT_COUNT;
        context.query.minDifferentItems = MIN_DIFFERENT_ITEMS;
        const all = bruteForce(context);
        const yields = await solveWithLongDeadline(context);
        const yieldedItems = yields.map((result) => result.evaluation.items);
        for (let rank = 0; rank < DIVERSE_RESULT_COUNT; rank++) {
            const expected = findBestDiverse(all, yieldedItems.slice(0, rank));
            if (!expected) {
                assert.equal(yields.length, rank, `seed ${seed}: no stuff left after ${rank} yields`);
                break;
            }
            assert.ok(rank < yields.length, `seed ${seed}: yield ${rank + 1} missing`);
            const earlierItems = yieldedItems.slice(0, rank);
            const isRespected = earlierItems.every((items) =>
                isDiverse(items, yieldedItems[rank], MIN_DIFFERENT_ITEMS),
            );
            assert.ok(isRespected, `seed ${seed}: yield ${rank + 1} breaks the diversity rule`);
            assertSameScore(yields[rank].evaluation.score, expected.score, `seed ${seed}: yield ${rank + 1}`);
            assert.equal(yields[rank].solverStatus, "optimal", `seed ${seed}: yield ${rank + 1}`);
        }
    }
});

function buildSimpleContext(overrides = {}) {
    const spellGroups = [[buildSpell({ name: "Bolt", apCost: 3, damage: 20, maxCastPerTurn: 2 })]];
    const items = [
        buildWeapon({ damage: 25, apCost: 4 }),
        buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.CHANCE, 80]] }),
        buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.AP, 1]] }),
        buildItem({ slot: SLOT.RING, stats: [[CHARACTERISTIC.POWER, 30]] }),
    ];
    return buildContext({ items, spellGroups, ...overrides });
}

test("infeasible constraints end the generator without any yield", async () => {
    const yields = await solveWithLongDeadline(buildSimpleContext({ constraints: { minAp: UNREACHABLE_MIN_AP } }));
    assert.deepEqual(yields, []);
});

test("a deadline already passed yields at most the warm start, never as optimal", async () => {
    const context = buildSimpleContext();
    const warmItems = [context.candidates.get(SLOT.HAT)[0]];
    const solver = buildSolver(context);
    // A search already holding a stuff keeps its own deadline, however late the latest one is.
    const yields = await collect(
        solver.solveDiverse({
            deadlineMs: Date.now() - PAST_MS,
            latestDeadlineMs: Date.now() + LONG_DEADLINE_MS,
            warmStart: [warmItems],
        }),
    );
    assert.ok(yields.length <= 1);
    for (const result of yields) {
        assert.notEqual(result.solverStatus, "optimal");
        assert.equal(result.upperBound, null);
        assert.deepEqual(
            result.evaluation.items.map((item) => item.id),
            warmItems.map((item) => item.id),
        );
    }
});

test("a search without any stuff at its deadline looks for a first one until the latest deadline", async () => {
    const solver = buildSolver(buildSimpleContext({ resultCount: DIVERSE_RESULT_COUNT, minDifferentItems: 1 }));
    const yields = await collect(
        solver.solveDiverse({ deadlineMs: Date.now() - PAST_MS, latestDeadlineMs: Date.now() + LONG_DEADLINE_MS }),
    );
    // Once it holds that stuff, the search keeps its own deadline, already passed.
    assert.equal(yields.length, 1);
    assert.equal(solver.endReason, StuffSolver.END_REASON.DEADLINE);
});

test("a pk trophy keeps every set at two items at most", async () => {
    const setItems = [SLOT.HAT, SLOT.AMULET, SLOT.BOOTS, SLOT.BELT].map((slot) =>
        buildItem({ slot, stats: [[CHARACTERISTIC.CHANCE, 10]] }),
    );
    for (const item of setItems) item.setId = 5;
    const set = buildSet(5, setItems, [
        [2, [[CHARACTERISTIC.POWER, 10]]],
        [4, [[CHARACTERISTIC.POWER, 60]]],
    ]);
    const trophy = buildItem({ slot: SLOT.DOFUS, stats: [[CHARACTERISTIC.POWER, 120]], criterion: "pk<2" });
    const spellGroups = [[buildSpell({ name: "Bolt", apCost: 3, damage: 20, maxCastPerTurn: 2 })]];
    const context = buildContext({ items: [...setItems, trophy], sets: [set], spellGroups });
    const [best] = bruteForce(context);
    const [first] = await solveWithLongDeadline(context);
    assertSameScore(first.evaluation.score, best.score, "pk optimum");
    assert.ok(first.evaluation.items.includes(trophy));
    const setCount = first.evaluation.items.filter((item) => item.setId === 5).length;
    assert.ok(setCount <= MAX_ITEMS_PER_SET_WITH_TROPHY);
});

test("endReason tells why the search stopped, without reading the clock", async () => {
    const endReasonOf = async (context, deadlineMs) => {
        const solver = buildSolver(context);
        await collect(solver.solveDiverse({ deadlineMs }));
        return solver.endReason;
    };
    const { END_REASON } = StuffSolver;
    const later = Date.now() + LONG_DEADLINE_MS;
    const unreachableContext = buildSimpleContext({ constraints: { minAp: UNREACHABLE_MIN_AP } });
    assert.equal(await endReasonOf(buildSimpleContext(), later), END_REASON.COUNT);
    assert.equal(await endReasonOf(unreachableContext, later), END_REASON.INFEASIBLE);
    assert.equal(await endReasonOf(buildSimpleContext(), Date.now() - PAST_MS), END_REASON.DEADLINE);
    assert.equal(buildSolver(buildSimpleContext()).endReason, null);
});
