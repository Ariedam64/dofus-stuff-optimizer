// Posts ready, then throws while idle, as a long-lived worker hit by an unexpected error would.
const { parentPort } = require("worker_threads");

const IDLE_CRASH_DELAY_MS = 50;

parentPort.postMessage({ type: "ready" });
setTimeout(() => {
    throw new Error("idle worker crashed");
}, IDLE_CRASH_DELAY_MS);
