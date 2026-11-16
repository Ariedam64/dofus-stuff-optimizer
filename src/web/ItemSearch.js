const normalizeName = require("../utils/normalizeName");

const DEFAULT_LIMIT = 20;

class ItemSearch {
    #entries;

    constructor(items) {
        this.#entries = items.map((item) => ({ item, normalizedName: normalizeName(item.name) }));
    }

    search(text, limit = DEFAULT_LIMIT) {
        const wanted = normalizeName(text ?? "");
        if (wanted === "") return [];
        const prefixMatches = [];
        const otherMatches = [];
        for (const entry of this.#entries) {
            if (entry.normalizedName.startsWith(wanted)) prefixMatches.push(entry);
            else if (entry.normalizedName.includes(wanted)) otherMatches.push(entry);
        }
        return [...prefixMatches, ...otherMatches].slice(0, limit).map(({ item }) => ({
            id: item.id,
            name: item.name,
            level: item.level,
            slot: item.slot,
            imgUrl: item.imgUrl,
        }));
    }
}

module.exports = ItemSearch;
