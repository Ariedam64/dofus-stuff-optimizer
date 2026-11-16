const test = require("node:test");
const assert = require("node:assert/strict");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

test("Stats.get returns 0 for missing characteristic", () => {
    assert.equal(new Stats().get(CHARACTERISTIC.AP), 0);
});

test("Stats.addAll sums per characteristic", () => {
    const stats = new Stats([[CHARACTERISTIC.AP, 1]]);
    stats.addAll(
        new Stats([
            [CHARACTERISTIC.AP, 2],
            [CHARACTERISTIC.CHANCE, 50],
        ]),
    );
    assert.equal(stats.get(CHARACTERISTIC.AP), 3);
    assert.equal(stats.get(CHARACTERISTIC.CHANCE), 50);
});

test("Stats.clone is independent", () => {
    const original = new Stats([[CHARACTERISTIC.AP, 1]]);
    const copy = original.clone();
    copy.add(CHARACTERISTIC.AP, 5);
    assert.equal(original.get(CHARACTERISTIC.AP), 1);
    assert.equal(copy.get(CHARACTERISTIC.AP), 6);
});

test("Stats.ids lists present characteristics", () => {
    const stats = new Stats([
        [CHARACTERISTIC.AP, 1],
        [CHARACTERISTIC.MP, 1],
    ]);
    assert.deepEqual(
        stats.ids().sort((a, b) => a - b),
        [CHARACTERISTIC.AP, CHARACTERISTIC.MP],
    );
});

test("Stats.toNamedObject uses camelCase names", () => {
    assert.deepEqual(new Stats([[CHARACTERISTIC.WATER_DAMAGE, 20]]).toNamedObject(), { waterDamage: 20 });
});

test("Stats.toNamedObject names unknown ids c<id>", () => {
    assert.deepEqual(new Stats([[9999, 3]]).toNamedObject(), { c9999: 3 });
});

test("Stats.fromDofusDbEffects skips characteristic 0 and negative ids", () => {
    const stats = Stats.fromDofusDbEffects([
        { characteristic: 0, from: 5001, to: 0 },
        { characteristic: -1, from: 3, to: 0 },
        { characteristic: CHARACTERISTIC.CHANCE, from: 10, to: 20 },
    ]);
    assert.deepEqual(stats.toNamedObject(), { chance: 20 });
});
