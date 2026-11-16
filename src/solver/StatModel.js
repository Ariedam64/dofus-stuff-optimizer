const LinearExpression = require("./LinearExpression");
const StatBounds = require("./StatBounds");
const { SENSE } = require("./LpWriter");

// Stat variables: each one equals a weighted sum of final characteristics (items, set bonuses, exos, points,
// scrolls and base stats), with bounds valid over every valid stuff.
class StatModel {
    #writer;
    #itemModel;
    #pointModel;
    #baseStats;
    #statBounds;
    #tightenedBounds;
    #definitions = new Map();

    // tightenedBounds: Map<stat variable name, { lower, upper }> valid over every valid stuff (BoundTightener).
    constructor({ writer, itemModel, pointModel, baseStats, statBounds, tightenedBounds }) {
        this.#writer = writer;
        this.#itemModel = itemModel;
        this.#pointModel = pointModel;
        this.#baseStats = baseStats;
        this.#statBounds = statBounds;
        this.#tightenedBounds = tightenedBounds;
    }

    // [{ name, weights, isIntegral }]; an integral stat only takes integer values at integer points.
    get definitions() {
        return [...this.#definitions].map(([name, definition]) => ({ name, ...definition }));
    }

    // Bounds: the combinatorial ones, raised to the query minimum and narrowed by the tightened ones.
    addStat(name, weights, { minimum = -Infinity } = {}) {
        const expression = this.#expressNonItemPart(weights);
        for (const [characteristic, weight] of weights) {
            expression.addExpression(this.#itemModel.contributionOf(characteristic), weight);
        }
        const isIntegral = StatBounds.isIntegral(expression);
        const bounds = StatBounds.narrow(this.boundsOfWeights(weights), {
            isIntegral,
            minimum,
            tightened: this.#tightenedBounds.get(name),
        });
        this.#writer.addVariable(name, bounds);
        this.#writer.addConstraint(expression.addTerm(name, -1), SENSE.EQUAL);
        this.#definitions.set(name, { weights, isIntegral });
        return name;
    }

    // Bounds of a weighted sum of final characteristics; with a weapon, over the stuffs wearing it.
    boundsOfWeights(weights, { weapon = null } = {}) {
        const itemBounds = this.#statBounds.boundsOf(weights, { weapon });
        const otherBounds = this.#writer.boundsOfExpression(this.#expressNonItemPart(weights));
        return { lower: itemBounds.lower + otherBounds.lower, upper: itemBounds.upper + otherBounds.upper };
    }

    // Bounds of an affine form of stat variables. Weighing the characteristics together is tighter than adding
    // each stat's bounds, since one item rarely maximizes every stat at once.
    boundsOfForm(form, { weapon = null } = {}) {
        const intervalBounds = this.#writer.boundsOfExpression(form);
        const weights = new Map();
        for (const [name, coefficient] of form.terms) {
            if (!this.#definitions.has(name)) return intervalBounds;
            for (const [characteristic, weight] of this.#definitions.get(name).weights) {
                weights.set(characteristic, (weights.get(characteristic) ?? 0) + coefficient * weight);
            }
        }
        const jointBounds = this.boundsOfWeights(weights, { weapon });
        return {
            lower: Math.max(intervalBounds.lower, form.constant + jointBounds.lower),
            upper: Math.min(intervalBounds.upper, form.constant + jointBounds.upper),
        };
    }

    // Points, scrolls and base stats.
    #expressNonItemPart(weights) {
        const expression = new LinearExpression();
        for (const [characteristic, weight] of weights) {
            expression.addExpression(this.#pointModel.contributionOf(characteristic), weight);
            expression.addConstant(weight * this.#baseStats.get(characteristic));
        }
        return expression;
    }
}

module.exports = StatModel;
