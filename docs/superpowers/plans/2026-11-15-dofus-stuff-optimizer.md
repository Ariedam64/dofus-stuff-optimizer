# Dofus Stuff Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node.js CLI that syncs Dofus 3 data from DofusDB and finds the equipment set maximizing a class's full-turn expected damage under user constraints, driven by a Claude Code agent.

**Architecture:** `sync` downloads items/sets/breeds/spells into `data/*.json`. `optimize` loads them into domain objects, builds per-slot candidates (dominance pruning), runs an exact branch-and-bound whose leaves are scored by a bounded-knapsack turn planner over the class's spells + weapon. A `.claude/agents/stuff-optimizer.md` agent turns French requests into a query JSON and explains the JSON result.

**Tech Stack:** Node.js 24 (native `fetch`, `node:test`, `node:util` `parseArgs`), CommonJS, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-dofus-stuff-optimizer-design.md`

## Global Constraints

- JavaScript CommonJS (`require` / `module.exports`), Node.js 24, **no npm dependency** (ask the user before adding any).
- Global `CLAUDE.md` conventions: one class per file named after it (PascalCase), other files/folders camelCase, `#private` fields, native `get`/`set` only when useful, module constants at top in `SCREAMING_SNAKE_CASE`, no magic numbers, guard clauses, functions ≤ ~50 lines, files ≤ ~300 lines, `const`/`===`, `async`/`await`.
- `src/main.js` stays short (load config, build objects, run, `main().catch(...)`); fixed values in `src/config.js`.
- Errors: `throw new Error("...context...")`, caught once in `main.js`, logged with emoji (✅ ❌ 🔍 🔄); debug logs behind `config.IS_DEBUG`.
- Code, comments, logs in English; the agent answers the user in French.
- Prettier: 4 spaces, double quotes, semicolons, trailing commas, 120 columns (`.prettierrc`); UTF-8 without BOM, final newline.
- `.gitignore`: `node_modules/`, `.env`, `*.log`, `/data/` (root only — `src/data/` is source).
- Git: conventional commits in English. **Commit steps run only if the user approved commits at execution start**; otherwise skip them.
- Data source: `https://api.dofusdb.fr`, page size 50 (server max), generic `User-Agent: dofus-stuff-optimizer`.
- Item stats at **max roll**; negative stats at their worst value. Base character: 7 AP at level ≥ 100 (6 below), 3 MP, no characteristic points. Target at 0 % resistance.

## Review Focus

- Impossible constraints (e.g. `minAp: 20`) → `optimize` returns `results: []` with `reason: "no-valid-stuff"`, never crashes or hangs. Test in Task 10.
- Breed name typed loosely (`"cra"`, `"Crâ"`, `"CRA"`) → resolved via accent/case-insensitive match; unknown name → error listing valid names. Test in Task 3.
- `optimize` run before `sync` (missing `data/`) → error saying to run `node src/main.js sync`. Test in Task 3.
- Element with no usable damage action for the breed → error naming the element and the breed, listing ignored spells. Test in Task 10.
- Time limit reached → `isOptimal: false` in output. Test in Task 9.

---

## File Structure

```
package.json  .prettierrc  .gitignore
.claude/agents/stuff-optimizer.md          agent definition (Task 11)
src/main.js                                CLI entry: parse args, dispatch, catch fatal errors
src/config.js                              all fixed values
src/utils/sleep.js                         sleep(ms)
src/utils/normalizeName.js                 accent/case-insensitive key
src/stats/characteristics.js               CHARACTERISTIC ids + CHARACTERISTIC_NAMES
src/stats/elements.js                      ELEMENTS table
src/stats/Stats.js                         characteristic → value container
src/sync/DofusDbClient.js                  paginated GET
src/sync/SyncManager.js                    downloads all datasets to data/
src/data/Item.js  src/data/ItemSet.js  src/data/Spell.js  src/data/Breed.js
src/data/slots.js                          SLOT_CAPACITIES, TYPE_ID_SLOTS
src/data/GameData.js                       loads data/ into domain objects
src/rules/CriterionEvaluator.js            parses/evaluates item criterions
src/damage/Action.js                       spell or weapon as a castable action
src/damage/DamageCalculator.js             expected damage per cast
src/damage/TurnPlanner.js                  grouped bounded knapsack on AP
src/optimizer/Query.js                     validates/normalizes query JSON
src/optimizer/StuffEvaluator.js            leaf scoring + upper bound
src/optimizer/CandidateFilter.js           per-slot candidates, dominance
src/optimizer/StuffOptimizer.js            branch-and-bound, timeout, top N
src/optimizer/OptimizationManager.js       orchestrates a full run + variants
tests/fixtures/                            small hand-written DofusDB-shaped JSON
tests/**/*.test.js                         node:test, mirrors src/
```

