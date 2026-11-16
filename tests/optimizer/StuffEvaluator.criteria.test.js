const test = require("node:test");
const assert = require("node:assert/strict");
const ItemSet = require("../../src/data/ItemSet");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { CRA, buildItem, buildRing, buildEvaluator } = require("./stuffEvaluatorFixture");

const { AP, CRITICAL, FIRE_RESISTANCE } = CHARACTERISTIC;
const SET_ID = 60;
const OTHER_SET_ID = 61;
const OTHER_BREED_ID = 6;
const LOW_LEVEL = 5;

function buildSet(id) {
    return new ItemSet({ id, name: `Set ${id}`, itemIds: [], bonusesByCount: [] });
}

function buildTrophy() {
    return buildItem({ slot: "dofus", criterion: "pk<2" });
}

function buildSetItems(setId, slots) {
    return slots.map((slot) => buildItem({ slot, setId }));
}

test("criterion is checked with exos applied", () => {
    const hat = buildItem({ criterion: "CP<8" });
    const ring = buildRing();
    const evaluation = buildEvaluator().evaluate([hat, ring]);
    assert.deepEqual(evaluation.exos, []);
    assert.equal(evaluation.stats.get(AP), 7);
    assert.equal(buildEvaluator({ constraints: { minAp: 8 } }).evaluate([hat, ring]), null);
});

test("criterion can be met thanks to an exo", () => {
    const hat = buildItem({ criterion: "CM>3" });
    const ring = buildRing();
    assert.equal(buildEvaluator({ allowRingExos: false }).evaluate([hat, ring]), null);
    const evaluation = buildEvaluator().evaluate([hat, ring]);
    assert.deepEqual(evaluation.exos, [{ itemId: ring.id, characteristic: "mp" }]);
});

test("assumed criteria are reported", () => {
    const hat = buildItem({ criterion: "BI=1" });
    const evaluation = buildEvaluator().evaluate([hat, buildItem({ criterion: "CP>1" })]);
    assert.deepEqual(evaluation.assumedCriteria, [{ itemId: hat.id, atoms: ["BI=1"] }]);
});

test("measureViolation is zero for a valid stuff", () => {
    const evaluator = buildEvaluator({ constraints: { minAp: 8 } });
    assert.equal(evaluator.measureViolation([buildRing()]), 0);
});

test("measureViolation sums shortfalls with the best exos", () => {
    const evaluator = buildEvaluator({ constraints: { minAp: 10, minMp: 5, minResistances: { fire: 30 } } });
    const items = [buildRing(), buildItem({ stats: [[FIRE_RESISTANCE, 20]] })];
    // One ring exo: AP shortfall 2 + MP 2 or AP 3 + MP 1, plus fire 10.
    assert.equal(evaluator.measureViolation(items), 14);
});

test("measureViolation counts unmet criteria and critical shortfall", () => {
    const evaluator = buildEvaluator({ allowRingExos: false, minCriticalRate: 50 });
    const items = [buildItem({ criterion: "CP>8" }), buildItem({ slot: "boots", stats: [[CRITICAL, 20]] })];
    assert.equal(evaluator.measureViolation(items), 31);
});

test("PG is checked against the query breed", () => {
    const evaluator = buildEvaluator();
    assert.equal(evaluator.evaluate([buildItem({ criterion: `PG=${OTHER_BREED_ID}` })]), null);
    const evaluation = evaluator.evaluate([buildItem({ criterion: `PG=${CRA.id}` })]);
    assert.deepEqual(evaluation.assumedCriteria, []);
});

test("PL is checked against the query level", () => {
    const lowLevelOnly = buildItem({ criterion: "PL<6" });
    assert.equal(buildEvaluator({ level: 200 }).evaluate([lowLevelOnly]), null);
    assert.notEqual(buildEvaluator({ level: LOW_LEVEL }).evaluate([lowLevelOnly]), null);
});

test("pk trophy accepts at most two items of one set", () => {
    const evaluator = buildEvaluator({ sets: [buildSet(SET_ID)] });
    const twoSetItems = buildSetItems(SET_ID, ["hat", "cape"]);
    const threeSetItems = buildSetItems(SET_ID, ["hat", "cape", "boots"]);
    const accepted = evaluator.evaluate([buildTrophy(), ...twoSetItems]);
    assert.notEqual(accepted, null);
    assert.deepEqual(accepted.assumedCriteria, []);
    assert.equal(evaluator.evaluate([buildTrophy(), ...threeSetItems]), null);
    assert.notEqual(evaluator.evaluate(threeSetItems), null);
});

test("pk looks at the most worn set only", () => {
    const evaluator = buildEvaluator({ sets: [buildSet(SET_ID), buildSet(OTHER_SET_ID)] });
    const items = [...buildSetItems(SET_ID, ["hat", "cape"]), ...buildSetItems(OTHER_SET_ID, ["boots", "belt"])];
    assert.notEqual(evaluator.evaluate([buildTrophy(), ...items]), null);
});

test("several pk trophies can be worn together", () => {
    const evaluation = buildEvaluator().evaluate([buildTrophy(), buildTrophy(), buildTrophy()]);
    assert.notEqual(evaluation, null);
    assert.equal(evaluation.items.length, 3);
});

test("measureViolation counts a pk trophy worn with three items of one set", () => {
    const evaluator = buildEvaluator({ sets: [buildSet(SET_ID)] });
    const items = [buildTrophy(), ...buildSetItems(SET_ID, ["hat", "cape", "boots"])];
    assert.equal(evaluator.measureViolation(items), 1);
});
