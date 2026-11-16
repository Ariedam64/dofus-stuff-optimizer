const test = require("node:test");
const assert = require("node:assert/strict");
const Action = require("../../src/damage/Action");
const TurnPlanner = require("../../src/damage/TurnPlanner");
const { MAX_AP } = require("../../src/config");

const DAMAGE_BY_NAME = { A: 100, B: 150, C: 100 };
const STATS = {};

function buildAction(name, apCost, maxCasts, kind = "spell") {
    return new Action({
        name,
        kind,
        apCost,
        maxCasts,
        isMelee: false,
        criticalRate: 0,
        normalLines: [],
        criticalLines: [],
    });
}

const planner = new TurnPlanner({ computeExpectedDamage: (action) => DAMAGE_BY_NAME[action.name] });

test("fills AP with best combo", () => {
    const result = planner.planTurn([[buildAction("A", 3, 2)], [buildAction("B", 4, 1)]], 10, STATS);
    assert.equal(result.totalDamage, 350);
    assert.deepEqual(result.casts.map((cast) => [cast.name, cast.count, cast.damagePerCast]).sort(), [
        ["A", 2, 100],
        ["B", 1, 150],
    ]);
});

test("only one spell per variant pair", () => {
    const result = planner.planTurn([[buildAction("A", 3, 2), buildAction("B", 4, 1)]], 10, STATS);
    assert.equal(result.totalDamage, 200);
    assert.equal(result.casts.length, 1);
    assert.equal(result.casts[0].name, "A");
});

test("respects maxCasts", () => {
    assert.equal(planner.planTurn([[buildAction("A", 3, 1)]], 9, STATS).totalDamage, 100);
});

test("returns zero when no AP", () => {
    const result = planner.planTurn([[buildAction("A", 3, 2)]], 0, STATS);
    assert.equal(result.totalDamage, 0);
    assert.deepEqual(result.casts, []);
});

test("handles negative and fractional AP", () => {
    assert.equal(planner.planTurn([[buildAction("A", 3, 5)]], -2, STATS).totalDamage, 0);
    assert.equal(planner.planTurn([[buildAction("A", 3, 5)]], 6.9, STATS).totalDamage, 200);
});

test("ignores actions with no AP cost and supports unlimited casts", () => {
    const result = planner.planTurn([[buildAction("A", 0, 1)], [buildAction("C", 2, Infinity)]], 7, STATS);
    assert.equal(result.totalDamage, 300);
});

test("prefers fewer AP on equal damage", () => {
    const result = planner.planTurn([[buildAction("A", 3, 1), buildAction("C", 2, 1)]], 5, STATS);
    assert.equal(result.casts[0].name, "C");
});

test("optimistic mode plans with the optimistic damage", () => {
    const optimisticPlanner = new TurnPlanner({
        computeExpectedDamage: () => 10,
        computeOptimisticDamage: () => 25,
    });
    const groups = [[buildAction("A", 3, 1)]];
    assert.equal(optimisticPlanner.planTurn(groups, 3, STATS).totalDamage, 10);
    assert.equal(optimisticPlanner.planTurn(groups, 3, STATS, { isOptimistic: true }).totalDamage, 25);
});

test("plans the turn with at most the game's AP cap", () => {
    const result = planner.planTurn([[buildAction("A", 1, Infinity)]], 15, STATS);
    assert.equal(result.totalDamage, MAX_AP * DAMAGE_BY_NAME.A);
    assert.deepEqual(
        result.casts.map((cast) => [cast.name, cast.count]),
        [["A", MAX_AP]],
    );
});
