const test = require("node:test");
const assert = require("node:assert/strict");

const HIGHS_SOLVER_PATH = require.resolve("../../src/solver/HighsSolver");
const HIGHS_PATH = require.resolve("highs");
const TIME_LIMIT_MS = 1000;
const UNBOUNDED_LP = "Maximize\n obj: x\nSubject To\n c1: x + y >= 1\nBounds\n y <= 0\nEnd\n";
const SMALL_LP = "Maximize\n obj: x\nSubject To\n c1: x <= 3\nEnd\n";
const SMALL_LP_OPTIMUM = 3;
const KNAPSACK_SEED = 7;
const KNAPSACK_ITEM_COUNT = 70;
const KNAPSACK_ROW_COUNT = 8;
const KNAPSACK_MIN_VALUE = 100;
const KNAPSACK_VALUE_RANGE = 900;
const KNAPSACK_TIME_LIMIT_MS = 30000;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2147483648;

// Loads a fresh HighsSolver whose "highs" module is replaced, so its cached loading starts over.
function loadHighsSolverWith(loadHighs) {
    require(HIGHS_PATH);
    const highsModule = require.cache[HIGHS_PATH];
    const originalExports = highsModule.exports;
    highsModule.exports = loadHighs(originalExports);
    delete require.cache[HIGHS_SOLVER_PATH];
    try {
        return require(HIGHS_SOLVER_PATH);
    } finally {
        highsModule.exports = originalExports;
        delete require.cache[HIGHS_SOLVER_PATH];
    }
}

test("a status HiGHS does not report as optimal, time limit or infeasible throws with its code", async () => {
    const HighsSolver = require(HIGHS_SOLVER_PATH);
    const solver = await HighsSolver.create(UNBOUNDED_LP);
    try {
        assert.throws(() => solver.solve({ timeLimitMs: TIME_LIMIT_MS }), /unexpected model status \d+/);
    } finally {
        solver.dispose();
    }
});

test("a failed HiGHS loading is not cached: the next create retries", async () => {
    let totalLoads = 0;
    const failFirstLoad = (realLoad) => () => {
        totalLoads += 1;
        return totalLoads === 1 ? Promise.reject(new Error("out of memory")) : realLoad();
    };
    const HighsSolver = loadHighsSolverWith(failFirstLoad);
    await assert.rejects(HighsSolver.create(SMALL_LP), /Cannot load the HiGHS solver: out of memory/);
    const solver = await HighsSolver.create(SMALL_LP);
    try {
        const result = solver.solve({ timeLimitMs: TIME_LIMIT_MS });
        assert.deepEqual([result.status, result.objective], [HighsSolver.STATUS.OPTIMAL, SMALL_LP_OPTIMUM]);
    } finally {
        solver.dispose();
    }
    assert.equal(totalLoads, 2);
});

// A seeded multidimensional knapsack: HiGHS holds a first solution long before it proves the optimum.
function buildKnapsackLp() {
    let seed = KNAPSACK_SEED;
    const nextInteger = () => {
        seed = (seed * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
        return Math.floor((seed / LCG_MODULUS) * KNAPSACK_VALUE_RANGE) + KNAPSACK_MIN_VALUE;
    };
    const columns = Array.from({ length: KNAPSACK_ITEM_COUNT }, (unused, index) => `x${index}`);
    const sumOf = (coefficients) => columns.map((column, index) => `${coefficients[index]} ${column}`).join(" + ");
    const rows = Array.from({ length: KNAPSACK_ROW_COUNT }, (unused, row) => {
        const weights = columns.map(nextInteger);
        const capacity = Math.floor(weights.reduce((total, weight) => total + weight, 0) / 2);
        return ` c${row}: ${sumOf(weights)} <= ${capacity}`;
    });
    const objective = sumOf(columns.map(nextInteger));
    return `Maximize\n obj: ${objective}\nSubject To\n${rows.join("\n")}\nBinary\n ${columns.join(" ")}\nEnd\n`;
}

test("past stopAtSolutionAfterMs, a MIP solve stops at its first solution with a valid bound", async () => {
    const HighsSolver = require(HIGHS_SOLVER_PATH);
    const lpText = buildKnapsackLp();
    const solveWith = async (options) => {
        const solver = await HighsSolver.create(lpText);
        try {
            return solver.solve({ timeLimitMs: KNAPSACK_TIME_LIMIT_MS, ...options });
        } finally {
            solver.dispose();
        }
    };
    const optimum = await solveWith({});
    const early = await solveWith({ stopAtSolutionAfterMs: 0 });
    assert.equal(optimum.status, HighsSolver.STATUS.OPTIMAL);
    assert.deepEqual([early.status, early.hasSolution], [HighsSolver.STATUS.TIME_LIMIT, true]);
    assert.ok(early.objective < optimum.objective);
    assert.ok(early.dualBound >= optimum.objective);
});
