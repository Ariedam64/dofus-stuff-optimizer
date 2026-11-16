const LocalSearch = require("./LocalSearch");
const SearchSpace = require("./SearchSpace");
const StuffRanking = require("./StuffRanking");
const StuffSolver = require("../solver/StuffSolver");
const { SLOT } = require("../data/slots");

const NO_STUFF = 0;
// The solver ends that prove no further diverse stuff exists.
const COMPLETE_END_REASONS = [StuffSolver.END_REASON.COUNT, StuffSolver.END_REASON.INFEASIBLE];

// One search on the solver side: a warm start (a local search), then one StuffSolver run. It yields item ids only;
// the caller rescores them with its own evaluator.
class SolverSession {
    #context;
    #gameData;
    #logger;
    #nowFn;
    #yieldedCount = NO_STUFF;
    #isComplete = false;

    constructor({ context, gameData, logger = console, nowFn = Date.now }) {
        this.#context = context;
        this.#gameData = gameData;
        this.#logger = logger;
        this.#nowFn = nowFn;
    }

    get outcome() {
        const isInfeasible = this.#isComplete && this.#yieldedCount === NO_STUFF;
        return { isComplete: this.#isComplete, isInfeasible };
    }

    // latestDeadlineMs: how long the search may run on for a first stuff when it has none at deadlineMs.
    async *run({ deadlineMs, latestDeadlineMs = deadlineMs, warmStartTimeMs }) {
        const warmStartDeadlineMs = Math.min(this.#nowFn() + warmStartTimeMs, deadlineMs);
        const warmStart = this.#runWarmStart(warmStartDeadlineMs).filter((items) => this.#isWearable(items));
        const { query, candidates, evaluator } = this.#context;
        const solver = new StuffSolver({ candidates, evaluator, query, gameData: this.#gameData, nowFn: this.#nowFn });
        try {
            for await (const found of solver.solveDiverse({ deadlineMs, latestDeadlineMs, warmStart })) {
                yield this.#emit(found);
            }
            this.#isComplete = COMPLETE_END_REASONS.includes(solver.endReason);
        } catch (error) {
            // The stuffs known before the failure are still valid; nothing is proven, so the search stays incomplete.
            this.#logger.error(`❌ Exact solver failed, keeping the unproven stuffs found so far: ${error.message}`);
            for (const found of solver.yieldKnownStuffs()) yield this.#emit(found);
        }
    }

    #emit({ evaluation, solverStatus, optimalityGapPercent, upperBound }) {
        this.#yieldedCount++;
        return { itemIds: evaluation.items.map((item) => item.id), solverStatus, optimalityGapPercent, upperBound };
    }

    #runWarmStart(deadlineMs) {
        const { query, candidates, evaluator } = this.#context;
        const ranking = new StuffRanking(query.resultCount);
        const searchSpace = new SearchSpace({ candidates, query });
        new LocalSearch({ searchSpace, evaluator, ranking, nowFn: this.#nowFn }).run(deadlineMs);
        return ranking.evaluations.map((evaluation) => evaluation.items);
    }

    // The solver only checks the slot rules: a weapon partition must not be seeded with a stuff without a weapon.
    #isWearable(items) {
        return !this.#context.query.isWeaponRequired || items.some((item) => item.slot === SLOT.WEAPON);
    }
}

module.exports = SolverSession;
