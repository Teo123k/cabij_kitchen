import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { useSettings } from './SettingsContext';
import { OFFLINE_CACHE_TYPES } from './config/constants';
import { readOfflineCache, saveOfflineCache } from './config/offlineState';

/**
 * CinematicSOP Component
 * Self-fetching Brigade SOP briefing slider.
 */
const CinematicSOP = ({ clientId = 'kabile', initialDishName, onExit }) => {
    const [slides, setSlides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [dataSource, setDataSource] = useState('online');
    const [current, setCurrent] = useState(0);
    const { language, volumeFocus, translateIngredient } = useSettings();

    // ── Fetch from sop_presentations ─────────────────────────────────────────
    useEffect(() => {
        async function fetchPresentations() {
            setLoading(true);
            setError(null);
            const applySlides = (parsed, source = 'online') => {
                setSlides(parsed);
                setDataSource(source);

                if (initialDishName) {
                    const idx = parsed.findIndex(s =>
                        s.dish_name?.toLowerCase() === initialDishName?.toLowerCase()
                    );
                    if (idx >= 0) setCurrent(idx);
                }
            };

            const applyCachedPresentations = () => {
                const cached = readOfflineCache({ clientId, type: OFFLINE_CACHE_TYPES.SOP_PRESENTATIONS });
                const cachedSlides = cached?.payload?.slides;
                if (!Array.isArray(cachedSlides)) return false;
                applySlides(cachedSlides, 'offline-cache');
                return true;
            };

            const parsePresentationRows = (rows) => (rows || []).map(row => {
                try {
                    return {
                        id: row.id,
                        dish_name: row.dish_name,
                        client_id: row.client_id,
                        data: typeof row.presentation_json === 'string'
                            ? JSON.parse(row.presentation_json)
                            : row.presentation_json,
                    };
                } catch (error) {
                    console.warn('Skipping malformed SOP presentation row:', row?.id, error);
                    return null;
                }
            }).filter(Boolean);

            try {
                if (typeof navigator !== 'undefined' && navigator.onLine === false && applyCachedPresentations()) {
                    return;
                }

                const { data, error: fetchError } = await supabase
                    .from('main_presentations')
                    .select('*')
                    .eq('client_id', clientId)
                    .order('created_at', { ascending: true });

                if (fetchError) throw fetchError;

                const parsed = parsePresentationRows(data);
                applySlides(parsed, 'online');
                saveOfflineCache({
                    clientId,
                    type: OFFLINE_CACHE_TYPES.SOP_PRESENTATIONS,
                    payload: { slides: parsed }
                });
            } catch (fetchError) {
                console.error('sop_presentations fetch error:', fetchError);
                if (!applyCachedPresentations()) {
                    setError(fetchError.message);
                    setSlides([]);
                    setDataSource('missing-cache');
                }
            } finally {
                setLoading(false);
            }
        }
        fetchPresentations();
    }, [clientId, initialDishName]);

    const moveSlide = useCallback((dir) => {
        const total = slides.length > 0 ? slides.length : 1;
        setCurrent(prev => (prev + dir + total) % total);
    }, [slides.length]);

    const goToSlide = (i) => setCurrent(i);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowRight') moveSlide(1);
            if (e.key === 'ArrowLeft') moveSlide(-1);
            if (e.key === 'Escape') onExit && onExit();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [moveSlide, onExit]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] text-zinc-500 opacity-40">
                <i className="fa-solid fa-spinner fa-spin text-3xl mb-4 text-app-accent"></i>
                <p className="font-black uppercase tracking-[0.3em] text-[9px]">Syncing Cinematic Data…</p>
            </div>
        );
    }

    if (dataSource === 'missing-cache') {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] text-center px-10">
                <p className="font-black uppercase tracking-[0.3em] text-[9px] text-app-accent mb-4">Offline SOP Cache Missing</p>
                <h2 className="text-3xl font-black uppercase tracking-tight text-white mb-4">Reconnect to Hydrate Cook View</h2>
                <p className="text-app-muted text-xs font-bold uppercase tracking-widest max-w-xl leading-loose">
                    This device does not have hydrated SOP presentations for this kitchen yet. Demo content is hidden while offline so it is not mistaken for client data.
                </p>
                {error && <p className="mt-6 text-[10px] font-bold uppercase tracking-widest text-app-danger">{error}</p>}
            </div>
        );
    }

    // High Fidelity Demo Slide when no data is found
    const displaySlides = slides.length > 0 ? slides : [
        {
            id: 'demo-slide',
            dish_name: 'DEMO_HUB_DISH',
            data: {
                meta: 'SYSTEM // SOP_BRIEFING_INTERFACES',
                title: 'Operation Briefing Active',
                mission: [
                    'Mastering dynamic kitchen pipelines',
                    'Strategic batch optimization',
                    'Standardizing culinary intelligence'
                ],
                weekly: { batch: ['Standardized batch cycle'], buffer: ['Safety levels active'] },
                morning: { tasks: ['Processing daily requirements'], forward: ['Supply chain integration'] },
                service: { setup: ['Station readiness check'], garnish: ['Finishing touch spec'] },
                holding: { method: 'CHILL / AMBIENT', limit: '72hr Max', temp: '0-4°C' },
                strategy: { method: 'Unified SOP Protocol', tips: 'Data-driven execution' },
                maintenance: 'Ready for client ingestion'
            }
        }
    ];

    return (
        <div className="cinematic-presentation-container flex flex-col items-center py-10 min-h-[800px]">
            <style>{`
        .slider-window {
          width: 1280px;
          height: 720px;
          position: relative;
          border: 1px solid var(--app-border-soft);
          overflow: hidden;
          background: var(--app-bg);
          box-shadow: var(--shadow-modal);
          font-family: 'Inter', sans-serif;
          color: var(--app-text);
          border-radius: var(--radius-xl);
        }

        .slides-container {
          display: flex;
          transition: transform 0.6s cubic-bezier(0.23, 1, 0.32, 1);
          height: 100%;
          width: 100%;
        }

        .slide {
          min-width: 1280px;
          height: 100%;
          display: grid;
          grid-template-rows: 120px 1fr 60px;
          background: transparent;
        }

        .nav-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.05);
          color: white;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          cursor: pointer;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
          backdrop-filter: blur(10px);
        }
        .nav-btn:hover { background: var(--highlight); border-color: var(--highlight); transform: translateY(-50%) scale(1.1); box-shadow: 0 0 30px var(--highlight); }
        .prev { left: 20px; }
        .next { right: 20px; }

        .slide-header {
          padding: 0 60px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--app-border-soft);
          background: var(--app-surface-dense);
        }
        .header-title-box h2 { font-size: 32px; font-weight: 900; text-transform: uppercase; letter-spacing: -1.5px; margin: 0; line-height: 1; }
        .header-title-box p { font-family: 'JetBrains Mono'; font-size: 10px; color: var(--highlight); text-transform: uppercase; letter-spacing: 4px; margin: 0 0 8px 0; opacity: 0.8; }
        .header-viz { width: 180px; height: 80px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; background: #000; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .header-viz img { width: 100%; height: 100%; object-fit: cover; opacity: 0.9; filter: contrast(1.1); transition: transform 0.8s ease; }
        .slide:hover .header-viz img { transform: scale(1.05); }

        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr 440px;
          gap: 25px;
          padding: 30px 60px;
        }

        .timeline-column {
          display: grid;
          grid-template-rows: repeat(3, 1fr);
          gap: 15px;
        }

        .op-card {
          background: var(--app-surface-soft);
          border: 1px solid var(--app-border-soft);
          padding: 24px;
          position: relative;
          border-left: 4px solid var(--app-border);
          border-radius: var(--radius-lg);
          transition: all 0.3s ease;
        }
        .op-card.active-phase { border-left-color: var(--highlight); background: rgba(59, 130, 246, 0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
        .op-label { font-size: 10px; font-weight: 900; text-transform: uppercase; color: var(--highlight); margin-bottom: 16px; display: flex; align-items: center; gap: 10px; letter-spacing: 0.1em; }

        .bullet-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
        .bullet-item h4 { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; }
        .bullet-item ul { list-style: none; padding: 0; margin: 0; }
        .bullet-item li { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 6px; line-height: 1.4; position: relative; padding-left: 15px; }
        .bullet-item li::before { content: ""; position: absolute; left: 0; top: 7px; width: 4px; height: 4px; background: var(--highlight); border-radius: 50%; box-shadow: 0 0 10px var(--highlight); }

        .logic-column { display: flex; flex-direction: column; gap: 15px; }
        .logic-module { background: var(--app-surface-soft); border: 1px solid var(--app-border-soft); padding: 24px; border-radius: var(--radius-lg); }
        .strategy-header { font-size: 11px; font-weight: 900; color: #fbbf24; text-transform: uppercase; margin-bottom: 20px; letter-spacing: 1.5px; display: flex; align-items: center; gap: 10px; }

        .stat-line { display: flex; justify-content: space-between; font-size: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .stat-line:last-child { border-bottom: none; }
        .stat-line span:first-child { color: rgba(255,255,255,0.3); font-weight: 800; text-transform: uppercase; font-size: 9px; }
        .stat-line span:last-child { font-weight: 800; color: #fff; text-align: right; max-width: 65%; line-height: 1.4; }

        .dish-mission { flex: 1; padding: 0 50px; display: flex; flex-direction: column; justify-content: center; border-left: 1px solid rgba(255,255,255,0.05); height: 100%; }
        .mission-label { font-size: 10px; font-weight: 900; color: var(--highlight); text-transform: uppercase; letter-spacing: 2.5px; margin-bottom: 12px; opacity: 0.6; }
        .mission-list { margin: 0; padding: 0; list-style: none; }
        .mission-list li { font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 8px; position: relative; padding-left: 20px; line-height: 1.1; letter-spacing: -0.02em; }
        .mission-list li::before { content: "›"; position: absolute; left: 0; color: var(--highlight); font-size: 20px; top: -2px; }

        .logic-module.intel { background: rgba(59, 130, 246, 0.03); border: 1px solid rgba(59, 130, 246, 0.2); }
        .intel-spec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .intel-spec-item { display: flex; flex-direction: column; gap: 4px; }
        .intel-label { font-size: 8px; font-weight: 900; color: rgba(59, 130, 246, 0.5); text-transform: uppercase; letter-spacing: 1px; }
        .intel-value { font-size: 13px; font-weight: 900; color: #fff; text-transform: uppercase; }

        .slide-footer {
          padding: 0 60px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--app-border-soft);
          background: var(--app-surface-dense);
          border-radius: 0 0 var(--radius-xl) var(--radius-xl);
        }
        .maintenance-tag { font-family: 'JetBrains Mono'; font-size: 10px; color: rgba(255,255,255,0.2); font-weight: 900; text-transform: uppercase; }
        .maintenance-tag span { color: #fff; opacity: 0.8; margin-left: 10px; }

        .dots { position: absolute; bottom: 25px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 10; }
        .dot { width: 10px; height: 10px; background: rgba(255,255,255,0.1); border-radius: 50%; cursor: pointer; transition: all 0.4s ease; border: 1px solid transparent; }
        .dot.active { background: var(--highlight); width: 32px; border-radius: 6px; box-shadow: 0 0 20px var(--highlight); }
      `}</style>

            <div className="slider-window">
                {slides.length > 1 && (
                    <>
                        <button className="nav-btn prev" onClick={() => moveSlide(-1)}>
                            <i className="fa-solid fa-chevron-left"></i>
                        </button>
                        <button className="nav-btn next" onClick={() => moveSlide(1)}>
                            <i className="fa-solid fa-chevron-right"></i>
                        </button>
                    </>
                )}

                <div className="slides-container" style={{ transform: `translateX(-${current * 1280}px)` }}>
                    {displaySlides.map((slide, index) => {
                        const sd = slide.data || {};
                        const isDemo = slide.id === 'demo-slide';
                        return (
                            <div key={slide.id} className={`slide ${isDemo ? 'demo-mode' : ''}`}>
                                <header className="slide-header">
                                    <div className="header-title-box" style={{ minWidth: '400px' }}>
                                        <p>{sd.meta || 'RECIPE // BRIGADE_SOP'}</p>
                                        <div className="flex items-center gap-4">
                                            <h2>{(sd.title || slide.dish_name || '').replace(/^\d+[\s.\-_]*/, '')}</h2>
                                            {!isDemo && (
                                                <div className="bg-app-accent/10 border border-app-accent/30 px-3 py-1 rounded-full text-[10px] font-black text-app-accent uppercase tracking-widest backdrop-blur-sm">
                                                    {volumeFocus} PPL HUB Focus
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="dish-mission">
                                        <span className="mission-label">System Intelligence // Focus</span>
                                        <ul className="mission-list">
                                            {sd.mission?.map((m, i) => <li key={i}>{m}</li>) || (
                                                <>
                                                    <li>Culinary data integrity</li>
                                                    <li>Automated operational pipelines</li>
                                                    <li>Scaling logic synchronization</li>
                                                </>
                                            )}
                                        </ul>
                                    </div>

                                    <div className="header-viz">
                                        <img
                                            src={sd.image || (isDemo ? 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=2670&auto=format&fit=crop' : 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=2680&auto=format&fit=crop')}
                                            alt="Operational Brief"
                                        />
                                    </div>
                                </header>

                                <div className="dashboard-grid">
                                    <div className="timeline-column">
                                        <div className="op-card">
                                            <span className="op-label"><i className="fa-solid fa-calendar-check text-[12px]"></i> Pipeline Strategy</span>
                                            <div className="bullet-grid">
                                                <div className="bullet-item">
                                                    <h4>Batch Cycle</h4>
                                                    <ul>{sd.weekly?.batch?.map((b, i) => <li key={i}>{b}</li>) || <li>Cycle Active</li>}</ul>
                                                </div>
                                                <div className="bullet-item">
                                                    <h4>Safety Buffer</h4>
                                                    <ul>{sd.weekly?.buffer?.map((b, i) => <li key={i}>{b}</li>) || <li>Auto-Calculated</li>}</ul>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="op-card active-phase">
                                            <span className="op-label"><i className="fa-solid fa-sun text-[12px]"></i> Daily Batch Operations</span>
                                            <div className="bullet-grid">
                                                <div className="bullet-item">
                                                    <h4>Batch Prep</h4>
                                                    <ul>{sd.morning?.tasks?.map((t, i) => <li key={i}>{t}</li>) || <li>Sync Intelligence</li>}</ul>
                                                </div>
                                                <div className="bullet-item">
                                                    <h4>Forward Log</h4>
                                                    <ul>{sd.morning?.forward?.map((f, i) => <li key={i}>{f}</li>) || <li>Supply Ready</li>}</ul>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="op-card">
                                            <span className="op-label"><i className="fa-solid fa-bolt text-[12px]"></i> Service Unit Readiness</span>
                                            <div className="bullet-grid">
                                                <div className="bullet-item">
                                                    <h4>Station Setup</h4>
                                                    <ul>{sd.service?.setup?.map((s, i) => <li key={i}>{s}</li>) || <li>Line Active</li>}</ul>
                                                </div>
                                                <div className="bullet-item">
                                                    <h4>Execution Logic</h4>
                                                    <ul>{sd.service?.garnish?.map((g, i) => <li key={i}>{g}</li>) || <li>Standard Spec</li>}</ul>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="logic-column">
                                        <div className="logic-module intel">
                                            <span className="strategy-header" style={{ color: '#3b82f6', marginBottom: '20px' }}>
                                                <i className="fa-solid fa-clipboard-check"></i> Manager Intelligence
                                            </span>
                                            <div className="intel-spec-grid">
                                                <div className="intel-spec-item">
                                                    <span className="intel-label">Critical Holding</span>
                                                    <span className="intel-value">{sd.holding?.method || 'N/A'}</span>
                                                </div>
                                                <div className="intel-spec-item">
                                                    <span className="intel-label">Shelf Life</span>
                                                    <span className="intel-value">{sd.holding?.limit || 'PENDING'}</span>
                                                </div>
                                                <div className="intel-spec-item">
                                                    <span className="intel-label">Precision Temp</span>
                                                    <span className="intel-value">{sd.holding?.temp || '0-4°C'}</span>
                                                </div>
                                                <div className="intel-spec-item">
                                                    <span className="intel-label">Audit Frequency</span>
                                                    <span className="intel-value">SHIFT START</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="logic-module strategy">
                                            <span className="strategy-header"><i className="fa-solid fa-gauge-high"></i> Operating Protocol</span>
                                            <div className="stat-line"><span>Primary Strategy</span><span>{sd.strategy?.method || 'Standard'}</span></div>
                                            <div className="stat-line"><span>Focus Points</span><span>{sd.strategy?.tips || 'N/A'}</span></div>
                                            <div className="stat-line"><span>System status</span><span>{isDemo ? 'Awaiting Data Ingestion' : 'Live Data Active'}</span></div>
                                        </div>
                                    </div>
                                </div>

                                <footer className="slide-footer">
                                    <div className="maintenance-tag">MAINTENANCE_ID: <span>{sd.maintenance || 'SYSTEM_STABLE'}</span></div>
                                    <div className="flex gap-3">
                                        <span className="bg-zinc-800 text-zinc-500 font-black text-[9px] px-3 py-1.5 rounded uppercase tracking-[0.2em] border border-white/5">Auto-Briefing Mode</span>
                                    </div>
                                </footer>
                            </div>
                        );
                    })}
                </div>

                {displaySlides.length > 1 && (
                    <div className="dots">
                        {displaySlides.map((_, i) => (
                            <div
                                key={i}
                                className={`dot ${i === current ? 'active' : ''}`}
                                onClick={() => goToSlide(i)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-8 flex gap-6 text-app-muted text-[10px] font-black uppercase tracking-[0.2em] bg-app-surface/50 px-10 py-3 rounded-2xl border border-white/5 items-center backdrop-blur-xl shadow-2xl">
                <span className="flex items-center gap-3 px-4 py-2 bg-black/40 rounded-xl border border-white/5 shadow-inner">
                    <kbd className="text-white">←</kbd>
                    <kbd className="text-white">→</kbd>
                    NAVIGATE
                </span>
                <div className="w-px h-4 bg-white/10" />
                <span className="flex items-center gap-3 px-4 py-2 bg-black/40 rounded-xl border border-white/5 shadow-inner">
                    <kbd className="text-white">ESC</kbd>
                    EXIT
                </span>
                <button onClick={onExit} className="ml-6 text-app-accent hover:text-white transition-all hover:scale-105">Close Interface</button>
            </div>
        </div>
    );
};

export default CinematicSOP;
