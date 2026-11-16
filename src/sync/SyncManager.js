const fs = require("fs/promises");
const path = require("path");
const { TYPE_ID_SLOTS } = require("../data/slots");

const CHUNK_SIZE = 50;
const SUPPORTED_TYPE_IDS = Object.keys(TYPE_ID_SLOTS).map(Number);
const META_FILE = "meta.json";
const JSON_INDENT = 2;

class SyncManager {
    #client;
    #dataDir;
    #logger;
    #isDebug;

    constructor({ client, dataDir, logger = console, isDebug = false }) {
        this.#client = client;
        this.#dataDir = dataDir;
        this.#logger = logger;
        this.#isDebug = isDebug;
    }

    async syncAll() {
        await fs.mkdir(this.#dataDir, { recursive: true });
        const counts = {};
        await this.#sync(counts, "items.json", () =>
            this.#client.fetchAll("items", { typeId: { $in: SUPPORTED_TYPE_IDS } }),
        );
        await this.#sync(counts, "itemSets.json", () => this.#client.fetchAll("item-sets"));
        await this.#sync(counts, "breeds.json", () => this.#client.fetchAll("breeds"));
        const spellVariants = await this.#sync(counts, "spellVariants.json", () =>
            this.#client.fetchAll("spell-variants"),
        );
        const spellIds = this.#collectIds(spellVariants, "spellIds");
        const spells = await this.#sync(counts, "spells.json", () => this.#fetchByIds("spells", spellIds));
        const spellLevelIds = this.#collectIds(spells, "spellLevels");
        await this.#sync(counts, "spellLevels.json", () => this.#fetchByIds("spell-levels", spellLevelIds));
        await this.#writeJson(META_FILE, { syncedAt: new Date().toISOString() });
        return counts;
    }

    async #sync(counts, fileName, fetchDataset) {
        const name = path.basename(fileName, ".json");
        this.#logger.error(`🔄 Syncing ${name}…`);
        const records = await fetchDataset();
        await this.#writeJson(fileName, records);
        counts[fileName] = records.length;
        this.#logger.error(`✅ ${name}: ${records.length}`);
        return records;
    }

    #collectIds(records, field) {
        const ids = new Set();
        for (const record of records) {
            for (const id of record[field] ?? []) ids.add(id);
        }
        return [...ids];
    }

    async #fetchByIds(endpoint, ids) {
        const records = [];
        for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
            const chunk = ids.slice(start, start + CHUNK_SIZE);
            if (this.#isDebug)
                this.#logger.error(`🔍 ${endpoint}: ids ${start + 1}-${start + chunk.length} of ${ids.length}`);
            records.push(...(await this.#client.fetchAll(endpoint, { id: { $in: chunk } })));
        }
        return records;
    }

    async #writeJson(fileName, content) {
        await fs.writeFile(path.join(this.#dataDir, fileName), JSON.stringify(content, null, JSON_INDENT) + "\n");
    }
}

module.exports = SyncManager;
