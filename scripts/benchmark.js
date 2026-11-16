const fs = require("fs/promises");
const path = require("path");
const config = require("../src/config");
const GameData = require("../src/data/GameData");
const OptimizationManager = require("../src/optimizer/OptimizationManager");

const QUERIES_PATH = path.join(__dirname, "benchmarkQueries.json");
const RESULTS_DIR = path.join(__dirname, "..", "bench-results");
const JSON_INDENT = 4;
const TENTH_RANK_INDEX = 9;
const NO_VALUE = "-";
const TABLE_HEADERS = ["query", "first(s)", "total(s)", "best", "10th", "optimal", "gap%", "reason"];
const MS_PER_SECOND = 1000;
const SECONDS_DECIMALS = 1;

class Benchmark {
    #manager;
    #logger;

    constructor({ gameData, logger = console }) {
        this.#logger = logger;
        this.#manager = new OptimizationManager({ gameData, config, logger });
    }

    async runAll(queries) {
        const rows = [];
        for (const { name, query } of queries) {
            this.#logger.error(`🔄 Running ${name}`);
            rows.push(await this.#runQuery(name, query));
        }
        return rows;
    }

    async #runQuery(name, query) {
        const startMs = Date.now();
        let firstStuffMs = null;
        const onStuff = () => {
            firstStuffMs ??= Date.now() - startMs;
        };
        const result = await this.#manager.runStreaming(query, { onStuff });
        const { results } = result;
        const bestStuff = results[0];
        return {
            name,
            firstStuffMs,
            totalMs: result.elapsedMs,
            bestScore: bestStuff?.score ?? null,
            tenthScore: results[TENTH_RANK_INDEX]?.score ?? null,
            optimalCount: results.filter((stuff) => stuff.solverStatus === "optimal").length,
            bestGapPercent: bestStuff?.optimalityGapPercent ?? null,
            bestStatus: bestStuff?.solverStatus ?? null,
            reason: result.reason,
        };
    }
}

function formatSeconds(milliseconds) {
    return milliseconds === null ? NO_VALUE : (milliseconds / MS_PER_SECOND).toFixed(SECONDS_DECIMALS);
}

function formatValue(value) {
    return value ?? NO_VALUE;
}

function formatTable(rows) {
    const lines = rows.map((row) => [
        row.name,
        formatSeconds(row.firstStuffMs),
        formatSeconds(row.totalMs),
        formatValue(row.bestScore),
        formatValue(row.tenthScore),
        row.optimalCount,
        formatValue(row.bestGapPercent),
        formatValue(row.reason),
    ]);
    return [TABLE_HEADERS, ...lines].map((line) => line.join(" | ")).join("\n");
}

async function main() {
    const queries = JSON.parse(await fs.readFile(QUERIES_PATH, "utf8"));
    const gameData = await GameData.load(config.DATA_DIR);
    const rows = await new Benchmark({ gameData }).runAll(queries);
    process.stdout.write(`${formatTable(rows)}\n`);
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await fs.writeFile(path.join(RESULTS_DIR, fileName), `${JSON.stringify(rows, null, JSON_INDENT)}\n`);
    console.error(`✅ Results written to bench-results/${fileName}`);
}

main().catch((error) => {
    console.error("❌", error.message);
    process.exitCode = 1;
});
