const { CHARACTERISTIC } = require("./characteristics");

const ELEMENTS = Object.freeze({
    water: {
        characteristic: CHARACTERISTIC.CHANCE,
        fixedDamage: CHARACTERISTIC.WATER_DAMAGE,
        resistance: CHARACTERISTIC.WATER_RESISTANCE,
        damageEffectIds: [96, 91],
    },
    earth: {
        characteristic: CHARACTERISTIC.STRENGTH,
        fixedDamage: CHARACTERISTIC.EARTH_DAMAGE,
        resistance: CHARACTERISTIC.EARTH_RESISTANCE,
        damageEffectIds: [97, 92],
    },
    fire: {
        characteristic: CHARACTERISTIC.INTELLIGENCE,
        fixedDamage: CHARACTERISTIC.FIRE_DAMAGE,
        resistance: CHARACTERISTIC.FIRE_RESISTANCE,
        damageEffectIds: [99, 94],
    },
    air: {
        characteristic: CHARACTERISTIC.AGILITY,
        fixedDamage: CHARACTERISTIC.AIR_DAMAGE,
        resistance: CHARACTERISTIC.AIR_RESISTANCE,
        damageEffectIds: [98, 93],
    },
    neutral: {
        characteristic: CHARACTERISTIC.STRENGTH,
        fixedDamage: CHARACTERISTIC.NEUTRAL_DAMAGE,
        resistance: CHARACTERISTIC.NEUTRAL_RESISTANCE,
        damageEffectIds: [100, 95],
    },
});

function isElementKey(key) {
    return Object.hasOwn(ELEMENTS, key);
}

function findElement(key) {
    if (!isElementKey(key)) throw new Error(`Unknown element "${key}"`);
    return ELEMENTS[key];
}

module.exports = { ELEMENTS, isElementKey, findElement };
