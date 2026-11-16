const test = require("node:test");
const assert = require("node:assert/strict");
const ItemSet = require("../../src/data/ItemSet");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const {
    FIRE_EFFECT_ID,
    DAMAGE_PER_CAST,
    buildSpell,
    buildItem,
    buildRing,
    buildWeapon,
    buildEvaluator,
    buildFlatDamageEvaluator,
} = require("./stuffEvaluatorFixture");

const { AP, MP, CHANCE, CRITICAL, FIRE_RESISTANCE } = CHARACTERISTIC;
const SET_ID = 50;
const MISSING_SET_ID = 999;
const PERCENT_BASE = 100;
// Level 200 with scrolls: 398 Chance from 995 points plus 100 from the scroll.
const CHANCE_FROM_POINTS_AND_SCROLLS = 498;
const POINTS_DAMAGE_MULTIPLIER = (PERCENT_BASE + CHANCE_FROM_POINTS_AND_SCROLLS) / PERCENT_BASE;

test("base stats are 7 AP 3 MP at level 200", () => {
    const stats = buildEvaluator({ level: 200 }).baseStats;
    assert.equal(stats.get(AP), 7);
    assert.equal(stats.get(MP), 3);
});

test("base AP is 6 below level 100", () => {
    assert.equal(buildEvaluator({ level: 99 }).baseStats.get(AP), 6);
    assert.equal(buildEvaluator({ level: 100 }).baseStats.get(AP), 7);
});

test("baseStats cannot be mutated from outside", () => {
    const evaluator = buildEvaluator();
    evaluator.baseStats.add(AP, 5);
    assert.equal(evaluator.baseStats.get(AP), 7);
});

test("computeStats adds base and item stats", () => {
    const evaluator = buildEvaluator();
    const stats = evaluator.computeStats([
        buildItem({
            stats: [
                [CHANCE, 40],
                [AP, 1],
            ],
        }),
        buildItem({ stats: [[CHANCE, 10]] }),
    ]);
    assert.equal(stats.get(CHANCE), 50);
    assert.equal(stats.get(AP), 8);
    assert.equal(stats.get(MP), 3);
});

test("set bonus depends on worn count", () => {
    const set = new ItemSet({
        id: SET_ID,
        name: "Test set",
        itemIds: [],
        bonusesByCount: [new Stats(), new Stats([[CHANCE, 50]]), new Stats([[CHANCE, 120]])],
    });
    const evaluator = buildEvaluator({ sets: [set] });
    const first = buildItem({ setId: SET_ID });
    const second = buildItem({ slot: "boots", setId: SET_ID });
    assert.equal(evaluator.computeStats([first]).get(CHANCE), 0);
    assert.equal(evaluator.computeStats([first, second]).get(CHANCE), 50);
    assert.equal(evaluator.computeStats([first, second]).get(CHANCE), 50);
    assert.equal(set.bonusFor(2).get(CHANCE), 50);
});

test("buildActionGroups maps spells, drops other elements and adds the weapon", () => {
    const evaluator = buildEvaluator({
        spellGroups: [
            [buildSpell(), buildSpell({ name: "Fire bolt", effectId: FIRE_EFFECT_ID })],
            [buildSpell({ name: "Fire only", effectId: FIRE_EFFECT_ID })],
        ],
    });
    assert.deepEqual(
        evaluator.buildActionGroups(null).map((group) => group.map((action) => action.name)),
        [["Water bolt"]],
    );
    const weapon = buildWeapon();
    const groups = evaluator.buildActionGroups(weapon);
    assert.equal(groups.length, 2);
    assert.equal(groups[1][0].name, weapon.name);
    assert.equal(groups[1][0].kind, "weapon");
    assert.equal(evaluator.buildActionGroups(buildWeapon(FIRE_EFFECT_ID)).length, 1);
});

test("evaluate scores the planned turn", () => {
    const evaluator = buildEvaluator({ allowRingExos: false });
    const hat = buildItem({ stats: [[AP, 1]] });
    const evaluation = evaluator.evaluate([hat]);
    assert.equal(evaluation.score, 8 * DAMAGE_PER_CAST * POINTS_DAMAGE_MULTIPLIER);
    assert.equal(evaluation.turn.totalDamage, evaluation.score);
    assert.deepEqual(evaluation.items, [hat]);
    assert.deepEqual(evaluation.exos, []);
    assert.equal(evaluation.stats.get(AP), 8);
    assert.deepEqual(evaluation.assumedCriteria, []);
});

test("evaluate includes the weapon in the turn", () => {
    const evaluator = buildFlatDamageEvaluator({ allowRingExos: false });
    const weapon = buildWeapon();
    const evaluation = evaluator.evaluate([weapon, buildItem({ stats: [[AP, 4]] })]);
    assert.equal(evaluation.score, (DAMAGE_PER_CAST + 20) * POINTS_DAMAGE_MULTIPLIER);
});

test("ring without AP gets AP exo when it helps reach minAp", () => {
    const ring = buildRing();
    assert.deepEqual(buildFlatDamageEvaluator().evaluate([ring]).exos, []);
    const evaluation = buildFlatDamageEvaluator({ constraints: { minAp: 8 } }).evaluate([ring]);
    assert.deepEqual(evaluation.exos, [{ itemId: ring.id, characteristic: "ap" }]);
    assert.equal(evaluation.stats.get(AP), 8);
});

