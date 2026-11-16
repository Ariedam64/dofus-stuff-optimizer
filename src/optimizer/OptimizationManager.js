const SearchContext = require("./SearchContext");
const ResultFormatter = require("./ResultFormatter");
const SolverWorkerPool = require("./SolverWorkerPool");
const WeaponPartitioner = require("./WeaponPartitioner");
const PartitionedSearch = require("./PartitionedSearch");
const Optimality = require("../solver/Optimality");

const REASON = Object.freeze({ NO_VALID_STUFF: "no-valid-stuff", TIME_LIMIT: "time-limit-reached" });
const NO_STUFF = 0;
const { SINGLE_JOB } = WeaponPartitioner;

function ignoreEvent() {}

class OptimizationManager {
    static REASON = REASON;

    #gameData;
    #config;
    #logger;
    #solverRunner;
    #workerPool = null;

    // Without a solverRunner, searches run in a SolverWorkerPool created on first use and released by close().
    constructor({ gameData, config, logger = console, solverRunner = null }) {
        this.#gameData = gameData;
        this.#config = config;
        this.#logger = logger;
        this.#solverRunner = solverRunner;
    }

    // Loads the solver workers ahead of the first search.
    async startWorkers() {
        if (this.#solverRunner) return;
        await this.#getWorkerPool().start();
    }

    async close() {
        const workerPool = this.#workerPool;
        this.#workerPool = null;
        await workerPool?.close();
    }

    run(queryJson) {
        return this.runStreaming(queryJson);
    }

    // The search is split by weapon across the solver runner (see PartitionedSearch); a runner that does not tell how
    // many jobs it runs at once gets one search, not split. Stuffs are streamed once their status is settled, in no
    // particular order, and a streamed stuff may later be pushed out of the list; the final results are the best
    // resultCount, sorted by exact score.
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
        const progress = { streamedCount: NO_STUFF, callbackError: null };
        const stopController = new AbortController();
        // The timer callback cannot throw to the caller: a listener error stops the search and is rethrown below.
        const reportProgress = () => {
            try {
                const foundCount = Math.min(progress.streamedCount, context.query.resultCount);
                onProgress({ elapsedMs: Date.now() - startMs, foundCount });
            } catch (error) {
                progress.callbackError ??= error;
                stopController.abort();
            }
        };
        const sendStuff = (stuff) => {
            progress.streamedCount++;
            onStuff(progress.streamedCount, formatter.formatStuff(stuff));
            reportProgress();
        };
        const progressTimer = setInterval(reportProgress, this.#config.PROGRESS_INTERVAL_MS);
        let search;
        try {
            const signals = [signal, stopController.signal].filter(Boolean);
            search = await this.#search(queryJson, context, { startMs, signals, onStuff: sendStuff });
        } finally {
            clearInterval(progressTimer);
        }
        if (progress.callbackError) throw progress.callbackError;
        return this.#buildResult({ context, formatter, search, startMs });
    }

    async #search(queryJson, context, { startMs, signals, onStuff }) {
        const runner = this.#getSolverRunner();
        const groups = new WeaponPartitioner(context).partition(runner.size ?? SINGLE_JOB);
        this.#logDebug(`Weapon groups: ${groups.map((group) => group.weaponIds?.length ?? "all").join(", ")}`);
        const search = new PartitionedSearch({ runner, context, groups, logger: this.#logger });
        const { timeLimitMs } = context.query;
        await search.run(this.#buildJob(queryJson, timeLimitMs, { startMs, groupCount: groups.length }), {
            signal: this.#withHardStop(timeLimitMs, signals),
            onStuff,
        });
        return search;
    }

    // A partition without any stuff at its deadline may run on until the time limit for a first one.
    #buildJob(queryJson, timeLimitMs, { startMs, groupCount }) {
        const { WARM_START_TIME_RATIO, MIN_WARM_START_TIME_MS } = this.#config;
        const partitionTimeMs = groupCount > SINGLE_JOB ? this.#computeSplitTimeMs(timeLimitMs) : timeLimitMs;
        return {
            queryJson,
            deadlineMs: startMs + partitionTimeMs,
            latestDeadlineMs: startMs + timeLimitMs,
            warmStartTimeMs: Math.max(partitionTimeMs * WARM_START_TIME_RATIO, MIN_WARM_START_TIME_MS),
        };
    }

    // Each partition of a split search gets SPLIT_SEARCH_TIME_SHARE of the time limit, but at least
    // MIN_PARTITION_TIME_MS and never more than the limit, so that a longer limit never gives a shorter search.
    #computeSplitTimeMs(timeLimitMs) {
        const { SPLIT_SEARCH_TIME_SHARE, MIN_PARTITION_TIME_MS } = this.#config;
        return Math.min(timeLimitMs, Math.max(timeLimitMs * SPLIT_SEARCH_TIME_SHARE, MIN_PARTITION_TIME_MS));
    }

    #withHardStop(timeLimitMs, signals) {
        const hardStop = AbortSignal.timeout(timeLimitMs + this.#config.DEADLINE_GRACE_MS);
        return AbortSignal.any([...signals, hardStop]);
    }

    #getSolverRunner() {
        return this.#solverRunner ?? this.#getWorkerPool();
    }

    #getWorkerPool() {
        this.#workerPool ??= new SolverWorkerPool({ config: this.#config, logger: this.#logger });
        return this.#workerPool;
    }

    #buildResult({ context, formatter, search, startMs }) {
        const results = search.listResults().map((stuff) => formatter.formatStuff(stuff));
        const { isComplete, isInfeasible } = search.outcome;
        const isCut = !isComplete;
        const isProvenEmpty = results.length === NO_STUFF && isInfeasible;
        const isEveryStuffOptimal = results.every((stuff) => stuff.solverStatus === Optimality.SOLVER_STATUS.OPTIMAL);
        return {
            isOptimal: !isCut && isEveryStuffOptimal,
            elapsedMs: Date.now() - startMs,
            reason: this.#explainOutcome(results.length, isProvenEmpty, isCut),
            dataSyncedAt: this.#gameData.dataSyncedAt,
            ignoredSpells: context.listIgnoredSpells(),
            unsupportedItems: formatter.formatItemList(context.filter.unsupportedItems),
            unobtainableItems: formatter.formatItemList(context.filter.unobtainableItems),
            results,
        };
    }

    // Only a HiGHS infeasibility proof may claim that no stuff exists; an empty search cut by time proves nothing.
    #explainOutcome(foundCount, isProvenEmpty, isCut) {
        if (isProvenEmpty) return REASON.NO_VALID_STUFF;
        if (foundCount === NO_STUFF || isCut) return REASON.TIME_LIMIT;
        return null;
    }

    #logDebug(message) {
        if (this.#config.IS_DEBUG) this.#logger.error(`🔍 ${message}`);
    }
}

module.exports = OptimizationManager;
