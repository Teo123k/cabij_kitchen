import { buildRecipeLookupAliases, getRecipeLookupKey, normalizeRecipeLookupValue } from '../config/constants.js';

/**
 * Mapping of internal SKUs to specific recipe IDs for BOM explosion.
 * This acts as a manual registry for core components.
 */
export const SKU_TO_RECIPE_MAP = {
    'INT-MAG-SOY': 'magic-soy',
    'INT-BBQ-SCE': 'bbq-sauce',
    'INT-SWT-SWP': 'sweet-spicy-sauce',
    'INT-CHK-COAT': 'chicken-coating-flour',
    'INT-CHK-STRCH': 'chicken-coating-starch',
    'INT-EGG-WSH': 'egg-wash',
    'INT-TTE-SCE': 'tteokkochi-sauce',
    'INT-CUR-ROUX': 'curry-roux',
    'INT-CUR-BASE': 'curry-vege-base'
};

/**
 * Normalizes a string for comparison:
 * 1. Lowercase, Trimmed
 * 2. Collapse whitespace
 * 3. Strip leading numbers and symbols (e.g. "1. ", "2) ")
 * 4. Strip trailing parentheses (e.g. " (Master Base)")
 */
const normalize = (val) => {
    return normalizeRecipeLookupValue(val);
};

/**
 * Resolves a Recipe ID from an ingredient object using a multi-tier approach.
 * This is the system's "Fail-Safe" for linking ingredients to their sub-recipes.
 * 
 * @param {Object} ing The ingredient object (from a recipe's ingredient list)
 * @param {Array<Object>} recipes Total repository of recipes
 * @returns {string|null} The resolved recipe ID
 */
export function resolveRecipeId(ing, recipes = []) {
    if (!ing) return null;
    const getRecipeIdentity = (recipe) => getRecipeLookupKey(recipe);
    const resolveMappedRecipeIdentity = (mappedId) => {
        const normalizedMappedId = normalize(mappedId);
        if (!normalizedMappedId) return mappedId || null;

        const mappedRecipe = recipes.find((recipe) => {
            const aliases = buildRecipeLookupAliases(recipe).map((alias) => normalize(alias)).filter(Boolean);
            return aliases.includes(normalizedMappedId);
        });

        return mappedRecipe ? getRecipeIdentity(mappedRecipe) : mappedId;
    };
    // Original 's' for SKU-based normalization, 'n' for name-based
    const originalSkuNormalized = normalize(ing.sku);
    const n = normalize(ing.name);

    // Tier 1: Explicit Registry (SKU_TO_RECIPE_MAP)
    if (ing.sku && SKU_TO_RECIPE_MAP[ing.sku]) {
        return resolveMappedRecipeIdentity(SKU_TO_RECIPE_MAP[ing.sku]);
    }

    // Tier 2: Search for SKU property or Recipe Name/ID match
    // This 's' is a more comprehensive normalized key for Tier 2 matching
    const s = normalize(ing.sku || ing.recipe_id || ing.recipe_ref_id || ing.canonical_id || ing.name);
    if (!s) return null; // FIX (Step 2): Don't match empty strings

    const directMatch = recipes.find(r => {
        const aliases = buildRecipeLookupAliases(r).map((alias) => normalize(alias)).filter(Boolean);
        const matchFound = (ing.sku && getRecipeIdentity(r) === ing.sku) || (s && aliases.includes(s));
        return matchFound;
    });

    if (directMatch) return getRecipeIdentity(directMatch);
    // Tier 3: Name-Based Fallback (Professional Fail-Safe)
    const nameMatch = recipes.find(r => n && normalize(r.name) === n);
    if (nameMatch) return getRecipeIdentity(nameMatch);

    // After implementation of STEP 1:
    const suspectTerms = ['sauce', 'base', 'stock', 'marinade', 'coating', 'roux', 'glaze', 'paste', 'wash'];
    if (ing.sku || (n && suspectTerms.some(t => n.includes(t)))) {
        console.warn(`[BOM] SKU resolution failed for ingredient: "${ing.name}" (sku: ${ing.sku || 'none'})`);
    }

    return null;
}

/**
 * Legacy wrapper for compatibility.
 */
export function resolveRecipeIdBySku(sku, recipes = []) {
    return resolveRecipeId({ sku }, recipes);
}
