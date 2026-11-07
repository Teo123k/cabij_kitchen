/**
 * Cabij BOM (Bill of Materials) Engine
 * Recursively flattens complex recipe trees into raw materials.
 */

export const flattenRecipe = async (recipe, multiplier, db) => {
    let bom = {}; // key: sku/name, value: totalQty

    const ingredients = recipe.ingredients || [];

    for (const ing of ingredients) {
        const scaledQty = (parseFloat(ing.qty) || 0) * multiplier;
        
        // Check if this ingredient is actually a sub-recipe (component)
        // In this system, we identify sub-recipes by looking for a matching SKU or ID in the recipes table
        const subRecipe = await db.recipes.where('name').equals(ing.name).first();

        if (subRecipe) {
            // Recurse: Calculate the multiplier for the sub-recipe
            // If the parent needs 500g and the sub-recipe base yield is 1000g, multiplier is 0.5
            const subMultiplier = scaledQty / (parseFloat(subRecipe.baseYield) || 1000);
            const subBOM = await flattenRecipe(subRecipe, subMultiplier, db);
            
            // Merge subBOM into main BOM
            for (const [sku, qty] of Object.entries(subBOM)) {
                bom[sku] = (bom[sku] || 0) + qty;
            }
        } else {
            // Raw Material
            const key = ing.sku || ing.name;
            bom[key] = (bom[key] || 0) + scaledQty;
        }
    }

    return bom;
};
