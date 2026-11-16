const test = require("node:test");
const assert = require("node:assert/strict");
const CandidateFilter = require("../../src/optimizer/CandidateFilter");
const { CHARACTERISTIC } = require("../../src/stats/characteristics");
const { SET_ID, buildQuery, buildItem, buildGameData, candidateIds } = require("./candidateFilterFixture");

const { CHANCE, AP, AGILITY, STRENGTH } = CHARACTERISTIC;
const PRYSMARADITE_TYPE_ID = 217;
const DOFUS_TYPE_ID = 23;
const TROPHY_TYPE_ID = 151;
const DOFUS_CAPACITY = 6;

function buildTrophy() {
    return buildItem({ slot: "dofus", typeId: TROPHY_TYPE_ID, criterion: "pk<2", stats: { [CHANCE]: 1 } });
}

test("criterion must match for dominance", () => {
    const restricted = buildItem({ criterion: "CS>100", stats: { [CHANCE]: 10 } });
    const otherRestriction = buildItem({ criterion: "CI>100", stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [restricted, otherRestriction], "hat").length, 2);
    const unrestricted = buildItem({ stats: { [CHANCE]: 20 } });
    assert.deepEqual(candidateIds(buildQuery(), [restricted, unrestricted], "hat"), [unrestricted.id]);
});

test("set bonus AP on the dominator blocks dominance when a CP< criterion exists", () => {
    const gameData = buildGameData([{}, {}, { [AP]: 1 }]);
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const setDominator = buildItem({ setId: SET_ID, stats: { [CHANCE]: 30 } });
    const capped = buildItem({ slot: "belt", criterion: "CP<8", stats: { [CHANCE]: 500 } });
    assert.equal(candidateIds(buildQuery(), [weak, setDominator, capped], "hat", gameData).length, 2);
});

test("stat cited with > in another item criterion becomes a compared stat", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10, [AGILITY]: 60 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    const gated = buildItem({ slot: "amulet", criterion: "CA>50", stats: { [CHANCE]: 500 } });
    assert.equal(candidateIds(buildQuery(), [weak, strong, gated], "hat").length, 2);
});

test("stat cited with < in a required item criterion requires equal values", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10, [AGILITY]: 5 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    const capped = buildItem({ slot: "amulet", criterion: "CA<50", stats: { [CHANCE]: 500 } });
    const query = buildQuery({ requiredItemIds: new Set([capped.id]) });
    assert.equal(candidateIds(query, [weak, strong, capped], "hat").length, 2);
});

test("identical own criterion keeps the item that provides the cited stat", () => {
    const provider = buildItem({ criterion: "CS>50", stats: { [CHANCE]: 10, [STRENGTH]: 60 } });
    const strong = buildItem({ criterion: "CS>50", stats: { [CHANCE]: 20 } });
    assert.equal(candidateIds(buildQuery(), [provider, strong], "hat").length, 2);
});

test("prysmaradite cannot dominate a regular dofus", () => {
    const regular = buildItem({ slot: "dofus", typeId: DOFUS_TYPE_ID, stats: { [CHANCE]: 10 } });
    const strongRegulars = Array.from({ length: DOFUS_CAPACITY - 2 }, () =>
        buildItem({ slot: "dofus", typeId: DOFUS_TYPE_ID, stats: { [CHANCE]: 20 } }),
    );
    const prysmaradites = [1, 2].map(() =>
        buildItem({ slot: "dofus", typeId: PRYSMARADITE_TYPE_ID, stats: { [CHANCE]: 20 } }),
    );
    const ids = candidateIds(buildQuery(), [regular, ...strongRegulars, ...prysmaradites], "dofus");
    assert.ok(ids.includes(regular.id));
});

test("criterion with a space between code and operator still locks the stat", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10, [AGILITY]: 5 } });
    const strong = buildItem({ stats: { [CHANCE]: 20 } });
    const gated = buildItem({ slot: "amulet", criterion: "CP <8", stats: { [CHANCE]: 500, [AP]: 0 } });
    const spaced = buildItem({ slot: "belt", criterion: "CA >50", stats: { [CHANCE]: 500 } });
    assert.equal(candidateIds(buildQuery(), [weak, strong, gated, spaced], "hat").length, 2);
});

