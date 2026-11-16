# Dofus Stuff Optimizer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 branch-and-bound with a HiGHS MILP solver (log-damage tangent cuts), add characteristic points and scrolls, return 10 diverse stuffs streamed as found, export each stuff as a Dofusbook link, and add a local web page next to the existing CLI and Claude agent.

**Architecture:** The MILP proposes stuffs, and the v1 exact `StuffEvaluator` (now with points) scores everything shown. `OptimizationManager` orchestrates the steps: filter, warm start, iterative solves with diversity cuts, and a streaming callback. A native `http` server streams results over SSE to a vanilla JS page.

**Tech Stack:** Node.js 24 CommonJS, `highs@1.15.4` (MIT, WASM: the only new dependency), `node:test`, `node:http`, and HTML/CSS/JS with no build step.

**Spec:** `docs/superpowers/specs/2026-11-16-solver-points-web-design.md` (extends `docs/superpowers/specs/2026-11-15-dofus-stuff-optimizer-design.md`)

## Global Constraints

- **Dependencies:** Node.js 24, CommonJS. The only new dependency is `highs` (`npm install highs@1.15.4`, run once in Task 0). Add nothing else: no express, no bundler, no front-end framework.
- **Conventions:** follow the author's global coding conventions:
    - one class per file, `#private` fields, constants at the top, no magic numbers, guard clauses;
    - functions ≤ ~50 lines, files ≤ ~300 lines;
    - throw with context and catch once; emoji logs on stderr; `config.IS_DEBUG` for debug logs.
- **Language:** code, comments and logs in English; texts shown to the user (page, agent) in French.
- **Git:** NO git commits and NO `git add` (user instruction). Skip every commit step.
- **Exact numbers only:** displayed damage and stats come only from `StuffEvaluator` (exact). The MILP only proposes. A stuff is `solverStatus: "optimal"` only when HiGHS proved it under an exact model.
- **Characteristic points:**
    - available points = 5 × (level − 1);
    - Strength, Intelligence, Chance and Agility cost 1 point per stat up to 100, then 2 up to 200, 3 up to 300 and 4 above;
    - Vitality costs 1 and Wisdom costs 3;
    - scrolls add +100 to each of the 6 stats when `useScrolls` is true.
- **Diversity:** a new stuff must differ from every better-ranked stuff by its weapon, or by at least `minDifferentItems` (default 5) of the 16 positions. An empty position counts as an item, and rings are compared as a set.
- **Time:** the whole search is ≤ `timeLimitMs` (default 60000) and streams each stuff as soon as it is scored.
- **Dofusbook link format:** see the spec, section "Précisions après relecture du constructeur". Reference vector:
  `AQEfKAL__4YbSQyGGla4LdpOEUimVrk9TYIPG4M_iDGSMaxV9DXIBQAwAQkAAQEIAAEHEk9wdGltaXNldXIgQ3JhIEVhdQ`
- **Parallel execution:**
    - tasks of the same wave run concurrently;
    - each task may only edit the files listed in its **Files** block;
    - review packages are produced per task with `git diff -- <task files>`.

## Review Focus

- **Impossible constraints** (`minAp: 20`) → `reason: "no-valid-stuff"` within seconds: the MILP reports infeasible, and the search never runs until the timeout. Test in Task 5.
- **Item conditions with OR on stats** (`CA>249|CS>249`) → the point allocation picks the cheapest satisfiable branch. Test in Task 1.
- **A new search started while one runs, or the page closed mid-search** → the previous search is aborted, no crash, no leaked SSE stream. Test in Task 6.
- **Autocomplete with loose input** (`ocre` → « Dofus Ocre », unknown name → empty list, not an error). Test in Task 6.
- **Level below 200** (150) → 745 points, items ≤ 150, and the link encodes level 150. Tests in Tasks 1 and 2.

---

## Waves

