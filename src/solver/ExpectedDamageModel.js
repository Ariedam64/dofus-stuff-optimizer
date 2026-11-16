const LinearExpression = require("./LinearExpression");
const { SENSE } = require("./LpWriter");

const PERCENT_BASE = 100;
const HALF = 2;
const NO_CRITICAL_RATE = 0;
const MIN_CRITICAL_PERCENT = 0;
const MAX_CRITICAL_PERCENT = 100;

function averageOf(line) {
    return (line.min + line.max) / HALF;
}

// Expected damage of one cast before % factors, as a variable bounded above by exact linear forms.
// - Lines are linear in the stats; max(0, line) gets a variable and a sign binary when the line may turn negative.
// - The critical chance × lines products use the bit expansion of the critical stat.
// - A clamp of the critical chance at 0 % or 100 % is a regime chosen by a binary that also bounds the stat.
class ExpectedDamageModel {
    #writer;
    #linearizer;
    #statVariables;
    #criticalExpansion = null;
    #criticalProducts = new Map();
    #regimesByRate = new Map();

    // statVariables: { multiplier, fixed, criticalDamage, critical } variable names
    // multiplier = element + power, fixed = damage + element damage.
    constructor({ writer, linearizer, statVariables }) {
        this.#writer = writer;
        this.#linearizer = linearizer;
        this.#statVariables = statVariables;
    }

    addExpectedDamage(id, action) {
        const normal = this.#sumLines(`${id}n`, action.normalLines, false);
        const critical = this.#sumLines(`${id}c`, action.criticalLines, true);
        const upper = Math.max(
            this.#writer.boundsOfExpression(normal).upper,
            this.#writer.boundsOfExpression(critical).upper,
            0,
        );
        const variable = this.#writer.addVariable(`e${id}`, { upper });
        const damage = LinearExpression.ofTerm(variable);
        if (action.criticalRate === NO_CRITICAL_RATE) {
            this.#addBoundRow(damage, upper, { form: normal, relaxation: new LinearExpression() });
        } else {
            this.#addCriticalRows({ damage, upper, rate: action.criticalRate }, normal, critical);
        }
        return { variable, upper };
    }

    // Each regime row is relaxed by M × relaxation, which is 0 when the regime applies.
    #addCriticalRows({ damage, upper, rate }, normal, critical) {
        const delta = critical.clone().addExpression(normal, -1);
        const blended = normal.clone().addExpression(delta, rate / PERCENT_BASE);
        blended.addExpression(this.#multiplyByCritical(delta), 1 / PERCENT_BASE);
        const regimes = this.#findRegimes(rate);
        const blendedRelaxation = new LinearExpression();
        if (regimes.low) {
            const lowRelaxation = new LinearExpression(1).addTerm(regimes.low, -1);
            this.#addBoundRow(damage, upper, { form: normal, relaxation: lowRelaxation });
            blendedRelaxation.addTerm(regimes.low, 1);
        }
        if (regimes.high) {
            const highRelaxation = new LinearExpression(1).addTerm(regimes.high, -1);
            this.#addBoundRow(damage, upper, { form: critical, relaxation: highRelaxation });
            blendedRelaxation.addTerm(regimes.high, 1);
        }
        const formLower = this.#lowerBoundOfBlend(rate, normal, delta);
        this.#addBoundRow(damage, upper, { form: blended, relaxation: blendedRelaxation, formLower });
    }

