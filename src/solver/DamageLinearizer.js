const PointAllocator = require("../character/PointAllocator");
const Action = require("../damage/Action");
const DamageCalculator = require("../damage/DamageCalculator");
const TurnPlanner = require("../damage/TurnPlanner");
const { CHARACTERISTIC } = require("../stats/characteristics");
const { findElement } = require("../stats/elements");
const { SLOT } = require("../data/slots");

const STEP = 1;

// Linear estimate of the turn damage around a stuff, keeping its spell rotation: the gradient over the damage
// characteristics comes from finite differences of the exact damage formula. Only used to propose stuffs.
class DamageLinearizer {
    #query;
    #element;
    #damageCalculator;
    #turnPlanner;
    #spellGroups;
    #baseStats;
    #spellsByName = new Map();
    #weaponActions = new Map();

    // spellGroups: Action[][] of the evaluator; baseStats: the character's Stats before items and points.
    constructor({ query, spellGroups, baseStats, weapons }) {
        this.#query = query;
        this.#element = findElement(query.elementKey);
        this.#damageCalculator = new DamageCalculator(query.elementKey);
        this.#turnPlanner = new TurnPlanner(this.#damageCalculator);
        this.#spellGroups = spellGroups;
        this.#baseStats = baseStats;
        for (const action of this.#spellGroups.flat()) this.#spellsByName.set(action.name, action);
        for (const weapon of weapons) {
            const action = Action.fromWeapon(weapon, query.elementKey);
            if (action && action.apCost > 0) this.#weaponActions.set(weapon, action);
        }
    }

    get #damageCharacteristics() {
        return [
            ...new Set([
                this.#element.characteristic,
                this.#element.fixedDamage,
                CHARACTERISTIC.POWER,
                CHARACTERISTIC.DAMAGE,
                CHARACTERISTIC.CRITICAL,
                CHARACTERISTIC.CRITICAL_DAMAGE,
                CHARACTERISTIC.SPELL_DAMAGE_PERCENT,
                CHARACTERISTIC.WEAPON_DAMAGE_PERCENT,
                CHARACTERISTIC.MELEE_DAMAGE_PERCENT,
                CHARACTERISTIC.RANGED_DAMAGE_PERCENT,
            ]),
        ];
    }

    linearizeEvaluation(evaluation) {
        const weapon = evaluation.items.find((item) => item.slot === SLOT.WEAPON) ?? null;
        return this.#linearize(evaluation.stats, evaluation.turn.casts, weapon);
    }

    // Without a known stuff: the bare character at the minimum AP, every point in the element, with its scrolls.
    linearizeNeutral() {
        const query = this.#query;
        const stats = this.#baseStats.clone();
        const allocator = new PointAllocator({
            level: query.level,
            useScrolls: query.useScrolls,
            elementCharacteristic: this.#element.characteristic,
        });
        stats.addAll(allocator.optimisticStats);
        stats.add(CHARACTERISTIC.AP, Math.max(0, query.minAp - stats.get(CHARACTERISTIC.AP)));
        const turn = this.#turnPlanner.planTurn(this.#spellGroups, stats.get(CHARACTERISTIC.AP), stats);
        return this.#linearize(stats, turn.casts, null);
    }

    // weights: gradient of the reference rotation; apValueOf: best spell turn at each AP for the reference stats;
    // itemValues: what each weapon adds to the turn at the reference AP.
    #linearize(stats, casts, weapon) {
        const rotation = casts.map((cast) => ({
            action:
                cast.kind === Action.KIND.WEAPON ? this.#weaponActions.get(weapon) : this.#spellsByName.get(cast.name),
            count: cast.count,
        }));
        const damageByAp = new Map();
        const apValueOf = (ap) => {
            if (!damageByAp.has(ap)) {
                damageByAp.set(ap, this.#turnPlanner.planTurn(this.#spellGroups, ap, stats).totalDamage);
            }
            return damageByAp.get(ap);
        };
        return {
            weights: this.#computeGradient(rotation, stats),
            apValueOf,
            itemValues: this.#computeWeaponGains(stats, apValueOf),
        };
    }

    #computeGradient(rotation, stats) {
        const reference = this.#sumDamage(rotation, stats);
        const gradient = new Map();
        for (const characteristic of this.#damageCharacteristics) {
            const shifted = stats.clone();
            shifted.add(characteristic, STEP);
            gradient.set(characteristic, (this.#sumDamage(rotation, shifted) - reference) / STEP);
        }
        return gradient;
    }

    #sumDamage(rotation, stats) {
        return rotation.reduce(
            (total, { action, count }) => total + count * this.#damageCalculator.computeExpectedDamage(action, stats),
            0,
        );
    }

    #computeWeaponGains(stats, apValueOf) {
        const ap = stats.get(CHARACTERISTIC.AP);
        const gains = new Map();
        for (const [weapon, action] of this.#weaponActions) {
            const turn = this.#turnPlanner.planTurn([...this.#spellGroups, [action]], ap, stats);
            const gain = turn.totalDamage - apValueOf(ap);
            if (gain > 0) gains.set(weapon, gain);
        }
        return gains;
    }
}

module.exports = DamageLinearizer;
