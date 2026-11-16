// Messages a solver runner sends to OptimizationManager, from the worker thread or in process. A persistent worker
// also posts READY once its game data is loaded.
const SOLVER_MESSAGE = Object.freeze({
    READY: "ready",
    STUFF: "stuff",
    DONE: "done",
    ERROR: "error",
});

module.exports = { SOLVER_MESSAGE };
