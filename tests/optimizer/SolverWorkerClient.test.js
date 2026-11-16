const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { Worker } = require("worker_threads");
const config = require("../../src/config");
const SolverWorkerClient = require("../../src/optimizer/SolverWorkerClient");
const sleep = require("../../src/utils/sleep");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TEST_WORKERS_DIR = path.join(__dirname, "workers");
const TEST_CONFIG = { ...config, DATA_DIR: FIXTURES_DIR, IS_DEBUG: false };
const QUERY = { breed: "cra", level: 200, profile: { elements: ["water"] }, resultCount: 3 };
const TIME_LIMIT_MS = 10000;
const WARM_START_TIME_MS = 500;
const SOLVER_STATUSES = ["optimal", "gap", "heuristic"];
const FIXTURE_WEAPON_ID = 1;
const IDLE_CRASH_WAIT_MS = 300;

function buildJob(queryJson, fields = {}) {
    return { queryJson, deadlineMs: Date.now() + TIME_LIMIT_MS, warmStartTimeMs: WARM_START_TIME_MS, ...fields };
}

async function startClient(context, workerName = null) {
    const workerPath = workerName ? path.join(TEST_WORKERS_DIR, workerName) : undefined;
    const client = new SolverWorkerClient({ config: TEST_CONFIG, workerPath });
    context.after(() => client.terminate());
    await client.start();
    return client;
}

async function collect(messages) {
    const collected = [];
    for await (const message of messages) collected.push(message);
    return collected;
}

function listStuffIds(messages) {
    return messages.filter((message) => message.type === "stuff").map((message) => message.itemIds);
}

test("the worker streams stuff ids then a done message, and stays ready", async (context) => {
    const client = await startClient(context);
    assert.equal(client.isReady, true);
    const messages = await collect(client.run(buildJob(QUERY)));
    const stuffs = messages.filter((message) => message.type === "stuff");
    assert.equal(stuffs.length, QUERY.resultCount);
    for (const stuff of stuffs) {
        assert.ok(stuff.itemIds.every(Number.isInteger));
        assert.ok(SOLVER_STATUSES.includes(stuff.solverStatus));
    }
    assert.deepEqual(messages.at(-1), { type: "done", isComplete: true, isInfeasible: false });
    assert.equal(client.isReady, true);
});

test("a second job on the same worker gives the same stuffs", async (context) => {
    const client = await startClient(context);
    const first = listStuffIds(await collect(client.run(buildJob(QUERY))));
    const second = listStuffIds(await collect(client.run(buildJob(QUERY))));
    assert.deepEqual(second, first);
});

test("weaponIds restricts the weapon slot", async (context) => {
    const client = await startClient(context);
    const allWeapons = listStuffIds(await collect(client.run(buildJob(QUERY, { weaponIds: null }))));
    const fixtureWeapon = listStuffIds(await collect(client.run(buildJob(QUERY, { weaponIds: [FIXTURE_WEAPON_ID] }))));
    const noWeapon = listStuffIds(await collect(client.run(buildJob(QUERY, { weaponIds: [] }))));
    assert.ok(allWeapons.some((itemIds) => itemIds.includes(FIXTURE_WEAPON_ID)));
    assert.deepEqual(fixtureWeapon, allWeapons);
    assert.ok(noWeapon.length > 0);
    assert.ok(noWeapon.every((itemIds) => !itemIds.includes(FIXTURE_WEAPON_ID)));
});

test("aborting stops the job without error and leaves the worker not ready", async (context) => {
    const client = await startClient(context, "endlessWorker.js");
    const controller = new AbortController();
    const messages = [];
    for await (const message of client.run(buildJob(QUERY), { signal: controller.signal })) {
        messages.push(message);
        controller.abort();
    }
    assert.equal(messages.length, 1);
    assert.equal(client.isReady, false);
});

test("an already aborted signal leaves the worker ready", async (context) => {
    const client = await startClient(context, "endlessWorker.js");
    assert.deepEqual(await collect(client.run(buildJob(QUERY), { signal: AbortSignal.abort() })), []);
    assert.equal(client.isReady, true);
});

test("terminate stops the worker thread", async (context) => {
    const terminatedWorkers = [];
    const terminate = Worker.prototype.terminate;
    context.mock.method(Worker.prototype, "terminate", function terminateAndRecord() {
        terminatedWorkers.push(this);
        return terminate.call(this);
    });
    const client = await startClient(context, "endlessWorker.js");
    await client.terminate();
    assert.equal(terminatedWorkers.length, 1);
    assert.equal(terminatedWorkers[0].threadId, -1);
    assert.equal(client.isReady, false);
});

test("worker error messages are rethrown with their message", async (context) => {
    const client = await startClient(context);
    await assert.rejects(collect(client.run(buildJob({ ...QUERY, breed: "nobody" }))), /Unknown breed "nobody"/);
    assert.equal(client.isReady, false);
});

test("a worker failing to load its game data fails to start", async (context) => {
    const client = new SolverWorkerClient({ config: { ...TEST_CONFIG, DATA_DIR: path.join(FIXTURES_DIR, "none") } });
    context.after(() => client.terminate());
    await assert.rejects(client.start(), /Missing data in/);
});

test("an uncaught worker error fails the start", async (context) => {
    const client = new SolverWorkerClient({
        config: TEST_CONFIG,
        workerPath: path.join(TEST_WORKERS_DIR, "crashingWorker.js"),
    });
    context.after(() => client.terminate());
    await assert.rejects(client.start(), /worker crashed on start/);
});

test("a worker exiting without its done message fails", async (context) => {
    const client = await startClient(context, "silentWorker.js");
    await assert.rejects(collect(client.run(buildJob(QUERY))), /Solver worker exited before finishing/);
    assert.equal(client.isReady, false);
});

test("an idle worker error is logged and leaves the worker not ready instead of crashing the process", async (context) => {
    const logs = [];
    const client = new SolverWorkerClient({
        config: TEST_CONFIG,
        workerPath: path.join(TEST_WORKERS_DIR, "idleCrashingWorker.js"),
        logger: { error: (message) => logs.push(message) },
    });
    context.after(() => client.terminate());
    await client.start();
    assert.equal(client.isReady, true);
    await sleep(IDLE_CRASH_WAIT_MS);
    assert.equal(client.isReady, false);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^❌ .*idle worker crashed/);
});
