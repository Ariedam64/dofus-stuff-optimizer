const DofusbookLinkEncoder = require("../export/DofusbookLinkEncoder");
const StuffSolver = require("../solver/StuffSolver");
const Action = require("../damage/Action");
const Stats = require("../stats/Stats");
const PointAllocator = require("../character/PointAllocator");
const capCharacteristic = require("../utils/capCharacteristic");
const { CHARACTERISTIC, CHARACTERISTIC_NAMES } = require("../stats/characteristics");
const { SLOT } = require("../data/slots");

const DECIMAL_SCALE = 10;
const NO_EXO = null;
const NO_GAP = null;
const NO_IMAGE = null;
const NO_POINTS = 0;
const DOFUSBOOK_NAME_PREFIX = "Optimiseur";
const { SOLVER_STATUS } = StuffSolver;
// Keys the Dofusbook link encoder expects for each characteristic bought with points.
const LINK_KEYS = Object.freeze({
    [CHARACTERISTIC.VITALITY]: "vi",
    [CHARACTERISTIC.WISDOM]: "sa",
    [CHARACTERISTIC.STRENGTH]: "fo",
    [CHARACTERISTIC.INTELLIGENCE]: "in",
    [CHARACTERISTIC.CHANCE]: "ch",
    [CHARACTERISTIC.AGILITY]: "ag",
});

function roundToOneDecimal(value) {
    return Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE;
}

function mapPointCharacteristics(readValue, keyOf) {
    return Object.fromEntries(PointAllocator.POINT_CHARACTERISTICS.map((id) => [keyOf(id), readValue(id)]));
}

function byName(id) {
    return CHARACTERISTIC_NAMES[id];
}

function byLinkKey(id) {
    return LINK_KEYS[id];
}

class ResultFormatter {
    #query;
    #maxReportedGapPercent;
    #spellImageUrls;
    #linkEncoder = new DofusbookLinkEncoder();

    constructor({ query, gameData, maxReportedGapPercent }) {
        this.#query = query;
        this.#maxReportedGapPercent = maxReportedGapPercent;
        const spells = gameData.getSpellGroups(query.breed, query.level).flat();
        this.#spellImageUrls = new Map(spells.map((spell) => [spell.name, spell.imgUrl ?? NO_IMAGE]));
    }

    formatStuff({ evaluation, solverStatus, optimalityGapPercent }) {
        const items = this.#formatItems(evaluation);
        return {
            score: roundToOneDecimal(evaluation.score),
            ...this.#formatSolverStatus(solverStatus, optimalityGapPercent),
            items,
            stats: this.#formatStats(evaluation.stats),
            pointsAllocation: this.#formatPoints(evaluation.pointsAllocation),
            turn: this.#formatTurn(evaluation),
            assumedCriteria: evaluation.assumedCriteria,
            dofusbookUrl: this.#buildDofusbookUrl(evaluation, items),
        };
    }

    formatItemList(items) {
        return items.map((item) => ({ id: item.id, name: item.name }));
    }

    #formatSolverStatus(solverStatus, optimalityGapPercent) {
        if (solverStatus !== SOLVER_STATUS.GAP) return { solverStatus, optimalityGapPercent };
        if (optimalityGapPercent > this.#maxReportedGapPercent) {
            return { solverStatus: SOLVER_STATUS.HEURISTIC, optimalityGapPercent: NO_GAP };
        }
        return { solverStatus, optimalityGapPercent: roundToOneDecimal(optimalityGapPercent) };
    }

    #formatItems(evaluation) {
        const exoByItemId = new Map(evaluation.exos.map((exo) => [exo.itemId, exo.characteristic]));
        return evaluation.items.map((item) => ({
            slot: item.slot,
            id: item.id,
            name: item.name,
            imgUrl: item.imgUrl ?? NO_IMAGE,
            exo: exoByItemId.get(item.id) ?? NO_EXO,
        }));
    }

    // The evaluation keeps raw totals for item criteria; the sheet shows what the game lets the character use.
    #formatStats(stats) {
        const usableStats = new Stats(stats.ids().map((id) => [id, capCharacteristic(id, stats.get(id))]));
        return Object.fromEntries(Object.entries(usableStats.toNamedObject()).filter(([, value]) => value !== 0));
    }

    #formatPoints({ spentPoints, baseStats, scrollStats }) {
        return {
            spentPoints: mapPointCharacteristics((id) => spentPoints[id] ?? NO_POINTS, byName),
            base: mapPointCharacteristics((id) => baseStats.get(id), byName),
            scrolls: mapPointCharacteristics((id) => scrollStats.get(id), byName),
        };
    }

    #formatTurn(evaluation) {
        const weapon = evaluation.items.find((item) => item.slot === SLOT.WEAPON);
        return evaluation.turn.casts.map((cast) => ({
            name: cast.name,
            kind: cast.kind,
            imgUrl: this.#findCastImageUrl(cast, weapon),
            count: cast.count,
            damagePerCast: roundToOneDecimal(cast.damagePerCast),
        }));
    }

    #findCastImageUrl(cast, weapon) {
        if (cast.kind === Action.KIND.WEAPON) return weapon?.imgUrl ?? NO_IMAGE;
        return this.#spellImageUrls.get(cast.name) ?? NO_IMAGE;
    }

    #buildDofusbookUrl(evaluation, items) {
        const { spentPoints, scrollStats } = evaluation.pointsAllocation;
        return this.#linkEncoder.encode({
            level: this.#query.level,
            breedId: this.#query.breed.id,
            name: `${DOFUSBOOK_NAME_PREFIX} ${this.#query.breed.name} ${Math.round(evaluation.score)}`,
            items: items.map(({ slot, id, exo }) => ({ slot, id, exo })),
            spentPoints: mapPointCharacteristics((id) => spentPoints[id] ?? NO_POINTS, byLinkKey),
            scrolls: mapPointCharacteristics((id) => scrollStats.get(id), byLinkKey),
        });
    }
}

module.exports = ResultFormatter;
