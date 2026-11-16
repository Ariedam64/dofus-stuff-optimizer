const test = require("node:test");
const assert = require("node:assert/strict");
const StuffSolver = require("../../src/solver/StuffSolver");
const { SLOT } = require("../../src/data/slots");
const { buildRandomCase } = require("./randomCases");
const { bruteForce, collect } = require("./solverFixture");

const RANDOM_CASE_COUNT = 12;
const FIRST_SEED = 1000;
const LONG_DEADLINE_MS = 120000;
const SCORE_TOLERANCE = 1e-6;

function wearsWeapon(items) {
    return items.some((item) => item.slot === SLOT.WEAPON);
}

function requireWeapon(context) {
    return { ...context, query: context.query.withRequiredWeapon() };
}

async function solve(context) {
    const solver = new StuffSolver(context);
    const yields = await collect(solver.solveDiverse({ deadlineMs: Date.now() + LONG_DEADLINE_MS }));
    return { yields, endReason: solver.endReason };
}

test("a required weapon gives the brute-force optimum among the stuffs wearing a weapon", async () => {
    for (let index = 0; index < RANDOM_CASE_COUNT; index++) {
        const seed = FIRST_SEED + index;
        const context = requireWeapon(buildRandomCase(seed));
        const best = bruteForce(context).find((evaluation) => wearsWeapon(evaluation.items));
        const { yields } = await solve(context);
        if (!best) {
            assert.equal(yields.length, 0, `seed ${seed}: no valid stuff with a weapon expected`);
            continue;
        }
        const [first] = yields;
        assert.ok(wearsWeapon(first.evaluation.items), `seed ${seed}: the stuff has no weapon`);
        const scoreGap = Math.abs(first.evaluation.score - best.score);
        assert.ok(scoreGap <= SCORE_TOLERANCE * Math.max(1, best.score), `seed ${seed}: ${first.evaluation.score}`);
        assert.equal(first.solverStatus, "optimal", `seed ${seed}`);
    }
});

test("a required weapon without any weapon candidate is proven infeasible", async () => {
    const context = requireWeapon(buildRandomCase(FIRST_SEED));
    context.candidates = new Map(context.candidates).set(SLOT.WEAPON, []);
    const { yields, endReason } = await solve(context);
    assert.deepEqual(yields, []);
    assert.equal(endReason, StuffSolver.END_REASON.INFEASIBLE);
});

test("the query copy keeps every other field", () => {
    const { query } = buildRandomCase(FIRST_SEED);
    const copy = query.withRequiredWeapon();
    assert.equal(query.isWeaponRequired, false);
    assert.equal(copy.isWeaponRequired, true);
    assert.deepEqual({ ...copy, isWeaponRequired: false }, { ...query });
    assert.ok(copy.allowsExo("ap") === query.allowsExo("ap"));
});
