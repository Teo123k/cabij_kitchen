import React, { useState } from 'react';
import { supabase } from '../supabaseClient.js';
export default function OperationsLogin() {
  const [register, setRegister] = useState(false), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = register
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/?workspace=projects` } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword('');
      if (register) { setMessage('Check your email to confirm your account. Then return here and sign in. Owner access is granted only to the verified invited email.'); setRegister(false); }
      else setMessage('Signed in. Opening your projects…');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <div className="op-auth"><header><a className="op-auth-brand" href="?workspace=projects">CABIJ</a><p>Kitchen operations · Client projects</p></header><main><h1>{register ? 'Create your account' : 'Sign in to your workspace'}</h1><p>Use the email address your administrator invited. Confirm your email before signing in.</p><form onSubmit={submit}><label>Email address<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input required type="password" minLength={register ? 8 : undefined} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label><button className="op-primary" disabled={busy} type="submit">{busy ? 'Working…' : register ? 'Create account' : 'Sign in'}</button></form><p role="status" aria-live="polite">{message}</p><button className="op-auth-switch" disabled={busy} onClick={() => { setRegister(!register); setMessage(''); }}>{register ? 'Already registered? Sign in' : 'First time? Create account'}</button><a href="?workspace=projects&sample=true">Explore the sample workspace</a></main></div>;
}