| Wave | Tasks (parallel inside a wave)                                                     |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | Task 0                                                                             |
| 1    | Task 1 · Task 2 · Task 3 · Task 4                                                  |
| 2    | Task 5 (depends on 1, 2, 4) · Task 6 (depends on 3 and on Task 5's interface only) |
| 3    | Task 7                                                                             |

---

### Task 0: Dependency, config and query fields

**Files:**

- Modify: `package.json`, `src/config.js`, `src/optimizer/Query.js`, `src/data/Item.js`, `src/data/Spell.js` (add `imgUrl` getters from the raw `img` field)
- Test: `tests/optimizer/Query.test.js` (+ split file if > 300 lines)

**Interfaces:**

- **Produces, in `config.js`:**
    - `CHARACTERISTIC_POINTS_PER_LEVEL = 5`;
    - `SCROLL_VALUE = 100`;
    - `POINT_COST_TIERS = [{ from: 0, cost: 1 }, { from: 100, cost: 2 }, { from: 200, cost: 3 }, { from: 300, cost: 4 }]`;
    - `VITALITY_POINT_COST = 1`, `WISDOM_POINT_COST = 3`;
    - `DEFAULT_RESULT_COUNT = 10`, `DEFAULT_MIN_DIFFERENT_ITEMS = 5`, `DEFAULT_TIME_LIMIT_MS = 60000`;
    - `WEB_HOST = "127.0.0.1"`, `WEB_PORT = 5173`;
    - `DOFUSBOOK_IMPORT_URL = "https://www.dofusbook.net/desktop/fr/equipement/roxx-solver/objets?stuff="`.

    Remove `SEARCH_TIME_LIMIT_MS`, `VARIANT_TIME_LIMIT_MS` and `DEFAULT_TOP_COUNT`. Task 5 updates their remaining users. Until then, keep them exported as deprecated aliases so the suite stays green.

- **Produces, new `Query` fields** (Query.parse accepts them, unknown-field rejection unchanged):
    - `useScrolls` (bool, default true);
    - `resultCount` (int 1–20, default 10; `topCount` accepted as an alias, and both at once → `Invalid query`);
    - `minDifferentItems` (from `diversity.minDifferentItems`, int 1–16, default 5);
    - `timeLimitMs` (int 1000–300000, default 60000).
- **`package.json`:** dependency `highs: "1.15.4"`, script `"web": "node src/main.js web"`.

- [ ] Write failing tests: defaults (`useScrolls === true`, `resultCount === 10`, `minDifferentItems === 5`, `timeLimitMs === 60000`), the `topCount: 3` alias → `resultCount === 3`, both together → throws `/Invalid query/`, and out-of-range values throw; `Item.fromDofusDb(raw).imgUrl === raw.img` and `Spell` likewise (`null` when absent).
- [ ] Run `npm test` → FAIL. Implement. Run `npm install highs@1.15.4`, then `npm test` → PASS, and `node -e "require('highs')().then(h=>console.log(typeof h.solve))"` → `function`.

---

### Task 1: Characteristic points and scrolls in the exact evaluator

**Files:**

- Create: `src/character/PointAllocator.js`
- Modify: `src/optimizer/StuffEvaluator.js`, `src/optimizer/SearchBound.js` (bound only), `src/rules/CriterionEvaluator.js` (only if a helper is needed to enumerate threshold branches)
- Test: `tests/character/PointAllocator.test.js`, `tests/optimizer/StuffEvaluator.points.test.js`

**Interfaces:**

- **Produces `class PointAllocator`:**
    - `constructor({ level, useScrolls, elementCharacteristic })`;
    - `get availablePoints() → number`;
    - `costOf(characteristic, fromBase, toBase) → number` (tiered cost of raising the **base** value);
    - `allocate({ itemStats: Stats, criteria: string[] }) → { baseStats: Stats, spentPoints: Record<characteristicId, number>, scrollStats: Stats } | null` (`null` when the criteria cannot be met).
- **Allocation algorithm:**
    1. For every criterion, enumerate its satisfiable branches (DNF of `>` thresholds on stat codes CS/CI/CC/CA/CV/CW; other atoms are unaffected by points).
    2. Pick the combination that needs the fewest points to reach each threshold + 1, counted on the total item + scroll + base value.
    3. Spend all remaining points on `elementCharacteristic` (neutral → Strength).

    This is exact for single-element damage, because only that stat raises damage.

- **Modified `StuffEvaluator.evaluate(items)`:** base stats now include the allocator's points and scrolls. `Evaluation` gains `pointsAllocation: { spentPoints, baseStats, scrollStats }`. `measureViolation` uses the same allocation (an infeasible allocation counts as 1 unmet criterion per blocked criterion).
- **SearchBound:** the optimistic base adds `availablePoints` worth of element stat (`max base reachable`) + scrolls. It stays a valid upper bound until Task 5 deletes the B&B.

- [ ] Failing tests (exact values):
    - level 200 → `availablePoints === 995`;
    - level 150 → `745`;
    - all 995 points into Chance → base Chance `398`;
    - with scrolls, total Chance from points + scrolls `498`;
    - `costOf(AGILITY, 0, 101) === 102`;
    - criterion `CA>249|CS>249` with item Agility 200, Strength 0, scrolls on → spends Agility points to reach 250 (base 50, cost 50) rather than Strength;
    - criterion `CI>399` unreachable at level 20 → `null`;
    - StuffEvaluator: a fixture weapon with `CC>399` becomes valid at level 200 with points, but not at level 50.
- [ ] Run → FAIL; implement; run focused, then `npm test` → PASS (update v1 tests whose expected scores change because base stats changed; list them in the report).

---

### Task 2: Dofusbook link encoder

**Files:**

- Create: `src/export/DofusbookLinkEncoder.js`
- Test: `tests/export/DofusbookLinkEncoder.test.js`

**Interfaces:**

- **Produces `class DofusbookLinkEncoder`** with `encode({ level, breedId, isFemale = false, name, items: { slot, id, exo }[], spentPoints = {}, scrolls = {} }) → string`, which returns the full URL `config.DOFUSBOOK_IMPORT_URL + code`.
- **Encoding rules:**
    - position order: weapon, shield, hat, amulet, ring, ring, belt, cape, boots, mount, dofus×6;
    - classe = breedId − 1 if ≤ 18, else breedId − 2;
    - block 3 holds the spent points per stat in order vi, fo, in, ch, ag, sa (10-bit MSB-first, byte-aligned start, `ceil(n×10/8)` bytes);
    - block 4 holds the scroll values (uint8) in the same order;
    - block 5 holds the exos (`ap` → index 8, `mp` → index 9, value 1);
    - block 7 holds the name as UTF-8, ≤ 255 bytes, truncated on character boundaries;
    - big-endian, base64url without padding;
    - omit blocks 3, 4 and 5 when they are empty.

- [ ] Failing tests:
    - the reference vector from Global Constraints, reproduced byte for byte from items: weapon 34331, hat 34330, boots 15693, ring 11738 (exo mp), ring 19985 (exo ap), belt 18598, cape 22201, amulet 22200, dofus 7043, 16264, 12690, 12716, 22004, 13768, mount 33295, shield 18700; level 200, breedId 9, name `Optimiseur Cra Eau`;
    - a round-trip decode test with a small decoder written in the test (mirroring the spec) for a stuff with points `{ ch: 995 }` and scrolls 100 everywhere, at level 150, breedId 20 (classe 18);
    - more than 2 rings or more than 6 dofus → throws.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] **Controller check (not the implementer):** open the link of the round-trip stuff in Chrome and verify that the Dofusbook base and parcho columns show the encoded points and scrolls.

