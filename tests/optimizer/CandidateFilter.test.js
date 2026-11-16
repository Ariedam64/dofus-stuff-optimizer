const test = require("node:test");
const assert = require("node:assert/strict");
const CandidateFilter = require("../../src/optimizer/CandidateFilter");
const { SLOT_CAPACITIES } = require("../../src/data/slots");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const {
    CHARACTER_LEVEL,
    SET_ID,
    buildQuery,
    buildItem,
    buildWeapon,
    buildGameData,
    candidateIds,
} = require("./candidateFilterFixture");

const { CHANCE, POWER, AP, MP, VITALITY } = CHARACTERISTIC;

test("drops item above character level", () => {
    const tooHigh = buildItem({ level: CHARACTER_LEVEL + 1, stats: { [CHANCE]: 10 } });
    const fine = buildItem({ level: CHARACTER_LEVEL, stats: { [CHANCE]: 10 } });
    assert.deepEqual(candidateIds(buildQuery(), [tooHigh, fine], "hat"), [fine.id]);
});

test("drops excluded items", () => {
    const excluded = buildItem({ stats: { [CHANCE]: 10 } });
    const query = buildQuery({ excludedItemIds: new Set([excluded.id]) });
    assert.deepEqual(candidateIds(query, [excluded], "hat"), []);
});

test("drops item dominated by a single item in a capacity-1 slot", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    assert.deepEqual(candidateIds(buildQuery(), [weak, strong], "hat"), [strong.id]);
});

test("keeps item that is better on one characteristic", () => {
    const first = buildItem({ stats: { [CHANCE]: 10, [POWER]: 5 } });
    const second = buildItem({ stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [first, second], "hat").length, 2);
});

test("ignores irrelevant characteristics", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10, [VITALITY]: 500 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    assert.deepEqual(candidateIds(buildQuery(), [weak, strong], "hat"), [strong.id]);
});

test("equal items do not dominate each other", () => {
    const first = buildItem({ stats: { [CHANCE]: 10 } });
    const second = buildItem({ stats: { [CHANCE]: 10 } });
    assert.equal(candidateIds(buildQuery(), [first, second], "hat").length, 2);
});

test("drops ring only when dominated by two rings", () => {
    const weak = buildItem({ slot: "ring", stats: { [CHANCE]: 10 } });
    const strongOne = buildItem({ slot: "ring", stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [weak, strongOne], "ring").length, 2);
    const strongTwo = buildItem({ slot: "ring", stats: { [CHANCE]: 30 } });
    assert.equal(candidateIds(buildQuery(), [weak, strongOne, strongTwo], "ring").includes(weak.id), false);
});

test("AP mismatch blocks dominance", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const strongWithAp = buildItem({ stats: { [CHANCE]: 20, [AP]: 1 } });
    assert.equal(candidateIds(buildQuery(), [weak, strongWithAp], "hat").length, 2);
});

test("MP mismatch blocks dominance", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10, [MP]: 1 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [weak, strong], "hat").length, 2);
});

test("set item is dominated when the dominator covers its max marginal bonus", () => {
    const gameData = buildGameData([{}, { [CHANCE]: 5 }, { [CHANCE]: 12 }]);
    const setItem = buildItem({ setId: SET_ID, stats: { [CHANCE]: 10 } });
    const strong = buildItem({ stats: { [CHANCE]: 30 } });
    assert.deepEqual(candidateIds(buildQuery(), [setItem, strong], "hat", gameData), [strong.id]);
});

test("set item is kept when its set bonus could exceed the gap", () => {
    const gameData = buildGameData([{}, { [CHANCE]: 15 }]);
    const setItem = buildItem({ setId: SET_ID, stats: { [CHANCE]: 10 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [setItem, strong], "hat", gameData).length, 2);
});

test("a dominator in a set with a negative marginal is penalised", () => {
    const gameData = buildGameData([{}, { [CHANCE]: -8 }]);
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const setDominator = buildItem({ setId: SET_ID, stats: { [CHANCE]: 15 } });
    assert.equal(candidateIds(buildQuery(), [weak, setDominator], "hat", gameData).length, 2);
});

test("throws when an item references a missing set", () => {
    const orphan = buildItem({ setId: 999, stats: { [CHANCE]: 10 } });
    assert.throws(() => candidateIds(buildQuery(), [orphan], "hat"), /missing set 999/);
});

test("keeps required item", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    const query = buildQuery({ requiredItemIds: new Set([weak.id]) });
    assert.equal(candidateIds(query, [weak, strong], "hat").length, 2);
});

test("keeps required item above character level", () => {
    const required = buildItem({ level: CHARACTER_LEVEL + 10, stats: { [CHANCE]: 10 } });
    const query = buildQuery({ requiredItemIds: new Set([required.id]) });
    assert.deepEqual(candidateIds(query, [required], "hat"), [required.id]);
});

test("keeps weapons that have an element damage action", () => {
    const weak = buildItem({ slot: "weapon", weapon: buildWeapon(), stats: { [CHANCE]: 10 } });
    const strong = buildItem({ slot: "weapon", weapon: buildWeapon(), stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [weak, strong], "weapon").length, 2);
});

test("prunes weapons without element damage lines", () => {
    const noLines = buildWeapon({ hasElementLines: false });
    const weak = buildItem({ slot: "weapon", weapon: noLines, stats: { [CHANCE]: 10 } });
    const strong = buildItem({ slot: "weapon", weapon: noLines, stats: { [CHANCE]: 20 } });
    assert.deepEqual(candidateIds(buildQuery(), [weak, strong], "weapon"), [strong.id]);
});

test("two-handed weapon cannot dominate a one-handed weapon", () => {
    const oneHanded = buildItem({
        slot: "weapon",
        weapon: buildWeapon({ hasElementLines: false }),
        stats: { [CHANCE]: 10 },
    });
    const twoHanded = buildItem({
        slot: "weapon",
        weapon: buildWeapon({ hasElementLines: false, isTwoHanded: true }),
        stats: { [CHANCE]: 20 },
    });
    assert.equal(candidateIds(buildQuery(), [oneHanded, twoHanded], "weapon").length, 2);
});

test("returns every slot key and drops unknown slots", () => {
    const unknown = buildItem({ slot: "unknownSlot" });
    const candidates = new CandidateFilter(buildQuery(), buildGameData()).buildCandidates([unknown]);
    assert.deepEqual([...candidates.keys()].sort(), Object.keys(SLOT_CAPACITIES).sort());
    assert.deepEqual(candidates.get("hat"), []);
});

test("sorts candidates by relevant stat sum descending", () => {
    const low = buildItem({ stats: { [CHANCE]: 5, [POWER]: 20 } });
    const high = buildItem({ stats: { [CHANCE]: 30 } });
    const mid = buildItem({ stats: { [POWER]: 40 } });
    assert.deepEqual(candidateIds(buildQuery(), [low, high, mid], "hat"), [mid.id, high.id, low.id]);
});

test("relevant characteristics include element, AP, MP and constrained resistances", () => {
    const query = buildQuery({ minResistances: { fire: 10 } });
    const relevant = new CandidateFilter(query, buildGameData()).relevantCharacteristics();
    for (const id of [CHANCE, POWER, AP, MP, CHARACTERISTIC.FIRE_RESISTANCE, CHARACTERISTIC.WATER_DAMAGE]) {
        assert.ok(relevant.includes(id), `missing ${id}`);
    }
    assert.equal(relevant.includes(VITALITY), false);
});
