const { SLOT, SLOT_CAPACITIES } = require("../data/slots");

const TOTAL_POSITIONS = Object.values(SLOT_CAPACITIES).reduce((total, capacity) => total + capacity, 0);

function findWeaponId(items) {
    return items.find((item) => item.slot === SLOT.WEAPON)?.id ?? null;
}

// Two stuffs are diverse when their weapons differ or when at least minDifferentItems of the 16 positions differ;
// an empty position matches an empty one, and multi-position slots (rings, dofus) are compared as sets.
class DiversityRule {
    static TOTAL_POSITIONS = TOTAL_POSITIONS;

    #minDifferentItems;

    constructor(minDifferentItems) {
        this.#minDifferentItems = minDifferentItems;
    }

    isDiverse(firstItems, secondItems) {
        if (findWeaponId(firstItems) !== findWeaponId(secondItems)) return true;
        return TOTAL_POSITIONS - this.#countOverlap(firstItems, secondItems) >= this.#minDifferentItems;
    }

    isDiverseFromAll(items, others) {
        return others.every((otherItems) => this.isDiverse(items, otherItems));
    }

    #countOverlap(firstItems, secondItems) {
        let overlap = 0;
        for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
            const firstIds = firstItems.filter((item) => item.slot === slot).map((item) => item.id);
            const secondIds = new Set(secondItems.filter((item) => item.slot === slot).map((item) => item.id));
            const sharedCount = firstIds.filter((id) => secondIds.has(id)).length;
            overlap += sharedCount + Math.min(capacity - firstIds.length, capacity - secondIds.size);
        }
        return overlap;
    }
}

module.exports = DiversityRule;
