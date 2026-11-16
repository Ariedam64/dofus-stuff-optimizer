const fs = require("fs/promises");
const path = require("path");
const Item = require("./Item");
const ItemSet = require("./ItemSet");
const Spell = require("./Spell");
const Breed = require("./Breed");
const normalizeName = require("../utils/normalizeName");
const QueryError = require("../optimizer/QueryError");

const META_FILE_NAME = "meta";
const DATA_FILES = ["items", "itemSets", "breeds", "spellVariants", "spells", "spellLevels"];

async function readDataFile(dataDir, name) {
    try {
        return JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") throw new Error(`Cannot read ${name}.json in ${dataDir}: ${error.message}`);
        throw new Error(`Missing data in ${dataDir}: run "node src/main.js sync" first`);
    }
}

function groupBySpellId(spellLevels) {
    const grouped = new Map();
    for (const level of spellLevels) {
        if (!grouped.has(level.spellId)) grouped.set(level.spellId, []);
        grouped.get(level.spellId).push(level);
    }
    return grouped;
}

class GameData {
    items;
    dataSyncedAt;
    #setsById;
    #breeds;
    #spellsById;
    #levelsBySpellId;

    constructor({ items, sets, breeds, spells, spellLevels, dataSyncedAt = null }) {
        this.items = items;
        this.dataSyncedAt = dataSyncedAt;
        this.#setsById = new Map(sets.map((set) => [set.id, set]));
        this.#breeds = breeds;
        this.#spellsById = new Map(spells.map((spell) => [spell.id, spell]));
        this.#levelsBySpellId = groupBySpellId(spellLevels);
    }

    static async load(dataDir) {
        const [items, itemSets, breeds, spellVariants, spells, spellLevels, meta] = await Promise.all(
            [...DATA_FILES, META_FILE_NAME].map((name) => readDataFile(dataDir, name)),
        );
        return new GameData({
            items: items.map((raw) => Item.fromDofusDb(raw)),
            sets: itemSets.map((raw) => ItemSet.fromDofusDb(raw)),
            breeds: breeds.map((raw) => Breed.fromDofusDb(raw, spellVariants)),
            spells,
            spellLevels,
            dataSyncedAt: meta.syncedAt,
        });
    }

    get breeds() {
        return [...this.#breeds];
    }

    getSet(id) {
        return this.#setsById.get(id);
    }

    findBreed(name) {
        const wanted = normalizeName(name);
        const breed = this.#breeds.find((candidate) => normalizeName(candidate.name) === wanted);
        if (breed) return breed;
        const validNames = this.#breeds.map((candidate) => candidate.name).join(", ");
        throw new QueryError(QueryError.CODE.UNKNOWN_BREED, `Unknown breed "${name}". Valid: ${validNames}`, { name });
    }

    getSpellGroups(breed, level) {
        return breed.variantPairs
            .map((pair) => pair.map((spellId) => this.#buildBestSpell(spellId, level)).filter(Boolean))
            .filter((group) => group.length > 0);
    }

    #buildBestSpell(spellId, level) {
        const spellRaw = this.#spellsById.get(spellId);
        if (!spellRaw) return null;
        const eligible = (this.#levelsBySpellId.get(spellId) ?? []).filter((raw) => raw.minPlayerLevel <= level);
        if (eligible.length === 0) return null;
        const best = eligible.reduce((highest, raw) => (raw.grade > highest.grade ? raw : highest));
        return Spell.fromDofusDb(spellRaw, best);
    }
}

module.exports = GameData;
