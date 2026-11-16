const test = require("node:test");
const assert = require("node:assert/strict");
const PointAllocator = require("../../src/character/PointAllocator");
const CriterionEvaluator = require("../../src/rules/CriterionEvaluator");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

const { AP, STRENGTH, INTELLIGENCE, CHANCE, AGILITY, VITALITY, WISDOM } = CHARACTERISTIC;
const BASE_CHARACTERISTICS = [STRENGTH, INTELLIGENCE, CHANCE, AGILITY, VITALITY, WISDOM];

function sumSpentPoints(allocation) {
    return BASE_CHARACTERISTICS.reduce((total, characteristic) => total + allocation.spentPoints[characteristic], 0);
}

function buildAllocator({ level = 200, useScrolls = false, elementCharacteristic = CHANCE } = {}) {
    return new PointAllocator({ level, useScrolls, elementCharacteristic });
}

test("available points are 5 per level above 1", () => {
    assert.equal(buildAllocator({ level: 200 }).availablePoints, 995);
    assert.equal(buildAllocator({ level: 150 }).availablePoints, 745);
    assert.equal(buildAllocator({ level: 1 }).availablePoints, 0);
});

test("costOf follows the tiers of the four elemental characteristics", () => {
    const allocator = buildAllocator();
    assert.equal(allocator.costOf(AGILITY, 0, 101), 102);
    assert.equal(allocator.costOf(STRENGTH, 0, 100), 100);
    assert.equal(allocator.costOf(INTELLIGENCE, 150, 250), 250);
    assert.equal(allocator.costOf(CHANCE, 0, 398), 992);
    assert.equal(allocator.costOf(CHANCE, 50, 50), 0);
});

test("costOf is flat for vitality and wisdom", () => {
    const allocator = buildAllocator();
    assert.equal(allocator.costOf(VITALITY, 0, 500), 500);
    assert.equal(allocator.costOf(WISDOM, 0, 100), 300);
});

test("without criteria every point goes to the element characteristic", () => {
    const allocation = buildAllocator().allocate({ itemStats: new Stats(), criteria: [] });
    assert.equal(allocation.baseStats.get(CHANCE), 398);
    assert.equal(allocation.spentPoints[CHANCE], 992);
    for (const characteristic of [STRENGTH, INTELLIGENCE, AGILITY, VITALITY, WISDOM]) {
        assert.equal(allocation.spentPoints[characteristic], 0);
        assert.equal(allocation.baseStats.get(characteristic), 0);
    }
    assert.deepEqual(allocation.scrollStats.ids(), []);
});

test("scrolls add 100 to the six characteristics without changing the point tiers", () => {
    const allocation = buildAllocator({ useScrolls: true }).allocate({ itemStats: new Stats(), criteria: [] });
    assert.equal(allocation.baseStats.get(CHANCE), 398);
    assert.equal(allocation.baseStats.get(CHANCE) + allocation.scrollStats.get(CHANCE), 498);
    for (const characteristic of BASE_CHARACTERISTICS) assert.equal(allocation.scrollStats.get(characteristic), 100);
});

test("an OR criterion takes the cheapest branch", () => {
    const allocation = buildAllocator({ elementCharacteristic: INTELLIGENCE }).allocate({
        itemStats: new Stats([[AGILITY, 200]]),
        criteria: ["CA>249|CS>249"],
    });
    assert.equal(allocation.baseStats.get(AGILITY), 50);
    assert.equal(allocation.spentPoints[AGILITY], 50);
    assert.equal(allocation.baseStats.get(STRENGTH), 0);
    assert.equal(allocation.spentPoints[STRENGTH], 0);
    assert.equal(allocation.spentPoints[INTELLIGENCE], 944);
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 386);
});

test("thresholds count item, scroll and base values together", () => {
    const allocation = buildAllocator({ useScrolls: true, elementCharacteristic: INTELLIGENCE }).allocate({
        itemStats: new Stats([[AGILITY, 100]]),
        criteria: ["CA>249|CS>249"],
    });
    assert.equal(allocation.baseStats.get(AGILITY), 50);
    assert.equal(allocation.spentPoints[AGILITY], 50);
    assert.equal(allocation.spentPoints[STRENGTH], 0);
});

test("a threshold already met by items and scrolls costs nothing", () => {
    const allocation = buildAllocator({ useScrolls: true, elementCharacteristic: INTELLIGENCE }).allocate({
        itemStats: new Stats([[AGILITY, 200]]),
        criteria: ["CA>249|CS>249"],
    });
    assert.equal(allocation.spentPoints[AGILITY], 0);
    assert.equal(allocation.spentPoints[STRENGTH], 0);
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 398);
});

