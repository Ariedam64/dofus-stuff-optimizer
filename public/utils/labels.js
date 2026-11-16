"use strict";

const SLOT_LABELS = Object.freeze({
    weapon: "Arme",
    shield: "Bouclier",
    hat: "Coiffe",
    amulet: "Amulette",
    ring: "Anneau",
    belt: "Ceinture",
    cape: "Cape",
    boots: "Bottes",
    mount: "Monture",
    dofus: "Dofus / trophée",
});

const POSITION_SLOTS = Object.freeze([
    "weapon",
    "shield",
    "hat",
    "amulet",
    "ring",
    "ring",
    "belt",
    "cape",
    "boots",
    "mount",
    "dofus",
    "dofus",
    "dofus",
    "dofus",
    "dofus",
    "dofus",
]);

const CHARACTERISTIC_LABELS = Object.freeze({
    vitality: "Vitalité",
    wisdom: "Sagesse",
    strength: "Force",
    intelligence: "Intelligence",
    chance: "Chance",
    agility: "Agilité",
});

const ELEMENT_CHARACTERISTICS = Object.freeze({
    water: "chance",
    earth: "strength",
    neutral: "strength",
    fire: "intelligence",
    air: "agility",
});

const EXO_LABELS = Object.freeze({ ap: "PA", mp: "PM" });
