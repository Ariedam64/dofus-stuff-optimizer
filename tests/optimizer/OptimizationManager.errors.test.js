const test = require("node:test");
const assert = require("node:assert/strict");
const QueryError = require("../../src/optimizer/QueryError");
const { BASE_QUERY, loadManager } = require("./managerFixture");

const MISSING_ITEM_ID = 999999;
const LOW_LEVEL = 50;
const SET_HAT_ID = 101;

test("element without damage action rejects with breed and element", async () => {
    const manager = await loadManager();
    const earthQuery = { ...BASE_QUERY, profile: { elements: ["earth"] } };
    await assert.rejects(manager.run(earthQuery), /No earth damage action for Crâ at level 200.*Flèche Conditionnelle/);
});

function isQueryError(code, details) {
    return (error) => {
        assert.ok(error instanceof QueryError);
        assert.equal(error.code, code);
        assert.deepEqual(error.details, details);
        return true;
    };
}

test("a missing damage action and an unknown required item reject with their codes", async () => {
    const manager = await loadManager();
    const earthQuery = { ...BASE_QUERY, profile: { elements: ["earth"] } };
    await assert.rejects(
        manager.run(earthQuery),
        isQueryError(QueryError.CODE.NO_DAMAGE_ACTION, {
            breedName: "Crâ",
            level: 200,
            elementKey: "earth",
            ignoredSpellNames: ["Flèche Conditionnelle"],
        }),
    );
    const missingItemQuery = { ...BASE_QUERY, constraints: { requiredItemIds: [MISSING_ITEM_ID] } };
    await assert.rejects(
        manager.run(missingItemQuery),
        isQueryError(QueryError.CODE.UNKNOWN_REQUIRED_ITEM, { itemId: MISSING_ITEM_ID }),
    );
});

test("a required item above the character level rejects the query", async () => {
    const manager = await loadManager();
    const query = { ...BASE_QUERY, level: LOW_LEVEL, constraints: { requiredItemIds: [SET_HAT_ID] } };
    await assert.rejects(
        manager.run(query),
        isQueryError(QueryError.CODE.REQUIRED_ITEM_ABOVE_LEVEL, {
            itemName: "Chapeau du Set",
            itemLevel: 100,
            level: LOW_LEVEL,
        }),
    );
});
