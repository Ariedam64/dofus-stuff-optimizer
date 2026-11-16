const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../../src/config");
const GameData = require("../../src/data/GameData");
const { buildItem } = require("./optimizerFixture");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const DiversityRule = require("../../src/solver/DiversityRule");
const {
    FIXTURES_DIR,
    TEST_CONFIG,
    PROVEN_RESULT_COUNT,
    BASE_QUERY,
    buildManager,
    loadGameData,
    loadManager,
} = require("./managerFixture");

// The fixture items reach 11 AP at most, so the AP cap itself is out of reach.
const IMPOSSIBLE_MIN_AP = 12;
const MAX_INFEASIBILITY_PROOF_MS = 5000;
const FIXTURE_RESULT_COUNT = 10;
const LEVEL_200_POINTS = 995;
const SCROLL_VALUE = 100;
const CLOCK_SKEW_MS = 3600000;
const SHORTEST_TIME_LIMIT_MS = 5000;
const STRICT_MIN_DIFFERENT_ITEMS = 10;
const POINT_KEYS = ["agility", "chance", "intelligence", "strength", "vitality", "wisdom"];
const RESULT_KEYS = [
    "dataSyncedAt",
    "elapsedMs",
    "ignoredSpells",
    "isOptimal",
    "reason",
    "results",
    "unobtainableItems",
    "unsupportedItems",
];
const ENTRY_KEYS = [
    "assumedCriteria",
    "dofusbookUrl",
    "items",
    "optimalityGapPercent",
    "pointsAllocation",
    "score",
    "solverStatus",
    "stats",
    "turn",
];

test("run returns the documented result shape", async () => {
    const manager = await loadManager();
    const result = await manager.run(BASE_QUERY);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
    assert.equal(result.reason, null);
    assert.equal(result.dataSyncedAt, "2026-11-15T00:00:00.000Z");
    assert.deepEqual(result.ignoredSpells, [{ name: "Flèche Conditionnelle", reason: "no-direct-damage" }]);
    assert.equal(result.results.length, PROVEN_RESULT_COUNT);
    const [best] = result.results;
    assert.deepEqual(Object.keys(best).sort(), ENTRY_KEYS);
    assert.deepEqual(Object.keys(best.items[0]).sort(), ["exo", "id", "imgUrl", "name", "slot"]);
    assert.ok(best.turn.length > 0);
    assert.deepEqual(Object.keys(best.turn[0]).sort(), ["count", "damagePerCast", "imgUrl", "kind", "name"]);
});

test("a fixture run gives at most resultCount diverse stuffs sorted by score, with links and points", async () => {
    const gameData = await loadGameData();
    const result = await buildManager(gameData).run({ ...BASE_QUERY, resultCount: FIXTURE_RESULT_COUNT });
    assert.ok(result.results.length >= 1 && result.results.length <= FIXTURE_RESULT_COUNT);
    const scores = result.results.map((entry) => entry.score);
    assert.deepEqual(
        scores,
        [...scores].sort((first, second) => second - first),
    );
    const itemsById = new Map(gameData.items.map((item) => [item.id, item]));
    const stuffs = result.results.map((entry) => entry.items.map((item) => itemsById.get(item.id)));
    const diversityRule = new DiversityRule(config.DEFAULT_MIN_DIFFERENT_ITEMS);
    stuffs.forEach((stuff, index) => assert.ok(diversityRule.isDiverseFromAll(stuff, stuffs.slice(0, index))));
    for (const entry of result.results) {
        assert.ok(entry.dofusbookUrl.startsWith(config.DOFUSBOOK_IMPORT_URL));
        const { spentPoints, base, scrolls } = entry.pointsAllocation;
        for (const values of [spentPoints, base, scrolls]) assert.deepEqual(Object.keys(values).sort(), POINT_KEYS);
        const totalSpent = Object.values(spentPoints).reduce((sum, points) => sum + points, 0);
        assert.ok(totalSpent > 0 && totalSpent <= LEVEL_200_POINTS);
        assert.ok(Object.values(scrolls).every((value) => value === SCROLL_VALUE));
    }
});

