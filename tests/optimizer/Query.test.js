const test = require("node:test");
const assert = require("node:assert/strict");
const Query = require("../../src/optimizer/Query");
const QueryError = require("../../src/optimizer/QueryError");
const { DEFAULT_RESULT_COUNT, MAX_AP, MAX_MP } = require("../../src/config");

const CRA = { id: 9, name: "Crâ", variantPairs: [] };
const data = {
    findBreed: (name) => {
        if (name.toLowerCase() !== "cra") throw new Error(`Unknown breed "${name}". Valid: Crâ`);
        return CRA;
    },
};

function buildJson(overrides = {}) {
    return { breed: "cra", level: 200, profile: { elements: ["water"] }, ...overrides };
}

function withElements(elements) {
    return buildJson({ profile: { elements } });
}

function withConstraints(constraints) {
    return buildJson({ constraints });
}

test("Query.parse reads the spec example", () => {
    const query = Query.parse(
        {
            breed: "cra",
            level: 200,
            profile: { elements: ["water"], minCriticalRate: 60 },
            constraints: {
                minAp: 11,
                minMp: 6,
                minResistances: { fire: 30 },
                excludedItemIds: [1, 2],
                requiredItemIds: [3],
            },
            allowRingExos: false,
            topCount: 5,
        },
        data,
    );
    assert.equal(query.breed, CRA);
    assert.equal(query.level, 200);
    assert.equal(query.elementKey, "water");
    assert.equal(query.minCriticalRate, 60);
    assert.equal(query.minAp, 11);
    assert.equal(query.minMp, 6);
    assert.deepEqual(query.minResistances, { fire: 30 });
    assert.deepEqual([...query.excludedItemIds], [1, 2]);
    assert.deepEqual([...query.requiredItemIds], [3]);
    assert.equal(query.allowApExo, false);
    assert.equal(query.allowMpExo, false);
    assert.equal(query.resultCount, 5);
});

test("Query.parse applies defaults", () => {
    const query = Query.parse(buildJson(), data);
    assert.equal(query.minCriticalRate, null);
    assert.equal(query.minAp, 0);
    assert.equal(query.minMp, 0);
    assert.deepEqual(query.minResistances, {});
    assert.equal(query.excludedItemIds.size, 0);
    assert.equal(query.requiredItemIds.size, 0);
    assert.equal(query.allowApExo, true);
    assert.equal(query.allowMpExo, true);
    assert.equal(query.resultCount, DEFAULT_RESULT_COUNT);
});

test("Query.parse reads ringExos with each flag defaulting to true", () => {
    const withoutAp = Query.parse(buildJson({ ringExos: { ap: false } }), data);
    assert.equal(withoutAp.allowApExo, false);
    assert.equal(withoutAp.allowMpExo, true);
    const withoutMp = Query.parse(buildJson({ ringExos: { ap: true, mp: false } }), data);
    assert.equal(withoutMp.allowApExo, true);
    assert.equal(withoutMp.allowMpExo, false);
    const withDefaults = Query.parse(buildJson({ ringExos: {} }), data);
    assert.equal(withDefaults.allowApExo, true);
    assert.equal(withDefaults.allowMpExo, true);
});

test("Query.parse maps the legacy allowRingExos to both ring exo flags", () => {
    const disabled = Query.parse(buildJson({ allowRingExos: false }), data);
    assert.equal(disabled.allowApExo, false);
    assert.equal(disabled.allowMpExo, false);
    const enabled = Query.parse(buildJson({ allowRingExos: true }), data);
    assert.equal(enabled.allowApExo, true);
    assert.equal(enabled.allowMpExo, true);
});

test("Query.allowsExo answers per exo key", () => {
    const query = Query.parse(buildJson({ ringExos: { ap: false, mp: true } }), data);
    assert.equal(query.allowsExo("ap"), false);
    assert.equal(query.allowsExo("mp"), true);
});

