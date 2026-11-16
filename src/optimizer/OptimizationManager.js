const SearchContext = require("./SearchContext");
const ResultFormatter = require("./ResultFormatter");
const SolverWorkerClient = require("./SolverWorkerClient");
const StuffSolver = require("../solver/StuffSolver");
const { SOLVER_MESSAGE } = require("./solverMessages");

const REASON = Object.freeze({ NO_VALID_STUFF: "no-valid-stuff", TIME_LIMIT: "time-limit-reached" });
const NO_OUTCOME = null;
const NO_STUFF = 0;

function ignoreEvent() {}

function compareScoresDescending(first, second) {
    return second.score - first.score;
}

class OptimizationManager {
    static REASON = REASON;

    #gameData;
    #config;
    #logger;
    #solverRunner;

    constructor({ gameData, config, logger = console, solverRunner = null }) {
        this.#gameData = gameData;
        this.#config = config;
        this.#logger = logger;
        this.#solverRunner = solverRunner ?? new SolverWorkerClient({ config });
    }

    run(queryJson) {
        return this.runStreaming(queryJson);
    }

    // Stuffs are streamed in the order found; the final results are sorted by exact score.
    async runStreaming(queryJson, { onStuff = ignoreEvent, onProgress = ignoreEvent, signal = null } = {}) {
        const startMs = Date.now();
        const context = new SearchContext(queryJson, this.#gameData);
        this.#logDebug(`Candidates: ${context.describeCandidates()}`);
        context.assertHasDamageAction();
        const formatter = new ResultFormatter({
            query: context.query,
            gameData: this.#gameData,
            maxReportedGapPercent: this.#config.MAX_REPORTED_GAP_PERCENT,
        });
        const search = { context, formatter, startMs, found: [], outcome: NO_OUTCOME, callbackError: null };
        const stopController = new AbortController();
        // The timer callback cannot throw to the caller: a listener error stops the search and is rethrown below.
        const reportProgress = () => {
            try {
                onProgress({ elapsedMs: Date.now() - startMs, foundCount: search.found.length });
            } catch (error) {
                search.callbackError ??= error;
                stopController.abort();
            }
        };
        const progressTimer = setInterval(reportProgress, this.#config.PROGRESS_INTERVAL_MS);
        try {
            const signals = [signal, stopController.signal].filter(Boolean);
            for await (const message of this.#startSolver(queryJson, context.query, startMs, signals)) {
                this.#handleMessage(search, message, { onStuff, reportProgress });
            }
        } finally {
            clearInterval(progressTimer);
        }
        if (search.callbackError) throw search.callbackError;
        return this.#buildResult(search);
    }

    #startSolver(queryJson, query, startMs, signals) {
        const { WARM_START_TIME_RATIO, MIN_WARM_START_TIME_MS, DEADLINE_GRACE_MS } = this.#config;
        const hardStop = AbortSignal.timeout(query.timeLimitMs + DEADLINE_GRACE_MS);
        return this.#solverRunner.run({
            queryJson,
            deadlineMs: startMs + query.timeLimitMs,
            warmStartTimeMs: Math.max(query.timeLimitMs * WARM_START_TIME_RATIO, MIN_WARM_START_TIME_MS),
            signal: AbortSignal.any([...signals, hardStop]),
        });
    }

    #handleMessage(search, message, { onStuff, reportProgress }) {
        if (message.type === SOLVER_MESSAGE.DONE) {
            search.outcome = message;
            return;
        }
        const stuff = this.#rescore(search, message);
        if (!stuff) return;
        search.found.push(stuff);
        onStuff(search.found.length, stuff.formatted);
        reportProgress();
    }

    // The solver only proposes: the exact evaluator of this thread gives every displayed number.
    #rescore({ context, formatter }, { itemIds, solverStatus, optimalityGapPercent }) {
        const evaluation = context.evaluator.evaluate(context.findItems(itemIds));
        if (!evaluation) {
            this.#logger.error(`❌ Solver stuff [${itemIds.join(", ")}] is invalid for the exact evaluator, skipped`);
            return null;
        }
        const formatted = formatter.formatStuff({ evaluation, solverStatus, optimalityGapPercent });
        return { score: evaluation.score, formatted };
    }

    #buildResult({ context, formatter, found, outcome, startMs }) {
        const results = found.sort(compareScoresDescending).map((stuff) => stuff.formatted);
        const isCut = !outcome?.isComplete;
        const isInfeasible = results.length === NO_STUFF && outcome?.isInfeasible === true;
        const isEveryStuffOptimal = results.every((stuff) => stuff.solverStatus === StuffSolver.SOLVER_STATUS.OPTIMAL);
        return {
            isOptimal: !isCut && isEveryStuffOptimal,
            elapsedMs: Date.now() - startMs,
            reason: this.#explainOutcome(results.length, isInfeasible, isCut),
            dataSyncedAt: this.#gameData.dataSyncedAt,
            ignoredSpells: context.listIgnoredSpells(),
            unsupportedItems: formatter.formatItemList(context.filter.unsupportedItems),
            unobtainableItems: formatter.formatItemList(context.filter.unobtainableItems),
            results,
        };
    }

    // Only a HiGHS infeasibility proof may claim that no stuff exists; an empty search cut by time proves nothing.
    #explainOutcome(foundCount, isInfeasible, isCut) {
        if (isInfeasible) return REASON.NO_VALID_STUFF;
        if (foundCount === NO_STUFF || isCut) return REASON.TIME_LIMIT;
        return null;
    }

    #logDebug(message) {
        if (this.#config.IS_DEBUG) this.#logger.error(`🔍 ${message}`);
    }
}

module.exports = OptimizationManager;