test("item with a non-monotone criterion on a non-AP/MP stat is excluded and listed", () => {
    const unsupported = buildItem({ criterion: "CC=0", stats: { [CHANCE]: 50 } });
    const regular = buildItem({ slot: "belt", stats: { [CHANCE]: 10 } });
    const filter = new CandidateFilter(buildQuery(), buildGameData());
    const candidates = filter.buildCandidates([unsupported, regular]);
    assert.deepEqual(candidates.get("hat"), []);
    assert.deepEqual(
        filter.unsupportedItems.map((item) => item.id),
        [unsupported.id],
    );
});

test("unsupported criteria do not lock stats for other items", () => {
    const unsupported = buildItem({ slot: "belt", criterion: "CA<50", stats: { [CHANCE]: 50 } });
    const weak = buildItem({ stats: { [CHANCE]: 10, [AGILITY]: 5 } });
    const strong = buildItem({ stats: { [CHANCE]: 20, [AGILITY]: 5 } });
    const other = buildItem({ stats: { [CHANCE]: 20, [AGILITY]: 9 } });
    const ids = candidateIds(buildQuery(), [unsupported, weak, strong, other], "hat");
    assert.deepEqual(ids.sort(), [strong.id, other.id].sort());
});

test("required unsupported item is kept", () => {
    const required = buildItem({ criterion: "CC=0", stats: { [CHANCE]: 50 } });
    const query = buildQuery({ requiredItemIds: new Set([required.id]) });
    const filter = new CandidateFilter(query, buildGameData());
    assert.deepEqual(
        filter
            .buildCandidates([required])
            .get("hat")
            .map((item) => item.id),
        [required.id],
    );
    assert.deepEqual(filter.unsupportedItems, []);
});

test("item with a CP< criterion stays supported", () => {
    const capped = buildItem({ criterion: "CP<8", stats: { [CHANCE]: 50 } });
    assert.deepEqual(candidateIds(buildQuery(), [capped], "hat"), [capped.id]);
});

test("item reserved to a player or to game masters is excluded as unobtainable", () => {
    const named = buildItem({ criterion: "PN~Silaisie&BI=1", stats: { [CHANCE]: 90 } });
    const admin = buildItem({ slot: "ring", criterion: "PX=3|PX=5", stats: { [CHANCE]: 90 } });
    const spaced = buildItem({ slot: "belt", criterion: "(Pn = 1)", stats: { [CHANCE]: 90 } });
    const regular = buildItem({ slot: "boots", criterion: "CP>1", stats: { [CHANCE]: 10 } });
    const filter = new CandidateFilter(buildQuery(), buildGameData());
    const candidates = filter.buildCandidates([named, admin, spaced, regular]);
    assert.deepEqual(candidates.get("hat"), []);
    assert.deepEqual(candidates.get("ring"), []);
    assert.deepEqual(candidates.get("belt"), []);
    assert.deepEqual(
        candidates.get("boots").map((item) => item.id),
        [regular.id],
    );
    assert.deepEqual(
        filter.unobtainableItems.map((item) => item.id),
        [named.id, admin.id, spaced.id],
    );
    assert.deepEqual(filter.unsupportedItems, []);
});

test("required unobtainable item is kept", () => {
    const required = buildItem({ criterion: "PN~x&BI=1", stats: { [CHANCE]: 50 } });
    const filter = new CandidateFilter(buildQuery({ requiredItemIds: new Set([required.id]) }), buildGameData());
    assert.deepEqual(
        filter
            .buildCandidates([required])
            .get("hat")
            .map((item) => item.id),
        [required.id],
    );
    assert.deepEqual(filter.unobtainableItems, []);
});

