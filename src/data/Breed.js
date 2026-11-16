class Breed {
    id;
    name;
    variantPairs;
    headUrl;

    constructor({ id, name, variantPairs, headUrl = null }) {
        this.id = id;
        this.name = name;
        this.variantPairs = variantPairs;
        this.headUrl = headUrl;
    }

    static fromDofusDb(raw, spellVariants) {
        return new Breed({
            id: raw.id,
            name: raw.shortName.fr,
            variantPairs: spellVariants
                .filter((variant) => variant.breedId === raw.id)
                .map((variant) => variant.spellIds),
            headUrl: raw.heads?.male ?? null,
        });
    }
}

module.exports = Breed;
