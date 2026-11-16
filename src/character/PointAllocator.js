const Stats = require("../stats/Stats");
const CriterionEvaluator = require("../rules/CriterionEvaluator");
const { CHARACTERISTIC } = require("../stats/characteristics");
const {
    CHARACTERISTIC_POINTS_PER_LEVEL,
    SCROLL_VALUE,
    POINT_COST_TIERS,
    VITALITY_POINT_COST,
    WISDOM_POINT_COST,
} = require("../config");

const FIRST_LEVEL = 1;
const NO_POINTS = 0;
// The characteristics bought with points and raised by scrolls, in the page order.
const POINT_CHARACTERISTICS = Object.freeze([
    CHARACTERISTIC.VITALITY,
    CHARACTERISTIC.WISDOM,
    CHARACTERISTIC.STRENGTH,
    CHARACTERISTIC.INTELLIGENCE,
    CHARACTERISTIC.CHANCE,
    CHARACTERISTIC.AGILITY,
]);
const FLAT_POINT_COSTS = new Map([
    [CHARACTERISTIC.VITALITY, VITALITY_POINT_COST],
    [CHARACTERISTIC.WISDOM, WISDOM_POINT_COST],
]);
const TIERED_COST_SEGMENTS = POINT_COST_TIERS.map((tier, index) => ({
    from: tier.from,
    to: POINT_COST_TIERS[index + 1]?.from ?? Infinity,
    cost: tier.cost,
}));
const NUMERIC_VALUE_PATTERN = /^-?\d+$/;
// Operators that points can satisfy, as bounds on the total (items + scrolls + base) value.
const BOUND_BUILDERS = {
    ">": (value) => ({ min: value + 1, max: Infinity }),
    "<": (value) => ({ min: -Infinity, max: value - 1 }),
    "=": (value) => ({ min: value, max: value }),
};
const UNBOUNDED = Object.freeze({ min: -Infinity, max: Infinity });

function findPointCharacteristic(atom) {
    const characteristic = CriterionEvaluator.STAT_CODES[atom.code];
    if (!POINT_CHARACTERISTICS.includes(characteristic) || !Object.hasOwn(BOUND_BUILDERS, atom.operator)) return null;
    if (!NUMERIC_VALUE_PATTERN.test(atom.value)) {
        throw new Error(`Invalid criterion atom "${atom.text}": non-numeric value for a characteristic`);
    }
    return characteristic;
}

function mergeBounds(first, second) {
    const merged = new Map(first);
    for (const [characteristic, bound] of second) {
        const current = merged.get(characteristic) ?? UNBOUNDED;
        merged.set(characteristic, { min: Math.max(current.min, bound.min), max: Math.min(current.max, bound.max) });
    }
    return merged;
}

function isBetterPlan(candidate, reference) {
    if (!reference) return true;
    if (candidate.elementBase !== reference.elementBase) return candidate.elementBase > reference.elementBase;
    return candidate.otherCost < reference.otherCost;
}

// Picks the base characteristics that meet the item criteria while keeping the most points for the element
// characteristic, the only one that raises single-element damage.
class PointAllocator {
    static POINT_CHARACTERISTICS = POINT_CHARACTERISTICS;

    #availablePoints;
    #scrollStats;
    #elementCharacteristic;
    #criterionEvaluator = new CriterionEvaluator();
    #branchesByCriterion = new Map();

    constructor({ level, useScrolls, elementCharacteristic }) {
        this.#availablePoints = CHARACTERISTIC_POINTS_PER_LEVEL * (level - FIRST_LEVEL);
        this.#elementCharacteristic = elementCharacteristic;
        const scrollEntries = POINT_CHARACTERISTICS.map((characteristic) => [characteristic, SCROLL_VALUE]);
        this.#scrollStats = new Stats(useScrolls ? scrollEntries : []);
    }

    get availablePoints() {
        return this.#availablePoints;
    }

    get scrollStats() {
        return this.#scrollStats.clone();
    }

