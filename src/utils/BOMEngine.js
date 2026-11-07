import {
    getCanonicalPortionCount,
    getCanonicalBatchYield,
    toGrams,
    getRecipeBaselineGrams,
    resolveRecipeId
} from '../core/index.js';
import { buildRecipeLookupAliases, classifyKitchenUnit, getRecipeLookupKey } from '../config/constants.js';

/**
 * BOM Engine - Pure Mathematical Logic
 * Calculates scale factors and demand across a recipe cascade.
 * 
 * @param {Array} recipes - All recipe objects
 * @param {Object} scales - Initial scale factors { [id]: scale }
 * @param {Object} settings - Portion settings contract
 * @returns {Object} { nodes, demand, activeOrigins }
 */
export const calculateBOM = (recipes, scales = {}, portionsPerBatch = 6, settings = {}) => {
    try {
        if (!recipes || !Array.isArray(recipes)) return { nodes: {}, demand: {}, activeOrigins: {} };

        const recipeMap = new Map();
        const getEngineRecipeId = (recipe, fallback = null) => (
            getRecipeLookupKey(recipe, fallback)
        );
        const addRecipeAlias = (key, recipe) => {
            if (key) recipeMap.set(String(key), recipe);
        };

        recipes.forEach(r => {
            const recipeId = getEngineRecipeId(r);
            if (!recipeId) {
                console.warn('[BOM] Recipe missing id:', r.name || 'unknown');
                return;
            }
            if (!r.baseYield || parseFloat(r.baseYield) <= 0) {
                console.warn(`[BOM] Recipe "${recipeId}" has invalid baseYield: ${r.baseYield}`);
            }
            if (!r.ingredients || !Array.isArray(r.ingredients)) {
                console.warn(`[BOM] Recipe "${recipeId}" has no ingredients array`);
            }
            buildRecipeLookupAliases(r, recipeId).forEach((alias) => addRecipeAlias(alias, r));
            addRecipeAlias(r.recipe_id, r);
        });

        const nodes = {}; // { [id]: { scale, derivedScale, manualScale, weight, portions, unit } }
        const safeScales = scales || {};
        const effectiveSettings = {
            mainPortionSize: settings.mainPortionSize || 250,
            sidePortionSize: settings.sidePortionSize || 80,
            starterPortionSize: settings.starterPortionSize || 150,
            portionsPerBatch: settings.portionsPerBatch || portionsPerBatch
        };
        const isPortionLikeUnit = (unit) => /^(portion|portions|pcs|pax|each)s?$/i.test((unit || '').trim());
        const getTruthBaselineWeight = (recipe) => {
            const canonicalYield = getCanonicalBatchYield(recipe);
            if (canonicalYield > 0) return canonicalYield;
            return getRecipeBaselineGrams(recipe, false, effectiveSettings);
        };

        const explode = (recipeId, incomingScale, seen = new Set(), depth = 0) => {
            if (depth > 12 || seen.has(recipeId) || incomingScale < 0) return;
            seen.add(recipeId);

            const recipe = recipeMap.get(recipeId);
            if (!recipe) return;
            const nodeId = getEngineRecipeId(recipe, recipeId);

            // Initialize node if missing
            if (!nodes[nodeId]) {
                nodes[nodeId] = {
                    scale: 0,
                    derivedScale: 0,
                    manualScale: 0,
                    demandWeight: 0,
                    effectiveDemandWeight: 0,
                    shortageWeight: 0,
                    weight: 0,
                    edibleWeight: 0,
                    portions: 0,
                    unit: recipe.unit
                };
            }

            const oldTotal = Math.max(nodes[nodeId].manualScale, nodes[nodeId].derivedScale);

            // Apply manual scale at the entry point of the recursion
            if (depth === 0) {
                nodes[nodeId].manualScale = parseFloat(safeScales[recipeId]) || 0;
            }

            nodes[nodeId].derivedScale += incomingScale;
            const newTotal = Math.max(nodes[nodeId].manualScale, nodes[nodeId].derivedScale);

            const delta = newTotal - oldTotal;
            nodes[nodeId].scale = newTotal;

            const isProcessIngredient = (ing, r) => {
                if (ing.is_process || ing.isProcessIngredient) return true;
                const name = (ing.name || '').toLowerCase();
                const style = (r.dishStyle || r.style || '').toLowerCase();
                if (style === 'fried' && name.includes('oil') && !name.includes('sesame') && !name.includes('chili')) return true;
                return false;
            };

            const baselineGrams = getTruthBaselineWeight(recipe);
            const edibleBaselineGrams = (recipe.ingredients || []).reduce((acc, ing) => {
                if (isProcessIngredient(ing, recipe)) return acc;
                return acc + toGrams(ing.qty, ing.unit);
            }, 0) || baselineGrams;

            nodes[nodeId].weight = nodes[nodeId].scale * baselineGrams;
            nodes[nodeId].edibleWeight = nodes[nodeId].scale * edibleBaselineGrams;
            
            const canonicalPortionCount = getCanonicalPortionCount(recipe, effectiveSettings, recipes);
            nodes[nodeId].portions = nodes[nodeId].scale * canonicalPortionCount;

            if (delta <= 0) return;

            if (recipe.ingredients) {
                recipe.ingredients.forEach(ing => {
                    const childId = resolveRecipeId(ing, recipes);
                    if (childId) {
                        // PHASE 2B: HARD CIRCUIT BREAKER
                        // Recursive propagation for scale is strictly disabled.
                        return;
                    }
                });
            }
        };

        // Demand-only recursion: tracks required child output without mutating child manual scale.
        const accumulateDemand = (recipeId, parentDemandWeight, seen = new Set(), depth = 0) => {
            if (depth > 12 || seen.has(recipeId) || parentDemandWeight <= 0) return;
            seen.add(recipeId);

            const recipe = recipeMap.get(recipeId);
            if (!recipe || !Array.isArray(recipe.ingredients)) return;

            const parentBaseline = getTruthBaselineWeight(recipe);
            if (parentBaseline <= 0) return;

            recipe.ingredients.forEach(ing => {
                const childId = resolveRecipeId(ing, recipes);
                if (!childId || childId === recipeId) return;

                const childRecipe = recipeMap.get(childId);
                if (!childRecipe) return;
                const childNodeId = getEngineRecipeId(childRecipe, childId);

                const childBaselineGrams = getTruthBaselineWeight(childRecipe);
                const childPortionCount = getCanonicalPortionCount(childRecipe, effectiveSettings, recipes);
                const childGramsPerPortion = childPortionCount > 0 ? (childBaselineGrams / childPortionCount) : 0;
                const dependencyUnit = String(ing.unit || '').trim();
                const dependencyUnitDomain = classifyKitchenUnit(dependencyUnit);
                const childYieldUnitDomain = classifyKitchenUnit(childRecipe?.unit || '');

                if (
                    dependencyUnit
                    && childRecipe?.unit
                    && dependencyUnitDomain
                    && childYieldUnitDomain
                    && dependencyUnitDomain !== 'unknown'
                    && childYieldUnitDomain !== 'unknown'
                    && dependencyUnitDomain !== childYieldUnitDomain
                    && !isPortionLikeUnit(ing.unit)
                ) {
                    return;
                }

                const ingredientGrams = isPortionLikeUnit(ing.unit)
                    ? (parseFloat(ing.qty) || 0) * childGramsPerPortion
                    : toGrams(ing.qty, ing.unit);
                if (ingredientGrams <= 0) return;

                const requiredChildWeight = (ingredientGrams / parentBaseline) * parentDemandWeight;
                if (requiredChildWeight <= 0) return;

                if (!nodes[childNodeId]) {
                    nodes[childNodeId] = {
                        scale: 0,
                        derivedScale: 0,
                        manualScale: 0,
                        demandWeight: 0,
                        effectiveDemandWeight: 0,
                        shortageWeight: 0,
                        weight: 0,
                        edibleWeight: 0,
                        portions: 0,
                        unit: childRecipe.unit
                    };
                }

                nodes[childNodeId].demandWeight += requiredChildWeight;
                accumulateDemand(childId, requiredChildWeight, new Set(seen), depth + 1);
            });
        };

        // 1. Establish baselines from ALL provided scales
        Object.keys(safeScales).forEach(id => {
            explode(id, 0);
        });

        // 2. Demand pass across sub-recipe links (no scale mutation)
        Object.keys(safeScales).forEach(id => {
            const rootRecipe = recipeMap.get(id);
            const rootNodeId = getEngineRecipeId(rootRecipe, id);
            const rootNode = nodes[rootNodeId];
            if (!rootNode || rootNode.weight <= 0) return;
            accumulateDemand(id, rootNode.weight, new Set(), 0);
        });

        // 3. Final cleanup and normalization
        Object.keys(nodes).forEach(id => {
            const node = nodes[id];
            node.effectiveDemandWeight = Math.max(node.weight, node.demandWeight);
            node.shortageWeight = Math.max(0, node.demandWeight - node.weight);
            node.scale = Number(node.scale.toFixed(4));
            node.weight = Number(node.weight.toFixed(2));
            node.demandWeight = Number(node.demandWeight.toFixed(2));
            node.effectiveDemandWeight = Number(node.effectiveDemandWeight.toFixed(2));
            node.shortageWeight = Number(node.shortageWeight.toFixed(2));
            node.edibleWeight = Number(node.edibleWeight.toFixed(2));
            node.portions = Number(node.portions.toFixed(2));
        });

        return {
            nodes,
            demand: Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.effectiveDemandWeight])),
            activeOrigins: Object.fromEntries(
                Object.entries(safeScales)
                    .filter(([_, v]) => parseFloat(v) > 0)
                    .map(([id, v]) => [id, parseFloat(v)])
            )
        };
    } catch (e) {
        console.error("BOM Fail:", e);
        return { nodes: {}, demand: {}, activeOrigins: {} };
    }
};
