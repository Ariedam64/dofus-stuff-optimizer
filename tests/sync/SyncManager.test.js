const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const SyncManager = require("../../src/sync/SyncManager");

const EXPECTED_FILES = [
    "items.json",
    "itemSets.json",
    "breeds.json",
    "spellVariants.json",
    "spells.json",
    "spellLevels.json",
    "meta.json",
];
const TOTAL_SPELLS = 120;

function createStubClient(calls) {
    return {
        async fetchAll(endpoint, query = {}) {
            calls.push({ endpoint, query });
            if (endpoint === "items") return [{ id: 1 }];
            if (endpoint === "item-sets") return [{ id: 2 }];
            if (endpoint === "breeds") return [{ id: 3 }];
            if (endpoint === "spell-variants") {
                return [{ spellIds: Array.from({ length: TOTAL_SPELLS }, (_, index) => index + 1) }];
            }
            if (endpoint === "spells") return query.id.$in.map((id) => ({ id, spellLevels: [id * 10] }));
            if (endpoint === "spell-levels") return query.id.$in.map((id) => ({ id }));
            throw new Error(`unexpected endpoint ${endpoint}`);
        },
    };
}

test("syncAll writes every dataset and meta", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-"));
    const calls = [];
    const logs = [];
    const logger = { error: (message) => logs.push(message) };
    const counts = await new SyncManager({ client: createStubClient(calls), dataDir, logger }).syncAll();
    for (const file of EXPECTED_FILES) {
        await fs.access(path.join(dataDir, file));
    }
    assert.equal(counts["spells.json"], TOTAL_SPELLS);
    assert.equal(counts["spellLevels.json"], TOTAL_SPELLS);
    const meta = JSON.parse(await fs.readFile(path.join(dataDir, "meta.json"), "utf8"));
    assert.ok(!Number.isNaN(Date.parse(meta.syncedAt)));
    const itemsCall = calls.find((call) => call.endpoint === "items");
    assert.ok(itemsCall.query.typeId.$in.includes(1));
    assert.ok(itemsCall.query.typeId.$in.every((id) => typeof id === "number"));
    assert.equal(calls.filter((call) => call.endpoint === "spells").length, 3);
    assert.ok(logs.includes("✅ spells: 120"));
    assert.ok(!logs.some((message) => message.startsWith("🔍")));
});

test("syncAll logs chunk progress only in debug mode", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-"));
    const logs = [];
    const logger = { error: (message) => logs.push(message) };
    await new SyncManager({ client: createStubClient([]), dataDir, logger, isDebug: true }).syncAll();
    assert.ok(logs.some((message) => message.startsWith("🔍 spells")));
});
