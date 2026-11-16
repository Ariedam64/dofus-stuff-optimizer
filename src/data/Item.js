const Stats = require("../stats/Stats");
const isDamageEffect = require("../utils/isDamageEffect");
const { SLOT, TYPE_ID_SLOTS, PRYSMARADITE_TYPE_ID } = require("./slots");
const { EXO_CHARACTERISTICS } = require("./exos");

const NO_SET_ID = -1;
const EXO_CHARACTERISTIC_IDS = Object.values(EXO_CHARACTERISTICS);

class Item {
    id;
    name;
    typeId;
    slot;
    level;
    setId;
    criterion;
    stats;
    weapon;
    imgUrl;

    constructor({ id, name, typeId, slot, level, setId, criterion, stats, weapon, imgUrl = null }) {
        this.id = id;
        this.name = name;
        this.typeId = typeId;
        this.slot = slot;
        this.level = level;
        this.setId = setId;
        this.criterion = criterion;
        this.stats = stats;
        this.weapon = weapon;
        this.imgUrl = imgUrl;
    }

    get isTwoHanded() {
        return this.weapon?.isTwoHanded === true;
    }

    get isPrysmaradite() {
        return this.typeId === PRYSMARADITE_TYPE_ID;
    }

    // A ring takes an AP or MP exo only when it does not already give that characteristic.
    canTakeExo(characteristic) {
        if (this.slot !== SLOT.RING || !EXO_CHARACTERISTIC_IDS.includes(characteristic)) return false;
        return !(this.stats.get(characteristic) > 0);
    }

    static fromDofusDb(raw) {
        const effects = raw.effects ?? [];
        const slot = TYPE_ID_SLOTS[raw.typeId];
        const stats = Stats.fromDofusDbEffects(effects);
        return new Item({
            id: raw.id,
            name: raw.name.fr,
            typeId: raw.typeId,
            slot,
            level: raw.level,
            setId: raw.itemSetId === NO_SET_ID ? null : raw.itemSetId,
            criterion: raw.criterions ?? "",
            stats,
            imgUrl: raw.img ?? null,
            weapon: slot === SLOT.WEAPON ? Item.#buildWeapon(raw, effects) : null,
        });
    }

    static #buildWeapon(raw, effects) {
        return {
            apCost: raw.apCost,
            minRange: raw.minRange,
            range: raw.range,
            criticalRate: raw.criticalHitProbability,
            criticalBonus: raw.criticalHitBonus,
            maxCastPerTurn: raw.maxCastPerTurn,
            isTwoHanded: raw.twoHanded === true,
            damageLines: effects
                .filter((effect) => isDamageEffect(effect.effectId))
                .map((effect) => ({ effectId: effect.effectId, min: effect.from, max: effect.to || effect.from })),
        };
    }
}

module.exports = Item;
