import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Login from './Login';
import Dashboard from './Dashboard';
import CommandBoard from './CommandBoard';
import { Loader2, ChefHat, WifiOff } from 'lucide-react';
import { APP_STRINGS, OFFLINE_BLOCK_REASONS } from './config/constants';
import { buildOfflineLaunchProfile, readOfflineReadiness, saveOfflineReadiness } from './config/offlineState';

const PREVIEW_SURFACES = {
    COMMAND_BOARD: 'command-board'
};

const App = () => {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userProfile, setUserProfile] = useState(null);
    const [launchGate, setLaunchGate] = useState({
        status: 'checking',
        reason: null
    });

    const hydrateOfflineReadiness = (profile, user) => {
        const clientId = profile?.client_id || user?.user_metadata?.client_id || null;
        if (!clientId || !user?.id) return;

        saveOfflineReadiness({
            clientId,
            userId: user.id,
            profileId: profile?.id || user.id,
            profileSnapshot: {
                id: profile?.id || user.id,
                client_id: clientId,
                role: profile?.role || 'staff',
                full_name: profile?.full_name || ''
            }
        });
    };

    useEffect(() => {
        if (!supabase) { setLoading(false); return; }
        // 1. Initial Session Check
        supabase.auth.getSession()
            .then(({ data: { session } }) => {
                setSession(session);
                if (session) fetchProfile(session.user);
                else setLoading(false);
            })
            .catch(err => {
                console.error("Auth session handshake failed:", err);
                setLoading(false);
            });

        // 2. Listen for Auth Changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session) fetchProfile(session.user);
            else {
                setUserProfile(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchProfile = async (user) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .maybeSingle();

            if (error) throw error;

            const clientId = data?.client_id || user?.user_metadata?.client_id || null;
            if (data && clientId) {
                setUserProfile(data);
                hydrateOfflineReadiness(data, user);
                setLaunchGate({ status: 'ready', reason: null });
                return;
            }

            if (clientId) {
                const fallbackProfile = {
                    id: data?.id || user.id,
                    client_id: clientId,
                    role: data?.role || user?.user_metadata?.role || 'staff',
                    full_name: data?.full_name || user?.user_metadata?.full_name || '',
                    profileSnapshot: {
                        id: data?.id || user.id,
                        client_id: clientId,
                        role: data?.role || user?.user_metadata?.role || 'staff',
                        full_name: data?.full_name || user?.user_metadata?.full_name || ''
                    }
                };

                setUserProfile(fallbackProfile);
                hydrateOfflineReadiness(fallbackProfile, user);
                setLaunchGate({ status: 'ready', reason: null });
                return;
            }

            setUserProfile(null);
            setLaunchGate({ status: 'profile-pending', reason: null });
        } catch (error) {
            console.error('Error fetching profile:', error);
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                const readiness = readOfflineReadiness({
                    clientId: user?.user_metadata?.client_id,
                    userId: user?.id
                });

                if (readiness) {
                    setUserProfile(buildOfflineLaunchProfile(readiness, user?.id));
                    setLaunchGate({ status: 'ready', reason: null });
                    return;
                }

                setUserProfile(null);
                setLaunchGate({
                    status: 'blocked',
                    reason: OFFLINE_BLOCK_REASONS.OFFLINE_BEFORE_HYDRATION
                });
                return;
            }

            setUserProfile(null);
            setLaunchGate({ status: 'profile-pending', reason: null });
        } finally {
            setLoading(false);
        }
    };

    const [showTroubleshoot, setShowTroubleshoot] = useState(false);
    useEffect(() => {
        if (loading) {
            const timer = setTimeout(() => setShowTroubleshoot(true), 8000);
            return () => clearTimeout(timer);
        }
    }, [loading]);

    if (loading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-app-bg">
                <div className="relative">
                    <Loader2 className="animate-spin text-app-accent" size={48} />
                    <ChefHat className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-app-accent/20" size={20} />
                </div>
                <div className="flex flex-col items-center gap-2">
                    <div className="text-app-accent font-black uppercase text-[10px] tracking-[0.3em] animate-pulse">Establishing Session</div>
                    <div className="text-white/20 font-black uppercase text-[8px] tracking-widest">Cabij Operational OS</div>
                </div>
                
                {showTroubleshoot && (
                    <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center gap-4">
                        <p className="text-app-muted text-[10px] font-bold uppercase tracking-widest">Taking longer than expected?</p>
                        <button 
                            onClick={() => window.location.reload()}
                            className="cabij-focus-ring rounded-lg border border-white/10 bg-white/5 px-6 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors duration-200 hover:bg-white/10"
                        >
                            Hard Refresh
                        </button>
                    </div>
                )}
            </div>
        );
    }

    if (!supabase) return <div style={{ padding: 48, background: '#f6f7f2', color: '#18372b', minHeight: '100vh' }}><h1>CABIJ Kitchen Operations</h1><p>Connect a staging Supabase project for client work.</p><a href="?workspace=projects&sample=true">Open the sample project workspace →</a></div>;

    if (!session) {
        return <Login />;
    }

    if (launchGate.status === 'blocked') {
        return (
            <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center p-10 text-center">
                <WifiOff size={60} className="text-app-accent mb-6 opacity-20" />
                <h1 className="text-white font-black text-2xl uppercase tracking-tighter mb-4">{APP_STRINGS.OFFLINE_BLOCKED_TITLE}</h1>
                <p className="text-app-muted text-xs font-bold uppercase tracking-widest max-w-md leading-loose">
                    {APP_STRINGS.OFFLINE_BLOCKED_SUBTITLE}
                </p>
            </div>
        );
    }

    if (!userProfile) {
        return (
            <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center p-10 text-center">
                <ChefHat size={60} className="text-app-accent mb-6 opacity-20" />
                <h1 className="text-white font-black text-2xl uppercase tracking-tighter mb-4">Profile Synchronization Pending</h1>
                <p className="text-app-muted text-xs font-bold uppercase tracking-widest max-w-md leading-loose">
                    Your account has been authenticated, but your operational profile is still initializing. 
                    Please contact management if this screen persists.
                </p>
            </div>
        );
    }

    const previewSurface = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('cabij-preview')
        : null;

    if (previewSurface === PREVIEW_SURFACES.COMMAND_BOARD) {
        return <CommandBoard clientId={userProfile.client_id} />;
    }

    return <Dashboard client_id={userProfile.client_id} userProfile={userProfile} sessionUser={session?.user || null} />;
};

export default App;
