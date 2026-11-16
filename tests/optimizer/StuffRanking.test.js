const test = require("node:test");
const assert = require("node:assert/strict");
const StuffRanking = require("../../src/optimizer/StuffRanking");

function buildEvaluation(score, ids) {
    return { score, items: ids.map((id) => ({ id })) };
}

test("keeps the best evaluations sorted by score", () => {
    const ranking = new StuffRanking(2);
    assert.equal(ranking.isFull, false);
    assert.equal(ranking.offer(buildEvaluation(10, [1])), true);
    ranking.offer(buildEvaluation(30, [2]));
    ranking.offer(buildEvaluation(20, [3]));
    assert.equal(ranking.isFull, true);
    assert.deepEqual(
        ranking.evaluations.map((evaluation) => evaluation.score),
        [30, 20],
    );
    assert.equal(ranking.worstScore, 20);
    assert.equal(ranking.offer(buildEvaluation(15, [4])), false);
});

test("ignores a stuff already ranked, whatever the item order", () => {
    const ranking = new StuffRanking(3);
    ranking.offer(buildEvaluation(10, [1, 2]));
    assert.equal(ranking.offer(buildEvaluation(10, [2, 1])), false);
    assert.equal(ranking.evaluations.length, 1);
});

test("a stuff pushed out of the ranking can enter again", () => {
    const ranking = new StuffRanking(1);
    ranking.offer(buildEvaluation(10, [1]));
    ranking.offer(buildEvaluation(20, [2]));
    assert.equal(ranking.offer(buildEvaluation(30, [1])), true);
    assert.deepEqual(ranking.evaluations[0].items, [{ id: 1 }]);
});

test("stores a copy of the evaluation items", () => {
    const ranking = new StuffRanking(1);
    const items = [{ id: 1 }];
    ranking.offer({ score: 5, items });
    items.push({ id: 2 });
    assert.equal(ranking.evaluations[0].items.length, 1);
});
