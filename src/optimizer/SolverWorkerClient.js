const path = require("path");
const { on } = require("events");
const { Worker } = require("worker_threads");
const { SOLVER_MESSAGE } = require("./solverMessages");

const DEFAULT_WORKER_PATH = path.join(__dirname, "..", "solver", "SolverWorker.js");
const MESSAGE_EVENT = "message";
const EXIT_EVENT = "exit";

// Runs each search in a new worker thread; aborting terminates the worker at once, even inside a HiGHS solve.
class SolverWorkerClient {
    #config;
    #workerPath;

    constructor({ config, workerPath = DEFAULT_WORKER_PATH }) {
        this.#config = config;
        this.#workerPath = workerPath;
    }

    async *run({ queryJson, deadlineMs, warmStartTimeMs, signal = null }) {
        if (signal?.aborted) return;
        const workerData = { config: this.#config, queryJson, deadlineMs, warmStartTimeMs };
        const worker = new Worker(this.#workerPath, { workerData });
        try {
            yield* this.#readMessages(worker, signal);
        } catch (error) {
            if (signal?.aborted) return;
            throw error;
        } finally {
            await worker.terminate();
        }
    }

    async *#readMessages(worker, signal) {
        const options = { close: [EXIT_EVENT], ...(signal ? { signal } : {}) };
        for await (const [message] of on(worker, MESSAGE_EVENT, options)) {
            if (message.type === SOLVER_MESSAGE.ERROR) throw new Error(message.message);
            yield message;
            if (message.type === SOLVER_MESSAGE.DONE) return;
        }
        throw new Error("Solver worker exited before finishing");
    }
}

module.exports = SolverWorkerClient;
