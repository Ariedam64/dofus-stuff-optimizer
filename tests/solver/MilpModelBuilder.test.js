const test = require("node:test");
const assert = require("node:assert/strict");
const MilpModelBuilder = require("../../src/solver/MilpModelBuilder");
const { buildRandomCase, toProblem, FIRST_SEED } = require("./randomCases");

test("a builder builds one model only, so two models never share its writer", () => {
    const problem = toProblem(buildRandomCase(FIRST_SEED));
    const structureFirst = new MilpModelBuilder(problem);
    structureFirst.buildStructure();
    assert.throws(() => structureFirst.build(), /one model only/);
    const modelFirst = new MilpModelBuilder(problem);
    modelFirst.build();
    assert.throws(() => modelFirst.buildStructure(), /one model only/);
    assert.throws(() => modelFirst.build(), /one model only/);
});