---

### Task 1: Project scaffold, stats primitives

**Files:**
- Create: `package.json`, `.prettierrc`, `.gitignore`, `src/config.js`, `src/utils/sleep.js`, `src/utils/normalizeName.js`, `src/stats/characteristics.js`, `src/stats/elements.js`, `src/stats/Stats.js`, `src/data/slots.js` (content specified in Task 3's Interfaces)
- Test: `tests/stats/Stats.test.js`, `tests/utils/normalizeName.test.js`

**Interfaces:**
- Produces:
  - `CHARACTERISTIC` (frozen) with DofusDB ids verified 2026-11-15: `AP:1, MP:23, RANGE:19, VITALITY:11, WISDOM:12, STRENGTH:10, CHANCE:13, AGILITY:14, INTELLIGENCE:15, DAMAGE:16, CRITICAL:18, POWER:25, CRITICAL_DAMAGE:86, EARTH_DAMAGE:88, FIRE_DAMAGE:89, WATER_DAMAGE:90, AIR_DAMAGE:91, NEUTRAL_DAMAGE:92, EARTH_RESISTANCE:33, FIRE_RESISTANCE:34, WATER_RESISTANCE:35, AIR_RESISTANCE:36, NEUTRAL_RESISTANCE:37, RANGED_DAMAGE_PERCENT:120, WEAPON_DAMAGE_PERCENT:122, SPELL_DAMAGE_PERCENT:123, MELEE_DAMAGE_PERCENT:125`; `CHARACTERISTIC_NAMES`: id → camelCase key (`1 → "ap"`, `90 → "waterDamage"`…).
  - `ELEMENTS`: keys `water, earth, fire, air, neutral`, each `{ characteristic, fixedDamage, resistance, damageEffectIds }`:
    water `{CHANCE, WATER_DAMAGE, WATER_RESISTANCE, [96, 91]}`, earth `{STRENGTH, EARTH_DAMAGE, EARTH_RESISTANCE, [97, 92]}`, air `{AGILITY, AIR_DAMAGE, AIR_RESISTANCE, [98, 93]}`, fire `{INTELLIGENCE, FIRE_DAMAGE, FIRE_RESISTANCE, [99, 94]}`, neutral `{STRENGTH, NEUTRAL_DAMAGE, NEUTRAL_RESISTANCE, [100, 95]}` (96–100 damage, 91–95 steal).
  - `class Stats`: `constructor(entries = [])` (entries `[id, value][]`), `get(id) → number` (0 if absent), `add(id, value) → void`, `addAll(other: Stats) → void`, `clone() → Stats`, `ids() → number[]`, `toNamedObject() → Record<string, number>` (via `CHARACTERISTIC_NAMES`, unknown ids as `"c<id>"`).
  - `sleep(ms) → Promise<void>`; `normalizeName(text) → string` (NFD, strip diacritics, lowercase, trim).
  - `config.js` exports at least: `DOFUSDB_BASE_URL = "https://api.dofusdb.fr"`, `PAGE_SIZE = 50`, `REQUEST_DELAY_MS = 200`, `USER_AGENT = "dofus-stuff-optimizer"`, `DATA_DIR` (built with `path.join(__dirname, "..", "data")`), `BASE_AP = 6`, `BONUS_AP_LEVEL = 100`, `BASE_MP = 3`, `SEARCH_TIME_LIMIT_MS = 30000`, `DEFAULT_TOP_COUNT = 3`, `IS_DEBUG = process.env.IS_DEBUG === "true"`.

- [ ] **Step 1: Init** — `git init` (only if commits approved), `package.json` with `"type"` absent (CommonJS), scripts `start: "node src/main.js"`, `test: "node --test \"tests/**/*.test.js\""`, `sync: "node src/main.js sync"`; `.prettierrc`, `.gitignore` per Global Constraints.
- [ ] **Step 2: Write failing tests**

```js
test("Stats.get returns 0 for missing characteristic", () => assert.equal(new Stats().get(CHARACTERISTIC.AP), 0));
test("Stats.addAll sums per characteristic", () => {
    const stats = new Stats([[CHARACTERISTIC.AP, 1]]);
    stats.addAll(new Stats([[CHARACTERISTIC.AP, 2], [CHARACTERISTIC.CHANCE, 50]]));
    assert.equal(stats.get(CHARACTERISTIC.AP), 3);
    assert.equal(stats.get(CHARACTERISTIC.CHANCE), 50);
});
test("Stats.clone is independent", () => { /* add to clone, original unchanged */ });
test("Stats.toNamedObject uses camelCase names", () =>
    assert.deepEqual(new Stats([[CHARACTERISTIC.WATER_DAMAGE, 20]]).toNamedObject(), { waterDamage: 20 }));
test("normalizeName strips accents and case", () => assert.equal(normalizeName(" Crâ "), "cra"));
```

- [ ] **Step 3: Run** `npm test` → FAIL (modules missing).
- [ ] **Step 4: Implement** the files above.
- [ ] **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat: scaffold project and stats primitives`

---

### Task 2: DofusDB sync

**Files:**
- Create: `src/sync/DofusDbClient.js`, `src/sync/SyncManager.js`
- Test: `tests/sync/DofusDbClient.test.js`, `tests/sync/SyncManager.test.js`

**Interfaces:**
- Consumes: `config`, `sleep`, `TYPE_ID_SLOTS` (Task 1).
- Produces:
  - `class DofusDbClient`: `constructor({ baseUrl, pageSize, requestDelayMs, userAgent, fetchFn = fetch })`; `async fetchAll(path, query = {}) → object[]` — loops `$skip` by `pageSize` until `skip >= total`, sleeps `requestDelayMs` between pages, throws `Error("DofusDB GET <url> failed: <status>")` on non-2xx. Query objects serialize as Feathers params (`{ typeId: { $in: [1, 9] } }` → `typeId[$in][]=1&typeId[$in][]=9`).
  - `class SyncManager`: `constructor({ client, dataDir })`; `async syncAll() → Record<string, number>` (counts per file). Writes `items.json` (typeId in all `TYPE_ID_SLOTS` keys), `itemSets.json` (`item-sets`), `breeds.json`, `spellVariants.json` (all), `spells.json` (ids from all variants' `spellIds`, fetched in chunks of 50 via `id[$in]`), `spellLevels.json` (ids from spells' `spellLevels`, chunks of 50), `meta.json` (`{ syncedAt: ISO string }`). Logs `🔄 Syncing <name>…` / `✅ <name>: <count>`.

- [ ] **Step 1: Write failing tests** with a stub `fetchFn` returning `{ total, data }` pages:

```js
test("fetchAll paginates until total", async () => {
    // stub: total 120, returns 50/50/20 items depending on $skip in URL
    assert.equal((await client.fetchAll("items")).length, 120);
    assert.equal(calls.length, 3);
});
test("fetchAll serializes $in arrays", async () => {
    await client.fetchAll("items", { typeId: { $in: [1, 9] } });
    assert.match(calls[0], /typeId\[\$in\]\[\]=1&typeId\[\$in\]\[\]=9/);
});
test("fetchAll throws with url on HTTP error", async () => { /* stub 403 → rejects /failed: 403/ */ });
test("syncAll writes every dataset and meta", async () => { /* temp dir via fs.mkdtemp, stub routes by path; assert 7 files exist */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sync): download DofusDB datasets`

---

### Task 3: Domain model and data loading

**Files:**
- Create: `src/data/Item.js`, `src/data/ItemSet.js`, `src/data/Spell.js`, `src/data/Breed.js`, `src/data/GameData.js`, `tests/fixtures/*.json` (≈ a dozen items across slots incl. one weapon, one 2-item set, one breed with 2 variant pairs, their spells/levels)
- Test: `tests/data/Item.test.js`, `tests/data/Spell.test.js`, `tests/data/GameData.test.js`

**Interfaces:**
- Produces:
  - `slots.js` (created in Task 1, listed here for reference): `SLOT_CAPACITIES = { weapon: 1, shield: 1, amulet: 1, ring: 2, belt: 1, boots: 1, hat: 1, cape: 1, mount: 1, dofus: 6 }`; `TYPE_ID_SLOTS = { 1: "amulet", 9: "ring", 10: "belt", 11: "boots", 16: "hat", 17: "cape", 18: "mount", 121: "mount", 331: "mount", 332: "mount", 333: "mount", 82: "shield", 23: "dofus", 151: "dofus", 217: "dofus", 2: "weapon", 3: "weapon", 4: "weapon", 5: "weapon", 6: "weapon", 7: "weapon", 8: "weapon", 19: "weapon", 22: "weapon", 114: "weapon", 271: "weapon" }`; `PRYSMARADITE_TYPE_ID = 217`, `MAX_PRYSMARADITES = 1`.
  - `class Item`: fields `id, name (fr), typeId, slot, level, setId (null if -1), criterion (string), stats: Stats, weapon (null | { apCost, minRange, range, criticalRate, criticalBonus, maxCastPerTurn, isTwoHanded, damageLines: {effectId, min, max}[] })`; `static fromDofusDb(raw) → Item`. Uses `raw.effects` (`{from, to, characteristic, effectId}`): stat lines are `characteristic >= 0`; **max roll** value = `to === 0 ? from : (from >= 0 ? Math.max(from, to) : Math.min(from, to))`. Weapon damage lines = effects with `effectId` 91–100 (`min = from`, `max = to || from`).
  - `class ItemSet`: `id, name, itemIds: number[]`, `bonusFor(count) → Stats` (from `raw.effects[count]`, empty Stats if missing); `static fromDofusDb(raw)`.
  - `class Spell` (one grade): `spellId, name, apCost, minRange, range, criticalRate, maxCastPerTurn, maxCastPerTarget, minPlayerLevel, normalLines, criticalLines, ignoredReason (null | string)`; `static fromDofusDb(spellRaw, levelRaw) → Spell`. A line `{effectId, min: diceNum, max: diceSide || diceNum}` is **kept** only if `effectId` in 91–100, `triggers === "I"`, `random === 0`, `duration === 0`, `delay === 0`, and `targetMask` split on `,` contains `"A"` and only single-letter tokens (any token like `E590` or containing `*`, `>`, digits ⇒ conditional ⇒ dropped). If no line kept: `ignoredReason = "no-direct-damage"`.
  - `class Breed`: `id, name, variantPairs: number[][]`.
  - `class GameData`: `static async load(dataDir) → GameData` (throws `Error("Missing data in <dataDir>: run \"node src/main.js sync\" first")` if any file is absent); `items: Item[]`, `getSet(id) → ItemSet | undefined`, `findBreed(name) → Breed` (match by `normalizeName`; throws `Error("Unknown breed \"<name>\". Valid: <list>")`), `getSpellGroups(breed, level) → Spell[][]` (per variant pair, each spell at its highest grade with `minPlayerLevel <= level`; spells with no eligible grade omitted; empty groups omitted).

- [ ] **Step 1: Write failing tests**

```js
test("Item uses max roll and keeps negatives at worst", () => {
    const item = Item.fromDofusDb(fixture({ effects: [ { from: 301, to: 350, characteristic: 11, effectId: 125 },
        { from: -1, to: 0, characteristic: 19, effectId: 116 } ] }));
    assert.equal(item.stats.get(CHARACTERISTIC.VITALITY), 350);
    assert.equal(item.stats.get(CHARACTERISTIC.RANGE), -1);
});
test("Item maps typeId to slot and parses weapon lines", () => { /* typeId 2 → "weapon", apCost 4, damageLines [{effectId:100,min:24,max:32}] */ });
test("ItemSet.bonusFor returns bonuses of that count", () => { /* effects[2] → Stats */ });
test("Spell keeps direct damage lines only", () => {
    // levelRaw effects: 96 mask "A" trig "I" kept; 96 mask "A,E590" dropped; 5 (push) ignored
    assert.deepEqual(spell.normalLines, [{ effectId: 96, min: 25, max: 28 }]);
});
test("Spell with only conditional lines is flagged", () => assert.equal(spell.ignoredReason, "no-direct-damage"));
test("GameData.findBreed matches loosely", () => assert.equal(gameData.findBreed("CRA").id, 9));
test("GameData.findBreed lists valid names on unknown", () => assert.throws(() => gameData.findBreed("x"), /Valid: /));
test("GameData.load points to sync when data missing", async () =>
    assert.rejects(GameData.load(emptyTempDir), /run "node src\/main.js sync"/));
