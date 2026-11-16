const path = require("path");
const { on } = require("events");
const { Worker } = require("worker_threads");
const { SOLVER_MESSAGE } = require("./solverMessages");

const DEFAULT_WORKER_PATH = path.join(__dirname, "..", "solver", "SolverWorker.js");
const MESSAGE_EVENT = "message";
const EXIT_EVENT = "exit";
const ERROR_EVENT = "error";

function listenToMessages(worker, signal = null) {
    return on(worker, MESSAGE_EVENT, { close: [EXIT_EVENT], ...(signal ? { signal } : {}) });
}

// One persistent solver worker thread: it loads the game data once, then runs one job at a time. A job that does not
// end with its done message (abort, error, crash) leaves the worker not ready: SolverWorkerPool then terminates it,
// which stops it at once, even inside a HiGHS solve.
class SolverWorkerClient {
    #config;
    #workerPath;
    #logger;
    #worker = null;
    #isReady = false;
    #hasExited = false;

    constructor({ config, workerPath = DEFAULT_WORKER_PATH, logger = console }) {
        this.#config = config;
        this.#workerPath = workerPath;
        this.#logger = logger;
    }

    get isReady() {
        return this.#isReady;
    }

    get hasExited() {
        return this.#hasExited;
    }

    async start() {
        if (this.#worker) throw new Error("Solver worker already started");
        this.#worker = new Worker(this.#workerPath, { workerData: { config: this.#config } });
        // Without a listener, an error of an idle worker would crash the whole process (the web server).
        this.#worker.on(ERROR_EVENT, (error) => this.#handleIdleError(error));
        this.#worker.on(EXIT_EVENT, () => {
            this.#hasExited = true;
            this.#isReady = false;
        });
        for await (const [message] of listenToMessages(this.#worker)) {
            if (message.type === SOLVER_MESSAGE.ERROR) throw new Error(message.message);
            if (message.type !== SOLVER_MESSAGE.READY) continue;
            // An idle worker must not keep the process alive, so a caller that never closes the pool can still exit.
            this.#worker.unref();
            this.#isReady = true;
            return;
        }
        throw new Error("Solver worker exited before being ready");
    }

    async *run(job, { signal = null } = {}) {
        if (!this.#isReady) throw new Error("Solver worker is not ready for a job");
        if (signal?.aborted) return;
        this.#isReady = false;
        const worker = this.#worker;
        const messages = listenToMessages(worker, signal);
        worker.ref();
        worker.postMessage(job);
        try {
            yield* this.#readMessages(messages);
        } catch (error) {
            if (signal?.aborted) return;
            throw error;
        } finally {
            worker.unref();
        }
    }

    async terminate() {
        this.#isReady = false;
        await this.#worker?.terminate();
    }

    // The start and the jobs read their own errors; only an error of a waiting worker is reported here.
    #handleIdleError(error) {
        if (!this.#isReady) return;
        this.#isReady = false;
        this.#logger.error(`❌ Idle solver worker failed: ${error.message}`);
    }

    async *#readMessages(messages) {
        for await (const [message] of messages) {
            if (message.type === SOLVER_MESSAGE.ERROR) throw new Error(message.message);
            const isDone = message.type === SOLVER_MESSAGE.DONE;
            // Ready before the done message is handed over: the caller may stop reading right after it.
            this.#isReady = isDone;
            yield message;
            if (isDone) return;
        }
        throw new Error("Solver worker exited before finishing");
    }
}

module.exports = SolverWorkerClient;
