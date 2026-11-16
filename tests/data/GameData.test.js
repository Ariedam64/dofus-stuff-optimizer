const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const GameData = require("../../src/data/GameData");
const QueryError = require("../../src/optimizer/QueryError");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

let gameDataPromise;
function loadGameData() {
    gameDataPromise ??= GameData.load(FIXTURES_DIR);
    return gameDataPromise;
}

test("GameData.load builds items and sets", async () => {
    const gameData = await loadGameData();
    assert.equal(gameData.items.length, 12);
    assert.deepEqual(gameData.getSet(5).itemIds, [101, 102]);
    assert.equal(gameData.getSet(999), undefined);
});

test("GameData.findBreed matches loosely", async () => {
    const gameData = await loadGameData();
    assert.equal(gameData.findBreed("CRA").id, 9);
    assert.equal(gameData.findBreed("Crâ").id, 9);
    assert.deepEqual(gameData.findBreed("cra").variantPairs, [
        [1001, 1002],
        [1003, 1004],
    ]);
});

test("GameData.findBreed lists valid names on unknown", async () => {
    const gameData = await loadGameData();
    assert.throws(() => gameData.findBreed("x"), /Unknown breed "x"\. Valid: .*Crâ/);
    assert.throws(
        () => gameData.findBreed("x"),
        (error) =>
            error instanceof QueryError && error.code === QueryError.CODE.UNKNOWN_BREED && error.details.name === "x",
    );
});

test("GameData.load points to sync when data missing", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "stuff-empty-"));
    await assert.rejects(GameData.load(emptyDir), /run "node src\/main.js sync"/);
});

test("getSpellGroups picks highest eligible grade", async () => {
    const gameData = await loadGameData();
    const groups = gameData.getSpellGroups(gameData.findBreed("cra"), 150);
    assert.equal(groups.length, 2);
    assert.deepEqual(
        groups[0].map((spell) => [spell.spellId, spell.minPlayerLevel]),
        [[1001, 132]],
    );
    assert.deepEqual(
        groups[1].map((spell) => spell.spellId),
        [1003, 1004],
    );
});

test("getSpellGroups omits empty groups", async () => {
    const gameData = await loadGameData();
    const groups = gameData.getSpellGroups(gameData.findBreed("cra"), 10);
    assert.equal(groups.length, 1);
    assert.equal(groups[0][0].spellId, 1001);
    assert.equal(groups[0][0].minPlayerLevel, 1);
});

test("GameData.load exposes the sync date", async () => {
    const gameData = await loadGameData();
    assert.equal(gameData.dataSyncedAt, "2026-11-15T00:00:00.000Z");
});

test("GameData.breeds returns a copy of every breed", async () => {
    const gameData = await loadGameData();
    const breedIds = gameData.breeds.map((breed) => breed.id);
    assert.deepEqual(breedIds, [9, 1]);
    gameData.breeds.pop();
    assert.equal(gameData.breeds.length, 2);
});
