const test = require("node:test");
const assert = require("node:assert/strict");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const InProcessSolverRunner = require("../../src/optimizer/InProcessSolverRunner");
const { FIXTURES_DIR, TEST_CONFIG, BASE_QUERY, loadGameData, loadManager } = require("./managerFixture");

const GROUP_COUNT = 4;
// The fixture items reach 11 AP at most.
const IMPOSSIBLE_MIN_AP = 12;
const FIXTURE_WEAPON_ID = 1;
const SPLIT_QUERY = { ...BASE_QUERY, timeLimitMs: 30000 };
const LONG_TIME_LIMIT_MS = 60000;
// Time between the start of the search and the start of its partition jobs, at most.
const JOB_START_TOLERANCE_MS = 1000;
const POOL_CONFIG = { ...TEST_CONFIG, DATA_DIR: FIXTURES_DIR, MAX_SOLVER_WORKERS: GROUP_COUNT };

async function buildPartitionedManager() {
    const gameData = await loadGameData();
    const solverRunner = new InProcessSolverRunner({ gameData, size: GROUP_COUNT });
    return new OptimizationManager({ gameData, config: TEST_CONFIG, solverRunner });
}

function assertWithin(actualMs, expectedMs) {
    assert.ok(actualMs <= expectedMs && actualMs > expectedMs - JOB_START_TOLERANCE_MS, `${actualMs} ms`);
}

function describe(result) {
    const stuffs = result.results.map((stuff) => [stuff.score, stuff.solverStatus]);
    return { stuffs, isOptimal: result.isOptimal, reason: result.reason };
}

test("a search split by weapon gives the single search results, proven, and streams every result", async () => {
    const expected = await (await loadManager()).run(SPLIT_QUERY);
    const manager = await buildPartitionedManager();
    const streamed = [];
    const result = await manager.runStreaming(SPLIT_QUERY, {
        onStuff: (rank, stuff) => streamed.push({ rank, stuff }),
    });
    assert.deepEqual(describe(result), describe(expected));
    assert.deepEqual(describe(result).isOptimal, true);
    assert.deepEqual(
        streamed.map(({ rank }) => rank),
        streamed.map((unused, index) => index + 1),
    );
    const streamedScores = streamed.map(({ stuff }) => stuff.score);
    assert.ok(result.results.every((stuff) => streamedScores.includes(stuff.score)));
});

test("impossible constraints split by weapon still give no-valid-stuff", async () => {
    const manager = await buildPartitionedManager();
    const result = await manager.run({ ...SPLIT_QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } });
    assert.deepEqual([result.reason, result.isOptimal, result.results.length], ["no-valid-stuff", true, 0]);
});

test("the worker pool runs the weapon partitions in parallel with the same results", async (context) => {
    const expected = await (await loadManager()).run(SPLIT_QUERY);
    const manager = new OptimizationManager({ gameData: await loadGameData(), config: POOL_CONFIG });
    context.after(() => manager.close());
    const result = await manager.run(SPLIT_QUERY);
    assert.deepEqual(describe(result), describe(expected));
});

test("a partition gets its share of the limit, at least MIN_PARTITION_TIME_MS and at most the limit", async () => {
    const gameData = await loadGameData();
    const inner = new InProcessSolverRunner({ gameData, size: GROUP_COUNT });
    const jobs = [];
    const solverRunner = {
        size: GROUP_COUNT,
        run: (job, options) => {
            jobs.push({ ...job, startMs: Date.now() });
            return inner.run(job, options);
        },
    };
    const manager = new OptimizationManager({ gameData, config: TEST_CONFIG, solverRunner });
    const { SPLIT_SEARCH_TIME_SHARE, MIN_PARTITION_TIME_MS } = TEST_CONFIG;
    const partitionTimes = [
        [BASE_QUERY.timeLimitMs, BASE_QUERY.timeLimitMs],
        [SPLIT_QUERY.timeLimitMs, MIN_PARTITION_TIME_MS],
        [LONG_TIME_LIMIT_MS, LONG_TIME_LIMIT_MS * SPLIT_SEARCH_TIME_SHARE],
    ];
    for (const [timeLimitMs, partitionTimeMs] of partitionTimes) {
        jobs.length = 0;
        await manager.run({ ...BASE_QUERY, timeLimitMs });
        assert.deepEqual(
            jobs.map((job) => job.weaponIds),
            [[FIXTURE_WEAPON_ID], []],
        );
        for (const job of jobs) {
            assertWithin(job.deadlineMs - job.startMs, partitionTimeMs);
            // A partition without any stuff by its deadline may look for a first one until the time limit.
            assertWithin(job.latestDeadlineMs - job.startMs, timeLimitMs);
        }
    }
});