---

### Task 3: Web page (static front end)

**Files:**

- Create: `public/index.html`, `public/app.js`, `public/style.css`, `public/mock/results.json` (dev fixture)
- Test: `tests/web/publicFiles.test.js` (static checks only)

**Interfaces:**

- **Consumes (contract implemented by Task 6):**
    - `GET /api/meta → { breeds: [{ id, name, headUrl }], elements: [{ key, label }], dataSyncedAt }`;
    - `GET /api/items?q=<text> → [{ id, name, level, slot, imgUrl }]` (≤ 20);
    - `POST /api/optimize` (JSON query body as in the CLI) → `text/event-stream` with events:
        - `progress` `{ elapsedMs, foundCount }`;
        - `stuff` `{ rank, stuff }`, where `stuff` uses Task 5's `results[i]` shape;
        - `done` `{ isOptimal, reason, warnings, unsupportedItems, unobtainableItems, ignoredSpells }`;
        - `error` `{ message }`.
- **Layout A** (validated mockup: `.superpowers/brainstorm/145-1794740222/content/layout.html`):
    - **form on the left:**
        - classe (with head icon), niveau, élément;
        - PA min, PM min, critique min, résistances min per element;
        - parchemins checkbox, diversité (number), durée max (s);
        - imposer and exclure (autocomplete chips);
        - « Lancer » button;
    - **cards on the right:** a live status line (« ⏳ 23 s — 4 stuffs trouvés »); per stuff:
        - rank and dégâts/tour;
        - solver badge (« optimal prouvé » / « écart ≤ x % » / « non prouvé »);
        - 16 item icons, exos outlined (blue PA, green PM), with name tooltips;
        - key stats (PA, PM, element stat, puissance, do élément, % critique, do crit);
        - points spent (« 995 pts : Chance 398 »);
        - turn combo with spell icons and per-cast damage;
        - « Voir sur Dofusbook ↗ » button (new tab, with the note « remplace ton brouillon local Dofusbook »).
