const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const QueryError = require("../../src/optimizer/QueryError");
const breedsRaw = require("../fixtures/breeds.json");
const VALID_QUERY = require("../fixtures/craWater200.json");
const { LOCALHOST, JSON_HEADERS, StubManager, startServer, postJson } = require("./webServerFixture");

const WAIT_TIMEOUT_MS = 2000;
const POLL_MS = 10;
const OVERSIZED_BODY_BYTES = 1024 * 1024 + 1;
const DONE_KEYS = ["isOptimal", "reason", "unsupportedItems", "unobtainableItems", "ignoredSpells"];

function rawGet(url, rawPath) {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
        http.get({ hostname, port, path: rawPath }, (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
        }).on("error", reject);
    });
}

function postOptimize(url, body) {
    const controller = new AbortController();
    const promise = fetch(`${url}/api/optimize`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: controller.signal,
    });
    promise.catch(() => {});
    return { controller, promise };
}

async function waitFor(condition) {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("Condition not met in time");
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

function waitsForAbort() {
    return (_query, { signal }) =>
        new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve({}));
        });
}

test("GET /api/meta lists fixture breeds, elements and sync date", async (context) => {
    const { server, url } = await startServer(new StubManager());
    context.after(() => server.stop());
    const meta = await (await fetch(`${url}/api/meta`)).json();
    assert.equal(meta.breeds.length, breedsRaw.length);
    assert.deepEqual(Object.keys(meta.breeds[0]), ["id", "name", "headUrl"]);
    assert.equal(meta.elements.length, 5);
    assert.equal(new URL(url).hostname, LOCALHOST);
    assert.equal(meta.dataSyncedAt, "2026-11-15T00:00:00.000Z");
});

test("GET /api/items autocompletes loosely and returns [] for unknown names", async (context) => {
    const { server, url } = await startServer(new StubManager());
    context.after(() => server.stop());
    const found = await (await fetch(`${url}/api/items?q=ocre`)).json();
    assert.ok(found.some((item) => item.name === "Dofus Ocre"));
    assert.deepEqual(await (await fetch(`${url}/api/items?q=zzzzqq`)).json(), []);
    assert.deepEqual(await (await fetch(`${url}/api/items`)).json(), []);
});

test("static files are served with content types and traversal is refused", async (context) => {
    const { server, url } = await startServer(new StubManager());
    context.after(() => server.stop());
    assert.match((await fetch(`${url}/`)).headers.get("content-type"), /text\/html/);
    assert.match((await fetch(`${url}/utils/dom.js`)).headers.get("content-type"), /javascript/);
    assert.match((await fetch(`${url}/mock/results.json`)).headers.get("content-type"), /json/);
    assert.equal(await rawGet(url, "/../package.json"), 404);
    assert.equal(await rawGet(url, "/%2e%2e/package.json"), 404);
    assert.equal(await rawGet(url, "/..%5Cpackage.json"), 404);
    assert.equal(await rawGet(url, "/%E0%A4%A"), 404);
    assert.equal(await rawGet(url, "/a%00.js"), 404);
    assert.equal(await rawGet(url, "/nope.js"), 404);
    assert.equal(await rawGet(url, "/api/unknown"), 404);
});

test("POST /api/optimize streams stuff events then done", async (context) => {
    const { server, url } = await startServer(new StubManager());
    context.after(() => server.stop());
    const response = await postJson(url, JSON.stringify(VALID_QUERY));
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const text = await response.text();
    const types = [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]);
    assert.deepEqual(types, ["stuff", "stuff", "done"]);
    assert.match(text, /event: stuff\ndata: \{"rank":1,"stuff":\{"score":10\}\}/);
    const done = JSON.parse(text.match(/event: done\ndata: (.*)\n/)[1]);
    assert.deepEqual(Object.keys(done), DONE_KEYS);
});

test("a second POST aborts the first search", async (context) => {
    const manager = new StubManager();
    manager.behavior = waitsForAbort();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    postOptimize(url, VALID_QUERY);
    await waitFor(() => manager.calls.length === 1);
    const second = postOptimize(url, VALID_QUERY);
    await waitFor(() => manager.calls.length === 2);
    await waitFor(() => manager.calls[0].signal.aborted);
    assert.equal(manager.calls[1].signal.aborted, false);
    second.controller.abort();
});

test("a client disconnect aborts its search", async (context) => {
    const manager = new StubManager();
    manager.behavior = waitsForAbort();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const request = postOptimize(url, VALID_QUERY);
    await waitFor(() => manager.calls.length === 1);
    request.controller.abort();
    await waitFor(() => manager.calls[0].signal.aborted);
});

test("headers are sent before the first event", async (context) => {
    const manager = new StubManager();
    manager.behavior = waitsForAbort();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const request = postOptimize(url, VALID_QUERY);
    const response = await request.promise;
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    request.controller.abort();
});

test("an abort-caused rejection ends quietly without an error event", async (context) => {
    const manager = new StubManager();
    manager.behavior = (_query, { signal }) =>
        new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const first = await postOptimize(url, VALID_QUERY).promise;
    const reading = first.text();
    const second = postOptimize(url, VALID_QUERY);
    await waitFor(() => manager.calls.length === 2);
    assert.doesNotMatch(await reading, /event: error/);
    second.controller.abort();
});

test("an oversized body gives 413", async (context) => {
    const { server, url } = await startServer(new StubManager());
    context.after(() => server.stop());
    const body = "x".repeat(OVERSIZED_BODY_BYTES);
    assert.equal((await postJson(url, body)).status, 413);
});

test("malformed JSON gives 400 and later errors become error events", async (context) => {
    const manager = new StubManager();
    manager.behavior = async (_query, { onStuff }) => {
        onStuff(1, { score: 1 });
        throw new Error("solver crashed");
    };
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const malformed = await postJson(url, "{nope");
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
        message: "La requête n'est pas un JSON valide.",
        code: QueryError.CODE.INVALID_BODY,
    });
    const text = await (await postJson(url, JSON.stringify(VALID_QUERY))).text();
    assert.match(text, /event: error\ndata: \{"message":"Erreur interne du serveur : solver crashed"\}/);
});

test("server logs go to the injected logger", async (context) => {
    const messages = [];
    const { server } = await startServer(new StubManager(), { error: (message) => messages.push(message) });
    context.after(() => server.stop());
    assert.equal(messages.length, 1);
    assert.match(messages[0], /^✅ Page ouverte sur http:\/\/127\.0\.0\.1:\d+$/);
});
