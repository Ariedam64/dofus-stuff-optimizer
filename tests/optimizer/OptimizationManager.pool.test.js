const test = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("worker_threads");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const { FIXTURES_DIR, TEST_CONFIG, BASE_QUERY, loadGameData, loadManager } = require("./managerFixture");

const POOL_CONFIG = { ...TEST_CONFIG, DATA_DIR: FIXTURES_DIR, MAX_SOLVER_WORKERS: 1 };

function listScores(result) {
    return result.results.map((stuff) => stuff.score);
}

async function buildPoolManager(context) {
    const manager = new OptimizationManager({ gameData: await loadGameData(), config: POOL_CONFIG });
    context.after(() => manager.close());
    return manager;
}

test("searches in the worker pool give the same results as in process, search after search", async (context) => {
    const expected = await (await loadManager()).run(BASE_QUERY);
    const manager = await buildPoolManager(context);
    await manager.startWorkers();
    const first = await manager.run(BASE_QUERY);
    const second = await manager.run(BASE_QUERY);
    assert.deepEqual(listScores(first), listScores(expected));
    assert.deepEqual(listScores(second), listScores(expected));
    assert.deepEqual([second.isOptimal, second.reason], [expected.isOptimal, expected.reason]);
});

test("close terminates the pool workers, and a later search starts a new pool", async (context) => {
    const terminatedWorkers = [];
    const terminate = Worker.prototype.terminate;
    context.mock.method(Worker.prototype, "terminate", function terminateAndRecord() {
        terminatedWorkers.push(this);
        return terminate.call(this);
    });
    const manager = await buildPoolManager(context);
    await manager.run(BASE_QUERY);
    await manager.close();
    assert.equal(terminatedWorkers.length, POOL_CONFIG.MAX_SOLVER_WORKERS);
    assert.ok((await manager.run(BASE_QUERY)).results.length > 0);
});

test("startWorkers does nothing with an injected solver runner", async () => {
    const manager = await loadManager();
    await manager.startWorkers();
    await manager.close();
    assert.ok((await manager.run(BASE_QUERY)).results.length > 0);
});
