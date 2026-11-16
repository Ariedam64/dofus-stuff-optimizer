const test = require("node:test");
const assert = require("node:assert/strict");
const Action = require("../../src/damage/Action");
const DamageCalculator = require("../../src/damage/DamageCalculator");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

const WATER_EFFECT_ID = 96;
const AIR_EFFECT_ID = 98;
const TOLERANCE = 0.01;

function buildSpell(overrides = {}) {
    return {
        name: "Test spell",
        apCost: 3,
        minRange: 1,
        range: 8,
        criticalRate: 10,
        maxCastPerTurn: 3,
        maxCastPerTarget: 0,
        normalLines: [{ effectId: WATER_EFFECT_ID, min: 25, max: 28 }],
        criticalLines: [{ effectId: WATER_EFFECT_ID, min: 30, max: 34 }],
        ...overrides,
    };
}

function buildStats(overrides = {}) {
    const stats = new Stats([
        [CHARACTERISTIC.CHANCE, 100],
        [CHARACTERISTIC.POWER, 50],
        [CHARACTERISTIC.DAMAGE, 10],
        [CHARACTERISTIC.WATER_DAMAGE, 20],
        [CHARACTERISTIC.CRITICAL_DAMAGE, 15],
        [CHARACTERISTIC.CRITICAL, 20],
        [CHARACTERISTIC.SPELL_DAMAGE_PERCENT, 10],
    ]);
    for (const [id, value] of Object.entries(overrides)) {
        stats.add(Number(id), value);
    }
    return stats;
}

const calculator = new DamageCalculator("water");

test("expected damage matches formula", () => {
    const action = Action.fromSpell(buildSpell(), "water");
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, buildStats()) - 115.36) < TOLERANCE);
});

test("spell with 0 base crit never crits", () => {
    const action = Action.fromSpell(buildSpell({ criticalRate: 0 }), "water");
    const expected = 96.25 * 1.1;
    const damage = calculator.computeExpectedDamage(action, buildStats({ [CHARACTERISTIC.CRITICAL]: 30 }));
    assert.ok(Math.abs(damage - expected) < TOLERANCE);
});

test("melee action uses melee percent", () => {
    const stats = buildStats({ [CHARACTERISTIC.MELEE_DAMAGE_PERCENT]: 100 });
    const melee = Action.fromSpell(buildSpell({ range: 1 }), "water");
    const ranged = Action.fromSpell(buildSpell({ range: 2 }), "water");
    assert.equal(melee.isMelee, true);
    const base = calculator.computeExpectedDamage(ranged, stats);
    assert.ok(Math.abs(calculator.computeExpectedDamage(melee, stats) - base * 2) < TOLERANCE);
});

test("ranged action uses ranged percent", () => {
    const stats = buildStats({ [CHARACTERISTIC.RANGED_DAMAGE_PERCENT]: 50 });
    const action = Action.fromSpell(buildSpell(), "water");
    const base = calculator.computeExpectedDamage(action, buildStats());
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, stats) - base * 1.5) < TOLERANCE);
});

test("weapon uses weapon percent and criticalBonus", () => {
    const item = {
        name: "Test bow",
        weapon: {
            apCost: 4,
            minRange: 1,
            range: 6,
            criticalRate: 100,
            criticalBonus: 10,
            maxCastPerTurn: 0,
            damageLines: [{ effectId: WATER_EFFECT_ID, min: 20, max: 30 }],
        },
    };
    const action = Action.fromWeapon(item, "water");
    assert.equal(action.kind, "weapon");
    assert.equal(action.maxCasts, Infinity);
    assert.deepEqual(action.criticalLines, [{ effectId: WATER_EFFECT_ID, min: 30, max: 40 }]);
    const stats = buildStats({ [CHARACTERISTIC.WEAPON_DAMAGE_PERCENT]: 100 });
    // critical = 35*2.5+30+15 = 132.5 ; p = 1 ; factor = 1.0 * 2.0 (spell percent not used)
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, stats) - 132.5 * 2) < TOLERANCE);
});

