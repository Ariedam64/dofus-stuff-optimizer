const test = require("node:test");
const assert = require("node:assert/strict");
const QueryError = require("../../src/optimizer/QueryError");
const { ELEMENT_LABELS, toFrenchMessage } = require("../../src/web/frenchMessages");

const { CODE } = QueryError;

function messageOf(code, details) {
    return toFrenchMessage(new QueryError(code, "English log message", details));
}

test("every query error code has a French message built from its details", () => {
    const cases = [
        [CODE.INVALID_BODY, {}, /JSON valide/],
        [CODE.BODY_TOO_LARGE, {}, /trop volumineuse/],
        [CODE.INVALID_FIELD, { field: "level", min: 1, max: 200 }, /niveau.*entre 1 et 200/],
        [CODE.INVALID_FIELD, { field: "constraints.minAp" }, /PA minimum/],
        [
            CODE.ABOVE_GAME_CAP,
            { field: "constraints.minAp", max: 12 },
            /^Le jeu limite à 12 PA et 6 PM : les PA minimum ne peuvent pas dépasser 12\.$/,
        ],
        [
            CODE.ABOVE_GAME_CAP,
            { field: "constraints.minMp", max: 6 },
            /^Le jeu limite à 12 PA et 6 PM : les PM minimum ne peuvent pas dépasser 6\.$/,
        ],
        [CODE.INVALID_FIELD, { field: "ringExos" }, /les exos d'anneau/],
        [CODE.INVALID_FIELD, { field: "ringExos.ap" }, /l'exo PA des anneaux/],
        [CODE.INVALID_FIELD, { field: "ringExos.mp" }, /l'exo PM des anneaux/],
        [CODE.INVALID_FIELD, { field: "constraints.minResistances.fire" }, /constraints\.minResistances\.fire/],
        [CODE.UNKNOWN_FIELD, { field: "lvl" }, /Champ inconnu.*lvl/],
        [CODE.UNKNOWN_BREED, { name: "Nope" }, /Classe inconnue.*Nope/],
        [CODE.UNKNOWN_REQUIRED_ITEM, { itemId: 42 }, /objet imposé n°42 est introuvable/],
        [
            CODE.REQUIRED_ITEM_ABOVE_LEVEL,
            { itemName: "Coiffe", itemLevel: 200, level: 150 },
            /Coiffe \(niveau 200\) .*niveau du personnage \(150\)/,
        ],
        [CODE.TOO_MANY_REQUIRED_ITEMS, { slot: "weapon", count: 2, capacity: 1 }, /2 objets imposés.*arme.*1 place/],
        [CODE.TOO_MANY_REQUIRED_ITEMS, { slot: "ring", count: 3, capacity: 2 }, /3 objets imposés.*anneau.*2 places/],
        [CODE.TOO_MANY_REQUIRED_PRYSMARADITES, { count: 2, max: 1 }, /2 prysmaradites imposées.*au plus 1/],
        [
            CODE.REQUIRED_SHIELD_WITH_TWO_HANDED_WEAPON,
            { weaponName: "Arc", shieldName: "Bouclier" },
            /Arc.*deux mains.*Bouclier/,
        ],
        [
            CODE.NO_DAMAGE_ACTION,
            { breedName: "Crâ", level: 200, elementKey: "earth", ignoredSpellNames: ["Flèche"] },
            /dégâts terre pour Crâ au niveau 200\. Sorts ignorés : Flèche\./,
        ],
    ];
    for (const [code, details, pattern] of cases) {
        const message = messageOf(code, details);
        assert.match(message, pattern, code);
        assert.doesNotMatch(message, /English log message/, code);
    }
});

test("an error without a known code is shown as an internal error with its technical message", () => {
    assert.equal(toFrenchMessage(new Error("solver crashed")), "Erreur interne du serveur : solver crashed");
    assert.equal(
        toFrenchMessage(Object.assign(new Error("boom"), { code: "constructor" })),
        "Erreur interne du serveur : boom",
    );
});

test("the five elements have French labels", () => {
    assert.deepEqual(Object.keys(ELEMENT_LABELS), ["neutral", "earth", "fire", "water", "air"]);
    assert.equal(ELEMENT_LABELS.water, "Eau");
});
