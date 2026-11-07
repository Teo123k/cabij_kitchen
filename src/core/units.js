/**
 * @typedef {Object} RoundingConfig
 * @property {number} volumeFocus Current production scale
 */

/**
 * [LOCKED] CORE ROUNDING LOGIC - DO NOT MODIFY WITHOUT AUDIT
 * Implements professional kitchen rounding (the 0/5 rule for small units, 0.5 for bulk)
 * 
 * @param {number} val The raw mathematical value
 * @param {string} [unit=''] The unit to determine rounding strategy
 * @returns {number} The rounded value safe for kitchen production
 */
export function chefRound(val, unit = '') {
    if (val === undefined || val === null || isNaN(val) || val <= 0) return 0;
    const u = (unit || '').toLowerCase();

    // 1. Bulk Units (kg, L, Liter, lb, qt) - 0.5 steps
    if (/^(kg|l|liter|litre|lb|qt)s?$/.test(u) || u === 'kilogram' || u === 'kilograms') {
        const r = Math.round(val * 10) / 10;
        return r > 0 ? r : Math.ceil(val * 10) / 10;
    }

    // 1.5 Medium Imperial Units (oz, fl oz, cup) - 0.25 steps (quarter increments)
    if (/^(oz|fl oz|cup)s?$/.test(u)) {
        const fraction = Math.round(val * 4) / 4;
        return fraction > 0 ? fraction : Math.round(val * 10) / 10;
    }

    // 2. Small Units (g, ml) - 0 / 5 rule
    if (val < 1) return Math.ceil(val * 10) / 10;   // 0.09 -> 0.1
    if (val < 5) return Math.round(val * 2) / 2;     // 1.44 -> 1.5
    if (val < 10) return Math.round(val);             // 8.2 -> 8
    return Math.round(val / 5) * 5;                   // 104 -> 105, 39 -> 40
}
/**
 * Centralized formatting for kitchen units, supporting auto-scaling and Imperial conversions.
 */
export function formatQuantity(val, unit = '', imperialMode = false) {
    if (val === undefined || val === null) return { val: '0', unit };
    let displayVal = val;
    let displayUnit = unit || '';
    const uMatch = displayUnit.toLowerCase().trim();

    if (imperialMode) {
        if (uMatch === 'g' || uMatch === 'kg') {
            let oz = displayVal;
            if (uMatch === 'kg') oz = displayVal * 1000;
            oz = oz * 0.035274;
            if (oz >= 16) {
                displayVal = oz / 16;
                displayUnit = 'lb';
            } else {
                displayVal = oz;
                displayUnit = 'oz';
            }
        } else if (uMatch === 'ml' || uMatch === 'l' || uMatch === 'liter') {
            let floz = displayVal;
            if (uMatch !== 'ml') floz = displayVal * 1000;
            floz = floz * 0.033814;
            if (floz >= 32) {
                displayVal = floz / 32;
                displayUnit = 'qt';
            } else if (floz >= 8) {
                displayVal = floz / 8;
                displayUnit = 'cup';
            } else {
                displayVal = floz;
                displayUnit = 'fl oz';
            }
        }
    } else {
        // Auto-scale units for metric readability
        if (uMatch === 'g' && val >= 1000) {
            displayVal = val / 1000;
            displayUnit = 'kg';
        } else if (uMatch === 'ml' && val >= 1000) {
            displayVal = val / 1000;
            displayUnit = 'L';
        }
    }

    const rounded = chefRound(displayVal, displayUnit);
    let valStr = rounded.toString();
    const duLower = displayUnit.toLowerCase();
    if (['kg', 'l', 'lb', 'qt'].some(u => duLower.includes(u))) {
        valStr = rounded.toFixed(1).replace(/\.0$/, "");
    }
    return { val: valStr, unit: displayUnit };
}

export function toGrams(qty, unit = '') {
    const val = parseFloat(qty) || 0;
    const u = (unit || '').toLowerCase().trim();
    if (/^(kg|l|liter|litre|kilogram)s?$/.test(u)) return val * 1000;
    if (u === 'oz') return val * 28.3495;
    if (u === 'lb') return val * 453.592;
    if (u === 'cup') return val * 240;
    if (u === 'tbsp') return val * 15;
    if (u === 'tsp') return val * 5;
    return val;
}

export function getRecipeBaselineGrams(recipe, usePortions = false, settings = {}) {
    if (!recipe) return 0;
    const explicitBatchYield = parseFloat(
        recipe.batchYield
        ?? recipe.batch_yield
        ?? recipe.productionBatchSize
        ?? recipe.production_batch_size
    ) || 0;
    if (explicitBatchYield > 0) {
        return toGrams(explicitBatchYield, recipe.unit);
    }
    const base = toGrams(recipe.baseYield, recipe.unit);
    if (base > 0) return base;
    const sum = (recipe.ingredients || []).reduce((acc, ing) => {
        return acc + toGrams(ing.qty, ing.unit);
    }, 0);
    return sum || 1000;
}
