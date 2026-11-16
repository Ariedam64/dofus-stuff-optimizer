const test = require("node:test");
const assert = require("node:assert/strict");
const Query = require("../../src/optimizer/Query");
const StuffEvaluator = require("../../src/optimizer/StuffEvaluator");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const DamageCalculator = require("../../src/damage/DamageCalculator");
const TurnPlanner = require("../../src/damage/TurnPlanner");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { CRA, buildSpell, buildItem, buildEvaluator } = require("./stuffEvaluatorFixture");

const { STRENGTH, INTELLIGENCE, CHANCE, AGILITY, VITALITY, WISDOM } = CHARACTERISTIC;
const WATER_EFFECT_ID = 96;
const LOW_LEVEL = 50;

function buildCriterionWeapon(criterion) {
    return buildItem({
        slot: "weapon",
        criterion,
        weapon: {
            apCost: 4,
            minRange: 1,
            range: 1,
            criticalRate: 0,
            criticalBonus: 0,
            maxCastPerTurn: 1,
            isTwoHanded: false,
            damageLines: [{ effectId: WATER_EFFECT_ID, min: 20, max: 20 }],
        },
    });
}

function buildEvaluatorWithoutScrolls() {
    const query = Query.parse(
        { breed: "cra", level: 200, profile: { elements: ["water"] }, useScrolls: false },
        { findBreed: () => CRA },
    );
    return new StuffEvaluator({
        query,
        gameData: { getSpellGroups: () => [[buildSpell()]], getSet: () => undefined },
        criterionEvaluator: new CriterionEvaluator(),
        turnPlanner: new TurnPlanner(new DamageCalculator("water")),
    });
}

test("points and scrolls raise the element characteristic", () => {
    const evaluation = buildEvaluator({ level: 200 }).evaluate([]);
    assert.equal(evaluation.stats.get(CHANCE), 498);
    assert.equal(evaluation.pointsAllocation.spentPoints[CHANCE], 992);
    assert.equal(evaluation.pointsAllocation.baseStats.get(CHANCE), 398);
    assert.equal(evaluation.pointsAllocation.scrollStats.get(CHANCE), 100);
    assert.equal(evaluation.stats.get(VITALITY), 100);
});

test("points raise the score", () => {
    const withScrolls = buildEvaluator({ level: 200 }).evaluate([]);
    const withoutScrolls = buildEvaluatorWithoutScrolls().evaluate([]);
    assert.equal(withoutScrolls.stats.get(CHANCE), 398);
    assert.equal(withoutScrolls.pointsAllocation.scrollStats.get(WISDOM), 0);
    assert.ok(withScrolls.score > withoutScrolls.score);
});

test("a weapon needing Chance above 399 is valid at level 200 but not at level 50", () => {
    const weapon = buildCriterionWeapon("CC>399");
    assert.notEqual(buildEvaluator({ level: 200 }).evaluate([weapon]), null);
    assert.equal(buildEvaluator({ level: LOW_LEVEL }).evaluate([weapon]), null);
    assert.equal(buildEvaluator({ level: 200 }).measureViolation([weapon]), 0);
    assert.equal(buildEvaluator({ level: LOW_LEVEL }).measureViolation([weapon]), 1);
});

test("points needed by a criterion on another characteristic are taken from the element", () => {
    const evaluation = buildEvaluator({ level: 200 }).evaluate([buildItem({ criterion: "CA>249" })]);
    assert.equal(evaluation.stats.get(AGILITY), 250);
    assert.equal(evaluation.pointsAllocation.spentPoints[AGILITY], 200);
    assert.equal(evaluation.stats.get(CHANCE), 448);
    assert.equal(evaluation.stats.get(STRENGTH), 100);
});

test("criteria that cannot be met together count one violation per blocked criterion", () => {
    const evaluator = buildEvaluator({ level: 100 });
    const items = [buildItem({ criterion: "CI>299" }), buildItem({ slot: "cape", criterion: "CA>299" })];
    assert.equal(evaluator.evaluate(items), null);
    assert.equal(evaluator.measureViolation(items), 1);
    assert.notEqual(evaluator.evaluate(items.slice(0, 1)), null);
    assert.equal(evaluator.measureViolation(items.slice(0, 1)), 0);
});

test("optimisticPointStats holds the most points reachable on the element plus scrolls", () => {
    const stats = buildEvaluator({ level: 200 }).optimisticPointStats;
    assert.equal(stats.get(CHANCE), 498);
    assert.equal(stats.get(INTELLIGENCE), 100);
    assert.equal(buildEvaluatorWithoutScrolls().optimisticPointStats.get(INTELLIGENCE), 0);
});
