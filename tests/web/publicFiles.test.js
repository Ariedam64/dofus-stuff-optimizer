const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Query = require("../../src/optimizer/Query");
const { MAX_AP, MAX_MP } = require("../../src/config");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const REQUIRED_FILES = ["index.html", "app.js", "style.css", "mock/results.json", "mock/results.js"];
const MIN_MOCK_STUFFS = 3;
const STUFF_KEYS = [
    "score",
    "solverStatus",
    "optimalityGapPercent",
    "items",
    "stats",
    "pointsAllocation",
    "turn",
    "assumedCriteria",
    "dofusbookUrl",
];
const ITEM_KEYS = ["slot", "id", "name", "imgUrl", "exo"];
const TURN_KEYS = ["name", "kind", "imgUrl", "count", "damagePerCast"];
const POINTS_ALLOCATION_KEYS = ["spentPoints", "base", "scrolls"];
const SEARCH_ITEM_KEYS = ["id", "name", "level", "slot", "imgUrl"];
const SOLVER_STATUSES = ["optimal", "gap", "heuristic"];
const EXO_VALUES = [null, "ap", "mp"];
const MAX_POSITIONS = 16;
const BYTE_ORDER_MARK = "\uFEFF";
const SCRIPT_SOURCE_PATTERN = /<script[^>]*\ssrc="([^"]+)"/g;
const STYLESHEET_PATTERN = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
const RESULTS_VIEW_SCRIPTS = ["utils/format.js", "ResultsView.js"];
const STUFF_CARD_SCRIPTS = ["utils/format.js", "utils/labels.js", "StuffCard.js"];
const RESULTS_VIEW_SELECTORS = ["#status-line", "#notices", "#stuff-list", "#empty-state"];
const WATER_ELEMENT = { key: "water", label: "Eau" };
const OPTIMAL_STUFF = { score: 3000, solverStatus: "optimal" };
const GAP_STUFF = { score: 2900, solverStatus: "gap" };
const INFEASIBLE_TEXT = "ne respecte ces contraintes";
const PROVEN_LIST_TEXT = "liste prouvée optimale";
const TIME_LIMIT_MIN_PATTERN = /<input id="time-limit"[^>]*\smin="(\d+)"/;
const MS_PER_SECOND = 1000;
const RING_EXO_CHECKBOXES = [
    { id: "ap-exo", label: "Exo PA sur les anneaux" },
    { id: "mp-exo", label: "Exo PM sur les anneaux" },
];

function readPublicFile(relativePath) {
    return fs.readFileSync(path.join(PUBLIC_DIR, relativePath), "utf8");
}

function listMatches(text, pattern) {
    return [...text.matchAll(pattern)].map((match) => match[1]);
}

function listPublicFiles(directory = PUBLIC_DIR) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listPublicFiles(fullPath) : [fullPath];
    });
}

function readMockData() {
    return JSON.parse(readPublicFile("mock/results.json"));
}

function createFakeElement() {
    return {
        dataset: {},
        textContent: "",
        hidden: false,
        children: [],
        replaceChildren(...children) {
            this.children = children;
        },
        insertBefore(child) {
            this.children.push(child);
        },
    };
}

class FakeStuffCard {
    constructor({ stuff }) {
        this.score = stuff.score;
        this.isProvenOptimal = stuff.solverStatus === "optimal";
        this.root = createFakeElement();
    }

    set rank(value) {
        this.root.textContent = `#${value}`;
    }
}

function loadResultsView() {
    const context = vm.createContext({
        setInterval,
        clearInterval,
        StuffCard: FakeStuffCard,
        createElement: (tagName, { text } = {}, children = []) => ({ tagName, text, children }),
    });
    for (const script of RESULTS_VIEW_SCRIPTS) vm.runInContext(readPublicFile(script), context);
    return vm.runInContext("ResultsView", context);
}

function finishSearchWithNodes({ stuffs = [], done }) {
    const ResultsView = loadResultsView();
    const nodes = new Map(RESULTS_VIEW_SELECTORS.map((selector) => [selector, createFakeElement()]));
    const root = { querySelector: (selector) => nodes.get(selector) };
    const view = new ResultsView({ root, elements: [WATER_ELEMENT] });
    view.start(WATER_ELEMENT.key);
    for (const stuff of stuffs) view.addStuff(stuff);
    view.finish(done);
    return nodes;
}

function finishSearch(options) {
    return finishSearchWithNodes(options).get("#status-line").textContent;
}

// Texts of a fake element tree, depth first.
function collectTexts(node) {
    if (typeof node === "string") return [node];
    return [...(node.text === undefined ? [] : [node.text]), ...(node.children ?? []).flatMap(collectTexts)];
}

