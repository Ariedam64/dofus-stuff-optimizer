const Optimality = require("../solver/Optimality");

const { SOLVER_STATUS } = Optimality;
const UNKNOWN_BOUND = null;

// Higher score first, then the earlier arrival.
function compareEntries(first, second) {
    return second.evaluation.score - first.evaluation.score || first.arrival - second.arrival;
}

// An optimal stuff is settled enough to stream: a later partition failure can still leave it unproven at the end.
function describeWithBound(score, upperBound, isFinal) {
    const status = Optimality.describe(score, upperBound);
    return { ...status, isFinal: isFinal || status.solverStatus === SOLVER_STATUS.OPTIMAL };
}

// The stuffs of every weapon partition ranked by exact score. Stuffs of different partitions wear different weapons,
// so they are always diverse, and the best resultCount of the union is the diverse list a single search would give.
// A stuff is proven only against every partition: no stuff of any partition, diverse from those ranked above it, may
// score more.
class MergedRanking {
    #partitions;
    #resultCount;
    #entries = [];
    #totalArrivals = 0;

    constructor({ partitions, resultCount }) {
        this.#partitions = partitions;
        this.#resultCount = resultCount;
    }

    get topEntries() {
        return this.#entries.slice(0, this.#resultCount);
    }

    add(partition, stuff) {
        const entry = partition.addEntry({ ...stuff, arrival: this.#totalArrivals++ });
        const nextIndex = this.#entries.findIndex((other) => compareEntries(entry, other) < 0);
        this.#entries.splice(nextIndex === -1 ? this.#entries.length : nextIndex, 0, entry);
        return entry;
    }

    // A stuff scoring at most this bound can no longer enter the full list.
    isBelowList(upperBound) {
        if (upperBound === UNKNOWN_BOUND || this.#entries.length < this.#resultCount) return false;
        return upperBound <= this.#entries[this.#resultCount - 1].evaluation.score;
    }

    // Searching partitions whose proven bound cannot reach the full list: none of their next stuffs could enter it.
    findPrunable() {
        return this.#partitions.filter((partition) => partition.isSearching && this.isBelowList(partition.latestBound));
    }

    // { solverStatus, optimalityGapPercent, isFinal }; isFinal: the running partitions can no longer improve it.
    describe(entry) {
        const { score } = entry.evaluation;
        const isRankedAbove = (other) => compareEntries(other, entry) < 0;
        let highestBound = -Infinity;
        let isFinal = true;
        let hasUnknownBound = false;
        for (const partition of this.#partitions) {
            const below = partition.boundBelow(isRankedAbove);
            isFinal &&= below.isFinal;
            if (below.bound !== UNKNOWN_BOUND) {
                highestBound = Math.max(highestBound, below.bound);
            } else if (below.isFinal) {
                return describeWithBound(score, UNKNOWN_BOUND, true);
            } else {
                hasUnknownBound = true;
            }
        }
        return describeWithBound(score, hasUnknownBound ? UNKNOWN_BOUND : highestBound, isFinal);
    }
}

module.exports = MergedRanking;
