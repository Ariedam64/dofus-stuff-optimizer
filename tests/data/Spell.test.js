const test = require("node:test");
const assert = require("node:assert/strict");
const Spell = require("../../src/data/Spell");
const spells = require("../fixtures/spells.json");
const spellLevels = require("../fixtures/spellLevels.json");

function buildSpell(spellId, levelId) {
    return Spell.fromDofusDb(
        spells.find((spell) => spell.id === spellId),
        spellLevels.find((level) => level.id === levelId),
    );
}

test("Spell keeps direct damage lines only", () => {
    const spell = buildSpell(1001, 2002);
    assert.deepEqual(spell.normalLines, [{ effectId: 96, min: 25, max: 28 }]);
    assert.deepEqual(spell.criticalLines, [{ effectId: 96, min: 30, max: 33 }]);
    assert.equal(spell.ignoredReason, null);
    assert.equal(spell.name, "Flèche Test");
    assert.equal(spell.minPlayerLevel, 132);
    assert.equal(spell.criticalRate, 25);
});

test("Spell with only conditional lines is flagged", () => {
    const spell = buildSpell(1003, 2005);
    assert.deepEqual(spell.normalLines, []);
    assert.equal(spell.ignoredReason, "no-direct-damage");
});

test("Spell mask with a leading lowercase token still counts when A is present", () => {
    const spell = buildSpell(1004, 2006);
    assert.deepEqual(spell.normalLines, [{ effectId: 100, min: 15, max: 15 }]);
});

test("Spell deduplicates identical damage lines in normal and critical lists", () => {
    const duplicate = { effectId: 99, diceNum: 14, diceSide: 17, triggers: "I", random: 0, duration: 0, delay: 0 };
    const spell = Spell.fromDofusDb(
        { id: 1, name: { fr: "Doublon" } },
        {
            apCost: 3,
            effects: [
                { ...duplicate, targetMask: "A" },
                { ...duplicate, targetMask: "a,A" },
            ],
            criticalEffect: [
                { ...duplicate, targetMask: "A" },
                { ...duplicate, targetMask: "A" },
            ],
        },
    );
    assert.deepEqual(spell.normalLines, [{ effectId: 99, min: 14, max: 17 }]);
    assert.deepEqual(spell.criticalLines, [{ effectId: 99, min: 14, max: 17 }]);
});

test("Spell reads minCastInterval and defaults to 0", () => {
    const raw = spellLevels.find((level) => level.id === 2002);
    const spellRaw = spells.find((spell) => spell.id === 1001);
    assert.equal(Spell.fromDofusDb(spellRaw, { ...raw, minCastInterval: 2 }).minCastInterval, 2);
    const { minCastInterval, ...withoutInterval } = raw;
    assert.equal(Spell.fromDofusDb(spellRaw, withoutInterval).minCastInterval, 0);
});

test("Spell exposes imgUrl from the raw img field, null when absent", () => {
    const level = spellLevels.find((candidate) => candidate.id === 2002);
    const raw = spells.find((spell) => spell.id === 1001);
    assert.equal(
        Spell.fromDofusDb({ ...raw, img: "https://example.test/spell.png" }, level).imgUrl,
        "https://example.test/spell.png",
    );
    assert.equal(Spell.fromDofusDb({ ...raw, img: undefined }, level).imgUrl, null);
});
