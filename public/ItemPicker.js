"use strict";

const PICKER_DEBOUNCE_MS = 200;
const PICKER_MIN_QUERY_LENGTH = 2;
const NO_ACTIVE_SUGGESTION = -1;
const PICKER_KEY_STEPS = Object.freeze({ ArrowDown: 1, ArrowUp: -1 });

// Autocomplete input that collects items as removable chips.
class ItemPicker {
    #input;
    #chipList;
    #suggestionList;
    #searchItems;
    #onAdd;
    #selectedItems = new Map();
    #suggestions = [];
    #activeIndex = NO_ACTIVE_SUGGESTION;
    #debounceTimerId = null;
    #searchController = null;

    constructor({ host, searchItems, onAdd = () => {} }) {
        this.#input = host.querySelector("input");
        this.#chipList = host.querySelector(".chips");
        this.#suggestionList = host.querySelector(".suggestions");
        this.#searchItems = searchItems;
        this.#onAdd = onAdd;
        this.#input.addEventListener("input", () => this.#scheduleSearch());
        this.#input.addEventListener("keydown", (event) => this.#handleKey(event));
        this.#input.addEventListener("blur", () => this.#hideSuggestions());
    }

    get itemIds() {
        return [...this.#selectedItems.keys()];
    }

    remove(itemId) {
        if (!this.#selectedItems.delete(itemId)) return;
        this.#renderChips();
    }

    #scheduleSearch() {
        this.#cancelPendingSearch();
        const text = this.#input.value.trim();
        if (text.length < PICKER_MIN_QUERY_LENGTH) {
            this.#hideSuggestions();
            return;
        }
        this.#debounceTimerId = setTimeout(() => {
            const controller = new AbortController();
            this.#searchController = controller;
            this.#fetchSuggestions(text, controller.signal).catch((error) => this.#showSearchError(error, controller));
        }, PICKER_DEBOUNCE_MS);
    }

    async #fetchSuggestions(text, signal) {
        const items = await this.#searchItems(text, signal);
        if (signal.aborted) return;
        this.#suggestions = items.filter((item) => !this.#selectedItems.has(item.id));
        this.#activeIndex = this.#suggestions.length > 0 ? 0 : NO_ACTIVE_SUGGESTION;
        this.#renderSuggestions();
    }

    #showSearchError(error, controller) {
        if (controller.signal.aborted) return;
        console.error(`\u274C Item search failed: ${error.message}`);
        this.#suggestions = [];
        this.#renderMessage("Recherche impossible pour le moment.");
    }

    #handleKey(event) {
        if (event.key === "Escape") {
            this.#hideSuggestions();
            return;
        }
        if (event.key === "Enter") {
            // Enter picks a suggestion and must not submit the search form.
            event.preventDefault();
            const item = this.#suggestions[this.#activeIndex];
            if (item && !this.#suggestionList.hidden) this.#choose(item);
            return;
        }
        const step = PICKER_KEY_STEPS[event.key];
        if (!step || this.#suggestions.length === 0) return;
        event.preventDefault();
        const count = this.#suggestions.length;
        this.#activeIndex = (this.#activeIndex + step + count) % count;
        this.#renderSuggestions();
    }

    #cancelPendingSearch() {
        clearTimeout(this.#debounceTimerId);
        this.#searchController?.abort();
    }

    #choose(item) {
        this.#cancelPendingSearch();
        this.#selectedItems.set(item.id, item);
        this.#input.value = "";
        this.#hideSuggestions();
        this.#renderChips();
        this.#onAdd(item);
    }

    #renderSuggestions() {
        if (this.#suggestions.length === 0) {
            this.#renderMessage("Aucun item trouvé.");
            return;
        }
        const options = this.#suggestions.map((item, index) => this.#buildSuggestion(item, index));
        this.#suggestionList.replaceChildren(...options);
        this.#suggestionList.hidden = false;
        this.#input.setAttribute("aria-expanded", "true");
    }

    #buildSuggestion(item, index) {
        const option = createElement("li", { className: "suggestion", attributes: { role: "option" } }, [
            createIcon(item.imgUrl, { className: "suggestion-icon" }),
            createElement("span", { className: "suggestion-name", text: item.name }),
            createElement("span", {
                className: "suggestion-meta",
                text: `${SLOT_LABELS[item.slot] ?? ""} \u00B7 niv. ${item.level}`,
            }),
        ]);
        option.classList.toggle("is-active", index === this.#activeIndex);
        option.setAttribute("aria-selected", String(index === this.#activeIndex));
        // mousedown fires before the input blur that would hide the list.
        option.addEventListener("mousedown", (event) => {
            event.preventDefault();
            this.#choose(item);
        });
        return option;
    }

    #renderMessage(message) {
        this.#suggestionList.replaceChildren(createElement("li", { className: "suggestion-message", text: message }));
        this.#suggestionList.hidden = false;
    }

    #hideSuggestions() {
        this.#suggestionList.hidden = true;
        this.#input.setAttribute("aria-expanded", "false");
    }

    #renderChips() {
        const chips = [...this.#selectedItems.values()].map((item) => this.#buildChip(item));
        this.#chipList.replaceChildren(...chips);
    }

    #buildChip(item) {
        const removeButton = createElement("button", {
            className: "chip-remove",
            text: "\u00D7",
            attributes: { type: "button", "aria-label": `Retirer ${item.name}` },
        });
        removeButton.addEventListener("click", () => this.remove(item.id));
        return createElement("li", { className: "chip", attributes: { title: item.name } }, [
            createIcon(item.imgUrl, { className: "chip-icon" }),
            createElement("span", { className: "chip-name", text: item.name }),
            removeButton,
        ]);
    }
}
