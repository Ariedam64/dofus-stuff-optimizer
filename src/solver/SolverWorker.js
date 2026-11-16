const { parentPort, workerData } = require("worker_threads");
const GameData = require("../data/GameData");
const SearchContext = require("../optimizer/SearchContext");
const SolverSession = require("../optimizer/SolverSession");
const { SOLVER_MESSAGE } = require("../optimizer/solverMessages");

// Worker thread entry: HiGHS blocks its thread for seconds, so the search runs here and the main thread stays free
// for the web server and aborts. It posts the item ids of each stuff; the main thread rescores them.
class SolverWorker {
    #port;

    constructor(port) {
        this.#port = port;
    }

    async run({ config, queryJson, deadlineMs, warmStartTimeMs }) {
        const gameData = await GameData.load(config.DATA_DIR);
        const session = new SolverSession({ context: new SearchContext(queryJson, gameData), gameData });
        for await (const stuff of session.run({ deadlineMs, warmStartTimeMs })) {
            this.#port.postMessage({ type: SOLVER_MESSAGE.STUFF, ...stuff });
        }
        this.#port.postMessage({ type: SOLVER_MESSAGE.DONE, ...session.outcome });
    }

    reportError(error) {
        this.#port.postMessage({ type: SOLVER_MESSAGE.ERROR, message: error.message });
    }
}

const solverWorker = new SolverWorker(parentPort);
solverWorker.run(workerData).catch((error) => solverWorker.reportError(error));
