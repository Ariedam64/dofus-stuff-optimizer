const path = require("path");

const DOFUSDB_BASE_URL = "https://api.dofusdb.fr";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 200;
const USER_AGENT = "dofus-stuff-optimizer";
const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const BASE_AP = 6;
const BONUS_AP_LEVEL = 100;
const BASE_MP = 3;
// The game ignores AP, MP and range above these totals; items giving more stay wearable.
const MAX_AP = 12;
const MAX_MP = 6;
const MAX_RANGE = 9;
const CHARACTERISTIC_POINTS_PER_LEVEL = 5;
const SCROLL_VALUE = 100;
const POINT_COST_TIERS = [
    { from: 0, cost: 1 },
    { from: 100, cost: 2 },
    { from: 200, cost: 3 },
    { from: 300, cost: 4 },
];
const VITALITY_POINT_COST = 1;
const WISDOM_POINT_COST = 3;
const DEFAULT_RESULT_COUNT = 10;
const DEFAULT_MIN_DIFFERENT_ITEMS = 5;
const DEFAULT_TIME_LIMIT_MS = 60000;
// Share of the time limit given to the local search that seeds the solver.
const WARM_START_TIME_RATIO = 0.1;
// The local search needs about 1 s to reach a valid stuff on real data (Crâ 200, 11 AP / 6 MP), even with a short
// time limit.
const MIN_WARM_START_TIME_MS = 1500;
// A larger proven gap means nothing to the user, so such a stuff is reported as unproven.
const MAX_REPORTED_GAP_PERCENT = 10;
const PROGRESS_INTERVAL_MS = 1000;
// HiGHS may run a little past its time limit (model loading, presolve), so StuffSolver stops starting new work this
// long before its deadline.
const SOLVER_DEADLINE_MARGIN_MS = 1500;
// The solver worker is terminated if it is still running this long after the deadline.
const DEADLINE_GRACE_MS = 3000;
// Cap of the LP bound tightening of the stats before the exact model is built.
const MAX_BOUND_TIGHTENING_MS = 2000;
// Persistent solver worker threads, each holding its own copy of the game data; the pool also leaves one core free.
const MAX_SOLVER_WORKERS = 4;
// A search split by weapon (one partition per worker) gives each partition this share of the time limit; a partition
// still without a stuff by then runs on until the whole limit for a first one. A larger share made the split search
// slower than a single one on the benchmark, since it lasts as long as its slowest partition.
const SPLIT_SEARCH_TIME_SHARE = 0.4;
// Least time of a split search's partition, capped by the time limit: 20 s partitions already reach the benchmark's
// best stuffs, while 8 s ones (the share of a 20 s limit) gave clearly worse ones.
const MIN_PARTITION_TIME_MS = 20000;
const WEB_HOST = "127.0.0.1";
const WEB_PORT = 5173;
const DOFUSBOOK_IMPORT_URL = "https://www.dofusbook.net/desktop/fr/equipement/roxx-solver/objets?stuff=";
// Criterion codes reserving an item to a named player, game masters, an Ankarton server (OS) or other non-player
// conditions.
const UNOBTAINABLE_CRITERION_CODES = ["PN", "PX", "BI", "Pn", "Pm", "OS"];
const IS_DEBUG = process.env.IS_DEBUG === "true";

module.exports = {
    DOFUSDB_BASE_URL,
    PAGE_SIZE,
    REQUEST_DELAY_MS,
    USER_AGENT,
    DATA_DIR,
    PUBLIC_DIR,
    BASE_AP,
    BONUS_AP_LEVEL,
    BASE_MP,
    MAX_AP,
    MAX_MP,
    MAX_RANGE,
    CHARACTERISTIC_POINTS_PER_LEVEL,
    SCROLL_VALUE,
    POINT_COST_TIERS,
    VITALITY_POINT_COST,
    WISDOM_POINT_COST,
    DEFAULT_RESULT_COUNT,
    DEFAULT_MIN_DIFFERENT_ITEMS,
    DEFAULT_TIME_LIMIT_MS,
    WARM_START_TIME_RATIO,
    MIN_WARM_START_TIME_MS,
    MAX_REPORTED_GAP_PERCENT,
    PROGRESS_INTERVAL_MS,
    SOLVER_DEADLINE_MARGIN_MS,
    DEADLINE_GRACE_MS,
    MAX_BOUND_TIGHTENING_MS,
    MAX_SOLVER_WORKERS,
    SPLIT_SEARCH_TIME_SHARE,
    MIN_PARTITION_TIME_MS,
    WEB_HOST,
    WEB_PORT,
    DOFUSBOOK_IMPORT_URL,
    UNOBTAINABLE_CRITERION_CODES,
    IS_DEBUG,
};