test("maxCasts is the lowest non-zero limit", () => {
    assert.equal(Action.fromSpell(buildSpell({ maxCastPerTurn: 3, maxCastPerTarget: 2 }), "water").maxCasts, 2);
    assert.equal(Action.fromSpell(buildSpell({ maxCastPerTurn: 0, maxCastPerTarget: 0 }), "water").maxCasts, Infinity);
    assert.equal(Action.fromSpell(buildSpell({ maxCastPerTurn: 3, maxCastPerTarget: 0 }), "water").maxCasts, 3);
});

test("negative multiplier is clamped at 0 per line", () => {
    const stats = new Stats([[CHARACTERISTIC.POWER, -500]]);
    const action = Action.fromSpell(buildSpell({ criticalRate: 0 }), "water");
    assert.equal(calculator.computeExpectedDamage(action, stats), 0);
});

test("fromSpell returns null without element lines", () => {
    const airSpell = buildSpell({ normalLines: [{ effectId: AIR_EFFECT_ID, min: 5, max: 6 }], criticalLines: [] });
    assert.equal(Action.fromSpell(airSpell, "water"), null);
});

test("unknown element throws naming the key", () => {
    assert.throws(() => new DamageCalculator("wind"), /wind/);
    assert.throws(() => Action.fromSpell(buildSpell(), "wind"), /wind/);
    assert.throws(() => Action.fromWeapon({ name: "x", weapon: {} }, "wind"), /wind/);
});

test("prototype keys are not elements", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
        const expectedError = new RegExp(`Unknown element "${key}"`);
        assert.throws(() => new DamageCalculator(key), expectedError);
        assert.throws(() => Action.fromSpell(buildSpell(), key), expectedError);
        assert.throws(() => Action.fromWeapon({ name: "x", weapon: {} }, key), expectedError);
    }
});

test("spell with a min cast interval can be cast once per turn", () => {
    const spell = buildSpell({ minCastInterval: 2, maxCastPerTurn: 0, maxCastPerTarget: 0 });
    assert.equal(Action.fromSpell(spell, "water").maxCasts, 1);
});

function computeNonCriticalDamage(stats) {
    return calculator.computeExpectedDamage(Action.fromSpell(buildSpell({ criticalRate: 0 }), "water"), stats);
}

test("critical chance never goes below 0", () => {
    const stats = buildStats({ [CHARACTERISTIC.CRITICAL]: -50, [CHARACTERISTIC.CRITICAL_DAMAGE]: -60 });
    const action = Action.fromSpell(buildSpell(), "water");
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, stats) - computeNonCriticalDamage(stats)) < TOLERANCE);
});

test("critical line is clamped at 0", () => {
    // p = (10 + 80) / 100: only the 10 % normal hits deal damage.
    const stats = buildStats({ [CHARACTERISTIC.CRITICAL]: 60, [CHARACTERISTIC.CRITICAL_DAMAGE]: -1000 });
    const action = Action.fromSpell(buildSpell(), "water");
    const expected = 0.1 * computeNonCriticalDamage(stats);
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, stats) - expected) < TOLERANCE);
});

test("optimistic damage never drops below the non-critical damage", () => {
    const action = Action.fromSpell(buildSpell(), "water");
    const weakCritical = buildStats({ [CHARACTERISTIC.CRITICAL]: 60, [CHARACTERISTIC.CRITICAL_DAMAGE]: -60 });
    assert.ok(calculator.computeExpectedDamage(action, weakCritical) < computeNonCriticalDamage(weakCritical));
    assert.equal(calculator.computeOptimisticDamage(action, weakCritical), computeNonCriticalDamage(weakCritical));
    const strongCritical = buildStats();
    assert.equal(
        calculator.computeOptimisticDamage(action, strongCritical),
        calculator.computeExpectedDamage(action, strongCritical),
    );
});
