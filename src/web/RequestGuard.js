const HTTP_FORBIDDEN = 403;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const LOOPBACK_HOST_NAMES = ["127.0.0.1", "localhost"];
const JSON_MEDIA_TYPE = "application/json";
const FOREIGN_REQUEST_MESSAGE = "Requête refusée : elle ne vient pas de la page de l'optimiseur.";
const NOT_JSON_MESSAGE = "Requête refusée : le corps doit être du JSON (Content-Type: application/json).";

function isJsonContentType(contentType = "") {
    return contentType.split(";")[0].trim().toLowerCase() === JSON_MEDIA_TYPE;
}

// Only the optimizer's own page may use the server. Another site could otherwise start searches from the
// visitor's browser (a cross-origin text/plain or form POST needs no CORS preflight) or reach the server under its
// own host name (DNS rebinding).
class RequestGuard {
    #allowedHosts;
    #allowedOrigins;

    constructor({ host, port }) {
        this.#allowedHosts = [...new Set([host, ...LOOPBACK_HOST_NAMES])].map((name) => `${name}:${port}`);
        this.#allowedOrigins = this.#allowedHosts.map((allowedHost) => `http://${allowedHost}`);
    }

    // The status and French message to answer with, or null when the request may go on.
    findRejection(request, { isJsonRequired }) {
        const { host, origin } = request.headers;
        const isForeignOrigin = origin !== undefined && !this.#allowedOrigins.includes(origin);
        if (!this.#allowedHosts.includes(host) || isForeignOrigin) {
            return { status: HTTP_FORBIDDEN, message: FOREIGN_REQUEST_MESSAGE };
        }
        if (isJsonRequired && !isJsonContentType(request.headers["content-type"])) {
            return { status: HTTP_UNSUPPORTED_MEDIA_TYPE, message: NOT_JSON_MESSAGE };
        }
        return null;
    }
}

module.exports = RequestGuard;
