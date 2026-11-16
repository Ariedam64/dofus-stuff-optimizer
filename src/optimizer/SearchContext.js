const Query = require("./Query");
const QueryError = require("./QueryError");
const RequiredItemsValidator = require("./RequiredItemsValidator");
const CandidateFilter = require("./CandidateFilter");
const StuffEvaluator = require("./StuffEvaluator");
const CriterionEvaluator = require("../rules/CriterionEvaluator");
const DamageCalculator = require("../damage/DamageCalculator");
const TurnPlanner = require("../damage/TurnPlanner");
const { SLOT } = require("../data/slots");

// Everything one search needs from a query: the parsed query, the candidate items and the exact evaluator.
// Built the same way on the main thread and in the solver worker.
class SearchContext {
    #query;
    #filter;
    #candidates;
    #evaluator;
    #gameData;
    #candidatesById;

    constructor(queryJson, gameData) {
        this.#gameData = gameData;
        this.#query = SearchContext.parseQuery(queryJson, gameData);
        this.#filter = new CandidateFilter(this.#query, gameData);
        this.#candidates = this.#filter.buildCandidates(gameData.items);
        this.#evaluator = new StuffEvaluator({
            query: this.#query,
            gameData,
            criterionEvaluator: new CriterionEvaluator(),
            turnPlanner: new TurnPlanner(new DamageCalculator(this.#query.elementKey)),
        });
        this.#candidatesById = new Map([...this.#candidates.values()].flat().map((item) => [item.id, item]));
    }

    // Every check that needs no search, so that a bad query is refused at once.
    static parseQuery(queryJson, gameData) {
        const query = Query.parse(queryJson, gameData);
        new RequiredItemsValidator(gameData.items).validate(query);
        return query;
    }

    get query() {
        return this.#query;
    }

    get filter() {
        return this.#filter;
    }

    get candidates() {
        return this.#candidates;
    }

    get evaluator() {
        return this.#evaluator;
    }

    findItems(itemIds) {
        return itemIds.map((id) => {
            const item = this.#candidatesById.get(id);
            if (!item) throw new Error(`Item ${id} is not among the candidates`);
            return item;
        });
    }

    describeCandidates() {
        return [...this.#candidates].map(([slot, items]) => `${slot} ${items.length}`).join(", ");
    }

    assertHasDamageAction() {
        const hasSpellAction = this.#evaluator.buildActionGroups(null).length > 0;
        const hasWeaponAction = (this.#candidates.get(SLOT.WEAPON) ?? []).some(
            (weapon) => this.#evaluator.buildActionGroups(weapon).length > 0,
        );
        if (hasSpellAction || hasWeaponAction) return;
        const { breed, level, elementKey } = this.#query;
        const ignoredSpellNames = this.listIgnoredSpells().map((spell) => spell.name);
        const ignoredText = ignoredSpellNames.length > 0 ? ` Ignored spells: ${ignoredSpellNames.join(", ")}` : "";
        throw new QueryError(
            QueryError.CODE.NO_DAMAGE_ACTION,
            `No ${elementKey} damage action for ${breed.name} at level ${level}.${ignoredText}`,
            { breedName: breed.name, level, elementKey, ignoredSpellNames },
        );
    }

    listIgnoredSpells() {
        return this.#gameData
            .getSpellGroups(this.#query.breed, this.#query.level)
            .flat()
            .filter((spell) => spell.ignoredReason)
            .map((spell) => ({ name: spell.name, reason: spell.ignoredReason }));
    }
}

module.exports = SearchContext;