test("variants are gone from the result", async () => {
    const manager = await loadManager();
    const result = await manager.run(BASE_QUERY);
    assert.equal(Object.hasOwn(result, "variants"), false);
});

test("a complete list of proven stuffs is optimal", async () => {
    const manager = await loadManager();
    const result = await manager.run(BASE_QUERY);
    assert.ok(result.results.every((entry) => entry.solverStatus === "optimal"));
    assert.ok(result.results.every((entry) => entry.optimalityGapPercent === 0));
    assert.equal(result.isOptimal, true);
});

test("a run that proves fewer diverse stuffs than asked is complete and optimal", async () => {
    const manager = await loadManager();
    const query = {
        ...BASE_QUERY,
        resultCount: FIXTURE_RESULT_COUNT,
        diversity: { minDifferentItems: STRICT_MIN_DIFFERENT_ITEMS },
    };
    const result = await manager.run(query);
    assert.ok(result.results.length >= 1 && result.results.length < FIXTURE_RESULT_COUNT);
    assert.ok(result.results.every((entry) => entry.solverStatus === "optimal"));
    assert.deepEqual([result.reason, result.isOptimal], [null, true]);
});

test("the shortest time limit still returns stuffs", async () => {
    const manager = await loadManager();
    const result = await manager.run({ ...BASE_QUERY, timeLimitMs: SHORTEST_TIME_LIMIT_MS });
    assert.ok(result.results.length >= 1);
    assert.notEqual(result.reason, "no-valid-stuff");
});

test("an onProgress error rejects the run instead of crashing the process", async () => {
    const gameData = await loadGameData();
    const fastProgressConfig = { ...TEST_CONFIG, PROGRESS_INTERVAL_MS: 1 };
    const manager = buildManager(gameData, { config: fastProgressConfig });
    const onProgress = () => {
        throw new Error("progress listener failed");
    };
    const query = { ...BASE_QUERY, resultCount: FIXTURE_RESULT_COUNT };
    await assert.rejects(manager.runStreaming(query, { onProgress }), /progress listener failed/);
});

test("scores and damage are rounded to one decimal and zero stats dropped", async () => {
    const manager = await loadManager();
    const [best] = (await manager.run(BASE_QUERY)).results;
    assert.equal(best.score, Math.round(best.score * 10) / 10);
    for (const cast of best.turn) assert.equal(cast.damagePerCast, Math.round(cast.damagePerCast * 10) / 10);
    assert.ok(Object.values(best.stats).every((value) => value !== 0));
    assert.equal(typeof best.stats.ap, "number");
});

test("runStreaming calls onStuff for each stuff before resolving", async () => {
    const manager = await loadManager();
    const streamed = [];
    const progresses = [];
    const result = await manager.runStreaming(BASE_QUERY, {
        onStuff: (rank, stuff) => streamed.push({ rank, stuff }),
        onProgress: (progress) => progresses.push(progress),
    });
    assert.deepEqual(
        streamed.map(({ rank }) => rank),
        [1, 2, 3],
    );
    assert.deepEqual(
        streamed.map(({ stuff }) => stuff.score).sort((first, second) => second - first),
        result.results.map((entry) => entry.score),
    );
    assert.ok(progresses.length >= streamed.length);
    assert.deepEqual(Object.keys(progresses.at(-1)).sort(), ["elapsedMs", "foundCount"]);
    assert.equal(progresses.at(-1).foundCount, PROVEN_RESULT_COUNT);
});

test("aborting mid-run resolves with the partial result", async () => {
    const manager = await loadManager();
    const controller = new AbortController();
    const result = await manager.runStreaming(
        { ...BASE_QUERY, resultCount: FIXTURE_RESULT_COUNT },
        { onStuff: () => controller.abort(), signal: controller.signal },
    );
    assert.equal(result.results.length, 1);
    assert.equal(result.reason, "time-limit-reached");
    assert.equal(result.isOptimal, false);
});

test("an already aborted signal resolves with no stuff", async () => {
    const manager = await loadManager();
    const result = await manager.runStreaming(BASE_QUERY, { signal: AbortSignal.abort() });
    assert.deepEqual([result.reason, result.isOptimal, result.results.length], ["time-limit-reached", false, 0]);
});

