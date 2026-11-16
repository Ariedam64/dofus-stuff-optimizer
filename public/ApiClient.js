"use strict";

const API_META_URL = "/api/meta";
const API_ITEMS_URL = "/api/items";
const API_OPTIMIZE_URL = "/api/optimize";

class ApiClient {
    #sseReader = new SseReader();

    async fetchMeta() {
        return this.#getJson(API_META_URL);
    }

    async searchItems(text, signal) {
        return this.#getJson(`${API_ITEMS_URL}?q=${encodeURIComponent(text)}`, signal);
    }

    async optimize(query, { signal, onEvent }) {
        const response = await this.#request(API_OPTIMIZE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(query),
            signal,
        });
        await this.#sseReader.read(response.body, onEvent);
    }

    async #getJson(url, signal) {
        const response = await this.#request(url, { headers: { Accept: "application/json" }, signal });
        return response.json();
    }

    async #request(url, options) {
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            // fetch() rejects with a TypeError when the server cannot be reached; aborts keep their own error.
            if (!(error instanceof TypeError)) throw error;
            throw new Error(`Serveur injoignable : ${error.message}`);
        }
        // The server explains a refused request in French; its message is shown as is.
        if (!response.ok) throw new Error(await this.#readErrorMessage(response));
        return response;
    }

    async #readErrorMessage(response) {
        const fallback = `Erreur du serveur (HTTP ${response.status} sur ${response.url})`;
        const text = await response.text();
        if (!text) return fallback;
        try {
            return JSON.parse(text).message ?? fallback;
        } catch {
            return text;
        }
    }
}
