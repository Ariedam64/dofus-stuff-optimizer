const LinearExpression = require("./LinearExpression");
const { SENSE } = require("./LpWriter");
const DiversityRule = require("./DiversityRule");
const { SLOT, SLOT_CAPACITIES } = require("../data/slots");

const { TOTAL_POSITIONS } = DiversityRule;
const SINGLE_CAPACITY = 1;

// Cuts added to the solver between solves, all expressed on the item variables of the model.
class CutBuilder {
    #solver;
    #itemModel;
    #damageVariable;
    #damageUpper;
    #totalCuts = 0;

    constructor({ solver, itemModel, damageVariable, damageUpper }) {
        this.#solver = solver;
        this.#itemModel = itemModel;
        this.#damageVariable = damageVariable;
        this.#damageUpper = damageUpper;
    }

    // Number of items that differ from this stuff (0 only for the stuff itself); an item missing from the model
    // is never worn, so it always differs.
    #distanceFrom(items) {
        const chosen = new Set(items);
        const distance = new LinearExpression(items.filter((item) => !this.#itemModel.variableOf(item)).length);
        for (const item of this.#itemModel.items) {
            const variable = this.#itemModel.variableOf(item);
            if (chosen.has(item)) distance.addConstant(1).addTerm(variable, -1);
            else distance.addTerm(variable, 1);
        }
        return distance;
    }

    #sumOfWorn(items) {
        return LinearExpression.sumOf(
            items.map((item) => this.#itemModel.variableOf(item)).filter((variable) => variable !== undefined),
        );
    }

    excludeStuff(items) {
        this.#solver.addConstraint(this.#distanceFrom(items), SENSE.AT_LEAST, 1);
    }

    // The exact score holds for these items whatever the exos and points, so the model may not claim more for them.
    boundStuff(items, exactScore) {
        const bigM = Math.max(0, this.#damageUpper - exactScore);
        const row = LinearExpression.ofTerm(this.#damageVariable).addExpression(this.#distanceFrom(items), -bigM);
        this.#solver.addConstraint(row, SENSE.AT_MOST, exactScore);
    }

    // Same weapon (or both without) => at most TOTAL_POSITIONS - minDifferentItems positions in common,
    // an empty position matching an empty one and rings or dofus compared as sets.
    addDiversityCut(items, minDifferentItems) {
        this.#totalCuts += 1;
        const overlap = new LinearExpression();
        for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
            overlap.addExpression(this.#slotOverlap(slot, capacity, items));
        }
        const row = overlap.addExpression(this.#weaponChange(items), -TOTAL_POSITIONS);
        this.#solver.addConstraint(row, SENSE.AT_MOST, TOTAL_POSITIONS - minDifferentItems);
    }

    #variablesOf(slot) {
        return this.#itemModel.itemsOfSlot(slot).map((item) => this.#itemModel.variableOf(item));
    }

    #weaponChange(items) {
        const weapon = items.find((item) => item.slot === SLOT.WEAPON);
        if (weapon) return new LinearExpression(1).addExpression(this.#sumOfWorn([weapon]), -1);
        return LinearExpression.sumOf(this.#variablesOf(SLOT.WEAPON));
    }

    #slotOverlap(slot, capacity, items) {
        const worn = items.filter((item) => item.slot === slot);
        const shared = this.#sumOfWorn(worn);
        if (worn.length === capacity) return shared;
        const wornCount = LinearExpression.sumOf(this.#variablesOf(slot));
        if (capacity === SINGLE_CAPACITY) return new LinearExpression(1).addExpression(wornCount, -1);
        return shared.addConstant(capacity).addTerm(this.#addFilledMaximum(slot, capacity, worn.length, wornCount), -1);
    }

    // filled <= max(previous count, new count): the matched empty positions are capacity - filled.
    #addFilledMaximum(slot, capacity, previousCount, wornCount) {
        const prefix = `dv${this.#totalCuts}_${slot}`;
        const filled = this.#solver.addVariable(`${prefix}_f`, { lower: 0, upper: capacity });
        const usesNewCount = this.#solver.addVariable(`${prefix}_z`, { lower: 0, upper: 1, isInteger: true });
        const filledTerm = LinearExpression.ofTerm(filled);
        this.#solver.addConstraint(
            filledTerm.clone().addTerm(usesNewCount, previousCount - capacity),
            SENSE.AT_MOST,
            previousCount,
        );
        const newCountRow = filledTerm.clone().addExpression(wornCount, -1).addTerm(usesNewCount, capacity);
        this.#solver.addConstraint(newCountRow, SENSE.AT_MOST, capacity);
        return filled;
    }
}

module.exports = CutBuilder;
