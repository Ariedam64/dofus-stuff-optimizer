const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const config = require("../../src/config");
const GameData = require("../../src/data/GameData");
const SearchContext = require("../../src/optimizer/SearchContext");
const ResultFormatter = require("../../src/optimizer/ResultFormatter");
const DofusbookLinkEncoder = require("../../src/export/DofusbookLinkEncoder");
const Stats = require("../../src/stats/Stats");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const QUERY = { breed: "cra", level: 200, profile: { elements: ["water"] } };
const WAND_ID = 1;
const RING_IDS = [4, 5];
const SMALL_GAP_PERCENT = 4.26;
const ROUNDED_SMALL_GAP_PERCENT = 4.3;
const LARGE_GAP_PERCENT = 80.2;
const SCROLL_VALUE = 100;
const CRA_ID = 9;
const POINT_KEYS = ["vitality", "wisdom", "strength", "intelligence", "chance", "agility"];
const RAW_AP = 15;
const RAW_MP = 8;
const RAW_RANGE = 11;
const RAW_CHANCE = 900;

let fixturePromise;
async function loadFixture() {
    fixturePromise ??= GameData.load(FIXTURES_DIR).then((gameData) => {
        const context = new SearchContext(QUERY, gameData);
        const evaluation = context.evaluator.evaluate(context.findItems([WAND_ID, ...RING_IDS]));
        const formatter = new ResultFormatter({
            query: context.query,
            gameData,
            maxReportedGapPercent: config.MAX_REPORTED_GAP_PERCENT,
        });
        return { evaluation, formatter };
    });
    return fixturePromise;
}

test("a small gap is reported rounded to one decimal", async () => {
    const { evaluation, formatter } = await loadFixture();
    const stuff = formatter.formatStuff({ evaluation, solverStatus: "gap", optimalityGapPercent: SMALL_GAP_PERCENT });
    assert.deepEqual([stuff.solverStatus, stuff.optimalityGapPercent], ["gap", ROUNDED_SMALL_GAP_PERCENT]);
});

test("a gap at the reporting limit is kept", async () => {
    const { evaluation, formatter } = await loadFixture();
    const optimalityGapPercent = config.MAX_REPORTED_GAP_PERCENT;
    const stuff = formatter.formatStuff({ evaluation, solverStatus: "gap", optimalityGapPercent });
    assert.deepEqual([stuff.solverStatus, stuff.optimalityGapPercent], ["gap", optimalityGapPercent]);
});

test("a gap above the reporting limit is shown as heuristic", async () => {
    const { evaluation, formatter } = await loadFixture();
    const stuff = formatter.formatStuff({ evaluation, solverStatus: "gap", optimalityGapPercent: LARGE_GAP_PERCENT });
    assert.deepEqual([stuff.solverStatus, stuff.optimalityGapPercent], ["heuristic", null]);
});

test("optimal and heuristic statuses are kept as given", async () => {
    const { evaluation, formatter } = await loadFixture();
    const optimal = formatter.formatStuff({ evaluation, solverStatus: "optimal", optimalityGapPercent: 0 });
    const heuristic = formatter.formatStuff({ evaluation, solverStatus: "heuristic", optimalityGapPercent: null });
    assert.deepEqual([optimal.solverStatus, optimal.optimalityGapPercent], ["optimal", 0]);
    assert.deepEqual([heuristic.solverStatus, heuristic.optimalityGapPercent], ["heuristic", null]);
});

test("points are named and the Dofusbook link carries items, points and scrolls", async () => {
    const { evaluation, formatter } = await loadFixture();
    const stuff = formatter.formatStuff({ evaluation, solverStatus: "optimal", optimalityGapPercent: 0 });
    const { spentPoints, base, scrolls } = stuff.pointsAllocation;
    assert.ok(spentPoints.chance > 0);
    assert.equal(base.chance, evaluation.pointsAllocation.baseStats.get(CHARACTERISTIC.CHANCE));
    assert.deepEqual(Object.keys(scrolls), POINT_KEYS);
    assert.ok(Object.values(scrolls).every((value) => value === SCROLL_VALUE));
    const expectedUrl = new DofusbookLinkEncoder().encode({
        level: QUERY.level,
        breedId: CRA_ID,
        name: `Optimiseur Crâ ${Math.round(evaluation.score)}`,
        items: stuff.items.map(({ slot, id, exo }) => ({ slot, id, exo })),
        spentPoints: {
            vi: spentPoints.vitality,
            fo: spentPoints.strength,
            in: spentPoints.intelligence,
            ch: spentPoints.chance,
            ag: spentPoints.agility,
            sa: spentPoints.wisdom,
        },
        scrolls: {
            vi: SCROLL_VALUE,
            fo: SCROLL_VALUE,
            in: SCROLL_VALUE,
            ch: SCROLL_VALUE,
            ag: SCROLL_VALUE,
            sa: SCROLL_VALUE,
        },
    });
    assert.equal(stuff.dofusbookUrl, expectedUrl);
});

test("item lists keep only id and name", async () => {
    const { formatter } = await loadFixture();
    assert.deepEqual(formatter.formatItemList([{ id: 1, name: "Baguette", slot: "weapon" }]), [
        { id: 1, name: "Baguette" },
    ]);
});

test("displayed AP, MP and range are capped at 12, 6 and 9", async () => {
    const { evaluation, formatter } = await loadFixture();
    const { AP, MP, RANGE, CHANCE } = CHARACTERISTIC;
    const stats = new Stats([
        [AP, RAW_AP],
        [MP, RAW_MP],
        [RANGE, RAW_RANGE],
        [CHANCE, RAW_CHANCE],
    ]);
    const stuff = formatter.formatStuff({ evaluation: { ...evaluation, stats }, solverStatus: "optimal" });
    const { MAX_AP, MAX_MP, MAX_RANGE } = config;
    assert.deepEqual(stuff.stats, { ap: MAX_AP, mp: MAX_MP, range: MAX_RANGE, chance: RAW_CHANCE });
    assert.equal(stats.get(AP), RAW_AP);
});
