const STATE = Object.freeze({ RUNNING: "running", COMPLETE: "complete", PRUNED: "pruned", STOPPED: "stopped" });
const UNKNOWN_BOUND = null;

function findLowestBound(entries) {
    const bounds = entries.map((entry) => entry.bound).filter((bound) => bound !== UNKNOWN_BOUND);
    return bounds.length > 0 ? Math.min(...bounds) : UNKNOWN_BOUND;
}

// One weapon group searched on its own: the stuffs it yielded in order, the bounds proven with them and how it ended.
class SearchPartition {
    #group;
    #resultCount;
    #controller = new AbortController();
    #entries = [];
    #state = STATE.RUNNING;
    #isInfeasible = false;
    #isTrusted = true;

    constructor({ group, resultCount }) {
        this.#group = group;
        this.#resultCount = resultCount;
    }

    get group() {
        return this.#group;
    }

    get signal() {
        return this.#controller.signal;
    }

    get isRunning() {
        return this.#state === STATE.RUNNING;
    }

    // Ended by the deadline, an abort or a failure, without proving it had nothing more to give.
    get isStopped() {
        return this.#state === STATE.STOPPED;
    }

    // Running and still short of its stuffs: one that has yielded them all is ending by itself.
    get isSearching() {
        return this.isRunning && this.#entries.length < this.#resultCount;
    }

    // Ended by itself with every diverse stuff it could give, or pruned by a proven bound.
    get isComplete() {
        return this.#state === STATE.COMPLETE || this.#state === STATE.PRUNED;
    }

    // Ended by proving that no further stuff of its own exists.
    get isExhausted() {
        return this.#state === STATE.COMPLETE && this.#entries.length < this.#resultCount;
    }

    get isInfeasible() {
        return this.#isInfeasible;
    }

    // Valid for every stuff it has not yielded yet; null when nothing is proven.
    get latestBound() {
        return this.#isTrusted ? findLowestBound(this.#entries) : UNKNOWN_BOUND;
    }

    // entry: { evaluation, upperBound, arrival }, upperBound being the bound StuffSolver proved for every stuff it had
    // not yielded yet, or null.
    addEntry(entry) {
        const bound = entry.upperBound ?? UNKNOWN_BOUND;
        // A proof lost on the way means the model was beaten or failed: none of its proofs is kept.
        if (bound === UNKNOWN_BOUND && this.latestBound !== UNKNOWN_BOUND) this.#isTrusted = false;
        const boundedEntry = { ...entry, partition: this, bound };
        this.#entries.push(boundedEntry);
        return boundedEntry;
    }

    // The solver yielded a stuff the exact evaluator rejects: its later diversity cuts cannot be followed.
    distrust() {
        this.#isTrusted = false;
    }

    finish({ isComplete, isInfeasible }) {
        if (!this.isRunning) return;
        this.#state = isComplete ? STATE.COMPLETE : STATE.STOPPED;
        this.#isInfeasible = isInfeasible;
    }

    stop() {
        if (this.isRunning) this.#state = STATE.STOPPED;
    }

    prune() {
        this.#state = STATE.PRUNED;
        this.#controller.abort();
    }

    // Upper bound of its stuffs diverse from those ranked above the given place, the stuff at that place excluded.
    // A bound of a yielded stuff holds for every stuff diverse from the earlier ones, so the longest run of first
    // entries ranked above the place gives the bound. isFinal: later stuffs can no longer lower it.
    boundBelow(isRankedAbove) {
        if (!this.#isTrusted) return { bound: UNKNOWN_BOUND, isFinal: true };
        const aboveCount = this.#countFirstEntriesAbove(isRankedAbove);
        if (aboveCount < this.#entries.length) {
            return { bound: findLowestBound(this.#entries.slice(0, aboveCount + 1)), isFinal: true };
        }
        if (this.isExhausted) return { bound: -Infinity, isFinal: true };
        return { bound: findLowestBound(this.#entries), isFinal: !this.isRunning };
    }

    #countFirstEntriesAbove(isRankedAbove) {
        const firstBelowIndex = this.#entries.findIndex((entry) => !isRankedAbove(entry));
        return firstBelowIndex === -1 ? this.#entries.length : firstBelowIndex;
    }
}

module.exports = SearchPartition;
