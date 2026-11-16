const test = require("node:test");
const assert = require("node:assert/strict");
const Item = require("../../src/data/Item");
const ItemSet = require("../../src/data/ItemSet");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const items = require("../fixtures/items.json");
const itemSets = require("../fixtures/itemSets.json");

function fixture(overrides) {
    return { ...items[1], ...overrides };
}

test("Item uses max roll and keeps negatives at worst", () => {
    const item = Item.fromDofusDb(
        fixture({
            effects: [
                { from: 301, to: 350, characteristic: 11, effectId: 125 },
                { from: -1, to: 0, characteristic: 19, effectId: 116 },
                { from: -10, to: -4, characteristic: 33, effectId: 210 },
            ],
        }),
    );
    assert.equal(item.stats.get(CHARACTERISTIC.VITALITY), 350);
    assert.equal(item.stats.get(CHARACTERISTIC.RANGE), -1);
    assert.equal(item.stats.get(CHARACTERISTIC.EARTH_RESISTANCE), -10);
});

test("Item maps basic fields, slot and set", () => {
    const item = Item.fromDofusDb(items[7]);
    assert.equal(item.name, "Chapeau du Set");
    assert.equal(item.slot, "hat");
    assert.equal(item.setId, 5);
    assert.equal(item.weapon, null);
    assert.equal(Item.fromDofusDb(items[2]).setId, null);
    assert.equal(Item.fromDofusDb(items[2]).criterion, "CL>99");
});

test("Item maps typeId to slot and parses weapon lines", () => {
    const item = Item.fromDofusDb(items[0]);
    assert.equal(item.slot, "weapon");
    assert.equal(item.weapon.apCost, 4);
    assert.equal(item.weapon.isTwoHanded, true);
    assert.equal(item.weapon.criticalRate, 30);
    assert.equal(item.weapon.criticalBonus, 5);
    assert.deepEqual(item.weapon.damageLines, [
        { effectId: 100, min: 24, max: 32 },
        { effectId: 96, min: 10, max: 12 },
    ]);
    assert.equal(item.stats.get(CHARACTERISTIC.STRENGTH), 60);
    assert.equal(item.stats.ids().length, 1);
});

test("ItemSet.bonusFor returns bonuses of that count", () => {
    const set = ItemSet.fromDofusDb(itemSets[0]);
    assert.deepEqual(set.itemIds, [101, 102]);
    assert.equal(set.bonusFor(1).get(CHARACTERISTIC.VITALITY), 10);
    assert.equal(set.bonusFor(2).get(CHARACTERISTIC.AP), 1);
    assert.equal(set.bonusFor(2).get(CHARACTERISTIC.EARTH_RESISTANCE), -5);
    assert.equal(set.bonusFor(5).ids().length, 0);
    assert.equal(set.bonusFor(0).ids().length, 0);
});

test("ItemSet marginals are the best and worst gain of one more worn item", () => {
    const { CHANCE, AP } = CHARACTERISTIC;
    const set = new ItemSet({
        id: 1,
        name: "set",
        itemIds: [1, 2, 3],
        bonusesByCount: [
            new Stats(),
            new Stats([[CHANCE, 30]]),
            new Stats([
                [CHANCE, 20],
                [AP, 1],
            ]),
        ],
    });
    assert.equal(set.maxMarginals.get(CHANCE), 30);
    assert.equal(set.minMarginals.get(CHANCE), -10);
    assert.equal(set.maxMarginals.get(AP), 1);
    assert.equal(set.minMarginals.get(AP), 0);
});

test("ItemSet marginals cover bonuses beyond the listed item count", () => {
    const set = new ItemSet({
        id: 1,
        name: "set",
        itemIds: [],
        bonusesByCount: [new Stats(), new Stats([[CHARACTERISTIC.CHANCE, 50]])],
    });
    assert.equal(set.maxMarginals.get(CHARACTERISTIC.CHANCE), 50);
});

function buildItem({ slot = "ring", typeId = 9, stats = [], weapon = null } = {}) {
    return new Item({
        id: 1,
        name: "x",
        typeId,
        slot,
        level: 1,
        setId: null,
        criterion: "",
        stats: new Stats(stats),
        weapon,
    });
}

test("Item tells whether it is two-handed or a prysmaradite", () => {
    assert.equal(buildItem({ slot: "weapon", weapon: { isTwoHanded: true } }).isTwoHanded, true);
    assert.equal(buildItem({ slot: "weapon", weapon: { isTwoHanded: false } }).isTwoHanded, false);
    assert.equal(buildItem().isTwoHanded, false);
    assert.equal(buildItem({ slot: "dofus", typeId: 217 }).isPrysmaradite, true);
    assert.equal(buildItem({ slot: "dofus", typeId: 23 }).isPrysmaradite, false);
});

test("only a ring without native AP or MP can take that exo", () => {
    const { AP, MP, CHANCE } = CHARACTERISTIC;
    const apRing = buildItem({ stats: [[AP, 1]] });
    assert.equal(apRing.canTakeExo(AP), false);
    assert.equal(apRing.canTakeExo(MP), true);
    assert.equal(buildItem({ stats: [[AP, -1]] }).canTakeExo(AP), true);
    assert.equal(buildItem().canTakeExo(CHANCE), false);
    assert.equal(buildItem({ slot: "hat", typeId: 16 }).canTakeExo(AP), false);
});

test("Item exposes imgUrl from the raw img field, null when absent", () => {
    assert.equal(
        Item.fromDofusDb(fixture({ img: "https://example.test/item.png" })).imgUrl,
        "https://example.test/item.png",
    );
    assert.equal(Item.fromDofusDb(fixture({ img: undefined })).imgUrl, null);
});
