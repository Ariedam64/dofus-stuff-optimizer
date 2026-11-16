const LinearExpression = require("./LinearExpression");
const { SENSE } = require("./LpWriter");
const CriterionEvaluator = require("../rules/CriterionEvaluator");

const LEVEL_CODE = "PL";
const BREED_CODE = "PG";
const NUMERIC_VALUE_PATTERN = /^-?\d+$/;
const STRICT_GAP = 1;
const MIN_SET_BONUS_LIMIT = 1;
const FALSE_BRANCH = Object.freeze({ isFalse: true });

function compareConstant(actualValue, operator, expectedValue) {
    if (operator === "<") return actualValue < expectedValue;
    if (operator === ">") return actualValue > expectedValue;
    if (operator === "!") return actualValue !== expectedValue;
    return actualValue === expectedValue;
}

function buildStatRows(characteristic, operator, value) {
    if (operator === ">") return [{ characteristic, sense: SENSE.AT_LEAST, value: value + STRICT_GAP }];
    if (operator === "<") return [{ characteristic, sense: SENSE.AT_MOST, value: value - STRICT_GAP }];
    if (operator === "=" || operator === "~") {
        return [
            { characteristic, sense: SENSE.AT_LEAST, value },
            { characteristic, sense: SENSE.AT_MOST, value },
        ];
    }
    return null;
}

// Item criteria as linear rows: one binary per disjunctive branch, big-M rows per atom. Atoms the model cannot
// express are left out, which only widens the model; the exact evaluator then rejects what they forbid.
class CriterionModel {
    #writer;
    #itemModel;
    #query;
    #statVariableOf;
    #criterionEvaluator = new CriterionEvaluator();
    #hasRelaxedAtoms = false;

    constructor({ writer, itemModel, query, statVariableOf }) {
        this.#writer = writer;
        this.#itemModel = itemModel;
        this.#query = query;
        this.#statVariableOf = statVariableOf;
    }

    static listStatCharacteristics(items) {
        const characteristics = new Set();
        const evaluator = new CriterionEvaluator();
        for (const criterion of new Set(items.map((item) => item.criterion).filter(Boolean))) {
            for (const atoms of evaluator.listBranches(criterion)) {
                for (const { code } of atoms) {
                    if (Object.hasOwn(CriterionEvaluator.STAT_CODES, code)) {
                        characteristics.add(CriterionEvaluator.STAT_CODES[code]);
                    }
                }
            }
        }
        return [...characteristics];
    }

    get hasRelaxedAtoms() {
        return this.#hasRelaxedAtoms;
    }

    build() {
        const itemsByCriterion = new Map();
        for (const item of this.#itemModel.items.filter((candidate) => candidate.criterion)) {
            if (!itemsByCriterion.has(item.criterion)) itemsByCriterion.set(item.criterion, []);
            itemsByCriterion.get(item.criterion).push(item);
        }
        [...itemsByCriterion].forEach(([criterion, items], index) => this.#addCriterion(index, criterion, items));
    }

    #addCriterion(index, criterion, items) {
        const branches = this.#criterionEvaluator
            .listBranches(criterion)
            .map((atoms) => this.#classifyBranch(atoms))
            .filter((branch) => !branch.isFalse);
        if (branches.some((branch) => branch.rows.length === 0 && branch.setLimits.length === 0)) return;
        const itemVariables = items.map((item) => this.#itemModel.variableOf(item));
        if (branches.length === 0) {
            for (const variable of itemVariables)
                this.#writer.addConstraint(LinearExpression.ofTerm(variable), SENSE.AT_MOST);
            return;
        }
        const branchSum = new LinearExpression();
        branches.forEach((branch, branchIndex) => {
            const binary = this.#writer.addBinary(`k${index}_${branchIndex}`);
            branchSum.addTerm(binary, 1);
            for (const row of branch.rows) this.#addStatRow(row, binary);
            for (const limit of branch.setLimits) this.#addSetLimit(limit, binary);
        });
        for (const variable of itemVariables) {
            this.#writer.addConstraint(branchSum.clone().addTerm(variable, -1), SENSE.AT_LEAST);
        }
    }

    #classifyBranch(atoms) {
        const rows = [];
        const setLimits = [];
        for (const { code, operator, value } of atoms) {
            const isNumeric = NUMERIC_VALUE_PATTERN.test(value);
            if (code === LEVEL_CODE || code === BREED_CODE) {
                const actualValue = code === LEVEL_CODE ? this.#query.level : this.#query.breed.id;
                if (isNumeric && !compareConstant(actualValue, operator, Number(value))) return FALSE_BRANCH;
                if (!isNumeric) this.#hasRelaxedAtoms = true;
            } else if (code === CriterionEvaluator.SET_BONUS_LEVEL_CODE) {
                if (!isNumeric || operator !== "<") this.#hasRelaxedAtoms = true;
                else if (Number(value) < MIN_SET_BONUS_LIMIT) return FALSE_BRANCH;
                else setLimits.push(Number(value));
            } else if (Object.hasOwn(CriterionEvaluator.STAT_CODES, code)) {
                const statRows = isNumeric
                    ? buildStatRows(CriterionEvaluator.STAT_CODES[code], operator, Number(value))
                    : null;
                if (!statRows) this.#hasRelaxedAtoms = true;
                else if (statRows.some((row) => !this.#isReachable(row))) return FALSE_BRANCH;
                else rows.push(...statRows);
            }
        }
        return { isFalse: false, rows, setLimits };
    }

    #isReachable({ characteristic, sense, value }) {
        const { lower, upper } = this.#writer.boundsOf(this.#statVariableOf(characteristic));
        return sense === SENSE.AT_LEAST ? upper >= value : lower <= value;
    }

    #addStatRow({ characteristic, sense, value }, binary) {
        const variable = this.#statVariableOf(characteristic);
        const { lower, upper } = this.#writer.boundsOf(variable);
        const bigM = sense === SENSE.AT_LEAST ? value - lower : upper - value;
        if (bigM <= 0) return;
        const signedM = sense === SENSE.AT_LEAST ? -bigM : bigM;
        const row = LinearExpression.ofTerm(variable).addTerm(binary, signedM);
        this.#writer.addConstraint(row, sense, value + signedM);
    }

    // "pk<n": the set bonus level (highest worn count of a set, minus one) stays below n, so every set count <= n.
    #addSetLimit(limit, binary) {
        for (const [setId, maxWorn] of this.#itemModel.maxWornBySetId) {
            if (maxWorn <= limit) continue;
            const row = this.#itemModel.setCountOf(setId).addTerm(binary, maxWorn - limit);
            this.#writer.addConstraint(row, SENSE.AT_MOST, maxWorn);
        }
    }
}

module.exports = CriterionModel;
