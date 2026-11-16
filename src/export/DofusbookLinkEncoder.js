const config = require("../config");

const SLOT_POSITIONS = {
    weapon: [0],
    shield: [1],
    hat: [2],
    amulet: [3],
    ring: [4, 5],
    belt: [6],
    cape: [7],
    boots: [8],
    mount: [9],
    dofus: [10, 11, 12, 13, 14, 15],
};
const TOTAL_POSITIONS = 16;
const STAT_ORDER = ["vi", "fo", "in", "ch", "ag", "sa"];
const EXO_STAT_INDEX = { ap: 8, mp: 9 };
const EXO_VALUE = 1;
const EXO_LINE_COUNT = 1;
const EXO_LINE_PADDING = 0;
const HEADER_TAG = 1;
const ITEMS_TAG = 2;
const POINTS_TAG = 3;
const SCROLLS_TAG = 4;
const EXOS_TAG = 5;
const NAME_TAG = 7;
const FORMAT_VERSION = 1;
const BREED_ID_SKIPPED_AFTER = 18;
const BREEDS_PER_LEVEL = 20;
const BITS_PER_BYTE = 8;
const BITS_PER_POINT_VALUE = 10;
const MAX_POINT_VALUE = 1023;
const MAX_SCROLL_VALUE = 255;
const MAX_NAME_BYTES = 255;
const BYTE_MASK = 0xff;

class DofusbookLinkEncoder {
    encode({ level, breedId, isFemale = false, name = "", items, spentPoints = {}, scrolls = {} }) {
        const slots = this.#placeItems(items);
        const bytes = [FORMAT_VERSION];
        bytes.push(HEADER_TAG, ...this.#uint16(this.#buildHeader(level, breedId, isFemale)));
        bytes.push(...this.#buildItemsBlock(slots));
        bytes.push(...this.#buildPointsBlock(spentPoints));
        bytes.push(...this.#buildScrollsBlock(scrolls));
        bytes.push(...this.#buildExosBlock(slots));
        bytes.push(...this.#buildNameBlock(name));
        return config.DOFUSBOOK_IMPORT_URL + Buffer.from(bytes).toString("base64url");
    }

    #buildHeader(level, breedId, isFemale) {
        const classe = breedId <= BREED_ID_SKIPPED_AFTER ? breedId - 1 : breedId - 2;
        return ((level - 1) * BREEDS_PER_LEVEL + classe) * 2 + (isFemale ? 1 : 0);
    }

    #placeItems(items) {
        const slots = new Array(TOTAL_POSITIONS).fill(null);
        const totalPlaced = {};
        for (const item of items) {
            const positions = SLOT_POSITIONS[item.slot];
            if (!positions) throw new Error(`Unknown slot "${item.slot}" for item ${item.id}`);
            const placedCount = totalPlaced[item.slot] || 0;
            if (placedCount >= positions.length) {
                throw new Error(`Too many items for slot "${item.slot}": at most ${positions.length} allowed`);
            }
            slots[positions[placedCount]] = item;
            totalPlaced[item.slot] = placedCount + 1;
        }
        return slots;
    }

    #buildPositionMask(slots, hasValue) {
        return slots.reduce((mask, item, position) => (item && hasValue(item) ? mask | (1 << position) : mask), 0);
    }

    #buildItemsBlock(slots) {
        const mask = this.#buildPositionMask(slots, () => true);
        const ids = slots.filter(Boolean).flatMap((item) => this.#uint16(item.id));
        return [ITEMS_TAG, ...this.#uint16(mask), ...ids];
    }

    #buildPointsBlock(spentPoints) {
        const { mask, values } = this.#collectStatValues(spentPoints, MAX_POINT_VALUE, "spent points");
        if (mask === 0) return [];
        const packedBytes = new Array(Math.ceil((values.length * BITS_PER_POINT_VALUE) / BITS_PER_BYTE)).fill(0);
        let bitOffset = 0;
        for (const value of values) {
            for (let bit = BITS_PER_POINT_VALUE - 1; bit >= 0; bit--, bitOffset++) {
                const bitValue = (value >> bit) & 1;
                packedBytes[Math.floor(bitOffset / BITS_PER_BYTE)] |=
                    bitValue << (BITS_PER_BYTE - 1 - (bitOffset % BITS_PER_BYTE));
            }
        }
        return [POINTS_TAG, mask, ...packedBytes];
    }

    #buildScrollsBlock(scrolls) {
        const { mask, values } = this.#collectStatValues(scrolls, MAX_SCROLL_VALUE, "scrolls");
        if (mask === 0) return [];
        return [SCROLLS_TAG, mask, ...values];
    }

    #collectStatValues(valuesByStat, maxValue, label) {
        let mask = 0;
        const values = [];
        STAT_ORDER.forEach((stat, index) => {
            const value = valuesByStat[stat] || 0;
            if (value === 0) return;
            if (!Number.isInteger(value) || value < 0 || value > maxValue) {
                throw new Error(`Invalid ${label} value for ${stat}: ${value} (expected 0..${maxValue})`);
            }
            mask |= 1 << index;
            values.push(value);
        });
        return { mask, values };
    }

    #buildExosBlock(slots) {
        const mask = this.#buildPositionMask(slots, (item) => Boolean(item.exo));
        if (mask === 0) return [];
        const lines = slots
            .filter((item) => item && item.exo)
            .flatMap((item) => [EXO_LINE_COUNT, this.#exoStatIndex(item), EXO_LINE_PADDING, EXO_VALUE]);
        return [EXOS_TAG, ...this.#uint16(mask), ...lines];
    }

    #exoStatIndex(item) {
        const index = EXO_STAT_INDEX[item.exo];
        if (index === undefined) throw new Error(`Unknown exo "${item.exo}" on item ${item.id}`);
        return index;
    }

    #buildNameBlock(name) {
        const nameBytes = this.#truncateUtf8(name, MAX_NAME_BYTES);
        return [NAME_TAG, nameBytes.length, ...nameBytes];
    }

    #truncateUtf8(text, maxBytes) {
        let result = Buffer.alloc(0);
        for (const character of text) {
            const next = Buffer.concat([result, Buffer.from(character, "utf8")]);
            if (next.length > maxBytes) break;
            result = next;
        }
        return result;
    }

    #uint16(value) {
        return [(value >> BITS_PER_BYTE) & BYTE_MASK, value & BYTE_MASK];
    }
}

module.exports = DofusbookLinkEncoder;