- Cards are kept sorted by score as they arrive.
- Use `fetch` + a `ReadableStream` SSE parser (POST bodies cannot use `EventSource`).
- Starting a new search aborts the previous request with `AbortController`.
- Dark theme close to the mockup. French UI texts.
- Dev mode: `?mock=1` renders `public/mock/results.json` without a server.

- [ ] Failing test: the files exist; `index.html` references `app.js` and `style.css`; `app.js` contains no `EventSource` and does contain `AbortController`; `mock/results.json` parses and has ≥ 3 stuffs with the documented keys.
- [ ] Implement; run → PASS.
- [ ] **Controller check:** open `public/index.html?mock=1` in Chrome and screenshot it.

---

### Task 4: MILP solver (HiGHS) — model, damage cuts, diversity

**Files:**

- Create: `src/solver/` (one class per file, for example `MilpModelBuilder.js`, `LpWriter.js`, `DamageCutGenerator.js`, `HighsSolver.js`, `StuffSolver.js`)
- Test: `tests/solver/*.test.js`

**Interfaces:**

- **Consumes:**
    - candidates `Map<slot, Item[]>` (CandidateFilter);
    - `gameData.getSet`;
    - `Query`;
    - `StuffEvaluator` (exact scoring, Task 1 signature unchanged: `evaluate(items) → Evaluation | null`);
    - `config.POINT_COST_TIERS` and the related values (Task 0).
- **Produces `class StuffSolver`:**
    - `constructor({ candidates, evaluator, query, gameData, nowFn = Date.now })`;
    - `async *solveDiverse({ deadlineMs, warmStart: Item[][] = [] })`, an async generator that yields `{ evaluation, solverStatus: "optimal" | "gap" | "heuristic", optimalityGapPercent: number | null }` in the order found, each one respecting the diversity rule against the earlier yields. It returns when `resultCount` stuffs are found, when the model becomes infeasible, or at the deadline.
- **Model** (all linear, exact):
    - binaries per candidate item and slot capacities (2 rings, 6 dofus);
    - no duplicate item;
    - two-handed weapon ⇒ no shield;
    - ≤ 1 prysmaradite;
    - set one-hot `y[set][n]` with Σ items of the set = Σ n·y;
    - `pk` trophies ⇒ every set count ≤ 2 when any is worn;
    - ring exo binaries, eligible only when the ring has no native AP/MP;
    - per-tier point variables (cost ≤ availablePoints), plus scrolls as constants;
    - item criteria on stat totals, linearized with big-M (OR → one binary per branch);
    - non-stat atoms are assumed, as in v1;
    - query constraints (min AP, MP, resistances, critical).
