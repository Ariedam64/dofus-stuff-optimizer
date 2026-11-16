const test = require("node:test");
const assert = require("node:assert/strict");
const { ELEMENTS, findElement, isElementKey } = require("../../src/stats/elements");

test("findElement returns the element of a known key", () => {
    assert.equal(findElement("water"), ELEMENTS.water);
});

test("findElement rejects unknown and prototype keys", () => {
    for (const key of ["wind", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
        assert.throws(() => findElement(key), new RegExp(`Unknown element "${key}"`));
        assert.equal(isElementKey(key), false);
    }
});
