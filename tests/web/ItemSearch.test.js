const test = require("node:test");
const assert = require("node:assert/strict");
const ItemSearch = require("../../src/web/ItemSearch");

const ITEMS = [
    { id: 1, name: "Cape de l'Ocre", level: 50, slot: "cape", imgUrl: "a.png" },
    { id: 2, name: "Dofus Ocre", level: 100, slot: "dofus", imgUrl: "b.png" },
    { id: 3, name: "Ocre Brut", level: 10, slot: "ring", imgUrl: "c.png" },
    { id: 4, name: "Épée Verte", level: 20, slot: "weapon", imgUrl: "d.png" },
];

test("search is accent and case insensitive", () => {
    const search = new ItemSearch(ITEMS);
    assert.equal(search.search("EPEE")[0].id, 4);
});

test("search puts prefix matches first and returns only public fields", () => {
    const results = new ItemSearch(ITEMS).search("ocre");
    assert.deepEqual(
        results.map((item) => item.id),
        [3, 1, 2],
    );
    assert.deepEqual(Object.keys(results[0]), ["id", "name", "level", "slot", "imgUrl"]);
});

test("search returns an empty list for empty or unknown text", () => {
    const search = new ItemSearch(ITEMS);
    assert.deepEqual(search.search(""), []);
    assert.deepEqual(search.search("zzz"), []);
});

test("search honors the limit", () => {
    assert.equal(new ItemSearch(ITEMS).search("ocre", 2).length, 2);
});
