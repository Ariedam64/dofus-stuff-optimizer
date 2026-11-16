const LinearExpression = require("./LinearExpression");
const { SENSE } = require("./LpWriter");

const PERCENT_BASE = 100;
const HALF = 2;
const NO_CRITICAL_RATE = 0;
const MIN_CRITICAL_PERCENT = 0;
const MAX_CRITICAL_PERCENT = 100;
const MAX_CHANCE = 1;
const NO_BIG_M = 0;

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
    #boundsOfForm;
    #criticalExpansion = null;
    #criticalProducts = new Map();
    #regimesByRate = new Map();

    // statVariables: { multiplier, fixed, criticalDamage, critical } variable names
    // multiplier = element + power, fixed = damage + element damage.
    // boundsOfForm: (form, { weapon }) => { lower, upper }, bounds of an affine form of stat variables over every
    // valid stuff, or over the stuffs wearing the weapon.
    constructor({ writer, linearizer, statVariables, boundsOfForm }) {
        this.#writer = writer;
        this.#linearizer = linearizer;
        this.#statVariables = statVariables;
        this.#boundsOfForm = boundsOfForm;
    }

    // Returns the variable and its upper bound whenever the action is cast, so with its weapon worn.
    addExpectedDamage(id, action, weapon = null) {
        const normal = this.#sumLines(`${id}n`, action.normalLines, false);
        const critical = this.#sumLines(`${id}c`, action.criticalLines, true);
        const rate = action.criticalRate;
        const delta = critical.total.clone().addExpression(normal.total, -1);
        const deltaBounds = rate === NO_CRITICAL_RATE ? null : this.#boundDelta(normal.values, critical.values, delta);
        const chances = this.#findChanceRange(rate);
        const upper = this.#boundExpected(chances, normal.upper, critical.upper, deltaBounds);
        const variable = this.#writer.addVariable(`e${id}`, { upper });
        const damage = LinearExpression.ofTerm(variable);
        if (rate === NO_CRITICAL_RATE) {
            this.#addBoundRow(damage, { form: normal.total, relaxation: new LinearExpression(), bigM: NO_BIG_M });
        } else {
            this.#addCriticalRows({ damage, upper, rate, delta, deltaBounds }, normal, critical);
        }
        if (!weapon) return { variable, upper };
        const wornUpper = this.#boundExpected(
            chances,
            this.#sumWornUppers(normal.values, weapon),
            this.#sumWornUppers(critical.values, weapon),
            deltaBounds,
        );
        return { variable, upper: Math.min(upper, wornUpper) };
    }

    // Clamped critical chance of the action at both ends of the critical stat's bounds; 0 without critical rate.
    #findChanceRange(rate) {
        if (rate === NO_CRITICAL_RATE) return [0, 0];
        const { lower, upper } = this.#writer.boundsOf(this.#statVariables.critical);
        const clampChance = (stat) =>
            Math.min(Math.max(rate + stat, MIN_CRITICAL_PERCENT), MAX_CRITICAL_PERCENT) / PERCENT_BASE;
        return [clampChance(lower), clampChance(upper)];
    }

    // The expected damage (1 - c) × normal + c × critical = normal + c × delta is linear in the chance c, with
    // weights >= 0, so its maximum over the chance range is at one end: two valid bounds, the tighter one kept.
    #boundExpected(chances, normalUpper, criticalUpper, deltaBounds) {
        const byMix = Math.max(...chances.map((chance) => (1 - chance) * normalUpper + chance * criticalUpper));
        const byDelta = deltaBounds
            ? Math.max(...chances.map((chance) => normalUpper + chance * deltaBounds.upper))
            : Infinity;
        return Math.max(0, Math.min(byMix, byDelta));
    }

    #sumWornUppers(values, weapon) {
        return values.reduce((total, value) => total + Math.max(0, this.#boundsOfForm(value, { weapon }).upper), 0);
    }

    // Each regime row is relaxed by M × relaxation, which is 0 when the regime applies. Where a row's regime does
    // not apply, the true expected damage is normal + clamped chance × delta, so its M only has to cover the
    // difference between the clamped chance and the row's chance, times delta (capped by upper - form lower).
    #addCriticalRows({ damage, upper, rate, delta, deltaBounds }, normal, critical) {
        const blended = normal.total.clone().addExpression(delta, rate / PERCENT_BASE);
        blended.addExpression(this.#multiplyByCritical(delta), 1 / PERCENT_BASE);
        const regimes = this.#findRegimes(rate);
        const blendedRelaxation = new LinearExpression();
        if (regimes.low) {
            const lowRelaxation = new LinearExpression(1).addTerm(regimes.low, -1);
            const bigM = Math.min(Math.max(0, upper - normal.lower), Math.max(0, deltaBounds.upper));
            this.#addBoundRow(damage, { form: normal.total, relaxation: lowRelaxation, bigM });
            blendedRelaxation.addTerm(regimes.low, 1);
        }
        if (regimes.high) {
            const highRelaxation = new LinearExpression(1).addTerm(regimes.high, -1);
            const bigM = Math.min(Math.max(0, upper - critical.lower), Math.max(0, -deltaBounds.lower));
            this.#addBoundRow(damage, { form: critical.total, relaxation: highRelaxation, bigM });
            blendedRelaxation.addTerm(regimes.high, 1);
        }
        const bigM = this.#findBlendedBigM({ upper, rate, normalLower: normal.lower, deltaBounds });
        this.#addBoundRow(damage, { form: blended, relaxation: blendedRelaxation, bigM });
    }

    // damage <= form + M × relaxation
    #addBoundRow(damage, { form, relaxation, bigM }) {
        const row = damage.clone().addExpression(form, -1).addExpression(relaxation, -bigM);
        this.#writer.addConstraint(row, SENSE.AT_MOST);
    }

    // Outside its regime, the blended form uses a chance c = (rate + stat) / 100 outside [0, 1], so the true damage
    // exceeds it by (clamp(c) - c) × delta.
    #findBlendedBigM({ upper, rate, normalLower, deltaBounds }) {
        const critical = this.#writer.boundsOf(this.#statVariables.critical);
        const chances = [rate + critical.lower, rate + critical.upper].map((percent) => percent / PERCENT_BASE);
        const deltaCorners = [deltaBounds.lower, deltaBounds.upper];
        const blendLower =
            normalLower + Math.min(...chances.flatMap((chance) => deltaCorners.map((value) => chance * value)));
        const clampGaps = [Math.min(0, MAX_CHANCE - chances[1]), Math.max(0, -chances[0])];
        const regimeBigM = Math.max(0, ...clampGaps.flatMap((gap) => deltaCorners.map((value) => gap * value)));
        return Math.min(Math.max(0, upper - blendLower), regimeBigM);
    }

    // Range of critical - normal when every line is max(0, value): with as many lines on both sides,
    // max(0, a) - max(0, b) lies between min(0, a - b) and max(0, a - b), line by line.
    #boundDelta(normalValues, criticalValues, delta) {
        const bounds = this.#writer.boundsOfExpression(delta);
        if (normalValues.length !== criticalValues.length) return bounds;
        let lower = 0;
        let upper = 0;
        criticalValues.forEach((value, index) => {
            const lineBounds = this.#boundsOfForm(value.clone().addExpression(normalValues[index], -1), {});
            lower += Math.min(0, lineBounds.lower);
            upper += Math.max(0, lineBounds.upper);
        });
        return { lower: Math.max(bounds.lower, lower), upper: Math.min(bounds.upper, upper) };
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

    // total: the sum of max(0, line), with its bounds at the exact point of every stuff; values: each line before
    // its clamp.
    #sumLines(prefix, lines, isCritical) {
        const { multiplier, fixed, criticalDamage } = this.#statVariables;
        const sum = { total: new LinearExpression(), lower: 0, upper: 0 };
        const values = lines.map((line, index) => {
            const average = averageOf(line);
            const value = new LinearExpression(average).addTerm(multiplier, average / PERCENT_BASE).addTerm(fixed, 1);
            if (isCritical) value.addTerm(criticalDamage, 1);
            const bounds = this.#boundsOfForm(value, {});
            sum.total.addExpression(this.#clampAtZero(`${prefix}${index}`, value, bounds));
            sum.lower += Math.max(0, bounds.lower);
            sum.upper += Math.max(0, bounds.upper);
            return value;
        });
        return { ...sum, values };
    }

    // max(0, value): the value itself when it cannot be negative, else a variable exact at integer points:
    // isZero = 1 gives clamped <= 0, isZero = 0 gives clamped <= value (feasible only when value >= 0, since
    // clamped >= 0), so the best choice is max(0, value).
    #clampAtZero(name, value, { lower, upper }) {
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
