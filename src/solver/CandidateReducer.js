const weighStats = require("./weighStats");
const { CHARACTERISTIC } = require("../stats/characteristics");
const { findElement } = require("../stats/elements");
const { SLOT_CAPACITIES } = require("../data/slots");

const KEPT_PER_POSITION = 25;
const KEPT_PER_POSITION_FOR_CONSTRAINT = 8;
const FIRST_SET_BONUS_COUNT = 2;

// Keeps, per slot, the items that look best for a linear damage estimate plus the best ones for every
// constrained characteristic, so that the heuristic MILP stays small. Only the heuristic uses it.
class CandidateReducer {
    #candidates;
    #getSet;
    #query;

    constructor({ candidates, getSet, query }) {
        this.#candidates = candidates;
        this.#getSet = getSet;
        this.#query = query;
    }

    reduce({ weights, itemValues }, keptItems = []) {
        const kept = new Set(keptItems);
        const reduced = new Map();
        for (const [slot, items] of this.#candidates) {
            const positions = SLOT_CAPACITIES[slot];
            const selected = new Set(
                items.filter((item) => kept.has(item) || this.#query.requiredItemIds.has(item.id)),
            );
            const byValue = (item) =>
                weighStats(item.stats, weights) + (itemValues.get(item) ?? 0) + this.#bestSetShare(item, weights);
            this.#addTop(selected, items, byValue, positions * KEPT_PER_POSITION);
            for (const characteristic of this.#listConstrainedCharacteristics()) {
                this.#addTop(
                    selected,
                    items,
                    (item) => item.stats.get(characteristic),
                    positions * KEPT_PER_POSITION_FOR_CONSTRAINT,
                );
            }
            reduced.set(
                slot,
                items.filter((item) => selected.has(item)),
            );
        }
        return reduced;
    }

    #addTop(selected, items, valueOf, count) {
        const ranked = items.map((item) => ({ item, value: valueOf(item) })).filter(({ value }) => value > 0);
        ranked.sort((first, second) => second.value - first.value);
        for (const { item } of ranked.slice(0, count)) selected.add(item);
    }

    #listConstrainedCharacteristics() {
        const query = this.#query;
        const characteristics = [CHARACTERISTIC.AP, CHARACTERISTIC.MP];
        for (const elementKey of Object.keys(query.minResistances))
            characteristics.push(findElement(elementKey).resistance);
        if (query.minCriticalRate !== null) characteristics.push(CHARACTERISTIC.CRITICAL);
        return characteristics;
    }

    #bestSetShare(item, weights) {
        if (item.setId === null) return 0;
        const set = this.#getSet(item.setId);
        let best = 0;
        for (let count = FIRST_SET_BONUS_COUNT; count <= set.itemIds.length; count++) {
            best = Math.max(best, weighStats(set.bonusFor(count), weights) / count);
        }
        return best;
    }
}

module.exports = CandidateReducer;
