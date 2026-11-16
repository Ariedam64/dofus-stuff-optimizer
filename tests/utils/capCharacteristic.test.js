const test = require("node:test");
const assert = require("node:assert/strict");
const capCharacteristic = require("../../src/utils/capCharacteristic");
const { MAX_AP, MAX_MP, MAX_RANGE } = require("../../src/config");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

const { AP, MP, RANGE, CHANCE } = CHARACTERISTIC;

test("the game caps 12 AP, 6 MP and 9 range", () => {
    assert.deepEqual([MAX_AP, MAX_MP, MAX_RANGE], [12, 6, 9]);
});

test("AP, MP and range are capped, other characteristics are not", () => {
    assert.equal(capCharacteristic(AP, 15), 12);
    assert.equal(capCharacteristic(MP, 8), 6);
    assert.equal(capCharacteristic(RANGE, 11), 9);
    assert.equal(capCharacteristic(CHANCE, 900), 900);
});

test("values under the cap, negative ones included, are kept", () => {
    assert.equal(capCharacteristic(AP, 11), 11);
    assert.equal(capCharacteristic(MP, 6), 6);
    assert.equal(capCharacteristic(RANGE, -2), -2);
});
