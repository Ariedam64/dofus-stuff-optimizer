const SLOT = Object.freeze({
    WEAPON: "weapon",
    SHIELD: "shield",
    AMULET: "amulet",
    RING: "ring",
    BELT: "belt",
    BOOTS: "boots",
    HAT: "hat",
    CAPE: "cape",
    MOUNT: "mount",
    DOFUS: "dofus",
});

const SLOT_CAPACITIES = Object.freeze({
    [SLOT.WEAPON]: 1,
    [SLOT.SHIELD]: 1,
    [SLOT.AMULET]: 1,
    [SLOT.RING]: 2,
    [SLOT.BELT]: 1,
    [SLOT.BOOTS]: 1,
    [SLOT.HAT]: 1,
    [SLOT.CAPE]: 1,
    [SLOT.MOUNT]: 1,
    [SLOT.DOFUS]: 6,
});

const TYPE_ID_SLOTS = Object.freeze({
    1: SLOT.AMULET,
    9: SLOT.RING,
    10: SLOT.BELT,
    11: SLOT.BOOTS,
    16: SLOT.HAT,
    17: SLOT.CAPE,
    18: SLOT.MOUNT,
    121: SLOT.MOUNT,
    331: SLOT.MOUNT,
    332: SLOT.MOUNT,
    333: SLOT.MOUNT,
    82: SLOT.SHIELD,
    23: SLOT.DOFUS,
    151: SLOT.DOFUS,
    217: SLOT.DOFUS,
    2: SLOT.WEAPON,
    3: SLOT.WEAPON,
    4: SLOT.WEAPON,
    5: SLOT.WEAPON,
    6: SLOT.WEAPON,
    7: SLOT.WEAPON,
    8: SLOT.WEAPON,
    19: SLOT.WEAPON,
    22: SLOT.WEAPON,
    114: SLOT.WEAPON,
    271: SLOT.WEAPON,
});

const PRYSMARADITE_TYPE_ID = 217;
const MAX_PRYSMARADITES = 1;

module.exports = { SLOT, SLOT_CAPACITIES, TYPE_ID_SLOTS, PRYSMARADITE_TYPE_ID, MAX_PRYSMARADITES };
