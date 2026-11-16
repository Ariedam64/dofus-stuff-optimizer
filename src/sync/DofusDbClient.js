const sleep = require("../utils/sleep");

const SKIP_PARAM = "$skip";
const LIMIT_PARAM = "$limit";

class DofusDbClient {
    #baseUrl;
    #pageSize;
    #requestDelayMs;
    #userAgent;
    #fetchFn;

    constructor({ baseUrl, pageSize, requestDelayMs, userAgent, fetchFn = fetch }) {
        this.#baseUrl = baseUrl;
        this.#pageSize = pageSize;
        this.#requestDelayMs = requestDelayMs;
        this.#userAgent = userAgent;
        this.#fetchFn = fetchFn;
    }

    async fetchAll(path, query = {}) {
        const results = [];
        let skip = 0;
        let total = 0;
        do {
            const page = await this.#fetchPage(path, query, skip);
            results.push(...page.data);
            total = page.total;
            skip += this.#pageSize;
            if (skip < total) await sleep(this.#requestDelayMs);
        } while (skip < total);
        return results;
    }

    async #fetchPage(path, query, skip) {
        const url = this.#buildUrl(path, query, skip);
        const response = await this.#fetchFn(url, { headers: { "User-Agent": this.#userAgent } });
        if (!response.ok) throw new Error(`DofusDB GET ${url} failed: ${response.status}`);
        const page = await response.json();
        if (typeof page.total !== "number") throw new Error(`DofusDB GET ${url} returned no numeric total`);
        return page;
    }

    #buildUrl(path, query, skip) {
        const params = [`${LIMIT_PARAM}=${this.#pageSize}`, `${SKIP_PARAM}=${skip}`];
        this.#serializeParams(query, "", params);
        return `${this.#baseUrl}/${path}?${params.join("&")}`;
    }

    #serializeParams(value, prefix, params) {
        if (Array.isArray(value)) {
            for (const item of value) params.push(`${prefix}[]=${encodeURIComponent(item)}`);
            return;
        }
        if (value !== null && typeof value === "object") {
            for (const [key, child] of Object.entries(value)) {
                this.#serializeParams(child, prefix ? `${prefix}[${key}]` : key, params);
            }
            return;
        }
        params.push(`${prefix}=${encodeURIComponent(value)}`);
    }
}

module.exports = DofusDbClient;
