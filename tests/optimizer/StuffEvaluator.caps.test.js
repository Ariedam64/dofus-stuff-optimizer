const test = require("node:test");
const assert = require("node:assert/strict");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { MAX_AP, MAX_MP } = require("../../src/config");
const { DAMAGE_PER_CAST, buildItem, buildEvaluator } = require("./stuffEvaluatorFixture");

const { AP, MP } = CHARACTERISTIC;
const PERCENT_BASE = 100;
// Level 200 with scrolls: 398 Chance from 995 points plus 100 from the scroll.
const CHANCE_FROM_POINTS_AND_SCROLLS = 498;
const POINTS_DAMAGE_MULTIPLIER = (PERCENT_BASE + CHANCE_FROM_POINTS_AND_SCROLLS) / PERCENT_BASE;
const RAW_AP = 15;
// The bare character has 7 AP and 3 MP at level 200.
const AP_HAT_BONUS = RAW_AP - 7;
const MP_HAT_BONUS = 5;

function buildApHat(criterion = "") {
    return buildItem({
        stats: [
            [AP, AP_HAT_BONUS],
            [MP, MP_HAT_BONUS],
        ],
        criterion,
    });
}

function countSpentAp(turn) {
    return turn.casts.reduce((total, cast) => total + cast.count, 0);
}

test("a stuff with 15 raw AP plans its turn with 12 AP", () => {
    const evaluation = buildEvaluator({ allowRingExos: false }).evaluate([buildApHat()]);
    assert.equal(countSpentAp(evaluation.turn), MAX_AP);
    assert.equal(evaluation.score, MAX_AP * DAMAGE_PER_CAST * POINTS_DAMAGE_MULTIPLIER);
});

test("item criteria read the raw AP total, above the cap", () => {
    const evaluator = buildEvaluator({ allowRingExos: false });
    assert.notEqual(evaluator.evaluate([buildApHat("CP>13")]), null);
    assert.equal(evaluator.evaluate([buildApHat("CP<13")]), null);
    assert.equal(evaluator.evaluate([buildApHat()]).stats.get(AP), RAW_AP);
});

test("minAp and minMp at the cap are met by raw totals above it", () => {
    const evaluator = buildEvaluator({ allowRingExos: false, constraints: { minAp: MAX_AP, minMp: MAX_MP } });
    assert.notEqual(evaluator.evaluate([buildApHat()]), null);
    assert.equal(
        evaluator.meetsConstraints(
            new Stats([
                [AP, RAW_AP],
                [MP, MAX_MP + 2],
            ]),
        ),
        true,
    );
});

test("computeUpperBound plans with at most 12 AP", () => {
    const evaluator = buildEvaluator();
    const groups = evaluator.buildActionGroups(null);
    assert.equal(evaluator.computeUpperBound(new Stats([[AP, RAW_AP]]), groups), MAX_AP * DAMAGE_PER_CAST);
});
