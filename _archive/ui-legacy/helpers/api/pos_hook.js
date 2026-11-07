import { db } from '../core/persistence';

/**
 * POS Depletion Hook
 * Decrements the inventory based on a flattened Bill of Materials.
 */
export const depleteInventory = async (bom) => {
    try {
        await db.transaction('rw', db.inventory, db.logs, async () => {
            for (const [sku, qty] of Object.entries(bom)) {
                const item = await db.inventory.get(sku);
                
                if (item) {
                    const newQty = Math.max(0, item.quantity - qty);
                    await db.inventory.update(sku, { quantity: newQty });
                    
                    if (newQty === 0) {
                        await db.logs.add({
                            timestamp: new Date().toISOString(),
                            level: 'WARN',
                            message: `Inventory Exhausted: ${item.name} (${sku})`
                        });
                    }
                } else {
                    // SKU missing in inventory tracking
                    await db.logs.add({
                        timestamp: new Date().toISOString(),
                        level: 'DEBUG',
                        message: `Untracked Depletion: ${sku} (-${qty})`
                    });
                }
            }

            await db.logs.add({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                message: `POS Sync: Batch depletion complete. ${Object.keys(bom).length} SKUs affected.`
            });
        });
        
        return { success: true };
    } catch (err) {
        console.error('Inventory Depletion Failed:', err);
        return { success: false, error: err.message };
    }
};
