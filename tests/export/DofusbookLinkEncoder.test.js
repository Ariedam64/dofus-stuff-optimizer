const { test } = require("node:test");
const assert = require("node:assert");
const DofusbookLinkEncoder = require("../../src/export/DofusbookLinkEncoder");
const config = require("../../src/config");

const REFERENCE_CODE = "AQEfKAL__4YbSQyGGla4LdpOEUimVrk9TYIPG4M_iDGSMaxV9DXIBQAwAQkAAQEIAAEHEk9wdGltaXNldXIgQ3JhIEVhdQ";
const STAT_ORDER = ["vi", "fo", "in", "ch", "ag", "sa"];
const MAX_STAT_ID = 5;
const BITS_PER_POINT_VALUE = 10;

const REFERENCE_ITEMS = [
    { slot: "weapon", id: 34331 },
    { slot: "hat", id: 34330 },
    { slot: "boots", id: 15693 },
    { slot: "ring", id: 11738, exo: "mp" },
    { slot: "ring", id: 19985, exo: "ap" },
    { slot: "belt", id: 18598 },
    { slot: "cape", id: 22201 },
    { slot: "amulet", id: 22200 },
    { slot: "dofus", id: 7043 },
    { slot: "dofus", id: 16264 },
    { slot: "dofus", id: 12690 },
    { slot: "dofus", id: 12716 },
    { slot: "dofus", id: 22004 },
    { slot: "dofus", id: 13768 },
    { slot: "mount", id: 33295 },
    { slot: "shield", id: 18700 },
];

function toBytes(url) {
    assert.ok(url.startsWith(config.DOFUSBOOK_IMPORT_URL));
    return Buffer.from(url.slice(config.DOFUSBOOK_IMPORT_URL.length), "base64url");
}

function decode(url) {
    const bytes = toBytes(url);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const result = { positions: [], points: {}, scrolls: {}, exos: [] };
    let offset = 1;
    while (offset < bytes.length) {
        const tag = bytes[offset++];
        if (tag === 1) {
            const header = view.getUint16(offset);
            offset += 2;
            result.isFemale = header % 2 === 1;
            const rest = Math.floor(header / 2);
            result.classe = rest % 20;
            result.level = Math.floor(rest / 20) + 1;
        } else if (tag === 2) {
            const mask = view.getUint16(offset);
            offset += 2;
            for (let position = 0; position < 16; position++) {
                if (mask & (1 << position)) {
                    result.positions[position] = view.getUint16(offset);
                    offset += 2;
                }
            }
        } else if (tag === 3) {
            const mask = bytes[offset++];
            const stats = STAT_ORDER.filter((_, index) => mask & (1 << index));
            let bitOffset = offset * 8;
            for (const stat of stats) {
                let value = 0;
                for (let bit = 0; bit < BITS_PER_POINT_VALUE; bit++, bitOffset++) {
                    value = (value << 1) | ((bytes[bitOffset >> 3] >> (7 - (bitOffset & 7))) & 1);
                }
                result.points[stat] = value;
            }
            offset += Math.ceil((stats.length * BITS_PER_POINT_VALUE) / 8);
        } else if (tag === 4) {
            const mask = bytes[offset++];
            for (let index = 0; index <= MAX_STAT_ID; index++) {
                if (mask & (1 << index)) result.scrolls[STAT_ORDER[index]] = bytes[offset++];
            }
        } else if (tag === 5) {
            const mask = view.getUint16(offset);
            offset += 2;
            for (let position = 0; position < 16; position++) {
                if (!(mask & (1 << position))) continue;
                const lineCount = bytes[offset++];
                for (let line = 0; line < lineCount; line++) {
                    result.exos.push({ position, statIndex: bytes[offset], value: view.getInt16(offset + 2) });
                    offset += 4;
                }
            }
        } else if (tag === 7) {
            const length = bytes[offset++];
            result.name = bytes.subarray(offset, offset + length).toString("utf8");
            offset += length;
        } else {
            assert.fail(`unknown tag ${tag}`);
        }
    }
    return result;
}

test("reproduces the reference vector byte for byte", () => {
    const url = new DofusbookLinkEncoder().encode({
        level: 200,
        breedId: 9,
        name: "Optimiseur Cra Eau",
        items: REFERENCE_ITEMS,
    });
    assert.strictEqual(url, config.DOFUSBOOK_IMPORT_URL + REFERENCE_CODE);
});

test("round-trips points and scrolls at level 150", () => {
    const items = [
        { slot: "weapon", id: 34331 },
        { slot: "hat", id: 34330 },
        { slot: "amulet", id: 22200 },
    ];
    const scrolls = Object.fromEntries(STAT_ORDER.map((stat) => [stat, 100]));
    const url = new DofusbookLinkEncoder().encode({
        level: 150,
        breedId: 20,
        name: "Test",
        items,
        spentPoints: { ch: 995 },
        scrolls,
    });
    const decoded = decode(url);
    assert.strictEqual(decoded.level, 150);
    assert.strictEqual(decoded.classe, 18);
    assert.deepStrictEqual(decoded.points, { ch: 995 });
    assert.deepStrictEqual(decoded.scrolls, scrolls);
    assert.strictEqual(decoded.positions[0], 34331);
    assert.strictEqual(decoded.positions[2], 34330);
    assert.strictEqual(decoded.positions[3], 22200);
    assert.strictEqual(decoded.name, "Test");
});

test("packs several 10-bit point values MSB-first", () => {
    const spentPoints = { vi: 1023, fo: 1, sa: 512 };
    const url = new DofusbookLinkEncoder().encode({ level: 200, breedId: 1, name: "x", items: [], spentPoints });
    assert.deepStrictEqual(decode(url).points, spentPoints);
});

test("truncates the name on a character boundary within 255 bytes", () => {
    const url = new DofusbookLinkEncoder().encode({ level: 200, breedId: 1, name: "é".repeat(200), items: [] });
    assert.strictEqual(decode(url).name, "é".repeat(127));
});

test("throws on more than 2 rings or more than 6 dofus", () => {
    const encoder = new DofusbookLinkEncoder();
    const rings = [1, 2, 3].map((id) => ({ slot: "ring", id }));
    const dofus = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ slot: "dofus", id }));
    assert.throws(() => encoder.encode({ level: 200, breedId: 1, name: "x", items: rings }), /ring/);
    assert.throws(() => encoder.encode({ level: 200, breedId: 1, name: "x", items: dofus }), /dofus/);
});
