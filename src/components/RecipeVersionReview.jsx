import React, { useCallback, useEffect, useState } from 'react';
import { canonicalizeRecipe, recipeRevisionFingerprint, validateCanonicalRecipe } from '../core/canonicalRecipe';

export default function RecipeVersionReview({ supabase, clientId, user, sourceRecipe }) {
  const [membership, setMembership] = useState(null);
  const [versions, setVersions] = useState([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const refresh = useCallback(async () => {
    if (!clientId || !user?.id) return;
    const { data: member, error: memberError } = await supabase.from('kitchen_memberships')
      .select('role').eq('client_id', clientId).eq('user_id', user.id).maybeSingle();
    if (memberError || !member) {
      setMembership(null);
      setMessage('This kitchen is not connected to recipe version review yet.');
      return;
    }
    setMembership(member);
    const { data, error } = await supabase.from('recipe_versions_v1')
      .select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (error) { setMessage('Could not load recipe versions.'); return; }
    setVersions(data || []);
  }, [supabase, clientId, user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const prepareDraft = () => {
    const recipe = canonicalizeRecipe({ ...sourceRecipe, client_id: clientId });
    setDraft(JSON.stringify(recipe, null, 2));
    setMessage('Check the recipe identity, ingredient identities, quantities, and yield before saving.');
  };

  const saveDraft = async () => {
    try {
      const parsed = JSON.parse(draft);
      const result = validateCanonicalRecipe({ ...parsed, client_id: clientId });
      if (!result.ok) { setMessage(result.errors.join('; ')); return; }
      const recipe = result.recipe;
      setBusy(true);
      const { error } = await supabase.from('recipe_versions_v1').insert({
        client_id: clientId, recipe_ref_id: recipe.recipe_ref_id, canonical_id: recipe.canonical_id,
        version_number: recipe.recipe_version, title: recipe.title, status: 'draft',
        yield_quantity: recipe.yield.quantity, yield_unit: recipe.yield.unit, yield_basis: recipe.yield.basis,
        recipe_json: recipe, source_evidence_ids: recipe.source_evidence_ids,
        content_fingerprint: recipeRevisionFingerprint(recipe), created_by: user.id
      });
      if (error) throw error;
      setDraft(''); setMessage('Draft version saved. Submit it for review when ready.'); await refresh();
    } catch (error) {
      setMessage(error instanceof SyntaxError ? 'The draft is not valid JSON.' : `Could not save draft: ${error.message}`);
    } finally { setBusy(false); }
  };

  const transition = async (row, status) => {
    setBusy(true);
    const { data, error } = await supabase.from('recipe_versions_v1').update({ status })
      .eq('id', row.id).eq('client_id', clientId).eq('status', row.status).select('*').maybeSingle();
    if (error || !data) setMessage(error?.message || 'This version changed. Refresh and try again.');
    else { setSelected(data); setMessage(status === 'review' ? 'Submitted for manager review.' : 'Recipe version approved.'); await refresh(); }
    setBusy(false);
  };

  return <section className="v1-review" aria-label="Recipe versions">
    <h2>Recipe versions</h2>
    <p>Save a new draft, review its ingredients and yield, then approve it for use.</p>
    {message && <p role="status">{message}</p>}
    {membership && <>
      {sourceRecipe && ['owner', 'manager', 'chef'].includes(membership.role) && <button type="button" onClick={prepareDraft}>Prepare draft from selected recipe</button>}
      {draft && <div><label htmlFor="v1-recipe-draft">Draft recipe details</label><textarea id="v1-recipe-draft" rows="14" value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="button" disabled={busy} onClick={saveDraft}>Save draft</button></div>}
      <ul>{versions.map((row) => <li key={row.id}><button type="button" onClick={() => setSelected(row)}>{row.title} · v{row.version_number} · {row.status}</button></li>)}</ul>
      {selected && <article><h3>{selected.title} · v{selected.version_number}</h3><p>Status: {selected.status} · Yield: {selected.yield_quantity} {selected.yield_unit} ({selected.yield_basis})</p>
        <ul>{(selected.recipe_json?.ingredients || []).map((ingredient, index) => <li key={index}>{ingredient.quantity} {ingredient.unit} {ingredient.clean_name} {ingredient.product_form ? `(${ingredient.product_form})` : ''} · {ingredient.canonical_name}</li>)}</ul>
        {selected.status === 'draft' && ['owner', 'manager', 'chef'].includes(membership.role) && <button type="button" disabled={busy} onClick={() => transition(selected, 'review')}>Submit for review</button>}
        {selected.status === 'review' && ['owner', 'manager'].includes(membership.role) && <button type="button" disabled={busy} onClick={() => transition(selected, 'approved')}>Approve version</button>}
      </article>}
    </>}
  </section>;
}
