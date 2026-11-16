const LinearExpression = require("./LinearExpression");
const { SENSE, VARIABLE_TYPE } = require("./LpWriter");
const PointAllocator = require("../character/PointAllocator");

// Characteristic points as integer amounts bought in each cost range of PointAllocator; costs grow with the
// ranges, so the cheapest ones are always those a maximizing solution fills, and any mix stays affordable.
class PointModel {
    #writer;
    #allocator;
    #scrollStats;
    #baseByCharacteristic = new Map();

    constructor({ writer, level, useScrolls, elementCharacteristic }) {
        this.#writer = writer;
        this.#allocator = new PointAllocator({ level, useScrolls, elementCharacteristic });
        this.#scrollStats = this.#allocator.scrollStats;
    }

    build(characteristics) {
        const availablePoints = this.#allocator.availablePoints;
        const totalCost = new LinearExpression();
        for (const characteristic of characteristics) {
            const base = new LinearExpression();
            this.#allocator.listCostSegments(characteristic).forEach(({ from, to, cost }, index) => {
                const variable = this.#writer.addVariable(`p${characteristic}_${index}`, {
                    upper: Math.min(to - from, Math.floor(availablePoints / cost)),
                    type: VARIABLE_TYPE.INTEGER,
                });
                base.addTerm(variable, 1);
                totalCost.addTerm(variable, cost);
            });
            const baseVariable = this.#writer.addVariable(`b${characteristic}`, {
                upper: this.#allocator.findMaxBase(characteristic, availablePoints),
                type: VARIABLE_TYPE.INTEGER,
            });
            this.#writer.addConstraint(base.addTerm(baseVariable, -1), SENSE.EQUAL);
            this.#baseByCharacteristic.set(characteristic, LinearExpression.ofTerm(baseVariable));
        }
        if (!totalCost.isConstant) this.#writer.addConstraint(totalCost, SENSE.AT_MOST, availablePoints);
    }

    // Base value bought with points plus the scroll, for one characteristic.
    contributionOf(characteristic) {
        const contribution = this.#baseByCharacteristic.get(characteristic)?.clone() ?? new LinearExpression();
        return contribution.addConstant(this.#scrollStats.get(characteristic));
    }
}

module.exports = PointModel;
