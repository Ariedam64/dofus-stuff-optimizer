const { SLOT } = require("../data/slots");

const ALL_WEAPONS = null;

// The weapons one search partition may wear. weaponIds null keeps every candidate weapon and an empty list allows
// none; isWeaponRequired leaves out the stuffs without a weapon, so that groups never share a stuff.
class WeaponGroup {
    static ALL = new WeaponGroup();

    #weaponIds;
    #isWeaponRequired;

    constructor({ weaponIds = ALL_WEAPONS, isWeaponRequired = false } = {}) {
        if (isWeaponRequired && weaponIds?.length === 0) throw new Error("A weapon group cannot require no weapon");
        this.#weaponIds = weaponIds;
        this.#isWeaponRequired = isWeaponRequired;
    }

    static fromJob({ weaponIds, isWeaponRequired }) {
        return new WeaponGroup({ weaponIds: weaponIds ?? ALL_WEAPONS, isWeaponRequired });
    }

    get weaponIds() {
        return this.#weaponIds;
    }

    get isWeaponRequired() {
        return this.#isWeaponRequired;
    }

    toJobFields() {
        return { weaponIds: this.#weaponIds, isWeaponRequired: this.#isWeaponRequired };
    }

    // What SolverSession needs from a search context, limited to this group.
    restrict({ query, candidates, evaluator }) {
        const groupQuery = this.#isWeaponRequired ? query.withRequiredWeapon() : query;
        if (this.#weaponIds === ALL_WEAPONS) return { query: groupQuery, candidates, evaluator };
        const allowedIds = new Set(this.#weaponIds);
        const weapons = (candidates.get(SLOT.WEAPON) ?? []).filter((weapon) => allowedIds.has(weapon.id));
        return { query: groupQuery, candidates: new Map(candidates).set(SLOT.WEAPON, weapons), evaluator };
    }
}

module.exports = WeaponGroup;
