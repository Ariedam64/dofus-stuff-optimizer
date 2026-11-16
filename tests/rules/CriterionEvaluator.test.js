const test = require("node:test");
const assert = require("node:assert/strict");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

const evaluator = new CriterionEvaluator();
const DEFAULT_LEVEL = 200;

function context(entries = [], level = DEFAULT_LEVEL) {
    return { stats: new Stats(entries), level };
}

test("empty criterion is met", () => {
    assert.deepEqual(evaluator.evaluate("", context()), { isMet: true, assumedAtoms: [] });
    assert.deepEqual(evaluator.evaluate("  ", context()), { isMet: true, assumedAtoms: [] });
});

test("CP<12 fails at 12 AP", () => {
    assert.equal(evaluator.evaluate("CP<12", context([[CHARACTERISTIC.AP, 12]])).isMet, false);
    assert.equal(evaluator.evaluate("CP<12", context([[CHARACTERISTIC.AP, 11]])).isMet, true);
});

test("CP<12|CM<6 passes when MP below 6", () => {
    const stats = [
        [CHARACTERISTIC.AP, 12],
        [CHARACTERISTIC.MP, 5],
    ];
    assert.equal(evaluator.evaluate("CP<12|CM<6", context(stats)).isMet, true);
});

test("CI>299&CC>199 needs both", () => {
    const stats = [
        [CHARACTERISTIC.INTELLIGENCE, 300],
        [CHARACTERISTIC.CHANCE, 199],
    ];
    assert.equal(evaluator.evaluate("CI>299&CC>199", context(stats)).isMet, false);
    stats[1][1] = 200;
    assert.equal(evaluator.evaluate("CI>299&CC>199", context(stats)).isMet, true);
});

test("parentheses group", () => {
    const stats = [
        [CHARACTERISTIC.AP, 12],
        [CHARACTERISTIC.MP, 5],
    ];
    assert.equal(evaluator.evaluate("(CP<12|CM<6)&PL>100", context(stats, 150)).isMet, true);
    assert.equal(evaluator.evaluate("(CP<12|CM<6)&PL>100", context(stats, 90)).isMet, false);
});

test("equality, inequality and approximate operators on stats", () => {
    const stats = [[CHARACTERISTIC.VITALITY, 100]];
    assert.equal(evaluator.evaluate("CV=100", context(stats)).isMet, true);
    assert.equal(evaluator.evaluate("CV~100", context(stats)).isMet, true);
    assert.equal(evaluator.evaluate("CV!100", context(stats)).isMet, false);
});

test("whitespace is tolerated", () => {
    const stats = [[CHARACTERISTIC.AP, 5]];
    assert.equal(evaluator.evaluate(" ( CP < 12 ) & PL > 100 ", context(stats)).isMet, true);
});

test("unknown code is assumed met and reported", () => {
    const result = evaluator.evaluate("PN~xxramboplxx&BI=1", context());
    assert.equal(result.isMet, true);
    assert.deepEqual(result.assumedAtoms, ["PN~xxramboplxx", "BI=1"]);
});

test("lowercase codes are assumed met", () => {
    const result = evaluator.evaluate("cv<100", context());
    assert.equal(result.isMet, true);
    assert.deepEqual(result.assumedAtoms, ["cv<100"]);
});

test("assumed atoms do not hide failing stat atoms", () => {
    const result = evaluator.evaluate("BI=1&CP<2", context([[CHARACTERISTIC.AP, 5]]));
    assert.equal(result.isMet, false);
    assert.deepEqual(result.assumedAtoms, ["BI=1"]);
});

test("malformed criterion throws with its text", () => {
    for (const criterion of ["(CP<12", "CP<12)", "CP<", "CP12", "CP<12&", "CP<abc"]) {
        assert.throws(
            () => evaluator.evaluate(criterion, context()),
            (error) => error.message.includes(`"${criterion}"`),
        );
    }
});

test("PG compares against the breed id", () => {
    assert.deepEqual(evaluator.evaluate("PG=9", { ...context(), breedId: 9 }), { isMet: true, assumedAtoms: [] });
    assert.equal(evaluator.evaluate("PG=9", { ...context(), breedId: 8 }).isMet, false);
    assert.equal(evaluator.evaluate("PG!9", { ...context(), breedId: 8 }).isMet, true);
});

test("PG is assumed met without a breed id", () => {
    assert.deepEqual(evaluator.evaluate("PG=9", context()), { isMet: true, assumedAtoms: ["PG=9"] });
});

test("pk compares against the set bonus level", () => {
    assert.deepEqual(evaluator.evaluate("pk<2", { ...context(), setBonusLevel: 1 }), { isMet: true, assumedAtoms: [] });
    assert.equal(evaluator.evaluate("pk<2", { ...context(), setBonusLevel: 2 }).isMet, false);
    assert.equal(evaluator.evaluate("pk<2", { ...context(), setBonusLevel: 0 }).isMet, true);
});

test("pk is assumed met without a set bonus level", () => {
    assert.deepEqual(evaluator.evaluate("pk<2", context()), { isMet: true, assumedAtoms: ["pk<2"] });
});
