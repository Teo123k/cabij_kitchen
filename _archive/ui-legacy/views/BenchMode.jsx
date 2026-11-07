import React, { useState, useMemo } from 'react';
import { Scale, Package, ChevronRight, Info } from 'lucide-react';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import BatchStepper from '../components/BatchStepper';
import StepNavigator from '../components/StepNavigator';
import { flattenRecipe } from '../core/bom_engine';
import { depleteInventory } from '../api/pos_hook';
import { db } from '../core/persistence';

const BenchMode = ({ recipe }) => {
    const [multiplier, setMultiplier] = useState(1);
    const [isPrepping, setIsPrepping] = useState(false);

    const handleMissionComplete = async () => {
        console.log('Mission Complete: Depleting Inventory...');
        const bom = await flattenRecipe(recipe || { name: 'Magic Soy' }, multiplier, db);
        await depleteInventory(bom);
        setIsPrepping(false);
    };

    // Mock ingredients if none (for UI validation)
    const ingredients = recipe?.ingredients || [
        { name: 'Light Soy Sauce', qty: 1800, unit: 'g', cat: 'Base', note: 'Main liquid base' },
        { name: 'Korean Sweet Chili', qty: 720, unit: 'g', cat: 'Base', note: 'Sweet body' },
        { name: 'Turkish Chili', qty: 45, unit: 'g', cat: 'Spice', note: 'Heat' },
        { name: 'Smoked Paprika', qty: 28, unit: 'g', cat: 'Spice', note: 'Colour and smoke' },
        { name: 'Rice Vinegar', qty: 120, unit: 'g', cat: 'Finish', note: 'Acid balance' },
        { name: 'Squeeze Bottles', qty: 12, unit: 'pcs', cat: 'Finish', note: 'Pack for service' }
    ];

    const sopSteps = [
        { title: 'Prepare Vessel', copy: 'Clean and sanitize a 6L stainless steel bucket. Place on the scale and tare.', type: 'check', mandatory: true },
        { title: 'Liquid Base', copy: 'Add Soy Sauce and Sweet Chili Sauce as per scaled weights. Whisk for 30 seconds.', type: 'check', mandatory: true },
        { title: 'Spice Incorporation', copy: 'Whisk in Turkish Chili and Smoked Paprika. Ensure no clumps remain.', type: 'check', mandatory: true },
        { title: 'Acid Balance', copy: 'Stir in Rice Vinegar and perform taste check. Adjust only if within +/- 5% variance.', type: 'check' },
        { title: 'Final Packaging', copy: 'Decant into squeeze bottles. Apply date-coded labels and store at 0-4°C.', type: 'check', mandatory: true }
    ];

    const groupedIngredients = useMemo(() => {
        return ingredients.reduce((acc, ing) => {
            const cat = ing.cat || 'General';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(ing);
            return acc;
        }, {});
    }, [ingredients]);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {isPrepping && (
                <StepNavigator 
                    steps={sopSteps} 
                    onComplete={handleMissionComplete}
                    onExit={() => setIsPrepping(false)}
                />
            )}
            {/* HER0 AREA: High Vis Stats */}
            <div className="flex flex-col xl:flex-row gap-6">
                <div className="flex-1 glass-dark rounded-3xl p-8 border border-white/5 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-app-accent opacity-50" />
                    <div className="text-[10px] font-black text-app-accent uppercase tracking-[0.2em] mb-3">Active Bench</div>
                    <h1 className="text-6xl font-black tracking-tighter mb-6">{recipe?.name || 'Magic Soy'}</h1>
                    
                    <div className="flex flex-wrap gap-4">
                        <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2">
                            <span className="text-[10px] font-black text-app-muted uppercase">Target</span>
                            <span className="text-lg font-black text-white">{(recipe?.baseYield || 3000) * multiplier}g</span>
                        </div>
                        <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2">
                            <span className="text-[10px] font-black text-app-muted uppercase">Yield</span>
                            <span className="text-lg font-black text-white">{Math.round(12 * multiplier)} Units</span>
                        </div>
                        <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2">
                             <span className="text-[10px] font-black text-app-muted uppercase">Style</span>
                             <span className="text-lg font-black text-white">Foundation</span>
                        </div>
                    </div>
                </div>

                <div className="w-full xl:w-[400px]">
                    <BatchStepper 
                        multiplier={multiplier} 
                        setMultiplier={setMultiplier} 
                        onQuickScale={(val) => setMultiplier(val)}
                    />
                </div>
            </div>

            {/* INGREDIENT BOARD */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(groupedIngredients).map(([cat, items]) => (
                    <div key={cat} className="space-y-4">
                        <div className="flex items-center gap-2 px-2">
                            <h3 className="text-xs font-black text-app-accent uppercase tracking-widest">{cat}</h3>
                            <div className="flex-1 h-px bg-app-border opacity-30" />
                        </div>
                        
                        <div className="space-y-3">
                            {items.map((ing, idx) => (
                                <IngredientTile key={idx} ing={ing} multiplier={multiplier} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* QUICK ACTIONS */}
            <div className="flex items-center gap-4 pt-6 border-t border-white/5">
                <button 
                    onClick={() => setIsPrepping(true)}
                    className="flex-1 haptic-base px-6 py-4 rounded-2xl bg-app-accent text-app-bg text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2"
                >
                    <Scale size={20} />
                    Tare & Start Batch
                </button>
                <button className="flex-1 haptic-base px-6 py-4 rounded-2xl bg-app-surface border border-app-border text-white text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2">
                    <Package size={20} />
                    Report Inventory Use
                </button>
            </div>
        </div>
    );
};

const IngredientTile = ({ ing, multiplier }) => (
    <div className="haptic-base p-5 rounded-2xl bg-app-surface/40 border border-app-border group hover:border-app-accent/30 transition-all flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
            <div className="font-bold text-lg text-white group-hover:text-app-accent transition-colors truncate">
                {ing.name}
            </div>
            {ing.note && <div className="text-[10px] text-app-muted uppercase font-bold mt-1">{ing.note}</div>}
        </div>
        <div className="text-right">
            <div className="text-3xl font-black tracking-tighter text-white">
                {Math.round(ing.qty * multiplier)}
            </div>
            <div className="text-[10px] font-black text-app-muted uppercase tracking-widest mt-1">
                {ing.unit}
            </div>
        </div>
    </div>
);

export default BenchMode;
