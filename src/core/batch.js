import { resolveRecipeId } from './sku.js';
import { formatQuantity, chefRound } from './units.js';
import { flattenRecipe } from './bom_engine.js';
import { db } from './persistence.js';

/**
 * @typedef {Object} BatchSettings
 * @property {number} mainPortionSize
 * @property {number} sidePortionSize
 * @property {number} starterPortionSize
 * @property {number} portionsPerBatch
 */

/**
 * Calculates the multiplier for scaling quantities.
 * @param {number} targetValue 
 * @param {number} baseYield 
 * @returns {number}
 */
export function getMultiplier(targetValue, baseYield) {
    if (!baseYield || baseYield <= 0) return 0;
    return targetValue / baseYield;
}

/**
 * Intelligent weight calculation based on recipe metadata and global settings.
 * 
 * @param {Object} recipe 
 * @param {BatchSettings} settings 
 * @param {Array<Object>} allRecipes
 * @returns {number} The weight in grams/ml
 */
/**
 * Centralized detection for sauces, preps, and component recipes.
 */
export function isSauceLikeRecipe(recipe) {
    if (!recipe) return false;
    const style = (recipe.dishStyle || recipe.style || '').toLowerCase();
    const cat = (recipe.dishCategory || '').toLowerCase();
    const name = (recipe.name || '').toLowerCase();

    return ['sauce', 'glaze', 'marinade', 'coating', 'paste', 'dip', 'prep', 'base', 'stock', 'component'].includes(style) ||
        ['condiment', 'sauce', 'topping', 'base', 'stock', 'prep', 'component'].includes(cat) ||
        name.includes('sauce') || name.includes('marinade') || name.includes('roux') || name.includes('base') || name.includes('master') || name.includes('paste') || name.includes('prep');
}

/**
 * Normalizes recipe category into a standard enum:
 * 'side', 'starter', 'main', 'component', or 'other'.
 */
export function getRecipeCategory(recipe) {
    if (!recipe) return 'other';
    const style = (recipe.dishStyle || recipe.style || '').toLowerCase();
    const cat = (recipe.dishCategory || '').toLowerCase();
    const name = (recipe.name || '').toLowerCase();

    if (
        ['marinade', 'sauce', 'base', 'prep', 'stock', 'flour mix', 'component'].includes(style) ||
        ['marinade', 'sauce', 'base', 'prep', 'stock', 'component'].includes(cat) ||
        name.includes('marinade') || name.includes('sauce') || name.includes('base') || name.includes('prep') || name.includes('stock') || name.includes('roux')
    ) return 'component';

    if (['side', 'snack', 'pickle'].includes(cat) || style === 'side' || name.includes('kimchi')) return 'side';
    if (['appetizer', 'starter', 'salad'].includes(cat) || style === 'starter') return 'starter';
    if (
        ['main', 'main_course', 'stew', 'curry', 'soup'].includes(cat) ||
        ['main', 'stew', 'curry', 'soup'].includes(style) ||
        name.includes('stew') || name.includes('curry') || name.includes('soup')
    ) return 'main';
    return 'other';
}

/**
 * Gets the canonical yield weight (output) of one full batch.
 */
export function getCanonicalBatchYield(recipe) {
    if (!recipe) return 0;
    const explicitBatchYield = parseFloat(
        recipe.batchYield
        ?? recipe.batch_yield
        ?? recipe.productionBatchSize
        ?? recipe.production_batch_size
    ) || 0;
    if (explicitBatchYield > 0) return explicitBatchYield;

    const bYield = parseFloat(recipe.baseYield) || 0;
    const unit = (recipe.unit || '').toLowerCase().trim();
    const explicitMassYield =
        /^(kg|l|liter|litre|kilogram)s?$/.test(unit) || unit === 'kilogram' || unit === 'kilograms'
            ? bYield * 1000
            : (/^(g|ml|gram|grams|milliliter|millilitre|milliliters|millilitres)s?$/.test(unit) ? bYield : 0);

    if (explicitMassYield > 0) return explicitMassYield;

    // Sauce Fallback: If no reliable unit, but it's a sauce, use the natural sum of ingredients
    if (isSauceLikeRecipe(recipe)) {
        const sum = (recipe.ingredients || []).reduce((acc, ing) => {
            let qty = parseFloat(ing.qty) || 0;
            const u = (ing.unit || '').toLowerCase();
            if (/^(kg|l|liter|litre|kilogram)s?$/.test(u)) qty *= 1000;
            return acc + qty;
        }, 0);
        if (sum > 0) return sum;
    }

    return 0; // cannot guess reliably
}

