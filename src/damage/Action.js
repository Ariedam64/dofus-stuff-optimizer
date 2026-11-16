const { findElement } = require("../stats/elements");

const KIND = Object.freeze({ SPELL: "spell", WEAPON: "weapon" });
const MELEE_MAX_RANGE = 1;
const UNLIMITED_CASTS = 0;
const SINGLE_CAST_PER_TURN = 1;

function keepElementLines(lines, element) {
    return lines.filter((line) => element.damageEffectIds.includes(line.effectId));
}

function toLimit(value) {
    return value === UNLIMITED_CASTS ? Infinity : value;
}

class Action {
    static KIND = KIND;

    name;
    kind;
    apCost;
    maxCasts;
    isMelee;
    criticalRate;
    normalLines;
    criticalLines;

    constructor({ name, kind, apCost, maxCasts, isMelee, criticalRate, normalLines, criticalLines }) {
        this.name = name;
        this.kind = kind;
        this.apCost = apCost;
        this.maxCasts = maxCasts;
        this.isMelee = isMelee;
        this.criticalRate = criticalRate;
        this.normalLines = normalLines;
        this.criticalLines = criticalLines;
    }

    static fromSpell(spell, elementKey) {
        const element = findElement(elementKey);
        const normalLines = keepElementLines(spell.normalLines, element);
        if (normalLines.length === 0) return null;
        return new Action({
            name: spell.name,
            kind: KIND.SPELL,
            apCost: spell.apCost,
            maxCasts: Action.#computeSpellMaxCasts(spell),
            isMelee: spell.range <= MELEE_MAX_RANGE,
            criticalRate: spell.criticalRate,
            normalLines,
            criticalLines: keepElementLines(spell.criticalLines, element),
        });
    }

    static #computeSpellMaxCasts(spell) {
        if (spell.minCastInterval > 0) return SINGLE_CAST_PER_TURN;
        return Math.min(toLimit(spell.maxCastPerTurn), toLimit(spell.maxCastPerTarget));
    }

    static fromWeapon(item, elementKey) {
        const element = findElement(elementKey);
        const weapon = item.weapon;
        if (!weapon) return null;
        const normalLines = keepElementLines(weapon.damageLines, element);
        if (normalLines.length === 0) return null;
        return new Action({
            name: item.name,
            kind: KIND.WEAPON,
            apCost: weapon.apCost,
            maxCasts: toLimit(weapon.maxCastPerTurn),
            isMelee: weapon.range <= MELEE_MAX_RANGE,
            criticalRate: weapon.criticalRate,
            normalLines,
            criticalLines: normalLines.map((line) => ({
                effectId: line.effectId,
                min: line.min + weapon.criticalBonus,
                max: line.max + weapon.criticalBonus,
            })),
        });
    }
}

module.exports = Action;