test("restricted trophy cannot dominate a regular dofus", () => {
    const regular = buildItem({ slot: "dofus", typeId: DOFUS_TYPE_ID, stats: { [CHANCE]: 10 } });
    const strongRegulars = Array.from({ length: DOFUS_CAPACITY - 2 }, () =>
        buildItem({ slot: "dofus", typeId: DOFUS_TYPE_ID, stats: { [CHANCE]: 20 } }),
    );
    const trophies = [1, 2].map(() =>
        buildItem({ slot: "dofus", typeId: TROPHY_TYPE_ID, criterion: "pk<2", stats: { [CHANCE]: 20 } }),
    );
    const ids = candidateIds(buildQuery(), [regular, ...strongRegulars, ...trophies], "dofus");
    assert.ok(ids.includes(regular.id));
});

test("with a pk criterion around, a set item cannot dominate an item outside its set", () => {
    const weak = buildItem({ stats: { [CHANCE]: 10 } });
    const setDominator = buildItem({ setId: SET_ID, stats: { [CHANCE]: 30 } });
    assert.deepEqual(candidateIds(buildQuery(), [weak, setDominator], "hat"), [setDominator.id]);
    assert.equal(candidateIds(buildQuery(), [weak, setDominator, buildTrophy()], "hat").length, 2);
});

test("with a pk criterion around, an item without set or of the same set still dominates", () => {
    const weakSetItem = buildItem({ setId: SET_ID, stats: { [CHANCE]: 10 } });
    const strongSetItem = buildItem({ setId: SET_ID, stats: { [CHANCE]: 20 } });
    const strongestPlain = buildItem({ stats: { [CHANCE]: 30 } });
    assert.deepEqual(candidateIds(buildQuery(), [weakSetItem, strongSetItem, buildTrophy()], "hat"), [
        strongSetItem.id,
    ]);
    assert.deepEqual(candidateIds(buildQuery(), [weakSetItem, strongestPlain, buildTrophy()], "hat"), [
        strongestPlain.id,
    ]);
});

test("a pk trophy only dominates trophies with the same criterion", () => {
    const trophy = buildItem({ slot: "dofus", typeId: TROPHY_TYPE_ID, criterion: "pk<2", stats: { [CHANCE]: 50 } });
    const regulars = Array.from({ length: DOFUS_CAPACITY }, () =>
        buildItem({ slot: "dofus", typeId: DOFUS_TYPE_ID, stats: { [CHANCE]: 10 } }),
    );
    const weakTrophies = Array.from({ length: DOFUS_CAPACITY }, () =>
        buildItem({ slot: "dofus", typeId: TROPHY_TYPE_ID, criterion: "pk<2", stats: { [CHANCE]: 10 } }),
    );
    const strongTrophies = Array.from({ length: DOFUS_CAPACITY }, () =>
        buildItem({ slot: "dofus", typeId: TROPHY_TYPE_ID, criterion: "pk<2", stats: { [CHANCE]: 60 } }),
    );
    const ids = candidateIds(buildQuery(), [trophy, ...regulars, ...weakTrophies, ...strongTrophies], "dofus");
    assert.ok(regulars.every((regular) => ids.includes(regular.id)));
    assert.ok(weakTrophies.every((weakTrophy) => !ids.includes(weakTrophy.id)));
});

test("pk atoms other than < are unsupported", () => {
    const unsupported = buildItem({ slot: "dofus", criterion: "pk>0", stats: { [CHANCE]: 50 } });
    const filter = new CandidateFilter(buildQuery(), buildGameData());
    assert.deepEqual(filter.buildCandidates([unsupported]).get("dofus"), []);
    assert.deepEqual(
        filter.unsupportedItems.map((item) => item.id),
        [unsupported.id],
    );
});

test("item reserved to an Ankarton server is excluded as unobtainable", () => {
    const ankarton = buildItem({ slot: "shield", criterion: "OS=505", stats: { [CHANCE]: 90 } });
    const filter = new CandidateFilter(buildQuery(), buildGameData());
    assert.deepEqual(filter.buildCandidates([ankarton]).get("shield"), []);
    assert.deepEqual(
        filter.unobtainableItems.map((item) => item.id),
        [ankarton.id],
    );
});