/**
 * Gets the canonical size of a single serving in grams.
 * Phase 2A Isolation: Prioritizes user settings and explicit contracts.
 */
export function getCanonicalServingSize(recipe, settings = {}, allRecipes = []) {
    // 0. Primary Category Authority (User Settings) - Phase 2B absolute top
    const defaults = {
        main: settings.mainPortionSize || 295,
        side: settings.sidePortionSize || 80,
        starter: settings.starterPortionSize || 165,
        prep: 1000
    };

    if (!recipe) return defaults.main;

    const category = getRecipeCategory(recipe);
    const style = (recipe.dishStyle || recipe.style || '').toLowerCase();
    const name = (recipe.name || '').toLowerCase();
    if (category === 'side') return defaults.side;
    if (category === 'starter') return defaults.starter;
    if (category === 'main') return defaults.main;
    
    // 1. Explicit Yield Contract (Portioned mode in DB)
    if (recipe.yieldMode === 'portioned' && recipe.servingSize) {
        return parseFloat(recipe.servingSize);
    }

    // 2. Explicit Physical Portion Size Field
    if (recipe.portionSize) {
        let ps = parseFloat(recipe.portionSize);
        const unit = (recipe.unit || '').toLowerCase();
        if (ps < 5 && /(kg|l|liter|litre|kilogram)/i.test(unit)) ps *= 1000;
        return ps;
    }

    // 3. Professional Serving Kind Overrides
    const servingKind = (recipe.serving_kind || '').toLowerCase();
    if (servingKind === 'dip') return settings.portionWeightDip || 50;
    if (servingKind === 'coating') return 50;
    if (servingKind === 'marinade') return settings.portionWeightMarinade || 110;
    if (servingKind === 'main_sauce') return settings.portionWeightSauce || settings.portionWeightDip || 50;
    if (servingKind === 'component_batch' || servingKind === 'batch') return 1000;

    // 4. Component Heuristics (as fallback only)
    if (isSauceLikeRecipe(recipe)) {
        if (style === 'dip' || name.includes('dip')) return settings.portionWeightDip || 50;
        if (style === 'coating' || name.includes('coating')) return 50;
        if (style === 'marinade' || name.includes('marinade')) return settings.portionWeightMarinade || 110;
        if (style === 'sauce' || name.includes('sauce')) return settings.portionWeightSauce || settings.portionWeightDip || 50;
        return settings.portionWeightComponent || defaults.prep;
    }

    return defaults.main;
}

/**
 * Returns the portion count at scale=1 for a recipe.
 */
export function getCanonicalPortionCount(recipe, settings = {}, allRecipes = []) {
    if (!recipe) return settings.portionsPerBatch || 6;
    
    const bYield = getCanonicalBatchYield(recipe);
    const sSize = getCanonicalServingSize(recipe, settings, allRecipes);
    
    // If we have a physical mass yield, portion count is mass / grams per portion
    if (bYield > 0 && sSize > 0) return bYield / sSize;

    // Legacy fallback for strictly portion-based units
    const unit = (recipe.unit || '').toLowerCase();
    if (/^(portion|portions|pcs|each|pax)s?$/.test(unit)) return parseFloat(recipe.baseYield) || 1;
    
    return settings.portionsPerBatch || 6;
}

/**
 * Intelligent weight calculation.
 */
