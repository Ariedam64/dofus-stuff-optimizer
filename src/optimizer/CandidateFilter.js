const { CHARACTERISTIC } = require("../stats/characteristics");
const { findElement } = require("../stats/elements");
const { SLOT, SLOT_CAPACITIES } = require("../data/slots");
const CriterionEvaluator = require("../rules/CriterionEvaluator");
const Action = require("../damage/Action");
const parseCriterionAtoms = require("../utils/parseCriterionAtoms");
const { UNOBTAINABLE_CRITERION_CODES } = require("../config");

const NO_BONUS = 0;
const MONOTONE_OPERATOR = ">";
// A lower set bonus level never breaks "pk<n"; other pk operators would need a higher one.
const SET_BONUS_LEVEL_OPERATOR = "<";
const ALWAYS_LOCKED_CHARACTERISTICS = [CHARACTERISTIC.AP, CHARACTERISTIC.MP];
const BASE_RELEVANT_CHARACTERISTICS = [
    CHARACTERISTIC.POWER,
    CHARACTERISTIC.DAMAGE,
    CHARACTERISTIC.CRITICAL,
    CHARACTERISTIC.CRITICAL_DAMAGE,
    CHARACTERISTIC.SPELL_DAMAGE_PERCENT,
    CHARACTERISTIC.WEAPON_DAMAGE_PERCENT,
    CHARACTERISTIC.MELEE_DAMAGE_PERCENT,
    CHARACTERISTIC.RANGED_DAMAGE_PERCENT,
    CHARACTERISTIC.AP,
    CHARACTERISTIC.MP,
];

class CandidateFilter {
    #query;
    #gameData;
    #relevantCharacteristics;
    #marginalsBySetId = new Map();
    #unsupportedItems = [];
    #unobtainableItems = [];
    #trackedCharacteristics = [];
    #comparedIndexes = [];
    #lockedIndexes = [];
    #hasSetBonusLevelCriterion = false;

