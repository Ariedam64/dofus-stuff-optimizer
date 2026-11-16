const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { Worker } = require("worker_threads");
const config = require("../../src/config");
const SolverWorkerClient = require("../../src/optimizer/SolverWorkerClient");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TEST_WORKERS_DIR = path.join(__dirname, "workers");
const TEST_CONFIG = { ...config, DATA_DIR: FIXTURES_DIR, IS_DEBUG: false };
const QUERY = { breed: "cra", level: 200, profile: { elements: ["water"] }, resultCount: 3 };
const TIME_LIMIT_MS = 10000;
const WARM_START_TIME_MS = 500;
const SOLVER_STATUSES = ["optimal", "gap", "heuristic"];

function buildRun(queryJson, { signal, workerPath } = {}) {
    return new SolverWorkerClient({ config: TEST_CONFIG, workerPath }).run({
        queryJson,
        deadlineMs: Date.now() + TIME_LIMIT_MS,
        warmStartTimeMs: WARM_START_TIME_MS,
        signal,
    });
}

async function collect(messages) {
    const collected = [];
    for await (const message of messages) collected.push(message);
    return collected;
}

test("the worker streams stuff ids then a done message", async () => {
    const messages = await collect(buildRun(QUERY));
    const stuffs = messages.filter((message) => message.type === "stuff");
    assert.equal(stuffs.length, QUERY.resultCount);
    for (const stuff of stuffs) {
        assert.ok(stuff.itemIds.every(Number.isInteger));
        assert.ok(SOLVER_STATUSES.includes(stuff.solverStatus));
    }
    assert.deepEqual(messages.at(-1), { type: "done", isComplete: true, isInfeasible: false });
});

test("aborting terminates the worker without error", async (context) => {
    const terminatedWorkers = [];
    const terminate = Worker.prototype.terminate;
    context.mock.method(Worker.prototype, "terminate", function terminateAndRecord() {
        terminatedWorkers.push(this);
        return terminate.call(this);
    });
    const controller = new AbortController();
    const messages = [];
    const workerPath = path.join(TEST_WORKERS_DIR, "endlessWorker.js");
    for await (const message of buildRun(QUERY, { signal: controller.signal, workerPath })) {
        messages.push(message);
        controller.abort();
    }
    assert.equal(messages.length, 1);
    assert.equal(terminatedWorkers.length, 1);
    assert.equal(terminatedWorkers[0].threadId, -1);
});

test("worker error messages are rethrown with their message", async () => {
    await assert.rejects(collect(buildRun({ ...QUERY, breed: "nobody" })), /Unknown breed "nobody"/);
});

test("an uncaught worker error is rethrown", async () => {
    const workerPath = path.join(TEST_WORKERS_DIR, "crashingWorker.js");
    await assert.rejects(collect(buildRun(QUERY, { workerPath })), /worker crashed on start/);
});

test("a worker exiting without its done message fails", async () => {
    const workerPath = path.join(TEST_WORKERS_DIR, "silentWorker.js");
    await assert.rejects(collect(buildRun(QUERY, { workerPath })), /Solver worker exited before finishing/);
});