test("Query.parse rejects invalid ringExos", () => {
    const assertInvalid = (json, code, field) =>
        assert.throws(
            () => Query.parse(buildJson(json), data),
            (error) => error instanceof QueryError && error.code === code && error.details.field === field,
        );
    assertInvalid({ ringExos: { ap: false }, allowRingExos: true }, QueryError.CODE.INVALID_FIELD, "ringExos");
    assertInvalid({ ringExos: { ap: true, crit: true } }, QueryError.CODE.UNKNOWN_FIELD, "ringExos.crit");
    assertInvalid({ ringExos: { mp: "no" } }, QueryError.CODE.INVALID_FIELD, "ringExos.mp");
    assertInvalid({ ringExos: true }, QueryError.CODE.INVALID_FIELD, "ringExos");
});

test("Query.parse accepts explicit null minCriticalRate and partial constraints", () => {
    const query = Query.parse(
        buildJson({ profile: { elements: ["air"], minCriticalRate: null }, constraints: { minMp: 6 } }),
        data,
    );
    assert.equal(query.elementKey, "air");
    assert.equal(query.minCriticalRate, null);
    assert.equal(query.minAp, 0);
    assert.equal(query.minMp, 6);
});

test("Query.parse rejects two elements in v1", () => {
    assert.throws(() => Query.parse(withElements(["water", "air"]), data), /Invalid query/);
});

test("Query.parse rejects missing or unknown element", () => {
    assert.throws(() => Query.parse(withElements([]), data), /Invalid query: profile.elements/);
    assert.throws(() => Query.parse(withElements(["light"]), data), /Invalid query: profile.elements/);
    assert.throws(() => Query.parse(buildJson({ profile: undefined }), data), /Invalid query: profile/);
});

test("Query.parse rejects prototype keys as elements", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
        assert.throws(() => Query.parse(withElements([key]), data), /Invalid query: profile.elements/);
        assert.throws(
            () => Query.parse(withConstraints({ minResistances: { [key]: 30 } }), data),
            /Invalid query: constraints.minResistances/,
        );
    }
});

test("Query.parse rejects unknown fields with their path", () => {
    assert.throws(
        () => Query.parse(withConstraints({ minAP: 11 }), data),
        /Invalid query: unknown field "constraints.minAP"/,
    );
    assert.throws(() => Query.parse(buildJson({ lvl: 200 }), data), /Invalid query: unknown field "lvl"/);
    assert.throws(
        () => Query.parse(buildJson({ profile: { elements: ["water"], critical: 50 } }), data),
        /Invalid query: unknown field "profile.critical"/,
    );
});

test("Query.parse rejects invalid level", () => {
    assert.throws(() => Query.parse(buildJson({ level: 0 }), data), /Invalid query: level/);
    assert.throws(() => Query.parse(buildJson({ level: 201 }), data), /Invalid query: level/);
    assert.throws(() => Query.parse(buildJson({ level: 150.5 }), data), /Invalid query: level/);
    assert.throws(() => Query.parse(buildJson({ level: "200" }), data), /Invalid query: level/);
});

test("Query.parse rejects non-element resistance keys", () => {
    assert.throws(
        () => Query.parse(withConstraints({ minResistances: { light: 30 } }), data),
        /Invalid query: .*light/,
    );
    assert.throws(() => Query.parse(withConstraints({ minResistances: { fire: "30" } }), data), /Invalid query/);
});

test("Query.parse rejects invalid constraint values", () => {
    assert.throws(() => Query.parse(withConstraints({ minAp: "11" }), data), /Invalid query: constraints.minAp/);
    assert.throws(() => Query.parse(withConstraints({ minMp: -1 }), data), /Invalid query: constraints.minMp/);
    assert.throws(() => Query.parse(withConstraints({ excludedItemIds: 3 }), data), /Invalid query: .*excludedItemIds/);
    assert.throws(
        () => Query.parse(withConstraints({ requiredItemIds: ["a"] }), data),
        /Invalid query: .*requiredItemIds/,
    );
    assert.throws(
        () => Query.parse(buildJson({ profile: { elements: ["water"], minCriticalRate: "60" } }), data),
        /minCriticalRate/,
    );
    assert.throws(() => Query.parse(buildJson({ allowRingExos: "yes" }), data), /Invalid query: allowRingExos/);
    assert.throws(() => Query.parse(buildJson({ topCount: 0 }), data), /Invalid query: topCount/);
});

