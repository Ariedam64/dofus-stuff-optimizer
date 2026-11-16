const DIACRITICS_PATTERN = /[\u0300-\u036F]/g;

function normalizeName(text) {
    return text.normalize("NFD").replace(DIACRITICS_PATTERN, "").toLowerCase().trim();
}

module.exports = normalizeName;
