const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../config");
const ItemSearch = require("./ItemSearch");
const RequestGuard = require("./RequestGuard");
const { ELEMENT_LABELS, toFrenchMessage } = require("./frenchMessages");
const SearchContext = require("../optimizer/SearchContext");
const QueryError = require("../optimizer/QueryError");

const DEFAULT_PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const INDEX_FILE = "index.html";
const MAX_BODY_BYTES = 1024 * 1024;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_SERVER_ERROR = 500;
const MISSING_FILE_CODES = ["ENOENT", "EISDIR", "ENOTDIR", "EINVAL"];
const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};
const STATIC_SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff" };
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const SSE_HEADERS = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
};
const ELEMENTS = Object.entries(ELEMENT_LABELS).map(([key, label]) => ({ key, label }));
const OPTIMIZE_PATH = "/api/optimize";

function buildBrowserCommand(url) {
    if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", '""', url] };
    if (process.platform === "darwin") return { command: "open", args: [url] };
    return { command: "xdg-open", args: [url] };
}

class WebServer {
    #gameData;
    #manager;
    #host;
    #port;
    #publicDir;
    #breeds;
    #isBrowserOpened;
    #logger;
    #itemSearch;
    #server = null;
    #requestGuard = null;
    #currentSearch = null;

    constructor({
        gameData,
        manager,
        host = config.WEB_HOST,
        port = config.WEB_PORT,
        publicDir = DEFAULT_PUBLIC_DIR,
        breeds = gameData.breeds,
        openBrowser = true,
        logger = console,
    }) {
        this.#gameData = gameData;
        this.#manager = manager;
        this.#host = host;
        this.#port = port;
        this.#publicDir = path.resolve(publicDir);
        this.#breeds = breeds;
        this.#isBrowserOpened = openBrowser;
        this.#logger = logger;
        this.#itemSearch = new ItemSearch(gameData.items);
    }

    async start() {
        if (!Array.isArray(this.#breeds)) throw new Error("WebServer needs a breed list (gameData.breeds)");
        this.#server = http.createServer((request, response) => {
            this.#handle(request, response).catch((error) => this.#handleFailure(response, error));
        });
        await new Promise((resolve, reject) => {
            this.#server.once("error", reject);
            this.#server.listen(this.#port, this.#host, resolve);
        });
        const { port } = this.#server.address();
        this.#requestGuard = new RequestGuard({ host: this.#host, port });
        const url = `http://${this.#host}:${port}`;
        this.#logger.error(`✅ Page ouverte sur ${url}`);
        if (this.#isBrowserOpened) this.#openBrowser(url);
        return { url };
    }

    async stop() {
        this.#currentSearch?.abort();
        await this.#closeServer();
        await this.#manager.close();
    }

    async #closeServer() {
        if (!this.#server) return;
        const server = this.#server;
        this.#server = null;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }

    #openBrowser(url) {
        const { command, args } = buildBrowserCommand(url);
        const child = spawn(command, args, {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            windowsVerbatimArguments: true,
        });
        child.on("error", (error) => this.#logger.error(`❌ Cannot open browser: ${error.message}`));
        child.unref();
    }

    async #handle(request, response) {
        const { pathname, searchParams } = new URL(request.url, "http://localhost");
        const isOptimize = request.method === "POST" && pathname === OPTIMIZE_PATH;
        const rejection = this.#requestGuard.findRejection(request, { isJsonRequired: isOptimize });
        if (rejection) return this.#sendJson(response, rejection.status, { message: rejection.message });
        if (request.method === "GET" && pathname === "/api/meta") return this.#sendMeta(response);
        if (request.method === "GET" && pathname === "/api/items") {
            return this.#sendJson(response, HTTP_OK, this.#itemSearch.search(searchParams.get("q") ?? ""));
        }
        if (isOptimize) return this.#optimize(request, response);
        if (request.method === "GET" && !pathname.startsWith("/api/")) return this.#serveStatic(response, request.url);
        return this.#sendJson(response, HTTP_NOT_FOUND, { message: "Not found" });
    }

    #handleFailure(response, error) {
        this.#logger.error(`❌ ${error.stack ?? error.message}`);
        if (response.headersSent) return response.end();
        this.#sendJson(response, HTTP_SERVER_ERROR, { message: toFrenchMessage(error) });
    }