    // Highest stats any allocation can give: every point on the element characteristic, plus scrolls.
    get optimisticStats() {
        const stats = this.#scrollStats.clone();
        stats.add(this.#elementCharacteristic, this.findMaxBase(this.#elementCharacteristic, this.#availablePoints));
        return stats;
    }

    costOf(characteristic, fromBase, toBase) {
        return this.listCostSegments(characteristic).reduce((total, segment) => {
            const raisedCount = Math.min(segment.to, toBase) - Math.max(segment.from, fromBase);
            return total + Math.max(NO_POINTS, raisedCount) * segment.cost;
        }, NO_POINTS);
    }

    allocate({ itemStats, criteria, criterionContext = {} }) {
        const fixedStats = itemStats.clone();
        fixedStats.addAll(this.#scrollStats);
        const context = { ...criterionContext, stats: fixedStats };
        const optionsByCriterion = [...new Set(criteria)].map((criterion) => this.#listOptions(criterion, context));
        if (optionsByCriterion.some((options) => options.length === 0)) return null;
        optionsByCriterion.sort((first, second) => first.length - second.length);
        const plan = this.#findBestPlan(optionsByCriterion, fixedStats);
        return plan ? this.#buildAllocation(plan) : null;
    }

    // When the criteria cannot all be met, keeps them one by one as long as they still fit together.
    allocateMostCriteria({ itemStats, criteria, criterionContext }) {
        const allocation = this.allocate({ itemStats, criteria, criterionContext });
        if (allocation) return { ...allocation, isComplete: true };
        const keptCriteria = [];
        for (const criterion of criteria) {
            const allocationWithCriterion = this.allocate({
                itemStats,
                criteria: [...keptCriteria, criterion],
                criterionContext,
            });
            if (allocationWithCriterion) keptCriteria.push(criterion);
        }
        return { ...this.allocate({ itemStats, criteria: keptCriteria, criterionContext }), isComplete: false };
    }

    // Branches whose other atoms hold, as bounds on the base characteristics.
    #listOptions(criterion, context) {
        return this.#findBranches(criterion)
            .filter(({ otherAtomTexts }) =>
                otherAtomTexts.every((atomText) => this.#criterionEvaluator.evaluate(atomText, context).isMet),
            )
            .map(({ bounds }) => bounds);
    }

    #findBranches(criterion) {
        if (!this.#branchesByCriterion.has(criterion)) {
            const branches = this.#criterionEvaluator.listBranches(criterion).map((atoms) => this.#splitBranch(atoms));
            this.#branchesByCriterion.set(criterion, branches);
        }
        return this.#branchesByCriterion.get(criterion);
    }

    #splitBranch(atoms) {
        let bounds = new Map();
        const otherAtomTexts = [];
        for (const atom of atoms) {
            const characteristic = findPointCharacteristic(atom);
            if (characteristic === null) {
                otherAtomTexts.push(atom.text);
                continue;
            }
            bounds = mergeBounds(bounds, [[characteristic, BOUND_BUILDERS[atom.operator](Number(atom.value))]]);
        }
        return { bounds, otherAtomTexts };
    }

    // Depth-first over one branch per criterion; adding bounds never improves a plan, so worse partial plans are cut.
    #findBestPlan(optionsByCriterion, fixedStats) {
        let bestPlan = null;
        const visit = (criterionIndex, bounds) => {
            const plan = this.#planFor(bounds, fixedStats);
            if (!plan || !isBetterPlan(plan, bestPlan)) return;
            if (criterionIndex === optionsByCriterion.length) {
                bestPlan = plan;
                return;
            }
            for (const option of optionsByCriterion[criterionIndex])
                visit(criterionIndex + 1, mergeBounds(bounds, option));
        };
        visit(0, new Map());
        return bestPlan;
    }

    #planFor(bounds, fixedStats) {
        const baseByCharacteristic = new Map();
        let otherCost = NO_POINTS;
        let elementRange = null;
        for (const characteristic of POINT_CHARACTERISTICS) {
            const { min, max } = bounds.get(characteristic) ?? UNBOUNDED;
            const fixedValue = fixedStats.get(characteristic);
            const range = { min: Math.max(NO_POINTS, min - fixedValue), max: max - fixedValue };
            if (range.max < range.min) return null;
            if (characteristic === this.#elementCharacteristic) {
                elementRange = range;
                continue;
            }
            baseByCharacteristic.set(characteristic, range.min);
            otherCost += this.costOf(characteristic, NO_POINTS, range.min);
        }
        const elementBudget = this.#availablePoints - otherCost;
        if (elementBudget < NO_POINTS) return null;
        const elementBase = Math.min(elementRange.max, this.findMaxBase(this.#elementCharacteristic, elementBudget));
        if (elementBase < elementRange.min) return null;
        baseByCharacteristic.set(this.#elementCharacteristic, elementBase);
        return { baseByCharacteristic, elementBase, otherCost };
    }

    #buildAllocation({ baseByCharacteristic }) {
        const spentPoints = {};
        const baseStats = new Stats();
        for (const characteristic of POINT_CHARACTERISTICS) {
            const base = baseByCharacteristic.get(characteristic);
            spentPoints[characteristic] = this.costOf(characteristic, NO_POINTS, base);
            if (base > NO_POINTS) baseStats.add(characteristic, base);
        }
        return { baseStats, spentPoints, scrollStats: this.#scrollStats.clone() };
    }

    // Highest base value these points can buy for one characteristic.
    findMaxBase(characteristic, points) {
        let base = NO_POINTS;
        let remainingPoints = points;
        for (const segment of this.listCostSegments(characteristic)) {
            const segmentLength = segment.to - segment.from;
            const raisedCount = Math.min(segmentLength, Math.floor(remainingPoints / segment.cost));
            base += raisedCount;
            remainingPoints -= raisedCount * segment.cost;
            if (raisedCount < segmentLength) break;
        }
        return base;
    }

    // Cost per point of each base range: [{ from, to, cost }].
    listCostSegments(characteristic) {
        if (!FLAT_POINT_COSTS.has(characteristic)) return TIERED_COST_SEGMENTS;
        return [{ from: NO_POINTS, to: Infinity, cost: FLAT_POINT_COSTS.get(characteristic) }];
    }
}

module.exports = PointAllocator;