    // damage <= form + M × relaxation
    #addBoundRow(damage, upper, { form, relaxation, formLower = this.#writer.boundsOfExpression(form).lower }) {
        const bigM = Math.max(0, upper - formLower);
        const row = damage.clone().addExpression(form, -1).addExpression(relaxation, -bigM);
        this.#writer.addConstraint(row, SENSE.AT_MOST);
    }

    #lowerBoundOfBlend(rate, normal, delta) {
        const critical = this.#writer.boundsOf(this.#statVariables.critical);
        const deltaBounds = this.#writer.boundsOfExpression(delta);
        const chances = [rate + critical.lower, rate + critical.upper].map((percent) => percent / PERCENT_BASE);
        const corners = chances.flatMap((chance) => [chance * deltaBounds.lower, chance * deltaBounds.upper]);
        return this.#writer.boundsOfExpression(normal).lower + Math.min(...corners);
    }

    // Critical stat × an expression of model variables, exact at integer points.
    #multiplyByCritical(expression) {
        const product = LinearExpression.ofTerm(this.#statVariables.critical).scaled(expression.constant);
        for (const [variable, coefficient] of expression.terms) {
            product.addExpression(this.#criticalProductOf(variable), coefficient);
        }
        return product;
    }

    #criticalProductOf(variable) {
        if (!this.#criticalProducts.has(variable)) {
            this.#criticalExpansion ??= this.#linearizer.expandInBits(
                "cb",
                LinearExpression.ofTerm(this.#statVariables.critical),
            );
            const product = this.#linearizer.multiplyByExpandedInteger(
                `cp${variable}`,
                this.#criticalExpansion,
                LinearExpression.ofTerm(variable),
            );
            this.#criticalProducts.set(variable, product);
        }
        return this.#criticalProducts.get(variable);
    }

    // low: the chance would be below 0 % (stat <= -rate); high: above 100 % (stat >= 100 - rate).
    #findRegimes(rate) {
        if (this.#regimesByRate.has(rate)) return this.#regimesByRate.get(rate);
        const criticalVariable = this.#statVariables.critical;
        const { lower, upper } = this.#writer.boundsOf(criticalVariable);
        const lowEdge = MIN_CRITICAL_PERCENT - rate;
        const highEdge = MAX_CRITICAL_PERCENT - rate;
        const regimes = { low: null, high: null };
        const stat = LinearExpression.ofTerm(criticalVariable);
        if (lower < lowEdge) {
            regimes.low = this.#writer.addBinary(`rl${rate}`);
            this.#writer.addConstraint(stat.clone().addTerm(regimes.low, upper - lowEdge), SENSE.AT_MOST, upper);
            this.#writer.addConstraint(stat.clone().addTerm(regimes.low, lowEdge - lower), SENSE.AT_LEAST, lowEdge);
        }
        if (upper > highEdge) {
            regimes.high = this.#writer.addBinary(`rh${rate}`);
            this.#writer.addConstraint(stat.clone().addTerm(regimes.high, lower - highEdge), SENSE.AT_LEAST, lower);
            this.#writer.addConstraint(stat.clone().addTerm(regimes.high, highEdge - upper), SENSE.AT_MOST, highEdge);
        }
        this.#regimesByRate.set(rate, regimes);
        return regimes;
    }

    #sumLines(prefix, lines, isCritical) {
        const { multiplier, fixed, criticalDamage } = this.#statVariables;
        const total = new LinearExpression();
        lines.forEach((line, index) => {
            const average = averageOf(line);
            const value = new LinearExpression(average).addTerm(multiplier, average / PERCENT_BASE).addTerm(fixed, 1);
            if (isCritical) value.addTerm(criticalDamage, 1);
            total.addExpression(this.#clampAtZero(`${prefix}${index}`, value));
        });
        return total;
    }

    // max(0, value): the value itself when it cannot be negative, else a variable exact at integer points:
    // isZero = 1 gives clamped <= 0, isZero = 0 gives clamped <= value (feasible only when value >= 0, since
    // clamped >= 0), so the best choice is max(0, value).
    #clampAtZero(name, value) {
        const { lower, upper } = this.#writer.boundsOfExpression(value);
        if (lower >= 0) return value;
        if (upper <= 0) return new LinearExpression();
        const isZero = this.#writer.addBinary(`sg${name}`);
        const clamped = LinearExpression.ofTerm(this.#writer.addVariable(`ps${name}`, { upper }));
        this.#writer.addConstraint(clamped.clone().addExpression(value, -1).addTerm(isZero, lower), SENSE.AT_MOST);
        this.#writer.addConstraint(clamped.clone().addTerm(isZero, upper), SENSE.AT_MOST, upper);
        return clamped;
    }
}

module.exports = ExpectedDamageModel;
