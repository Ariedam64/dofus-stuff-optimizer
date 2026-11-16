const isDamageEffect = require("../utils/isDamageEffect");

const DIRECT_TRIGGER = "I";
const TARGET_MASK_SEPARATOR = ",";
const TARGET_ENEMY_TOKEN = "A";
const SINGLE_LETTER_TOKEN = /^[A-Za-z]$/;
const NO_DIRECT_DAMAGE_REASON = "no-direct-damage";

function isDirectDamageLine(line) {
    if (!isDamageEffect(line.effectId)) return false;
    if (line.triggers !== DIRECT_TRIGGER || line.random !== 0 || line.duration !== 0 || line.delay !== 0) return false;
    const tokens = (line.targetMask ?? "").split(TARGET_MASK_SEPARATOR);
    return tokens.includes(TARGET_ENEMY_TOKEN) && tokens.every((token) => SINGLE_LETTER_TOKEN.test(token));
}

function keepDirectDamageLines(rawLines) {
    const lines = (rawLines ?? [])
        .filter(isDirectDamageLine)
        .map((line) => ({ effectId: line.effectId, min: line.diceNum, max: line.diceSide || line.diceNum }));
    const uniqueByKey = new Map(lines.map((line) => [`${line.effectId}:${line.min}:${line.max}`, line]));
    return [...uniqueByKey.values()];
}

class Spell {
    spellId;
    name;
    apCost;
    minRange;
    range;
    criticalRate;
    maxCastPerTurn;
    maxCastPerTarget;
    minCastInterval;
    minPlayerLevel;
    normalLines;
    criticalLines;
    ignoredReason;
    imgUrl;

    constructor(fields) {
        Object.assign(this, fields);
    }

    static fromDofusDb(spellRaw, levelRaw) {
        const normalLines = keepDirectDamageLines(levelRaw.effects);
        return new Spell({
            spellId: spellRaw.id,
            name: spellRaw.name.fr,
            apCost: levelRaw.apCost,
            minRange: levelRaw.minRange,
            range: levelRaw.range,
            criticalRate: levelRaw.criticalHitProbability,
            maxCastPerTurn: levelRaw.maxCastPerTurn,
            maxCastPerTarget: levelRaw.maxCastPerTarget,
            minCastInterval: levelRaw.minCastInterval ?? 0,
            minPlayerLevel: levelRaw.minPlayerLevel,
            normalLines,
            criticalLines: keepDirectDamageLines(levelRaw.criticalEffect),
            imgUrl: spellRaw.img ?? null,
            ignoredReason: normalLines.length === 0 ? NO_DIRECT_DAMAGE_REASON : null,
        });
    }
}

module.exports = Spell;
