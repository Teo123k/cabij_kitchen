import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import OperationsWorkspace from './OperationsWorkspace.jsx';
import { operationsRepository } from './repository.js';
import { sampleEvent } from './fixtures/sample.js';
import { canonicalizeRecipe } from '../core/canonicalRecipe.js';
import OperationsLogin from './OperationsLogin.jsx';
import { observeAuthUser } from './authSession.js';

function demoSession() {
  const sample = sampleEvent();
  let data = { role: 'manager', versions: sample.versions, projects: [{ id: 'demo-project', revision: 1, document: sample.project }], ingredients: [{ canonical_id: 'chicken', canonical_name: 'chicken' }], packages: [] };
  try { const saved = sessionStorage.getItem('cabij-operations-sample-v1'); if (saved) data = JSON.parse(saved); data.projects.forEach(p => { p.document.sample = true; }); } catch { /* A broken sample must not prevent opening the rehearsal. */ }
  const persist = () => sessionStorage.setItem('cabij-operations-sample-v1', JSON.stringify(data));
  return { data: structuredClone(data), repository: {
    async save(project, document) { const row = { id: project?.id || crypto.randomUUID(), revision: (project?.revision || 0) + 1, document: structuredClone(document) }; data.projects = [row, ...data.projects.filter(p => p.id !== row.id)]; persist(); return row; },
    async saveRecipe(input) { const recipe = canonicalizeRecipe({ ...input, client_id: 'demo-kitchen', recipe_version: Math.max(0, ...data.versions.filter(v => v.recipe_json.recipe_ref_id === input.recipe_ref_id).map(v => v.version_number)) + 1 }); const row = { id: crypto.randomUUID(), client_id: 'demo-kitchen', title: recipe.title, version_number: recipe.recipe_version, status: 'draft', recipe_json: recipe }; data.versions.unshift(row); persist(); return row; },
    async transition(row, status) { const changed = { ...row, status }; data.versions = data.versions.map(v => v.id === row.id ? changed : v); persist(); return changed; },
    async approve(project, snapshot) { const row = { id: crypto.randomUUID(), project_id: project.id, project_revision: project.revision, snapshot, approved_at: snapshot.approvedAt }; data.packages.unshift(row); persist(); return row; }
  } };
}
export default function OperationsEntry() {
  useEffect(() => { document.title = 'CABIJ · Client projects'; document.documentElement.classList.add('operations-route'); return () => document.documentElement.classList.remove('operations-route'); }, []);
  const demo = new URLSearchParams(window.location.search).get('sample') === 'true';
  const [state, setState] = useState(null), [error, setError] = useState(''), [user, setUser] = useState(null), [memberships, setMemberships] = useState([]), [kitchen, setKitchen] = useState('');
  useEffect(() => {
    if (demo) { const session = demoSession(); setState({ ...session, clientId: 'demo-kitchen', userId: 'sample-operator' }); return; }
    if (!supabase) { setError('Connect a staging Supabase project to save real client projects. You can explore the sample workspace now.'); return; }
    return observeAuthUser(supabase, { onUser: setUser, onError: error => setError(error.message) });
  }, [demo]);
  const userId = user?.id;
  useEffect(() => {
    if (demo) return;
    setState(null); setMemberships([]); setKitchen(''); setError('');
    if (!userId) return;
    let alive = true;
    supabase.from('kitchen_memberships').select('client_id,role').eq('user_id', userId).then(result => {
      if (!alive) return;
      if (result.error) { setError(result.error.message); return; }
      setMemberships(result.data); setKitchen(result.data[0]?.client_id || '');
      if (!result.data.length) setError('No kitchen membership found. An administrator must provision your access.');
    }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [demo, userId]);
  useEffect(() => {
    if (demo || !kitchen || !userId) return;
    let alive = true; setState(null); setError('');
    const repository = operationsRepository(supabase, kitchen, userId);
    repository.load().then(data => { if (alive) setState({ data, repository, clientId: kitchen, userId }); }).catch(e => { if (alive) setError(`Project workspace unavailable: ${e.message}`); });
    return () => { alive = false; };
  }, [demo, kitchen, userId]);
  if (user === false && !demo) return <OperationsLogin />;
  return <>{memberships.length > 1 && <label className="op-kitchen">Kitchen<select value={kitchen} onChange={e => { if (window.confirm('Switch kitchens? Save your current project first.')) setKitchen(e.target.value); }}>{memberships.map(m => <option key={m.client_id}>{m.client_id}</option>)}</select></label>}{state && (demo || state.userId === userId) ? <OperationsWorkspace key={state.clientId} repository={state.repository} initial={state.data} clientId={state.clientId} userId={state.userId} demo={demo} onExit={() => { window.location.href = '/?workspace=recipes'; }} /> : <div className="op-start"><h1>CABIJ · Client projects</h1><p role="status">{error || 'Opening your workspace…'}</p><a href="?workspace=projects&sample=true">Open sample workspace →</a><a href="/">Back to dashboard</a></div>}</>;
}