    #sendJson(response, status, body) {
        response.writeHead(status, JSON_HEADERS);
        response.end(JSON.stringify(body));
    }

    #sendMeta(response) {
        this.#sendJson(response, HTTP_OK, {
            breeds: this.#breeds.map((breed) => ({ id: breed.id, name: breed.name, headUrl: breed.headUrl ?? null })),
            elements: ELEMENTS,
            dataSyncedAt: this.#gameData.dataSyncedAt,
        });
    }

    async #serveStatic(response, rawUrl) {
        const filePath = this.#resolveStaticPath(rawUrl);
        const content = filePath ? await this.#readFileOrNull(filePath) : null;
        if (!content) return this.#sendJson(response, HTTP_NOT_FOUND, { message: "Not found" });
        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
        response.writeHead(HTTP_OK, { "Content-Type": contentType, ...STATIC_SECURITY_HEADERS });
        response.end(content);
    }

    #resolveStaticPath(rawUrl) {
        let pathname;
        try {
            pathname = decodeURIComponent(rawUrl.split("?")[0]);
        } catch (error) {
            if (config.IS_DEBUG) this.#logger.error(`🔍 Malformed URL escape: ${error.message}`);
            return null;
        }
        if (pathname.includes("\u0000")) return null;
        const relative = pathname.endsWith("/") ? pathname + INDEX_FILE : pathname;
        const filePath = path.resolve(this.#publicDir, `.${relative}`);
        return filePath.startsWith(this.#publicDir + path.sep) ? filePath : null;
    }

    async #readFileOrNull(filePath) {
        try {
            return await fs.readFile(filePath);
        } catch (error) {
            if (MISSING_FILE_CODES.includes(error.code)) return null;
            throw error;
        }
    }

    async #readJsonBody(request) {
        const chunks = [];
        let totalBytes = 0;
        for await (const chunk of request) {
            totalBytes += chunk.length;
            if (totalBytes > MAX_BODY_BYTES) {
                throw new QueryError(QueryError.CODE.BODY_TOO_LARGE, "Invalid query: body too large");
            }
            chunks.push(chunk);
        }
        try {
            return JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (error) {
            const message = "Invalid query: body is not valid JSON";
            throw new QueryError(QueryError.CODE.INVALID_BODY, message, {}, { cause: error });
        }
    }

    async #optimize(request, response) {
        let queryJson;
        try {
            queryJson = await this.#readJsonBody(request);
            SearchContext.parseQuery(queryJson, this.#gameData);
        } catch (error) {
            if (!(error instanceof QueryError)) throw error;
            const status = error.code === QueryError.CODE.BODY_TOO_LARGE ? HTTP_PAYLOAD_TOO_LARGE : HTTP_BAD_REQUEST;
            return this.#sendJson(response, status, this.#describeError(error));
        }
        this.#currentSearch?.abort();
        const controller = new AbortController();
        this.#currentSearch = controller;
        response.on("close", () => controller.abort());
        response.writeHead(HTTP_OK, SSE_HEADERS);
        response.flushHeaders();
        try {
            const result = await this.#manager.runStreaming(queryJson, {
                onStuff: (rank, stuff) => this.#sendEvent(response, "stuff", { rank, stuff }),
                onProgress: (progress) => this.#sendEvent(response, "progress", progress),
                signal: controller.signal,
            });
            this.#sendEvent(response, "done", this.#pickDonePayload(result));
        } catch (error) {
            this.#reportSearchError(response, controller, error);
        } finally {
            if (this.#currentSearch === controller) this.#currentSearch = null;
            if (!response.writableEnded) response.end();
        }
    }

    #sendEvent(response, type, data) {
        if (response.writableEnded || response.destroyed) return;
        response.write(`event: ${type}
data: ${JSON.stringify(data)}

`);
    }

    // The final results replace the streamed stuffs: a streamed stuff may have been pushed out of the list since.
    #pickDonePayload(result) {
        const { isOptimal, reason, unsupportedItems, unobtainableItems, ignoredSpells, results } = result;
        return { isOptimal, reason, unsupportedItems, unobtainableItems, ignoredSpells, results };
    }

    // The page shows the French message; the code is kept for clients that want to react to one error kind.
    #describeError(error) {
        return { message: toFrenchMessage(error), code: error.code };
    }

    #reportSearchError(response, controller, error) {
        if (controller.signal.aborted) return;
        this.#logger.error(`❌ Search failed: ${error.message}`);
        this.#sendEvent(response, "error", this.#describeError(error));
    }
}

module.exports = WebServer;
