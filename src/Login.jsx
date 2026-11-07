import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { ChefHat, Lock, Mail, Loader2, Info, UserPlus, LogIn, Store } from 'lucide-react';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [clientId, setClientId] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        if (isRegistering) {
            // REGISTRATION LOGIC
            const { error: authError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        client_id: clientId.toLowerCase().trim().replace(/\s+/g, '-'),
                    }
                }
            });

            if (authError) {
                setError(authError.message);
                setLoading(false);
            } else {
                setMessage("Success! Check your email to confirm registration, then log in.");
                setIsRegistering(false);
                setLoading(false);
            }
        } else {
            // LOGIN LOGIC
            const { error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) {
                setError(authError.message);
                setLoading(false);
            } else {
                setMessage("Signed in. Loading kitchen workspace...");
                setLoading(false);
            }
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-app-bg px-4 py-20 relative overflow-hidden">
            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-app-accent/10 text-app-accent mb-4 shadow-lg ring-1 ring-app-accent/20">
                        <ChefHat size={32} />
                    </div>
                    <h1 className="text-4xl font-black text-app-text tracking-tighter uppercase">SOP Master Hub</h1>
                    <p className="text-app-muted text-sm font-bold uppercase tracking-widest mt-1">Kitchen Operational System</p>
                </div>

                <div className="bg-app-surface border border-app-border-soft rounded-2xl p-8 shadow-premium">
                    <div className="flex bg-app-surface-dense p-1 rounded-xl mb-8 border border-app-border">
                        <button
                            onClick={() => { setIsRegistering(false); setError(null); setMessage(null); }}
                            className={`cabij-focus-ring flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors duration-200 ${!isRegistering ? 'bg-app-accent text-app-bg shadow-accent-glow' : 'text-app-muted hover:text-app-text target:bg-white/5'}`}
                        >
                            <LogIn size={14} /> Login
                        </button>
                        <button
                            onClick={() => { setIsRegistering(true); setError(null); setMessage(null); }}
                            className={`cabij-focus-ring flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors duration-200 ${isRegistering ? 'bg-app-accent text-app-bg shadow-accent-glow' : 'text-app-muted hover:text-app-text target:bg-white/5'}`}
                        >
                            <UserPlus size={14} /> Register
                        </button>
                    </div>

                    <div className="mb-6 rounded-xl border border-app-border bg-app-surface-dense px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-app-muted">
                        {isRegistering
                            ? 'Register once with your workspace id. After that, login only needs email and access code.'
                            : 'Login only needs your work email and access code.'}
                    </div>

                    <form onSubmit={handleAuth} className="space-y-5">
                        {isRegistering && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="block text-sm font-semibold text-app-text uppercase tracking-widest mb-2 ml-1">Workspace ID (e.g. cabij)</label>
                                <div className="relative group">
                                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted transition-colors group-focus-within:text-app-accent" size={18} />
                                    <input
                                        type="text"
                                        required
                                        placeholder="your-workspace-id"
                                        name="client_id"
                                        autoComplete="organization"
                                        spellCheck={false}
                                        className="cabij-input-base three-meter-text w-full rounded-xl border border-app-border bg-app-surface-soft py-3 pl-10 pr-4 text-[13px] text-app-text placeholder:text-app-muted/50 focus-visible:border-app-accent focus-visible:bg-app-surface focus-visible:ring-1 focus-visible:ring-app-accent/50"
                                        value={clientId}
                                        onChange={(e) => setClientId(e.target.value)}
                                    />
                                </div>
                                <p className="mt-2 ml-1 text-[11px] font-bold uppercase tracking-widest text-app-muted">
                                    This is your kitchen workspace id, not your email. You only enter it when creating the account.
                                </p>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-semibold text-app-text uppercase tracking-widest mb-2 ml-1">Work Email</label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted transition-colors group-focus-within:text-app-accent" size={18} />
                                <input
                                    type="email"
                                    required
                                    placeholder="chef@restaurant.com"
                                    name="email"
                                    autoComplete="email"
                                    spellCheck={false}
                                    className="cabij-input-base three-meter-text w-full rounded-xl border border-app-border bg-app-bg py-3.5 pl-10 pr-4 text-base text-app-text placeholder:text-app-muted/50 focus-visible:border-app-accent focus-visible:bg-app-surface-soft focus-visible:ring-2 focus-visible:ring-app-accent/50"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-app-text uppercase tracking-widest mb-2 ml-1">Access Code</label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted transition-colors group-focus-within:text-app-accent" size={18} />
                                <input
                                    type="password"
                                    required
                                    placeholder="••••••••"
                                    name="password"
                                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                                    className="cabij-input-base three-meter-text w-full rounded-xl border border-app-border bg-app-bg py-3.5 pl-10 pr-4 text-base text-app-text placeholder:text-app-muted/50 focus-visible:border-app-accent focus-visible:bg-app-surface-soft focus-visible:ring-2 focus-visible:ring-app-accent/50"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        {error && (
                            <div aria-live="polite" className="bg-app-danger/10 border border-app-danger/20 p-4 rounded-xl flex items-center gap-3 text-app-danger animate-in fade-in slide-in-from-top-2">
                                <Info size={18} className="shrink-0" />
                                <p className="text-sm font-bold uppercase tracking-tight">{error}</p>
                            </div>
                        )}

                        {message && (
                            <div aria-live="polite" className="bg-app-success/10 border border-app-success/20 p-4 rounded-xl flex items-center gap-3 text-app-success animate-in fade-in slide-in-from-top-2">
                                <Info size={18} className="shrink-0" />
                                <p className="text-sm font-bold uppercase tracking-tight">{message}</p>
                            </div>
                        )}

                        <button
                            disabled={loading}
                            type="submit"
                            className="cabij-focus-ring flex w-full items-center justify-center gap-2 rounded-xl bg-app-accent py-4 text-sm font-bold uppercase tracking-widest text-app-bg shadow-accent-glow transition-colors duration-200 hover:bg-app-accent/90 disabled:opacity-50"
                        >
                            {loading ? (
                                <Loader2 size={20} className="animate-spin" />
                            ) : (
                                isRegistering ? 'Create Master Account' : 'Enter Kitchen'
                            )}
                        </button>
                    </form>
                </div>

                <p className="text-center mt-8 text-[10px] font-black text-app-muted uppercase tracking-widest">
                    Powered by Cabij Menu Consulting
                </p>
            </div>
        </div>
    );
};

export default Login;
