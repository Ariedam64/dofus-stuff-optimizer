const QueryError = require("./QueryError");
const { SLOT, SLOT_CAPACITIES, MAX_PRYSMARADITES } = require("../data/slots");

const { CODE } = QueryError;

// Required items that cannot be worn together, or at all, make the query invalid before any search.
class RequiredItemsValidator {
    #items;

    constructor(items) {
        this.#items = items;
    }

    validate(query) {
        const required = [...query.requiredItemIds].map((id) => this.#findEquippable(id));
        for (const item of required) this.#checkLevel(item, query.level);
        this.#checkSlotCapacities(required);
        this.#checkPrysmaradites(required);
        this.#checkShield(required);
    }

    #findEquippable(itemId) {
        const item = this.#items.find((candidate) => candidate.id === itemId);
        if (item && Object.hasOwn(SLOT_CAPACITIES, item.slot)) return item;
        throw new QueryError(CODE.UNKNOWN_REQUIRED_ITEM, `Required item ${itemId} is unknown or not equippable`, {
            itemId,
        });
    }

    #checkLevel(item, level) {
        if (item.level <= level) return;
        throw new QueryError(
            CODE.REQUIRED_ITEM_ABOVE_LEVEL,
            `Required item ${item.name} (level ${item.level}) is above character level ${level}`,
            { itemName: item.name, itemLevel: item.level, level },
        );
    }

    #checkSlotCapacities(required) {
        for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
            const count = required.filter((item) => item.slot === slot).length;
            if (count <= capacity) continue;
            throw new QueryError(
                CODE.TOO_MANY_REQUIRED_ITEMS,
                `Too many required items for slot ${slot}: ${count} > ${capacity}`,
                { slot, count, capacity },
            );
        }
    }

    #checkPrysmaradites(required) {
        const count = required.filter((item) => item.isPrysmaradite).length;
        if (count <= MAX_PRYSMARADITES) return;
        throw new QueryError(
            CODE.TOO_MANY_REQUIRED_PRYSMARADITES,
            `Too many required prysmaradites: ${count} > ${MAX_PRYSMARADITES}`,
            { count, max: MAX_PRYSMARADITES },
        );
    }

    #checkShield(required) {
        const weapon = required.find((item) => item.isTwoHanded);
        const shield = required.find((item) => item.slot === SLOT.SHIELD);
        if (!weapon || !shield) return;
        throw new QueryError(
            CODE.REQUIRED_SHIELD_WITH_TWO_HANDED_WEAPON,
            `Required two-handed weapon ${weapon.name} cannot be worn with required shield ${shield.name}`,
            { weaponName: weapon.name, shieldName: shield.name },
        );
    }
}

module.exports = RequiredItemsValidator;
