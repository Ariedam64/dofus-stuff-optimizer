const loadHighs = require("highs");
const { SENSE } = require("./LpWriter");

const STATUS = Object.freeze({
    OPTIMAL: "optimal",
    TIME_LIMIT: "time-limit",
    INFEASIBLE: "infeasible",
});
const FEASIBLE_PRIMAL_STATUS = 2;
const MS_PER_SECOND = 1000;
const MIN_TIME_LIMIT_SECONDS = 0.01;
const SOLVER_OPTIONS = Object.freeze({
    output_flag: false,
    mip_rel_gap: 1e-7,
    mip_abs_gap: 1e-6,
});

let highsLoading = null;

function toRowBounds(sense, rhs) {
    if (sense === SENSE.AT_MOST) return [-Infinity, rhs];
    if (sense === SENSE.AT_LEAST) return [rhs, Infinity];
    return [rhs, rhs];
}

// Persistent HiGHS model: rows and columns can be added between solves (diversity and refinement cuts).
class HighsSolver {
    static STATUS = STATUS;

    #highs;
    #model;
    #columnIndexes = new Map();

    constructor(highs, model) {
        this.#highs = highs;
        this.#model = model;
    }

    static async create(lpText) {
        highsLoading ??= loadHighs().catch((error) => {
            highsLoading = null;
            throw new Error(`Cannot load the HiGHS solver: ${error.message}`);
        });
        const highs = await highsLoading;
        const model = highs.createModel({ format: "lp", data: lpText });
        model.options.set(SOLVER_OPTIONS);
        return new HighsSolver(highs, model);
    }

    columnOf(name) {
        if (!this.#columnIndexes.has(name)) this.#columnIndexes.set(name, this.#model.getColByName(name));
        return this.#columnIndexes.get(name);
    }

    addVariable(name, { lower = 0, upper = 1, isInteger = false } = {}) {
        this.#model.addVar(lower, upper);
        const index = this.#model.getDimensions().numCols - 1;
        if (isInteger) this.#model.changeColIntegrality(index, this.#highs.constants.variableType.integer);
        this.#columnIndexes.set(name, index);
        return name;
    }

    addConstraint(expression, sense, rhs = 0) {
        const terms = expression.terms;
        const [lower, upper] = toRowBounds(sense, rhs - expression.constant);
        this.#model.addRow(lower, upper, {
            indices: terms.map(([name]) => this.columnOf(name)),
            values: terms.map(([, coefficient]) => coefficient),
        });
    }

    // start: Map<variable name, value>, a partial MIP start completed by HiGHS.
    solve({ timeLimitMs, start = null }) {
        this.#model.options.set({ time_limit: Math.max(MIN_TIME_LIMIT_SECONDS, timeLimitMs / MS_PER_SECOND) });
        this.#model.zeroAllClocks();
        if (start) {
            const entries = [...start];
            this.#model.setSolution({
                indices: entries.map(([name]) => this.columnOf(name)),
                values: entries.map(([, value]) => value),
            });
        }
        this.#model.run(this.#buildDeadlineCallbacks(Date.now() + timeLimitMs));
        return this.#readResult();
    }

    // HiGHS checks time_limit only at some points; these checkpoints enforce the wall-clock deadline as well.
    #buildDeadlineCallbacks(deadlineMs) {
        const interruptLate = (event) => {
            if (Date.now() >= deadlineMs) event.interrupt();
        };
        const { callbackType } = this.#highs.constants;
        return {
            [callbackType.mipInterrupt]: interruptLate,
            [callbackType.simplexInterrupt]: interruptLate,
        };
    }

    dispose() {
        this.#model.dispose();
    }

    #readResult() {
        const status = this.#toStatus(this.#model.getModelStatus());
        const hasSolution = this.#model.info.get("primal_solution_status") === FEASIBLE_PRIMAL_STATUS;
        if (!hasSolution) return { status, hasSolution, dualBound: this.#readDualBound(status) };
        const values = this.#model.getSolution().colValue;
        const objective = this.#model.getObjectiveValue();
        const dualBound = this.#readDualBound(status);
        return {
            status,
            hasSolution,
            objective,
            dualBound: status === STATUS.OPTIMAL && !Number.isFinite(dualBound) ? objective : dualBound,
            valueOf: (name) => values[this.columnOf(name)],
        };
    }

    #toStatus(modelStatus) {
        const codes = this.#highs.constants.modelStatus;
        if (modelStatus === codes.optimal) return STATUS.OPTIMAL;
        if (modelStatus === codes.timeLimit || modelStatus === codes.interrupted) return STATUS.TIME_LIMIT;
        if (modelStatus === codes.infeasible || modelStatus === codes.unboundedOrInfeasible) return STATUS.INFEASIBLE;
        throw new Error(`HiGHS stopped with unexpected model status ${modelStatus}`);
    }

    // Infinity when HiGHS has no bound yet; an infeasible model is bounded by -Infinity.
    #readDualBound(status) {
        if (status === STATUS.INFEASIBLE) return -Infinity;
        const dualBound = this.#model.info.get("mip_dual_bound");
        return Number.isFinite(dualBound) ? dualBound : Infinity;
    }
}

module.exports = HighsSolver;
