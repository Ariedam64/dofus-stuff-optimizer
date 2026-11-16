const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SLOT } = require("../../src/data/slots");
const {
    buildSpell,
    buildItem,
    buildWeapon,
    buildSet,
    buildContext,
    WATER_EFFECT_ID,
    EARTH_EFFECT_ID,
    MELEE_RANGE,
    PRYSMARADITE_TYPE_ID,
} = require("./solverFixture");

const C = CHARACTERISTIC;
const STAT_SCALES = new Map([
    [C.AP, 1],
    [C.MP, 1],
    [C.CHANCE, 80],
    [C.POWER, 40],
    [C.DAMAGE, 10],
    [C.WATER_DAMAGE, 15],
    [C.CRITICAL, 30],
    [C.CRITICAL_DAMAGE, 20],
    [C.SPELL_DAMAGE_PERCENT, 10],
    [C.WEAPON_DAMAGE_PERCENT, 12],
    [C.MELEE_DAMAGE_PERCENT, 10],
    [C.RANGED_DAMAGE_PERCENT, 10],
    [C.STRENGTH, 120],
    [C.AGILITY, 80],
    [C.VITALITY, 200],
    [C.WATER_RESISTANCE, 15],
]);
const CRITERIA = [
    "CS>250",
    "CC>600",
    "CP<9|CM<4",
    "CA>150|CS>150",
    "CV>300",
    "CI>99&CC>200",
    "PL>100",
    "OS=505",
    "CC>399|CA>249",
];
const LEVELS = [30, 100, 200];
const CRITICAL_RATES = [0, 5, 20, 40];
const SPELL_CAST_LIMITS = [0, 1, 2];
const STAT_PRESENCE_CHANCE = 0.3;
const NEGATIVE_STAT_CHANCE = 0.25;
const CRITERION_CHANCE = 0.25;
const MELEE_CHANCE = 0.3;
const TWO_HANDED_CHANCE = 0.3;
const SCROLL_CHANCE = 0.7;
const EXO_CHANCE = 0.7;
const CONSTRAINT_CHOICES = [
    {},
    {},
    { minAp: 8 },
    { minMp: 4 },
    { minResistances: { water: 5 } },
    { minCriticalRate: 15 },
    { requiresItem: true },
];
const CAST_INTERVAL_CHANCE = 0.25;
const SET_ID = 77;
const RANDOM_CASE_COUNT = 24;
const FIRST_SEED = 1000;
// Seeds whose valid stuffs include raw AP totals above the cap once AP and MP item stats are scaled up.
const HIGH_AP_SEEDS = [3001, 3002, 3007, 3009, 3010, 3011, 3014, 3015];
const HIGH_AP_SCALE = 6;
const SET_ITEM_COUNT = 3;
const PK_TROPHY_CHANCE = 0.4;

function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = state;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(random, values) {
    return values[Math.floor(random() * values.length)];
}

