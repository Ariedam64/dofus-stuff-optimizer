const WeaponGroup = require("./WeaponGroup");
const { SLOT } = require("../data/slots");

// A search that runs one job at a time is not split.
const SINGLE_JOB = 1;
// The last group takes the remaining weapons and the stuffs without a weapon.
const SHARED_GROUP_COUNT = 1;

// Splits a search into weapon groups that share no stuff: one group per promising weapon, each requiring its weapon,
// then one group with every other weapon and no weapon at all. Two stuffs of different groups wear different weapons,
// so they are always diverse and each group can run its diverse search alone.
class WeaponPartitioner {
    static SINGLE_JOB = SINGLE_JOB;

    #context;

    constructor(context) {
        this.#context = context;
    }

    // Most promising group first; maxGroupCount is the number of searches that can run at once.
    partition(maxGroupCount) {
        const weapons = this.#context.candidates.get(SLOT.WEAPON) ?? [];
        if (maxGroupCount <= SINGLE_JOB || weapons.length === 0 || this.#hasRequiredWeapon(weapons)) {
            return [WeaponGroup.ALL];
        }
        const ranked = this.#rankByPromise(weapons);
        const singleCount = Math.min(ranked.length, maxGroupCount - SHARED_GROUP_COUNT);
        const singleGroups = ranked
            .slice(0, singleCount)
            .map((weapon) => new WeaponGroup({ weaponIds: [weapon.id], isWeaponRequired: true }));
        const sharedGroup = new WeaponGroup({ weaponIds: ranked.slice(singleCount).map((weapon) => weapon.id) });
        return [...singleGroups, sharedGroup];
    }

    // A required weapon is in every valid stuff: the search cannot be split by weapon.
    #hasRequiredWeapon(weapons) {
        return weapons.some((weapon) => this.#context.query.requiredItemIds.has(weapon.id));
    }

    // The optimistic turn damage of the weapon alone, with the best points and scrolls.
    #rankByPromise(weapons) {
        const { evaluator } = this.#context;
        const optimisticPoints = evaluator.optimisticPointStats;
        const promises = new Map(
            weapons.map((weapon) => {
                const stats = evaluator.computeStats([weapon]);
                stats.addAll(optimisticPoints);
                return [weapon, evaluator.computeUpperBound(stats, evaluator.buildActionGroups(weapon))];
            }),
        );
        return [...weapons].sort((first, second) => promises.get(second) - promises.get(first));
    }
}

module.exports = WeaponPartitioner;
