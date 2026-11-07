import { chefRound } from './units.js';

/**
 * @typedef {Object} FormattedQuantity
 * @property {string} val The rounded value as a string
 * @property {string} unit The display unit
 */

/**
 * [LOCKED] CORE UNIT FORMATTER
 * Handles unit conversion (metric/imperial) and rounding via chefRound.
 * 
 * @param {number} val Raw value
 * @param {string} [unit=''] Original unit
 * @param {'metric'|'imperial'} [unitSystem='metric'] Current UI unit system
 * @returns {FormattedQuantity}
 */
export function formatQuantity(val, unit = '', unitSystem = 'metric') {
    let displayVal = val;
    let displayUnit = unit || '';
    const uMatch = displayUnit.toLowerCase();
    const isGramUnit = uMatch === 'g' || uMatch === 'gram' || uMatch === 'grams';
    const isKgUnit = /(^|[^a-z])(kg|kilogram|kilograms)([^a-z]|$)/.test(uMatch);
    const isMlUnit = uMatch === 'ml';
    const isLiterUnit = /(^|[^a-z])(l|liter|litre)([^a-z]|$)/.test(uMatch);

    // STEP 3: Validate Unit Input
    const KNOWN_UNITS = [
        'g', 'kg', 'ml', 'l', 'liter', 'litre', 'oz', 'lb', 'fl oz',
        'cup', 'qt', 'portion', 'portions', 'pcs', 'ea', 'tbsp', 'tsp', 'pinch'
    ];

    if (displayUnit && !KNOWN_UNITS.includes(uMatch)) {
        console.warn(`[UNIT] Unknown unit "${displayUnit}" — passing through without conversion`);
    }

    if (typeof val !== 'number' || isNaN(val)) {
        console.warn(`[UNIT] Non-numeric value "${val}" for unit "${displayUnit}"`);
        return { val: String(val || 0), unit: displayUnit };
    }

    if (unitSystem === 'imperial') {
        if (isGramUnit || isKgUnit) {
            let oz = displayVal;
            if (isKgUnit) oz = displayVal * 1000;
            oz = oz * 0.035274;
            if (oz >= 16) {
                displayVal = oz / 16;
                displayUnit = 'lb';
            } else {
                displayVal = oz;
                displayUnit = 'oz';
            }
        } else if (isMlUnit || isLiterUnit) {
            let floz = displayVal;
            if (!isMlUnit) floz = displayVal * 1000;
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
        // Metric auto-scaling in both directions for cleaner kitchen display.
        if (isGramUnit && val >= 1000) {
            displayVal = val / 1000;
            displayUnit = 'kg';
        } else if (isMlUnit && val >= 1000) {
            displayVal = val / 1000;
            displayUnit = 'L';
        } else if (isKgUnit && val > 0 && val < 1) {
            displayVal = val * 1000;
            displayUnit = 'g';
        } else if (isLiterUnit && val > 0 && val < 1) {
            displayVal = val * 1000;
            displayUnit = 'ml';
        }
    }

    const rounded = chefRound(displayVal, displayUnit);

    let valStr = rounded.toString();
    const duLower = displayUnit.toLowerCase().trim();
    if (/^(kg|l|liter|litre|lb|qt)s?$/.test(duLower) || duLower === 'kilogram' || duLower === 'kilograms') {
        valStr = rounded.toFixed(1).replace(/\.0$/, "");
    }

    return { val: valStr, unit: displayUnit };
}

/**
 * Simpler wrapper for display objects
 * @param {number} val 
 * @param {string} unit 
 * @param {'metric'|'imperial'} unitSystem 
 * @returns {{v: string, u: string}}
 */
export function formatDisplay(val, unit, unitSystem = 'metric') {
    const { val: v, unit: u } = formatQuantity(val, unit, unitSystem);
    return { v, u };
}

/**
 * Returns only the formatted value string
 * @param {number} val 
 * @param {string} unit 
 * @param {'metric'|'imperial'} unitSystem 
 * @returns {string}
 */
export function formatValue(val, unit, unitSystem = 'metric') {
    const { val: v } = formatQuantity(val, unit, unitSystem);
    return v;
}
