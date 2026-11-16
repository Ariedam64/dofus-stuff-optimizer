const test = require("node:test");
const assert = require("node:assert/strict");
const normalizeName = require("../../src/utils/normalizeName");

test("normalizeName strips accents and case", () => {
    assert.equal(normalizeName(" Crâ "), "cra");
});

test("normalizeName strips every combining accent", () => {
    assert.equal(normalizeName("Xélor Féca Écaflip Crâ"), "xelor feca ecaflip cra");
});
