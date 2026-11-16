const KEY_SEPARATOR = ",";

function buildStuffKey(items) {
    return items
        .map((item) => item.id)
        .sort((first, second) => first - second)
        .join(KEY_SEPARATOR);
}

class StuffRanking {
    #capacity;
    #entries = [];
    #keys = new Set();

    constructor(capacity) {
        this.#capacity = capacity;
    }

    get isFull() {
        return this.#entries.length >= this.#capacity;
    }

    get worstScore() {
        if (this.#entries.length === 0) return -Infinity;
        return this.#entries[this.#entries.length - 1].evaluation.score;
    }

    get evaluations() {
        return this.#entries.map((entry) => entry.evaluation);
    }

    offer(evaluation) {
        if (this.isFull && evaluation.score <= this.worstScore) return false;
        const key = buildStuffKey(evaluation.items);
        if (this.#keys.has(key)) return false;
        const index = this.#entries.findIndex((entry) => entry.evaluation.score < evaluation.score);
        const entry = { key, evaluation: { ...evaluation, items: [...evaluation.items] } };
        this.#entries.splice(index === -1 ? this.#entries.length : index, 0, entry);
        this.#keys.add(key);
        if (this.#entries.length > this.#capacity) this.#keys.delete(this.#entries.pop().key);
        return true;
    }
}

module.exports = StuffRanking;
