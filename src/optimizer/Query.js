const QueryError = require("./QueryError");
const { ELEMENTS, isElementKey } = require("../stats/elements");
const {
    DEFAULT_RESULT_COUNT,
    DEFAULT_MIN_DIFFERENT_ITEMS,
    DEFAULT_TIME_LIMIT_MS,
    MAX_AP,
    MAX_MP,
} = require("../config");

const MIN_LEVEL = 1;
const MAX_LEVEL = 200;
const ELEMENTS_PER_PROFILE = 1;
const DEFAULT_MIN_AP = 0;
const DEFAULT_MIN_MP = 0;
const MIN_RESULT_COUNT = 1;
const MAX_RESULT_COUNT = 20;
const MIN_DIFFERENT_ITEMS = 1;
const MAX_DIFFERENT_ITEMS = 16;
// A search reloads the game data in its worker (about 1.6 s) and needs a warm start: shorter limits leave no time to
// search.
const MIN_TIME_LIMIT_MS = 5000;
const MAX_TIME_LIMIT_MS = 300000;
const DEFAULT_USE_SCROLLS = true;
const DEFAULT_ALLOW_RING_EXOS = true;
const ROOT_FIELDS = [
    "breed",
    "level",
    "profile",
    "constraints",
    "ringExos",
    "allowRingExos",
    "topCount",
    "resultCount",
    "useScrolls",
    "diversity",
    "timeLimitMs",
];
const RING_EXO_FIELDS = ["ap", "mp"];
const DIVERSITY_FIELDS = ["minDifferentItems"];
const PROFILE_FIELDS = ["elements", "minCriticalRate"];
const CONSTRAINT_FIELDS = ["minAp", "minMp", "minResistances", "excludedItemIds", "requiredItemIds"];

function fail(field, reason, details = {}) {
    throw new QueryError(QueryError.CODE.INVALID_FIELD, `Invalid query: ${field} ${reason}`, { field, ...details });
}

