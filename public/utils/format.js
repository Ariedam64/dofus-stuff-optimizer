"use strict";

const FRENCH_LOCALE = "fr-FR";
const MS_PER_SECOND = 1000;
const DIACRITICS_PATTERN = /[\u0300-\u036F]/g;

function formatNumber(value, maximumFractionDigits = 0) {
    return new Intl.NumberFormat(FRENCH_LOCALE, { maximumFractionDigits }).format(value);
}

function formatSeconds(durationMs) {
    return `${Math.round(durationMs / MS_PER_SECOND)}\u00A0s`;
}

function formatDate(isoDate) {
    return new Intl.DateTimeFormat(FRENCH_LOCALE, { dateStyle: "long" }).format(new Date(isoDate));
}

function formatStuffCount(count) {
    if (count === 0) return "aucun stuff trouvé";
    return count === 1 ? "1 stuff trouvé" : `${count} stuffs trouvés`;
}

function normalizeSearchText(text) {
    return text.normalize("NFD").replace(DIACRITICS_PATTERN, "").toLowerCase().trim();
}
