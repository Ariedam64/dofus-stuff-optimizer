const { setImmediate: yieldToEventLoop } = require("timers/promises");
const MilpModelBuilder = require("./MilpModelBuilder");
const BoundTightener = require("./BoundTightener");
const HighsSolver = require("./HighsSolver");
const CutBuilder = require("./CutBuilder");
const DiversityRule = require("./DiversityRule");
const HeuristicSearch = require("./HeuristicSearch");
const StuffValidator = require("./StuffValidator");
const Optimality = require("./Optimality");
const { IS_DEBUG, SOLVER_DEADLINE_MARGIN_MS, MAX_BOUND_TIGHTENING_MS } = require("../config");

const { SOLVER_STATUS, isClearlyBelow } = Optimality;
// Why solveDiverse stopped: only COUNT and INFEASIBLE prove that no further diverse stuff was missed.
const END_REASON = Object.freeze({ COUNT: "count", INFEASIBLE: "infeasible", DEADLINE: "deadline" });
const SELECTED_THRESHOLD = 0.5;
const SELECTED = 1;
const NOT_SELECTED = 0;
// Shares of each stuff's time slice: the fast heuristic first, then the exact model (bound, proof, improvement).
// Time left unused by either phase goes to the next stuffs.
const HEURISTIC_SHARE = 0.75;
const EXACT_SHARE = 0.25;
// Share of the whole search the initial LP relaxation (first upper bound) may take.
const RELAXATION_SHARE = 0.2;
// Share of the whole search for the LP bound tightening of the stats before the exact model is built.
const BOUND_TIGHTENING_SHARE = 0.05;

function logDebug(message) {
    if (IS_DEBUG) console.error(`🔍 ${message}`);
}

// Streams diverse stuffs. Each one is the best stuff found under the diversity cuts of the previous ones, always
// rescored by the exact evaluator; it is "optimal" only when its exact score reaches the upper bound proven by
// HiGHS on the exact model, otherwise the remaining gap is reported. Each stuff's time slice goes to the heuristic,
// then to the exact model. Skip path: once an exact phase ends on its time limit without beating the heuristic, the
// later stuffs skip it and settle on the bound known so far, until a stuff is proven optimal again. On large models
// the exact phase rarely helps, so its time goes to the heuristic. Only a proven infeasibility or the deadline
// ends the search before resultCount stuffs; a search without any stuff at its deadline looks for a first one until
// latestDeadlineMs. Each yield is { evaluation, solverStatus, optimalityGapPercent,
// upperBound }, upperBound being the bound valid for every stuff not yielded before it, or null when none is known.
// One StuffSolver runs one search.
class StuffSolver {
    static SOLVER_STATUS = SOLVER_STATUS;
    static END_REASON = END_REASON;

    #problem;
    #evaluator;
    #query;
    #nowFn;
    #diversityRule;
    #validator;
    #heuristic;
    #search = null;
    #endReason = null;

