const LinearExpression = require("./LinearExpression");
const LpWriter = require("./LpWriter");
const ProductLinearizer = require("./ProductLinearizer");
const ItemModel = require("./ItemModel");
const PointModel = require("./PointModel");
const PointAllocator = require("../character/PointAllocator");
const StatBounds = require("./StatBounds");
const CriterionModel = require("./CriterionModel");
const ExpectedDamageModel = require("./ExpectedDamageModel");
const DamageModel = require("./DamageModel");
const Action = require("../damage/Action");
const StuffEvaluator = require("../optimizer/StuffEvaluator");
const CriterionEvaluator = require("../rules/CriterionEvaluator");
const DamageCalculator = require("../damage/DamageCalculator");
const TurnPlanner = require("../damage/TurnPlanner");
const { CHARACTERISTIC } = require("../stats/characteristics");
const { findElement } = require("../stats/elements");
const { SLOT } = require("../data/slots");

const { SENSE } = LpWriter;
const DAMAGE_VARIABLE = "dmg";
const LINEAR_ESTIMATE_VARIABLE = "lin";
const PERCENT_CHARACTERISTICS = [
    CHARACTERISTIC.SPELL_DAMAGE_PERCENT,
    CHARACTERISTIC.WEAPON_DAMAGE_PERCENT,
    CHARACTERISTIC.MELEE_DAMAGE_PERCENT,
    CHARACTERISTIC.RANGED_DAMAGE_PERCENT,
];

// Builds the exact MILP of the stuff search: its objective is the turn damage of the exact evaluator at every
// integer point (CriterionModel may relax a few atoms, which only widens the model).
class MilpModelBuilder {
    static DAMAGE_VARIABLE = DAMAGE_VARIABLE;

    #candidates;
    #spellGroups;
    #query;
    #gameData;
    #element;
    #writer = new LpWriter();
    #baseStats;
    #itemModel;
    #pointModel;
    #statBounds;
    #statVariables = new Map();

    // spellGroups (Action[][]) and baseStats (Stats before items and points) come from the exact evaluator;
    // callers without one get them from a new StuffEvaluator, so both models always share its definitions.
    constructor({ candidates, query, gameData, spellGroups, baseStats }) {
        this.#candidates = candidates;
        this.#query = query;
        this.#gameData = gameData;
        const evaluator = spellGroups && baseStats ? null : MilpModelBuilder.#createEvaluator(query, gameData);
        this.#spellGroups = spellGroups ?? evaluator.buildActionGroups(null);
        this.#baseStats = baseStats ?? evaluator.baseStats;
        this.#element = findElement(query.elementKey);
    }

