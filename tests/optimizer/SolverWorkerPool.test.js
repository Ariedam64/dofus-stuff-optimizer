const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { Worker } = require("worker_threads");
const config = require("../../src/config");
const SolverWorkerPool = require("../../src/optimizer/SolverWorkerPool");
const sleep = require("../../src/utils/sleep");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const SCRIPTED_WORKER_PATH = path.join(__dirname, "workers", "scriptedWorker.js");
const LOAD_DELAY_MS = 400;
const SHORT_HOLD_MS = 50;
const LONG_HOLD_MS = 300;
const ENDLESS_HOLD_MS = 60000;
const TEST_CONFIG = { ...config, DATA_DIR: FIXTURES_DIR, IS_DEBUG: false, TEST_LOAD_DELAY_MS: LOAD_DELAY_MS };
const SILENT_LOGGER = { error: () => {} };
const MAX_WORKERS = 4;
const PARALLEL_POOL_SIZE = 2;

function buildPool(context, { size = 1, poolConfig = TEST_CONFIG, logger = SILENT_LOGGER } = {}) {
    const pool = new SolverWorkerPool({ config: poolConfig, size, workerPath: SCRIPTED_WORKER_PATH, logger });
    context.after(() => pool.close());
    return pool;
}

async function collect(messages) {
    const collected = [];
    for await (const message of messages) collected.push(message);
    return collected;
}

async function timeFirstMessage(pool, job) {
    const startMs = Date.now();
    let firstMessageMs = null;
    for await (const message of pool.run(job)) {
        firstMessageMs ??= Date.now() - startMs;
        if (message.type === "done") break;
    }
    return firstMessageMs;
}

test("the pool size leaves one core free and stays between 1 and the configured maximum", () => {
    assert.equal(SolverWorkerPool.computeSize(MAX_WORKERS, 12), MAX_WORKERS);
    assert.equal(SolverWorkerPool.computeSize(MAX_WORKERS, 3), 2);
    assert.equal(SolverWorkerPool.computeSize(MAX_WORKERS, 2), 1);
    assert.equal(SolverWorkerPool.computeSize(MAX_WORKERS, 1), 1);
    assert.ok(SolverWorkerPool.computeSize(MAX_WORKERS) >= 1);
});

test("a second search reuses the warm worker, so its first message comes sooner", async (context) => {
    const pool = buildPool(context);
    const firstMs = await timeFirstMessage(pool, { holdMs: SHORT_HOLD_MS });
    const secondMs = await timeFirstMessage(pool, { holdMs: SHORT_HOLD_MS });
    assert.ok(firstMs >= LOAD_DELAY_MS, `first search should wait for the load, took ${firstMs} ms`);
    assert.ok(secondMs < LOAD_DELAY_MS / 2, `second search should not reload, took ${secondMs} ms`);
    assert.equal(pool.totalSpawnedWorkers, 1);
});

test("start preloads every worker", async (context) => {
    const pool = buildPool(context, { size: PARALLEL_POOL_SIZE });
    await pool.start();
    assert.equal(pool.totalSpawnedWorkers, PARALLEL_POOL_SIZE);
    assert.ok((await timeFirstMessage(pool, { holdMs: SHORT_HOLD_MS })) < LOAD_DELAY_MS / 2);
});

test("aborting a job replaces its worker with a fresh one", async (context) => {
    const pool = buildPool(context);
    const controller = new AbortController();
    const aborted = [];
    for await (const message of pool.run({ holdMs: ENDLESS_HOLD_MS }, { signal: controller.signal })) {
        aborted.push(message);
        controller.abort();
    }
    assert.equal(aborted.length, 1);
    assert.equal(pool.totalSpawnedWorkers, 2);
    const next = await collect(pool.run({ holdMs: SHORT_HOLD_MS }));
    assert.equal(next.at(-1).type, "done");
    assert.notEqual(next[0].threadId, aborted[0].threadId);
});

