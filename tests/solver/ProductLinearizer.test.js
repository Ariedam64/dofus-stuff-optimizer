const test = require("node:test");
const assert = require("node:assert/strict");
const LpWriter = require("../../src/solver/LpWriter");
const LinearExpression = require("../../src/solver/LinearExpression");
const ProductLinearizer = require("../../src/solver/ProductLinearizer");
const HighsSolver = require("../../src/solver/HighsSolver");

const TIME_LIMIT_MS = 10000;
const TOLERANCE = 1e-6;

// Maximizes sign × (count × value) with count in [0, 5] (integer) and value in [-3, 4]: the bit-expanded product
// must reach the true extreme (20 or 15), not the looser LP envelope.
async function solveProduct(sign) {
    const writer = new LpWriter();
    writer.addVariable("count", { upper: 5, type: LpWriter.VARIABLE_TYPE.INTEGER });
    writer.addVariable("value", { lower: -3, upper: 4 });
    const linearizer = new ProductLinearizer(writer);
    const expansion = linearizer.expandInBits("bit", LinearExpression.ofTerm("count"));
    const product = linearizer.multiplyByExpandedInteger("product", expansion, LinearExpression.ofTerm("value"));
    writer.addVariable("objective", { lower: -100, upper: 100 });
    writer.addConstraint(product.scaled(sign).addTerm("objective", -1), LpWriter.SENSE.EQUAL);
    writer.setObjective(LinearExpression.ofTerm("objective"));
    const solver = await HighsSolver.create(writer.toString());
    try {
        return solver.solve({ timeLimitMs: TIME_LIMIT_MS });
    } finally {
        solver.dispose();
    }
}

test("a bit-expanded integer times a bounded value is exact at its extremes", async () => {
    const highest = await solveProduct(1);
    assert.equal(highest.status, HighsSolver.STATUS.OPTIMAL);
    assert.ok(Math.abs(highest.objective - 20) < TOLERANCE);
    const lowest = await solveProduct(-1);
    assert.ok(Math.abs(lowest.objective - 15) < TOLERANCE);
});

test("the LP writer refuses duplicate variables and violated constant rows", () => {
    const writer = new LpWriter();
    writer.addVariable("x");
    assert.throws(() => writer.addVariable("x"), /declared twice/);
    assert.throws(() => writer.addConstraint(new LinearExpression(2), LpWriter.SENSE.AT_MOST, 1), /violated/);
    assert.deepEqual(writer.boundsOfExpression(LinearExpression.ofTerm("x", -2).addConstant(1)), {
        lower: -Infinity,
        upper: 1,
    });
});
