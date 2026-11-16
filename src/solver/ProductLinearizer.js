const LinearExpression = require("./LinearExpression");

const { SENSE, VARIABLE_TYPE } = require("./LpWriter");

const BIT_BASE = 2;

// Exact linear forms of products that involve integers: at integer points the added variables equal the products.
class ProductLinearizer {
    #writer;

    constructor(writer) {
        this.#writer = writer;
    }

    // Writes value - lower = sum of 2^j bits; returns the bits as [{ variable, weight }] (empty for a constant value).
    expandInBits(prefix, expression) {
        const bounds = this.#writer.boundsOfExpression(expression);
        const lower = Math.floor(bounds.lower);
        const span = Math.ceil(bounds.upper) - lower;
        if (span <= 0) return { lower, bits: [] };
        const bitCount = Math.ceil(Math.log2(span + 1));
        const bits = [];
        const sum = new LinearExpression();
        for (let index = 0; index < bitCount; index++) {
            const variable = this.#writer.addBinary(`${prefix}_${index}`);
            const weight = BIT_BASE ** index;
            bits.push({ variable, weight });
            sum.addTerm(variable, weight);
        }
        this.#writer.addConstraint(expression.clone().addExpression(sum, -1), SENSE.EQUAL, lower);
        return { lower, bits };
    }

    // McCormick envelope of binary × expression: exact whenever the binary is 0 or 1.
    multiplyByBinary(name, binary, expression) {
        const { lower, upper } = this.#writer.boundsOfExpression(expression);
        const product = this.#writer.addVariable(name, {
            lower: Math.min(0, lower),
            upper: Math.max(0, upper),
            type: VARIABLE_TYPE.CONTINUOUS,
        });
        const productTerm = LinearExpression.ofTerm(product);
        this.#writer.addConstraint(productTerm.clone().addTerm(binary, -upper), SENSE.AT_MOST);
        this.#writer.addConstraint(productTerm.clone().addTerm(binary, -lower), SENSE.AT_LEAST);
        const slack = expression.clone().addExpression(productTerm, -1);
        this.#writer.addConstraint(slack.clone().addTerm(binary, lower), SENSE.AT_LEAST, lower);
        this.#writer.addConstraint(slack.clone().addTerm(binary, upper), SENSE.AT_MOST, upper);
        return product;
    }

    // Exact linear form of (bit-expanded integer) × expression.
    multiplyByExpandedInteger(prefix, expansion, expression) {
        const product = expression.scaled(expansion.lower);
        for (const { variable, weight } of expansion.bits) {
            product.addTerm(this.multiplyByBinary(`${prefix}_${variable}`, variable, expression), weight);
        }
        return product;
    }
}

module.exports = ProductLinearizer;
