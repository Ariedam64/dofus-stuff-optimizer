const { SLOT, SLOT_CAPACITIES, MAX_PRYSMARADITES } = require("../data/slots");

// The structural rules of a stuff that the exact evaluator does not check: candidate items only, slot capacities
// without duplicates, required items, two-handed weapon without shield, and the prysmaradite limit.
class StuffValidator {
    #candidateItems;
    #requiredItemIds;

    constructor({ candidates, query }) {
        this.#candidateItems = new Set([...candidates.values()].flat());
        this.#requiredItemIds = query.requiredItemIds;
    }

    isAllowed(items) {
        if (new Set(items).size !== items.length) return false;
        if (!items.every((item) => this.#candidateItems.has(item))) return false;
        const wornIds = new Set(items.map((item) => item.id));
        if (![...this.#requiredItemIds].every((id) => wornIds.has(id))) return false;
        if (items.filter((item) => item.isPrysmaradite).length > MAX_PRYSMARADITES) return false;
        const hasTwoHandedWeapon = items.some((item) => item.slot === SLOT.WEAPON && item.isTwoHanded);
        if (hasTwoHandedWeapon && items.some((item) => item.slot === SLOT.SHIELD)) return false;
        return Object.entries(SLOT_CAPACITIES).every(
            ([slot, capacity]) => items.filter((item) => item.slot === slot).length <= capacity,
        );
    }
}

module.exports = StuffValidator;
