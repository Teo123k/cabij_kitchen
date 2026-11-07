/**
 * Cabij Finance Engine
 * Calculates True Cost considering yield loss and processing factors.
 */

export const calculateRecipeCost = (recipe, inventory) => {
    if (!recipe || !recipe.ingredients) return 0;

    let totalCost = 0;

    recipe.ingredients.forEach(ing => {
        // Find price in inventory mock or local storage
        const pricePerUnit = inventory?.[ing.sku]?.price || inventory?.[ing.name]?.price || 0.05; // 0.05 default per g/ml
        const qty = parseFloat(ing.qty) || 0;
        
        // Yield recovery factor: 1.0 = no loss, 0.8 = 20% loss
        const recovery = parseFloat(ing.yieldFactor || recipe.defaultYieldFactor) || 1.0;
        
        // Net cost considering loss
        const netCost = (qty * pricePerUnit) / recovery;
        totalCost += netCost;
    });

    return totalCost;
};

export const getMarginData = (totalCost, sellingPrice) => {
    if (!sellingPrice || sellingPrice <= 0) return { margin: 0, profit: 0, cogs: 100 };
    
    const profit = sellingPrice - totalCost;
    const margin = (profit / sellingPrice) * 100;
    const cogs = (totalCost / sellingPrice) * 100;

    return {
        profit: profit.toFixed(2),
        margin: Math.round(margin),
        cogs: Math.round(cogs),
        status: margin > 70 ? 'HEAVEN' : margin > 30 ? 'HEALTHY' : 'DANGER'
    };
};
