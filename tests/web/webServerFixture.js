const http = require("http");
const path = require("path");
const GameData = require("../../src/data/GameData");
const Breed = require("../../src/data/Breed");
const Item = require("../../src/data/Item");
const WebServer = require("../../src/web/WebServer");
const breedsRaw = require("../fixtures/breeds.json");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const LOCALHOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const OCRE_ITEM_ID = 9001;
const OCRE_ITEM_LEVEL = 200;
const SILENT_LOGGER = { error: () => {} };
const JSON_HEADERS = { "Content-Type": "application/json" };

class StubManager {
    calls = [];
    behavior = async (_query, { onStuff }) => {
        onStuff(1, { score: 10 });
        onStuff(2, { score: 9 });
        return {
            isOptimal: true,
            reason: null,
            unsupportedItems: [],
            unobtainableItems: [],
            ignoredSpells: [],
            extra: 1,
        };
    };

    async runStreaming(query, hooks) {
        this.calls.push({ query, signal: hooks.signal });
        return this.behavior(query, hooks);
    }
}

async function startServer(manager, logger = SILENT_LOGGER) {
    const gameData = await GameData.load(FIXTURES_DIR);
    // The shared fixture has no Ocre item: add one so autocomplete is checked on a realistic name.
    const ocre = new Item({ id: OCRE_ITEM_ID, name: "Dofus Ocre", level: OCRE_ITEM_LEVEL, slot: "dofus" });
    gameData.items = [...gameData.items, ocre];
    const breeds = breedsRaw.map((raw) => Breed.fromDofusDb(raw, []));
    const server = new WebServer({
        gameData,
        manager,
        breeds,
        host: LOCALHOST,
        port: EPHEMERAL_PORT,
        publicDir: PUBLIC_DIR,
        openBrowser: false,
        logger,
    });
    const { url } = await server.start();
    return { server, url };
}

function postJson(url, body) {
    return fetch(`${url}/api/optimize`, { method: "POST", headers: JSON_HEADERS, body });
}

// fetch cannot set the Host header, so these requests go through http.request.
function rawRequest(url, { method = "GET", path: requestPath = "/", headers = {}, body = null }) {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
        const request = http.request({ hostname, port, path: requestPath, method, headers }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        request.on("error", reject);
        request.end(body);
    });
}

module.exports = { LOCALHOST, JSON_HEADERS, StubManager, startServer, postJson, rawRequest };
