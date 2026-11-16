const fs = require("fs/promises");
const { parseArgs } = require("node:util");
const DofusDbClient = require("../sync/DofusDbClient");
const SyncManager = require("../sync/SyncManager");
const GameData = require("../data/GameData");
const OptimizationManager = require("../optimizer/OptimizationManager");
const SolverWorkerPool = require("../optimizer/SolverWorkerPool");

const COMMAND_SYNC = "sync";
const COMMAND_OPTIMIZE = "optimize";
const COMMAND_WEB = "web";
const COMMANDS = [COMMAND_SYNC, COMMAND_OPTIMIZE, COMMAND_WEB];
const JSON_INDENT = 4;
const OPTIONS = { query: { type: "string" } };
// Some Windows editors save UTF-8 with a byte order mark, which JSON.parse rejects.
const BYTE_ORDER_MARK = "\uFEFF";

class CommandLine {
    #config;
    #stdout;
    #logger;

    constructor({ config, stdout = process.stdout, logger = console }) {
        this.#config = config;
        this.#stdout = stdout;
        this.#logger = logger;
    }

    async run(argv) {
        const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
        const [command] = positionals;
        if (command === COMMAND_SYNC) return this.#runSync();
        if (command === COMMAND_OPTIMIZE) return this.#runOptimize(values.query);
        if (command === COMMAND_WEB) return this.#runWeb();
        throw new Error(`Unknown command "${command ?? ""}". Available commands: ${COMMANDS.join(", ")}`);
    }

    async #runSync() {
        const config = this.#config;
        const client = new DofusDbClient({
            baseUrl: config.DOFUSDB_BASE_URL,
            pageSize: config.PAGE_SIZE,
            requestDelayMs: config.REQUEST_DELAY_MS,
            userAgent: config.USER_AGENT,
        });
        const logger = this.#logger;
        await new SyncManager({ client, dataDir: config.DATA_DIR, logger, isDebug: config.IS_DEBUG }).syncAll();
        logger.error("✅ Sync complete");
    }

    async #runOptimize(queryPath) {
        if (!queryPath) throw new Error("Missing --query <file.json>");
        const queryJson = await this.#readQueryFile(queryPath);
        const result = await this.#optimize(queryJson);
        this.#stdout.write(`${JSON.stringify(result, null, JSON_INDENT)}\n`);
        this.#logOutcome(result);
    }

    // The solver workers load their game data while this thread loads its own, so the time limit of the search is not
    // spent on loading.
    async #optimize(queryJson) {
        const config = this.#config;
        const workerPool = new SolverWorkerPool({ config, logger: this.#logger });
        try {
            const [gameData] = await Promise.all([GameData.load(config.DATA_DIR), workerPool.start()]);
            const manager = new OptimizationManager({
                gameData,
                config,
                logger: this.#logger,
                solverRunner: workerPool,
            });
            return await manager.run(queryJson);
        } finally {
            await workerPool.close();
        }
    }

    // The web server is only loaded by the web command.
    async #runWeb() {
        const WebServer = require("../web/WebServer");
        const config = this.#config;
        const gameData = await GameData.load(config.DATA_DIR);
        const manager = this.#createManager(gameData);
        const server = new WebServer({
            gameData,
            manager,
            host: config.WEB_HOST,
            port: config.WEB_PORT,
            publicDir: config.PUBLIC_DIR,
            breeds: gameData.breeds,
        });
        await server.start();
        // The page is usable at once; the solver workers load their game data meanwhile, before the first search.
        manager
            .startWorkers()
            .catch((error) => this.#logger.error(`❌ Cannot start the solver workers: ${error.message}`));
    }

    #createManager(gameData) {
        return new OptimizationManager({ gameData, config: this.#config, logger: this.#logger });
    }

    #logOutcome(result) {
        const { REASON } = OptimizationManager;
        if (result.reason === REASON.NO_VALID_STUFF) {
            this.#logger.error("❌ No valid stuff for these constraints");
            return;
        }
        if (result.reason === REASON.TIME_LIMIT) {
            this.#logger.error("⚠️ Time limit reached, results may not be optimal");
            return;
        }
        this.#logger.error(result.isOptimal ? "✅ Search finished" : "✅ Search finished, not proven optimal");
    }

    async #readQueryFile(queryPath) {
        try {
            const text = await fs.readFile(queryPath, "utf8");
            return JSON.parse(text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text);
        } catch (error) {
            throw new Error(`Cannot read query file ${queryPath}: ${error.message}`);
        }
    }
}

module.exports = CommandLine;
