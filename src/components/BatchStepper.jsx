import React from 'react';
import { Minus, Plus, Zap } from 'lucide-react';

const BatchStepper = ({ multiplier, setMultiplier, onQuickScale }) => {
    const increments = [0.5, 1, 2, 4];

    return (
        <div className="bg-app-surface/40 border border-app-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-app-muted uppercase tracking-widest">Quick Scale</span>
                <div className="flex gap-2">
                    {increments.map(inc => (
                        <button
                            key={inc}
                            onClick={() => onQuickScale(inc)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all
                                       ${multiplier === inc 
                                         ? 'bg-app-accent text-app-bg shadow-lg shadow-app-accent/20' 
                                         : 'bg-white/5 text-app-muted hover:text-white'}`}
                        >
                            {inc}x
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 bg-black/20 rounded-xl p-3 border border-white/5">
                    <div className="text-[10px] font-black text-app-muted uppercase tracking-widest mb-1">Multiplier</div>
                    <div className="flex items-center justify-between">
                        <button 
                            onClick={() => setMultiplier(Math.max(0.1, multiplier - 0.1))}
                            className="haptic-base w-10 h-10 rounded-lg bg-app-surface border border-app-border flex items-center justify-center text-app-muted hover:text-white"
                        >
                            <Minus size={18} />
                        </button>
                        <span className="text-3xl font-black tracking-tighter text-white tabular-nums">
                            {multiplier.toFixed(1)}
                        </span>
                        <button 
                            onClick={() => setMultiplier(multiplier + 0.1)}
                            className="haptic-base w-10 h-10 rounded-lg bg-app-surface border border-app-border flex items-center justify-center text-app-muted hover:text-white"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>

                <div className="w-12 h-12 rounded-xl bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent haptic-base cursor-pointer hover:bg-app-accent/20">
                    <Zap size={24} />
                </div>
            </div>
        </div>
    );
};

export default BatchStepper;
