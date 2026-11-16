"use strict";

const DEFAULT_BREED_NAME = "Crâ";
const DEFAULT_ELEMENT_KEY = "water";
const SEARCH_RESULT_COUNT = 10;
const ELEMENT_INPUT_NAME = "element";

// Owns the search form: fills it from /api/meta and turns it into an optimize query.
class SearchForm {
    #form;
    #fields;
    #requiredPicker;
    #excludedPicker;
    #onSubmit;

    constructor({ form, meta, searchItems, onSubmit, onStop }) {
        this.#form = form;
        this.#onSubmit = onSubmit;
        this.#fields = this.#findFields();
        this.#populateBreeds(meta.breeds);
        this.#populateElements(meta.elements);
        this.#populateResistances(meta.elements);
        this.#requiredPicker = new ItemPicker({
            host: this.#fields.requiredItems,
            searchItems,
            onAdd: (item) => this.#excludedPicker.remove(item.id),
        });
        this.#excludedPicker = new ItemPicker({
            host: this.#fields.excludedItems,
            searchItems,
            onAdd: (item) => this.#requiredPicker.remove(item.id),
        });
        form.addEventListener("submit", (event) => this.#submit(event));
        this.#fields.stopButton.addEventListener("click", onStop);
    }

    set isRunning(value) {
        this.#fields.launchButton.textContent = value ? "Relancer" : "Lancer";
        this.#fields.stopButton.hidden = !value;
    }

    #findFields() {
        const find = (id) => this.#form.querySelector(`#${id}`);
        return {
            breed: find("breed"),
            breedHead: find("breed-head"),
            level: find("level"),
            elementChoices: find("element-choices"),
            minAp: find("min-ap"),
            minMp: find("min-mp"),
            minCritical: find("min-critical"),
            resistanceInputs: find("resistance-inputs"),
            useScrolls: find("use-scrolls"),
            apExo: find("ap-exo"),
            mpExo: find("mp-exo"),
            minDifferentItems: find("min-different-items"),
            timeLimit: find("time-limit"),
            requiredItems: find("required-items"),
            excludedItems: find("excluded-items"),
            launchButton: find("launch-button"),
            stopButton: find("stop-button"),
        };
    }

    #populateBreeds(breeds) {
        const { breed, breedHead } = this.#fields;
        const options = breeds.map((entry) =>
            createElement("option", { text: entry.name, attributes: { value: entry.name } }),
        );
        breed.replaceChildren(...options);
        if (breeds.some((entry) => entry.name === DEFAULT_BREED_NAME)) breed.value = DEFAULT_BREED_NAME;
        const showHead = () => {
            const selected = breeds.find((entry) => entry.name === breed.value);
            const headUrl = toSafeUrl(selected?.headUrl);
            breedHead.src = headUrl ?? "";
            breedHead.hidden = !headUrl;
        };
        breed.addEventListener("change", showHead);
        showHead();
    }

    #populateElements(elements) {
        const choices = elements.map((element) => {
            const input = createElement("input", {
                attributes: { type: "radio", name: ELEMENT_INPUT_NAME, value: element.key, required: "" },
            });
            input.checked = element.key === DEFAULT_ELEMENT_KEY;
            return createElement(
                "label",
                { className: "element-choice", attributes: { "data-element": element.key } },
                [input, createElement("span", { text: element.label })],
            );
        });
        this.#fields.elementChoices.replaceChildren(...choices);
    }

    #populateResistances(elements) {
        const inputs = elements.map((element) => {
            const input = createElement("input", {
                attributes: {
                    type: "number",
                    min: "0",
                    max: "100",
                    step: "1",
                    inputmode: "numeric",
                    placeholder: "\u2013",
                    "data-element": element.key,
                    "aria-label": `Résistance ${element.label} minimum (%)`,
                },
            });
            return createElement("label", { className: "resistance", attributes: { "data-element": element.key } }, [
                createElement("span", { text: element.label }),
                input,
            ]);
        });
        this.#fields.resistanceInputs.replaceChildren(...inputs);
    }

    #submit(event) {
        event.preventDefault();
        if (!this.#form.reportValidity()) return;
        this.#onSubmit(this.#buildQuery());
    }

    #buildQuery() {
        const fields = this.#fields;
        const timeLimitSeconds = this.#readOptionalNumber(fields.timeLimit);
        return {
            breed: fields.breed.value,
            level: Number(fields.level.value),
            profile: {
                elements: [this.#form.elements[ELEMENT_INPUT_NAME].value],
                minCriticalRate: this.#readOptionalNumber(fields.minCritical),
            },
            constraints: {
                minAp: this.#readOptionalNumber(fields.minAp),
                minMp: this.#readOptionalNumber(fields.minMp),
                minResistances: this.#readResistances(),
                excludedItemIds: this.#excludedPicker.itemIds,
                requiredItemIds: this.#requiredPicker.itemIds,
            },
            ringExos: { ap: fields.apExo.checked, mp: fields.mpExo.checked },
            useScrolls: fields.useScrolls.checked,
            resultCount: SEARCH_RESULT_COUNT,
            diversity: { minDifferentItems: this.#readOptionalNumber(fields.minDifferentItems) },
            timeLimitMs: timeLimitSeconds === undefined ? undefined : timeLimitSeconds * MS_PER_SECOND,
        };
    }

    #readOptionalNumber(input) {
        return input.value === "" ? undefined : Number(input.value);
    }

    #readResistances() {
        const inputs = [...this.#fields.resistanceInputs.querySelectorAll("input")];
        const filledInputs = inputs.filter((input) => input.value !== "");
        return Object.fromEntries(filledInputs.map((input) => [input.dataset.element, Number(input.value)]));
    }
}
