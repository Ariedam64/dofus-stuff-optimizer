const test = require("node:test");
const assert = require("node:assert/strict");
const StuffSolver = require("../../src/solver/StuffSolver");
const HighsSolver = require("../../src/solver/HighsSolver");
const MilpModelBuilder = require("../../src/solver/MilpModelBuilder");
const { buildRandomCase } = require("./randomCases");
const { bruteForce, isDiverse, collect, withReplaced } = require("./solverFixture");

const LONG_DEADLINE_MS = 120000;
const SCORE_TOLERANCE = 1e-6;
const RESULT_COUNT = 4;
const MIN_DIFFERENT_ITEMS = 3;
// Seeds whose later yields were missed or left unproven when one early time limit skipped every later exact phase.
const CUT_SHORT_SEEDS = [1000, 1002, 1016, 1019];
const EXACT_OBJECTIVE_PATTERN = new RegExp(`^ obj:\\s+1 ${MilpModelBuilder.DAMAGE_VARIABLE}$`, "m");

function isExactModel(lpText) {
    return EXACT_OBJECTIVE_PATTERN.test(lpText) && lpText.includes("\nBinaries");
}

// The first solve of the exact model reports its time limit, with its incumbent and its valid dual bound.
async function solveWithFirstExactSolveCutShort(context) {
    const totalSolvesBySolver = new WeakMap();
    const markExact = (original) =>
        async function (lpText, options) {
            const solver = await original.call(this, lpText, options);
            if (isExactModel(lpText)) totalSolvesBySolver.set(solver, 0);
            return solver;
        };
    const cutFirstSolve = (original) =>
        function (options) {
            const result = original.call(this, options);
            if (!totalSolvesBySolver.has(this)) return result;
            const totalSolves = totalSolvesBySolver.get(this) + 1;
            totalSolvesBySolver.set(this, totalSolves);
            if (totalSolves > 1 || !result.hasSolution) return result;
            return { ...result, status: HighsSolver.STATUS.TIME_LIMIT };
        };
    return withReplaced(HighsSolver, "create", markExact, () =>
        withReplaced(HighsSolver.prototype, "solve", cutFirstSolve, () =>
            collect(new StuffSolver(context).solveDiverse({ deadlineMs: Date.now() + LONG_DEADLINE_MS })),
        ),
    );
}

test("one exact phase cut short by its time limit does not skip the exact phase of the later stuffs", async () => {
    for (const seed of CUT_SHORT_SEEDS) {
        const context = buildRandomCase(seed);
        context.query.resultCount = RESULT_COUNT;
        context.query.minDifferentItems = MIN_DIFFERENT_ITEMS;
        const all = bruteForce(context);
        const yields = await solveWithFirstExactSolveCutShort(context);
        const yieldedItems = yields.map((result) => result.evaluation.items);
        for (let rank = 1; rank < RESULT_COUNT; rank++) {
            const earlier = yieldedItems.slice(0, rank);
            const expected = all.find((evaluation) =>
                earlier.every((items) => isDiverse(items, evaluation.items, MIN_DIFFERENT_ITEMS)),
            );
            if (!expected) break;
            const label = `seed ${seed}: yield ${rank + 1}`;
            assert.ok(rank < yields.length, `${label} missing`);
            const { score } = yields[rank].evaluation;
            assert.ok(Math.abs(score - expected.score) <= SCORE_TOLERANCE * Math.max(1, expected.score), label);
            assert.equal(yields[rank].solverStatus, "optimal", label);
        }
    }
});
