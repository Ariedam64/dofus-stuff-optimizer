const Query = require("../../src/optimizer/Query");
const StuffEvaluator = require("../../src/optimizer/StuffEvaluator");
const CandidateFilter = require("../../src/optimizer/CandidateFilter");
const Item = require("../../src/data/Item");
const Spell = require("../../src/data/Spell");
const Stats = require("../../src/stats/Stats");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const DamageCalculator = require("../../src/damage/DamageCalculator");
const TurnPlanner = require("../../src/damage/TurnPlanner");
const { SLOT_CAPACITIES, PRYSMARADITE_TYPE_ID, MAX_PRYSMARADITES } = require("../../src/data/slots");

const CRA = { id: 9, name: "Crâ", variantPairs: [] };
const WATER_EFFECT_ID = 96;

let nextItemId = 5000;

function buildSpell({ name, apCost, damage, maxCastPerTurn = 0, criticalRate = 0, criticalDamage = damage }) {
    return new Spell({
        spellId: name.length,
        name,
        apCost,
        minRange: 1,
        range: 6,
        criticalRate,
        maxCastPerTurn,
        maxCastPerTarget: 0,
        minCastInterval: 0,
        minPlayerLevel: 1,
        normalLines: [{ effectId: WATER_EFFECT_ID, min: damage, max: damage }],
        criticalLines: [{ effectId: WATER_EFFECT_ID, min: criticalDamage, max: criticalDamage }],
        ignoredReason: null,
    });
}

const DEFAULT_SPELL_GROUPS = [
    [buildSpell({ name: "Water bolt", apCost: 3, damage: 20, maxCastPerTurn: 2 })],
    [buildSpell({ name: "Big wave", apCost: 4, damage: 32, maxCastPerTurn: 1, criticalRate: 10, criticalDamage: 45 })],
    [buildSpell({ name: "Drop", apCost: 1, damage: 4 })],
];

function buildItem({ slot = "hat", stats = [], setId = null, typeId = 0, criterion = "", weapon = null } = {}) {
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

function buildWeapon({ stats = [], damage = 20, apCost = 4, isTwoHanded = false } = {}) {
    return buildItem({
        slot: "weapon",
        stats,
        weapon: {
            apCost,
            minRange: 1,
            range: 1,
            criticalRate: 0,
            criticalBonus: 0,
            maxCastPerTurn: 1,
            isTwoHanded,
            damageLines: [{ effectId: WATER_EFFECT_ID, min: damage, max: damage }],
        },
    });
}

function buildContext({ items, sets = [], constraints = {}, resultCount = 1, allowRingExos, spellGroups } = {}) {
    const setsById = new Map(sets.map((set) => [set.id, set]));
    const gameData = {
        getSpellGroups: () => spellGroups ?? DEFAULT_SPELL_GROUPS,
        getSet: (id) => setsById.get(id),
    };
    const query = Query.parse(
        { breed: "cra", level: 200, profile: { elements: ["water"] }, constraints, allowRingExos, resultCount },
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
    const relevantCharacteristics = new CandidateFilter(query, gameData).relevantCharacteristics();
    return { query, gameData, evaluator, candidates, relevantCharacteristics };
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
    const weapon = items.find((item) => item.slot === "weapon");
    if (weapon?.weapon?.isTwoHanded && items.some((item) => item.slot === "shield")) return false;
    if (items.filter((item) => item.typeId === PRYSMARADITE_TYPE_ID).length > MAX_PRYSMARADITES) return false;
    const ids = new Set(items.map((item) => item.id));
    return [...query.requiredItemIds].every((id) => ids.has(id));
}

function bruteForceScores({ candidates, evaluator, query }) {
    let stuffs = [[]];
    for (const [slot, items] of candidates) {
        const choices = listCombinations(items, SLOT_CAPACITIES[slot]);
        stuffs = stuffs.flatMap((stuff) => choices.map((choice) => [...stuff, ...choice]));
    }
    return stuffs
        .filter((items) => isAllowedStuff(items, query))
        .map((items) => evaluator.evaluate(items))
        .filter(Boolean)
        .map((evaluation) => evaluation.score)
        .sort((first, second) => second - first);
}

module.exports = {
    buildItem,
    buildWeapon,
    buildSpell,
    buildContext,
    bruteForceScores,
    DEFAULT_SPELL_GROUPS,
    PRYSMARADITE_TYPE_ID,
};
