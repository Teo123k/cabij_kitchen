import React from 'react';
import { APP_STRINGS, UI_LIMITS } from '../config/constants';

const IngredientSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: UI_LIMITS.INGREDIENT_SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="flex justify-between items-center p-3.5 bg-app-surface-soft border border-app-border rounded-lg animate-pulse">
                <div className="space-y-2 w-full">
                    <div className="h-2 w-24 rounded bg-app-border"></div>
                    <div className="h-1 w-12 rounded bg-app-border-soft"></div>
                </div>
            </div>
        ))}
    </div>
);

const IngredientTable = ({ 
    activeRecipe, 
    currentYieldValue, 
    formatQuantity, 
    translateIngredient,
    className = '',
    dense = false,
    ingredientCount = 0,
    preferNoScroll = false
}) => {
    const noScroll = preferNoScroll && ingredientCount > 0 && ingredientCount <= 20;

    if (!activeRecipe) {
        return (
            <div className={`bg-app-surface border border-app-border rounded-lg p-8 min-h-[400px] shadow-sm ${className}`}>
                <IngredientSkeleton />
            </div>
        );
    }

    return (
        <div className={`bg-app-surface border border-app-border rounded-lg shadow-sm flex flex-col min-h-0 overflow-hidden ${className}`}>
            <div className={`grid grid-cols-1 md:grid-cols-2 ${noScroll ? 'xl:grid-cols-2' : 'lg:grid-cols-3'} flex-1 min-h-0 ${noScroll ? 'overflow-hidden' : 'overflow-auto'} ${dense ? 'gap-3 p-4 md:p-5' : 'gap-5 p-8'}`}>
                {(activeRecipe.ingredients || []).map((ing, i) => {
                    const factor = (activeRecipe.baseYield > 0) ? (currentYieldValue / activeRecipe.baseYield) : 0;
                    const { val: v, unit: u } = formatQuantity((ing.qty || 0) * factor, ing.unit);
                    return (
                        <div key={i} className="flex justify-between items-center p-4 bg-white border border-app-border rounded-lg group hover:border-app-accent hover:bg-app-surface-soft transition-all duration-300 shadow-sm">
                            <div className="min-w-0">
                                <div className="text-[12px] font-black text-app-text uppercase tracking-tight truncate mb-0.5">
                                    {translateIngredient ? translateIngredient(ing?.name || '') : (ing?.name || 'Unnamed')}
                                </div>
                                <div className="text-[8px] text-app-muted uppercase font-black tracking-[0.2em] opacity-40">
                                    {ing.sku || APP_STRINGS.SKU_PENDING}
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-2xl font-black text-app-accent tabular-nums">{v}</span>
                                <span className="text-[10px] font-bold text-app-muted uppercase ml-2 opacity-60">{u}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default IngredientTable;
export { IngredientSkeleton };
