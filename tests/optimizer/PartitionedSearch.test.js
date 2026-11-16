const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const config = require("../../src/config");
const PartitionedSearch = require("../../src/optimizer/PartitionedSearch");
const SolverWorkerPool = require("../../src/optimizer/SolverWorkerPool");
const WeaponGroup = require("../../src/optimizer/WeaponGroup");
const sleep = require("../../src/utils/sleep");
const {
    buildScoreContext,
    stuffStep,
    doneStep,
    waitForAbortStep,
    failStep,
    ScriptedRunner,
} = require("./partitionFixture");

const RESULT_COUNT = 2;
const ARRIVAL_DELAY_MS = 30;
const ABORT_DELAY_MS = 20;
const SILENT_LOGGER = { error: () => {} };
const FAILURE = "worker crashed";
const SCRIPTED_WORKER_PATH = path.join(__dirname, "workers", "scriptedWorker.js");
const POOL_SIZE = 4;
const ENDLESS_HOLD_MS = 60000;
const LONG_DEADLINE_MS = 60000;
const POOL_CONFIG = { ...config, IS_DEBUG: false, TEST_LOAD_DELAY_MS: 0 };

function buildGroups(count) {
    return Array.from({ length: count }, (unused, index) => new WeaponGroup({ weaponIds: [index + 1] }));
}

async function runScripted(scripts, { signal = null, logger = SILENT_LOGGER } = {}) {
    const runner = new ScriptedRunner(scripts);
    const context = buildScoreContext(RESULT_COUNT);
    const search = new PartitionedSearch({ runner, context, groups: buildGroups(scripts.length), logger });
    const streamed = [];
    const job = { deadlineMs: Date.now() + LONG_DEADLINE_MS };
    await search.run(job, { signal, onStuff: (stuff) => streamed.push(stuff) });
    return { search, runner, streamed, results: search.listResults() };
}

function describe(stuffs) {
    return stuffs.map(({ evaluation, solverStatus }) => [evaluation.score, solverStatus]);
}

test("a partition whose proven bound cannot reach the full list is stopped, and the list stays proven", async () => {
    const { search, runner, results } = await runScripted([
        [stuffStep(100, 100), stuffStep(90, 90), doneStep()],
        [stuffStep(50, 80, ARRIVAL_DELAY_MS), waitForAbortStep()],
    ]);
    assert.deepEqual(describe(results), [
        [100, "optimal"],
        [90, "optimal"],
    ]);
    assert.equal(runner.jobs[1].isAborted, true);
    assert.equal(search.totalPrunedPartitions, 1);
    assert.deepEqual(search.outcome, { isComplete: true, isInfeasible: false });
});

test("a partition whose bound may still beat the list keeps running and can enter it", async () => {
    const { search, runner, results } = await runScripted([
        [stuffStep(100, 100), stuffStep(90, 90), doneStep()],
        [stuffStep(93, 95, ARRIVAL_DELAY_MS), stuffStep(50, 50), doneStep()],
    ]);
    assert.deepEqual(describe(results), [
        [100, "optimal"],
        [93, "gap"],
    ]);
    assert.equal(runner.jobs[1].isAborted, false);
    assert.equal(search.totalPrunedPartitions, 0);
    assert.deepEqual(search.outcome, { isComplete: true, isInfeasible: false });
});

test("a stuff proven in its own partition stays unproven while another partition proves nothing", async () => {
    const { results } = await runScripted([
        [stuffStep(100, 100), doneStep()],
        [stuffStep(50), doneStep()],
    ]);
    assert.deepEqual(describe(results), [
        [100, "heuristic"],
        [50, "heuristic"],
    ]);
});

test("a partition that loses its proof loses every proof it gave", async () => {
    const { results } = await runScripted([
        [stuffStep(100, 100), stuffStep(95), doneStep()],
        [doneStep({ isInfeasible: true })],
    ]);
    assert.deepEqual(describe(results), [
        [100, "heuristic"],
        [95, "heuristic"],
    ]);
});

test("no stuff is proven only when every partition proves it", async () => {
    const proven = await runScripted([[doneStep({ isInfeasible: true })], [doneStep({ isInfeasible: true })]]);
    assert.deepEqual(proven.search.outcome, { isComplete: true, isInfeasible: true });
    const cut = await runScripted([
        [doneStep({ isInfeasible: true })],
        [doneStep({ isComplete: false, isInfeasible: false })],
    ]);
    assert.deepEqual(cut.search.outcome, { isComplete: false, isInfeasible: false });
});

