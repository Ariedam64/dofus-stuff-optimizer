const QueryError = require("../optimizer/QueryError");
const { MAX_AP, MAX_MP } = require("../config");

const { CODE } = QueryError;
const ELEMENT_LABELS = Object.freeze({ neutral: "Neutre", earth: "Terre", fire: "Feu", water: "Eau", air: "Air" });
const SLOT_LABELS = Object.freeze({
    weapon: "arme",
    shield: "bouclier",
    hat: "coiffe",
    amulet: "amulette",
    ring: "anneau",
    belt: "ceinture",
    cape: "cape",
    boots: "bottes",
    mount: "monture",
    dofus: "dofus / trophée",
});
const FIELD_LABELS = Object.freeze({
    root: "la requête",
    breed: "la classe",
    level: "le niveau",
    profile: "le profil",
    "profile.elements": "l'élément",
    "profile.minCriticalRate": "le critique minimum",
    constraints: "les contraintes",
    "constraints.minAp": "les PA minimum",
    "constraints.minMp": "les PM minimum",
    "constraints.minResistances": "les résistances minimum",
    "constraints.excludedItemIds": "les objets exclus",
    "constraints.requiredItemIds": "les objets imposés",
    allowRingExos: "les exos d'anneau",
    ringExos: "les exos d'anneau",
    "ringExos.ap": "l'exo PA des anneaux",
    "ringExos.mp": "l'exo PM des anneaux",
    resultCount: "le nombre de stuffs",
    topCount: "le nombre de stuffs",
    useScrolls: "les parchemins",
    diversity: "la diversité",
    "diversity.minDifferentItems": "la diversité",
    timeLimitMs: "la durée max (en ms)",
});
const SINGLE_PLACE = 1;
const MESSAGE_BUILDERS = Object.freeze({
    [CODE.INVALID_BODY]: () => "La requête n'est pas un JSON valide.",
    [CODE.BODY_TOO_LARGE]: () => "La requête est trop volumineuse.",
    [CODE.INVALID_FIELD]: ({ field, min, max }) => {
        const range = min === undefined ? "" : ` (attendu : un entier entre ${min} et ${max})`;
        return `Valeur invalide pour ${FIELD_LABELS[field] ?? `« ${field} »`}${range}.`;
    },
    [CODE.UNKNOWN_FIELD]: ({ field }) => `Champ inconnu dans la requête : « ${field} ».`,
    [CODE.ABOVE_GAME_CAP]: ({ field, max }) => {
        const label = FIELD_LABELS[field] ?? `« ${field} »`;
        return `Le jeu limite à ${MAX_AP} PA et ${MAX_MP} PM : ${label} ne peuvent pas dépasser ${max}.`;
    },
    [CODE.UNKNOWN_BREED]: ({ name }) => `Classe inconnue : « ${name} ».`,
    [CODE.UNKNOWN_REQUIRED_ITEM]: ({ itemId }) =>
        `L'objet imposé n°${itemId} est introuvable ou ne s'équipe pas. Retire-le de la liste.`,
    [CODE.REQUIRED_ITEM_ABOVE_LEVEL]: ({ itemName, itemLevel, level }) =>
        `L'objet imposé ${itemName} (niveau ${itemLevel}) est au-dessus du niveau du personnage (${level}).`,
    [CODE.TOO_MANY_REQUIRED_ITEMS]: ({ slot, count, capacity }) => {
        const places = capacity === SINGLE_PLACE ? "place" : "places";
        return `${count} objets imposés pour l'emplacement ${SLOT_LABELS[slot] ?? slot}, qui n'a que ${capacity} ${places}.`;
    },
    [CODE.TOO_MANY_REQUIRED_PRYSMARADITES]: ({ count, max }) =>
        `${count} prysmaradites imposées : on peut en équiper au plus ${max}.`,
    [CODE.REQUIRED_SHIELD_WITH_TWO_HANDED_WEAPON]: ({ weaponName, shieldName }) =>
        `L'arme imposée ${weaponName} se tient à deux mains : elle ne peut pas aller avec le bouclier imposé ${shieldName}.`,
    [CODE.NO_DAMAGE_ACTION]: ({ breedName, level, elementKey, ignoredSpellNames = [] }) => {
        const element = (ELEMENT_LABELS[elementKey] ?? elementKey).toLowerCase();
        const ignored = ignoredSpellNames.length > 0 ? ` Sorts ignorés : ${ignoredSpellNames.join(", ")}.` : "";
        return `Aucun sort ni arme ne fait de dégâts ${element} pour ${breedName} au niveau ${level}.${ignored}`;
    },
});

// French text shown on the page for an error; an error without a known code keeps its technical message.
function toFrenchMessage(error) {
    if (!Object.hasOwn(MESSAGE_BUILDERS, error.code)) return `Erreur interne du serveur : ${error.message}`;
    return MESSAGE_BUILDERS[error.code](error.details ?? {});
}

module.exports = { ELEMENT_LABELS, toFrenchMessage };
