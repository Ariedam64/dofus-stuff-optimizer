const SearchContext = require("./SearchContext");
const SolverSession = require("./SolverSession");
const { SOLVER_MESSAGE } = require("./solverMessages");

// Runs the solver on the calling thread, which HiGHS then blocks between stuffs: aborts only act between stuffs.
// Tests use it with in-memory game data; the CLI and the web page use SolverWorkerClient.
class InProcessSolverRunner {
    #gameData;
    #logger;
    #nowFn;

    constructor({ gameData, logger = console, nowFn = Date.now }) {
        this.#gameData = gameData;
        this.#logger = logger;
        this.#nowFn = nowFn;
    }

    async *run({ queryJson, deadlineMs, warmStartTimeMs, signal = null }) {
        if (signal?.aborted) return;
        const context = new SearchContext(queryJson, this.#gameData);
        const session = new SolverSession({
            context,
            gameData: this.#gameData,
            logger: this.#logger,
            nowFn: this.#nowFn,
        });
        for await (const stuff of session.run({ deadlineMs, warmStartTimeMs })) {
            yield { type: SOLVER_MESSAGE.STUFF, ...stuff };
            if (signal?.aborted) return;
        }
        yield { type: SOLVER_MESSAGE.DONE, ...session.outcome };
    }
}

module.exports = InProcessSolverRunner;
