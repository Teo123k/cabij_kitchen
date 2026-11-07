import React from 'react';
import { Utensils, ChevronDown, Upload, Scale } from 'lucide-react';

const ActionHeader = ({ 
    recipes, 
    selectedId, 
    onSelectedIdChange, 
    onFileUpload, 
    portionMode, 
    onPortionModeToggle,
    currentPortionCount,
    currentYieldValue,
    activeRecipe,
    getPortionSize,
    portionsPerBatch,
    setDailyProduction,
    dailyProduction,
    formatQuantity,
    translateIngredient
}) => {
    return (
        <div className="flex-header">
            {/* Left Column: Recipe Selection */}
            <div className="flex-1 p-6 flex items-center gap-6 border-r border-white/5">
                <div className="w-14 h-14 rounded-2xl bg-app-accent/10 border border-app-accent/20 flex items-center justify-center shrink-0 shadow-inner">
                    <Utensils size={24} className="text-app-accent" />
                </div>
                <div className="flex-1 relative">
                    <label className="block text-[8px] font-black uppercase text-app-accent mb-1 tracking-[0.2em] opacity-70">
                        Operational Recipe
                    </label>
                    <select
                        disabled={recipes.length === 0}
                        value={selectedId || ''}
                        onChange={(e) => onSelectedIdChange(e.target.value)}
                        className="w-full bg-transparent font-black text-3xl outline-none cursor-pointer appearance-none disabled:opacity-30 text-white tracking-tight"
                    >
                        {recipes.length === 0 
                            ? <option>LOADING...</option> 
                            : recipes.map(r => (
                                <option key={r.id} value={r.id} className="bg-app-surface text-white">
                                    {translateIngredient ? translateIngredient(r.name) : r.name}
                                </option>
                            ))
                        }
                    </select>
                    <ChevronDown className="absolute right-0 bottom-2 text-app-muted opacity-30 pointer-events-none" size={20} />
                </div>
            </div>
            
            {/* Middle Column: Scaling Controls */}
            <div className="flex items-center gap-10 p-6 px-10 bg-black/10 border-r border-white/5">
                <div className="text-center">
                    <label className="block text-[9px] font-black uppercase text-app-muted mb-3 tracking-[0.2em] opacity-60">
                        {portionMode ? 'Target Portions' : 'Batch Count'}
                    </label>
                    <input
                        disabled={recipes.length === 0}
                        type="number"
                        step={portionMode ? "1" : "0.5"}
                        min="0"
                        value={portionMode
                            ? currentPortionCount
                            : (currentYieldValue / (portionsPerBatch * getPortionSize(activeRecipe)) || 0).toFixed(1)
                        }
                        onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const pSize = getPortionSize(activeRecipe);
                            if (portionMode) {
                                setDailyProduction({ ...dailyProduction, [selectedId]: Number((val * pSize).toFixed(2)) });
                            } else {
                                setDailyProduction({ ...dailyProduction, [selectedId]: Number((val * (portionsPerBatch * pSize)).toFixed(2)) });
                            }
                        }}
                        className={`w-28 bg-app-bg/60 border-2 border-white/10 rounded-2xl px-4 py-3 font-black text-4xl text-center outline-none focus:ring-2 shadow-2xl transition-all ${portionMode ? 'text-amber-400 border-amber-500/30 focus:border-amber-500' : 'text-app-accent border-app-accent/30 focus:border-app-accent'}`}
                    />
                </div>

                <button
                    onClick={onPortionModeToggle}
                    className={`h-14 px-6 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all divide-y divide-white/5 flex flex-col justify-center items-center gap-1 border ${portionMode ? 'bg-amber-500 text-white border-amber-600 shadow-lg shadow-amber-500/20' : 'bg-white/5 text-app-muted border-white/10 hover:border-app-accent hover:text-white'}`}
                >
                    <div className="opacity-60">{portionMode ? 'MODE:' : 'MODE:'}</div>
                    <div>{portionMode ? 'SERVICE' : 'PREP'}</div>
                </button>
            </div>

            {/* Right Column: Execution Output */}
            <div className="p-6 px-10 flex flex-col justify-center bg-app-accent/5">
                <div className="flex items-center gap-3">
                    <Scale size={18} className="text-app-accent" />
                    <div className="text-3xl font-black text-white uppercase tracking-tighter">
                        {formatQuantity(currentYieldValue, activeRecipe?.unit).val} 
                        <span className="text-app-accent ml-2 text-xl">{formatQuantity(currentYieldValue, activeRecipe?.unit).unit}</span>
                    </div>
                </div>
                <div className="text-[10px] font-bold text-app-muted uppercase tracking-[0.1em] opacity-50 mt-1 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-app-accent"></span>
                    Planned Yield Output
                </div>
            </div>

            {/* Final Action: Upload */}
            <div className="p-6 flex items-center pr-8">
                <input type="file" id="recipe-upload-scaler" className="hidden" accept=".json,.sql" onChange={onFileUpload} />
                <label htmlFor="recipe-upload-scaler" className="cursor-pointer w-12 h-12 bg-app-surface/50 border border-white/10 rounded-2xl hover:bg-app-accent hover:text-black hover:border-app-accent transition-all flex items-center justify-center text-app-muted shadow-sm hover:translate-y-[-2px]" title="Upload Core Recipe Packet">
                    <Upload size={20} />
                </label>
            </div>
        </div>
    );
};

export default ActionHeader;
