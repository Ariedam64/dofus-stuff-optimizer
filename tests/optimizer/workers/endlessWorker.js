const { parentPort } = require("worker_threads");

const TICK_MS = 1000;

parentPort.postMessage({ type: "ready" });
parentPort.on("message", () => {
    parentPort.postMessage({ type: "stuff", itemIds: [], solverStatus: "heuristic", optimalityGapPercent: null });
    setInterval(() => {}, TICK_MS);
});
