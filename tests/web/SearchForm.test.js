const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Query = require("../../src/optimizer/Query");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const SEARCH_FORM_SCRIPTS = ["utils/format.js", "SearchForm.js"];
const CRA = { id: 9, name: "Crâ" };
const META = { breeds: [{ name: CRA.name, headUrl: null }], elements: [{ key: "water", label: "Eau" }] };
const FILLED_INPUTS = {
    "#level": { value: "200" },
    "#min-different-items": { value: "5" },
    "#time-limit": { value: "60" },
};
const RING_EXO_CHOICES = [
    { ap: false, mp: true },
    { ap: true, mp: false },
    { ap: false, mp: false },
    { ap: true, mp: true },
];

class FakeItemPicker {
    itemIds = [];

    remove() {}
}

function createFakeInput(properties = {}) {
    return {
        value: "",
        checked: false,
        replaceChildren() {},
        addEventListener() {},
        querySelectorAll: () => [],
        ...properties,
    };
}

function loadSearchForm() {
    const context = vm.createContext({
        ItemPicker: FakeItemPicker,
        createElement: (tagName, options, children = []) => ({ tagName, options, children }),
        toSafeUrl: (url) => url,
    });
    for (const script of SEARCH_FORM_SCRIPTS) {
        vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, script), "utf8"), context);
    }
    return vm.runInContext("SearchForm", context);
}

// Submits the form with the two ring exo checkboxes set as given and returns the query sent.
function submitWithRingExos({ ap, mp }) {
    const SearchForm = loadSearchForm();
    const inputs = new Map(Object.entries(FILLED_INPUTS).map(([id, properties]) => [id, createFakeInput(properties)]));
    inputs.set("#ap-exo", createFakeInput({ checked: ap }));
    inputs.set("#mp-exo", createFakeInput({ checked: mp }));
    let submitHandler = null;
    const form = {
        elements: { element: { value: "water" } },
        reportValidity: () => true,
        querySelector: (selector) => {
            if (!inputs.has(selector)) inputs.set(selector, createFakeInput());
            return inputs.get(selector);
        },
        addEventListener: (type, handler) => {
            submitHandler = handler;
        },
    };
    let sentQuery = null;
    new SearchForm({ form, meta: META, searchItems: () => [], onSubmit: (query) => (sentQuery = query) });
    submitHandler({ preventDefault() {} });
    return JSON.parse(JSON.stringify(sentQuery));
}

test("the form sends the two ring exo checkboxes as ringExos and the query accepts it", () => {
    for (const ringExos of RING_EXO_CHOICES) {
        const sentQuery = submitWithRingExos(ringExos);
        assert.deepEqual(sentQuery.ringExos, ringExos);
        assert.ok(!Object.hasOwn(sentQuery, "allowRingExos"));
        const query = Query.parse(sentQuery, { findBreed: () => CRA });
        assert.equal(query.allowApExo, ringExos.ap);
        assert.equal(query.allowMpExo, ringExos.mp);
    }
});
