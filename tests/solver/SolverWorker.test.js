const test = require("node:test");
const assert = require("node:assert/strict");
const SolverWorkerPool = require("../../src/optimizer/SolverWorkerPool");
const WeaponGroup = require("../../src/optimizer/WeaponGroup");
const { SOLVER_MESSAGE } = require("../../src/optimizer/solverMessages");
const { FIXTURES_DIR, TEST_CONFIG, BASE_QUERY } = require("../optimizer/managerFixture");

const POOL_CONFIG = { ...TEST_CONFIG, DATA_DIR: FIXTURES_DIR };
const SILENT_LOGGER = { error: () => {} };
const FIXTURE_WEAPON_ID = 1;
// A weapon partition: its warm start cannot keep the stuff without a weapon that an instant local search gives.
const WEAPON_GROUP = new WeaponGroup({ weaponIds: [FIXTURE_WEAPON_ID], isWeaponRequired: true });
const RESULT_COUNT = 2;
const LATEST_DEADLINE_DELAY_MS = 20000;
const NO_WARM_START_MS = 0;

test("a worker job with no stuff by its deadline runs on for one, up to the latest deadline", async (context) => {
    const pool = new SolverWorkerPool({ config: POOL_CONFIG, size: 1, logger: SILENT_LOGGER });
    context.after(() => pool.close());
    await pool.start();
    const startMs = Date.now();
    const job = {
        queryJson: { ...BASE_QUERY, resultCount: RESULT_COUNT },
        deadlineMs: startMs,
        latestDeadlineMs: startMs + LATEST_DEADLINE_DELAY_MS,
        warmStartTimeMs: NO_WARM_START_MS,
        ...WEAPON_GROUP.toJobFields(),
    };
    const messages = [];
    for await (const message of pool.run(job)) messages.push({ ...message, receivedAtMs: Date.now() });
    const stuffs = messages.filter((message) => message.type === SOLVER_MESSAGE.STUFF);
    const done = messages.at(-1);
    // Once it holds its first stuff, the job keeps its own deadline, already passed.
    assert.equal(stuffs.length, 1);
    assert.ok(stuffs[0].receivedAtMs > job.deadlineMs);
    assert.deepEqual([done.type, done.isComplete], [SOLVER_MESSAGE.DONE, false]);
    assert.ok(done.receivedAtMs < job.latestDeadlineMs);
});
