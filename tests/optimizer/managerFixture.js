const path = require("path");
const config = require("../../src/config");
const GameData = require("../../src/data/GameData");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const InProcessSolverRunner = require("../../src/optimizer/InProcessSolverRunner");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TEST_CONFIG = { ...config, IS_DEBUG: false };
const PROVEN_RESULT_COUNT = 3;
const TIME_LIMIT_MS = 10000;
const BASE_QUERY = {
    breed: "cra",
    level: 200,
    profile: { elements: ["water"] },
    resultCount: PROVEN_RESULT_COUNT,
    timeLimitMs: TIME_LIMIT_MS,
};

function buildManager(gameData, { config: managerConfig = TEST_CONFIG, logger, nowFn } = {}) {
    const solverRunner = new InProcessSolverRunner({ gameData, nowFn });
    return new OptimizationManager({ gameData, config: managerConfig, logger, solverRunner });
}

let gameDataPromise;
function loadGameData() {
    gameDataPromise ??= GameData.load(FIXTURES_DIR);
    return gameDataPromise;
}

async function loadManager() {
    return buildManager(await loadGameData());
}

module.exports = {
    FIXTURES_DIR,
    TEST_CONFIG,
    PROVEN_RESULT_COUNT,
    BASE_QUERY,
    buildManager,
    loadGameData,
    loadManager,
};
