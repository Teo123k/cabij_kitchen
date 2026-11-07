import { buildRecipeLookupAliases, getRecipeLookupKey, normalizeRecipeLookupValue } from '../config/constants.js';
import { calculateBOM } from '../core/BOMEngine.js';

const getRecipeId = (recipe, index) => (
    getRecipeLookupKey(recipe, `recipe-${index}`)
);

const resolveRecipeDemandWeight = (recipe = {}, dailyProduction = {}, recipeId = '') => {
    const normalizedProduction = dailyProduction && typeof dailyProduction === 'object' ? dailyProduction : {};
    const directDemand = Number(normalizedProduction?.[recipeId] || 0);
    if (directDemand > 0) return directDemand;

    const aliasSet = new Set(
        buildRecipeLookupAliases(recipe, recipeId)
            .map((alias) => normalizeRecipeLookupValue(alias))
            .filter(Boolean)
    );

    const matchedEntry = Object.entries(normalizedProduction).find(([key, value]) => {
        if (Number(value || 0) <= 0) return false;
        return aliasSet.has(normalizeRecipeLookupValue(key));
    });

    return matchedEntry ? Number(matchedEntry[1] || 0) : 0;
};

/**
 * Builds a stable scale map from daily production targets.
 * Keeps shape aligned with sibling BOM usage where map keys are recipe ids.
 */
export const buildScaleMap = (recipes = [], dailyProduction = {}) => (
    (Array.isArray(recipes) ? recipes : []).reduce((acc, recipe, index) => {
        const recipeId = getRecipeId(recipe, index);
        const baseYield = Number(recipe?.baseYield || recipe?.yield || 0);
        const demandWeight = resolveRecipeDemandWeight(recipe, dailyProduction, recipeId);

        if (baseYield > 0 && demandWeight > 0) {
            acc[recipeId] = demandWeight / baseYield;
        }

        return acc;
    }, {})
);

export const calculateRecipeDemand = (recipes = [], dailyProduction = {}, portionsPerBatch = 6, settings = {}) => {
    const scales = buildScaleMap(recipes, dailyProduction);
    return calculateBOM(recipes, scales, portionsPerBatch, settings);
};

export { calculateBOM };
