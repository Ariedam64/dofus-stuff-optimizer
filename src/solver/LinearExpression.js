const NO_CONSTANT = 0;
const NO_COEFFICIENT = 0;

// Sum of coefficient × variable terms plus a constant, keyed by variable name.
class LinearExpression {
    #coefficients = new Map();
    #constant = NO_CONSTANT;

    constructor(constant = NO_CONSTANT) {
        this.#constant = constant;
    }

    static ofTerm(variable, coefficient = 1) {
        return new LinearExpression().addTerm(variable, coefficient);
    }

    static sumOf(variables) {
        const expression = new LinearExpression();
        for (const variable of variables) expression.addTerm(variable, 1);
        return expression;
    }

    get constant() {
        return this.#constant;
    }

    get terms() {
        return [...this.#coefficients];
    }

    get isConstant() {
        return this.#coefficients.size === 0;
    }

    coefficientOf(variable) {
        return this.#coefficients.get(variable) ?? NO_COEFFICIENT;
    }

    addTerm(variable, coefficient) {
        const sum = this.coefficientOf(variable) + coefficient;
        if (sum === NO_COEFFICIENT) this.#coefficients.delete(variable);
        else this.#coefficients.set(variable, sum);
        return this;
    }

    addConstant(value) {
        this.#constant += value;
        return this;
    }

    addExpression(other, factor = 1) {
        for (const [variable, coefficient] of other.terms) this.addTerm(variable, coefficient * factor);
        this.#constant += other.constant * factor;
        return this;
    }

    scaled(factor) {
        return new LinearExpression().addExpression(this, factor);
    }

    clone() {
        return this.scaled(1);
    }
}

module.exports = LinearExpression;
