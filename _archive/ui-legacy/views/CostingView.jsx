import React, { useState } from 'react';
import { DollarSign, TrendingUp, AlertTriangle, ArrowRight, PieChart } from 'lucide-react';
import { calculateRecipeCost, getMarginData } from '../core/finance';

const CostingView = ({ activeRecipe }) => {
    const [sellingPrice, setSellingPrice] = useState(28); // Standard main dish price
    
    // Mock inventory prices
    const inventory = {
        'Light Soy Sauce': { price: 0.008 },
        'Korean Sweet Chili': { price: 0.012 },
        'Turkish Chili': { price: 0.045 },
        'Rice Vinegar': { price: 0.009 }
    };

    const cost = calculateRecipeCost(activeRecipe, inventory) || 4.52; // Fallback for UI
    const financial = getMarginData(cost, sellingPrice);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right duration-500">
            {/* KPI STRIP */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricCard 
                    label="Batch Cost" 
                    value={`$${cost.toFixed(2)}`} 
                    sub="Current Scale: 1.0x"
                    icon={<DollarSign className="text-app-accent" size={24} />}
                />
                <MetricCard 
                    label="Margin Status" 
                    value={`${financial.margin}%`} 
                    sub={financial.status}
                    icon={<TrendingUp className={financial.status === 'DANGER' ? 'text-app-danger' : 'text-app-accent'} size={24} />}
                />
                <MetricCard 
                    label="Food Cost %" 
                    value={`${financial.cogs}%`} 
                    sub="COGS Breakdown"
                    icon={<PieChart className="text-app-muted" size={24} />}
                />
            </div>

            {/* HEATMAP / MARGIN SLIDER */}
            <div className="glass-dark rounded-3xl p-8 border border-white/5 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Price Sensitivity</h2>
                        <p className="text-[10px] font-black text-app-muted uppercase tracking-[0.2em] mt-1">Simulate Revenue Drift</p>
                    </div>
                    <div className="text-4xl font-black text-white tracking-tighter tabular-nums">
                        ${sellingPrice}
                    </div>
                </div>

                <input 
                    type="range" 
                    min="5" 
                    max="100" 
                    value={sellingPrice} 
                    onChange={(e) => setSellingPrice(parseInt(e.target.value))}
                    className="w-full h-3 bg-white/5 rounded-full appearance-none cursor-pointer accent-app-accent border border-white/10"
                />

                <div className="h-12 w-full bg-white/5 rounded-2xl border border-white/10 flex overflow-hidden">
                    <div 
                        className="bg-app-danger transition-all duration-500 flex items-center px-4"
                        style={{ width: `${financial.cogs}%` }}
                    >
                        <span className="text-[9px] font-black text-white uppercase truncate">Cost: {financial.cogs}%</span>
                    </div>
                    <div className="flex-1 bg-app-accent/80 transition-all duration-500 flex items-center justify-end px-4">
                        <span className="text-[9px] font-black text-app-bg uppercase truncate">Profit: {financial.margin}%</span>
                    </div>
                </div>
            </div>

            {/* INGREDIENT COST LIST */}
            <div className="space-y-4">
                <h3 className="text-xs font-black text-app-muted uppercase tracking-widest px-2">Cost Breakdown</h3>
                <div className="grid grid-cols-1 gap-3">
                    {(activeRecipe?.ingredients || []).map((ing, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 rounded-xl bg-app-surface/40 border border-app-border hover:border-app-accent/30 transition-all group">
                            <div className="flex items-center gap-4">
                                <div className="w-2 h-2 rounded-full bg-app-border group-hover:bg-app-accent transition-colors" />
                                <span className="font-bold text-white uppercase tracking-wider text-xs">{ing.name}</span>
                            </div>
                            <div className="flex items-center gap-8">
                                <span className="text-[10px] font-bold text-app-muted uppercase">Qty: {ing.qty}{ing.unit}</span>
                                <span className="font-black text-white tracking-tight">${((parseFloat(ing.qty) || 0) * 0.008).toFixed(2)}</span>
                            </div>
                        </div>
                    ))}
                    {(!activeRecipe?.ingredients) && (
                        <div className="p-8 text-center text-app-muted uppercase font-black text-[10px] tracking-[0.3em] opacity-30">
                            No component data to calculate
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const MetricCard = ({ label, value, sub, icon }) => (
    <div className="glass rounded-2xl p-6 border border-white/5 relative overflow-hidden group hover:scale-[1.02] transition-all">
        <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-100 transition-opacity">
            {icon}
        </div>
        <div className="text-[10px] font-black text-app-muted uppercase tracking-widest mb-2">{label}</div>
        <div className="text-4xl font-black text-white tracking-tighter mb-1">{value}</div>
        <div className="text-[9px] font-black text-app-accent uppercase tracking-[0.2em]">{sub}</div>
    </div>
);

export default CostingView;