test("Query.parse rejects a non-object query and lets unknown breed errors through", () => {
    assert.throws(() => Query.parse(null, data), /Invalid query/);
    assert.throws(() => Query.parse(buildJson({ breed: 9 }), data), /Invalid query: breed/);
    assert.throws(() => Query.parse(buildJson({ breed: "iop" }), data), /Unknown breed "iop"/);
});

test("Query.parse applies the v2 defaults", () => {
    const query = Query.parse(buildJson(), data);
    assert.equal(query.useScrolls, true);
    assert.equal(query.resultCount, 10);
    assert.equal(query.minDifferentItems, 5);
    assert.equal(query.timeLimitMs, 60000);
});

test("Query.parse reads the v2 fields", () => {
    const query = Query.parse(
        buildJson({ useScrolls: false, resultCount: 7, diversity: { minDifferentItems: 3 }, timeLimitMs: 5000 }),
        data,
    );
    assert.equal(query.useScrolls, false);
    assert.equal(query.resultCount, 7);
    assert.equal(query.minDifferentItems, 3);
    assert.equal(query.timeLimitMs, 5000);
});

test("Query.parse accepts topCount as an alias of resultCount", () => {
    assert.equal(Query.parse(buildJson({ topCount: 3 }), data).resultCount, 3);
    assert.throws(() => Query.parse(buildJson({ topCount: 3, resultCount: 3 }), data), /Invalid query/);
});

test("Query.parse rejects out-of-range v2 values", () => {
    for (const resultCount of [0, 21, 1.5, "3"]) {
        assert.throws(() => Query.parse(buildJson({ resultCount }), data), /Invalid query: resultCount/);
    }
    for (const minDifferentItems of [0, 17, 2.5]) {
        const json = buildJson({ diversity: { minDifferentItems } });
        assert.throws(() => Query.parse(json, data), /Invalid query: diversity.minDifferentItems/);
    }
    for (const timeLimitMs of [4999, 300001, 5000.5]) {
        assert.throws(() => Query.parse(buildJson({ timeLimitMs }), data), /Invalid query: timeLimitMs/);
    }
    assert.throws(() => Query.parse(buildJson({ useScrolls: "yes" }), data), /Invalid query: useScrolls/);
    assert.throws(() => Query.parse(buildJson({ diversity: { other: 1 } }), data), /unknown field "diversity.other"/);
});

function assertCode(json, code, details) {
    assert.throws(
        () => Query.parse(json, data),
        (error) => {
            assert.ok(error instanceof QueryError);
            assert.equal(error.code, code);
            assert.deepEqual(error.details, details);
            return true;
        },
    );
}

test("Query.parse errors carry a stable code and details for the page", () => {
    const { CODE } = QueryError;
    assertCode(null, CODE.INVALID_FIELD, { field: "root" });
    assertCode(buildJson({ lvl: 200 }), CODE.UNKNOWN_FIELD, { field: "lvl" });
    assertCode(buildJson({ level: 0 }), CODE.INVALID_FIELD, { field: "level", min: 1, max: 200 });
    assertCode(buildJson({ timeLimitMs: 1 }), CODE.INVALID_FIELD, { field: "timeLimitMs", min: 5000, max: 300000 });
    assertCode(withConstraints({ minAp: -1 }), CODE.INVALID_FIELD, { field: "constraints.minAp" });
});

test("Query.parse accepts minAp and minMp up to the game caps", () => {
    const query = Query.parse(withConstraints({ minAp: MAX_AP, minMp: MAX_MP }), data);
    assert.deepEqual([query.minAp, query.minMp], [MAX_AP, MAX_MP]);
});

test("Query.parse rejects minAp above 12 and minMp above 6 as above the game cap", () => {
    const { CODE } = QueryError;
    assertCode(withConstraints({ minAp: MAX_AP + 1 }), CODE.ABOVE_GAME_CAP, {
        field: "constraints.minAp",
        max: MAX_AP,
    });
    assertCode(withConstraints({ minMp: MAX_MP + 0.5 }), CODE.ABOVE_GAME_CAP, {
        field: "constraints.minMp",
        max: MAX_MP,
    });
});
