const LinearExpression = require("./LinearExpression");
const LpWriter = require("./LpWriter");
const ProductLinearizer = require("./ProductLinearizer");
const ItemModel = require("./ItemModel");
const PointModel = require("./PointModel");
const PointAllocator = require("../character/PointAllocator");
const StatBounds = require("./StatBounds");
const StatModel = require("./StatModel");
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
const DAMAGE_STAT_NAMES = Object.freeze({ multiplier: "qm", fixed: "qf", criticalDamage: "qc" });
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
    #statModel;
    #tightenedBounds;
    #statVariables = new Map();
    #hasBuilt = false;

    // spellGroups (Action[][]) and baseStats (Stats before items and points) come from the exact evaluator;
    // callers without one get them from a new StuffEvaluator, so both models always share its definitions.
    // statBounds: Map<stat variable name, { lower, upper }>, valid over every valid stuff (see BoundTightener).
    constructor({ candidates, query, gameData, spellGroups, baseStats, statBounds = new Map() }) {
        this.#candidates = candidates;
        this.#query = query;
        this.#gameData = gameData;
        this.#tightenedBounds = statBounds;
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
        this.#startBuild();
        const criterionModel = this.#buildStuffRules();
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

    // The stuff rules without the damage, plus every stat the damage reads: the model whose LP relaxation
    // BoundTightener explores. stats: [{ name, weights, isIntegral, lower, upper }] with the bounds declared here;
    // an integral stat only takes integer values at integer points.
    buildStructure() {
        this.#startBuild();
        this.#buildStuffRules();
        this.#addDamageStats();
        const stats = this.#statModel.definitions.map((definition) => ({
            ...definition,
            ...this.#writer.boundsOf(definition.name),
        }));
        return { relaxedLpText: this.#writer.toString({ isRelaxed: true }), stats };
    }

    // Every build writes its variables into the one writer of this builder, so a second build would mix two models.
    #startBuild() {
        if (this.#hasBuilt) throw new Error("A MilpModelBuilder builds one model only: create a new builder");
        this.#hasBuilt = true;
    }

    #buildStuffRules() {
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
        this.#statModel = new StatModel({
            writer: this.#writer,
            itemModel: this.#itemModel,
            pointModel: this.#pointModel,
            baseStats: this.#baseStats,
            statBounds: new StatBounds({
                candidates: this.#candidates,
                getSet,
                maxWornBySetId: this.#itemModel.maxWornBySetId,
                allowsExo: (exoKey) => this.#query.allowsExo(exoKey),
            }),
            tightenedBounds: this.#tightenedBounds,
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
        return criterionModel;
    }

    // Heuristic model: the damage is replaced by a linear estimate around a known stuff (see DamageLinearizer),
    // plus a value per AP level chosen by a one-hot, since extra AP allows extra casts.
    #finishLinearModel({ weights, itemValues, apValueOf }) {
        const objective = LinearExpression.ofTerm(this.#statModel.addStat(LINEAR_ESTIMATE_VARIABLE, weights));
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
        const minimums = new Map(this.#listQueryMinimums());
        for (const characteristic of new Set(tracked)) {
            const name = this.#statModel.addStat(`st${characteristic}`, new Map([[characteristic, 1]]), {
                minimum: minimums.get(characteristic),
            });
            this.#statVariables.set(characteristic, name);
        }
    }

    #statVariableOf(characteristic) {
        const variable = this.#statVariables.get(characteristic);
        if (!variable) throw new Error(`Characteristic ${characteristic} is not tracked by the MILP model`);
        return variable;
    }

    #listQueryMinimums() {
        const query = this.#query;
        const minimums = [
            [CHARACTERISTIC.AP, query.minAp],
            [CHARACTERISTIC.MP, query.minMp],
            ...Object.entries(query.minResistances).map(([key, minimum]) => [findElement(key).resistance, minimum]),
        ];
        if (query.minCriticalRate !== null) minimums.push([CHARACTERISTIC.CRITICAL, query.minCriticalRate]);
        return minimums;
    }

    #addQueryConstraints() {
        for (const [characteristic, minimum] of this.#listQueryMinimums()) {
            this.#writer.addConstraint(
                LinearExpression.ofTerm(this.#statVariableOf(characteristic)),
                SENSE.AT_LEAST,
                minimum,
            );
        }
    }

    // multiplier = element + power, fixed = damage + element damage.
    #addDamageStats() {
        const element = this.#element;
        const weightsByStat = {
            multiplier: [element.characteristic, CHARACTERISTIC.POWER],
            fixed: [CHARACTERISTIC.DAMAGE, element.fixedDamage],
            criticalDamage: [CHARACTERISTIC.CRITICAL_DAMAGE],
        };
        const variables = { critical: this.#statVariableOf(CHARACTERISTIC.CRITICAL) };
        for (const [key, characteristics] of Object.entries(weightsByStat)) {
            const weights = new Map(characteristics.map((characteristic) => [characteristic, 1]));
            variables[key] = this.#statModel.addStat(DAMAGE_STAT_NAMES[key], weights);
        }
        return variables;
    }

    #buildDamage() {
        const statVariables = this.#addDamageStats();
        const linearizer = new ProductLinearizer(this.#writer);
        const expectedDamageModel = new ExpectedDamageModel({
            writer: this.#writer,
            linearizer,
            statVariables,
            boundsOfForm: (form, condition) => this.#statModel.boundsOfForm(form, condition),
        });
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
                item,
                variable: this.#itemModel.variableOf(item),
                action: Action.fromWeapon(item, this.#query.elementKey),
            }))
            .filter(({ action }) => action !== null);
    }
}

module.exports = MilpModelBuilder;
