// An atom starts the criterion or follows &, | or (; codes may be lower case (Pn, Pm, pk).
const CRITERION_ATOM_PATTERN = /(?:^|[&|(])\s*([A-Za-z]{2})\s*([<>=!~])/g;

function parseCriterionAtoms(criterion) {
    return [...criterion.matchAll(CRITERION_ATOM_PATTERN)].map(([, code, operator]) => ({ code, operator }));
}

module.exports = parseCriterionAtoms;
