"use strict";

const SAFE_URL_PROTOCOLS = ["http:", "https:"];

function createElement(tagName, { className, text, attributes = {} } = {}, children = []) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.append(...children);
    return element;
}

// URLs come from the API: anything but http(s), such as javascript:, is dropped.
function toSafeUrl(url) {
    if (typeof url !== "string" || !URL.canParse(url, location.href)) return null;
    return SAFE_URL_PROTOCOLS.includes(new URL(url, location.href).protocol) ? url : null;
}

function createIcon(source, { className, alt = "" } = {}) {
    const image = createElement("img", {
        className,
        attributes: { alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" },
    });
    // A missing DofusDB image must leave an empty frame, not the browser's broken-image glyph.
    image.addEventListener("error", () => image.classList.add("is-broken"), { once: true });
    const safeSource = toSafeUrl(source);
    if (safeSource) image.src = safeSource;
    return image;
}
