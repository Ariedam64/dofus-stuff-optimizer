const test = require("node:test");
const assert = require("node:assert/strict");
const DofusDbClient = require("../../src/sync/DofusDbClient");

const BASE_URL = "https://example.test";
const PAGE_SIZE = 50;

function createClient(fetchFn) {
    return new DofusDbClient({
        baseUrl: BASE_URL,
        pageSize: PAGE_SIZE,
        requestDelayMs: 0,
        userAgent: "test-agent",
        fetchFn,
    });
}

function createPagedStub(total, calls) {
    return async (url) => {
        calls.push(url);
        const skip = Number(new URL(url).searchParams.get("$skip"));
        const count = Math.min(PAGE_SIZE, total - skip);
        const data = Array.from({ length: count }, (_, index) => ({ id: skip + index }));
        return { ok: true, status: 200, json: async () => ({ total, limit: PAGE_SIZE, skip, data }) };
    };
}

test("fetchAll paginates until total", async () => {
    const calls = [];
    const client = createClient(createPagedStub(120, calls));
    assert.equal((await client.fetchAll("items")).length, 120);
    assert.equal(calls.length, 3);
});

test("fetchAll serializes $in arrays", async () => {
    const calls = [];
    const client = createClient(createPagedStub(1, calls));
    await client.fetchAll("items", { typeId: { $in: [1, 9] } });
    assert.match(decodeURIComponent(calls[0]), /typeId\[\$in\]\[\]=1&typeId\[\$in\]\[\]=9/);
});

test("fetchAll throws with url on HTTP error", async () => {
    const client = createClient(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await assert.rejects(client.fetchAll("items"), /failed: 403/);
});

test("fetchAll sends the user agent", async () => {
    let headers;
    const client = createClient(async (url, options) => {
        headers = options.headers;
        return { ok: true, status: 200, json: async () => ({ total: 0, data: [] }) };
    });
    await client.fetchAll("items");
    assert.equal(headers["User-Agent"], "test-agent");
});

test("fetchAll throws when a page has no numeric total", async () => {
    const client = createClient(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 1 }] }) }));
    await assert.rejects(client.fetchAll("items"), /total/);
});
