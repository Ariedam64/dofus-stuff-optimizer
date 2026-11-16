// Weighted sum of characteristics: weights is a Map<characteristic, coefficient>.
function weighStats(stats, weights) {
    let total = 0;
    for (const [characteristic, weight] of weights) total += weight * stats.get(characteristic);
    return total;
}

module.exports = weighStats;
