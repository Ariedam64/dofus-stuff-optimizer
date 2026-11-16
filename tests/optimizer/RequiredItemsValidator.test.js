const test = require("node:test");
const assert = require("node:assert/strict");
const RequiredItemsValidator = require("../../src/optimizer/RequiredItemsValidator");
const QueryError = require("../../src/optimizer/QueryError");
const { buildItem, buildWeapon } = require("./optimizerFixture");
const { PRYSMARADITE_TYPE_ID } = require("../../src/data/slots");

const { CODE } = QueryError;
const CHARACTER_LEVEL = 150;
const HIGH_ITEM_LEVEL = 200;
const MISSING_ITEM_ID = 999999;
const UNSUPPORTED_SLOT = "pet";

function withLevel(item, level) {
    item.level = level;
    return item;
}

const weapon = buildWeapon();
const otherWeapon = buildWeapon();
const twoHandedWeapon = buildWeapon({ isTwoHanded: true });
const shield = buildItem({ slot: "shield" });
const rings = [buildItem({ slot: "ring" }), buildItem({ slot: "ring" }), buildItem({ slot: "ring" })];
const dofus = Array.from({ length: 7 }, () => buildItem({ slot: "dofus" }));
const prysmaradites = [1, 2].map(() => buildItem({ slot: "dofus", typeId: PRYSMARADITE_TYPE_ID }));
const highHat = withLevel(buildItem({ slot: "hat" }), HIGH_ITEM_LEVEL);
const pet = buildItem({ slot: UNSUPPORTED_SLOT });
const ALL_ITEMS = [weapon, otherWeapon, twoHandedWeapon, shield, ...rings, ...dofus, ...prysmaradites, highHat, pet];

function validate(items) {
    const query = { level: CHARACTER_LEVEL, requiredItemIds: new Set(items.map((item) => item.id ?? item)) };
    new RequiredItemsValidator(ALL_ITEMS).validate(query);
}

function assertQueryError(items, code, details) {
    assert.throws(
        () => validate(items),
        (error) => {
            assert.ok(error instanceof QueryError);
            assert.equal(error.code, code);
            assert.deepEqual(error.details, details);
            return true;
        },
    );
}

test("compatible required items pass", () => {
    validate([]);
    validate([weapon, shield, rings[0], rings[1], ...dofus.slice(0, 5), prysmaradites[0]]);
});

test("an unknown id or an item without equipment slot is an unknown required item", () => {
    assertQueryError([MISSING_ITEM_ID], CODE.UNKNOWN_REQUIRED_ITEM, { itemId: MISSING_ITEM_ID });
    assertQueryError([pet], CODE.UNKNOWN_REQUIRED_ITEM, { itemId: pet.id });
});

test("a required item above the character level is refused", () => {
    assertQueryError([highHat], CODE.REQUIRED_ITEM_ABOVE_LEVEL, {
        itemName: highHat.name,
        itemLevel: HIGH_ITEM_LEVEL,
        level: CHARACTER_LEVEL,
    });
});

test("more required items than a slot holds are refused", () => {
    assertQueryError([weapon, otherWeapon], CODE.TOO_MANY_REQUIRED_ITEMS, { slot: "weapon", count: 2, capacity: 1 });
    assertQueryError(rings, CODE.TOO_MANY_REQUIRED_ITEMS, { slot: "ring", count: 3, capacity: 2 });
    assertQueryError(dofus, CODE.TOO_MANY_REQUIRED_ITEMS, { slot: "dofus", count: 7, capacity: 6 });
});

test("two required prysmaradites are refused", () => {
    assertQueryError(prysmaradites, CODE.TOO_MANY_REQUIRED_PRYSMARADITES, { count: 2, max: 1 });
});

test("a required two-handed weapon with a required shield is refused", () => {
    assertQueryError([twoHandedWeapon, shield], CODE.REQUIRED_SHIELD_WITH_TWO_HANDED_WEAPON, {
        weaponName: twoHandedWeapon.name,
        shieldName: shield.name,
    });
});