- **Damage:** maximize `t` with `t ≤ log(damage)` through Kelley tangent cuts at successive solutions, as in Sola-Ray's method (no code copied). Exact handling of:
    - the full-turn combo (per-AP-level rotations, or a solve per AP level);
    - critical (bands or binary expansion);
    - the % factors.

    Any part that is approximated must make the status `heuristic` or `gap`, never `optimal`. Warm-start incumbents come from `warmStart` (scored by the evaluator).

- **Diversity cut after each yield:** the same weapon ⇒ overlap with that stuff ≤ 16 − minDifferentItems, counting empty positions.
- **Every yielded stuff is rescored by `StuffEvaluator`.** If its exact score differs from the model's damage, the model is refined and the cut repeated.

- [ ] Failing tests:
    1. On `tests/optimizer/optimizerFixture.js`-style small random fixtures (seeded, ≥ 20 cases, with sets, criteria, exos and points), the first yield's exact score equals the brute-force optimum over all items, with `solverStatus === "optimal"`.
    2. Diversity: every pair of yields respects the rule; brute force confirms that the second yield is the best stuff satisfying the rule against the first.
    3. Infeasible constraints → the generator ends immediately with no yield.
    4. A deadline already passed → returns at most the warm-start-based yield, with status ≠ `optimal`.
    5. A `pk` trophy fixture → no set above 2 items.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] **Real-data experiment:** Crâ 200 water, minAp 11, minMp 6, scrolls on, 60 s, 10 results. Report the time to the first stuff, the total time, statuses and gaps, and the first exact score vs the v1 warm start with points.

---

### Task 5: Orchestration v2, result format, CLI

**Files:**

- Modify: `src/optimizer/OptimizationManager.js`, `src/optimizer/ResultFormatter.js`, `src/cli/CommandLine.js`, `src/config.js` (remove the deprecated aliases)
- Delete: `src/optimizer/StuffOptimizer.js`, `src/optimizer/SearchBound.js` and their tests (B&B replaced). Keep `LocalSearch`, `SearchSpace` and `StuffRanking` for the warm start.
- Test: `tests/optimizer/OptimizationManager*.test.js`, `tests/cli/*.test.js`

**Interfaces:**

- **Consumes:**
    - `StuffSolver.solveDiverse` (Task 4);
    - `DofusbookLinkEncoder.encode` (Task 2);
    - `Evaluation.pointsAllocation` (Task 1).
- **Produces:**
    - `OptimizationManager.run(queryJson) → Promise<Result>`;
    - `OptimizationManager.runStreaming(queryJson, { onStuff(rank, formattedStuff), onProgress({ elapsedMs, foundCount }), signal: AbortSignal }) → Promise<Result>`.
- **`Result`:** `{ isOptimal, elapsedMs, reason: null | "no-valid-stuff" | "time-limit-reached", dataSyncedAt, warnings, ignoredSpells, unsupportedItems, unobtainableItems, results }`.
    - **Each result:** `{ score, solverStatus, optimalityGapPercent, items[{ slot, id, name, imgUrl, exo }], stats, pointsAllocation: { spentPoints: { vitality…agility: n }, base: {…}, scrolls: {…} }, turn[{ name, kind, imgUrl, count, damagePerCast }], assumedCriteria, dofusbookUrl }`.
    - `variants` is removed.
    - `isOptimal` is true only if every result is `optimal` and the search was not cut.
- **Pipeline:**
    1. filter;
    2. damage-action check;
    3. warm start (LocalSearch, ≤ 10 % of the budget);
    4. `solveDiverse` until `resultCount` stuffs or the deadline;
    5. stream each result;
    6. stop on `signal.aborted`.
