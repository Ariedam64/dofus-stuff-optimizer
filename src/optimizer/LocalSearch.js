const { SLOT } = require("../data/slots");

const NO_VIOLATION = 0;

// Lower violation first, then higher score: guides infeasible stuffs towards validity.
function isBetter(candidate, reference) {
    if (candidate.violation !== reference.violation) return candidate.violation < reference.violation;
    return candidate.score > reference.score;
}

class LocalSearch {
    #searchSpace;
    #evaluator;
    #ranking;
    #nowFn;

    constructor({ searchSpace, evaluator, ranking, nowFn }) {
        this.#searchSpace = searchSpace;
        this.#evaluator = evaluator;
        this.#ranking = ranking;
        this.#nowFn = nowFn;
    }

    run(deadlineMs) {
        let current = this.#fillGreedily(deadlineMs);
        let isImproved = true;
        while (isImproved) {
            isImproved = false;
            for (const plan of this.#searchSpace.slotPlans) {
                for (let position = 0; position < plan.freeCapacity; position++) {
                    if (this.#nowFn() >= deadlineMs) return current;
                    const better = this.#findBestReplacement(current, plan, position);
                    if (!better) continue;
                    current = better;
                    isImproved = true;
                }
            }
        }
        return current;
    }

    #fillGreedily(deadlineMs) {
        let current = this.#measure(new Map());
        for (const plan of this.#searchSpace.slotPlans) {
            for (let position = 0; position < plan.freeCapacity; position++) {
                if (this.#nowFn() >= deadlineMs) return current;
                const better = this.#findBestReplacement(current, plan, position);
                if (!better) break;
                current = better;
            }
        }
        return current;
    }

    #findBestReplacement(current, plan, position) {
        const slotPicks = current.picksBySlot.get(plan.slot) ?? [];
        if (position > slotPicks.length) return null;
        let best = current;
        if (position < slotPicks.length)
            best = this.#keepBetter(best, this.#tryPick(current, plan.slot, position, null));
        for (const option of plan.options) {
            best = this.#keepBetter(best, this.#tryPick(current, plan.slot, position, option));
        }
        return best === current ? null : best;
    }

    #keepBetter(best, trial) {
        return trial && isBetter(trial, best) ? trial : best;
    }

    // Replaces the pick at this position (or removes it when option is null); a two-handed weapon drops the shield.
    #tryPick(current, slot, position, option) {
        const picksBySlot = new Map(current.picksBySlot);
        const slotPicks = [...(picksBySlot.get(slot) ?? [])];
        slotPicks.splice(position, 1);
        picksBySlot.set(slot, slotPicks);
        if (option?.isTwoHanded) picksBySlot.set(SLOT.SHIELD, []);
        if (!option) return this.#measure(picksBySlot);
        if (!this.#searchSpace.canEquip(this.#collectItems(picksBySlot), option)) return null;
        slotPicks.splice(position, 0, option);
        return this.#measure(picksBySlot);
    }

    #collectItems(picksBySlot) {
        return [...this.#searchSpace.requiredItems, ...[...picksBySlot.values()].flat()];
    }

    #measure(picksBySlot) {
        const items = this.#collectItems(picksBySlot);
        const evaluation = this.#evaluator.evaluate(items);
        if (evaluation) {
            this.#ranking.offer(evaluation);
            return { picksBySlot, items, violation: NO_VIOLATION, score: evaluation.score };
        }
        const weapon = items.find((item) => item.slot === SLOT.WEAPON) ?? null;
        const actionGroups = this.#evaluator.buildActionGroups(weapon);
        const optimisticStats = this.#evaluator.computeStats(items);
        optimisticStats.addAll(this.#evaluator.optimisticPointStats);
        const score = this.#evaluator.computeUpperBound(optimisticStats, actionGroups);
        return { picksBySlot, items, violation: this.#evaluator.measureViolation(items), score };
    }
}

module.exports = LocalSearch;