test("concurrent jobs run in parallel up to the pool size, then queue", async (context) => {
    const pool = buildPool(context, { size: PARALLEL_POOL_SIZE });
    await pool.start();
    const jobs = await Promise.all([1, 2, 3].map(() => collect(pool.run({ holdMs: LONG_HOLD_MS }))));
    const [first, second, third] = jobs.map(([stuff, done]) => ({ ...stuff, ...done }));
    assert.ok(first.startedAtMs < second.finishedAtMs && second.startedAtMs < first.finishedAtMs);
    assert.notEqual(first.threadId, second.threadId);
    assert.ok(third.startedAtMs >= Math.min(first.finishedAtMs, second.finishedAtMs));
    assert.equal(pool.totalSpawnedWorkers, PARALLEL_POOL_SIZE);
});

test("a queued job aborted before it starts yields nothing and frees no worker", async (context) => {
    const pool = buildPool(context);
    await pool.start();
    const running = collect(pool.run({ holdMs: LONG_HOLD_MS }));
    const controller = new AbortController();
    const queued = collect(pool.run({ holdMs: SHORT_HOLD_MS }, { signal: controller.signal }));
    controller.abort();
    assert.deepEqual(await queued, []);
    assert.equal((await running).at(-1).type, "done");
    assert.equal(pool.totalSpawnedWorkers, 1);
});

test("close terminates every worker and refuses new jobs", async (context) => {
    const terminatedWorkers = [];
    const terminate = Worker.prototype.terminate;
    context.mock.method(Worker.prototype, "terminate", function terminateAndRecord() {
        terminatedWorkers.push(this);
        return terminate.call(this);
    });
    const pool = buildPool(context, { size: PARALLEL_POOL_SIZE });
    await pool.start();
    await pool.close();
    assert.equal(terminatedWorkers.length, PARALLEL_POOL_SIZE);
    assert.ok(terminatedWorkers.every((worker) => worker.threadId === -1));
    await assert.rejects(collect(pool.run({ holdMs: SHORT_HOLD_MS })), /Solver worker pool is closed/);
});

test("close rejects the jobs still waiting for a worker and stops the running ones", async (context) => {
    const pool = buildPool(context);
    await pool.start();
    const running = pool.run({ holdMs: ENDLESS_HOLD_MS });
    assert.equal((await running.next()).value.type, "stuff");
    const queuedRejection = assert.rejects(
        collect(pool.run({ holdMs: SHORT_HOLD_MS })),
        /Solver worker pool is closed/,
    );
    await pool.close();
    await queuedRejection;
    await assert.rejects(running.next(), /Solver worker exited before finishing/);
});

test("a worker failing to load fails its job, logs it, and is replaced for the next job", async (context) => {
    const logs = [];
    const logger = { error: (message) => logs.push(message) };
    const brokenConfig = { ...TEST_CONFIG, DATA_DIR: path.join(FIXTURES_DIR, "none") };
    const pool = new SolverWorkerPool({ config: brokenConfig, size: 1, logger });
    context.after(() => pool.close());
    await assert.rejects(collect(pool.run({})), /Missing data in/);
    assert.ok(logs.some((message) => message.startsWith("❌ Solver worker failed to start")));
    assert.equal(pool.totalSpawnedWorkers, 2);
    await assert.rejects(collect(pool.run({})), /Missing data in/);
});

test("a job aborted while its worker loads returns at once and leaves the worker loading for the next job", async (context) => {
    const pool = buildPool(context);
    const controller = new AbortController();
    const startMs = Date.now();
    const aborted = collect(pool.run({ holdMs: SHORT_HOLD_MS }, { signal: controller.signal }));
    await sleep(SHORT_HOLD_MS);
    controller.abort();
    assert.deepEqual(await aborted, []);
    assert.ok(Date.now() - startMs < LOAD_DELAY_MS, "the abort waited for the worker to load");
    assert.equal((await collect(pool.run({ holdMs: SHORT_HOLD_MS }))).at(-1).type, "done");
    assert.equal(pool.totalSpawnedWorkers, 1);
});

test("a worker that died while idle is replaced when a job takes its slot", async (context) => {
    const readyWorkers = [];
    const unref = Worker.prototype.unref;
    context.mock.method(Worker.prototype, "unref", function unrefAndRecord() {
        if (!readyWorkers.includes(this)) readyWorkers.push(this);
        return unref.call(this);
    });
    const pool = buildPool(context);
    await pool.start();
    await readyWorkers[0].terminate();
    const messages = await collect(pool.run({ holdMs: SHORT_HOLD_MS }));
    assert.equal(messages.at(-1).type, "done");
    assert.equal(pool.totalSpawnedWorkers, 2);
});
