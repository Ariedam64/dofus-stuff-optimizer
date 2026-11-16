const test = require("node:test");
const assert = require("node:assert/strict");
const InProcessSolverRunner = require("../../src/optimizer/InProcessSolverRunner");
const PartitionedSearch = require("../../src/optimizer/PartitionedSearch");
const WeaponPartitioner = require("../../src/optimizer/WeaponPartitioner");
const { bruteForce, isDiverse } = require("../solver/solverFixture");
const { buildRandomSearchContext } = require("./partitionFixture");

const { SINGLE_JOB } = WeaponPartitioner;

const SEEDS = [1000, 1001, 1002, 1003, 1005, 1006];
const SINGLE_SEARCH_SEEDS = [1004];
const GROUP_COUNTS = [3, 4];
const MAX_GROUP_COUNT = 4;
const SEARCH_OPTIONS = Object.freeze({ resultCount: 4, minDifferentItems: 3 });
// Edge settings: a single stuff, any one different item, and every position different.
const EDGE_OPTIONS = [
    { resultCount: 1, minDifferentItems: 3 },
    { resultCount: 3, minDifferentItems: 1 },
    { resultCount: 3, minDifferentItems: 16 },
];
const EDGE_SEEDS = [1008, 1009, 1010];
const LONG_TIME_LIMIT_MS = 120000;
const WARM_START_TIME_MS = 50;
const SCORE_TOLERANCE = 1e-6;
const UNREACHABLE_MIN_AP = 99;
const SILENT_LOGGER = { error: () => {} };

async function runPartitioned(context, groupCount) {
    const { gameData } = context;
    const runner = new InProcessSolverRunner({ gameData, size: groupCount, createContext: () => context });
    const groups = new WeaponPartitioner(context).partition(groupCount);
    const search = new PartitionedSearch({ runner, context, groups, logger: SILENT_LOGGER });
    const job = { deadlineMs: Date.now() + LONG_TIME_LIMIT_MS, warmStartTimeMs: WARM_START_TIME_MS };
    await search.run(job, { onStuff: () => {} });
    return { groups, search, results: search.listResults() };
}

function assertSameScore(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) <= SCORE_TOLERANCE * Math.max(1, Math.abs(expected)), message);
}

// Each stuff is the best one diverse from the stuffs ranked above it, as for a single search.
function assertBestDiverseList(results, all, label, { resultCount, minDifferentItems } = SEARCH_OPTIONS) {
    const isDiverseFromAll = (items, others) =>
        others.every((otherItems) => isDiverse(otherItems, items, minDifferentItems));
    const resultItems = results.map((stuff) => stuff.evaluation.items);
    for (let rank = 0; rank < resultCount; rank++) {
        const earlierItems = resultItems.slice(0, rank);
        const expected = all.find((evaluation) => isDiverseFromAll(evaluation.items, earlierItems));
        if (!expected) {
            assert.equal(results.length, rank, `${label}: no stuff left after ${rank}`);
            return;
        }
        assert.ok(rank < results.length, `${label}: stuff ${rank + 1} missing`);
        assert.ok(isDiverseFromAll(resultItems[rank], earlierItems), `${label}: stuff ${rank + 1} is not diverse`);
        assertSameScore(results[rank].evaluation.score, expected.score, `${label}: stuff ${rank + 1} score`);
        assert.equal(results[rank].solverStatus, "optimal", `${label}: stuff ${rank + 1} status`);
    }
}

test("the merged weapon partitions give the brute-force diverse list, proven, with some partitions pruned", async () => {
    let totalPrunedPartitions = 0;
    for (const seed of SEEDS) {
        const context = buildRandomSearchContext(seed, SEARCH_OPTIONS);
        const all = bruteForce(context);
        for (const groupCount of GROUP_COUNTS) {
            const label = `seed ${seed}, ${groupCount} groups`;
            const { groups, search, results } = await runPartitioned(context, groupCount);
            assert.equal(groups.length, groupCount, label);
            assertBestDiverseList(results, all, label);
            assert.deepEqual(search.outcome, { isComplete: true, isInfeasible: all.length === 0 }, label);
            totalPrunedPartitions += search.totalPrunedPartitions;
        }
    }
    assert.ok(totalPrunedPartitions > 0, "no partition was ever pruned");
});

test("the merged partitions stay exact with one stuff, one different item or every position different", async () => {
    for (const options of EDGE_OPTIONS) {
        for (const seed of EDGE_SEEDS) {
            const label = `seed ${seed}, ${options.resultCount} stuffs, ${options.minDifferentItems} different`;
            const context = buildRandomSearchContext(seed, options);
            const { search, results } = await runPartitioned(context, MAX_GROUP_COUNT);
            assertBestDiverseList(results, bruteForce(context), label, options);
            assert.equal(search.outcome.isComplete, true, label);
        }
    }
});

test("the merged partitions give the same scores as a single search", async () => {
    for (const seed of SINGLE_SEARCH_SEEDS) {
        const context = buildRandomSearchContext(seed, SEARCH_OPTIONS);
        const single = await runPartitioned(context, SINGLE_JOB);
        const merged = await runPartitioned(context, MAX_GROUP_COUNT);
        assert.equal(single.groups.length, SINGLE_JOB);
        assert.equal(merged.results.length, single.results.length, `seed ${seed}`);
        merged.results.forEach((stuff, rank) => {
            assertSameScore(stuff.evaluation.score, single.results[rank].evaluation.score, `seed ${seed}`);
        });
    }
});

test("an infeasible query is still proven infeasible across every partition", async () => {
    const context = buildRandomSearchContext(SEEDS[0], SEARCH_OPTIONS);
    context.query.minAp = UNREACHABLE_MIN_AP;
    const { groups, search, results } = await runPartitioned(context, MAX_GROUP_COUNT);
    assert.equal(groups.length, MAX_GROUP_COUNT);
    assert.deepEqual(results, []);
    assert.deepEqual(search.outcome, { isComplete: true, isInfeasible: true });
});
