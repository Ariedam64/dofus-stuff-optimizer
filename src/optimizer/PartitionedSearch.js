const SearchPartition = require("./SearchPartition");
const MergedRanking = require("./MergedRanking");
const { SOLVER_MESSAGE } = require("./solverMessages");

// Runs one solver job per weapon group at once (most promising first, so a busy pool starts them in that order),
// rescores their stuffs with the exact evaluator of this thread and merges them. A partition whose proven bound
// cannot reach the list any more is stopped. The search is complete only when every partition ended by itself or was
// stopped by such a bound. A failing partition keeps the stuffs of the others, but its unknown bound leaves the whole
// list unproven; the search fails only when every partition fails.
class PartitionedSearch {
    #runner;
    #context;
    #logger;
    #partitions;
    #ranking;
    #streamedEntries = new Set();
    #stopController = new AbortController();
    #callbackError = null;
    #failures = [];
    #totalPrunedPartitions = 0;

    // context: { query, evaluator, findItems(itemIds) }; groups: WeaponGroup[].
    constructor({ runner, context, groups, logger = console }) {
        this.#runner = runner;
        this.#context = context;
        this.#logger = logger;
        const { resultCount } = context.query;
        this.#partitions = groups.map((group) => new SearchPartition({ group, resultCount }));
        this.#ranking = new MergedRanking({ partitions: this.#partitions, resultCount });
    }

    get totalPrunedPartitions() {
        return this.#totalPrunedPartitions;
    }

    get outcome() {
        return {
            isComplete: this.#partitions.every((partition) => partition.isComplete),
            isInfeasible: this.#partitions.every((partition) => partition.isInfeasible),
        };
    }

    // job: the fields shared by every partition job (see SolverSession.run). onStuff({ evaluation, solverStatus,
    // optimalityGapPercent }) gets each stuff of the list once its status is settled, or at the end; a stuff pushed out
    // before is never sent.
    async run(job, { signal = null, onStuff }) {
        await Promise.all(this.#partitions.map((partition) => this.#runPartition(partition, job, signal, onStuff)));
        if (this.#failures.length === this.#partitions.length) throw this.#failures[0];
        this.#pruneStoppedBelowList();
        if (!this.#callbackError) this.#sendSettledStuffs(onStuff, { isEnd: true });
        if (this.#callbackError) throw this.#callbackError;
    }

    // Final statuses, best first.
    listResults() {
        return this.#ranking.topEntries.map((entry) => this.#describe(entry).stuff);
    }

    async #runPartition(partition, job, signal, onStuff) {
        const partitionJob = { ...job, ...partition.group.toJobFields() };
        const signals = [signal, this.#stopController.signal, partition.signal].filter(Boolean);
        try {
            for await (const message of this.#runner.run(partitionJob, { signal: AbortSignal.any(signals) })) {
                if (!partition.isRunning || this.#stopController.signal.aborted) break;
                this.#handleMessage(partition, message);
                this.#sendSettledStuffs(onStuff, { isEnd: false });
            }
        } catch (error) {
            this.#recordFailure(partition, error);
        } finally {
            partition.stop();
        }
    }

    #recordFailure(partition, error) {
        partition.distrust();
        this.#failures.push(error);
        if (this.#failures.length > 1) return;
        this.#logger.error(`❌ Solver partition failed, keeping the stuffs of the others: ${error.message}`);
    }

    #handleMessage(partition, message) {
        if (message.type === SOLVER_MESSAGE.DONE) {
            partition.finish(message);
            return;
        }
        const evaluation = this.#rescore(message.itemIds);
        if (!evaluation) {
            partition.distrust();
            return;
        }
        this.#ranking.add(partition, { evaluation, upperBound: message.upperBound });
        for (const prunable of this.#ranking.findPrunable()) this.#prune(prunable);
    }

    #prune(partition) {
        partition.prune();
        this.#totalPrunedPartitions++;
    }

    // A partition stopped by the deadline or an abort is complete too when its bound cannot reach the list.
    #pruneStoppedBelowList() {
        for (const partition of this.#partitions) {
            if (partition.isStopped && this.#ranking.isBelowList(partition.latestBound)) this.#prune(partition);
        }
    }

    // The solver only proposes: the exact evaluator of this thread gives every displayed number.
    #rescore(itemIds) {
        const evaluation = this.#context.evaluator.evaluate(this.#context.findItems(itemIds));
        if (!evaluation) {
            this.#logger.error(`❌ Solver stuff [${itemIds.join(", ")}] is invalid for the exact evaluator`);
        }
        return evaluation;
    }

    // A listener error stops every partition and is rethrown by run.
    #sendSettledStuffs(onStuff, { isEnd }) {
        for (const entry of this.#ranking.topEntries) {
            if (this.#streamedEntries.has(entry)) continue;
            const { stuff, isFinal } = this.#describe(entry);
            if (!isFinal && !isEnd) continue;
            this.#streamedEntries.add(entry);
            try {
                onStuff(stuff);
            } catch (error) {
                this.#callbackError ??= error;
                this.#stopController.abort();
                return;
            }
        }
    }

    #describe(entry) {
        const { solverStatus, optimalityGapPercent, isFinal } = this.#ranking.describe(entry);
        return { stuff: { evaluation: entry.evaluation, solverStatus, optimalityGapPercent }, isFinal };
    }
}

module.exports = PartitionedSearch;
