const weighStats = require("./weighStats");
const { SLOT, SLOT_CAPACITIES } = require("../data/slots");
const { EXO_CHARACTERISTICS } = require("../data/exos");

const NO_EXO = 0;
const FIRST_WORN_COUNT = 1;
const NO_SHARE = Object.freeze({ max: 0, min: 0 });
// Absorbs the rounding errors of the fractional set bonus shares before an integral bound is rounded.
const INTEGRALITY_TOLERANCE = 1e-6;

// Sum of the `count` largest positive values.
function sumLargestPositive(values, count) {
    const largest = [];
    for (const value of values) {
        if (value <= 0) continue;
        if (largest.length < count) {
            largest.push(value);
            continue;
        }
        const smallest = Math.min(...largest);
        if (value > smallest) largest[largest.indexOf(smallest)] = value;
    }
    return largest.reduce((total, value) => total + value, 0);
}

function keepIfNonEmpty(current, candidate) {
    return candidate.lower <= candidate.upper ? candidate : current;
}

function toWeightsKey(weights) {
    return [...weights]
        .sort(([first], [second]) => first - second)
        .map(([characteristic, weight]) => `${characteristic}:${weight}`)
        .join(",");
}

// Bounds over every stuff of what items, set bonuses and ring exos add to a weighted sum of characteristics.
// A set bonus is spread over its worn items (bonus / worn count), so each item carries its best and worst share.
class StatBounds {
    #candidates;
    #getSet;
    #maxWornBySetId;
    #exoCountByCharacteristic;
    #profilesByWeightsKey = new Map();

    // allowsExo: (exoKey) => boolean, whether the query allows that ring exo.
    constructor({ candidates, getSet, maxWornBySetId, allowsExo }) {
        this.#candidates = candidates;
        this.#getSet = getSet;
        this.#maxWornBySetId = maxWornBySetId;
        const ringCapacity = SLOT_CAPACITIES[SLOT.RING];
        this.#exoCountByCharacteristic = new Map(
            Object.entries(EXO_CHARACTERISTICS).map(([exoKey, id]) => [id, allowsExo(exoKey) ? ringCapacity : NO_EXO]),
        );
    }

    // An integral stat (integer coefficients over integer variables) only takes integer values, and every valid
    // stuff meets the query minimum and the tightened bounds. A step that would leave no value is skipped: the
    // model rows then prove the infeasibility.
    static narrow(bounds, { isIntegral, minimum = -Infinity, tightened = null }) {
        let narrowed = keepIfNonEmpty(bounds, { lower: Math.max(bounds.lower, minimum), upper: bounds.upper });
        if (tightened) {
            narrowed = keepIfNonEmpty(narrowed, {
                lower: Math.max(narrowed.lower, tightened.lower),
                upper: Math.min(narrowed.upper, tightened.upper),
            });
        }
        if (isIntegral) {
            narrowed = keepIfNonEmpty(narrowed, {
                lower: Math.ceil(narrowed.lower - INTEGRALITY_TOLERANCE),
                upper: Math.floor(narrowed.upper + INTEGRALITY_TOLERANCE),
            });
        }
        return { lower: narrowed.lower, upper: narrowed.upper };
    }

    static isIntegral(expression) {
        return (
            Number.isInteger(expression.constant) &&
            expression.terms.every(([, coefficient]) => Number.isInteger(coefficient))
        );
    }

    // weights: Map<characteristic, coefficient>. weapon: when given, the bounds hold for the stuffs wearing it
    // (and no shield when it is two-handed).
    boundsOf(weights, { weapon = null } = {}) {
        const profile = this.#profileOf(weights);
        let { lower, upper } = profile.exoBounds;
        if (weapon) {
            lower += profile.worstOf(weapon);
            upper += profile.bestOf(weapon);
        }
        for (const [slot, slotBounds] of profile.slotBounds) {
            if (weapon && (slot === SLOT.WEAPON || (slot === SLOT.SHIELD && weapon.isTwoHanded))) continue;
            lower += slotBounds.lower;
            upper += slotBounds.upper;
        }
        return { lower, upper };
    }

    #profileOf(weights) {
        const key = toWeightsKey(weights);
        if (!this.#profilesByWeightsKey.has(key)) this.#profilesByWeightsKey.set(key, this.#buildProfile(weights));
        return this.#profilesByWeightsKey.get(key);
    }

    #buildProfile(weights) {
        const shares = this.#computeSetShares(weights);
        const bestOf = (item) => weighStats(item.stats, weights) + (shares.get(item.setId) ?? NO_SHARE).max;
        const worstOf = (item) => weighStats(item.stats, weights) + (shares.get(item.setId) ?? NO_SHARE).min;
        const slotBounds = new Map();
        for (const [slot, items] of this.#candidates) {
            const capacity = SLOT_CAPACITIES[slot];
            const upper = sumLargestPositive(items.map(bestOf), capacity);
            const lower = -sumLargestPositive(
                items.map((item) => -worstOf(item)),
                capacity,
            );
            slotBounds.set(slot, { lower, upper });
        }
        const exoBounds = { lower: 0, upper: 0 };
        for (const [characteristic, weight] of weights) {
            const exoGain = weight * (this.#exoCountByCharacteristic.get(characteristic) ?? 0);
            exoBounds.upper += Math.max(0, exoGain);
            exoBounds.lower += Math.min(0, exoGain);
        }
        return { bestOf, worstOf, slotBounds, exoBounds };
    }

    #computeSetShares(weights) {
        const shares = new Map();
        for (const [setId, maxWorn] of this.#maxWornBySetId) {
            const set = this.#getSet(setId);
            let max = NO_SHARE.max;
            let min = NO_SHARE.min;
            for (let count = FIRST_WORN_COUNT; count <= maxWorn; count++) {
                const share = weighStats(set.bonusFor(count), weights) / count;
                max = Math.max(max, share);
                min = Math.min(min, share);
            }
            shares.set(setId, { max, min });
        }
        return shares;
    }
}

module.exports = StatBounds;