    constructor(query, gameData) {
        this.#query = query;
        this.#gameData = gameData;
        const element = findElement(query.elementKey);
        const resistances = Object.keys(query.minResistances).map((key) => findElement(key).resistance);
        this.#relevantCharacteristics = [
            ...new Set([element.characteristic, element.fixedDamage, ...BASE_RELEVANT_CHARACTERISTICS, ...resistances]),
        ];
    }

    relevantCharacteristics() {
        return [...this.#relevantCharacteristics];
    }

    get unsupportedItems() {
        return [...this.#unsupportedItems];
    }

    get unobtainableItems() {
        return [...this.#unobtainableItems];
    }

    buildCandidates(items) {
        const allowedItems = items.filter((item) => this.#isEligible(item));
        this.#unobtainableItems = allowedItems.filter((item) => this.#isUnobtainable(item));
        const obtainableItems = allowedItems.filter((item) => !this.#unobtainableItems.includes(item));
        this.#unsupportedItems = obtainableItems.filter((item) => this.#isUnsupported(item));
        const eligibleItems = obtainableItems.filter((item) => !this.#unsupportedItems.includes(item));
        this.#prepareTrackedCharacteristics(eligibleItems);
        const candidatesBySlot = new Map(Object.keys(SLOT_CAPACITIES).map((slot) => [slot, []]));
        for (const item of eligibleItems) candidatesBySlot.get(item.slot).push(this.#toEntry(item));
        const result = new Map();
        for (const [slot, entries] of candidatesBySlot) {
            result.set(slot, this.#pruneSlot(slot, entries));
        }
        return result;
    }

    #isUnobtainable(item) {
        if (this.#query.requiredItemIds.has(item.id)) return false;
        return parseCriterionAtoms(item.criterion).some(({ code }) => UNOBTAINABLE_CRITERION_CODES.includes(code));
    }

    #isUnsupported(item) {
        if (this.#query.requiredItemIds.has(item.id)) return false;
        for (const { code, operator } of parseCriterionAtoms(item.criterion)) {
            if (code === CriterionEvaluator.SET_BONUS_LEVEL_CODE && operator !== SET_BONUS_LEVEL_OPERATOR) return true;
            const characteristic = CriterionEvaluator.STAT_CODES[code];
            if (characteristic === undefined || ALWAYS_LOCKED_CHARACTERISTICS.includes(characteristic)) continue;
            if (operator !== MONOTONE_OPERATOR) return true;
        }
        return false;
    }

    #prepareTrackedCharacteristics(eligibleItems) {
        this.#marginalsBySetId = new Map();
        this.#hasSetBonusLevelCriterion = eligibleItems.some((item) => this.#hasSetBonusLevelAtom(item));
        const operatorsByCharacteristic = this.#collectCriterionOperators(eligibleItems);
        const locked = new Set(ALWAYS_LOCKED_CHARACTERISTICS);
        const monotone = new Set();
        for (const [characteristic, operators] of operatorsByCharacteristic) {
            const isMonotoneOnly = [...operators].every((operator) => operator === MONOTONE_OPERATOR);
            (isMonotoneOnly ? monotone : locked).add(characteristic);
        }
        this.#trackedCharacteristics = [...new Set([...this.#relevantCharacteristics, ...monotone, ...locked])];
        const indexOf = (characteristic) => this.#trackedCharacteristics.indexOf(characteristic);
        this.#lockedIndexes = [...locked].map(indexOf);
        this.#comparedIndexes = this.#trackedCharacteristics
            .map((characteristic, index) => index)
            .filter((index) => !this.#lockedIndexes.includes(index));
    }

    #hasSetBonusLevelAtom(item) {
        return parseCriterionAtoms(item.criterion).some(({ code }) => code === CriterionEvaluator.SET_BONUS_LEVEL_CODE);
    }

    #collectCriterionOperators(eligibleItems) {
        const operatorsByCharacteristic = new Map();
        for (const criterion of new Set(eligibleItems.map((item) => item.criterion))) {
            for (const { code, operator } of parseCriterionAtoms(criterion)) {
                const characteristic = CriterionEvaluator.STAT_CODES[code];
                if (characteristic === undefined) continue;
                if (!operatorsByCharacteristic.has(characteristic))
                    operatorsByCharacteristic.set(characteristic, new Set());
                operatorsByCharacteristic.get(characteristic).add(operator);
            }
        }
        return operatorsByCharacteristic;
    }

    #isEligible(item) {
        if (!Object.hasOwn(SLOT_CAPACITIES, item.slot)) return false;
        if (this.#query.requiredItemIds.has(item.id)) return true;
        if (this.#query.excludedItemIds.has(item.id)) return false;
        return item.level <= this.#query.level;
    }

    #toEntry(item) {
        const values = this.#trackedCharacteristics.map((id) => item.stats.get(id));
        const total = values.slice(0, this.#relevantCharacteristics.length).reduce((sum, value) => sum + value, 0);
        return { item, values, marginals: this.#findMarginals(item), total };
    }

    #findMarginals(item) {
        if (item.setId === null) return this.#emptyMarginals();
        if (!this.#marginalsBySetId.has(item.setId)) {
            this.#marginalsBySetId.set(item.setId, this.#computeSetMarginals(item));
        }
        return this.#marginalsBySetId.get(item.setId);
    }

    #emptyMarginals() {
        const zeros = this.#trackedCharacteristics.map(() => NO_BONUS);
        return { max: zeros, min: zeros };
    }

    #computeSetMarginals(item) {
        const set = this.#gameData.getSet(item.setId);
        if (!set) throw new Error(`Item ${item.id} (${item.name}) references missing set ${item.setId}`);
        const { maxMarginals, minMarginals } = set;
        return {
            max: this.#trackedCharacteristics.map((id) => maxMarginals.get(id)),
            min: this.#trackedCharacteristics.map((id) => minMarginals.get(id)),
        };
    }

    #pruneSlot(slot, entries) {
        const capacity = SLOT_CAPACITIES[slot];
        const kept = entries.filter(
            (entry) => !this.#isPrunable(slot, entry) || !this.#isDominated(entry, entries, capacity),
        );
        return kept.sort((first, second) => second.total - first.total).map((entry) => entry.item);
    }

    #isPrunable(slot, entry) {
        if (this.#query.requiredItemIds.has(entry.item.id)) return false;
        if (slot !== SLOT.WEAPON) return true;
        return Action.fromWeapon(entry.item, this.#query.elementKey) === null;
    }

    #isDominated(entry, entries, capacity) {
        let totalDominators = 0;
        for (const other of entries) {
            if (other !== entry && this.#dominates(other, entry)) totalDominators += 1;
            if (totalDominators >= capacity) return true;
        }
        return false;
    }

    #dominates(dominator, dominated) {
        const criterion = dominator.item.criterion;
        if (criterion !== "" && criterion !== dominated.item.criterion) return false;
        if (dominator.item.isPrysmaradite && !dominated.item.isPrysmaradite) return false;
        if (dominator.item.isTwoHanded && !dominated.item.isTwoHanded) return false;
        if (this.#hasSetBonusLevelCriterion && !this.#keepsSetCounts(dominator, dominated)) return false;
        if (!this.#hasInterchangeableLockedValues(dominator, dominated)) return false;
        return this.#isStrictlyBetterOnComparedValues(dominator, dominated);
    }

    // Swapping in an item without set, or from the same set, never raises a set count, hence never the set bonus level.
    #keepsSetCounts(dominator, dominated) {
        return dominator.item.setId === null || dominator.item.setId === dominated.item.setId;
    }

    #hasInterchangeableLockedValues(dominator, dominated) {
        const isSameSet = dominator.item.setId !== null && dominator.item.setId === dominated.item.setId;
        return this.#lockedIndexes.every((index) => {
            if (dominator.values[index] !== dominated.values[index]) return false;
            if (isSameSet) return true;
            return [dominator, dominated].every(
                (entry) => entry.marginals.min[index] === NO_BONUS && entry.marginals.max[index] === NO_BONUS,
            );
        });
    }

    #isStrictlyBetterOnComparedValues(dominator, dominated) {
        let isStrictlyBetter = false;
        for (const index of this.#comparedIndexes) {
            const worstCase = dominator.values[index] + dominator.marginals.min[index];
            const bestCase = dominated.values[index] + dominated.marginals.max[index];
            if (worstCase < bestCase) return false;
            if (worstCase > bestCase) isStrictlyBetter = true;
        }
        return isStrictlyBetter;
    }
}

module.exports = CandidateFilter;