function findTagNames(node) {
    if (typeof node !== "object") return [];
    return [node.tagName, ...(node.children ?? []).flatMap(findTagNames)];
}

function assertHasKeys(object, keys, label) {
    for (const key of keys) assert.ok(Object.hasOwn(object, key), `${label} is missing "${key}"`);
}

test("the page files exist", () => {
    for (const file of REQUIRED_FILES) {
        assert.ok(fs.existsSync(path.join(PUBLIC_DIR, file)), `public/${file} is missing`);
    }
});

test("index.html references app.js and style.css", () => {
    const html = readPublicFile("index.html");
    assert.ok(listMatches(html, SCRIPT_SOURCE_PATTERN).includes("app.js"));
    assert.ok(listMatches(html, STYLESHEET_PATTERN).includes("style.css"));
});

test("every script and stylesheet referenced by index.html exists", () => {
    const html = readPublicFile("index.html");
    const references = [...listMatches(html, SCRIPT_SOURCE_PATTERN), ...listMatches(html, STYLESHEET_PATTERN)];
    for (const reference of references) {
        assert.ok(fs.existsSync(path.join(PUBLIC_DIR, reference)), `index.html references missing ${reference}`);
    }
});

test("app.js aborts searches with AbortController and never uses EventSource", () => {
    assert.match(readPublicFile("app.js"), /AbortController/);
    for (const file of listPublicFiles().filter((filePath) => filePath.endsWith(".js"))) {
        assert.doesNotMatch(fs.readFileSync(file, "utf8"), /EventSource/, `${file} uses EventSource`);
    }
});

test("the mock holds at least 3 stuffs with the documented keys", () => {
    const { stuffs } = readMockData();
    assert.ok(stuffs.length >= MIN_MOCK_STUFFS);
    for (const [index, stuff] of stuffs.entries()) {
        const label = `stuff ${index}`;
        assertHasKeys(stuff, STUFF_KEYS, label);
        assert.ok(SOLVER_STATUSES.includes(stuff.solverStatus), `${label} has an unknown solverStatus`);
        assert.ok(stuff.items.length <= MAX_POSITIONS);
        for (const item of stuff.items) {
            assertHasKeys(item, ITEM_KEYS, `${label} item`);
            assert.ok(EXO_VALUES.includes(item.exo));
        }
        for (const cast of stuff.turn) assertHasKeys(cast, TURN_KEYS, `${label} turn`);
        assertHasKeys(stuff.pointsAllocation, POINTS_ALLOCATION_KEYS, `${label} pointsAllocation`);
    }
});

test("the mock holds the meta and the items for the autocomplete", () => {
    const { meta, items, done } = readMockData();
    assert.ok(meta.breeds.length > 0);
    for (const breed of meta.breeds) assertHasKeys(breed, ["id", "name", "headUrl"], "breed");
    for (const element of meta.elements) assertHasKeys(element, ["key", "label"], "element");
    assert.ok(items.length > 0);
    for (const item of items) assertHasKeys(item, SEARCH_ITEM_KEYS, "search item");
    assertHasKeys(done, ["isOptimal", "reason", "unsupportedItems", "unobtainableItems", "ignoredSpells"], "done");
});

test("mock/results.js mirrors mock/results.json for pages opened from the disk", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(readPublicFile("mock/results.js"), sandbox);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.MOCK_DATA)), readMockData());
});

test("public files are UTF-8 without BOM and end with a newline", () => {
    for (const file of listPublicFiles()) {
        const content = fs.readFileSync(file, "utf8");
        assert.ok(!content.startsWith(BYTE_ORDER_MARK), `${file} starts with a BOM`);
        assert.ok(content.endsWith("\n"), `${file} has no final newline`);
    }
});

test("a timeout without any stuff does not claim the constraints are infeasible", () => {
    const status = finishSearch({ done: { isOptimal: false, reason: "time-limit-reached" } });
    assert.match(status, /Temps écoulé/);
    assert.match(status, /aucun stuff trouvé/);
    assert.doesNotMatch(status, new RegExp(INFEASIBLE_TEXT));
});

test("only the no-valid-stuff reason says the constraints are infeasible", () => {
    assert.match(finishSearch({ done: { isOptimal: false, reason: "no-valid-stuff" } }), new RegExp(INFEASIBLE_TEXT));
    assert.doesNotMatch(finishSearch({ done: { isOptimal: false, reason: null } }), new RegExp(INFEASIBLE_TEXT));
});

