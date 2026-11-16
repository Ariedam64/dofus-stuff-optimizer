const test = require("node:test");
const assert = require("node:assert/strict");
const StatBounds = require("../../src/solver/StatBounds");
const ItemModel = require("../../src/solver/ItemModel");
const LpWriter = require("../../src/solver/LpWriter");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SLOT } = require("../../src/data/slots");
const { EXO_VALUE, EXO_CHARACTERISTICS } = require("../../src/data/exos");
const { buildRandomCase, weigh, RANDOM_CASE_COUNT, FIRST_SEED } = require("./randomCases");
const { bruteForce, buildItem, buildWeapon, buildContext } = require("./solverFixture");

const TOLERANCE = 1e-6;
const WEAPON_CHANCE = -50;
const SHIELD_CHANCE = 100;
const HAT_CHANCE = 30;
const C = CHARACTERISTIC;
// Mixed signs and fractional coefficients, like the damage lines of the exact model.
const WEIGHT_SETS = [
    new Map([[C.AP, 1]]),
    new Map([
        [C.CHANCE, 0.37],
        [C.POWER, 0.37],
        [C.DAMAGE, 1],
        [C.WATER_DAMAGE, 1],
    ]),
    new Map([
        [C.CHANCE, 0.05],
        [C.POWER, 0.05],
        [C.CRITICAL_DAMAGE, 1],
    ]),
    new Map([
        [C.CRITICAL, -2],
        [C.AGILITY, 0.5],
        [C.MP, 3],
    ]),
];

// What items, set bonuses and exos add to the weighted characteristics of an evaluated stuff.
function weighItemPart(evaluator, evaluation, weights) {
    const exoValue = evaluation.exos.reduce(
        (total, exo) => total + EXO_VALUE * (weights.get(EXO_CHARACTERISTICS[exo.characteristic]) ?? 0),
        0,
    );
    return weigh(evaluator.computeStats(evaluation.items), weights) - weigh(evaluator.baseStats, weights) + exoValue;
}

function buildStatBounds({ candidates, query, gameData }) {
    const getSet = (setId) => gameData.getSet(setId);
    const itemModel = new ItemModel({ writer: new LpWriter(), candidates, query, getSet });
    itemModel.build();
    return new StatBounds({
        candidates,
        getSet,
        maxWornBySetId: itemModel.maxWornBySetId,
        allowsExo: (exoKey) => query.allowsExo(exoKey),
    });
}

function assertWithin(value, { lower, upper }, message) {
    assert.ok(
        value >= lower - TOLERANCE && value <= upper + TOLERANCE,
        `${message}: ${value} not in [${lower}, ${upper}]`,
    );
}

test("item bounds contain every valid stuff, and the weapon bounds every stuff wearing that weapon", () => {
    for (let index = 0; index < RANDOM_CASE_COUNT; index++) {
        const seed = FIRST_SEED + index;
        const context = buildRandomCase(seed);
        const statBounds = buildStatBounds(context);
        const evaluations = bruteForce(context);
        WEIGHT_SETS.forEach((weights, weightIndex) => {
            const globalBounds = statBounds.boundsOf(weights);
            for (const evaluation of evaluations) {
                const value = weighItemPart(context.evaluator, evaluation, weights);
                assertWithin(value, globalBounds, `seed ${seed} weights ${weightIndex}`);
                const weapon = evaluation.items.find((item) => item.slot === SLOT.WEAPON);
                if (!weapon) continue;
                assertWithin(
                    value,
                    statBounds.boundsOf(weights, { weapon }),
                    `seed ${seed} weights ${weightIndex} worn`,
                );
            }
        });
    }
});

test("a worn weapon counts even when it lowers the stat, and a two-handed one leaves no shield", () => {
    const weapon = buildWeapon({ stats: [[C.CHANCE, WEAPON_CHANCE]], isTwoHanded: true });
    const items = [
        weapon,
        buildItem({ slot: SLOT.SHIELD, stats: [[C.CHANCE, SHIELD_CHANCE]] }),
        buildItem({ slot: SLOT.HAT, stats: [[C.CHANCE, HAT_CHANCE]] }),
    ];
    const statBounds = buildStatBounds(buildContext({ items, spellGroups: [] }));
    const chance = new Map([[C.CHANCE, 1]]);
    assert.deepEqual(statBounds.boundsOf(chance), { lower: WEAPON_CHANCE, upper: SHIELD_CHANCE + HAT_CHANCE });
    assert.deepEqual(statBounds.boundsOf(chance, { weapon }), {
        lower: WEAPON_CHANCE,
        upper: WEAPON_CHANCE + HAT_CHANCE,
    });
});