    constructor({ candidates, evaluator, query, gameData, nowFn = Date.now }) {
        this.#problem = {
            candidates,
            query,
            gameData,
            spellGroups: evaluator.buildActionGroups(null),
            baseStats: evaluator.baseStats,
        };
        this.#evaluator = evaluator;
        this.#query = query;
        this.#nowFn = nowFn;
        this.#diversityRule = new DiversityRule(query.minDifferentItems);
        this.#validator = new StuffValidator({ candidates, query });
        this.#heuristic = new HeuristicSearch({ problem: this.#problem, evaluator, nowFn });
    }

    // null until solveDiverse ends by itself: a search that threw or was abandoned has no end reason.
    get endReason() {
        return this.#endReason;
    }

    async *solveDiverse({ deadlineMs, latestDeadlineMs = deadlineMs, warmStart = [] }) {
        const search = this.#createSearch({ deadlineMs, latestDeadlineMs }, warmStart);
        this.#search = search;
        if (this.#nowFn() >= this.#findEndMs(search)) {
            yield* this.#yieldPoolFallbacks(search);
            this.#endReason = END_REASON.DEADLINE;
            return;
        }
        const exact = await this.#createExactSolver(search);
        try {
            this.#endReason = yield* this.#solveAll(exact, search);
        } finally {
            exact.solver.dispose();
        }
    }

    // The best stuffs known so far (warm start and stuffs found), diverse from the yielded ones and never proven:
    // what is left to show when the exact search fails.
    *yieldKnownStuffs() {
        if (this.#search) yield* this.#yieldPoolFallbacks(this.#search);
    }

    async *#solveAll(exact, search) {
        if (await this.#isRelaxationInfeasible(exact.model, search)) return END_REASON.INFEASIBLE;
        while (search.yieldedItems.length < this.#query.resultCount) {
            const found = await this.#findNext(exact, search);
            if (found === END_REASON.INFEASIBLE || found === END_REASON.DEADLINE) return found;
            yield found;
            search.yieldedItems.push(found.evaluation.items);
            search.cuts.diverseFrom.push(found.evaluation.items);
            exact.cutBuilder.addDiversityCut(found.evaluation.items, this.#query.minDifferentItems);
            // A proven stuff shows that the exact model can be solved within a share, and the diversity cut has
            // just changed it: the next stuff tries its exact phase again.
            if (found.solverStatus === SOLVER_STATUS.OPTIMAL) search.isExactPhaseUseful = true;
            await yieldToEventLoop();
        }
        return END_REASON.COUNT;
    }

    #createSearch({ deadlineMs, latestDeadlineMs }, warmStart) {
        const pool = warmStart
            .filter((items) => this.#validator.isAllowed(items))
            .map((items) => this.#evaluator.evaluate(items))
            .filter(Boolean)
            .sort((first, second) => second.score - first.score);
        return {
            deadlineMs: deadlineMs - SOLVER_DEADLINE_MARGIN_MS,
            latestDeadlineMs: Math.max(deadlineMs, latestDeadlineMs) - SOLVER_DEADLINE_MARGIN_MS,
            pool,
            yieldedItems: [],
            cuts: { excludedStuffs: [], diverseFrom: [] },
            appliedExclusionCount: 0,
            upperBound: Infinity,
            // Lowered for good once an exact score beats the model: its upper bound then proves nothing.
            isModelTrusted: true,
            isExactPhaseUseful: true,
        };
    }

    async #createExactSolver(search) {
        const tighteningMs = Math.min(
            (search.deadlineMs - this.#nowFn()) * BOUND_TIGHTENING_SHARE,
            MAX_BOUND_TIGHTENING_MS,
        );
        const tightener = new BoundTightener({ problem: this.#problem, nowFn: this.#nowFn });
        const statBounds = await tightener.tighten({ timeLimitMs: tighteningMs });
        const model = new MilpModelBuilder({ ...this.#problem, statBounds }).build();
        logDebug(`Exact MILP built (${model.lpText.length} characters, relaxed criteria: ${model.hasRelaxedCriteria})`);
        const solver = await HighsSolver.create(model.lpText);
        const cutBuilder = new CutBuilder({
            solver,
            itemModel: model.itemModel,
            damageVariable: MilpModelBuilder.DAMAGE_VARIABLE,
            damageUpper: model.damageUpper,
        });
        return { model, solver, cutBuilder };
    }

    // The LP relaxation gives the first upper bound, valid for every stuff; if it is infeasible, so is the search.
    async #isRelaxationInfeasible(model, search) {
        const relaxation = await HighsSolver.create(model.relaxedLpText);
        try {
            const timeLimitMs = (search.deadlineMs - this.#nowFn()) * RELAXATION_SHARE;
            const result = relaxation.solve({ timeLimitMs });
            logDebug(`LP relaxation ${result.status}: ${result.objective}`);
            if (result.status === HighsSolver.STATUS.OPTIMAL) search.upperBound = result.objective;
            return result.status === HighsSolver.STATUS.INFEASIBLE;
        } finally {
            relaxation.dispose();
        }
    }

    *#yieldPoolFallbacks(search) {
        for (const evaluation of search.pool) {
            if (search.yieldedItems.length >= this.#query.resultCount) return;
            if (!this.#diversityRule.isDiverseFromAll(evaluation.items, search.yieldedItems)) continue;
            search.yieldedItems.push(evaluation.items);
            yield { evaluation, ...Optimality.describe(evaluation.score, null), upperBound: null };
        }
    }

    #findBestDiverse(search) {
        return search.pool.find((evaluation) =>
            this.#diversityRule.isDiverseFromAll(evaluation.items, search.yieldedItems),
        );
    }

    #addToPool(search, evaluations) {
        search.pool.push(...evaluations);
        search.pool.sort((first, second) => second.score - first.score);
    }

    async #findNext(exact, search) {
        const remainingCount = this.#query.resultCount - search.yieldedItems.length;
        const sliceMs = Math.max(0, (search.deadlineMs - this.#nowFn()) / remainingCount);
        if (sliceMs > 0) {
            const found = await this.#heuristic.run({
                reference: search.pool[0] ?? null,
                cuts: search.cuts,
                deadlineMs: this.#nowFn() + sliceMs * HEURISTIC_SHARE,
            });
            logDebug(`Heuristic found ${found.map((evaluation) => evaluation.score.toFixed(1)).join(", ")}`);
            this.#addToPool(search, found);
        }
        const canSkipExactPhase = !search.isExactPhaseUseful && this.#findBestDiverse(search);
        if (canSkipExactPhase) return this.#settle(search);
        return this.#solveExact(exact, search, this.#nowFn() + sliceMs * EXACT_SHARE);
    }

    // Solves until the solution's exact score matches the model, refining the model with cuts otherwise. Without
    // any diverse stuff known, it keeps solving past its slice: only infeasibility or the end of the search stops it,
    // and past the deadline the first solution does. Returns the next stuff, or the END_REASON that stops the search.
    #solveExact(exact, search, sliceEndMs) {
        for (;;) {
            this.#applyExclusions(exact, search);
            const hasCandidate = this.#findBestDiverse(search) !== undefined;
            const endMs = hasCandidate ? Math.min(sliceEndMs, search.deadlineMs) : this.#findEndMs(search);
            const now = this.#nowFn();
            if (endMs <= now) return this.#settle(search) ?? END_REASON.DEADLINE;
            const start = this.#buildStart(exact.model.itemModel, search);
            const stopAtSolutionAfterMs = search.deadlineMs - now;
            const result = exact.solver.solve({ timeLimitMs: endMs - now, start, stopAtSolutionAfterMs });
            logDebug(`HiGHS ${result.status}: objective ${result.objective}, bound ${result.dualBound}`);
            if (result.status === HighsSolver.STATUS.INFEASIBLE) return END_REASON.INFEASIBLE;
            search.upperBound = Math.min(search.upperBound, result.dualBound);
            if (!result.hasSolution) continue;
            const evaluation = this.#evaluateSolution(exact, search, result);
            if (!evaluation) continue;
            // Only a proven optimum is tight on the damage variable; an incumbent may leave it below its maximum.
            const isProvenOptimum = result.status === HighsSolver.STATUS.OPTIMAL;
            if (isProvenOptimum && isClearlyBelow(result.objective, evaluation.score)) {
                this.#distrustModel(search, evaluation);
            }
            if (!isClearlyBelow(evaluation.score, result.objective)) return this.#settle(search) ?? END_REASON.DEADLINE;
            exact.cutBuilder.boundStuff(evaluation.items, evaluation.score);
        }
    }

    // A search without any stuff yet may run until the latest deadline for its first one; then it keeps its own.
    #findEndMs(search) {
        const hasStuff = search.yieldedItems.length > 0 || this.#findBestDiverse(search) !== undefined;
        return hasStuff ? search.deadlineMs : search.latestDeadlineMs;
    }

    #distrustModel(search, evaluation) {
        if (search.isModelTrusted) logDebug(`Exact score ${evaluation.score} beats the model: no proof from now on`);
        search.isModelTrusted = false;
    }

    // Exact score of the solver's stuff, added to the pool; an invalid stuff is excluded and gives null.
    #evaluateSolution(exact, search, result) {
        const { itemModel } = exact.model;
        const items = itemModel.items.filter((item) => result.valueOf(itemModel.variableOf(item)) > SELECTED_THRESHOLD);
        const evaluation = this.#evaluator.evaluate(items);
        if (!evaluation) {
            search.cuts.excludedStuffs.push(items);
            return null;
        }
        this.#checkExactPhaseUse(result, evaluation, search);
        this.#addToPool(search, [evaluation]);
        return evaluation;
    }

    // On large models the exact MILP neither proves nor beats the heuristic within its share: the bound is then
    // kept and the remaining time goes to the heuristic.
    #checkExactPhaseUse(result, evaluation, search) {
        if (result.status !== HighsSolver.STATUS.TIME_LIMIT) return;
        const best = this.#findBestDiverse(search);
        if (best && !isClearlyBelow(best.score, evaluation.score)) search.isExactPhaseUseful = false;
    }

    #applyExclusions(exact, search) {
        const { excludedStuffs } = search.cuts;
        for (; search.appliedExclusionCount < excludedStuffs.length; search.appliedExclusionCount++) {
            exact.cutBuilder.excludeStuff(excludedStuffs[search.appliedExclusionCount]);
        }
    }

    // search.upperBound stays valid for every later stuff: cuts only remove stuffs from the model. A stuff scoring
    // clearly above it disproves the model instead.
    #settle(search) {
        const evaluation = this.#findBestDiverse(search);
        if (!evaluation) return null;
        if (isClearlyBelow(search.upperBound, evaluation.score)) this.#distrustModel(search, evaluation);
        const isBoundValid = search.isModelTrusted && Number.isFinite(search.upperBound);
        const upperBound = isBoundValid ? search.upperBound : null;
        return { evaluation, ...Optimality.describe(evaluation.score, upperBound), upperBound };
    }

    #buildStart(itemModel, search) {
        const best = this.#findBestDiverse(search);
        if (!best) return null;
        const chosen = new Set(best.items);
        return new Map(
            itemModel.items.map((item) => [itemModel.variableOf(item), chosen.has(item) ? SELECTED : NOT_SELECTED]),
        );
    }
}

module.exports = StuffSolver;
