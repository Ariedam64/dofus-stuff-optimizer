const QUERY_ERROR_CODE = Object.freeze({
    INVALID_BODY: "invalid-body",
    BODY_TOO_LARGE: "body-too-large",
    INVALID_FIELD: "invalid-field",
    UNKNOWN_FIELD: "unknown-field",
    ABOVE_GAME_CAP: "above-game-cap",
    UNKNOWN_BREED: "unknown-breed",
    UNKNOWN_REQUIRED_ITEM: "unknown-required-item",
    REQUIRED_ITEM_ABOVE_LEVEL: "required-item-above-level",
    TOO_MANY_REQUIRED_ITEMS: "too-many-required-items",
    TOO_MANY_REQUIRED_PRYSMARADITES: "too-many-required-prysmaradites",
    REQUIRED_SHIELD_WITH_TWO_HANDED_WEAPON: "required-shield-with-two-handed-weapon",
    NO_DAMAGE_ACTION: "no-damage-action",
});

// A query the search cannot run. The message is for logs; the stable code and the details let the page explain
// the problem in French.
class QueryError extends Error {
    static CODE = QUERY_ERROR_CODE;

    code;
    details;

    constructor(code, message, details = {}, options = {}) {
        super(message, options);
        this.name = "QueryError";
        this.code = code;
        this.details = details;
    }
}

module.exports = QueryError;
