const sleep = require("../../src/utils/sleep");
const Optimality = require("../../src/solver/Optimality");
const { buildRandomCase } = require("../solver/randomCases");

const NO_DELAY_MS = 0;

// A random solver case as a search context: PartitionedSearch also needs findItems.
function buildRandomSearchContext(seed, { resultCount, minDifferentItems }) {
    const context = buildRandomCase(seed);
    context.query.resultCount = resultCount;
    context.query.minDifferentItems = minDifferentItems;
    const itemsById = new Map([...context.candidates.values()].flat().map((item) => [item.id, item]));
    return { ...context, findItems: (itemIds) => itemIds.map((id) => itemsById.get(id)) };
}

// A context whose stuffs are their own score: the item ids [score] evaluate to that score, a negative one is invalid.
function buildScoreContext(resultCount) {
    return {
        query: { resultCount },
        findItems: (itemIds) => itemIds,
        evaluator: { evaluate: ([score]) => (score >= 0 ? { score, items: [score] } : null) },
    };
}

// upperBound: the bound the solver proved for this stuff and every later one, or null.
function stuffStep(score, upperBound = null, delayMs = NO_DELAY_MS) {
    return { type: "stuff", itemIds: [score], ...Optimality.describe(score, upperBound), upperBound, delayMs };
}

function doneStep({ isComplete = true, isInfeasible = false, delayMs = NO_DELAY_MS } = {}) {
    return { type: "done", isComplete, isInfeasible, delayMs };
}

function waitForAbortStep() {
    return { type: "wait" };
}

function failStep(message) {
    return { type: "fail", message };
}

function waitForAbort(signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}

// Plays one script of steps per job, in the order the jobs are started; it records each job and how it ended.
class ScriptedRunner {
    #scripts;
    #jobs = [];

    constructor(scripts) {
        this.#scripts = scripts;
    }

    get size() {
        return this.#scripts.length;
    }

    get jobs() {
        return this.#jobs;
    }

    async *run(job, { signal }) {
        const record = { job, isAborted: false, isEnded: false };
        const steps = this.#scripts[this.#jobs.length];
        this.#jobs.push(record);
        try {
            for (const { delayMs, ...step } of steps) {
                if (step.type === "wait") await waitForAbort(signal);
                if (step.type === "fail") throw new Error(step.message);
                await sleep(delayMs ?? NO_DELAY_MS);
                if (signal.aborted) return;
                yield step;
            }
        } finally {
            record.isAborted = signal.aborted;
            record.isEnded = true;
        }
    }
}

module.exports = {
    buildRandomSearchContext,
    buildScoreContext,
    stuffStep,
    doneStep,
    waitForAbortStep,
    failStep,
    ScriptedRunner,
};
