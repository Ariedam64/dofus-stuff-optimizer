const Query = require("../../src/optimizer/Query");
const StuffEvaluator = require("../../src/optimizer/StuffEvaluator");
const Item = require("../../src/data/Item");
const Spell = require("../../src/data/Spell");
const Stats = require("../../src/stats/Stats");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const DamageCalculator = require("../../src/damage/DamageCalculator");
const TurnPlanner = require("../../src/damage/TurnPlanner");

const CRA = { id: 9, name: "Crâ", variantPairs: [] };
const WATER_EFFECT_ID = 96;
const FIRE_EFFECT_ID = 99;
const DAMAGE_PER_CAST = 10;
const FLAT_SPELL_AP_COST = 7;

let nextItemId = 1000;

function buildSpell({ name = "Water bolt", apCost = 1, maxCastPerTurn = 0, effectId = WATER_EFFECT_ID } = {}) {
    return new Spell({
        spellId: name.length,
        name,
        apCost,
        minRange: 1,
        range: 6,
        criticalRate: 0,
        maxCastPerTurn,
        maxCastPerTarget: 0,
        minCastInterval: 0,
        minPlayerLevel: 1,
        normalLines: [{ effectId, min: DAMAGE_PER_CAST, max: DAMAGE_PER_CAST }],
        criticalLines: [],
        ignoredReason: null,
    });
}

function buildItem({ slot = "hat", stats = [], criterion = "", setId = null, weapon = null } = {}) {
    nextItemId += 1;
    return new Item({
        id: nextItemId,
        name: `Item ${nextItemId}`,
        typeId: 0,
        slot,
        level: 1,
        setId,
        criterion,
        stats: new Stats(stats),
        weapon,
    });
}

function buildRing(stats = []) {
    return buildItem({ slot: "ring", stats });
}

function buildWeapon(effectId = WATER_EFFECT_ID) {
    return buildItem({
        slot: "weapon",
        weapon: {
            apCost: 4,
            minRange: 1,
            range: 1,
            criticalRate: 0,
            criticalBonus: 0,
            maxCastPerTurn: 1,
            isTwoHanded: false,
            damageLines: [{ effectId, min: 20, max: 20 }],
        },
    });
}

function buildEvaluator({
    level = 200,
    constraints = {},
    spellGroups,
    sets = [],
    allowRingExos,
    ringExos,
    minCriticalRate,
} = {}) {
    const query = Query.parse(
        {
            breed: "cra",
            level,
            profile: { elements: ["water"], minCriticalRate },
            constraints,
            allowRingExos,
            ringExos,
        },
        { findBreed: () => CRA },
    );
    const setsById = new Map(sets.map((set) => [set.id, set]));
    const gameData = {
        getSpellGroups: () => spellGroups ?? [[buildSpell()]],
        getSet: (id) => setsById.get(id),
    };
    return new StuffEvaluator({
        query,
        gameData,
        criterionEvaluator: new CriterionEvaluator(),
        turnPlanner: new TurnPlanner(new DamageCalculator("water")),
    });
}

// A single 7 AP spell castable once: damage does not grow past 7 AP, so exos only matter for constraints.
function buildFlatDamageEvaluator(options) {
    const spell = buildSpell({ apCost: FLAT_SPELL_AP_COST, maxCastPerTurn: 1 });
    return buildEvaluator({ ...options, spellGroups: [[spell]] });
}

module.exports = {
    CRA,
    FIRE_EFFECT_ID,
    DAMAGE_PER_CAST,
    buildSpell,
    buildItem,
    buildRing,
    buildWeapon,
    buildEvaluator,
    buildFlatDamageEvaluator,
};
