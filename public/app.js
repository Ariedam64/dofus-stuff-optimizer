"use strict";

const MOCK_QUERY_PARAMETER = "mock";

// Wires the form, the API (real or mock) and the results; one search runs at a time.
class App {
    #mockScenario;
    #api = null;
    #form = null;
    #results = null;
    #searchController = null;

    constructor({ mockScenario }) {
        this.#mockScenario = mockScenario;
    }

    get #isMock() {
        return this.#mockScenario !== null;
    }

    async start() {
        this.#api = this.#isMock ? await MockApiClient.load(this.#mockScenario) : new ApiClient();
        const meta = await this.#api.fetchMeta();
        this.#showHeaderInfo(meta);
        this.#results = new ResultsView({ root: document.querySelector("#results"), elements: meta.elements });
        this.#form = new SearchForm({
            form: document.querySelector("#search-form"),
            meta,
            searchItems: (text, signal) => this.#api.searchItems(text, signal),
            onSubmit: (query) => this.#runSearch(query).catch((error) => this.#showSearchError(error)),
            onStop: () => this.#stopSearch(),
        });
        window.addEventListener("pagehide", () => this.#searchController?.abort());
    }

    showFatalError(error) {
        console.error(`\u274C Page start failed: ${error.message}`);
        const statusLine = document.querySelector("#status-line");
        statusLine.dataset.state = "error";
        statusLine.textContent = this.#isMock
            ? `\u274C Impossible de charger les données de démo : ${error.message}`
            : "\u274C Serveur injoignable. Lance « npm run web », ou ajoute ?mock=1 à l'adresse pour la démo.";
    }

    async #runSearch(query) {
        this.#searchController?.abort();
        const controller = new AbortController();
        this.#searchController = controller;
        this.#form.isRunning = true;
        this.#results.start(query.profile.elements[0]);
        try {
            await this.#api.optimize(query, {
                signal: controller.signal,
                onEvent: (type, data) => this.#handleEvent(controller, type, data),
            });
            if (this.#results.isRunning) this.#results.showError("La recherche s'est interrompue avant la fin.");
        } catch (error) {
            // An aborted search was replaced or stopped on purpose.
            if (!controller.signal.aborted) throw error;
        } finally {
            if (this.#searchController === controller) {
                this.#searchController = null;
                this.#form.isRunning = false;
            }
        }
    }

    #showSearchError(error) {
        console.error(`\u274C Search failed: ${error.message}`);
        this.#results.showError(error.message);
    }

    #stopSearch() {
        if (!this.#searchController) return;
        this.#searchController.abort();
        this.#results.showStopped();
    }

    #handleEvent(controller, type, data) {
        // A replaced or stopped search may still deliver an event already in flight.
        if (controller !== this.#searchController || controller.signal.aborted) return;
        if (type === "progress") this.#results.updateProgress(data);
        if (type === "stuff") this.#results.addStuff(data.stuff);
        if (type === "done") this.#results.finish(data);
        if (type === "error") this.#results.showError(data.message);
        if (!this.#results.isRunning) this.#form.isRunning = false;
    }

    #showHeaderInfo(meta) {
        document.querySelector("#mock-badge").hidden = !this.#isMock;
        if (!meta.dataSyncedAt) return;
        document.querySelector("#data-info").textContent = `Données DofusDB du ${formatDate(meta.dataSyncedAt)}`;
    }
}

const mockScenario = MockApiClient.findScenario(new URLSearchParams(location.search).get(MOCK_QUERY_PARAMETER));
const app = new App({ mockScenario });
app.start().catch((error) => app.showFatalError(error));
