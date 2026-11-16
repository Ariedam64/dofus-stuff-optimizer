const test = require("node:test");
const assert = require("node:assert/strict");
const WeaponGroup = require("../../src/optimizer/WeaponGroup");
const WeaponPartitioner = require("../../src/optimizer/WeaponPartitioner");
const { SLOT } = require("../../src/data/slots");
const { buildWeapon } = require("../solver/solverFixture");
const { buildRandomSearchContext } = require("./partitionFixture");

const SEED = 1000;
const SEARCH_OPTIONS = Object.freeze({ resultCount: 3, minDifferentItems: 3 });
const WEAK_DAMAGE = 5;
const STRONG_DAMAGE = 60;
const MEDIUM_DAMAGE = 30;

function buildContextWithWeapons(weapons, requiredItemIds = []) {
    const context = buildRandomSearchContext(SEED, SEARCH_OPTIONS);
    context.query.requiredItemIds = new Set(requiredItemIds);
    context.candidates = new Map(context.candidates).set(SLOT.WEAPON, weapons);
    return context;
}

function describe(groups) {
    return groups.map((group) => [group.weaponIds, group.isWeaponRequired]);
}

test("one group per promising weapon, best first, then the other weapons with the stuffs without weapon", () => {
    const weak = buildWeapon({ damage: WEAK_DAMAGE, apCost: 3 });
    const strong = buildWeapon({ damage: STRONG_DAMAGE, apCost: 3 });
    const medium = buildWeapon({ damage: MEDIUM_DAMAGE, apCost: 3 });
    const partitioner = new WeaponPartitioner(buildContextWithWeapons([weak, strong, medium]));
    assert.deepEqual(describe(partitioner.partition(3)), [
        [[strong.id], true],
        [[medium.id], true],
        [[weak.id], false],
    ]);
    assert.deepEqual(describe(partitioner.partition(5)), [
        [[strong.id], true],
        [[medium.id], true],
        [[weak.id], true],
        [[], false],
    ]);
});

test("a single job, no weapon candidate or a required weapon keeps one search over every weapon", () => {
    const weapons = [buildWeapon(), buildWeapon()];
    assert.deepEqual(new WeaponPartitioner(buildContextWithWeapons(weapons)).partition(1), [WeaponGroup.ALL]);
    assert.deepEqual(new WeaponPartitioner(buildContextWithWeapons([])).partition(4), [WeaponGroup.ALL]);
    const required = new WeaponPartitioner(buildContextWithWeapons(weapons, [weapons[1].id]));
    assert.deepEqual(required.partition(4), [WeaponGroup.ALL]);
});

test("a group restricts the weapon candidates and requires its weapon only when asked", () => {
    const context = buildRandomSearchContext(SEED, SEARCH_OPTIONS);
    const [weapon] = context.candidates.get(SLOT.WEAPON);
    const required = new WeaponGroup({ weaponIds: [weapon.id], isWeaponRequired: true }).restrict(context);
    assert.deepEqual(required.candidates.get(SLOT.WEAPON), [weapon]);
    assert.equal(required.query.isWeaponRequired, true);
    const withoutWeapon = new WeaponGroup({ weaponIds: [] }).restrict(context);
    assert.deepEqual(withoutWeapon.candidates.get(SLOT.WEAPON), []);
    assert.equal(withoutWeapon.query.isWeaponRequired, false);
    assert.equal(WeaponGroup.ALL.restrict(context).candidates, context.candidates);
    assert.throws(() => new WeaponGroup({ weaponIds: [], isWeaponRequired: true }), /cannot require no weapon/);
});

test("a group travels in a job and back", () => {
    const group = new WeaponGroup({ weaponIds: [4, 7], isWeaponRequired: true });
    const copy = WeaponGroup.fromJob({ queryJson: {}, ...group.toJobFields() });
    assert.deepEqual([copy.weaponIds, copy.isWeaponRequired], [[4, 7], true]);
    assert.deepEqual(WeaponGroup.fromJob({}).toJobFields(), WeaponGroup.ALL.toJobFields());
});