test("a stuff is streamed once every partition settled its status, and every final stuff is streamed", async () => {
    const { streamed, results } = await runScripted([
        [stuffStep(100, 100), doneStep()],
        [stuffStep(90, 90, ARRIVAL_DELAY_MS), doneStep()],
    ]);
    assert.deepEqual(describe(streamed), [
        [100, "optimal"],
        [90, "optimal"],
    ]);
    assert.deepEqual(describe(results), describe(streamed));
});

test("a stuff pushed out of the list before its status settled is never streamed", async () => {
    const { streamed } = await runScripted([
        [stuffStep(10, 10), stuffStep(5, 5), doneStep()],
        [stuffStep(100, 100, ARRIVAL_DELAY_MS), stuffStep(90, 90), doneStep()],
    ]);
    assert.deepEqual(describe(streamed), [
        [100, "optimal"],
        [90, "optimal"],
    ]);
});

test("aborting the search ends every partition job", async () => {
    const controller = new AbortController();
    const scripts = Array.from({ length: POOL_SIZE }, () => [waitForAbortStep()]);
    const running = runScripted(scripts, { signal: controller.signal });
    await sleep(ABORT_DELAY_MS);
    controller.abort();
    const { search, runner } = await running;
    assert.equal(runner.jobs.length, POOL_SIZE);
    assert.ok(runner.jobs.every((job) => job.isAborted && job.isEnded));
    assert.deepEqual(search.outcome, { isComplete: false, isInfeasible: false });
});

test("a failing partition leaves the others' stuffs, unproven and incomplete, and is logged once", async () => {
    const logs = [];
    const logger = { error: (message) => logs.push(message) };
    const { search, results } = await runScripted(
        [[failStep(FAILURE)], [failStep(FAILURE)], [stuffStep(50, 50), doneStep()]],
        { logger },
    );
    assert.deepEqual(describe(results), [[50, "heuristic"]]);
    assert.deepEqual(search.outcome, { isComplete: false, isInfeasible: false });
    assert.equal(logs.length, 1);
    assert.match(logs[0], new RegExp(`^❌ .*${FAILURE}`));
});

test("a search whose every partition fails rejects", async () => {
    await assert.rejects(runScripted([[failStep(FAILURE)], [failStep(FAILURE)]]), new RegExp(FAILURE));
});

test("a stopped partition whose bound cannot reach the list counts as complete", async () => {
    const { search, results } = await runScripted([
        [stuffStep(100, 100, ARRIVAL_DELAY_MS), stuffStep(90, 90), doneStep()],
        [stuffStep(50, 85), doneStep({ isComplete: false })],
    ]);
    assert.deepEqual(describe(results), [
        [100, "optimal"],
        [90, "optimal"],
    ]);
    assert.equal(search.totalPrunedPartitions, 1);
    assert.deepEqual(search.outcome, { isComplete: true, isInfeasible: false });
});

test("aborting a search on the worker pool terminates every partition worker", async (context) => {
    const pool = new SolverWorkerPool({
        config: POOL_CONFIG,
        size: POOL_SIZE,
        workerPath: SCRIPTED_WORKER_PATH,
        logger: SILENT_LOGGER,
    });
    context.after(() => pool.close());
    await pool.start();
    const search = new PartitionedSearch({
        runner: pool,
        context: { ...buildScoreContext(RESULT_COUNT), findItems: () => [0] },
        groups: buildGroups(POOL_SIZE),
        logger: SILENT_LOGGER,
    });
    const controller = new AbortController();
    let streamedCount = 0;
    const running = search.run(
        { holdMs: ENDLESS_HOLD_MS, deadlineMs: Date.now() + LONG_DEADLINE_MS },
        { signal: controller.signal, onStuff: () => streamedCount++ },
    );
    await sleep(ABORT_DELAY_MS);
    controller.abort();
    await running;
    assert.equal(pool.totalSpawnedWorkers, 2 * POOL_SIZE);
    assert.deepEqual(search.outcome, { isComplete: false, isInfeasible: false });
    assert.ok(streamedCount <= RESULT_COUNT);
});
