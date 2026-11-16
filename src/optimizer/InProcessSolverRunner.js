const SearchContext = require("./SearchContext");
const SolverSession = require("./SolverSession");
const WeaponGroup = require("./WeaponGroup");
const WeaponPartitioner = require("./WeaponPartitioner");
const { SOLVER_MESSAGE } = require("./solverMessages");

// Runs the solver on the calling thread, which HiGHS then blocks between stuffs: aborts only act between stuffs, and
// concurrent jobs take turns. Tests use it with in-memory game data; the CLI and the web page use SolverWorkerPool.
// size: how many jobs a search may run at once, as for the pool. createContext builds the search context of a query.
class InProcessSolverRunner {
    #gameData;
    #logger;
    #nowFn;
    #size;
    #createContext;

    constructor({
        gameData,
        logger = console,
        nowFn = Date.now,
        size = WeaponPartitioner.SINGLE_JOB,
        createContext = (queryJson) => new SearchContext(queryJson, gameData),
    }) {
        this.#gameData = gameData;
        this.#logger = logger;
        this.#nowFn = nowFn;
        this.#size = size;
        this.#createContext = createContext;
    }

    get size() {
        return this.#size;
    }

    async *run({ queryJson, deadlineMs, latestDeadlineMs, warmStartTimeMs, ...groupFields }, { signal = null } = {}) {
        if (signal?.aborted) return;
        const session = new SolverSession({
            context: WeaponGroup.fromJob(groupFields).restrict(this.#createContext(queryJson)),
            gameData: this.#gameData,
            logger: this.#logger,
            nowFn: this.#nowFn,
        });
        for await (const stuff of session.run({ deadlineMs, latestDeadlineMs, warmStartTimeMs })) {
            yield { type: SOLVER_MESSAGE.STUFF, ...stuff };
            if (signal?.aborted) return;
        }
        yield { type: SOLVER_MESSAGE.DONE, ...session.outcome };
    }
}

module.exports = InProcessSolverRunner;
