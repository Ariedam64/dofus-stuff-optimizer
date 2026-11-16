const test = require("node:test");
const assert = require("node:assert/strict");

const HIGHS_SOLVER_PATH = require.resolve("../../src/solver/HighsSolver");
const HIGHS_PATH = require.resolve("highs");
const TIME_LIMIT_MS = 1000;
const UNBOUNDED_LP = "Maximize\n obj: x\nSubject To\n c1: x + y >= 1\nBounds\n y <= 0\nEnd\n";
const SMALL_LP = "Maximize\n obj: x\nSubject To\n c1: x <= 3\nEnd\n";
const SMALL_LP_OPTIMUM = 3;

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