function rejectUnknownFields(object, allowedFields, prefix) {
    for (const key of Object.keys(object)) {
        if (allowedFields.includes(key)) continue;
        const field = `${prefix}${key}`;
        throw new QueryError(QueryError.CODE.UNKNOWN_FIELD, `Invalid query: unknown field "${field}"`, { field });
    }
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readOptionalObject(value, field) {
    if (value === undefined) return {};
    if (!isPlainObject(value)) fail(field, "must be an object");
    return value;
}

function readNonNegativeNumber(value, field, defaultValue) {
    if (value === undefined) return defaultValue;
    if (!isNonNegativeNumber(value)) fail(field, `must be a number >= 0, got ${JSON.stringify(value)}`);
    return value;
}

// The game ignores AP and MP above their caps, so a higher minimum could never be met.
function readCappedMinimum(value, field, { defaultValue, max }) {
    const minimum = readNonNegativeNumber(value, field, defaultValue);
    if (minimum > max) {
        const message = `Invalid query: ${field} must be at most ${max} (game cap), got ${minimum}`;
        throw new QueryError(QueryError.CODE.ABOVE_GAME_CAP, message, { field, max });
    }
    return minimum;
}

function readLevel(value) {
    if (!Number.isInteger(value) || value < MIN_LEVEL || value > MAX_LEVEL) {
        const reason = `must be an integer between ${MIN_LEVEL} and ${MAX_LEVEL}, got ${JSON.stringify(value)}`;
        fail("level", reason, { min: MIN_LEVEL, max: MAX_LEVEL });
    }
    return value;
}

function readElementKey(elements) {
    const validKeys = Object.keys(ELEMENTS).join(", ");
    if (!Array.isArray(elements) || elements.length !== ELEMENTS_PER_PROFILE) {
        fail("profile.elements", `must contain exactly ${ELEMENTS_PER_PROFILE} element among ${validKeys}`);
    }
    const [elementKey] = elements;
    if (!isElementKey(elementKey)) {
        fail("profile.elements", `has unknown element "${elementKey}" (valid: ${validKeys})`);
    }
    return elementKey;
}

function readMinCriticalRate(value) {
    if (value === undefined || value === null) return null;
    return readNonNegativeNumber(value, "profile.minCriticalRate");
}

function readMinResistances(value) {
    const minResistances = readOptionalObject(value, "constraints.minResistances");
    for (const [elementKey, minimum] of Object.entries(minResistances)) {
        const field = `constraints.minResistances.${elementKey}`;
        if (!isElementKey(elementKey)) fail(field, `is not an element (valid: ${Object.keys(ELEMENTS).join(", ")})`);
        if (typeof minimum !== "number" || !Number.isFinite(minimum)) fail(field, "must be a number");
    }
    return { ...minResistances };
}

function readItemIds(value, field) {
    if (value === undefined) return new Set();
    if (!Array.isArray(value) || !value.every(Number.isInteger)) fail(field, "must be an array of item ids");
    return new Set(value);
}

function readBoolean(value, field, defaultValue) {
    if (value === undefined) return defaultValue;
    if (typeof value !== "boolean") fail(field, "must be a boolean");
    return value;
}

function readIntegerInRange(value, field, { min, max, defaultValue }) {
    if (value === undefined) return defaultValue;
    if (!Number.isInteger(value) || value < min || value > max) {
        fail(field, `must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`, { min, max });
    }
    return value;
}

// allowRingExos is the legacy all-or-nothing form of ringExos.
function readRingExos(json) {
    if (json.ringExos !== undefined && json.allowRingExos !== undefined) {
        fail("ringExos", "replaces allowRingExos, give only one of them");
    }
    if (json.allowRingExos !== undefined) {
        const isAllowed = readBoolean(json.allowRingExos, "allowRingExos");
        return { allowApExo: isAllowed, allowMpExo: isAllowed };
    }
    const ringExos = readOptionalObject(json.ringExos, "ringExos");
    rejectUnknownFields(ringExos, RING_EXO_FIELDS, "ringExos.");
    return {
        allowApExo: readBoolean(ringExos.ap, "ringExos.ap", DEFAULT_ALLOW_RING_EXOS),
        allowMpExo: readBoolean(ringExos.mp, "ringExos.mp", DEFAULT_ALLOW_RING_EXOS),
    };
}

function readResultCount(json) {
    if (json.topCount !== undefined && json.resultCount !== undefined) {
        fail("topCount", "is an alias of resultCount, give only one of them");
    }
    const field = json.topCount !== undefined ? "topCount" : "resultCount";
    const options = { min: MIN_RESULT_COUNT, max: MAX_RESULT_COUNT, defaultValue: DEFAULT_RESULT_COUNT };
    return readIntegerInRange(json[field], field, options);
}

class Query {
    breed;
    level;
    elementKey;
    minCriticalRate;
    minAp;
    minMp;
    minResistances;
    excludedItemIds;
    requiredItemIds;
    allowApExo;
    allowMpExo;
    resultCount;
    useScrolls;
    minDifferentItems;
    timeLimitMs;

    constructor(fields) {
        this.breed = fields.breed;
        this.level = fields.level;
        this.elementKey = fields.elementKey;
        this.minCriticalRate = fields.minCriticalRate;
        this.minAp = fields.minAp;
        this.minMp = fields.minMp;
        this.minResistances = fields.minResistances;
        this.excludedItemIds = fields.excludedItemIds;
        this.requiredItemIds = fields.requiredItemIds;
        this.allowApExo = fields.allowApExo;
        this.allowMpExo = fields.allowMpExo;
        this.resultCount = fields.resultCount;
        this.useScrolls = fields.useScrolls;
        this.minDifferentItems = fields.minDifferentItems;
        this.timeLimitMs = fields.timeLimitMs;
    }

    // exoKey: a key of EXO_CHARACTERISTICS ("ap" / "mp").
    allowsExo(exoKey) {
        const isAllowedByExoKey = { ap: this.allowApExo, mp: this.allowMpExo };
        if (!Object.hasOwn(isAllowedByExoKey, exoKey)) throw new Error(`Unknown ring exo "${exoKey}"`);
        return isAllowedByExoKey[exoKey];
    }

    static parse(json, gameData) {
        if (!isPlainObject(json)) fail("root", "must be an object");
        if (typeof json.breed !== "string") fail("breed", "must be a breed name");
        rejectUnknownFields(json, ROOT_FIELDS, "");
        if (!isPlainObject(json.profile)) fail("profile", "must be an object");
        rejectUnknownFields(json.profile, PROFILE_FIELDS, "profile.");
        const constraints = readOptionalObject(json.constraints, "constraints");
        rejectUnknownFields(constraints, CONSTRAINT_FIELDS, "constraints.");
        const diversity = readOptionalObject(json.diversity, "diversity");
        rejectUnknownFields(diversity, DIVERSITY_FIELDS, "diversity.");
        return new Query({
            breed: gameData.findBreed(json.breed),
            level: readLevel(json.level),
            elementKey: readElementKey(json.profile.elements),
            minCriticalRate: readMinCriticalRate(json.profile.minCriticalRate),
            minAp: readCappedMinimum(constraints.minAp, "constraints.minAp", {
                defaultValue: DEFAULT_MIN_AP,
                max: MAX_AP,
            }),
            minMp: readCappedMinimum(constraints.minMp, "constraints.minMp", {
                defaultValue: DEFAULT_MIN_MP,
                max: MAX_MP,
            }),
            minResistances: readMinResistances(constraints.minResistances),
            excludedItemIds: readItemIds(constraints.excludedItemIds, "constraints.excludedItemIds"),
            requiredItemIds: readItemIds(constraints.requiredItemIds, "constraints.requiredItemIds"),
            ...readRingExos(json),
            resultCount: readResultCount(json),
            useScrolls: readBoolean(json.useScrolls, "useScrolls", DEFAULT_USE_SCROLLS),
            minDifferentItems: readIntegerInRange(diversity.minDifferentItems, "diversity.minDifferentItems", {
                min: MIN_DIFFERENT_ITEMS,
                max: MAX_DIFFERENT_ITEMS,
                defaultValue: DEFAULT_MIN_DIFFERENT_ITEMS,
            }),
            timeLimitMs: readIntegerInRange(json.timeLimitMs, "timeLimitMs", {
                min: MIN_TIME_LIMIT_MS,
                max: MAX_TIME_LIMIT_MS,
                defaultValue: DEFAULT_TIME_LIMIT_MS,
            }),
        });
    }
}

module.exports = Query;
