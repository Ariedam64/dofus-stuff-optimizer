"use strict";

const STATUS_TICK_MS = 1000;
const STATUS_STATES = Object.freeze({
    idle: "idle",
    running: "running",
    done: "done",
    stopped: "stopped",
    error: "error",
});

// Right column: live status line, notices and the stuff cards kept sorted by score.
class ResultsView {
    #statusLine;
    #noticeList;
    #stuffList;
    #emptyState;
    #elements;
    #element = null;
    #cards = [];
    #startedAt = 0;
    #foundCount = 0;
    #timerId = null;
    #isRunning = false;

    constructor({ root, elements }) {
        this.#statusLine = root.querySelector("#status-line");
        this.#noticeList = root.querySelector("#notices");
        this.#stuffList = root.querySelector("#stuff-list");
        this.#emptyState = root.querySelector("#empty-state");
        this.#elements = elements;
        this.#setStatus(STATUS_STATES.idle, "Règle ta recherche puis clique sur « Lancer ».");
    }

    get isRunning() {
        return this.#isRunning;
    }

    start(elementKey) {
        this.#element = this.#elements.find((element) => element.key === elementKey) ?? { key: elementKey, label: "" };
        this.#cards = [];
        this.#foundCount = 0;
        this.#startedAt = Date.now();
        this.#isRunning = true;
        this.#stuffList.replaceChildren();
        this.#noticeList.replaceChildren();
        this.#emptyState.hidden = true;
        clearInterval(this.#timerId);
        this.#timerId = setInterval(() => this.#renderRunningStatus(), STATUS_TICK_MS);
        this.#renderRunningStatus();
    }

    updateProgress({ foundCount }) {
        this.#foundCount = Math.max(this.#foundCount, foundCount ?? 0);
        this.#renderRunningStatus();
    }

    addStuff(stuff) {
        const card = new StuffCard({ stuff, element: this.#element });
        const nextCard = this.#cards.find((existing) => existing.score < card.score);
        const insertIndex = nextCard ? this.#cards.indexOf(nextCard) : this.#cards.length;
        this.#cards.splice(insertIndex, 0, card);
        this.#stuffList.insertBefore(card.root, nextCard?.root ?? null);
        this.#cards.forEach((existing, index) => (existing.rank = index + 1));
        this.#foundCount = Math.max(this.#foundCount, this.#cards.length);
        this.#renderRunningStatus();
    }

    finish(done) {
        this.#stop();
        const [state, text] = this.#describeOutcome(done);
        this.#setStatus(state, text);
        this.#renderNotices(done);
    }

    showStopped() {
        this.#stop();
        this.#setStatus(
            STATUS_STATES.stopped,
            `\u23F9\uFE0F Recherche arrêtée \u2014 ${formatStuffCount(this.#cards.length)}`,
        );
    }

    showError(message) {
        this.#stop();
        this.#setStatus(STATUS_STATES.error, `\u274C ${message}`);
    }

    #stop() {
        clearInterval(this.#timerId);
        this.#timerId = null;
        this.#isRunning = false;
        this.#emptyState.hidden = this.#cards.length > 0;
    }

    // Only the server's reason may claim infeasibility: a timeout with no stuff proves nothing.
    #describeOutcome(done) {
        const elapsed = formatSeconds(Date.now() - this.#startedAt);
        const count = this.#cards.length;
        if (done.reason === "no-valid-stuff") {
            return [STATUS_STATES.error, "\u274C Aucun stuff ne respecte ces contraintes. Assouplis-les et relance."];
        }
        if (done.reason === "time-limit-reached" && count === 0) {
            const advice = "augmente la durée ou assouplis les contraintes.";
            return [STATUS_STATES.error, `\u23F1\uFE0F Temps écoulé (${elapsed}), aucun stuff trouvé \u2014 ${advice}`];
        }
        if (done.reason === "time-limit-reached") {
            return [STATUS_STATES.done, `\u23F1\uFE0F Temps écoulé (${elapsed}) \u2014 ${formatStuffCount(count)}`];
        }
        const proof = this.#isListProvenOptimal(done) ? " \u2014 liste prouvée optimale" : "";
        return [STATUS_STATES.done, `\u2705 Terminé en ${elapsed} \u2014 ${formatStuffCount(count)}${proof}`];
    }

    #isListProvenOptimal(done) {
        if (!done.isOptimal || this.#cards.length === 0) return false;
        return this.#cards.every((card) => card.isProvenOptimal);
    }

    #renderRunningStatus() {
        if (!this.#isRunning) return;
        const elapsed = formatSeconds(Date.now() - this.#startedAt);
        this.#setStatus(STATUS_STATES.running, `\u23F3 ${elapsed} \u2014 ${formatStuffCount(this.#foundCount)}`);
    }

    #setStatus(state, text) {
        this.#statusLine.dataset.state = state;
        this.#statusLine.textContent = text;
    }

    #renderNotices(done) {
        const spellsText = this.#describeList("Sorts ignorés dans le calcul", done.ignoredSpells);
        const notices = [
            this.#buildCollapsibleNotice("Écartés : conditions non gérées", done.unsupportedItems),
            this.#buildCollapsibleNotice("Réservés (serveur Ankarton, MJ, nominatifs\u2026)", done.unobtainableItems),
            spellsText && createElement("li", { className: "notice", text: spellsText }),
        ].filter(Boolean);
        this.#noticeList.replaceChildren(...notices);
    }

    // Item lists can hold hundreds of names: only their count shows until the notice is opened.
    #buildCollapsibleNotice(label, entries = []) {
        if (entries.length === 0) return null;
        const names = entries.map((entry) => this.#describeEntry(entry)).join(", ");
        const details = createElement("details", {}, [
            createElement("summary", { text: `${label} (${entries.length})` }),
            createElement("p", { className: "notice-detail", text: names }),
        ]);
        return createElement("li", { className: "notice" }, [details]);
    }

    #describeList(label, entries = []) {
        if (entries.length === 0) return null;
        return `${label} : ${entries.map((entry) => this.#describeEntry(entry)).join(", ")}`;
    }

    #describeEntry(entry) {
        if (typeof entry === "string") return entry;
        return entry.name ?? entry.message ?? String(entry.id ?? JSON.stringify(entry));
    }
}
