const LinearExpression = require("./LinearExpression");
const { SENSE, VARIABLE_TYPE } = require("./LpWriter");
const { SLOT, SLOT_CAPACITIES, MAX_PRYSMARADITES } = require("../data/slots");
const { EXO_VALUE, EXO_CHARACTERISTICS } = require("../data/exos");

const NOT_WORN = 0;
const EXO_PREFIXES = Object.freeze({ ap: "xa", mp: "xm" });
// Fixed at 0: required to equal 1 when a weapon is required but no weapon is a candidate, so the model is infeasible.
const NO_WEAPON_VARIABLE = "wnone";

// Item choice variables and the rules that link them: slots, exclusions, exos and set item counts.
class ItemModel {
    #writer;
    #candidates;
    #query;
    #getSet;
    #itemVariables = new Map();
    #exoVariablesByCharacteristic = new Map();
    #setMembers = new Map();
    #maxWornBySetId = new Map();
    #setCountVariables = new Map();

    constructor({ writer, candidates, query, getSet }) {
        this.#writer = writer;
        this.#candidates = candidates;
        this.#query = query;
        this.#getSet = getSet;
    }

    get items() {
        return [...this.#itemVariables.keys()];
    }

    get maxWornBySetId() {
        return new Map(this.#maxWornBySetId);
    }

    variableOf(item) {
        return this.#itemVariables.get(item);
    }

    itemsOfSlot(slot) {
        return this.#candidates.get(slot) ?? [];
    }

    setCountOf(setId) {
        return LinearExpression.sumOf(this.#setMembers.get(setId).map((item) => this.variableOf(item)));
    }

    build() {
        for (const [slot, items] of this.#candidates) this.#addSlot(slot, items);
        if (this.#query.isWeaponRequired) this.#requireWeapon();
        this.#addExclusions();
        this.#indexSets();
        this.#addRingExos();
        for (const setId of this.#setMembers.keys()) {
            if (this.#hasBonus(setId)) this.#addSetCount(setId);
        }
    }

    // Items, set bonuses and exos for one characteristic.
    contributionOf(characteristic) {
        const expression = new LinearExpression();
        for (const [item, variable] of this.#itemVariables)
            expression.addTerm(variable, item.stats.get(characteristic));
        for (const [setId, countVariables] of this.#setCountVariables) {
            const set = this.#getSet(setId);
            countVariables.forEach((variable, wornCount) => {
                expression.addTerm(variable, set.bonusFor(wornCount).get(characteristic));
            });
        }
        for (const variable of this.#exoVariablesByCharacteristic.get(characteristic) ?? []) {
            expression.addTerm(variable, EXO_VALUE);
        }
        return expression;
    }

    #addSlot(slot, items) {
        const slotSum = new LinearExpression();
        for (const item of items) {
            const isRequired = this.#query.requiredItemIds.has(item.id);
            const variable = this.#writer.addVariable(`x${item.id}`, {
                lower: isRequired ? 1 : 0,
                upper: 1,
                type: VARIABLE_TYPE.INTEGER,
            });
            this.#itemVariables.set(item, variable);
            slotSum.addTerm(variable, 1);
        }
        if (!slotSum.isConstant) this.#writer.addConstraint(slotSum, SENSE.AT_MOST, SLOT_CAPACITIES[slot]);
    }

    #requireWeapon() {
        const weaponSum = LinearExpression.sumOf(this.itemsOfSlot(SLOT.WEAPON).map((item) => this.variableOf(item)));
        if (weaponSum.isConstant) weaponSum.addTerm(this.#writer.addVariable(NO_WEAPON_VARIABLE, { upper: 0 }), 1);
        this.#writer.addConstraint(weaponSum, SENSE.EQUAL, 1);
    }

    #addExclusions() {
        const prysmaradites = this.items.filter((item) => item.isPrysmaradite);
        const prysmaraditeSum = LinearExpression.sumOf(prysmaradites.map((item) => this.variableOf(item)));
        if (!prysmaraditeSum.isConstant) this.#writer.addConstraint(prysmaraditeSum, SENSE.AT_MOST, MAX_PRYSMARADITES);
        const twoHanded = this.itemsOfSlot(SLOT.WEAPON).filter((item) => item.isTwoHanded);
        if (twoHanded.length === 0) return;
        const handSum = LinearExpression.sumOf(
            [...twoHanded, ...this.itemsOfSlot(SLOT.SHIELD)].map((item) => this.variableOf(item)),
        );
        this.#writer.addConstraint(handSum, SENSE.AT_MOST, 1);
    }

    #addRingExos() {
        for (const ring of this.itemsOfSlot(SLOT.RING)) {
            const ringExos = new LinearExpression();
            for (const [exoKey, characteristic] of Object.entries(EXO_CHARACTERISTICS)) {
                if (!this.#query.allowsExo(exoKey) || !ring.canTakeExo(characteristic)) continue;
                const variable = this.#writer.addBinary(`${EXO_PREFIXES[exoKey]}${ring.id}`);
                if (!this.#exoVariablesByCharacteristic.has(characteristic)) {
                    this.#exoVariablesByCharacteristic.set(characteristic, []);
                }
                this.#exoVariablesByCharacteristic.get(characteristic).push(variable);
                ringExos.addTerm(variable, 1);
            }
            if (ringExos.isConstant) continue;
            this.#writer.addConstraint(ringExos.addTerm(this.variableOf(ring), -1), SENSE.AT_MOST);
        }
    }

    #indexSets() {
        for (const item of this.items) {
            if (item.setId === null) continue;
            if (!this.#getSet(item.setId))
                throw new Error(`Item ${item.id} (${item.name}) references missing set ${item.setId}`);
            if (!this.#setMembers.has(item.setId)) this.#setMembers.set(item.setId, []);
            this.#setMembers.get(item.setId).push(item);
        }
        for (const [setId, members] of this.#setMembers) {
            let maxWorn = 0;
            for (const [slot, capacity] of Object.entries(SLOT_CAPACITIES)) {
                maxWorn += Math.min(capacity, members.filter((item) => item.slot === slot).length);
            }
            this.#maxWornBySetId.set(setId, maxWorn);
        }
    }

    #hasBonus(setId) {
        const set = this.#getSet(setId);
        for (let count = 1; count <= this.#maxWornBySetId.get(setId); count++) {
            if (set.bonusFor(count).ids().length > 0) return true;
        }
        return false;
    }

    // One-hot over the worn count of a set, so that its bonus becomes linear.
    #addSetCount(setId) {
        const maxWorn = this.#maxWornBySetId.get(setId);
        const countVariables = [];
        const choice = new LinearExpression();
        const wornCount = this.setCountOf(setId).scaled(-1);
        for (let count = NOT_WORN; count <= maxWorn; count++) {
            const variable = this.#writer.addBinary(`y${setId}_${count}`);
            countVariables.push(variable);
            choice.addTerm(variable, 1);
            wornCount.addTerm(variable, count);
        }
        this.#writer.addConstraint(choice, SENSE.EQUAL, 1);
        this.#writer.addConstraint(wornCount, SENSE.EQUAL, 0);
        this.#setCountVariables.set(setId, countVariables);
    }
}

module.exports = ItemModel;