test("getSpellGroups picks highest eligible grade", () => { /* level 150 → grade with minPlayerLevel 132, not 200 */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(data): load DofusDB data into domain objects`

---

### Task 4: Item criterions

**Files:**
- Create: `src/rules/CriterionEvaluator.js`
- Test: `tests/rules/CriterionEvaluator.test.js`

**Interfaces:**
- Consumes: `Stats`, `CHARACTERISTIC`.
- Produces: `class CriterionEvaluator`: `evaluate(criterion: string, { stats: Stats, level: number }) → { isMet: boolean, assumedAtoms: string[] }`. Empty criterion ⇒ `{ isMet: true, assumedAtoms: [] }`.

Grammar: `expr = term ("|" term)*`, `term = factor ("&" factor)*`, `factor = "(" expr ")" | atom`, `atom = CODE OP VALUE` with `CODE` = 2 chars, `OP` ∈ `< > = !`, `~` (≈ `=`). Stat codes: `CP`→AP, `CM`→MP, `CS`→STRENGTH, `CI`→INTELLIGENCE, `CC`→CHANCE, `CA`→AGILITY, `CV`→VITALITY, `CW`→WISDOM; `PL` → character level. Any other code (alignment, quest, breed, lowercase base stats…) is **assumed met** and its raw text pushed to `assumedAtoms`.

- [ ] **Step 1: Write failing tests**

```js
test("CP<12 fails at 12 AP", () => assert.equal(evaluate("CP<12", { stats: ap(12), level: 200 }).isMet, false));
test("CP<12|CM<6 passes when MP below 6", () => /* ap 12, mp 5 → true */);
test("CI>299&CC>199 needs both", () => /* int 300, chance 199 → false */);
test("parentheses group", () => /* "(CP<12|CM<6)&PL>100" */);
test("unknown code is assumed met and reported", () => {
    const result = evaluate("PN~xxramboplxx&BI=1", ctx);
    assert.equal(result.isMet, true);
    assert.deepEqual(result.assumedAtoms, ["PN~xxramboplxx", "BI=1"]);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (recursive-descent parser). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(rules): evaluate item criterions`

---

### Task 5: Actions and damage formula

**Files:**
- Create: `src/damage/Action.js`, `src/damage/DamageCalculator.js`
- Test: `tests/damage/DamageCalculator.test.js`

**Interfaces:**
- Consumes: `Spell`, `Item.weapon`, `Stats`, `ELEMENTS`, `CHARACTERISTIC`.
- Produces:
  - `class Action`: `name, kind ("spell" | "weapon"), apCost, maxCasts (Infinity when DofusDB value is 0), isMelee (range <= 1), criticalRate (base %), normalLines, criticalLines`. `static fromSpell(spell, elementKey) → Action | null`, `static fromWeapon(item, elementKey) → Action | null` — keep only lines whose `effectId` ∈ `ELEMENTS[elementKey].damageEffectIds`; null if none. Spell `maxCasts = min(maxCastPerTurn, maxCastPerTarget)` treating 0 as Infinity. Weapon critical lines = normal lines with `min/max + criticalBonus`.
  - `class DamageCalculator`: `constructor(elementKey)`; `computeExpectedDamage(action, stats) → number`.

Formula (floats, no rounding in v1 — spec flags rounding as to verify):

```
multiplier   = (100 + stats[element.characteristic] + stats[POWER]) / 100
fixed        = stats[DAMAGE] + stats[element.fixedDamage]
lineValue(l) = (l.min + l.max) / 2 * multiplier + fixed
normal       = Σ lineValue(normalLines)
critical     = Σ lineValue(criticalLines) + stats[CRITICAL_DAMAGE] * criticalLines.length
finalFactor  = (100 + stats[kind === "spell" ? SPELL_DAMAGE_PERCENT : WEAPON_DAMAGE_PERCENT]) / 100
             * (100 + stats[isMelee ? MELEE_DAMAGE_PERCENT : RANGED_DAMAGE_PERCENT]) / 100
p            = action.criticalRate === 0 ? 0 : min(action.criticalRate + stats[CRITICAL], 100) / 100
expected     = ((1 - p) * normal + p * critical) * finalFactor
```

Negative multiplier/stat results are clamped at 0 per line.

- [ ] **Step 1: Write failing tests** (exact values):

```js
// spell: water line 25–28 normal, 30–34 critical, 10 % base crit, range 8
// stats: chance 100, power 50, damage 10, waterDamage 20, criticalDamage 15, critical 20, spellDamagePercent 10, rangedDamagePercent 0
test("expected damage matches formula", () => {
    // normal = 26.5*2.5+30 = 96.25 ; critical = 32*2.5+30+15 = 125 ; p = 0.30
    // expected = (0.7*96.25 + 0.3*125) * 1.1 = 115.36
    assert.ok(Math.abs(calculator.computeExpectedDamage(action, stats) - 115.36) < 0.01);
});
test("spell with 0 base crit never crits", () => /* critical stat 50 → equals normal * factor */);
test("melee action uses melee percent", () => /* range 1 */);
test("weapon uses weapon percent and criticalBonus", () => {});
test("fromSpell returns null without element lines", () => assert.equal(Action.fromSpell(airSpell, "water"), null));
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(damage): compute expected damage per cast`

---

### Task 6: Full-turn planner

**Files:**
- Create: `src/damage/TurnPlanner.js`
- Test: `tests/damage/TurnPlanner.test.js`

**Interfaces:**
- Consumes: `Action`, `DamageCalculator`.
- Produces: `class TurnPlanner`: `constructor(damageCalculator)`; `planTurn(actionGroups: Action[][], availableAp: number, stats: Stats) → { totalDamage: number, casts: { name, kind, count, damagePerCast }[] }`. Each group is a variant pair (or the weapon alone): at most **one** action per group may be used.

Algorithm: grouped bounded knapsack over integer AP. `dp[ap]` = best damage; for each group, new `dp` = max over (skip group) and for each action in group, each `count` in `1..min(maxCasts, floor(availableAp / apCost))`. Keep back-pointers to rebuild `casts`. Actions with `apCost <= 0` are ignored.

- [ ] **Step 1: Write failing tests**

```js
test("fills AP with best combo", () => {
    // A: 3 AP, 100 dmg, max 2 ; B: 4 AP, 150 dmg, max 1 ; AP 10 → A×2 + B = 350
    assert.equal(planner.planTurn([[A], [B]], 10, stats).totalDamage, 350);
});
test("only one spell per variant pair", () => /* group [A, B] with AP 10 → 200 (A×2), not 350 */);
test("respects maxCasts", () => /* A max 1, AP 9 → 100 */);
test("returns zero when no AP", () => assert.equal(planner.planTurn([[A]], 0, stats).totalDamage, 0));
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(damage): plan best full-turn spell combo`

---

### Task 7: Query and stuff evaluation (stats, sets, criterions, constraints, ring exos)

**Files:**
- Create: `src/optimizer/Query.js`, `src/optimizer/StuffEvaluator.js`
- Test: `tests/optimizer/Query.test.js`, `tests/optimizer/StuffEvaluator.test.js`

**Interfaces:**
- Consumes: `GameData`, `Item`, `ItemSet`, `CriterionEvaluator`, `Action`, `DamageCalculator`, `TurnPlanner`, `ELEMENTS`, `config`.
- Produces:
  - `class Query`: `static parse(json, gameData) → Query` with fields `breed: Breed, level (1–200), elementKey, minCriticalRate (number | null), minAp, minMp (default 0), minResistances: Record<elementKey, number>, excludedItemIds: Set, requiredItemIds: Set, allowRingExos (default true), topCount (default config.DEFAULT_TOP_COUNT)`. Input shape is the spec's example; `profile.elements` must contain exactly one element in v1 (throw otherwise). Invalid values throw `Error("Invalid query: <field> …")`.
  - `class StuffEvaluator`: `constructor({ query, gameData, criterionEvaluator, turnPlanner })`; `get baseStats() → Stats` (AP `BASE_AP + (level >= BONUS_AP_LEVEL ? 1 : 0)`, MP `BASE_MP`); `buildActionGroups(weapon: Item | null) → Action[][]` (spell groups from `gameData.getSpellGroups` mapped through `Action.fromSpell`, nulls dropped, plus `[Action.fromWeapon(weapon, query.elementKey)]` if that is non-null); `computeStats(items: Item[]) → Stats` (base + items + each set's `bonusFor(count of its items worn)`); `evaluate(items: Item[]) → Evaluation | null`; `computeUpperBound(optimisticStats: Stats, actionGroups) → number` (= `turnPlanner.planTurn(actionGroups, optimisticStats.get(AP), optimisticStats).totalDamage`).
  - `Evaluation`: `{ score, items: Item[], exos: { itemId, characteristic: "ap" | "mp" }[], stats: Stats, turn, assumedCriteria: { itemId, atoms: string[] }[] }`.

`evaluate` tries every ring-exo combination (per ring: none, AP if ring has no AP stat, MP if ring has no MP stat; only when `allowRingExos`), and for each: stats + exos → every item criterion met (on final stats) → `minAp`, `minMp`, `minResistances`, `minCriticalRate` (on `stats.get(CRITICAL)`) met → score via `planTurn`. Returns the best valid combination, or `null` if none.

- [ ] **Step 1: Write failing tests**

```js
test("Query.parse rejects two elements in v1", () => assert.throws(() => Query.parse(withElements(["water", "air"]), data), /Invalid query/));
test("base stats are 7 AP 3 MP at level 200", () => /* AP 7, MP 3 */);
test("base AP is 6 below level 100", () => {});
test("set bonus depends on worn count", () => /* 2 items of 2-set → bonusFor(2) added */);
test("ring without AP gets AP exo when it helps reach minAp", () => {
    // minAp 8, no item gives AP → exo AP on one ring → evaluation.exos = [{ itemId: ring.id, characteristic: "ap" }]
});
test("ring with native AP cannot take AP exo", () => {});
test("criterion is checked with exos applied", () => /* item CP<8 + AP exo reaching 8 → that exo combination rejected */);
test("returns null when constraints unreachable", () => assert.equal(evaluator.evaluate(items), null));
test("assumed criteria are reported", () => /* item with BI=1 → assumedCriteria [{ itemId, atoms: ["BI=1"] }] */);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(optimizer): evaluate a stuff with sets, criterions and ring exos`

---

### Task 8: Candidate filtering

**Files:**
- Create: `src/optimizer/CandidateFilter.js`
- Test: `tests/optimizer/CandidateFilter.test.js`

**Interfaces:**
- Consumes: `Query`, `GameData`, `SLOT_CAPACITIES`, `ELEMENTS`.
- Produces: `class CandidateFilter`: `constructor(query, gameData)` (Ruling 9: set-aware dominance); `relevantCharacteristics() → number[]` (element characteristic, POWER, DAMAGE, element fixed damage, CRITICAL, CRITICAL_DAMAGE, SPELL/WEAPON/MELEE/RANGED percents, AP, MP, plus resistances in `minResistances`); `buildCandidates(items: Item[]) → Map<slot, Item[]>`.

Rules: drop items with `level > query.level` or in `excludedItemIds`; required items are always kept. An item is **dominated** by another of the same slot when the other is ≥ on every relevant characteristic, > on at least one, has the same `criterion` string (or empty), and the dominated item has no `setId` and is not required. Drop an item only if dominated by at least `SLOT_CAPACITIES[slot]` distinct items. Weapons: never dominance-pruned (their action changes the turn). Sort each slot's candidates by `sum of relevant stats` descending (search order heuristic).

- [ ] **Step 1: Write failing tests**

```js
test("drops item above character level", () => {});
test("drops ring only when dominated by two rings", () => /* dominated by one ring → kept */);
test("keeps set items even if dominated", () => {});
test("keeps required item", () => {});
test("does not prune weapons", () => {});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(optimizer): build per-slot candidates with dominance pruning`

---

### Task 9: Branch-and-bound optimizer

**Files:**
- Create: `src/optimizer/StuffOptimizer.js`
- Test: `tests/optimizer/StuffOptimizer.test.js`

**Interfaces:**
- Consumes: `Map<slot, Item[]>` from Task 8, `StuffEvaluator` (Task 7), `SLOT_CAPACITIES`, `PRYSMARADITE_TYPE_ID`, `MAX_PRYSMARADITES`.
- Produces: `class StuffOptimizer`: `constructor({ candidates, evaluator, query, gameData, relevantCharacteristics, timeLimitMs, nowFn = Date.now })` (`relevantCharacteristics` from `CandidateFilter.relevantCharacteristics()`, `gameData.getSet` for set bounds); `optimize() → { isOptimal: boolean, evaluations: Evaluation[] }` (top `query.topCount`, best first, distinct item sets).

Algorithm:

```
slots order: weapon first (fixes actionGroups), then by descending candidate count impact; multi-capacity slots
choose combinations i<j<… (no duplicate item); an empty choice is allowed for every slot.
two-handed weapon ⇒ shield slot forced empty; at most MAX_PRYSMARADITES items of PRYSMARADITE_TYPE_ID.
required items: a slot holding a required item must include it.

upper bound at a node = evaluator.computeUpperBound(optimistic, actionGroups) where
  optimistic = partial items stats (with base)
             + Σ remaining slots: per relevant characteristic, sum of the top-`capacity` values among that slot's candidates
             + Σ over sets having ≥1 candidate: per characteristic, max over count of bonusFor(count)
             + (allowRingExos ? +1 AP and +1 MP per remaining ring slot : 0)
prune if bound <= worst score in current top-N (once N found)
prune if optimistic AP/MP/resistances/critical < the query minimums
leaf → evaluator.evaluate(items); insert into top-N if not null
check nowFn() against timeLimitMs every node; on timeout stop and return isOptimal = false
```

Damage is non-decreasing in every relevant characteristic and in AP, so the bound is valid.

- [ ] **Step 1: Write failing tests**

```js
test("finds the same best stuff as brute force on fixture", () => {
    // fixture: ~3 candidates per slot over 4 slots incl. 2 rings and a 2-item set
    assert.equal(optimizer.optimize().evaluations[0].score, bruteForceBest(fixture).score);
});
test("never equips the same ring twice", () => {});
test("two-handed weapon leaves shield empty", () => {});
test("returns top N distinct stuffs sorted by score", () => {});
test("timeout returns best so far with isOptimal false", () => {
    // nowFn advances 1000 ms per call, timeLimitMs 1500
    assert.equal(optimizer.optimize().isOptimal, false);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(optimizer): exact branch-and-bound stuff search`

---

### Task 10: Orchestration, CLI, result format

**Files:**
- Create: `src/optimizer/OptimizationManager.js`, `src/main.js`
- Test: `tests/optimizer/OptimizationManager.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `class OptimizationManager`: `constructor({ gameData, config })`; `run(queryJson) → Result`.
  - CLI: `node src/main.js sync` and `node src/main.js optimize --query <file.json>` (JSON result on stdout, logs on stderr). `main().catch(error => { console.error("❌", error.message); process.exitCode = 1; })`.

`Result` (the agent relies on this exact shape):

```json
{
    "isOptimal": true,
    "elapsedMs": 1234,
    "reason": null,
    "dataSyncedAt": "2026-11-15T10:00:00.000Z",
    "ignoredSpells": [{ "name": "Flèche Punitive", "reason": "no-direct-damage" }],
    "results": [
        {
            "score": 4521.3,
            "items": [{ "slot": "ring", "id": 1, "name": "…", "exo": "ap" }],
            "stats": { "ap": 12, "mp": 6, "chance": 950 },
            "turn": [{ "name": "Flèche Glacée", "kind": "spell", "count": 2, "damagePerCast": 812.4 }],
            "assumedCriteria": [{ "itemId": 1, "atoms": ["BI=1"] }]
        }
    ],
    "variants": [{ "label": "+1 MP", "deltaPercent": -4.2, "result": { "…": "same shape as results[0]" } }]
}
```

`variants`: after the main run, re-run with `minMp = best.mp + 1` and with `minAp = best.ap + 1` (each `topCount: 1`); include those that found a stuff, `deltaPercent = (variant.score / best.score - 1) * 100`. `reason: "no-valid-stuff"` with `results: []` when nothing satisfies constraints. Throws `Error("No <element> damage action for <breed> at level <level>")` (with ignored spell names) when the action groups are empty.

- [ ] **Step 1: Write failing tests** (fixture data):

```js
test("run returns documented result shape", () => { /* keys of result and results[0] */ });
test("impossible constraints give no-valid-stuff", () => {
    const result = manager.run({ ...baseQuery, constraints: { minAp: 20 } });
    assert.deepEqual([result.reason, result.results.length], ["no-valid-stuff", 0]);
});
test("element without damage action throws with breed and element", () =>
    assert.throws(() => manager.run(earthQueryOnWaterOnlyBreed), /No earth damage action for/));
test("variants report damage delta", () => {});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Smoke run on real data** — `npm run sync` then `node src/main.js optimize --query tests/fixtures/craWater200.json` (Crâ, 200, water, `minAp: 11, minMp: 6`). Expected: JSON with `results.length >= 1` within `SEARCH_TIME_LIMIT_MS`; note `elapsedMs` and `isOptimal`. If it times out, report it before tuning (do not change the spec's exactness rule).
- [ ] **Step 6: Commit** `feat: wire optimize and sync CLI commands`

---

### Task 11: Claude Code agent

**Files:**
- Create: `.claude/agents/stuff-optimizer.md`, `README.md` (short: sync, optimize, agent usage, in French)

**Interfaces:**
- Consumes: CLI and `Result` shape from Task 10.

Agent frontmatter: `name: stuff-optimizer`, `description` (French, triggers on requests for an optimized Dofus stuff), `tools: Bash, Read, Write`. Body (French) must instruct:
1. Extract breed, level, element/profile, constraints; ask if breed or level is missing.
2. Write the query JSON to a temp file following the spec's schema; run `node src/main.js optimize --query <file>` from the project root; if the error says data is missing or `dataSyncedAt` is older than 30 days, offer `node src/main.js sync`.
3. Answer only from the result: items per slot with exos, key totals (PA, PM, element carac, puissance, dommages, critique), the turn combo with damage, variants with their % cost, `assumedCriteria` as warnings, ignored spells, and an explicit warning when `isOptimal` is false. Never invent items or stats.
4. Explain the "do crit" profile = `minCriticalRate` on the sheet critical %.

- [ ] **Step 1: Write the agent and README.**
- [ ] **Step 2: Verify** — in Claude Code from the project root, ask the agent: « Meilleur stuff Eau pour un Crâ 200, 11 PA 6 PM ». Expected: it runs the CLI and answers in French with the elements listed in point 3.
- [ ] **Step 3: Commit** `feat(agent): add stuff-optimizer Claude Code agent`
