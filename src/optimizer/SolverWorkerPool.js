const os = require("os");
const SolverWorkerClient = require("./SolverWorkerClient");

const MIN_POOL_SIZE = 1;
// One core stays free for the main thread (web server, rescoring) and the rest of the machine.
const RESERVED_CORES = 1;
const CLOSED_MESSAGE = "Solver worker pool is closed";
const NO_SLOT = null;

// Persistent solver workers with their game data already loaded, so a search no longer pays the load. Each slot holds
// one worker and the promise of its start; a job waits in line while every slot is busy. A worker that ends a job
// without its done message (abort, error, crash) is terminated and replaced by a fresh one that preloads at once.
class SolverWorkerPool {
    #config;
    #size;
    #workerPath;
    #logger;
    #idleSlots = [];
    #waitingJobs = [];
    #clients = new Set();
    #isStarted = false;
    #isClosed = false;
    #totalSpawnedWorkers = 0;

    constructor({
        config,
        size = SolverWorkerPool.computeSize(config.MAX_SOLVER_WORKERS),
        workerPath,
        logger = console,
    }) {
        this.#config = config;
        this.#size = size;
        this.#workerPath = workerPath;
        this.#logger = logger;
    }

    static computeSize(maxWorkers, availableParallelism = os.availableParallelism()) {
        return Math.max(MIN_POOL_SIZE, Math.min(availableParallelism - RESERVED_CORES, maxWorkers));
    }

    get size() {
        return this.#size;
    }

    get totalSpawnedWorkers() {
        return this.#totalSpawnedWorkers;
    }

    async start() {
        this.#assertOpen();
        this.#ensureStarted();
        await Promise.all(this.#idleSlots.map((slot) => slot.ready));
    }

    // options: { signal }, as for SolverWorkerClient.run.
    async *run(job, options = {}) {
        const { signal = null } = options;
        this.#assertOpen();
        if (signal?.aborted) return;
        this.#ensureStarted();
        const slot = await this.#acquireSlot(signal);
        if (slot === NO_SLOT) return;
        let isAbortedWhileLoading = false;
        try {
            isAbortedWhileLoading = !(await this.#waitUntilReady(slot, signal));
            if (isAbortedWhileLoading) return;
            this.#assertOpen();
            yield* slot.client.run(job, options);
        } finally {
            if (isAbortedWhileLoading) {
                this.#handBack(slot);
            } else {
                await this.#releaseSlot(slot);
            }
        }
    }

    async close() {
        this.#isClosed = true;
        const closedError = new Error(CLOSED_MESSAGE);
        for (const waitingJob of this.#waitingJobs.splice(0)) waitingJob.reject(closedError);
        this.#idleSlots = [];
        const clients = [...this.#clients];
        this.#clients.clear();
        await Promise.all(clients.map((client) => client.terminate()));
    }

    #assertOpen() {
        if (this.#isClosed) throw new Error(CLOSED_MESSAGE);
    }

    #ensureStarted() {
        if (this.#isStarted) return;
        this.#isStarted = true;
        for (let index = 0; index < this.#size; index++) this.#idleSlots.push(this.#spawnSlot());
    }

    #spawnSlot() {
        const client = new SolverWorkerClient({
            config: this.#config,
            workerPath: this.#workerPath,
            logger: this.#logger,
        });
        this.#clients.add(client);
        this.#totalSpawnedWorkers++;
        const ready = client.start();
        // The job that takes this slot gets the error too; logging here also reports a replacement nobody waits for.
        ready.catch((error) => this.#logStartFailure(error));
        return { client, ready };
    }

    #logStartFailure(error) {
        if (this.#isClosed) return;
        this.#logger.error(`❌ Solver worker failed to start: ${error.message}`);
    }

    // Returns the slot itself when one is idle, so that jobs take the free workers in call order.
    #acquireSlot(signal) {
        if (this.#idleSlots.length > 0) return this.#replaceIfExited(this.#idleSlots.shift());
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                this.#waitingJobs = this.#waitingJobs.filter((waitingJob) => waitingJob !== queuedJob);
                resolve(NO_SLOT);
            };
            const queuedJob = {
                resolve: (slot) => {
                    signal?.removeEventListener("abort", onAbort);
                    resolve(slot);
                },
                reject,
            };
            this.#waitingJobs.push(queuedJob);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    // A worker that died while idle (or failed its start) is replaced before a job takes its slot.
    #replaceIfExited(slot) {
        if (!slot.client.hasExited) return slot;
        this.#clients.delete(slot.client);
        return this.#spawnSlot();
    }

    // Resolves false when the signal aborts first; a start failure is thrown.
    async #waitUntilReady(slot, signal) {
        if (signal?.aborted) return false;
        if (!signal) {
            await slot.ready;
            return true;
        }
        let onAbort;
        const abort = new Promise((resolve) => {
            onAbort = () => resolve(false);
            signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
            return await Promise.race([slot.ready.then(() => true), abort]);
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    // A slot whose worker is still loading goes to the next job as it is.
    #handBack(slot) {
        if (!this.#isClosed) this.#handOver(slot);
    }

    async #releaseSlot(slot) {
        const isReusable = slot.client.isReady && !this.#isClosed;
        if (!isReusable) await this.#retire(slot.client);
        if (this.#isClosed) return;
        this.#handOver(isReusable ? slot : this.#spawnSlot());
    }

    async #retire(client) {
        this.#clients.delete(client);
        await client.terminate();
    }

    #handOver(slot) {
        const waitingJob = this.#waitingJobs.shift();
        if (waitingJob) {
            waitingJob.resolve(slot);
        } else {
            this.#idleSlots.push(slot);
        }
    }
}

module.exports = SolverWorkerPool;
