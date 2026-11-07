import React from 'react';
import { RotateCcw, Scale, LayoutDashboard, Utensils, Zap } from 'lucide-react';
import { OFFLINE_QUEUE_STATUS_LABELS, OFFLINE_STATE, OFFLINE_STATE_META } from '../config/constants';

/**
 * ScalerHeader - The 'Execution Zone' brain.
 * High-visibility scaling stats and reset controls.
 */
const ScalerHeader = ({
    activeRecipe,
    currentYieldValue,
    currentPortionCount,
    portionsPerBatch,
    portionMode,
    onDefaultAll,
    formatQuantity,
    translateIngredient,
    offlineSyncState,
    offlineSyncReason,
    className = ""
}) => {
    if (!activeRecipe) return null;

    const formattedYield = formatQuantity(currentYieldValue, activeRecipe.unit);
    const statusMeta = offlineSyncState ? (OFFLINE_STATE_META[offlineSyncState] || null) : null;

    return (
        <div className={`rounded-3xl border border-white/10 bg-app-surface/40 px-6 py-5 backdrop-blur-xl shadow-2xl transition-all duration-500 ${className}`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="px-2 py-0.5 rounded-full bg-app-accent/10 border border-app-accent/20 text-[8px] font-black uppercase tracking-[0.2em] text-app-accent">
                            Execution Zone
                        </div>
                        <div className={`px-2 py-0.5 rounded-full border border-white/5 text-[8px] font-black uppercase tracking-[0.2em] ${portionMode ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                            {portionMode ? 'Service Mode' : 'Prep Mode'}
                        </div>
                        {offlineSyncState && offlineSyncState !== OFFLINE_STATE.SYNCED && (
                            <div
                                className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] ${
                                    offlineSyncState === OFFLINE_STATE.CONFLICT
                                        ? 'border-orange-200 bg-orange-50 text-orange-800'
                                        : offlineSyncState === OFFLINE_STATE.BLOCKED
                                            ? 'border-red-200 bg-red-50 text-red-800'
                                            : offlineSyncState === OFFLINE_STATE.APPROVED
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                : 'border-amber-200 bg-amber-50 text-amber-800'
                                }`}
                                title={statusMeta?.description || offlineSyncState}
                            >
                                {OFFLINE_QUEUE_STATUS_LABELS[offlineSyncState] || statusMeta?.label || offlineSyncState}
                            </div>
                        )}
                    </div>
                    <h2 className="text-3xl font-black uppercase tracking-tight text-white drop-shadow-sm truncate max-w-[500px]">
                        {translateIngredient(activeRecipe.name)}
                    </h2>
                    {offlineSyncState && offlineSyncState !== OFFLINE_STATE.SYNCED && (
                        <div className="mt-2 space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-app-muted">
                                {statusMeta?.description || offlineSyncReason?.replace(/_/g, ' ') || 'Local change is waiting for sync handling.'}
                            </div>
                            {offlineSyncReason && (
                                <div className="text-[9px] font-black uppercase tracking-[0.15em] text-amber-700">
                                    Reason: {offlineSyncReason.replace(/_/g, ' ')}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <StatBox 
                            label="Target Yield" 
                            value={`${formattedYield.val} ${formattedYield.unit}`} 
                            icon={<Scale size={14} />}
                            accent
                        />
                        <StatBox 
                            label="Portions" 
                            value={currentPortionCount} 
                            icon={<LayoutDashboard size={14} />}
                        />
                        <StatBox 
                            label="Batch Size" 
                            value={portionsPerBatch} 
                            icon={<Utensils size={14} />}
                            className="hidden sm:flex"
                        />
                    </div>

                    <button
                        onClick={onDefaultAll}
                        className="group flex flex-col items-center justify-center p-3 rounded-2xl border border-white/5 bg-white/5 hover:bg-app-accent hover:border-app-accent hover:scale-105 transition-all duration-300 shadow-xl"
                        title="Reset to Default Production"
                    >
                        <RotateCcw size={18} className="text-app-muted group-hover:text-app-bg transition-colors" />
                        <span className="mt-1 text-[7px] font-black uppercase tracking-widest text-app-muted group-hover:text-app-bg">Reset</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const StatBox = ({ label, value, icon, accent, className = "" }) => (
    <div className={`flex flex-col justify-center min-w-[90px] px-4 py-3 rounded-2xl border border-white/5 bg-app-bg/60 backdrop-blur-md transition-all hover:bg-white/5 ${className}`}>
        <div className="flex items-center gap-1.5 mb-1 opacity-50">
            <span className={accent ? 'text-app-accent' : 'text-white'}>{icon}</span>
            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-app-muted">{label}</span>
        </div>
        <div className={`text-lg font-black tabular-nums tracking-tighter ${accent ? 'text-app-accent' : 'text-white'}`}>
            {value}
        </div>
    </div>
);

export default ScalerHeader;
