const { parentPort, workerData } = require("worker_threads");
const GameData = require("../data/GameData");
const SearchContext = require("../optimizer/SearchContext");
const SolverSession = require("../optimizer/SolverSession");
const WeaponGroup = require("../optimizer/WeaponGroup");
const { SOLVER_MESSAGE } = require("../optimizer/solverMessages");

// Persistent worker thread: HiGHS blocks its thread for seconds, so searches run here and the main thread stays free
// for the web server and aborts. The game data is loaded once, then each job message runs one search; the pool sends
// a job only after the previous one is done. It posts the item ids of each stuff; the main thread rescores them.
class SolverWorker {
    #port;
    #gameData = null;

    constructor(port) {
        this.#port = port;
    }

    async start(config) {
        this.#gameData = await GameData.load(config.DATA_DIR);
        this.#port.on("message", (job) => this.#runJob(job).catch((error) => this.reportError(error)));
        this.#port.postMessage({ type: SOLVER_MESSAGE.READY });
    }

    reportError(error) {
        this.#port.postMessage({ type: SOLVER_MESSAGE.ERROR, message: error.message });
    }

    async #runJob({ queryJson, deadlineMs, latestDeadlineMs, warmStartTimeMs, ...groupFields }) {
        const context = WeaponGroup.fromJob(groupFields).restrict(new SearchContext(queryJson, this.#gameData));
        const session = new SolverSession({ context, gameData: this.#gameData });
        for await (const stuff of session.run({ deadlineMs, latestDeadlineMs, warmStartTimeMs })) {
            this.#port.postMessage({ type: SOLVER_MESSAGE.STUFF, ...stuff });
        }
        this.#port.postMessage({ type: SOLVER_MESSAGE.DONE, ...session.outcome });
    }
}

const solverWorker = new SolverWorker(parentPort);
solverWorker.start(workerData.config).catch((error) => solverWorker.reportError(error));
