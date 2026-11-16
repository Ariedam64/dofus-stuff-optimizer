const Query = require("../../src/optimizer/Query");
const StuffEvaluator = require("../../src/optimizer/StuffEvaluator");
const Item = require("../../src/data/Item");
const ItemSet = require("../../src/data/ItemSet");
const Spell = require("../../src/data/Spell");
const Stats = require("../../src/stats/Stats");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const DamageCalculator = require("../../src/damage/DamageCalculator");
const TurnPlanner = require("../../src/damage/TurnPlanner");
const { SLOT, SLOT_CAPACITIES, PRYSMARADITE_TYPE_ID, MAX_PRYSMARADITES } = require("../../src/data/slots");

const CRA = { id: 9, name: "Crâ", variantPairs: [] };
const WATER_EFFECT_ID = 96;
const EARTH_EFFECT_ID = 97;
const RANGED_SPELL_RANGE = 6;
const MELEE_RANGE = 1;
const TOTAL_POSITIONS = 16;

let nextItemId = 9000;
let nextSpellId = 500;

function buildSpell({
    name,
    apCost,
    damage,
    criticalDamage = damage,
    criticalRate = 0,
    maxCastPerTurn = 0,
    minCastInterval = 0,
    range,
}) {
    nextSpellId += 1;
    return new Spell({
        spellId: nextSpellId,
        name,
        apCost,
        minRange: 1,
        range: range ?? RANGED_SPELL_RANGE,
        criticalRate,
        maxCastPerTurn,
        maxCastPerTarget: 0,
        minCastInterval,
        minPlayerLevel: 1,
        normalLines: [{ effectId: WATER_EFFECT_ID, min: damage, max: damage }],
        criticalLines: [{ effectId: WATER_EFFECT_ID, min: criticalDamage, max: criticalDamage }],
        ignoredReason: null,
    });
}

function buildItem({ slot = SLOT.HAT, stats = [], setId = null, typeId = 0, criterion = "", weapon = null } = {}) {
    nextItemId += 1;
    return new Item({
        id: nextItemId,
        name: `${slot} ${nextItemId}`,
        typeId,
        slot,
        level: 1,
        setId,
        criterion,
        stats: new Stats(stats),
        weapon,
    });
}

function buildWeapon({
    stats = [],
    damage = 20,
    apCost = 4,
    criticalRate = 0,
    criticalBonus = 0,
    maxCastPerTurn = 1,
    range = MELEE_RANGE,
    isTwoHanded = false,
    effectId = WATER_EFFECT_ID,
    setId = null,
    criterion = "",
} = {}) {
    return buildItem({
        slot: SLOT.WEAPON,
        stats,
        setId,
        criterion,
        weapon: {
            apCost,
            minRange: 1,
            range,
            criticalRate,
            criticalBonus,
            maxCastPerTurn,
            isTwoHanded,
            damageLines: [{ effectId, min: damage, max: damage }],
        },
    });
}

// bonuses: [[wornCount, statEntries], ...]
function buildSet(id, items, bonuses) {
    const bonusesByCount = [];
    for (const [wornCount, entries] of bonuses) bonusesByCount[wornCount - 1] = new Stats(entries);
    for (let index = 0; index < bonusesByCount.length; index++) bonusesByCount[index] ??= new Stats();
    return new ItemSet({ id, name: `set ${id}`, itemIds: items.map((item) => item.id), bonusesByCount });
}

function buildContext({
    items,
    sets = [],
    spellGroups,
    level = 200,
    useScrolls = true,
    allowRingExos,
    ringExos,
    constraints = {},
    resultCount = 1,
    minDifferentItems,
    minCriticalRate,
}) {
    const setsById = new Map(sets.map((set) => [set.id, set]));
    const gameData = { getSpellGroups: () => spellGroups, getSet: (id) => setsById.get(id) };
    const diversity = minDifferentItems === undefined ? undefined : { minDifferentItems };
    const query = Query.parse(
        {
            breed: "cra",
            level,
            profile: { elements: ["water"], minCriticalRate },
            constraints,
            allowRingExos,
            ringExos,
            useScrolls,
            resultCount,
            diversity,
        },
        { findBreed: () => CRA },
    );
    const evaluator = new StuffEvaluator({
        query,
        gameData,
        criterionEvaluator: new CriterionEvaluator(),
        turnPlanner: new TurnPlanner(new DamageCalculator("water")),
    });
    const candidates = new Map(Object.keys(SLOT_CAPACITIES).map((slot) => [slot, []]));
    for (const item of items) candidates.get(item.slot).push(item);
    return { query, gameData, evaluator, candidates };
}

function listCombinations(items, maxSize, start = 0) {
    const combinations = [[]];
    if (maxSize === 0) return combinations;
    for (let index = start; index < items.length; index++) {
        for (const rest of listCombinations(items, maxSize - 1, index + 1)) combinations.push([items[index], ...rest]);
    }
    return combinations;
}

function isAllowedStuff(items, query) {
    const weapon = items.find((item) => item.slot === SLOT.WEAPON);
    if (weapon?.weapon?.isTwoHanded && items.some((item) => item.slot === SLOT.SHIELD)) return false;
    if (items.filter((item) => item.typeId === PRYSMARADITE_TYPE_ID).length > MAX_PRYSMARADITES) return false;
    const ids = new Set(items.map((item) => item.id));
    return [...query.requiredItemIds].every((id) => ids.has(id));
}

function listStuffs({ candidates, query }) {
    let stuffs = [[]];
    for (const [slot, items] of candidates) {
        const choices = listCombinations(items, SLOT_CAPACITIES[slot]);
        stuffs = stuffs.flatMap((stuff) => choices.map((choice) => [...stuff, ...choice]));
    }
    return stuffs.filter((items) => isAllowedStuff(items, query));
}

function bruteForce(context) {
    return listStuffs(context)
        .map((items) => context.evaluator.evaluate(items))
        .filter(Boolean)
        .sort((first, second) => second.score - first.score);
}

function countOverlap(firstItems, secondItems) {
    let overlap = 0;
    for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
        const firstIds = firstItems.filter((item) => item.slot === slot).map((item) => item.id);
        const secondIds = new Set(secondItems.filter((item) => item.slot === slot).map((item) => item.id));
        const sharedCount = firstIds.filter((id) => secondIds.has(id)).length;
        overlap += sharedCount + Math.min(capacity - firstIds.length, capacity - secondIds.size);
    }
    return overlap;
}

function findWeaponId(items) {
    return items.find((item) => item.slot === SLOT.WEAPON)?.id ?? null;
}

function isDiverse(firstItems, secondItems, minDifferentItems) {
    if (findWeaponId(firstItems) !== findWeaponId(secondItems)) return true;
    return TOTAL_POSITIONS - countOverlap(firstItems, secondItems) >= minDifferentItems;
}

async function collect(generator) {
    const yields = [];
    for await (const result of generator) yields.push(result);
    return yields;
}

// Replaces a method or property for the duration of one test.
async function withReplaced(owner, name, replacement, run) {
    const original = owner[name];
    owner[name] = replacement(original);
    try {
        return await run();
    } finally {
        owner[name] = original;
    }
}

module.exports = {
    buildSpell,
    buildItem,
    buildWeapon,
    buildSet,
    buildContext,
    bruteForce,
    isDiverse,
    collect,
    withReplaced,
    WATER_EFFECT_ID,
    EARTH_EFFECT_ID,
    MELEE_RANGE,
    PRYSMARADITE_TYPE_ID,
};