test("AP exos are spread on both rings when they raise damage", () => {
    const first = buildRing();
    const second = buildRing();
    const evaluation = buildEvaluator().evaluate([first, second]);
    assert.deepEqual(evaluation.exos, [
        { itemId: first.id, characteristic: "ap" },
        { itemId: second.id, characteristic: "ap" },
    ]);
    assert.equal(evaluation.score, 9 * DAMAGE_PER_CAST * POINTS_DAMAGE_MULTIPLIER);
});

test("ring with native AP cannot take AP exo", () => {
    const apRing = buildRing([[AP, 1]]);
    const plainRing = buildRing();
    const evaluation = buildEvaluator().evaluate([apRing, plainRing]);
    assert.deepEqual(evaluation.exos, [{ itemId: plainRing.id, characteristic: "ap" }]);
    assert.equal(evaluation.stats.get(AP), 9);
    assert.equal(buildFlatDamageEvaluator({ constraints: { minAp: 10 } }).evaluate([apRing, plainRing]), null);
});

test("ring with negative AP can take AP exo", () => {
    const ring = buildRing([[AP, -1]]);
    const evaluation = buildFlatDamageEvaluator({ constraints: { minAp: 7 } }).evaluate([ring]);
    assert.deepEqual(evaluation.exos, [{ itemId: ring.id, characteristic: "ap" }]);
});

test("ring without MP gets MP exo for minMp, not a ring with native MP", () => {
    const mpRing = buildRing([[MP, 1]]);
    const plainRing = buildRing();
    const evaluation = buildFlatDamageEvaluator({ constraints: { minMp: 5 } }).evaluate([mpRing, plainRing]);
    assert.deepEqual(evaluation.exos, [{ itemId: plainRing.id, characteristic: "mp" }]);
    assert.equal(evaluation.stats.get(MP), 5);
    assert.equal(buildFlatDamageEvaluator({ constraints: { minMp: 6 } }).evaluate([mpRing, plainRing]), null);
});

test("ring exos are disabled when allowRingExos is false", () => {
    const evaluator = buildFlatDamageEvaluator({ constraints: { minAp: 8 }, allowRingExos: false });
    assert.equal(evaluator.evaluate([buildRing()]), null);
});

test("a disabled AP exo rejects a stuff that needs it while the MP exo still applies", () => {
    const ring = buildRing();
    const withoutAp = { ap: false, mp: true };
    assert.equal(buildFlatDamageEvaluator({ constraints: { minAp: 8 }, ringExos: withoutAp }).evaluate([ring]), null);
    const evaluation = buildFlatDamageEvaluator({ constraints: { minMp: 4 }, ringExos: withoutAp }).evaluate([ring]);
    assert.deepEqual(evaluation.exos, [{ itemId: ring.id, characteristic: "mp" }]);
    assert.equal(buildEvaluator({ ringExos: withoutAp }).evaluate([buildRing(), buildRing()]).stats.get(AP), 7);
});

test("a disabled MP exo rejects a stuff that needs it while the AP exo still applies", () => {
    const ring = buildRing();
    const withoutMp = { ap: true, mp: false };
    assert.equal(buildFlatDamageEvaluator({ constraints: { minMp: 4 }, ringExos: withoutMp }).evaluate([ring]), null);
    const evaluation = buildFlatDamageEvaluator({ constraints: { minAp: 8 }, ringExos: withoutMp }).evaluate([ring]);
    assert.deepEqual(evaluation.exos, [{ itemId: ring.id, characteristic: "ap" }]);
});

test("exos are only applied to rings", () => {
    assert.equal(buildFlatDamageEvaluator({ constraints: { minAp: 8 } }).evaluate([buildItem()]), null);
});

test("returns null when constraints unreachable", () => {
    const evaluator = buildEvaluator({ constraints: { minAp: 12 } });
    const items = [buildRing(), buildRing(), buildItem({ stats: [[AP, 1]] })];
    assert.equal(evaluator.evaluate(items), null);
});

test("minResistances is checked on the element resistance", () => {
    const items = [buildItem({ stats: [[FIRE_RESISTANCE, 20]] })];
    assert.equal(buildEvaluator({ constraints: { minResistances: { fire: 30 } } }).evaluate(items), null);
    assert.notEqual(buildEvaluator({ constraints: { minResistances: { fire: 20 } } }).evaluate(items), null);
});

test("minCriticalRate is checked on the stuff critical", () => {
    const items = [buildItem({ stats: [[CRITICAL, 40]] })];
    assert.equal(buildEvaluator({ minCriticalRate: 60 }).evaluate(items), null);
    assert.notEqual(buildEvaluator({ minCriticalRate: 40 }).evaluate(items), null);
});

test("computeUpperBound plans the turn with optimistic stats", () => {
    const evaluator = buildEvaluator();
    const groups = evaluator.buildActionGroups(null);
    assert.equal(evaluator.computeUpperBound(new Stats([[AP, 12]]), groups), 12 * DAMAGE_PER_CAST);
    assert.equal(
        evaluator.computeUpperBound(
            new Stats([
                [AP, 12],
                [CHANCE, 100],
            ]),
            groups,
        ),
        24 * DAMAGE_PER_CAST,
    );
});

test("meetsConstraints checks the query minimums on given stats", () => {
    const evaluator = buildEvaluator({ constraints: { minAp: 9, minMp: 4 } });
    assert.equal(evaluator.meetsConstraints(new Stats([[AP, 9]])), false);
    assert.equal(
        evaluator.meetsConstraints(
            new Stats([
                [AP, 9],
                [MP, 4],
            ]),
        ),
        true,
    );
});

test("computeStats throws when an item references a missing set", () => {
    const orphan = buildItem({ setId: MISSING_SET_ID });
    assert.throws(() => buildEvaluator().computeStats([orphan]), /missing set 999/);
});
