const { CHARACTERISTIC } = require("../stats/characteristics");

const LEVEL_CODE = "PL";
const BREED_CODE = "PG";
// Set bonus level: the highest count of items worn from one set, minus one.
const SET_BONUS_LEVEL_CODE = "pk";
const CODE_LENGTH = 2;
const OPERATORS = ["<", ">", "=", "!", "~"];
const VALUE_TERMINATORS = ["&", "|", ")"];
const NUMERIC_VALUE_PATTERN = /^-?\d+$/;
const STAT_CODES = Object.freeze({
    CP: CHARACTERISTIC.AP,
    CM: CHARACTERISTIC.MP,
    CS: CHARACTERISTIC.STRENGTH,
    CI: CHARACTERISTIC.INTELLIGENCE,
    CC: CHARACTERISTIC.CHANCE,
    CA: CHARACTERISTIC.AGILITY,
    CV: CHARACTERISTIC.VITALITY,
    CW: CHARACTERISTIC.WISDOM,
});
const BRANCH_ALGEBRA = Object.freeze({
    atom: (atom) => [[atom]],
    or: (leftBranches, rightBranches) => [...leftBranches, ...rightBranches],
    and: (leftBranches, rightBranches) =>
        leftBranches.flatMap((leftAtoms) => rightBranches.map((rightAtoms) => [...leftAtoms, ...rightAtoms])),
});

class CriterionEvaluator {
    static STAT_CODES = STAT_CODES;
    static SET_BONUS_LEVEL_CODE = SET_BONUS_LEVEL_CODE;

    #criterion = "";
    #position = 0;
    #context = null;
    #assumedAtoms = [];
    #algebra = null;
    #booleanAlgebra = Object.freeze({
        atom: ({ code, operator, value, text }) => this.#evaluateAtom(code, operator, value, text),
        or: (isLeftMet, isRightMet) => isLeftMet || isRightMet,
        and: (isLeftMet, isRightMet) => isLeftMet && isRightMet,
    });

    evaluate(criterion, context) {
        this.#context = context;
        this.#assumedAtoms = [];
        const isMet = this.#parse(criterion, this.#booleanAlgebra, true);
        return { isMet, assumedAtoms: this.#assumedAtoms };
    }

    // Disjunctive normal form: each branch is a list of atoms that must all hold.
    listBranches(criterion) {
        return this.#parse(criterion, BRANCH_ALGEBRA, [[]]);
    }

    #parse(criterion, algebra, emptyResult) {
        this.#criterion = criterion;
        this.#position = 0;
        this.#algebra = algebra;
        this.#skipWhitespace();
        if (this.#isAtEnd()) return emptyResult;

        const result = this.#parseExpression();
        this.#skipWhitespace();
        if (!this.#isAtEnd()) this.#fail(`unexpected "${this.#criterion[this.#position]}"`);
        return result;
    }

    #parseExpression() {
        let result = this.#parseTerm();
        while (this.#consume("|")) result = this.#algebra.or(result, this.#parseTerm());
        return result;
    }

    #parseTerm() {
        let result = this.#parseFactor();
        while (this.#consume("&")) result = this.#algebra.and(result, this.#parseFactor());
        return result;
    }

    #parseFactor() {
        if (!this.#consume("(")) return this.#parseAtom();
        const result = this.#parseExpression();
        if (!this.#consume(")")) this.#fail("missing closing parenthesis");
        return result;
    }

    #parseAtom() {
        this.#skipWhitespace();
        const startPosition = this.#position;
        const code = this.#criterion.slice(startPosition, startPosition + CODE_LENGTH);
        if (code.length < CODE_LENGTH) this.#fail("missing code");
        this.#position += CODE_LENGTH;
        this.#skipWhitespace();
        const operator = this.#criterion[this.#position];
        if (!OPERATORS.includes(operator)) this.#fail(`missing operator after "${code}"`);
        this.#position += 1;
        const value = this.#readValue();
        return this.#algebra.atom({ code, operator, value, text: `${code}${operator}${value}` });
    }

    #readValue() {
        this.#skipWhitespace();
        const startPosition = this.#position;
        while (!this.#isAtEnd() && !VALUE_TERMINATORS.includes(this.#criterion[this.#position])) {
            this.#position += 1;
        }
        const value = this.#criterion.slice(startPosition, this.#position).trim();
        if (value === "") this.#fail("missing value");
        return value;
    }

    #evaluateAtom(code, operator, value, atomText) {
        const actualValue = this.#findNumericActualValue(code);
        if (actualValue === undefined) {
            this.#assumedAtoms.push(atomText);
            return true;
        }
        if (!NUMERIC_VALUE_PATTERN.test(value)) this.#fail(`non-numeric value "${value}" for "${code}"`);
        return this.#compare(actualValue, operator, Number(value));
    }

    #findNumericActualValue(code) {
        if (code === LEVEL_CODE) return this.#context.level;
        if (code === BREED_CODE) return this.#context.breedId;
        if (code === SET_BONUS_LEVEL_CODE) return this.#context.setBonusLevel;
        if (Object.hasOwn(STAT_CODES, code)) return this.#context.stats.get(STAT_CODES[code]);
        return undefined;
    }

    #compare(actualValue, operator, expectedValue) {
        if (operator === "<") return actualValue < expectedValue;
        if (operator === ">") return actualValue > expectedValue;
        if (operator === "!") return actualValue !== expectedValue;
        return actualValue === expectedValue;
    }

    #consume(character) {
        this.#skipWhitespace();
        if (this.#criterion[this.#position] !== character) return false;
        this.#position += 1;
        return true;
    }

    #skipWhitespace() {
        while (/\s/.test(this.#criterion[this.#position] ?? "")) this.#position += 1;
    }

    #isAtEnd() {
        return this.#position >= this.#criterion.length;
    }

    #fail(reason) {
        throw new Error(`Invalid criterion "${this.#criterion}": ${reason} (at position ${this.#position})`);
    }
}

module.exports = CriterionEvaluator;
