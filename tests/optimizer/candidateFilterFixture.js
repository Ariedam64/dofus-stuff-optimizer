const CandidateFilter = require("../../src/optimizer/CandidateFilter");
const Query = require("../../src/optimizer/Query");
const Item = require("../../src/data/Item");
const ItemSet = require("../../src/data/ItemSet");
const Stats = require("../../src/stats/Stats");

const CHARACTER_LEVEL = 100;
const SET_ID = 7;
const WATER_EFFECT_ID = 96;

let nextItemId = 1;

function buildQuery(overrides = {}) {
    return new Query({
        breed: { id: 9, name: "Crâ" },
        level: CHARACTER_LEVEL,
        elementKey: "water",
        minCriticalRate: null,
        minAp: 0,
        minMp: 0,
        minResistances: {},
        excludedItemIds: new Set(),
        requiredItemIds: new Set(),
        allowApExo: true,
        allowMpExo: true,
        resultCount: 5,
        ...overrides,
    });
}

function toStats(object) {
    return new Stats(Object.entries(object).map(([key, value]) => [Number(key), value]));
}

function buildItem({
    slot = "hat",
    typeId = 0,
    level = 50,
    setId = null,
    criterion = "",
    stats = {},
    weapon = null,
} = {}) {
    const id = nextItemId++;
    return new Item({ id, name: `item${id}`, typeId, slot, level, setId, criterion, stats: toStats(stats), weapon });
}

function buildWeapon({ isTwoHanded = false, hasElementLines = true } = {}) {
    return {
        apCost: 4,
        minRange: 1,
        range: 1,
        criticalRate: 0,
        criticalBonus: 0,
        maxCastPerTurn: 0,
        isTwoHanded,
        damageLines: hasElementLines ? [{ effectId: WATER_EFFECT_ID, min: 10, max: 20 }] : [],
    };
}

function buildGameData(bonusesByCount = [], itemCount = 3) {
    const set = new ItemSet({
        id: SET_ID,
        name: "set",
        itemIds: Array.from({ length: itemCount }, (unused, index) => index),
        bonusesByCount: bonusesByCount.map(toStats),
    });
    return { getSet: (id) => (id === SET_ID ? set : undefined) };
}

function candidateIds(query, items, slot, gameData = buildGameData()) {
    return new CandidateFilter(query, gameData)
        .buildCandidates(items)
        .get(slot)
        .map((item) => item.id);
}

module.exports = {
    CHARACTER_LEVEL,
    SET_ID,
    buildQuery,
    buildItem,
    buildWeapon,
    buildGameData,
    candidateIds,
};