test("a branch on the element characteristic is preferred because those points still raise damage", () => {
    const allocation = buildAllocator({ elementCharacteristic: STRENGTH }).allocate({
        itemStats: new Stats([[AGILITY, 200]]),
        criteria: ["CA>249|CS>249"],
    });
    assert.equal(allocation.spentPoints[AGILITY], 0);
    assert.equal(allocation.baseStats.get(STRENGTH), 398);
});

test("branches are combined across criteria", () => {
    const allocation = buildAllocator({ elementCharacteristic: INTELLIGENCE }).allocate({
        itemStats: new Stats([[AGILITY, 200]]),
        criteria: ["CA>249|CS>249", "CS>299"],
    });
    assert.equal(allocation.baseStats.get(AGILITY), 0);
    assert.equal(allocation.baseStats.get(STRENGTH), 300);
    assert.equal(allocation.spentPoints[STRENGTH], 600);
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 231);
});

test("an unreachable threshold gives null", () => {
    const allocator = buildAllocator({ level: 20, useScrolls: true, elementCharacteristic: AGILITY });
    assert.equal(allocator.allocate({ itemStats: new Stats(), criteria: ["CI>399"] }), null);
});

test("atoms on other stats decide which branches are possible", () => {
    const allocator = buildAllocator({ elementCharacteristic: AGILITY });
    const criterion = "(CI>99&CP>11)|CC>99";
    const withoutAp = allocator.allocate({ itemStats: new Stats([[AP, 11]]), criteria: [criterion] });
    assert.equal(withoutAp.baseStats.get(CHANCE), 100);
    assert.equal(withoutAp.baseStats.get(INTELLIGENCE), 0);
    const withAp = allocator.allocate({
        itemStats: new Stats([
            [AP, 12],
            [CHANCE, -50],
        ]),
        criteria: [criterion],
    });
    assert.equal(withAp.baseStats.get(INTELLIGENCE), 100);
    assert.equal(withAp.baseStats.get(CHANCE), 0);
    assert.equal(allocator.allocate({ itemStats: new Stats([[AP, 12]]), criteria: ["CI>99&CP<12"] }), null);
});

test("level and breed atoms use the criterion context", () => {
    const allocator = buildAllocator({ elementCharacteristic: AGILITY });
    const criteria = ["PL>150&CI>49|CC>99"];
    const context = { level: 200, breedId: 9, setBonusLevel: 0 };
    const allocation = allocator.allocate({ itemStats: new Stats(), criteria, criterionContext: context });
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 50);
    const lowLevel = allocator.allocate({
        itemStats: new Stats(),
        criteria,
        criterionContext: { ...context, level: 100 },
    });
    assert.equal(lowLevel.baseStats.get(CHANCE), 100);
});

test("an upper bound caps the points spent on the element characteristic", () => {
    const allocation = buildAllocator({ elementCharacteristic: STRENGTH }).allocate({
        itemStats: new Stats([[STRENGTH, 10]]),
        criteria: ["CS<40&CI>80"],
    });
    assert.equal(allocation.baseStats.get(STRENGTH), 29);
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 81);
    assert.equal(sumSpentPoints(allocation), 29 + 81);
});

test("an upper bound already exceeded by items gives null", () => {
    const allocator = buildAllocator({ useScrolls: true });
    assert.equal(allocator.allocate({ itemStats: new Stats(), criteria: ["CI<100&CC<100"] }), null);
});

test("allocateMostCriteria keeps the criteria that fit together", () => {
    const allocator = buildAllocator({ level: 100, elementCharacteristic: AGILITY });
    const allocation = allocator.allocateMostCriteria({ itemStats: new Stats(), criteria: ["CI>199", "CC>199"] });
    assert.equal(allocation.baseStats.get(INTELLIGENCE), 200);
    assert.equal(allocation.baseStats.get(CHANCE), 0);
    assert.equal(allocation.isComplete, false);
    const complete = allocator.allocateMostCriteria({ itemStats: new Stats(), criteria: ["CI>199"] });
    assert.equal(complete.isComplete, true);
});

test("CriterionEvaluator.listBranches expands a criterion into AND branches", () => {
    const evaluator = new CriterionEvaluator();
    const branches = evaluator.listBranches("CS>299&(CI>299|CC>299)");
    assert.deepEqual(
        branches.map((branch) => branch.map((atom) => atom.text)),
        [
            ["CS>299", "CI>299"],
            ["CS>299", "CC>299"],
        ],
    );
    assert.deepEqual(branches[0][0], { code: "CS", operator: ">", value: "299", text: "CS>299" });
    assert.deepEqual(evaluator.listBranches(""), [[]]);
    assert.throws(() => evaluator.listBranches("CS>"), /Invalid criterion/);
});
