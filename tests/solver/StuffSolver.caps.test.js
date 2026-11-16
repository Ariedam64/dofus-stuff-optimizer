const test = require("node:test");
const assert = require("node:assert/strict");
const StuffSolver = require("../../src/solver/StuffSolver");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SLOT } = require("../../src/data/slots");
const { MAX_AP } = require("../../src/config");
const { buildRandomCase } = require("./randomCases");
const { buildSpell, buildItem, buildContext, bruteForce, collect } = require("./solverFixture");

const LONG_DEADLINE_MS = 120000;
const SCORE_TOLERANCE = 1e-6;
// Seeds whose valid stuffs include raw AP totals above the cap once AP and MP item stats are scaled up.
const HIGH_AP_SEEDS = [3001, 3002, 3007, 3009, 3010, 3011, 3014, 3015];
const HIGH_AP_SCALE = 6;
// The bare character has 7 AP at level 200: this amulet reaches the 12 AP cap on its own.
const CAP_AMULET_AP = MAX_AP - 7;
const EXTRA_AP = 1;
const HAT_CHANCE = 20;

function solveWithLongDeadline(context) {
    return collect(new StuffSolver(context).solveDiverse({ deadlineMs: Date.now() + LONG_DEADLINE_MS }));
}

function assertSameScore(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) <= SCORE_TOLERANCE * Math.max(1, Math.abs(expected)), message);
}

test("first yield matches the brute-force optimum when raw AP can pass the cap", async () => {
    for (const seed of HIGH_AP_SEEDS) {
        const context = buildRandomCase(seed, { apScale: HIGH_AP_SCALE });
        const evaluations = bruteForce(context);
        const isAboveCap = (evaluation) => evaluation.stats.get(CHARACTERISTIC.AP) > MAX_AP;
        assert.ok(evaluations.some(isAboveCap), `seed ${seed}: no valid stuff passes the AP cap`);
        const [first] = await solveWithLongDeadline(context);
        const message = `seed ${seed}: ${first.evaluation.score} vs ${evaluations[0].score}`;
        assertSameScore(first.evaluation.score, evaluations[0].score, message);
        assert.equal(first.solverStatus, "optimal", `seed ${seed}`);
    }
});

function buildCapItems() {
    return {
        amulet: buildItem({ slot: SLOT.AMULET, stats: [[CHARACTERISTIC.AP, CAP_AMULET_AP]] }),
        apHat: buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.AP, EXTRA_AP]] }),
        chanceHat: buildItem({ slot: SLOT.HAT, stats: [[CHARACTERISTIC.CHANCE, HAT_CHANCE]] }),
    };
}

function buildCapContext(items, constraints = {}) {
    const spellGroups = [[buildSpell({ name: "Bolt", apCost: 1, damage: 10 })]];
    return buildContext({ items: Object.values(items), spellGroups, allowRingExos: false, constraints });
}

test("an AP item above the cap loses to a damage item it would beat without the cap", async () => {
    const { amulet, apHat, chanceHat } = buildCapItems();
    const context = buildCapContext({ amulet, apHat, chanceHat });
    const apStuff = context.evaluator.evaluate([amulet, apHat]);
    const [best] = bruteForce(context);
    const [castOfApStuff] = apStuff.turn.casts;
    assert.equal(castOfApStuff.count, MAX_AP);
    assert.ok((MAX_AP + EXTRA_AP) * castOfApStuff.damagePerCast > best.score, "the fixture needs the cap to matter");
    assert.deepEqual(best.items, [amulet, chanceHat]);
    const [first] = await solveWithLongDeadline(context);
    assert.deepEqual(first.evaluation.items, [amulet, chanceHat]);
    assertSameScore(first.evaluation.score, best.score, "capped optimum");
    assert.equal(first.solverStatus, "optimal");
});

test("a stuff forced above the cap is scored with 12 AP and proven, with minAp at the cap", async () => {
    const items = buildCapItems();
    const { amulet, apHat } = items;
    const context = buildCapContext(items, { minAp: MAX_AP, requiredItemIds: [amulet.id, apHat.id] });
    const expected = context.evaluator.evaluate([amulet, apHat]);
    assert.ok(expected.stats.get(CHARACTERISTIC.AP) > MAX_AP);
    const [first] = await solveWithLongDeadline(context);
    assert.deepEqual(first.evaluation.items, [amulet, apHat]);
    assertSameScore(first.evaluation.score, expected.score, "forced stuff");
    assert.equal(first.solverStatus, "optimal");
});
