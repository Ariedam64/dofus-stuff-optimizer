const { setImmediate: yieldToEventLoop } = require("timers/promises");
const MilpModelBuilder = require("./MilpModelBuilder");
const HighsSolver = require("./HighsSolver");
const CutBuilder = require("./CutBuilder");
const CandidateReducer = require("./CandidateReducer");
const DamageLinearizer = require("./DamageLinearizer");
const { SLOT } = require("../data/slots");

const MAX_ITERATIONS = 8;
const SELECTED_THRESHOLD = 0.5;

// Proposes stuffs fast: maximizes a linear estimate of the damage around the best known stuff on a reduced pool,
// rescoring each proposal exactly and re-linearizing around it until it stops improving.
class HeuristicSearch {
    #problem;
    #query;
    #evaluator;
    #nowFn;
    #linearizer;
    #reducer;

    // problem: { candidates, query, gameData, spellGroups, baseStats }, as for MilpModelBuilder.
    constructor({ problem, evaluator, nowFn }) {
        const { candidates, query, gameData, spellGroups, baseStats } = problem;
        this.#problem = problem;
        this.#query = query;
        this.#evaluator = evaluator;
        this.#nowFn = nowFn;
        const weapons = candidates.get(SLOT.WEAPON) ?? [];
        this.#linearizer = new DamageLinearizer({ query, spellGroups, baseStats, weapons });
        this.#reducer = new CandidateReducer({ candidates, getSet: (setId) => gameData.getSet(setId), query });
    }

    // Returns every valid stuff found, in order. Invalid proposals are appended to cuts.excludedStuffs.
    async run({ reference, cuts, deadlineMs }) {
        const found = [];
        let objective = reference
            ? this.#linearizer.linearizeEvaluation(reference)
            : this.#linearizer.linearizeNeutral();
        let keptItems = reference?.items ?? [];
        let bestScore = -Infinity;
        for (let iteration = 0; iteration < MAX_ITERATIONS && this.#nowFn() < deadlineMs; iteration++) {
            const items = await this.#propose(objective, keptItems, cuts, deadlineMs);
            if (!items) break;
            const evaluation = this.#evaluator.evaluate(items);
            if (!evaluation) {
                cuts.excludedStuffs.push(items);
                continue;
            }
            found.push(evaluation);
            if (evaluation.score <= bestScore) break;
            bestScore = evaluation.score;
            objective = this.#linearizer.linearizeEvaluation(evaluation);
            keptItems = evaluation.items;
            await yieldToEventLoop();
        }
        return found;
    }

    async #propose(objective, keptItems, cuts, deadlineMs) {
        const candidates = this.#reducer.reduce(objective, keptItems);
        const builder = new MilpModelBuilder({ ...this.#problem, candidates });
        const model = builder.build({ linearObjective: objective });
        const solver = await HighsSolver.create(model.lpText);
        try {
            const cutBuilder = new CutBuilder({ solver, itemModel: model.itemModel });
            for (const items of cuts.excludedStuffs) cutBuilder.excludeStuff(items);
            for (const items of cuts.diverseFrom) cutBuilder.addDiversityCut(items, this.#query.minDifferentItems);
            const result = solver.solve({ timeLimitMs: deadlineMs - this.#nowFn() });
            if (!result.hasSolution) return null;
            const { itemModel } = model;
            return itemModel.items.filter((item) => result.valueOf(itemModel.variableOf(item)) > SELECTED_THRESHOLD);
        } finally {
            solver.dispose();
        }
    }
}

module.exports = HeuristicSearch;
