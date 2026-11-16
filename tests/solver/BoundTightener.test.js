const test = require("node:test");
const assert = require("node:assert/strict");
const BoundTightener = require("../../src/solver/BoundTightener");
const MilpModelBuilder = require("../../src/solver/MilpModelBuilder");
const HighsSolver = require("../../src/solver/HighsSolver");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { buildRandomCase, listRandomCases, toProblem, weigh, FIRST_SEED } = require("./randomCases");
const { bruteForce, withReplaced } = require("./solverFixture");

const LONG_TIME_LIMIT_MS = 60000;
const NO_TIME_MS = 0;
const TOLERANCE = 1e-6;
const DAMAGE_STAT_NAMES = ["qm", "qf", "qc"];

function assertContainsEvaluations(bounds, evaluations, label) {
    for (const [name, { weights, lower, upper }] of bounds) {
        for (const evaluation of evaluations) {
            const value = weigh(evaluation.stats, weights);
            const message = `${label} ${name}: ${value} outside [${lower}, ${upper}]`;
            assert.ok(value >= lower - TOLERANCE && value <= upper + TOLERANCE, message);
        }
    }
}

async function solveRelaxation(lpText) {
    const solver = await HighsSolver.create(lpText);
    try {
        return solver.solve({ timeLimitMs: LONG_TIME_LIMIT_MS });
    } finally {
        solver.dispose();
    }
}

test("tightened stat bounds contain the stats of every valid stuff on random fixtures", async () => {
    for (const { label, context } of listRandomCases()) {
        const evaluations = bruteForce(context);
        const tightener = new BoundTightener({ problem: toProblem(context) });
        const tightened = await tightener.tighten({ timeLimitMs: LONG_TIME_LIMIT_MS });
        const fallback = await tightener.tighten({ timeLimitMs: NO_TIME_MS });
        assertContainsEvaluations(tightened, evaluations, `${label} (LP)`);
        assertContainsEvaluations(fallback, evaluations, `${label} (combinatorial)`);
    }
});

test("LP bounds are never looser than the combinatorial ones and cover the damage stats", async () => {
    for (const { label, context } of listRandomCases()) {
        const tightener = new BoundTightener({ problem: toProblem(context) });
        const tightened = await tightener.tighten({ timeLimitMs: LONG_TIME_LIMIT_MS });
        const fallback = await tightener.tighten({ timeLimitMs: NO_TIME_MS });
        for (const name of DAMAGE_STAT_NAMES) assert.ok(tightened.has(name), `${label}: ${name} missing`);
        for (const [name, { lower, upper }] of tightened) {
            const loose = fallback.get(name);
            assert.ok(lower >= loose.lower && upper <= loose.upper, `${label} ${name}: looser than the fallback`);
        }
    }
});

test("stat bounds are integral and respect the query minimums", async () => {
    for (const { label, context } of listRandomCases()) {
        const tightener = new BoundTightener({ problem: toProblem(context) });
        const fallback = await tightener.tighten({ timeLimitMs: NO_TIME_MS });
        for (const [name, { lower, upper }] of fallback) {
            assert.ok(Number.isInteger(lower) && Number.isInteger(upper), `${label} ${name}: [${lower}, ${upper}]`);
        }
        const { minAp, minMp } = context.query;
        assert.ok(fallback.get(`st${CHARACTERISTIC.AP}`).lower >= minAp, `${label}: AP lower below minAp`);
        assert.ok(fallback.get(`st${CHARACTERISTIC.MP}`).lower >= minMp, `${label}: MP lower below minMp`);
    }
});

test("the LP relaxation of the tightened exact model still bounds the brute-force optimum", async () => {
    for (const { label, context } of listRandomCases()) {
        const [best] = bruteForce(context);
        if (!best) continue;
        const problem = toProblem(context);
        const statBounds = await new BoundTightener({ problem }).tighten({ timeLimitMs: LONG_TIME_LIMIT_MS });
        const model = new MilpModelBuilder({ ...problem, statBounds }).build();
        const relaxation = await solveRelaxation(model.relaxedLpText);
        assert.equal(relaxation.status, HighsSolver.STATUS.OPTIMAL, label);
        assert.ok(relaxation.objective >= best.score - TOLERANCE, `${label}: ${relaxation.objective} < ${best.score}`);
    }
});

test("an expired time limit falls back to the combinatorial bounds", async () => {
    const context = buildRandomCase(FIRST_SEED);
    const problem = toProblem(context);
    const fallback = await new BoundTightener({ problem }).tighten({ timeLimitMs: NO_TIME_MS });
    const structure = new MilpModelBuilder(problem).buildStructure();
    assert.deepEqual(
        [...fallback].map(([name, { lower, upper }]) => [name, lower, upper]),
        structure.stats.map(({ name, lower, upper }) => [name, lower, upper]),
    );
});

function toBoundEntries(bounds) {
    return [...bounds].map(([name, { lower, upper }]) => [name, lower, upper]);
}

async function tightenWithReplacedSolve(problem, replacement) {
    return withReplaced(HighsSolver.prototype, "solve", replacement, () =>
        new BoundTightener({ problem }).tighten({ timeLimitMs: LONG_TIME_LIMIT_MS }),
    );
}

test("an unexpected HiGHS failure during the LP stage keeps the combinatorial bounds", async () => {
    const problem = toProblem(buildRandomCase(FIRST_SEED));
    const fallback = await new BoundTightener({ problem }).tighten({ timeLimitMs: NO_TIME_MS });
    const failing = () =>
        function () {
            throw new Error("HiGHS stopped with unexpected model status 7");
        };
    const bounds = await withReplaced(
        console,
        "error",
        () => () => {},
        () => tightenWithReplacedSolve(problem, failing),
    );
    assert.deepEqual(toBoundEntries(bounds), toBoundEntries(fallback));
});

test("an LP optimum without a measurable dual infeasibility proves nothing", async () => {
    const problem = toProblem(buildRandomCase(FIRST_SEED));
    const fallback = await new BoundTightener({ problem }).tighten({ timeLimitMs: NO_TIME_MS });
    const descriptor = Object.getOwnPropertyDescriptor(HighsSolver.prototype, "dualInfeasibility");
    Object.defineProperty(HighsSolver.prototype, "dualInfeasibility", { get: () => NaN, configurable: true });
    try {
        const bounds = await new BoundTightener({ problem }).tighten({ timeLimitMs: LONG_TIME_LIMIT_MS });
        assert.deepEqual(toBoundEntries(bounds), toBoundEntries(fallback));
    } finally {
        Object.defineProperty(HighsSolver.prototype, "dualInfeasibility", descriptor);
    }
});
