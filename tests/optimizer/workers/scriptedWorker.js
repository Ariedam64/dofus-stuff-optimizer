// Fake solver worker: loads for config.TEST_LOAD_DELAY_MS, then answers each job with one stuff, waits job.holdMs
// and posts done.
const { parentPort, workerData, threadId } = require("worker_threads");
const sleep = require("../../../src/utils/sleep");

async function runJob({ holdMs }) {
    parentPort.postMessage({ type: "stuff", itemIds: [], threadId, startedAtMs: Date.now() });
    await sleep(holdMs);
    parentPort.postMessage({ type: "done", isComplete: true, isInfeasible: false, finishedAtMs: Date.now() });
}

async function start() {
    await sleep(workerData.config.TEST_LOAD_DELAY_MS);
    parentPort.on("message", runJob);
    parentPort.postMessage({ type: "ready" });
}

start();
