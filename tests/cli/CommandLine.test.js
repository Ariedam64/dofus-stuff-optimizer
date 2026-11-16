const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const config = require("../../src/config");
const CommandLine = require("../../src/cli/CommandLine");
const OptimizationManager = require("../../src/optimizer/OptimizationManager");
const SolverWorkerPool = require("../../src/optimizer/SolverWorkerPool");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TEST_CONFIG = { ...config, DATA_DIR: FIXTURES_DIR, IS_DEBUG: false };
const TIME_LIMIT_MS = 10000;
const ALIAS_RESULT_COUNT = 2;
const QUERY = {
    breed: "cra",
    level: 200,
    profile: { elements: ["water"] },
    resultCount: 1,
    timeLimitMs: TIME_LIMIT_MS,
};
// The fixture items reach 11 AP at most, so the AP cap itself is out of reach.
const IMPOSSIBLE_MIN_AP = 12;
const BYTE_ORDER_MARK = "\uFEFF";

function buildCommandLine() {
    const chunks = [];
    const logs = [];
    const logger = { error: (...parts) => logs.push(parts.join(" ")) };
    const stdout = { write: (text) => chunks.push(text) };
    const commandLine = new CommandLine({ config: TEST_CONFIG, stdout, logger });
    return { commandLine, chunks, logs };
}

async function writeQueryFile(content) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stuff-query-"));
    const queryPath = path.join(directory, "query.json");
    await fs.writeFile(queryPath, content);
    return queryPath;
}

test("optimize prints pretty JSON on stdout", async () => {
    const queryPath = await writeQueryFile(JSON.stringify(QUERY));
    const { commandLine, chunks, logs } = buildCommandLine();
    await commandLine.run(["optimize", "--query", queryPath]);
    const output = chunks.join("");
    assert.match(output, /^\{\n {4}"isOptimal"/);
    assert.ok(JSON.parse(output).results.length >= 1);
    assert.deepEqual(logs, ["✅ Search finished"]);
});

test("optimize reads a query file starting with a byte order mark", async () => {
    const queryPath = await writeQueryFile(BYTE_ORDER_MARK + JSON.stringify(QUERY));
    const { commandLine, chunks } = buildCommandLine();
    await commandLine.run(["optimize", "--query", queryPath]);
    assert.ok(JSON.parse(chunks.join("")).results.length >= 1);
});

test("optimize does not report success when no stuff is valid", async () => {
    const queryPath = await writeQueryFile(JSON.stringify({ ...QUERY, constraints: { minAp: IMPOSSIBLE_MIN_AP } }));
    const { commandLine, logs } = buildCommandLine();
    await commandLine.run(["optimize", "--query", queryPath]);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^❌ No valid stuff/);
});

test("optimize without --query fails", async () => {
    await assert.rejects(buildCommandLine().commandLine.run(["optimize"]), /Missing --query/);
});

test("unknown command lists available commands", async () => {
    await assert.rejects(buildCommandLine().commandLine.run(["fly"]), /Unknown command "fly".*sync, optimize, web/);
});

test("optimize accepts topCount as an alias of resultCount", async () => {
    const { resultCount, ...queryWithoutCount } = QUERY;
    assert.equal(resultCount, 1);
    const queryPath = await writeQueryFile(JSON.stringify({ ...queryWithoutCount, topCount: ALIAS_RESULT_COUNT }));
    const { commandLine, chunks } = buildCommandLine();
    await commandLine.run(["optimize", "--query", queryPath]);
    const result = JSON.parse(chunks.join(""));
    assert.equal(result.results.length, ALIAS_RESULT_COUNT);
    assert.ok(result.results.every((entry) => entry.dofusbookUrl.startsWith(config.DOFUSBOOK_IMPORT_URL)));
    assert.equal(Object.hasOwn(result, "variants"), false);
});

test("optimize loads the solver workers before the search starts its clock", async (context) => {
    const events = [];
    const startPool = SolverWorkerPool.prototype.start;
    context.mock.method(SolverWorkerPool.prototype, "start", async function startAndRecord() {
        await startPool.call(this);
        events.push("workers ready");
    });
    const runSearch = OptimizationManager.prototype.run;
    context.mock.method(OptimizationManager.prototype, "run", function runAndRecord(queryJson) {
        events.push("search");
        return runSearch.call(this, queryJson);
    });
    const queryPath = await writeQueryFile(JSON.stringify(QUERY));
    await buildCommandLine().commandLine.run(["optimize", "--query", queryPath]);
    assert.deepEqual(events, ["workers ready", "search"]);
});
