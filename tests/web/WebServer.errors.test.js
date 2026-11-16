const test = require("node:test");
const assert = require("node:assert/strict");
const QueryError = require("../../src/optimizer/QueryError");
const VALID_QUERY = require("../fixtures/craWater200.json");
const { JSON_HEADERS, StubManager, startServer, postJson, rawRequest } = require("./webServerFixture");

const MISSING_ITEM_ID = 999999;
const LOW_LEVEL = 50;
const FIXTURE_WEAPON_ID = 1;
const OTHER_SITE_ORIGIN = "http://evil.example";
const REBOUND_HOST = "evil.example";

async function assertRefusedQuery(url, query, code, pattern) {
    const response = await postJson(url, JSON.stringify(query));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.match(body.message, pattern);
}

test("an invalid query or unknown breed gives a French 400 before streaming", async (context) => {
    const manager = new StubManager();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    await assertRefusedQuery(url, {}, QueryError.CODE.INVALID_FIELD, /^Valeur invalide pour la classe/);
    await assertRefusedQuery(url, { ...VALID_QUERY, breed: "Nope" }, QueryError.CODE.UNKNOWN_BREED, /Nope/);
    assert.equal(manager.calls.length, 0);
});

test("required item conflicts give a French 400 before streaming", async (context) => {
    const manager = new StubManager();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const withRequired = (requiredItemIds, level = VALID_QUERY.level) => ({
        ...VALID_QUERY,
        level,
        constraints: { requiredItemIds },
    });
    const { CODE } = QueryError;
    await assertRefusedQuery(url, withRequired([MISSING_ITEM_ID]), CODE.UNKNOWN_REQUIRED_ITEM, /introuvable/);
    await assertRefusedQuery(
        url,
        withRequired([FIXTURE_WEAPON_ID], LOW_LEVEL),
        CODE.REQUIRED_ITEM_ABOVE_LEVEL,
        /au-dessus/,
    );
    assert.equal(manager.calls.length, 0);
});

test("a search error with a code becomes a French error event", async (context) => {
    const manager = new StubManager();
    manager.behavior = async () => {
        const details = { breedName: "Crâ", level: 200, elementKey: "earth", ignoredSpellNames: [] };
        throw new QueryError(QueryError.CODE.NO_DAMAGE_ACTION, "No earth damage action", details);
    };
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const text = await (await postJson(url, JSON.stringify(VALID_QUERY))).text();
    const error = JSON.parse(text.match(/event: error\ndata: (.*)\n/)[1]);
    assert.equal(error.code, QueryError.CODE.NO_DAMAGE_ACTION);
    assert.match(error.message, /^Aucun sort ni arme ne fait de dégâts terre pour Crâ au niveau 200\.$/);
});

test("requests from another site, another host name or without JSON are refused", async (context) => {
    const manager = new StubManager();
    const { server, url } = await startServer(manager);
    context.after(() => server.stop());
    const body = JSON.stringify(VALID_QUERY);
    const post = (headers) => rawRequest(url, { method: "POST", path: "/api/optimize", headers, body });
    assert.equal((await post({ "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post({ "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
    assert.equal((await post({ ...JSON_HEADERS, Origin: OTHER_SITE_ORIGIN })).status, 403);
    assert.equal((await post({ ...JSON_HEADERS, Host: `${REBOUND_HOST}:${new URL(url).port}` })).status, 403);
    assert.equal((await rawRequest(url, { path: "/api/meta", headers: { Host: REBOUND_HOST } })).status, 403);
    assert.equal(manager.calls.length, 0);
    const sameOrigin = await post({ "Content-Type": "application/json; charset=utf-8", Origin: url });
    assert.equal(sameOrigin.status, 200);
    const localhostUrl = `http://localhost:${new URL(url).port}`;
    const localhost = await post({ ...JSON_HEADERS, Host: new URL(localhostUrl).host, Origin: localhostUrl });
    assert.equal(localhost.status, 200);
    assert.equal(manager.calls.length, 2);
});
