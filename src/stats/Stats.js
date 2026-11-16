const { CHARACTERISTIC_NAMES } = require("./characteristics");
const maxRoll = require("../utils/maxRoll");

const UNKNOWN_NAME_PREFIX = "c";

class Stats {
    #values = new Map();

    constructor(entries = []) {
        for (const [id, value] of entries) {
            this.add(id, value);
        }
    }

    static fromDofusDbEffects(effects) {
        const stats = new Stats();
        for (const effect of effects.filter((candidate) => candidate.characteristic > 0)) {
            stats.add(effect.characteristic, maxRoll(effect));
        }
        return stats;
    }

    get(id) {
        return this.#values.get(id) ?? 0;
    }

    add(id, value) {
        this.#values.set(id, this.get(id) + value);
    }

    addAll(other) {
        for (const id of other.ids()) {
            this.add(id, other.get(id));
        }
    }

    clone() {
        const copy = new Stats();
        copy.addAll(this);
        return copy;
    }

    ids() {
        return [...this.#values.keys()];
    }

    toNamedObject() {
        const named = {};
        for (const [id, value] of this.#values) {
            named[CHARACTERISTIC_NAMES[id] ?? `${UNKNOWN_NAME_PREFIX}${id}`] = value;
        }
        return named;
    }
}

module.exports = Stats;