- **CLI:** `optimize` prints the final JSON (unchanged command). New command `web`: `CommandLine` lazily `require`s `../web/WebServer` (created in parallel by Task 6) inside the `web` branch only and calls `new WebServer({ gameData, manager, host: config.WEB_HOST, port: config.WEB_PORT, publicDir }).start()`; CLI tests must not exercise `web`.
- The agent output contract changes are documented for Task 7.

- [ ] Failing tests:
    - fixture run returns ≤ resultCount results, each with a `dofusbookUrl` starting with `config.DOFUSBOOK_IMPORT_URL` and with `pointsAllocation`;
    - streaming calls `onStuff` before resolving;
    - `AbortController.abort()` mid-run resolves with `reason: "time-limit-reached"` or a partial result, with no unhandled rejection;
    - `minAp: 20` → `no-valid-stuff` in < 5 s;
    - `variants` key absent;
    - `topCount` alias still works through the CLI.
- [ ] Run → FAIL; implement; `npm test` → PASS (pristine output).
- [ ] Real CLI run on `tests/fixtures/craWater200.json` (now resultCount 10): report the counts, statuses, total time, and that the 10 stuffs are pairwise diverse.

---

### Task 6: Web server

**Files:**

- Create: `src/web/WebServer.js`, `src/web/ItemSearch.js`
- Test: `tests/web/WebServer.test.js`, `tests/web/ItemSearch.test.js`

**Interfaces:**

- **Consumes:**
    - the Task 3 contract (it implements it exactly);
    - `OptimizationManager.runStreaming` (Task 5 interface; use a stub manager in the tests so this task can start before Task 5 lands);
    - `GameData`.
- **Produces:**
    - `class WebServer` with `constructor({ gameData, manager, host, port, publicDir })`, `async start() → { url }` and `async stop()`;
    - `class ItemSearch` with `constructor(items)` and `search(text, limit = 20) → [{ id, name, level, slot, imgUrl }]`, accent- and case-insensitive (`normalizeName`), prefix matches first, empty → `[]`.
- **Behavior:**
    - static files from `public/` (no directory traversal);
    - one running search at a time: a new `POST /api/optimize` aborts the previous one;
    - a client disconnect aborts its search;
    - 404 for unknown routes, 400 with `{ message }` for an invalid query (Query errors);
    - `start()` logs `✅ Page ouverte sur <url>` and opens the default browser (`start` on Windows, `open` on macOS, `xdg-open` otherwise) unless `openBrowser: false`.

- [ ] Failing tests (real HTTP on an ephemeral port, stub manager):
    - `/api/meta` lists 19 breeds from the fixtures, adapted to the fixture count;
    - `/api/items?q=ocre` matches « Dofus Ocre » from the fixture;
    - an unknown name → `[]`;
    - the SSE stream emits `stuff` events then `done`;
    - a second POST aborts the first (the stub sees `signal.aborted`);
    - `/../package.json` → 404;
    - an invalid query → 400.
- [ ] Run → FAIL; implement; run → PASS.

---

### Task 7: Agent, README, end-to-end check

**Files:**

- Modify: `.claude/agents/stuff-optimizer.md`, `README.md`, `tests/fixtures/craWater200.json`

**Interfaces:**

- **Consumes:** the Task 5 Result format.
- **Agent:**
    - uses `resultCount` and `useScrolls`, and explains points and scrolls;
    - presents up to 10 diverse stuffs with their Dofusbook links;
    - explains `solverStatus` and the gap;
    - drops all variant wording;
    - mentions `npm run web`;
    - says only what the JSON says (unchanged rule).
- **README:** web page usage, new query fields, `npm install` (highs), known limits.

- [ ] Update the files; run the CLI on the fixture and check that every statement in the agent prompt matches the output keys.
- [ ] **Controller check:** `npm run web`, run a Crâ 200 water search in Chrome, screenshot the cards as they stream in, and open one Dofusbook link.