export function getPortionWeight(recipe, settings = {}, allRecipes = []) {
    return getCanonicalServingSize(recipe, settings, allRecipes);
}

const PORTION_CLASS_DEFAULTS = {
    stew: 380,
    meat_stir_fry: 295,
    veg_stir_fry: 280,
    curry: 350,
    carb: 295,
    main_carb: 420,
    side: 80,
    salad: 165,
    marinade: 110,
    component: 80
};

const PORTION_CLASS_SETTING_KEYS = {
    stew: 'portionWeightStew',
    meat_stir_fry: 'portionWeightMeatStirFry',
    veg_stir_fry: 'portionWeightVegStirFry',
    curry: 'portionWeightCurry',
    carb: 'portionWeightCarb',
    main_carb: 'portionWeightMainCarb',
    side: 'portionWeightSide',
    salad: 'portionWeightSalad',
    marinade: 'portionWeightMarinade',
    component: 'portionWeightComponent'
};

const NON_PLATED_PORTION_CLASSES = new Set(['prep', 'sauce']);

export function getRecipePortionWeight(recipe, settings = {}, allRecipes = []) {
    if (!recipe) return getPortionWeight(recipe, settings, allRecipes);

    const recordedWeight = parseFloat(recipe.recorded_serving_weight ?? recipe.recordedServingWeight);
    const recordedUnit = (recipe.recorded_serving_unit || recipe.recordedServingUnit || 'g').toLowerCase().trim();
    if (!isNaN(recordedWeight) && recordedWeight > 0) {
        if (/^(kg|l|liter|litre|kilogram)s?$/.test(recordedUnit)) return recordedWeight * 1000;
        return recordedWeight;
    }

    const portionClass = (recipe.portion_class || recipe.portionClass || '').toLowerCase().trim();
    if (portionClass && NON_PLATED_PORTION_CLASSES.has(portionClass)) return null;

    const settingKey = PORTION_CLASS_SETTING_KEYS[portionClass];
    if (settingKey) {
        const settingVal = parseFloat(settings?.[settingKey]);
        if (!isNaN(settingVal) && settingVal > 0) return settingVal;
        return PORTION_CLASS_DEFAULTS[portionClass];
    }

    return getPortionWeight(recipe, settings, allRecipes);
}

/**
 * Gets the physical grams/ml represented by one source-truth portion of a recipe.
 * This is distinct from display/unit helpers like getPortionSize().
 */
export function getPhysicalPortionWeight(recipe, settings = {}, allRecipes = []) {
    if (!recipe) return 0;

    let canonicalBatchYield = getCanonicalBatchYield(recipe);
    const canonicalPortionCount = getCanonicalPortionCount(recipe, settings, allRecipes);

    if (canonicalBatchYield <= 0) {
        canonicalBatchYield = (recipe.ingredients || []).reduce((acc, ing) => {
            let qty = parseFloat(ing.qty) || 0;
            const unit = (ing.unit || '').toLowerCase();
            if (/^(kg|l|liter|litre|kilogram)s?$/.test(unit)) qty *= 1000;
            return acc + qty;
        }, 0);
    }

    if (canonicalBatchYield > 0 && canonicalPortionCount > 0) {
        return canonicalBatchYield / canonicalPortionCount;
    }

    return getRecipePortionWeight(recipe, settings, allRecipes) || getPortionWeight(recipe, settings, allRecipes);
}

/**
 * Determines whether to use 1 (for portion-based units) or portion weight.
 */
export function getPortionSize(recipe, settings = {}, allRecipes = []) {
    if (!recipe) return settings.mainPortionSize || 295;
    const unit = (recipe.unit || '').toLowerCase();
    const weight = getPortionWeight(recipe, settings, allRecipes);

    if (unit.includes('portion')) return 1;

    // Normalize: if the recipe's unit is kg/L, the portion size must be in kg/L
    const isBulkMetric = /^(kg|l|liter|litre)s?$/.test(unit) || unit === 'kilogram' || unit === 'kilograms';
    if (isBulkMetric) {
        return weight / 1000;
    }

    return weight;
}

