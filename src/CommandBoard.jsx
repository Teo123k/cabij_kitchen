import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { useSettings } from './SettingsContext';
import { OFFLINE_CACHE_TYPES, buildRecipeLookupAliases, normalizeRecipeLookupValue, normalizeSupabaseRecipeRecord } from './config/constants';
import { readOfflineCache, saveOfflineCache } from './config/offlineState';
import { buildRecipeFreshnessMarker } from './config/offlineQueue';

/**
 * CommandBoard Component
 * Kitchen Operational Hub for task management.
 */
const CommandBoard = ({ clientId = 'kabile', onExit, productionTargets = {} }) => {
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dataSource, setDataSource] = useState('online');
    const { language, volumeFocus, translateIngredient } = useSettings();
    const [checkedTasks, setCheckedTasks] = useState(() => {
        const saved = localStorage.getItem(`command_board_checks_${clientId}`);
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        async function fetchBoardData() {
            setLoading(true);
            const applyCachedBoard = () => {
                const cached = readOfflineCache({ clientId, type: OFFLINE_CACHE_TYPES.COMMAND_BOARD });
                const cachedTasks = cached?.payload?.boardTasks;
                if (!Array.isArray(cachedTasks)) return false;
                setRecipes(cachedTasks);
                setDataSource(cached?.trust?.isDegraded ? 'offline-cache-degraded' : 'offline-cache');
                return true;
            };

            const buildBoardTasks = (boardRows, recipeRows) => {
            const recipesRaw = (recipeRows || []).map(row => {
                    const recipe = normalizeSupabaseRecipeRecord({ row, clientId: row?.client_id });
                    if (!recipe) {
                        console.warn('Skipping malformed command board recipe row:', row?.id);
                        return null;
                    }
                    return {
                        ...recipe,
                        db_id: row.id,
                        offline_base_freshness: buildRecipeFreshnessMarker({
                            row,
                            recipe,
                            clientId: row?.client_id
                        })
                    };
                }).filter(Boolean);

                return (boardRows || []).map(row => {
                    let taskData = {};
                    try {
                        taskData = typeof row.tasks_json === 'string' ? JSON.parse(row.tasks_json) : row.tasks_json;
                    } catch (error) {
                        console.warn('Skipping malformed command board task payload:', row?.id, error);
                    }
                    const rowNameNorm = normalizeRecipeLookupValue(row.dish_name);

                    const meta = recipesRaw.find(r => {
                        const aliases = buildRecipeLookupAliases(r).map((alias) => normalizeRecipeLookupValue(alias));
                        return aliases.includes(rowNameNorm);
                    });

                    return {
                        id: row.id,
                        dish_name: row.dish_name,
                        staff_role: row.staff_role,
                        data: taskData || {},
                        meta: meta || {}
                    };
                });
            };

            try {
                if (typeof navigator !== 'undefined' && navigator.onLine === false && applyCachedBoard()) {
                    return;
                }

                const [boardRes, recipeRes] = await Promise.all([
                    supabase.from('main_board_tasks').select('*').eq('client_id', clientId),
                    supabase.from('recipes').select('*').eq('client_id', clientId)
                ]);

                if (boardRes.error) throw boardRes.error;
                if (recipeRes.error) throw recipeRes.error;

                const boardTasks = buildBoardTasks(boardRes.data, recipeRes.data);
                setRecipes(boardTasks);
                setDataSource('online');
                saveOfflineCache({
                    clientId,
                    type: OFFLINE_CACHE_TYPES.COMMAND_BOARD,
                    payload: { boardTasks }
                });
            } catch (error) {
                console.error('Command board hydration failed:', error);
                if (!applyCachedBoard()) {
                    setRecipes([]);
                    setDataSource('missing-cache');
                }
            } finally {
                setLoading(false);
            }
        }
        fetchBoardData();
    }, [clientId]);

    useEffect(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        localStorage.setItem(`command_board_checks_${clientId}`, JSON.stringify(checkedTasks));
    }, [checkedTasks, clientId]);

    const toggleTask = (recipeId, category, index) => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            alert('Offline mode is read-only for SOP tasks. Reconnect before saving command-board checks.');
            return;
        }

        const key = `${recipeId}-${category}-${index}`;
        setCheckedTasks(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const processStationTags = (label) => {
        if (typeof label !== 'string') return label;
        return label.replace(/\[([A-Z]+)\]/g, (match, p1) => `<span class="station-tag">${p1}</span>`);
    };

    const formatValue = (val, unit) => {
        if (!val) return "";
        if (val >= 1000 && (unit === 'g' || unit === 'ml')) {
            const newVal = (val / 1000).toFixed(1).replace(/\.0$/, "");
            return `${newVal}${unit === 'g' ? 'kg' : 'L'}`;
        }
        return `${Math.round(val)}${unit || ''}`;
    };

    const processTaskLabel = (recipe, label) => {
        if (typeof label !== 'string' || !label.includes('{{qty}}')) return label;
        let portions = productionTargets[recipe.id] || 0;
        const ratio = recipe.meta?.ratio || 1;
        const qty = portions * ratio;
        let unit = recipe.meta?.unit || '';
        if (label.includes('{{unit}}')) {
            if (qty >= 1000 && (unit === 'g' || unit === 'ml')) {
                const formatted = formatValue(qty, unit);
                return label.replace('{{qty}}', formatted.replace(/[a-zA-Z]/g, '')).replace('{{unit}}', formatted.replace(/[0-9.]/g, ''));
            }
            return label.replace('{{qty}}', Math.round(qty)).replace('{{unit}}', unit);
        }
        return label.replace('{{qty}}', formatValue(qty, unit));
    };

    const renderTaskRows = (recipe, category, tasks, isForward = false) => {
        const subRecipes = recipes.filter(r => r.meta?.is_sub_recipe && r.meta?.parent_sku === (recipe.meta?.id || recipe.dish_name.toLowerCase().replace(/ /g, '-')));
        const absorbed = subRecipes.flatMap(sub => {
            const tks = category === 'morning-fwd' ? (sub.data?.morning?.forward || []) : category === 'morning-std' ? (sub.data?.morning?.tasks || []) : category === 'weekly' ? (sub.data?.weekly || []) : (sub.data?.service || []);
            return tks.map(t => ({ label: typeof t === 'string' ? `[${sub.dish_name}] ${t}` : { ...t, label: `[${sub.dish_name}] ${t.label}` }, recipe: sub }));
        });
        const allTasks = [...tasks.map(t => ({ label: t, recipe })), ...absorbed];
        if (allTasks.length === 0) return null;
        return allTasks.map((item, idx) => {
            const isTactical = typeof item.label === 'object';
            const rawLabel = processStationTags(isTactical ? item.label.label : item.label);
            const processedLabel = processTaskLabel(item.recipe, rawLabel);
            const key = `${recipe.id}-${category}-${idx}`;
            const isChecked = checkedTasks[key];
            return (
                <div key={key} className={`task-row ${isChecked ? 'checked' : ''} ${isTactical ? 'tactical-task' : ''}`} onClick={() => toggleTask(recipe.id, category, idx)}>
                    <div className="check-box"></div>
                    <div className="task-content">
                        <span className="task-label">{processedLabel}</span>
                    </div>
                </div>
            );
        });
    };

    const stats = useMemo(() => {
        let total = 0, done = 0;
        recipes.forEach(r => {
            const p = r.data || {};
            total += (p.weekly?.length || 0) + (p.morning?.tasks?.length || 0) + (p.morning?.forward?.length || 0) + (p.service?.length || 0);
            Object.keys(checkedTasks).forEach(key => { if (key.startsWith(`${r.id}-`) && checkedTasks[key]) done++; });
        });
        return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }, [recipes, checkedTasks]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-zinc-500 opacity-40">
            <i className="fa-solid fa-spinner fa-spin text-3xl mb-4 text-app-accent"></i>
            <p className="uppercase tracking-[0.3em] text-[9px] font-black">Syncing Kitchen State...</p>
        </div>
    );

    const ColumnSkeleton = ({ count = 3 }) => (
        <div className="space-y-4 opacity-10 blur-[1px]">
            {[...Array(count)].map((_, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
                    <div className="h-2 w-24 bg-white/20 rounded mb-4"></div>
                    <div className="space-y-2">
                        <div className="h-1.5 w-full bg-white/10 rounded"></div>
                        <div className="h-1.5 w-5/6 bg-white/10 rounded"></div>
                        <div className="h-1.5 w-4/6 bg-white/10 rounded"></div>
                    </div>
                </div>
            ))}
        </div>
    );

    const visibleMainRecipes = recipes.filter(r => !r.meta?.is_sub_recipe);

    return (
        <div className="command-board-wrapper selection:bg-app-accent/20">
            <style>{`
                .command-board-wrapper { background: var(--app-bg); font-family: 'Outfit', 'Inter', sans-serif; color: var(--app-text); height: calc(100vh - 180px); overflow: hidden; display: flex; flex-direction: column; }
                .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 20px; flex: 1; min-height: 0; }
                .board-column { background: rgba(255,255,255,0.02); border: 1px solid var(--color-border-soft); border-radius: var(--radius-md); display: flex; flex-direction: column; min-height: 0; backdrop-filter: blur(10px); box-shadow: var(--shadow-soft); }
                .col-header { padding: 16px 20px; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--color-border-soft); border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 11px; font-weight: 900; text-transform: uppercase; display: flex; align-items: center; gap: 10px; flex-shrink: 0; letter-spacing: 0.1em; }
                .col-content { flex: 1; overflow-y: auto; padding: 15px; scrollbar-width: none; }
                .col-content::-webkit-scrollbar { display: none; }
                
                .recipe-box { margin-bottom: 15px; background: rgba(255,255,255,0.03); border: 1px solid var(--color-border-soft); border-radius: var(--radius-sm); padding: 12px; transition-property: background-color, border-color, transform, box-shadow; transition-duration: var(--motion-base); transition-timing-function: var(--ease-standard); }
                .recipe-box:hover { background: rgba(255,255,255,0.05); border-color: rgba(var(--app-accent-rgb), 0.18); transform: translateY(-2px); box-shadow: var(--shadow-soft); }
                
                .recipe-control { background: rgba(0,0,0,0.1); padding: 8px 12px; border-left: 3px solid var(--color-border-strong); border-radius: var(--radius-xs); display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                .recipe-name { font-size: 10px; font-weight: 900; text-transform: uppercase; color: var(--app-text); opacity: 0.8; }
                
                .task-row { background: rgba(255,255,255,0.02); border: 1px solid var(--color-border-soft); padding: 10px 14px; display: flex; gap: 12px; cursor: pointer; margin-bottom: 4px; border-radius: var(--radius-xs); transition-property: background-color, border-color, transform, opacity, filter; transition-duration: var(--motion-fast); transition-timing-function: var(--ease-standard); }
                .task-row:hover { background: rgba(255,255,255,0.05); border-color: rgba(var(--app-accent-rgb), 0.24); }
                .task-row.checked { opacity: 0.4; filter: grayscale(1); }
                
                .check-box { width: 16px; height: 16px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; flex-shrink: 0; margin-top: 1px; transition-property: background-color, border-color, transform; transition-duration: var(--motion-fast); transition-timing-function: var(--ease-standard); }
                .checked .check-box { background: var(--app-accent); border-color: var(--app-accent); transform: scale(0.9); }
                
                .task-label { font-size: 10px; font-weight: 800; text-transform: uppercase; line-height: 1.2; color: var(--app-text); opacity: 0.9; }
                .station-tag { background: var(--color-accent-blue-soft); color: var(--app-blue); padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: 900; margin-right: 6px; border: 1px solid rgba(59, 130, 246, 0.2); }

                .progress-hud { padding: 15px 30px; display: flex; justify-content: flex-end; align-items: center; gap: 20px; border-bottom: 1px solid var(--color-border-soft); background: rgba(0,0,0,0.1); }
                .bar-container { width: 200px; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.2); }
                .bar-fill { height: 100%; background: linear-gradient(90deg, var(--app-accent), var(--app-blue)); box-shadow: 0 0 10px rgba(var(--app-accent-rgb), 0.35); transition: width var(--motion-slow) var(--ease-emphasized); }
                .bar-text { font-size: 10px; font-weight: 900; color: var(--app-muted); text-transform: uppercase; letter-spacing: 0.05em; }

                @media (max-width: 1180px) {
                    .dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }

                @media (max-width: 760px) {
                    .command-board-wrapper { height: auto; min-height: calc(100vh - 180px); }
                    .progress-hud { padding: 14px 16px; gap: 12px; flex-wrap: wrap; justify-content: flex-start; }
                    .bar-container { width: 100%; order: 3; }
                    .dashboard-grid { grid-template-columns: minmax(0, 1fr); padding: 12px; gap: 12px; }
                    .col-header { padding: 14px 16px; }
                    .col-content { padding: 12px; }
                }
            `}</style>

            <div className="progress-hud print:hidden">
                <div className="bar-text">
                    {dataSource === 'offline-cache-degraded'
                        ? 'Degraded Offline Cache'
                        : (dataSource === 'offline-cache' ? 'Offline Kitchen Cache' : 'Sync Intelligence Active')}
                </div>
                <div className="bar-container"><div className="bar-fill" style={{ width: `${stats.percent}%` }}></div></div>
                <div className="bar-text">{stats.done} / {stats.total} Ops Complete</div>
            </div>

            <div className="dashboard-grid">
                <div className="board-column" style={{ borderTop: '4px solid var(--app-blue)' }}>
                    <div className="col-header" style={{ color: 'var(--app-blue)' }}><i className="fa-solid fa-calendar-days"></i> Pipelines</div>
                    <div className="col-content">
                        {visibleMainRecipes.length > 0 ? visibleMainRecipes.map(r => renderTaskRows(r, 'weekly', r.data?.weekly || []) && (
                            <div key={r.id} className="recipe-box">
                                <div className="recipe-control" style={{ borderLeftColor: 'var(--app-blue)' }}><span className="recipe-name">{r.dish_name}</span></div>
                                {renderTaskRows(r, 'weekly', r.data?.weekly || [])}
                            </div>
                        )) : <ColumnSkeleton />}
                    </div>
                </div>

                <div className="board-column" style={{ borderTop: '4px solid var(--app-accent)' }}>
                    <div className="col-header" style={{ color: 'var(--app-accent)' }}><i className="fa-solid fa-sun"></i> Daily Batch</div>
                    <div className="col-content">
                        {visibleMainRecipes.filter(r => (productionTargets[r.meta?.id] || 0) > 0).length > 0 ?
                            visibleMainRecipes.filter(r => (productionTargets[r.meta?.id] || 0) > 0).map(r => (
                                <div key={r.id} className="recipe-box active-box">
                                    <div className="recipe-control" style={{ borderLeftColor: 'var(--app-accent)' }}><span className="recipe-name">{r.dish_name}</span></div>
                                    {renderTaskRows(r, 'morning-std', r.data?.morning?.tasks || [])}
                                </div>
                            )) : <ColumnSkeleton count={4} />}
                    </div>
                </div>

                <div className="board-column" style={{ borderTop: '4px solid var(--app-success)' }}>
                    <div className="col-header" style={{ color: 'var(--app-success)' }}><i className="fa-solid fa-bolt"></i> Service Unit</div>
                    <div className="col-content">
                        {visibleMainRecipes.length > 0 ? visibleMainRecipes.map(r => renderTaskRows(r, 'service', r.data?.service || []) && (
                            <div key={r.id} className="recipe-box">
                                <div className="recipe-control" style={{ borderLeftColor: 'var(--app-success)' }}><span className="recipe-name">{r.dish_name}</span></div>
                                {renderTaskRows(r, 'service', r.data?.service || [])}
                            </div>
                        )) : <ColumnSkeleton />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CommandBoard;
