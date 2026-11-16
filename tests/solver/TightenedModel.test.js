const test = require("node:test");
const assert = require("node:assert/strict");
const BoundTightener = require("../../src/solver/BoundTightener");
const MilpModelBuilder = require("../../src/solver/MilpModelBuilder");
const HighsSolver = require("../../src/solver/HighsSolver");
const LinearExpression = require("../../src/solver/LinearExpression");
const { SENSE } = require("../../src/solver/LpWriter");
const { listRandomCases, toProblem } = require("./randomCases");
const { bruteForce } = require("./solverFixture");

const LONG_TIME_LIMIT_MS = 60000;
const CHECKED_STUFFS_PER_CASE = 24;
const TOLERANCE = 1e-6;

// The best stuffs and an even spread of the others, weakest included.
function sampleEvaluations(evaluations) {
    if (evaluations.length <= CHECKED_STUFFS_PER_CASE) return evaluations;
    const half = CHECKED_STUFFS_PER_CASE / 2;
    const step = (evaluations.length - half) / half;
    const spread = Array.from({ length: half }, (unused, index) => evaluations[Math.floor(half + index * step)]);
    return [...evaluations.slice(0, half), ...spread, evaluations.at(-1)];
}

async function solveWithItems(model, items) {
    const solver = await HighsSolver.create(model.lpText);
    try {
        const chosen = new Set(items);
        for (const item of model.itemModel.items) {
            const variable = LinearExpression.ofTerm(model.itemModel.variableOf(item));
            solver.addConstraint(variable, SENSE.EQUAL, chosen.has(item) ? 1 : 0);
        }
        return solver.solve({ timeLimitMs: LONG_TIME_LIMIT_MS });
    } finally {
        solver.dispose();
    }
}

// The tightened bounds and big-M constants must keep the exact assignment of every valid stuff feasible: with its
// items fixed, the model still reaches the stuff's exact score.
test("with its items fixed, every valid stuff reaches its exact score in the tightened model", async () => {
    for (const { label, context } of listRandomCases()) {
        const problem = toProblem(context);
        const statBounds = await new BoundTightener({ problem }).tighten({ timeLimitMs: LONG_TIME_LIMIT_MS });
        const model = new MilpModelBuilder({ ...problem, statBounds }).build();
        for (const evaluation of sampleEvaluations(bruteForce(context))) {
            const result = await solveWithItems(model, evaluation.items);
            const message = `${label}: ${result.objective} below ${evaluation.score}`;
            assert.equal(result.status, HighsSolver.STATUS.OPTIMAL, `${label}: ${result.status}`);
            assert.ok(result.objective >= evaluation.score - TOLERANCE * Math.max(1, evaluation.score), message);
        }
    }
});
