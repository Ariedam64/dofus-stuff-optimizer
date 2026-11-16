const LinearExpression = require("./LinearExpression");
const { SENSE } = require("./LpWriter");
const Action = require("../damage/Action");
const { CHARACTERISTIC } = require("../stats/characteristics");
const { MAX_AP } = require("../config");

const PERCENT_BASE = 100;
const SINGLE_GROUP_CAST = 1;

function findPercentCharacteristics(action) {
    const kind =
        action.kind === Action.KIND.SPELL ? CHARACTERISTIC.SPELL_DAMAGE_PERCENT : CHARACTERISTIC.WEAPON_DAMAGE_PERCENT;
    const range = action.isMelee ? CHARACTERISTIC.MELEE_DAMAGE_PERCENT : CHARACTERISTIC.RANGED_DAMAGE_PERCENT;
    return [kind, range];
}

// Turn damage: the knapsack of casts over AP is chosen by binaries (one per action and cast count), each cast count
// multiplying the expected damage through an exact binary product; casts are then summed per (kind, range) class
// and multiplied by the class % factors through the bit expansions of the % stats.
class DamageModel {
    #writer;
    #linearizer;
    #expectedDamageModel;
    #statVariableOf;
    #rawApUpper;
    #apUpper;
    #castTerms = new LinearExpression();
    #classes = new Map();
    #percentExpansions = new Map();

    constructor({ writer, linearizer, expectedDamageModel, statVariableOf }) {
        this.#writer = writer;
        this.#linearizer = linearizer;
        this.#expectedDamageModel = expectedDamageModel;
        this.#statVariableOf = statVariableOf;
        this.#rawApUpper = Math.floor(writer.boundsOf(statVariableOf(CHARACTERISTIC.AP)).upper);
        this.#apUpper = Math.max(0, Math.min(this.#rawApUpper, MAX_AP));
    }

    // spellGroups: Action[][]; weapons: [{ variable, action }]. Returns the turn damage expression.
    build({ spellGroups, weapons }) {
        spellGroups.forEach((group, groupIndex) => {
            const groupCasts = new LinearExpression();
            group.forEach((action, actionIndex) => {
                groupCasts.addExpression(this.#addAction(`s${groupIndex}_${actionIndex}`, action));
            });
            if (!groupCasts.isConstant) this.#writer.addConstraint(groupCasts, SENSE.AT_MOST, SINGLE_GROUP_CAST);
        });
        for (const { variable, action } of weapons) {
            const weaponCasts = this.#addAction(`w${variable}`, action);
            if (!weaponCasts.isConstant) {
                this.#writer.addConstraint(weaponCasts.addTerm(variable, -1), SENSE.AT_MOST);
            }
        }
        if (!this.#castTerms.isConstant) this.#addApBudget();
        const turnDamage = new LinearExpression();
        for (const [key, entry] of this.#classes) turnDamage.addExpression(this.#addClassDamage(key, entry));
        return turnDamage;
    }

    // AP spent <= max(0, min(AP, MAX_AP)): the game ignores AP above its cap, and a negative AP total only forbids
    // every cast, so it gets a binary when it can happen.
    #addApBudget() {
        if (this.#rawApUpper > MAX_AP) this.#writer.addConstraint(this.#castTerms.clone(), SENSE.AT_MOST, MAX_AP);
        const apVariable = this.#statVariableOf(CHARACTERISTIC.AP);
        const apRow = this.#castTerms.clone().addTerm(apVariable, -1);
        const apLower = this.#writer.boundsOf(apVariable).lower;
        if (apLower >= 0) {
            this.#writer.addConstraint(apRow, SENSE.AT_MOST);
            return;
        }
        const isApPositive = this.#writer.addBinary("appos");
        this.#writer.addConstraint(apRow.addTerm(isApPositive, -apLower), SENSE.AT_MOST, -apLower);
        const castingRow = this.#castTerms.clone().addTerm(isApPositive, -this.#apUpper);
        this.#writer.addConstraint(castingRow, SENSE.AT_MOST);
    }

    // Returns the sum of the cast-count binaries of the action.
    #addAction(id, action) {
        const castBinaries = new LinearExpression();
        if (action.apCost <= 0) return castBinaries;
        const maxCount = Math.min(action.maxCasts, Math.floor(this.#apUpper / action.apCost));
        if (maxCount < 1) return castBinaries;
        const expected = this.#expectedDamageModel.addExpectedDamage(id, action);
        const castDamage = this.#classOf(action);
        const castSum = new LinearExpression();
        for (let count = 1; count <= maxCount; count++) {
            const binary = this.#writer.addBinary(`n${id}_${count}`);
            const product = this.#writer.addVariable(`v${id}_${count}`, { upper: expected.upper });
            this.#writer.addConstraint(
                LinearExpression.ofTerm(product).addTerm(binary, -expected.upper),
                SENSE.AT_MOST,
            );
            castBinaries.addTerm(binary, 1);
            castSum.addTerm(product, 1);
            castDamage.damage.addTerm(product, count);
            this.#castTerms.addTerm(binary, count * action.apCost);
        }
        this.#writer.addConstraint(castSum.addTerm(expected.variable, -1), SENSE.AT_MOST);
        castDamage.uppers.push(maxCount * expected.upper);
        castDamage.ratios.push(expected.upper / action.apCost);
        return castBinaries;
    }

    #classOf(action) {
        const percentCharacteristics = findPercentCharacteristics(action);
        const key = percentCharacteristics.join("_");
        if (!this.#classes.has(key)) {
            this.#classes.set(key, { percentCharacteristics, damage: new LinearExpression(), uppers: [], ratios: [] });
        }
        return this.#classes.get(key);
    }

    // class damage = sum of casts × (1 + kind % / 100) × (1 + range % / 100)
    #addClassDamage(key, { percentCharacteristics, damage: castDamage, uppers, ratios }) {
        const sumUpper = uppers.reduce((total, value) => total + value, 0);
        const apUpper = this.#apUpper * Math.max(0, ...ratios);
        let damage = this.#addBoundedSum(`g${key}`, castDamage, Math.min(sumUpper, apUpper));
        for (const characteristic of percentCharacteristics) {
            const expansion = this.#expandPercent(characteristic);
            const scaled = this.#linearizer.multiplyByExpandedInteger(`f${key}_${characteristic}`, expansion, damage);
            const factored = damage.clone().addExpression(scaled, 1 / PERCENT_BASE);
            const bounds = this.#writer.boundsOfExpression(factored);
            damage = this.#addBoundedSum(`h${key}_${characteristic}`, factored, bounds.upper, bounds.lower);
        }
        return damage;
    }

    #addBoundedSum(name, expression, upper, lower = 0) {
        const variable = this.#writer.addVariable(name, { lower: Math.min(0, lower), upper: Math.max(0, upper) });
        this.#writer.addConstraint(expression.clone().addTerm(variable, -1), SENSE.EQUAL);
        return LinearExpression.ofTerm(variable);
    }

    #expandPercent(characteristic) {
        if (!this.#percentExpansions.has(characteristic)) {
            const statExpression = LinearExpression.ofTerm(this.#statVariableOf(characteristic));
            this.#percentExpansions.set(
                characteristic,
                this.#linearizer.expandInBits(`pb${characteristic}`, statExpression),
            );
        }
        return this.#percentExpansions.get(characteristic);
    }
}

module.exports = DamageModel;
