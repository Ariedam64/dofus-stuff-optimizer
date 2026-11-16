"use strict";

const GAP_FRACTION_DIGITS = 1;
const DAMAGE_FRACTION_DIGITS = 0;
const RESISTANCE_ELEMENT_ORDER = ["neutral", "earth", "fire", "water", "air"];
// The gap is (best possible bound - score) / bound, so it compares the stuff with the best possible damage.
const SOLVER_BADGES = Object.freeze({
    optimal: {
        className: "badge-optimal",
        describe: () => "optimal prouvé",
        explain: () => "HiGHS a prouvé qu'aucun stuff ne fait mieux sous ces contraintes.",
    },
    gap: {
        className: "badge-gap",
        describe: (gapText) => `écart \u2264 ${gapText}\u00A0%`,
        explain: (gapText) => `Dégâts à au plus ${gapText}\u00A0% du meilleur possible.`,
    },
    heuristic: {
        className: "badge-heuristic",
        describe: () => "non prouvé",
        explain: () => "Trouvé sans preuve d'optimalité.",
    },
});

// One result card: damage, solver proof, 16 positions, key stats, points and turn combo.
class StuffCard {
    #stuff;
    #element;
    #root;
    #rankLabel;

    constructor({ stuff, element }) {
        this.#stuff = stuff;
        this.#element = element;
        this.#rankLabel = createElement("span", { className: "card-rank" });
        this.#root = createElement("li", { className: "stuff-card" }, [
            this.#buildHeader(),
            this.#buildItemIcons(),
            this.#buildKeyStats(),
            this.#buildResistances(),
            this.#buildPointsLine(),
            this.#buildTurn(),
            ...this.#buildAssumedCriteria(),
            ...this.#buildDofusbookFooter(),
        ]);
    }

    get root() {
        return this.#root;
    }

    get isProvenOptimal() {
        return this.#stuff.solverStatus === "optimal";
    }

    get score() {
        return this.#stuff.score;
    }

    set rank(value) {
        this.#rankLabel.textContent = `#${value}`;
    }

    #buildHeader() {
        const damage = createElement("span", { className: "card-damage" }, [
            createElement("strong", { text: formatNumber(this.#stuff.score, DAMAGE_FRACTION_DIGITS) }),
            " dégâts / tour",
        ]);
        return createElement("header", { className: "card-header" }, [
            this.#rankLabel,
            damage,
            this.#buildSolverBadge(),
        ]);
    }

    #buildSolverBadge() {
        const badge = SOLVER_BADGES[this.#readShownStatus()];
        const gapText = formatNumber(this.#stuff.optimalityGapPercent, GAP_FRACTION_DIGITS);
        return createElement("span", {
            className: `badge ${badge.className}`,
            text: badge.describe(gapText),
            attributes: { title: badge.explain(gapText) },
        });
    }

    // A gap without its value, or an unknown status, proves nothing.
    #readShownStatus() {
        const { solverStatus, optimalityGapPercent } = this.#stuff;
        if (solverStatus === "gap" && !Number.isFinite(optimalityGapPercent)) return "heuristic";
        return Object.hasOwn(SOLVER_BADGES, solverStatus) ? solverStatus : "heuristic";
    }

    #buildItemIcons() {
        const remainingItems = [...this.#stuff.items];
        const positions = POSITION_SLOTS.map((slot) => {
            const item = remainingItems.find((candidate) => candidate.slot === slot);
            if (!item) return this.#buildEmptyPosition(slot);
            remainingItems.splice(remainingItems.indexOf(item), 1);
            return this.#buildItemIcon(item);
        });
        return createElement("div", { className: "item-icons" }, positions);
    }

    #buildItemIcon(item) {
        const exoLabel = EXO_LABELS[item.exo];
        const tooltip = exoLabel ? `${item.name} (exo ${exoLabel})` : item.name;
        const classNames = ["item-position", item.exo ? `exo-${item.exo}` : ""].filter(Boolean).join(" ");
        const attributes = { "data-tooltip": tooltip, "aria-label": tooltip, role: "img", tabindex: "0" };
        const children = [createIcon(item.imgUrl, { className: "item-icon" })];
        if (exoLabel) children.push(createElement("span", { className: "exo-tag", text: exoLabel }));
        return createElement("span", { className: classNames, attributes }, children);
    }

    #buildEmptyPosition(slot) {
        const tooltip = `${SLOT_LABELS[slot]} : emplacement vide`;
        return createElement("span", {
            className: "item-position is-empty",
            attributes: { "data-tooltip": tooltip, "aria-label": tooltip, role: "img", tabindex: "0" },
        });
    }

    #buildKeyStats() {
        const { stats } = this.#stuff;
        const elementStat = ELEMENT_CHARACTERISTICS[this.#element.key];
        const entries = [
            ["PA", stats.ap],
            ["PM", stats.mp],
            [CHARACTERISTIC_LABELS[elementStat], stats[elementStat]],
            ["Puissance", stats.power],
            [`Do ${this.#element.label}`, stats[`${this.#element.key}Damage`]],
            ["Critique", stats.critical, "\u00A0%"],
            ["Do crit", stats.criticalDamage],
        ];
        const items = entries.map(([label, value = 0, suffix = ""]) =>
            createElement("li", { className: "key-stat" }, [
                createElement("strong", { text: `${formatNumber(value)}${suffix}` }),
                createElement("span", { text: label }),
            ]),
        );
        return createElement("ul", { className: "key-stats" }, items);
    }

    #buildResistances() {
        const parts = RESISTANCE_ELEMENT_ORDER.map((elementKey) => {
            const value = this.#stuff.stats[`${elementKey}Resistance`] ?? 0;
            return createElement(
                "span",
                { className: "resistance-value", attributes: { "data-element": elementKey } },
                [`${formatNumber(value)}\u00A0%`],
            );
        });
        return createElement("p", { className: "card-line resistances-line" }, [
            createElement("span", { className: "card-line-label", text: "Rés." }),
            ...parts,
        ]);
    }

    #buildPointsLine() {
        const { spentPoints = {}, base = {}, scrolls = {} } = this.#stuff.pointsAllocation ?? {};
        const totalSpent = Object.values(spentPoints).reduce((sum, points) => sum + points, 0);
        const spentStats = Object.keys(CHARACTERISTIC_LABELS).filter((stat) => spentPoints[stat] > 0);
        const details = spentStats.map((stat) => `${CHARACTERISTIC_LABELS[stat]} ${formatNumber(base[stat] ?? 0)}`);
        const summary =
            totalSpent > 0 ? `${formatNumber(totalSpent)} pts : ${details.join(" \u00B7 ")}` : "aucun point";
        const children = [createElement("span", { className: "card-line-label", text: "Points" }), summary];
        const scrollValues = Object.values(scrolls).filter((value) => value > 0);
        if (scrollValues.length > 0) {
            const scrollText = ` \u00B7 parchemins +${formatNumber(Math.max(...scrollValues))}`;
            children.push(createElement("span", { className: "muted", text: scrollText }));
        }
        return createElement("p", { className: "card-line points-line" }, children);
    }

    #buildTurn() {
        const casts = this.#stuff.turn.map((cast) => {
            const damage = formatNumber(cast.damagePerCast, DAMAGE_FRACTION_DIGITS);
            const tooltip = `${cast.name} : ${damage} dégâts par lancer`;
            return createElement(
                "li",
                { className: `cast cast-${cast.kind}`, attributes: { "data-tooltip": tooltip, tabindex: "0" } },
                [
                    createIcon(cast.imgUrl, { className: "cast-icon", alt: cast.name }),
                    createElement("span", { className: "cast-count", text: `\u00D7${cast.count}` }),
                    createElement("span", { className: "cast-damage", text: damage }),
                ],
            );
        });
        return createElement("div", { className: "card-line turn-line" }, [
            createElement("span", { className: "card-line-label", text: "Tour" }),
            createElement("ul", { className: "casts" }, casts),
        ]);
    }

    #buildAssumedCriteria() {
        const { assumedCriteria = [], items } = this.#stuff;
        if (assumedCriteria.length === 0) return [];
        const names = assumedCriteria.map(({ itemId, atoms = [] }) => {
            const name = items.find((item) => item.id === itemId)?.name ?? `item ${itemId}`;
            return atoms.length > 0 ? `${name} (${atoms.join(", ")})` : name;
        });
        const text = `Conditions supposées remplies : ${names.join(", ")}`;
        return [createElement("p", { className: "card-line assumed-line", text })];
    }

    #buildDofusbookFooter() {
        const dofusbookUrl = toSafeUrl(this.#stuff.dofusbookUrl);
        if (!dofusbookUrl) return [];
        const link = createElement("a", {
            className: "button button-dofusbook",
            text: "Voir sur Dofusbook \u2197",
            attributes: { href: dofusbookUrl, target: "_blank", rel: "noopener noreferrer" },
        });
        const note = createElement("span", {
            className: "dofusbook-note",
            text: "remplace ton brouillon local Dofusbook",
        });
        return [createElement("footer", { className: "card-footer" }, [note, link])];
    }
}
