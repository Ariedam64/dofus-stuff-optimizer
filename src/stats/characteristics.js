const CHARACTERISTIC = Object.freeze({
    AP: 1,
    MP: 23,
    RANGE: 19,
    VITALITY: 11,
    WISDOM: 12,
    STRENGTH: 10,
    CHANCE: 13,
    AGILITY: 14,
    INTELLIGENCE: 15,
    DAMAGE: 16,
    CRITICAL: 18,
    POWER: 25,
    CRITICAL_DAMAGE: 86,
    EARTH_DAMAGE: 88,
    FIRE_DAMAGE: 89,
    WATER_DAMAGE: 90,
    AIR_DAMAGE: 91,
    NEUTRAL_DAMAGE: 92,
    EARTH_RESISTANCE: 33,
    FIRE_RESISTANCE: 34,
    WATER_RESISTANCE: 35,
    AIR_RESISTANCE: 36,
    NEUTRAL_RESISTANCE: 37,
    RANGED_DAMAGE_PERCENT: 120,
    WEAPON_DAMAGE_PERCENT: 122,
    SPELL_DAMAGE_PERCENT: 123,
    MELEE_DAMAGE_PERCENT: 125,
});

function toCamelCase(screamingSnakeCase) {
    return screamingSnakeCase
        .toLowerCase()
        .replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

const CHARACTERISTIC_NAMES = Object.freeze(
    Object.fromEntries(Object.entries(CHARACTERISTIC).map(([key, id]) => [id, toCamelCase(key)])),
);

module.exports = { CHARACTERISTIC, CHARACTERISTIC_NAMES };
