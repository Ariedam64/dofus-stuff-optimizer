const { CHARACTERISTIC } = require("../stats/characteristics");

const EXO_VALUE = 1;
// Keys name the exo in results ("ap" / "mp").
const EXO_CHARACTERISTICS = Object.freeze({ ap: CHARACTERISTIC.AP, mp: CHARACTERISTIC.MP });

module.exports = { EXO_VALUE, EXO_CHARACTERISTICS };
