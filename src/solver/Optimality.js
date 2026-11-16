const SOLVER_STATUS = Object.freeze({ OPTIMAL: "optimal", GAP: "gap", HEURISTIC: "heuristic" });
// HiGHS proves its optima within mip_rel_gap 1e-7 and mip_abs_gap 1e-6: a score within these tolerances of a bound
// reaches it.
const RELATIVE_TOLERANCE = 1e-6;
const ABSOLUTE_TOLERANCE = 1e-6;
const PERCENT = 100;
const NO_GAP = 0;

// How far an exact score is proven from the optimum, given an upper bound valid for every stuff it competes with.
class Optimality {
    static SOLVER_STATUS = SOLVER_STATUS;

    static isClearlyBelow(value, reference) {
        return value < reference - ABSOLUTE_TOLERANCE - RELATIVE_TOLERANCE * Math.abs(reference);
    }

    static computeGapPercent(score, upperBound) {
        return (PERCENT * (upperBound - score)) / Math.abs(upperBound);
    }

    // upperBound: a valid bound, or null when none is known. Returns { solverStatus, optimalityGapPercent }.
    static describe(score, upperBound) {
        if (upperBound === null || !Number.isFinite(upperBound)) {
            return { solverStatus: SOLVER_STATUS.HEURISTIC, optimalityGapPercent: null };
        }
        if (!Optimality.isClearlyBelow(score, upperBound)) {
            return { solverStatus: SOLVER_STATUS.OPTIMAL, optimalityGapPercent: NO_GAP };
        }
        return {
            solverStatus: SOLVER_STATUS.GAP,
            optimalityGapPercent: Optimality.computeGapPercent(score, upperBound),
        };
    }
}

module.exports = Optimality;
