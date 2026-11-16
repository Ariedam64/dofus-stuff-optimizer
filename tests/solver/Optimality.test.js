const test = require("node:test");
const assert = require("node:assert/strict");
const Optimality = require("../../src/solver/Optimality");

const { SOLVER_STATUS } = Optimality;

test("a score is clearly below a bound only beyond the solver tolerances", () => {
    assert.equal(Optimality.isClearlyBelow(99, 100), true);
    assert.equal(Optimality.isClearlyBelow(100 - 1e-5, 100), false);
    assert.equal(Optimality.isClearlyBelow(100, 100), false);
    assert.equal(Optimality.isClearlyBelow(101, 100), false);
});

test("the gap is the bound's distance to the score, in percent of the bound", () => {
    assert.equal(Optimality.computeGapPercent(80, 100), 20);
    assert.equal(Optimality.computeGapPercent(100, 100), 0);
});

test("a stuff is optimal at its bound, has a gap below it, and is unproven without one", () => {
    assert.deepEqual(Optimality.describe(100, 100), { solverStatus: SOLVER_STATUS.OPTIMAL, optimalityGapPercent: 0 });
    assert.deepEqual(Optimality.describe(75, 100), { solverStatus: SOLVER_STATUS.GAP, optimalityGapPercent: 25 });
    for (const upperBound of [null, Infinity]) {
        assert.deepEqual(Optimality.describe(75, upperBound), {
            solverStatus: SOLVER_STATUS.HEURISTIC,
            optimalityGapPercent: null,
        });
    }
});