/**
 * Determines the standard production quantity for a recipe based on its type and settings.
 */
export function getStandardBatchYield(recipe, settings = {}, allRecipes = []) {
    if (!recipe) return 0;

    // 1. Explicit Batch Yield (if batch_only)
    if (recipe.yieldMode === 'batch_only' && recipe.batchYield) return parseFloat(recipe.batchYield);

    // 2. Prep/Sauce detection
    if (isSauceLikeRecipe(recipe) || recipe.production_strategy === 'fixed_batch' || recipe.production_strategy === 'foundational') {
        let explicit = parseFloat(recipe.production_batch_size) || parseFloat(recipe.batchYield);
        if (!isNaN(explicit) && explicit > 0) {
            const unit = (recipe.unit || '').toLowerCase();
            if (/(kg|l|liter|litre|kilogram)/i.test(unit)) explicit *= 1000;
            return explicit;
        }
        return getCanonicalBatchYield(recipe) || 1000;
    }

    // 3. Main dishes scale by portionsPerBatch
    if (!isSauceLikeRecipe(recipe)) {
        return (settings.portionsPerBatch || 6) * getPhysicalPortionWeight(recipe, settings, allRecipes);
    }

    return getCanonicalBatchYield(recipe) || 1000;
}
/**
 * Finds the optimal yield within a safe range (+/- 15%) that minimizes rounding variance
 * across all ingredients in a recipe. This is the "Primary Action" for professional scaling.
 * 
 * @param {Object} activeRecipe 
 * @param {number} currentYieldValue 
 * @returns {number} The optimized yield value
 */
export function findOptimalYield(activeRecipe, currentYieldValue) {
    if (!activeRecipe) return currentYieldValue;
    const ingredients = Array.isArray(activeRecipe.ingredients) ? activeRecipe.ingredients : [];
    if (ingredients.length === 0) return currentYieldValue;
    
    let [bestYield, minVar] = [currentYieldValue, Infinity];
    const baseYield = Number(activeRecipe.baseYield) || 1;
    const range = Math.max(baseYield * 0.1, currentYieldValue * 0.15);
    const step = baseYield * 0.01;
    
    for (let y = Math.max(0.1, currentYieldValue - range); y <= currentYieldValue + range; y += step) {
        let variance = 0;
        ingredients.forEach(ing => {
            const ideal = (Number(ing?.qty) || 0) * (y / baseYield);
            const rounded = chefRound(ideal, ing?.unit);
            variance += Math.abs(ideal - rounded) / (ideal || 1);
        });
        if (variance < minVar) {
            minVar = variance;
            bestYield = y;
        }
    }
    return Number(bestYield.toFixed(2));
}

/**
 * Executes a batch completion:
 * 1. Flattens the recipe to get total ingredient depletion (BOM).
 * 2. Updates the local inventory table.
 */
export async function completeBatch(recipe, yieldValue) {
    if (!recipe || yieldValue <= 0) return { success: false, error: 'Invalid batch data' };

    try {
        const multiplier = yieldValue / (recipe.baseYield || 1);
        const depletionMap = await flattenRecipe(recipe, multiplier, db);

        // Update Inventory in Dexie
        await db.transaction('rw', db.inventory, async () => {
            for (const [sku, qty] of Object.entries(depletionMap)) {
                const item = await db.inventory.get(sku);
                const currentQty = item ? item.quantity : 0;
                await db.inventory.put({
                    sku,
                    name: item?.name || sku,
                    quantity: currentQty - qty,
                    unit: item?.unit || 'g'
                });
            }
        });

        console.log(`[Batch] Completion successful for ${recipe.name}. Depleted ${Object.keys(depletionMap).length} items.`);
        return { success: true, depletion: depletionMap };
    } catch (error) {
        console.error('[Batch] Completion error:', error);
        return { success: false, error: error.message };
    }
}
