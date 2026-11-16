function maxRoll({ from, to }) {
    if (to === 0) return from;
    return from >= 0 ? Math.max(from, to) : Math.min(from, to);
}

module.exports = maxRoll;
