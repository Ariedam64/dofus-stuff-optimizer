const test = require("node:test");
const assert = require("node:assert/strict");
const StuffSolver = require("../../src/solver/StuffSolver");
const HeuristicSearch = require("../../src/solver/HeuristicSearch");
const HighsSolver = require("../../src/solver/HighsSolver");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SLOT } = require("../../src/data/slots");
const { buildRandomCase } = require("./randomCases");
const { buildSpell, buildItem, buildContext, bruteForce, collect, withReplaced } = require("./solverFixture");

const LONG_DEADLINE_MS = 120000;
const PAST_MS = 1000;
const SCORE_TOLERANCE = 1e-6;
const FEASIBLE_SEED = 1001;
const MISSED_SOLVES = 2;
const DISPROVED_RESULT_COUNT = 3;
const DISPROVED_MIN_DIFFERENT_ITEMS = 3;
const SMALL_OVERSTATEMENT = 1.5;
const LARGE_OVERSTATEMENT = 100;
const SHORT_DEADLINE_MS = 3000;

function solve(context, options = {}) {
    return collect(new StuffSolver(context).solveDiverse({ deadlineMs: Date.now() + LONG_DEADLINE_MS, ...options }));
}

test("solves without the heuristic when the first exact solves end without any stuff", async () => {
    const context = buildRandomCase(FEASIBLE_SEED);
    const [best] = bruteForce(context);
    let totalSolves = 0;
    const missFirstSolves = (original) =>
        function (options) {
            totalSolves += 1;
            const isRelaxation = totalSolves === 1;
            if (!isRelaxation && totalSolves <= MISSED_SOLVES + 1) {
                return { status: HighsSolver.STATUS.TIME_LIMIT, hasSolution: false, dualBound: Infinity };
            }
            return original.call(this, options);
        };
    const yields = await withReplaced(
        HeuristicSearch.prototype,
        "run",
        () => async () => [],
        () => withReplaced(HighsSolver.prototype, "solve", missFirstSolves, () => solve(context)),
    );
    assert.equal(yields.length, 1);
    assert.ok(Math.abs(yields[0].evaluation.score - best.score) <= SCORE_TOLERANCE * best.score);
    assert.equal(yields[0].solverStatus, "optimal");
});

function buildRequiredItemContext() {
    const spellGroups = [[buildSpell({ name: "Bolt", apCost: 3, damage: 20, maxCastPerTurn: 2 })]];
    const required = buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.AGILITY, 5]] });
    const strongHat = buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.CHANCE, 200]] });
    const context = buildContext({
        items: [required, strongHat],
        spellGroups,
        constraints: { requiredItemIds: [required.id] },
    });
    return { context, required, strongHat };
}

test("a warm start breaking the query rules is never yielded nor used as a start", async () => {
    const { context, required, strongHat } = buildRequiredItemContext();
    const pastYields = await collect(
        new StuffSolver(context).solveDiverse({ deadlineMs: Date.now() - PAST_MS, warmStart: [[strongHat]] }),
    );
    assert.deepEqual(pastYields, []);
    const yields = await solve(context, { warmStart: [[strongHat], [required, strongHat]] });
    assert.equal(yields.length, 1);
    assert.deepEqual(yields[0].evaluation.items, [required]);
});

function toStuffKey(items) {
    return items
        .map((item) => item.id)
        .sort((first, second) => first - second)
        .join(",");
}

// The exact score of one stuff beats what the model gives it: the model is disproved and its bound is worthless.
function overstateScoreOf(evaluator, overstatedItems, factor) {
    const overstatedKey = toStuffKey(overstatedItems);
    const evaluate = (items) => {
        const evaluation = evaluator.evaluate(items);
        if (!evaluation || toStuffKey(items) !== overstatedKey) return evaluation;
        return { ...evaluation, score: evaluation.score * factor };
    };
    return new Proxy(evaluator, {
        get(target, property) {
            if (property === "evaluate") return evaluate;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function assertAllUnproven(yields) {
    for (const [index, result] of yields.entries()) {
        assert.equal(result.solverStatus, "heuristic", `yield ${index + 1}`);
        assert.equal(result.optimalityGapPercent, null, `yield ${index + 1}`);
        assert.equal(result.upperBound, null, `yield ${index + 1}`);
    }
}

test("once a stuff scores above the model, no later stuff is proven optimal or given a gap", async () => {
    const context = buildRandomCase(FEASIBLE_SEED);
    context.query.resultCount = DISPROVED_RESULT_COUNT;
    context.query.minDifferentItems = DISPROVED_MIN_DIFFERENT_ITEMS;
    const [best] = bruteForce(context);
    const evaluator = overstateScoreOf(context.evaluator, best.items, SMALL_OVERSTATEMENT);
    const yields = await solve({ ...context, evaluator });
    assert.ok(yields.length >= 2, `${yields.length} yields`);
    assertAllUnproven(yields);
});

test("an exact score clearly above the upper bound is never reported optimal", async () => {
    const context = buildRandomCase(FEASIBLE_SEED);
    const [best] = bruteForce(context);
    const evaluator = overstateScoreOf(context.evaluator, best.items, LARGE_OVERSTATEMENT);
    let totalSolves = 0;
    const missExactSolves = (original) =>
        function (options) {
            totalSolves += 1;
            if (totalSolves > 1)
                return { status: HighsSolver.STATUS.TIME_LIMIT, hasSolution: false, dualBound: Infinity };
            return original.call(this, options);
        };
    const yields = await withReplaced(HighsSolver.prototype, "solve", missExactSolves, () =>
        collect(
            new StuffSolver({ ...context, evaluator }).solveDiverse({
                deadlineMs: Date.now() + SHORT_DEADLINE_MS,
                warmStart: [best.items],
            }),
        ),
    );
    assert.equal(yields.length, 1);
    assert.equal(toStuffKey(yields[0].evaluation.items), toStuffKey(best.items));
    assertAllUnproven(yields);
});
