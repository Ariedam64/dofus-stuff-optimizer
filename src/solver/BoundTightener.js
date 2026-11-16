const HighsSolver = require("./HighsSolver");
const LinearExpression = require("./LinearExpression");
const MilpModelBuilder = require("./MilpModelBuilder");
const StatBounds = require("./StatBounds");

const MAXIMIZED = 1;
const MINIMIZED = -1;
// A floating-point LP optimum may sit a little inside the true LP extreme. An optimum is only used when its dual
// infeasibilities are negligible, so that the true extreme is at most their sum times the stat and row ranges
// (below 1e4) away, and it is then widened by far more than that before an integral stat is rounded.
const MAX_DUAL_INFEASIBILITY = 1e-9;
const ABSOLUTE_SAFETY = 1e-2;
const RELATIVE_SAFETY = 1e-6;
// Only the objective changes between solves, so the primal simplex restarts from a feasible basis.
const PRIMAL_SIMPLEX = 4;
const LP_OPTIONS = Object.freeze({ presolve: "off", simplex_strategy: PRIMAL_SIMPLEX });

// Bounds of every stat variable of the exact model, valid over all valid stuffs. The combinatorial bounds of
// MilpModelBuilder (slot capacities, set shares, exos, points, scrolls, query minimums) come first; each stat is
// then maximized and minimized over the LP relaxation of the stuff rules (slots, exclusions, set counts, exos,
// points, criteria, query minimums), which contains every valid stuff, until the time limit.
class BoundTightener {
    #problem;
    #nowFn;

    // problem: { candidates, query, gameData, spellGroups, baseStats }, as for MilpModelBuilder.
    constructor({ problem, nowFn = Date.now }) {
        this.#problem = problem;
        this.#nowFn = nowFn;
    }

    // Returns Map<stat variable name, { weights, lower, upper }>, ready for MilpModelBuilder's statBounds.
    async tighten({ timeLimitMs }) {
        const deadlineMs = this.#nowFn() + timeLimitMs;
        const structure = new MilpModelBuilder(this.#problem).buildStructure();
        const statsByName = new Map(structure.stats.map(({ name, ...stat }) => [name, stat]));
        if (this.#nowFn() >= deadlineMs) return BoundTightener.#toBounds(statsByName);
        try {
            await this.#tightenWithLp(structure.relaxedLpText, statsByName, deadlineMs);
        } catch (error) {
            // Each bound narrowed so far was proven, and the others keep their combinatorial value.
            console.error(`❌ LP bound tightening stopped, keeping the bounds proven so far: ${error.message}`);
        }
        return BoundTightener.#toBounds(statsByName);
    }

    static #toBounds(statsByName) {
        return new Map([...statsByName].map(([name, { weights, lower, upper }]) => [name, { weights, lower, upper }]));
    }

    async #tightenWithLp(relaxedLpText, statsByName, deadlineMs) {
        const solver = await HighsSolver.create(relaxedLpText, LP_OPTIONS);
        try {
            this.#tightenAll(solver, statsByName, deadlineMs);
        } finally {
            solver.dispose();
        }
    }

    // Stops at the first LP without a proven optimum: the bounds found so far stay valid.
    #tightenAll(solver, statsByName, deadlineMs) {
        for (const [name, stat] of statsByName) {
            for (const direction of [MAXIMIZED, MINIMIZED]) {
                const remainingMs = deadlineMs - this.#nowFn();
                if (remainingMs <= 0) return;
                solver.setObjective(LinearExpression.ofTerm(name, direction));
                const result = solver.solve({ timeLimitMs: remainingMs });
                const isProven = result.status === HighsSolver.STATUS.OPTIMAL && result.hasSolution;
                if (!isProven || !(solver.dualInfeasibility <= MAX_DUAL_INFEASIBILITY)) return;
                Object.assign(stat, BoundTightener.#narrow(stat, direction * result.objective, direction));
            }
        }
    }

    static #narrow(stat, extreme, direction) {
        const safety = ABSOLUTE_SAFETY + RELATIVE_SAFETY * Math.abs(extreme);
        const tightened =
            direction === MAXIMIZED
                ? { lower: -Infinity, upper: extreme + safety }
                : { lower: extreme - safety, upper: Infinity };
        return StatBounds.narrow(stat, { isIntegral: stat.isIntegral, tightened });
    }
}

module.exports = BoundTightener;
