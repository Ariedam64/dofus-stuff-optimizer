const weighStats = require("./weighStats");
const { SLOT, SLOT_CAPACITIES } = require("../data/slots");
const { EXO_CHARACTERISTICS } = require("../data/exos");

const NO_EXO = 0;
const FIRST_WORN_COUNT = 1;
const NO_SHARE = 0;

function sumExtremes(values, capacity, isUpper) {
    const sorted = values.filter((value) => (isUpper ? value > 0 : value < 0)).sort((first, second) => first - second);
    const chosen = isUpper ? sorted.slice(-capacity) : sorted.slice(0, capacity);
    return chosen.reduce((total, value) => total + value, 0);
}

// Bounds over every stuff of what items, set bonuses and ring exos add to a weighted sum of characteristics.
// A set bonus is spread over its worn items (bonus / worn count), so each item carries its best and worst share.
class StatBounds {
    #candidates;
    #getSet;
    #maxWornBySetId;
    #exoCountByCharacteristic;

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

    // weights: Map<characteristic, coefficient>
    boundsOf(weights) {
        const shares = this.#computeSetShares(weights);
        let lower = 0;
        let upper = 0;
        for (const [slot, items] of this.#candidates) {
            const capacity = SLOT_CAPACITIES[slot];
            const best = items.map((item) => weighStats(item.stats, weights) + (shares.get(item.setId)?.max ?? 0));
            const worst = items.map((item) => weighStats(item.stats, weights) + (shares.get(item.setId)?.min ?? 0));
            upper += sumExtremes(best, capacity, true);
            lower += sumExtremes(worst, capacity, false);
        }
        for (const [characteristic, weight] of weights) {
            const exoGain = weight * (this.#exoCountByCharacteristic.get(characteristic) ?? 0);
            upper += Math.max(0, exoGain);
            lower += Math.min(0, exoGain);
        }
        return { lower, upper };
    }

    #computeSetShares(weights) {
        const shares = new Map();
        for (const [setId, maxWorn] of this.#maxWornBySetId) {
            const set = this.#getSet(setId);
            let max = NO_SHARE;
            let min = NO_SHARE;
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
