const { SLOT, SLOT_CAPACITIES, MAX_PRYSMARADITES } = require("../data/slots");

// Weapon first because it fixes the action groups; then the widest slots.
function compareSlotPlans(first, second) {
    if (first.slot === SLOT.WEAPON) return -1;
    if (second.slot === SLOT.WEAPON) return 1;
    return second.options.length - first.options.length;
}

function countPrysmaradites(items) {
    return items.filter((item) => item.isPrysmaradite).length;
}

class SearchSpace {
    #slotPlans = [];
    #requiredItems = [];

    constructor({ candidates, query }) {
        for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
            const items = candidates.get(slot) ?? [];
            const required = items.filter((item) => query.requiredItemIds.has(item.id));
            this.#requiredItems.push(...required);
            const options = items.filter((item) => !required.includes(item));
            const freeCapacity = Math.min(capacity - required.length, options.length);
            if (freeCapacity > 0) this.#slotPlans.push({ slot, options, freeCapacity });
        }
        this.#slotPlans.sort(compareSlotPlans);
    }

    get slotPlans() {
        return this.#slotPlans;
    }

    get requiredItems() {
        return [...this.#requiredItems];
    }

    canEquip(items, item) {
        if (items.some((equipped) => equipped.id === item.id)) return false;
        if (item.isPrysmaradite && countPrysmaradites(items) >= MAX_PRYSMARADITES) return false;
        if (item.slot === SLOT.SHIELD) return !this.isShieldBlocked(items);
        if (item.isTwoHanded) return !items.some((equipped) => equipped.slot === SLOT.SHIELD);
        return true;
    }

    isShieldBlocked(items) {
        return items.some((item) => item.isTwoHanded);
    }
}

module.exports = SearchSpace;
