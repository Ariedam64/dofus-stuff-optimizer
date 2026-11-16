// Exits on its first job without posting the done message.
const { parentPort } = require("worker_threads");

parentPort.postMessage({ type: "ready" });
parentPort.on("message", () => process.exit());
