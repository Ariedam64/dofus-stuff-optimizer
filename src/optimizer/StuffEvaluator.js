const Stats = require("../stats/Stats");
const Action = require("../damage/Action");
const PointAllocator = require("../character/PointAllocator");
const { CHARACTERISTIC } = require("../stats/characteristics");
const { findElement } = require("../stats/elements");
const { SLOT } = require("../data/slots");
const { EXO_VALUE, EXO_CHARACTERISTICS } = require("../data/exos");
const capCharacteristic = require("../utils/capCharacteristic");
const { BASE_AP, BONUS_AP_LEVEL, BASE_MP } = require("../config");

const BONUS_AP = 1;
const NO_BONUS_AP = 0;
const NO_SHORTFALL = 0;
const NO_SET_BONUS_LEVEL = 0;
const EXO_KEY_SEPARATOR = ":";
const NO_UNMET_CRITERIA = 0;
const MIN_BLOCKED_CRITERIA = 1;

function countExos(exos, characteristic) {
    return exos.filter((exo) => exo.characteristic === characteristic).length;
}

// Exos only add AP or MP, so combinations with the same AP and MP counts give identical final stats.
function keepDistinctEffects(combinations) {
    const seenKeys = new Set();
    return combinations
        .sort((first, second) => first.length - second.length)
        .filter((exos) => {
            const key = Object.keys(EXO_CHARACTERISTICS)
                .map((exoKey) => countExos(exos, exoKey))
                .join(EXO_KEY_SEPARATOR);
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
}

class StuffEvaluator {
    #query;
    #gameData;
    #criterionEvaluator;
    #turnPlanner;
    #baseStats;
    #spellActionGroups;
    #resistanceMinimums;
    #pointAllocator;

    constructor({ query, gameData, criterionEvaluator, turnPlanner }) {
        this.#query = query;
        this.#gameData = gameData;
        this.#criterionEvaluator = criterionEvaluator;
        this.#turnPlanner = turnPlanner;
        this.#baseStats = new Stats([
            [CHARACTERISTIC.AP, BASE_AP + (query.level >= BONUS_AP_LEVEL ? BONUS_AP : NO_BONUS_AP)],
            [CHARACTERISTIC.MP, BASE_MP],
        ]);
        this.#spellActionGroups = gameData
            .getSpellGroups(query.breed, query.level)
            .map((group) => group.map((spell) => Action.fromSpell(spell, query.elementKey)).filter(Boolean))
            .filter((group) => group.length > 0);
        this.#resistanceMinimums = Object.entries(query.minResistances).map(([elementKey, minimum]) => ({
            resistance: findElement(elementKey).resistance,
            minimum,
        }));
        this.#pointAllocator = new PointAllocator({
            level: query.level,
            useScrolls: query.useScrolls,
            elementCharacteristic: findElement(query.elementKey).characteristic,
        });
    }

    get baseStats() {
        return this.#baseStats.clone();
    }

    // Upper bound of what characteristic points and scrolls can add to any stuff.
    get optimisticPointStats() {
        return this.#pointAllocator.optimisticStats;
    }

    buildActionGroups(weapon) {
        const weaponAction = weapon ? Action.fromWeapon(weapon, this.#query.elementKey) : null;
        if (!weaponAction) return [...this.#spellActionGroups];
        return [...this.#spellActionGroups, [weaponAction]];
    }

    computeStats(items) {
        const stats = this.#baseStats.clone();
        for (const item of items) stats.addAll(item.stats);
        for (const [setId, wornCount] of this.#countWornItemsBySet(items)) {
            stats.addAll(this.#findSet(setId).bonusFor(wornCount));
        }
        return stats;
    }

    evaluate(items) {
        const stuffStats = this.computeStats(items);
        const actionGroups = this.buildActionGroups(items.find((item) => item.slot === SLOT.WEAPON) ?? null);
        const setBonusLevel = this.#computeSetBonusLevel(items);
        let bestEvaluation = null;
        for (const exos of this.#buildExoCombinations(items)) {
            const evaluation = this.#evaluateWithExos({ items, stuffStats, exos, actionGroups, setBonusLevel });
            if (evaluation && (!bestEvaluation || evaluation.score > bestEvaluation.score)) bestEvaluation = evaluation;
        }
        return bestEvaluation;
    }

    computeUpperBound(optimisticStats, actionGroups) {
        const availableAp = optimisticStats.get(CHARACTERISTIC.AP);
        const turn = this.#turnPlanner.planTurn(actionGroups, availableAp, optimisticStats, { isOptimistic: true });
        return turn.totalDamage;
    }

    meetsConstraints(stats) {
        return this.#computeShortfall(stats) === NO_SHORTFALL;
    }

    // Distance to validity used to guide local search: constraint shortfalls plus one per unmet criterion.
    measureViolation(items) {
        const stuffStats = this.computeStats(items);
        const setBonusLevel = this.#computeSetBonusLevel(items);
        let lowestViolation = Infinity;
        for (const exos of this.#buildExoCombinations(items)) {
            const stats = this.#applyExos(stuffStats, exos);
            const allocation = this.#pointAllocator.allocateMostCriteria(
                this.#buildAllocationRequest(items, stats, setBonusLevel),
            );
            this.#addPoints(stats, allocation);
            const context = this.#buildCriterionContext(stats, setBonusLevel);
            // Criteria that fit no allocation together must keep the stuff invalid even if each one is met alone.
            const blockedMinimum = allocation.isComplete ? NO_UNMET_CRITERIA : MIN_BLOCKED_CRITERIA;
            const unmetCount = Math.max(blockedMinimum, this.#countUnmetCriteria(items, context));
            lowestViolation = Math.min(lowestViolation, this.#computeShortfall(stats) + unmetCount);
        }
        return lowestViolation;
    }

    #evaluateWithExos({ items, stuffStats, exos, actionGroups, setBonusLevel }) {
        const stats = this.#applyExos(stuffStats, exos);
        // Points only raise base characteristics, which no constraint reads, so constraints are checked first.
        if (!this.meetsConstraints(stats)) return null;
        const allocation = this.#pointAllocator.allocate(this.#buildAllocationRequest(items, stats, setBonusLevel));
        if (!allocation) return null;
        this.#addPoints(stats, allocation);
        const context = this.#buildCriterionContext(stats, setBonusLevel);
        const { isMet, assumedCriteria } = this.#checkCriteria(items, context);
        if (!isMet) return null;
        const turn = this.#turnPlanner.planTurn(actionGroups, stats.get(CHARACTERISTIC.AP), stats);
        const { spentPoints, baseStats, scrollStats } = allocation;
        const pointsAllocation = { spentPoints, baseStats, scrollStats };
        return { score: turn.totalDamage, items, exos, stats, turn, assumedCriteria, pointsAllocation };
    }

    #buildAllocationRequest(items, stats, setBonusLevel) {
        return {
            itemStats: stats,
            criteria: items.filter((item) => item.criterion).map((item) => item.criterion),
            criterionContext: this.#buildCriterionContext(stats, setBonusLevel),
        };
    }

    #addPoints(stats, { baseStats, scrollStats }) {
        stats.addAll(baseStats);
        stats.addAll(scrollStats);
    }

    #applyExos(stuffStats, exos) {
        const stats = stuffStats.clone();
        for (const exo of exos) stats.add(EXO_CHARACTERISTICS[exo.characteristic], EXO_VALUE);
        return stats;
    }

    #computeShortfall(stats) {
        const query = this.#query;
        const minimums = [
            { value: capCharacteristic(CHARACTERISTIC.AP, stats.get(CHARACTERISTIC.AP)), minimum: query.minAp },
            { value: capCharacteristic(CHARACTERISTIC.MP, stats.get(CHARACTERISTIC.MP)), minimum: query.minMp },
            ...this.#resistanceMinimums.map(({ resistance, minimum }) => ({ value: stats.get(resistance), minimum })),
        ];
        if (query.minCriticalRate !== null) {
            minimums.push({ value: stats.get(CHARACTERISTIC.CRITICAL), minimum: query.minCriticalRate });
        }
        return minimums.reduce((total, { value, minimum }) => total + Math.max(NO_SHORTFALL, minimum - value), 0);
    }

    #countUnmetCriteria(items, context) {
        return items.filter(
            (item) => item.criterion && !this.#criterionEvaluator.evaluate(item.criterion, context).isMet,
        ).length;
    }

    #checkCriteria(items, context) {
        const assumedCriteria = [];
        for (const item of items) {
            if (!item.criterion) continue;
            const { isMet, assumedAtoms } = this.#criterionEvaluator.evaluate(item.criterion, context);
            if (!isMet) return { isMet: false, assumedCriteria };
            if (assumedAtoms.length > 0) assumedCriteria.push({ itemId: item.id, atoms: assumedAtoms });
        }
        return { isMet: true, assumedCriteria };
    }

    #buildCriterionContext(stats, setBonusLevel) {
        return { stats, level: this.#query.level, breedId: this.#query.breed.id, setBonusLevel };
    }

    // Highest count of items worn from one set, minus one; exos do not change it.
    #computeSetBonusLevel(items) {
        const wornCounts = [...this.#countWornItemsBySet(items).values()];
        return Math.max(NO_SET_BONUS_LEVEL, ...wornCounts.map((wornCount) => wornCount - 1));
    }

    #countWornItemsBySet(items) {
        const wornCountBySetId = new Map();
        for (const item of items) {
            if (item.setId === null) continue;
            wornCountBySetId.set(item.setId, (wornCountBySetId.get(item.setId) ?? 0) + 1);
        }
        return wornCountBySetId;
    }

    #findSet(setId) {
        const set = this.#gameData.getSet(setId);
        if (!set) throw new Error(`A worn item references missing set ${setId}`);
        return set;
    }

    #buildExoCombinations(items) {
        let combinations = [[]];
        for (const ring of items.filter((item) => item.slot === SLOT.RING)) {
            const ringExos = this.#listAllowedExos(ring).map((characteristic) => ({ itemId: ring.id, characteristic }));
            combinations = [...combinations, ...ringExos.flatMap((exo) => combinations.map((exos) => [...exos, exo]))];
        }
        return keepDistinctEffects(combinations);
    }

    #listAllowedExos(ring) {
        return Object.entries(EXO_CHARACTERISTICS)
            .filter(([exoKey, characteristicId]) => this.#query.allowsExo(exoKey) && ring.canTakeExo(characteristicId))
            .map(([exoKey]) => exoKey);
    }
}

module.exports = StuffEvaluator;
