const FIRST_DAMAGE_EFFECT_ID = 91;
const LAST_DAMAGE_EFFECT_ID = 100;

function isDamageEffect(effectId) {
    return effectId >= FIRST_DAMAGE_EFFECT_ID && effectId <= LAST_DAMAGE_EFFECT_ID;
}

module.exports = isDamageEffect;