test("the list is called proven optimal only when done.isOptimal and every card is optimal", () => {
    const provenDone = { isOptimal: true, reason: null };
    assert.match(finishSearch({ stuffs: [OPTIMAL_STUFF], done: provenDone }), new RegExp(PROVEN_LIST_TEXT));
    assert.doesNotMatch(
        finishSearch({ stuffs: [OPTIMAL_STUFF, GAP_STUFF], done: provenDone }),
        new RegExp(PROVEN_LIST_TEXT),
    );
    assert.doesNotMatch(
        finishSearch({ stuffs: [OPTIMAL_STUFF], done: { isOptimal: false, reason: null } }),
        new RegExp(PROVEN_LIST_TEXT),
    );
});

test("the page's shortest time limit is the shortest one the query accepts", () => {
    const minSeconds = Number(readPublicFile("index.html").match(TIME_LIMIT_MIN_PATTERN)[1]);
    const gameData = { findBreed: () => ({ id: 9, name: "Crâ" }) };
    const parseWithSeconds = (seconds) =>
        Query.parse(
            { breed: "cra", level: 200, profile: { elements: ["water"] }, timeLimitMs: seconds * MS_PER_SECOND },
            gameData,
        );
    assert.equal(parseWithSeconds(minSeconds).timeLimitMs, minSeconds * MS_PER_SECOND);
    assert.throws(() => parseWithSeconds(minSeconds - 1), /Invalid query: timeLimitMs/);
});

test("the page's AP and MP minimums stop at the game caps", () => {
    const html = readPublicFile("index.html");
    const maxOf = (id) => Number(html.match(new RegExp(`<input id="${id}"[^>]*\\smax="(\\d+)"`))[1]);
    assert.deepEqual([maxOf("min-ap"), maxOf("min-mp")], [MAX_AP, MAX_MP]);
});

test("the page offers the AP and MP ring exos as two checkboxes checked by default", () => {
    const html = readPublicFile("index.html");
    for (const { id, label } of RING_EXO_CHECKBOXES) {
        assert.match(html, new RegExp(`<input id="${id}" type="checkbox" checked />\\s*<span>${label}</span>`));
    }
    assert.match(readPublicFile("SearchForm.js"), /ringExos: \{/);
});

test("excluded item notices show a count and keep the names in a collapsible detail", () => {
    const unsupportedItems = [1, 2, 3].map((id) => ({ id, name: `Objet ${id}` }));
    const unobtainableItems = [{ id: 4, name: "Bouclier Ankarton" }];
    const done = { isOptimal: false, reason: null, unsupportedItems, unobtainableItems, ignoredSpells: [] };
    const notices = finishSearchWithNodes({ done }).get("#notices").children;
    assert.equal(notices.length, 2);
    const [unsupported, unobtainable] = notices.map(collectTexts);
    assert.equal(unsupported[0], "Écartés : conditions non gérées (3)");
    assert.match(unsupported.join(" "), /Objet 1, Objet 2, Objet 3/);
    assert.equal(unobtainable[0], "Réservés (serveur Ankarton, MJ, nominatifs\u2026) (1)");
    for (const notice of notices) assert.deepEqual(findTagNames(notice).slice(0, 3), ["li", "details", "summary"]);
});

function buildFakeNode(tagName, { className, text, attributes = {} } = {}, children = []) {
    return { tagName, className, text, attributes, children };
}

function findNode(node, isWanted) {
    if (typeof node !== "object") return null;
    if (isWanted(node)) return node;
    for (const child of node.children) {
        const found = findNode(child, isWanted);
        if (found) return found;
    }
    return null;
}

function buildCardBadge(stuff) {
    const context = vm.createContext({
        location: { href: "http://127.0.0.1/" },
        URL,
        createElement: buildFakeNode,
        createIcon: () => buildFakeNode("img"),
        toSafeUrl: (url) => url,
    });
    for (const script of STUFF_CARD_SCRIPTS) vm.runInContext(readPublicFile(script), context);
    const card = new (vm.runInContext("StuffCard", context))({ stuff, element: WATER_ELEMENT });
    return findNode(card.root, (node) => node.className?.startsWith("badge "));
}

test("the gap badge says how far the stuff can be from the best possible one", () => {
    const gapStuff = readMockData().stuffs.find((stuff) => stuff.solverStatus === "gap");
    const badge = buildCardBadge(gapStuff);
    const gap = gapStuff.optimalityGapPercent.toLocaleString("fr-FR");
    assert.equal(badge.attributes.title, `Dégâts à au plus ${gap}\u00A0% du meilleur possible.`);
});