test("impossible constraints give no-valid-stuff within seconds", async () => {
    const manager = await loadManager();
    const startMs = Date.now();
    const result = await manager.run({ ...BASE_QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } });
    assert.ok(Date.now() - startMs < MAX_INFEASIBILITY_PROOF_MS);
    assert.deepEqual([result.reason, result.isOptimal, result.results.length], ["no-valid-stuff", true, 0]);
});

test("a deadline reached with no stuff gives time-limit-reached", async () => {
    const gameData = await loadGameData();
    const manager = buildManager(gameData, { nowFn: () => Date.now() + CLOCK_SKEW_MS });
    const result = await manager.run({ ...BASE_QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } });
    assert.deepEqual([result.reason, result.isOptimal, result.results.length], ["time-limit-reached", false, 0]);
});

test("breed without spells still works with a weapon action", async () => {
    const manager = await loadManager();
    const result = await manager.run({ ...BASE_QUERY, breed: "feca" });
    assert.ok(result.results.length >= 1);
    assert.deepEqual(result.ignoredSpells, []);
    const weaponCast = result.results[0].turn.find((cast) => cast.kind === "weapon");
    const weapon = result.results[0].items.find((item) => item.slot === "weapon");
    assert.equal(weaponCast.imgUrl, weapon.imgUrl);
});

test("unobtainable and unsupported items are listed and never worn", async () => {
    const gameData = await GameData.load(FIXTURES_DIR);
    const unobtainable = buildItem({ slot: "ring", criterion: "PN=Someone", stats: [[CHARACTERISTIC.AP, 1]] });
    const unsupported = buildItem({ slot: "ring", criterion: "CC=0", stats: [[CHARACTERISTIC.AP, 1]] });
    gameData.items.push(unobtainable, unsupported);
    const result = await buildManager(gameData).run(BASE_QUERY);
    assert.deepEqual(result.unobtainableItems, [{ id: unobtainable.id, name: unobtainable.name }]);
    assert.deepEqual(result.unsupportedItems, [{ id: unsupported.id, name: unsupported.name }]);
    const wornIds = result.results.flatMap((entry) => entry.items.map((item) => item.id));
    assert.ok(!wornIds.includes(unobtainable.id) && !wornIds.includes(unsupported.id));
});

test("elapsedMs covers the whole run", async () => {
    const manager = await loadManager();
    const startMs = Date.now();
    const result = await manager.run(BASE_QUERY);
    assert.ok(result.elapsedMs >= Date.now() - startMs - 5);
});

test("debug logs are written only when IS_DEBUG is set", async () => {
    const gameData = await loadGameData();
    const logs = [];
    const logger = { error: (message) => logs.push(message) };
    await buildManager(gameData, { logger }).run(BASE_QUERY);
    assert.deepEqual(logs, []);
    await buildManager(gameData, { logger, config: { ...TEST_CONFIG, IS_DEBUG: true } }).run(BASE_QUERY);
    assert.ok(logs.length > 0 && logs.every((message) => message.startsWith("🔍")));
    assert.ok(logs.some((message) => message.startsWith("🔍 Candidates: weapon")));
});

test("the warm start gets a minimum time even with a short time limit", async () => {
    const gameData = await loadGameData();
    const runCalls = [];
    const solverRunner = {
        async *run(options) {
            runCalls.push(options);
            yield { type: "done", isComplete: false, isInfeasible: false };
        },
    };
    const manager = new OptimizationManager({ gameData, config: TEST_CONFIG, solverRunner });
    await manager.run({ ...BASE_QUERY, timeLimitMs: SHORTEST_TIME_LIMIT_MS });
    await manager.run({ ...BASE_QUERY, timeLimitMs: config.DEFAULT_TIME_LIMIT_MS });
    assert.deepEqual(
        runCalls.map((options) => options.warmStartTimeMs),
        [config.MIN_WARM_START_TIME_MS, config.DEFAULT_TIME_LIMIT_MS * config.WARM_START_TIME_RATIO],
    );
});