function randomInteger(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function buildRandomStats(random, statScales) {
    const entries = [];
    for (const [characteristic, scale] of statScales) {
        if (random() >= STAT_PRESENCE_CHANCE) continue;
        const sign = random() < NEGATIVE_STAT_CHANCE ? -1 : 1;
        entries.push([characteristic, sign * Math.max(1, Math.round(random() * scale))]);
    }
    return entries;
}

function buildRandomItem(random, statScales, slot, extra = {}) {
    const criterion = random() < CRITERION_CHANCE ? pick(random, CRITERIA) : "";
    return buildItem({ slot, stats: buildRandomStats(random, statScales), criterion, ...extra });
}

function buildRandomSpell(random, name) {
    const damage = randomInteger(random, 8, 30);
    return buildSpell({
        name,
        apCost: randomInteger(random, 1, 4),
        damage,
        criticalDamage: damage + randomInteger(random, -2, 10),
        criticalRate: pick(random, CRITICAL_RATES),
        maxCastPerTurn: pick(random, SPELL_CAST_LIMITS),
        minCastInterval: random() < CAST_INTERVAL_CHANCE ? 2 : 0,
        range: random() < MELEE_CHANCE ? MELEE_RANGE : undefined,
    });
}

function buildRandomSpellGroups(random) {
    return [
        [buildRandomSpell(random, "Spell A")],
        [buildRandomSpell(random, "Spell B"), buildRandomSpell(random, "Spell B2")],
        [buildRandomSpell(random, "Spell C")],
    ];
}

function buildRandomWeapon(random, statScales, effectId) {
    return buildWeapon({
        stats: buildRandomStats(random, statScales),
        damage: randomInteger(random, 10, 40),
        apCost: randomInteger(random, 2, 5),
        criticalRate: pick(random, CRITICAL_RATES),
        criticalBonus: randomInteger(random, 0, 5),
        maxCastPerTurn: randomInteger(random, 1, 2),
        range: random() < MELEE_CHANCE * 2 ? MELEE_RANGE : 5,
        isTwoHanded: random() < TWO_HANDED_CHANCE,
        effectId,
        criterion: random() < CRITERION_CHANCE ? pick(random, CRITERIA) : "",
    });
}

function buildRandomItems(random, statScales) {
    const items = [
        buildRandomWeapon(random, statScales, WATER_EFFECT_ID),
        buildRandomWeapon(random, statScales, WATER_EFFECT_ID),
        buildRandomWeapon(random, statScales, EARTH_EFFECT_ID),
        buildRandomItem(random, statScales, SLOT.SHIELD),
        buildRandomItem(random, statScales, SLOT.AMULET),
        buildRandomItem(random, statScales, SLOT.AMULET),
        buildRandomItem(random, statScales, SLOT.RING),
        buildRandomItem(random, statScales, SLOT.RING),
        buildRandomItem(random, statScales, SLOT.RING),
        buildRandomItem(random, statScales, SLOT.HAT),
        buildRandomItem(random, statScales, SLOT.HAT),
        buildRandomItem(random, statScales, SLOT.DOFUS, { typeId: PRYSMARADITE_TYPE_ID }),
        buildRandomItem(random, statScales, SLOT.DOFUS, { typeId: PRYSMARADITE_TYPE_ID }),
    ];
    if (random() < PK_TROPHY_CHANCE) items.push(buildRandomItem(random, statScales, SLOT.DOFUS, { criterion: "pk<2" }));
    return items;
}

function attachRandomSet(random, statScales, items) {
    const members = [];
    const pool = items.filter((item) => item.slot !== SLOT.DOFUS);
    while (members.length < SET_ITEM_COUNT) {
        const item = pick(random, pool);
        if (!members.includes(item)) members.push(item);
    }
    for (const member of members) member.setId = SET_ID;
    return buildSet(SET_ID, members, [
        [2, buildRandomStats(random, statScales)],
        [3, [...buildRandomStats(random, statScales), [C.CHANCE, randomInteger(random, 0, 120)]]],
    ]);
}

function buildRandomConstraints(random, items) {
    const { minCriticalRate, requiresItem, ...constraints } = pick(random, CONSTRAINT_CHOICES);
    if (requiresItem)
        constraints.requiredItemIds = [
            pick(
                random,
                items.filter((item) => item.slot === SLOT.HAT),
            ).id,
        ];
    return { constraints, minCriticalRate };
}

// ringExos, when given, replaces the random all-or-nothing exo choice; apScale, when given, replaces the scale of AP
// and MP item stats so that totals can pass the game caps. The random draws stay the same per seed.
function buildRandomCase(seed, { ringExos, apScale } = {}) {
    const random = createRandom(seed);
    const statScales = new Map(STAT_SCALES);
    if (apScale !== undefined) {
        statScales.set(C.AP, apScale);
        statScales.set(C.MP, apScale);
    }
    const items = buildRandomItems(random, statScales);
    const set = attachRandomSet(random, statScales, items);
    const spellGroups = buildRandomSpellGroups(random);
    const level = pick(random, LEVELS);
    const useScrolls = random() < SCROLL_CHANCE;
    const isRingExoAllowed = random() < EXO_CHANCE;
    const exoOptions = ringExos ? { ringExos } : { allowRingExos: isRingExoAllowed };
    return buildContext({
        items,
        sets: [set],
        spellGroups,
        level,
        useScrolls,
        ...exoOptions,
        ...buildRandomConstraints(random, items),
    });
}

// The random seeds, then the high AP seeds.
function listRandomCases() {
    const cases = [];
    for (let index = 0; index < RANDOM_CASE_COUNT; index++) {
        const seed = FIRST_SEED + index;
        cases.push({ label: `seed ${seed}`, context: buildRandomCase(seed) });
    }
    for (const seed of HIGH_AP_SEEDS) {
        cases.push({ label: `high AP seed ${seed}`, context: buildRandomCase(seed, { apScale: HIGH_AP_SCALE }) });
    }
    return cases;
}

// The problem MilpModelBuilder, BoundTightener and StuffSolver share.
function toProblem({ candidates, query, gameData, evaluator }) {
    return {
        candidates,
        query,
        gameData,
        spellGroups: evaluator.buildActionGroups(null),
        baseStats: evaluator.baseStats,
    };
}

function weigh(stats, weights) {
    let total = 0;
    for (const [characteristic, weight] of weights) total += weight * stats.get(characteristic);
    return total;
}

module.exports = {
    buildRandomCase,
    listRandomCases,
    toProblem,
    weigh,
    RANDOM_CASE_COUNT,
    FIRST_SEED,
    HIGH_AP_SEEDS,
    HIGH_AP_SCALE,
};