    static #createEvaluator(query, gameData) {
        return new StuffEvaluator({
            query,
            gameData,
            criterionEvaluator: new CriterionEvaluator(),
            turnPlanner: new TurnPlanner(new DamageCalculator(query.elementKey)),
        });
    }

    // linearObjective: { weights: Map<characteristic, coefficient>, itemValues: Map<Item, number>,
    //   apValueOf: (ap) => number }, or null for the exact damage model.
    build({ linearObjective = null } = {}) {
        const getSet = (setId) => this.#gameData.getSet(setId);
        this.#itemModel = new ItemModel({
            writer: this.#writer,
            candidates: this.#candidates,
            query: this.#query,
            getSet,
        });
        this.#itemModel.build();
        const criterionCharacteristics = CriterionModel.listStatCharacteristics(this.#itemModel.items);
        this.#buildPoints(criterionCharacteristics);
        this.#statBounds = new StatBounds({
            candidates: this.#candidates,
            getSet,
            maxWornBySetId: this.#itemModel.maxWornBySetId,
            allowsExo: (exoKey) => this.#query.allowsExo(exoKey),
        });
        this.#addTrackedStats(criterionCharacteristics);
        this.#addQueryConstraints();
        const criterionModel = new CriterionModel({
            writer: this.#writer,
            itemModel: this.#itemModel,
            query: this.#query,
            statVariableOf: (characteristic) => this.#statVariableOf(characteristic),
        });
        criterionModel.build();
        if (linearObjective) return this.#finishLinearModel(linearObjective);
        const damage = this.#buildDamage();
        const damageBounds = this.#writer.boundsOfExpression(damage);
        this.#writer.addVariable(DAMAGE_VARIABLE, { lower: damageBounds.lower, upper: damageBounds.upper });
        this.#writer.addConstraint(damage.clone().addTerm(DAMAGE_VARIABLE, -1), SENSE.EQUAL);
        this.#writer.setObjective(LinearExpression.ofTerm(DAMAGE_VARIABLE));
        return {
            lpText: this.#writer.toString(),
            relaxedLpText: this.#writer.toString({ isRelaxed: true }),
            itemModel: this.#itemModel,
            damageUpper: damageBounds.upper,
            hasRelaxedCriteria: criterionModel.hasRelaxedAtoms,
        };
    }

    // Heuristic model: the damage is replaced by a linear estimate around a known stuff (see DamageLinearizer),
    // plus a value per AP level chosen by a one-hot, since extra AP allows extra casts.
    #finishLinearModel({ weights, itemValues, apValueOf }) {
        const objective = LinearExpression.ofTerm(this.#addStat(LINEAR_ESTIMATE_VARIABLE, weights));
        for (const [item, value] of itemValues) {
            const variable = this.#itemModel.variableOf(item);
            if (variable) objective.addTerm(variable, value);
        }
        const apVariable = this.#statVariableOf(CHARACTERISTIC.AP);
        const { lower, upper } = this.#writer.boundsOf(apVariable);
        const apLevels = LinearExpression.ofTerm(apVariable).scaled(-1);
        const levelChoice = new LinearExpression();
        for (let ap = Math.ceil(lower); ap <= Math.floor(upper); ap++) {
            const level = this.#writer.addBinary(`ap${ap - Math.ceil(lower)}`);
            apLevels.addTerm(level, ap);
            levelChoice.addTerm(level, 1);
            objective.addTerm(level, apValueOf(ap));
        }
        this.#writer.addConstraint(apLevels, SENSE.EQUAL);
        this.#writer.addConstraint(levelChoice, SENSE.EQUAL, 1);
        this.#writer.setObjective(objective);
        return { lpText: this.#writer.toString(), itemModel: this.#itemModel };
    }

    #buildPoints(criterionCharacteristics) {
        this.#pointModel = new PointModel({
            writer: this.#writer,
            level: this.#query.level,
            useScrolls: this.#query.useScrolls,
            elementCharacteristic: this.#element.characteristic,
        });
        const pointCharacteristics = [this.#element.characteristic, ...criterionCharacteristics].filter(
            (characteristic) => PointAllocator.POINT_CHARACTERISTICS.includes(characteristic),
        );
        this.#pointModel.build([...new Set(pointCharacteristics)]);
    }

    #addTrackedStats(criterionCharacteristics) {
        const resistances = Object.keys(this.#query.minResistances).map((key) => findElement(key).resistance);
        const tracked = [
            CHARACTERISTIC.AP,
            CHARACTERISTIC.MP,
            CHARACTERISTIC.CRITICAL,
            ...PERCENT_CHARACTERISTICS,
            ...resistances,
            ...criterionCharacteristics,
        ];
        for (const characteristic of new Set(tracked)) {
            this.#statVariables.set(
                characteristic,
                this.#addStat(`st${characteristic}`, new Map([[characteristic, 1]])),
            );
        }
    }

    // A variable equal to a weighted sum of characteristics, bounded over every stuff.
    #addStat(name, weights) {
        const expression = new LinearExpression();
        for (const [characteristic, weight] of weights) {
            expression.addExpression(this.#itemModel.contributionOf(characteristic), weight);
            expression.addExpression(this.#pointModel.contributionOf(characteristic), weight);
            expression.addConstant(weight * this.#baseStats.get(characteristic));
        }
        const itemBounds = this.#statBounds.boundsOf(weights);
        const itemContribution = new LinearExpression();
        for (const [characteristic, weight] of weights) {
            itemContribution.addExpression(this.#itemModel.contributionOf(characteristic), weight);
        }
        const otherBounds = this.#writer.boundsOfExpression(expression.clone().addExpression(itemContribution, -1));
        this.#writer.addVariable(name, {
            lower: itemBounds.lower + otherBounds.lower,
            upper: itemBounds.upper + otherBounds.upper,
        });
        this.#writer.addConstraint(expression.addTerm(name, -1), SENSE.EQUAL);
        return name;
    }

    #statVariableOf(characteristic) {
        const variable = this.#statVariables.get(characteristic);
        if (!variable) throw new Error(`Characteristic ${characteristic} is not tracked by the MILP model`);
        return variable;
    }

    #addQueryConstraints() {
        const query = this.#query;
        const minimums = [
            [CHARACTERISTIC.AP, query.minAp],
            [CHARACTERISTIC.MP, query.minMp],
            ...Object.entries(query.minResistances).map(([key, minimum]) => [findElement(key).resistance, minimum]),
        ];
        if (query.minCriticalRate !== null) minimums.push([CHARACTERISTIC.CRITICAL, query.minCriticalRate]);
        for (const [characteristic, minimum] of minimums) {
            this.#writer.addConstraint(
                LinearExpression.ofTerm(this.#statVariableOf(characteristic)),
                SENSE.AT_LEAST,
                minimum,
            );
        }
    }

    #buildDamage() {
        const element = this.#element;
        const statVariables = {
            multiplier: this.#addStat(
                "qm",
                new Map([
                    [element.characteristic, 1],
                    [CHARACTERISTIC.POWER, 1],
                ]),
            ),
            fixed: this.#addStat(
                "qf",
                new Map([
                    [CHARACTERISTIC.DAMAGE, 1],
                    [element.fixedDamage, 1],
                ]),
            ),
            criticalDamage: this.#addStat("qc", new Map([[CHARACTERISTIC.CRITICAL_DAMAGE, 1]])),
            critical: this.#statVariableOf(CHARACTERISTIC.CRITICAL),
        };
        const linearizer = new ProductLinearizer(this.#writer);
        const expectedDamageModel = new ExpectedDamageModel({ writer: this.#writer, linearizer, statVariables });
        const damageModel = new DamageModel({
            writer: this.#writer,
            linearizer,
            expectedDamageModel,
            statVariableOf: (characteristic) => this.#statVariableOf(characteristic),
        });
        return damageModel.build({ spellGroups: this.#spellGroups, weapons: this.#buildWeapons() });
    }

    #buildWeapons() {
        return this.#itemModel
            .itemsOfSlot(SLOT.WEAPON)
            .map((item) => ({
                variable: this.#itemModel.variableOf(item),
                action: Action.fromWeapon(item, this.#query.elementKey),
            }))
            .filter(({ action }) => action !== null);
    }
}

module.exports = MilpModelBuilder;
