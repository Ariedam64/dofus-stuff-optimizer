const Stats = require("../stats/Stats");

const FIRST_BONUS_COUNT = 1;
const NO_GAIN = 0;

class ItemSet {
    id;
    name;
    itemIds;
    #bonusesByCount;
    #maxMarginals = null;
    #minMarginals = null;

    constructor({ id, name, itemIds, bonusesByCount }) {
        this.id = id;
        this.name = name;
        this.itemIds = itemIds;
        this.#bonusesByCount = bonusesByCount;
    }

    // Best gain (never below 0) brought by one more worn item, per characteristic.
    get maxMarginals() {
        if (!this.#maxMarginals) this.#computeMarginals();
        return this.#maxMarginals.clone();
    }

    // Worst gain (never above 0) brought by one more worn item, per characteristic.
    get minMarginals() {
        if (!this.#minMarginals) this.#computeMarginals();
        return this.#minMarginals.clone();
    }

    bonusFor(count) {
        if (count < FIRST_BONUS_COUNT) return new Stats();
        return this.#bonusesByCount[count - FIRST_BONUS_COUNT] ?? new Stats();
    }

    #computeMarginals() {
        const maxGains = new Map();
        const minGains = new Map();
        const maxCount = Math.max(this.itemIds.length, this.#bonusesByCount.length);
        for (let count = FIRST_BONUS_COUNT; count <= maxCount; count++) {
            const previous = this.bonusFor(count - 1);
            const current = this.bonusFor(count);
            for (const id of new Set([...previous.ids(), ...current.ids()])) {
                const gain = current.get(id) - previous.get(id);
                maxGains.set(id, Math.max(maxGains.get(id) ?? NO_GAIN, gain));
                minGains.set(id, Math.min(minGains.get(id) ?? NO_GAIN, gain));
            }
        }
        this.#maxMarginals = new Stats(maxGains);
        this.#minMarginals = new Stats(minGains);
    }

    static fromDofusDb(raw) {
        const bonusesByCount = (raw.effects ?? []).map((effects) => Stats.fromDofusDbEffects(effects));
        return new ItemSet({
            id: raw.id,
            name: raw.name.fr,
            itemIds: raw.items.map((item) => item.id),
            bonusesByCount,
        });
    }
}

module.exports = ItemSet;
