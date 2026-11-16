// Messages a solver runner sends to OptimizationManager, from the worker thread or in process.
const SOLVER_MESSAGE = Object.freeze({ STUFF: "stuff", DONE: "done", ERROR: "error" });

module.exports = { SOLVER_MESSAGE };
