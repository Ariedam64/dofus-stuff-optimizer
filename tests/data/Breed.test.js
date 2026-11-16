const test = require("node:test");
const assert = require("node:assert/strict");
const Breed = require("../../src/data/Breed");

const MALE_HEAD_URL = "https://api.dofusdb.fr/img/heads/SmallHead_90.png";
const FEMALE_HEAD_URL = "https://api.dofusdb.fr/img/heads/SmallHead_91.png";
const SPELL_VARIANTS = [
    { breedId: 9, spellIds: [1001, 1002] },
    { breedId: 1, spellIds: [2001, 2002] },
];

function buildRaw(overrides = {}) {
    return { id: 9, shortName: { fr: "Crâ" }, ...overrides };
}

test("Breed.fromDofusDb keeps the male head URL", () => {
    const breed = Breed.fromDofusDb(
        buildRaw({ heads: { male: MALE_HEAD_URL, female: FEMALE_HEAD_URL } }),
        SPELL_VARIANTS,
    );
    assert.equal(breed.headUrl, MALE_HEAD_URL);
    assert.equal(breed.name, "Crâ");
    assert.deepEqual(breed.variantPairs, [[1001, 1002]]);
});

test("Breed.fromDofusDb gives a null head URL when heads are missing", () => {
    assert.equal(Breed.fromDofusDb(buildRaw(), SPELL_VARIANTS).headUrl, null);
});
