const Action = require("./Action");
const { findElement } = require("../stats/elements");
const { CHARACTERISTIC } = require("../stats/characteristics");

const PERCENT_BASE = 100;
const MIN_CRITICAL_PERCENT = 0;
const MAX_CRITICAL_PERCENT = 100;
const NO_DAMAGE = 0;

class DamageCalculator {
    #element;

    constructor(elementKey) {
        this.#element = findElement(elementKey);
    }

    computeExpectedDamage(action, stats) {
        const { normal, critical, criticalChance, finalFactor } = this.#computeParts(action, stats);
        return ((1 - criticalChance) * normal + criticalChance * critical) * finalFactor;
    }

    // Upper bound for any stuff whose stats are at most these: the expected damage is linear in the critical chance,
    // so it is at most the larger of the non-critical damage and the damage at the highest reachable chance.
    computeOptimisticDamage(action, stats) {
        const { normal, finalFactor } = this.#computeParts(action, stats);
        return Math.max(normal * finalFactor, this.computeExpectedDamage(action, stats));
    }

    #computeParts(action, stats) {
        const criticalBonus = stats.get(CHARACTERISTIC.CRITICAL_DAMAGE);
        return {
            normal: this.#sumLines(action.normalLines, stats, NO_DAMAGE),
            critical: this.#sumLines(action.criticalLines, stats, criticalBonus),
            criticalChance: this.#computeCriticalChance(action, stats),
            finalFactor: this.#computeFinalFactor(action, stats),
        };
    }

    #sumLines(lines, stats, lineBonus) {
        const multiplier =
            (PERCENT_BASE + stats.get(this.#element.characteristic) + stats.get(CHARACTERISTIC.POWER)) / PERCENT_BASE;
        const fixed = stats.get(CHARACTERISTIC.DAMAGE) + stats.get(this.#element.fixedDamage) + lineBonus;
        return lines.reduce(
            (total, line) => total + Math.max(NO_DAMAGE, ((line.min + line.max) / 2) * multiplier + fixed),
            0,
        );
    }

    #computeCriticalChance(action, stats) {
        if (action.criticalRate === 0) return 0;
        const percent = action.criticalRate + stats.get(CHARACTERISTIC.CRITICAL);
        return Math.min(Math.max(percent, MIN_CRITICAL_PERCENT), MAX_CRITICAL_PERCENT) / PERCENT_BASE;
    }

    #computeFinalFactor(action, stats) {
        const isSpell = action.kind === Action.KIND.SPELL;
        const kindId = isSpell ? CHARACTERISTIC.SPELL_DAMAGE_PERCENT : CHARACTERISTIC.WEAPON_DAMAGE_PERCENT;
        const rangeId = action.isMelee ? CHARACTERISTIC.MELEE_DAMAGE_PERCENT : CHARACTERISTIC.RANGED_DAMAGE_PERCENT;
        return (
            ((PERCENT_BASE + stats.get(kindId)) / PERCENT_BASE) * ((PERCENT_BASE + stats.get(rangeId)) / PERCENT_BASE)
        );
    }
}

module.exports = DamageCalculator;
