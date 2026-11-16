const LinearExpression = require("./LinearExpression");

const VARIABLE_TYPE = Object.freeze({ CONTINUOUS: "continuous", INTEGER: "integer", BINARY: "binary" });
const SENSE = Object.freeze({ AT_MOST: "<=", AT_LEAST: ">=", EQUAL: "=" });
const TERMS_PER_LINE = 8;
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BINARY_BOUNDS = Object.freeze({ lower: 0, upper: 1 });
const CONSTANT_TOLERANCE = 1e-9;

function formatNumber(value) {
    if (!Number.isFinite(value)) throw new Error(`Cannot write the non-finite number ${value} in an LP model`);
    return String(value);
}

function formatTerms(terms) {
    if (terms.length === 0) return "0";
    const parts = terms.map(([variable, coefficient], index) => {
        const sign = coefficient < 0 ? "-" : index === 0 ? "" : "+";
        return `${sign} ${formatNumber(Math.abs(coefficient))} ${variable}`;
    });
    const lines = [];
    for (let start = 0; start < parts.length; start += TERMS_PER_LINE) {
        lines.push(parts.slice(start, start + TERMS_PER_LINE).join(" "));
    }
    return lines.join("\n   ");
}

function isSatisfied(value, sense, rhs) {
    if (sense === SENSE.AT_MOST) return value <= rhs + CONSTANT_TOLERANCE;
    if (sense === SENSE.AT_LEAST) return value >= rhs - CONSTANT_TOLERANCE;
    return Math.abs(value - rhs) <= CONSTANT_TOLERANCE;
}

// Collects a maximization MILP and writes it in CPLEX LP format.
class LpWriter {
    static VARIABLE_TYPE = VARIABLE_TYPE;
    static SENSE = SENSE;

    #variables = new Map();
    #constraints = [];
    #objective = new LinearExpression();

    addVariable(name, { lower = 0, upper = Infinity, type = VARIABLE_TYPE.CONTINUOUS } = {}) {
        if (!VARIABLE_NAME_PATTERN.test(name)) throw new Error(`Invalid LP variable name "${name}"`);
        if (this.#variables.has(name)) throw new Error(`LP variable "${name}" is declared twice`);
        if (lower > upper) throw new Error(`LP variable "${name}" has empty bounds [${lower}, ${upper}]`);
        const bounds = type === VARIABLE_TYPE.BINARY ? BINARY_BOUNDS : { lower, upper };
        this.#variables.set(name, { ...bounds, type });
        return name;
    }

    addBinary(name) {
        return this.addVariable(name, { type: VARIABLE_TYPE.BINARY });
    }

    boundsOf(name) {
        const variable = this.#variables.get(name);
        if (!variable) throw new Error(`Unknown LP variable "${name}"`);
        return { lower: variable.lower, upper: variable.upper };
    }

    // Interval arithmetic over the declared variable bounds.
    boundsOfExpression(expression) {
        let lower = expression.constant;
        let upper = expression.constant;
        for (const [variable, coefficient] of expression.terms) {
            const bounds = this.boundsOf(variable);
            const ends = [coefficient * bounds.lower, coefficient * bounds.upper];
            lower += Math.min(...ends);
            upper += Math.max(...ends);
        }
        return { lower, upper };
    }

    addConstraint(expression, sense, rhs = 0) {
        for (const [variable] of expression.terms) this.boundsOf(variable);
        const bound = rhs - expression.constant;
        if (expression.isConstant) {
            if (!isSatisfied(0, sense, bound))
                throw new Error(`Constant LP constraint 0 ${sense} ${bound} is violated`);
            return;
        }
        this.#constraints.push({ terms: expression.terms, sense, bound });
    }

    setObjective(expression) {
        this.#objective = expression.clone();
    }

    // isRelaxed drops integrality: the LP relaxation, whose optimum bounds the MILP optimum.
    toString({ isRelaxed = false } = {}) {
        const lines = ["Maximize", ` obj: ${formatTerms(this.#objective.terms)}`, "Subject To"];
        this.#constraints.forEach(({ terms, sense, bound }, index) => {
            lines.push(` c${index}: ${formatTerms(terms)} ${sense} ${formatNumber(bound)}`);
        });
        lines.push("Bounds", ...this.#formatBounds(isRelaxed));
        if (!isRelaxed) {
            lines.push("Generals", ...this.#listNames(VARIABLE_TYPE.INTEGER));
            lines.push("Binaries", ...this.#listNames(VARIABLE_TYPE.BINARY));
        }
        lines.push("End", "");
        return lines.join("\n");
    }

    #formatBounds(isRelaxed) {
        const lines = [];
        for (const [name, { lower, upper, type }] of this.#variables) {
            if (type === VARIABLE_TYPE.BINARY && !isRelaxed) continue;
            const lowerText = lower === -Infinity ? "-inf" : formatNumber(lower);
            const upperText = upper === Infinity ? "+inf" : formatNumber(upper);
            lines.push(` ${lowerText} <= ${name} <= ${upperText}`);
        }
        return lines;
    }

    #listNames(type) {
        return [...this.#variables].filter(([, variable]) => variable.type === type).map(([name]) => ` ${name}`);
    }
}

module.exports = LpWriter;
