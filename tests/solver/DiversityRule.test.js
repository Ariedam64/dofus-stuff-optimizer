const test = require("node:test");
const assert = require("node:assert/strict");
const DiversityRule = require("../../src/solver/DiversityRule");
const { SLOT } = require("../../src/data/slots");
const { buildItem, buildWeapon } = require("./solverFixture");

const weapon = buildWeapon();
const otherWeapon = buildWeapon();
const [firstRing, secondRing, thirdRing] = [1, 2, 3].map(() => buildItem({ slot: SLOT.RING }));
const [firstHat, secondHat] = [1, 2].map(() => buildItem({ slot: SLOT.HAT }));

test("a different weapon is always diverse", () => {
    const rule = new DiversityRule(16);
    assert.equal(rule.isDiverse([weapon, firstHat], [otherWeapon, firstHat]), true);
});

test("swapped rings match and empty positions match each other", () => {
    const rule = new DiversityRule(1);
    assert.equal(rule.isDiverse([weapon, firstRing, secondRing], [weapon, secondRing, firstRing]), false);
    assert.equal(rule.isDiverse([weapon], [weapon]), false);
});

test("differences are counted over the 16 positions", () => {
    const rule = new DiversityRule(2);
    // hat changed (1) and one ring changed (1): 2 differences.
    assert.equal(
        rule.isDiverse([weapon, firstHat, firstRing, secondRing], [weapon, secondHat, firstRing, thirdRing]),
        true,
    );
    // hat changed and a ring added in an empty position: 2 differences.
    assert.equal(rule.isDiverse([weapon, firstHat, firstRing], [weapon, secondHat, firstRing, thirdRing]), true);
    // only the hat changed.
    assert.equal(rule.isDiverse([weapon, firstHat], [weapon, secondHat]), false);
});
