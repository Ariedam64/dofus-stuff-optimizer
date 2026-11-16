"use strict";

const MOCK_DATA_URL = "mock/results.json";
const MOCK_SCRIPT_URL = "mock/results.js";
const FILE_PROTOCOL = "file:";
const MOCK_ITEM_LIMIT = 20;
const MOCK_SEARCH_DELAY_MS = 150;
const MOCK_PROGRESS_INTERVAL_MS = 500;
const MOCK_STUFF_DELAYS_MS = [1400, 900, 1600, 1100];
const MOCK_FINAL_DELAY_MS = 1200;
// Stuffs arrive out of score order, as with the real solver, to show that cards stay sorted.
const MOCK_ARRIVAL_ORDER = [2, 0, 3, 1];
const MOCK_TIMEOUT_DURATION_MS = 3000;
// ?mock=1 streams the mock stuffs; ?mock=timeout hits the time limit before finding any stuff.
const MOCK_SCENARIOS = Object.freeze({ 1: "results", timeout: "timeout" });

// Stands in for ApiClient with ?mock=<scenario>, so the page works without the Node server.
class MockApiClient {
    #data;
    #scenario;

    constructor(data, scenario) {
        this.#data = data;
        this.#scenario = scenario;
    }

    static findScenario(parameterValue) {
        return MOCK_SCENARIOS[parameterValue] ?? null;
    }

    static async load(scenario) {
        if (location.protocol === FILE_PROTOCOL) {
            return new MockApiClient(await MockApiClient.#loadScriptData(), scenario);
        }
        const response = await fetch(MOCK_DATA_URL);
        if (!response.ok) throw new Error(`Cannot load ${MOCK_DATA_URL} (HTTP ${response.status})`);
        return new MockApiClient(await response.json(), scenario);
    }

    // Browsers refuse fetch() on file:// pages, but still run a plain script next to the page.
    static #loadScriptData() {
        return new Promise((resolve, reject) => {
            const script = createElement("script", { attributes: { src: MOCK_SCRIPT_URL } });
            script.addEventListener("load", () => resolve(window.MOCK_DATA));
            script.addEventListener("error", () => reject(new Error(`Cannot load ${MOCK_SCRIPT_URL}`)));
            document.head.append(script);
        });
    }

    async fetchMeta() {
        return this.#data.meta;
    }

    async searchItems(text, signal) {
        await sleep(MOCK_SEARCH_DELAY_MS, signal);
        const needle = normalizeSearchText(text);
        if (!needle) return [];
        const matches = this.#data.items.filter((item) => normalizeSearchText(item.name).includes(needle));
        const prefixMatches = matches.filter((item) => normalizeSearchText(item.name).startsWith(needle));
        const otherMatches = matches.filter((item) => !prefixMatches.includes(item));
        return [...prefixMatches, ...otherMatches].slice(0, MOCK_ITEM_LIMIT);
    }

    async optimize(query, { signal, onEvent }) {
        const startedAt = Date.now();
        let foundCount = 0;
        const emitProgress = () => onEvent("progress", { elapsedMs: Date.now() - startedAt, foundCount });
        const progressTimerId = setInterval(emitProgress, MOCK_PROGRESS_INTERVAL_MS);
        try {
            if (this.#scenario === MOCK_SCENARIOS.timeout) {
                await sleep(MOCK_TIMEOUT_DURATION_MS, signal);
                onEvent("done", { ...this.#data.done, reason: "time-limit-reached" });
                return;
            }
            await this.#streamStuffs(query, signal, (stuff) => {
                foundCount += 1;
                onEvent("stuff", { rank: foundCount, stuff });
            });
            await sleep(MOCK_FINAL_DELAY_MS, signal);
            onEvent("done", {
                ...this.#data.done,
                reason: foundCount === 0 ? "no-valid-stuff" : this.#data.done.reason,
            });
        } finally {
            clearInterval(progressTimerId);
        }
    }

    async #streamStuffs(query, signal, onStuff) {
        for (const [step, stuffIndex] of MOCK_ARRIVAL_ORDER.entries()) {
            await sleep(MOCK_STUFF_DELAYS_MS[step], signal);
            const stuff = this.#data.stuffs[stuffIndex];
            if (stuff && this.#matchesQuery(stuff, query)) onStuff(stuff);
        }
    }

    #matchesQuery(stuff, query) {
        const { minAp = 0, minMp = 0, requiredItemIds = [], excludedItemIds = [] } = query.constraints;
        const itemIds = stuff.items.map((item) => item.id);
        if ((stuff.stats.ap ?? 0) < minAp || (stuff.stats.mp ?? 0) < minMp) return false;
        if (requiredItemIds.some((itemId) => !itemIds.includes(itemId))) return false;
        return !excludedItemIds.some((itemId) => itemIds.includes(itemId));
    }
}
