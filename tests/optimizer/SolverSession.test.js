const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../../src/config");
const SearchContext = require("../../src/optimizer/SearchContext");
const SolverSession = require("../../src/optimizer/SolverSession");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const InProcessSolverRunner = require("../../src/optimizer/InProcessSolverRunner");
const HighsSolver = require("../../src/solver/HighsSolver");
const DiversityRule = require("../../src/solver/DiversityRule");
const { TEST_CONFIG, loadGameData } = require("./managerFixture");
const { withReplaced } = require("../solver/solverFixture");

const RESULT_COUNT = 3;
const TIME_LIMIT_MS = 10000;
const WARM_START_TIME_MS = 300;
// The fixture items reach 11 AP at most, so the AP cap itself is out of reach.
const IMPOSSIBLE_MIN_AP = 12;
const QUERY = {
    breed: "cra",
    level: 200,
    profile: { elements: ["water"] },
    resultCount: RESULT_COUNT,
    timeLimitMs: TIME_LIMIT_MS,
};
const LOAD_FAILURE = "Cannot load the HiGHS solver: out of memory";
const SOLVE_FAILURE = "HiGHS stopped with unexpected model status 99";

function buildLogger() {
    const messages = [];
    return { messages, error: (message) => messages.push(message) };
}

async function runSession(queryJson, { logger, onStuff = () => {} }) {
    const gameData = await loadGameData();
    const session = new SolverSession({ context: new SearchContext(queryJson, gameData), gameData, logger });
    const stuffs = [];
    for await (const stuff of session.run({
        deadlineMs: Date.now() + TIME_LIMIT_MS,
        warmStartTimeMs: WARM_START_TIME_MS,
    })) {
        stuffs.push(stuff);
        onStuff(stuff);
    }
    return { stuffs, outcome: session.outcome };
}

function failToLoad() {
    return async () => {
        throw new Error(LOAD_FAILURE);
    };
}

async function assertPairwiseDiverse(stuffs) {
    const gameData = await loadGameData();
    const itemsById = new Map(gameData.items.map((item) => [item.id, item]));
    const rule = new DiversityRule(config.DEFAULT_MIN_DIFFERENT_ITEMS);
    const stuffItems = stuffs.map((stuff) => stuff.itemIds.map((id) => itemsById.get(id)));
    for (const [index, items] of stuffItems.entries()) {
        assert.ok(rule.isDiverseFromAll(items, stuffItems.slice(0, index)), `stuff ${index + 1} is not diverse`);
    }
}

function assertSingleErrorLog(logger, failure) {
    assert.equal(logger.messages.length, 1);
    assert.ok(logger.messages[0].startsWith("❌"));
    assert.ok(logger.messages[0].includes(failure));
}

test("a HiGHS that cannot load leaves the warm start stuffs, unproven and not complete", async () => {
    const logger = buildLogger();
    const { stuffs, outcome } = await withReplaced(HighsSolver, "create", failToLoad, () =>
        runSession(QUERY, { logger }),
    );
    assert.ok(stuffs.length >= 1);
    assert.ok(stuffs.length <= RESULT_COUNT);
    for (const stuff of stuffs) assert.deepEqual([stuff.solverStatus, stuff.optimalityGapPercent], ["heuristic", null]);
    await assertPairwiseDiverse(stuffs);
    assert.deepEqual(outcome, { isComplete: false, isInfeasible: false });
    assertSingleErrorLog(logger, LOAD_FAILURE);
});

test("a HiGHS failure in the middle of the search keeps the stuffs already found", async () => {
    const logger = buildLogger();
    let shouldFail = false;
    const failOnceAsked = (original) =>
        function (options) {
            if (shouldFail) throw new Error(SOLVE_FAILURE);
            return original.call(this, options);
        };
    const { stuffs, outcome } = await withReplaced(HighsSolver.prototype, "solve", failOnceAsked, () =>
        runSession(QUERY, { logger, onStuff: () => (shouldFail = true) }),
    );
    const fallbackStuffs = stuffs.slice(1);
    assert.ok(fallbackStuffs.length >= 1, "no fallback stuff emitted after the failure");
    for (const stuff of fallbackStuffs) assert.equal(stuff.solverStatus, "heuristic");
    await assertPairwiseDiverse(stuffs);
    assert.deepEqual(outcome, { isComplete: false, isInfeasible: false });
    assertSingleErrorLog(logger, SOLVE_FAILURE);
});

test("impossible constraints with a failing HiGHS give time-limit-reached, never no-valid-stuff", async () => {
    const gameData = await loadGameData();
    const logger = buildLogger();
    const solverRunner = new InProcessSolverRunner({ gameData, logger });
    const manager = new OptimizationManager({ gameData, config: TEST_CONFIG, logger, solverRunner });
    const impossibleQuery = { ...QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } };
    const result = await withReplaced(HighsSolver, "create", failToLoad, () => manager.run(impossibleQuery));
    assert.deepEqual([result.reason, result.isOptimal, result.results.length], ["time-limit-reached", false, 0]);
    assertSingleErrorLog(logger, LOAD_FAILURE);
});

test("a search that proves every stuff is complete without any log", async () => {
    const logger = buildLogger();
    const { stuffs, outcome } = await runSession(QUERY, { logger });
    assert.equal(stuffs.length, RESULT_COUNT);
    assert.deepEqual(outcome, { isComplete: true, isInfeasible: false });
    assert.deepEqual(logger.messages, []);
});

test("a proven infeasibility is complete and infeasible", async () => {
    const logger = buildLogger();
    const { stuffs, outcome } = await runSession({ ...QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } }, { logger });
    assert.deepEqual(stuffs, []);
    assert.deepEqual(outcome, { isComplete: true, isInfeasible: true });
});
