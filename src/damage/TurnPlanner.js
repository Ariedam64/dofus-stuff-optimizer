const capCharacteristic = require("../utils/capCharacteristic");
const { CHARACTERISTIC } = require("../stats/characteristics");

const UNREACHABLE = -1;
const NO_ACTION = -1;

class TurnPlanner {
    #damageCalculator;

    constructor(damageCalculator) {
        this.#damageCalculator = damageCalculator;
    }

    // availableAp is the raw AP total; the turn only uses AP up to the game cap.
    // isOptimistic plans with upper-bound damage per cast, for search bounds.
    planTurn(actionGroups, availableAp, stats, { isOptimistic = false } = {}) {
        const usableAp = capCharacteristic(CHARACTERISTIC.AP, availableAp);
        const budget = Number.isFinite(usableAp) ? Math.max(0, Math.floor(usableAp)) : 0;
        const groups = this.#buildGroups(actionGroups, stats, budget, isOptimistic);
        if (budget === 0 || groups.length === 0) return { totalDamage: 0, casts: [] };

        const width = budget + 1;
        const actionChoices = new Int16Array(groups.length * width).fill(NO_ACTION);
        const countChoices = new Int16Array(groups.length * width);
        const finalRow = this.#fillTable(groups, width, actionChoices, countChoices);
        return this.#rebuildPlan(groups, width, finalRow, actionChoices, countChoices);
    }

    #buildGroups(actionGroups, stats, budget, isOptimistic) {
        const groups = [];
        for (const group of actionGroups) {
            const entries = [];
            for (const action of group) {
                if (action.apCost <= 0) continue;
                const damagePerCast = isOptimistic
                    ? this.#damageCalculator.computeOptimisticDamage(action, stats)
                    : this.#damageCalculator.computeExpectedDamage(action, stats);
                const maxCount = Math.min(action.maxCasts, Math.floor(budget / action.apCost));
                if (maxCount >= 1) entries.push({ action, damagePerCast, maxCount });
            }
            if (entries.length > 0) groups.push(entries);
        }
        return groups;
    }

    #fillTable(groups, width, actionChoices, countChoices) {
        let previousRow = new Float64Array(width).fill(UNREACHABLE);
        previousRow[0] = 0;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const row = Float64Array.from(previousRow);
            const offset = groupIndex * width;
            this.#relaxGroup(groups[groupIndex], previousRow, row, offset, actionChoices, countChoices);
            previousRow = row;
        }
        return previousRow;
    }

    #relaxGroup(entries, previousRow, row, offset, actionChoices, countChoices) {
        const width = previousRow.length;
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
            const { action, damagePerCast, maxCount } = entries[entryIndex];
            for (let spent = 0; spent < width; spent++) {
                if (previousRow[spent] === UNREACHABLE) continue;
                const limit = Math.min(maxCount, Math.floor((width - 1 - spent) / action.apCost));
                for (let count = 1; count <= limit; count++) {
                    const target = spent + count * action.apCost;
                    const damage = previousRow[spent] + count * damagePerCast;
                    if (damage <= row[target]) continue;
                    row[target] = damage;
                    actionChoices[offset + target] = entryIndex;
                    countChoices[offset + target] = count;
                }
            }
        }
    }

    #rebuildPlan(groups, width, finalRow, actionChoices, countChoices) {
        let bestSpent = 0;
        for (let spent = 1; spent < width; spent++) {
            if (finalRow[spent] > finalRow[bestSpent]) bestSpent = spent;
        }

        const casts = [];
        let spent = bestSpent;
        for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
            const entryIndex = actionChoices[groupIndex * width + spent];
            if (entryIndex === NO_ACTION) continue;
            const { action, damagePerCast } = groups[groupIndex][entryIndex];
            const count = countChoices[groupIndex * width + spent];
            casts.push({ name: action.name, kind: action.kind, count, damagePerCast });
            spent -= count * action.apCost;
        }
        return { totalDamage: finalRow[bestSpent], casts: casts.reverse() };
    }
}

module.exports = TurnPlanner;
