const { CHARACTERISTIC } = require("../stats/characteristics");
const { MAX_AP, MAX_MP, MAX_RANGE } = require("../config");

const CHARACTERISTIC_CAPS = Object.freeze({
    [CHARACTERISTIC.AP]: MAX_AP,
    [CHARACTERISTIC.MP]: MAX_MP,
    [CHARACTERISTIC.RANGE]: MAX_RANGE,
});

// Usable value of a characteristic total: the game ignores AP, MP and range above their caps.
function capCharacteristic(characteristic, value) {
    if (!Object.hasOwn(CHARACTERISTIC_CAPS, characteristic)) return value;
    return Math.min(value, CHARACTERISTIC_CAPS[characteristic]);
}

module.exports = capCharacteristic;
