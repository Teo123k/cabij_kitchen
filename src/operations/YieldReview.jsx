import React from 'react';
import { calculateYield, yieldLines, yieldStages } from './yield.js';
export function YieldSummary({ profile, scale = 1, targetPortions = null, actual = {} }) {
  const report = calculateYield(profile, scale, targetPortions, actual);
  return <div className="op-yield-summary"><h3>Yield calculation detail</h3>{yieldLines(report).map((line, i) => <p key={i}>{line}</p>)}</div>;
}
export default function YieldReview({ profile = {}, onChange }) {
  const change = patch => onChange({ ...profile, ...patch, reviewed: false });
  return <section><h3>Batch yield & portion control</h3><p>Use grams for every stage. Keep the same batch and ingredient scope; record additions in the evidence. Missing weights remain unknown.</p>
    {yieldStages.map(([key, label]) => <div className="op-edit-row" key={key}><strong>{label}</strong><label>{label} grams<input type="number" min="0" step="any" value={profile[key]?.grams ?? ''} onChange={e => change({ [key]: { ...profile[key], grams: e.target.value } })} /></label><label>{label} evidence type<select value={profile[key]?.basis || 'assumed'} onChange={e => change({ [key]: { ...profile[key], basis: e.target.value } })}><option value="assumed">Assumed / planned</option><option value="measured">Measured</option></select></label><label>{label} source / measurement<input value={profile[key]?.source || ''} onChange={e => change({ [key]: { ...profile[key], source: e.target.value } })} /></label></div>)}
    <div className="op-fields"><label>Finished portion weight (g)<input type="number" min="0.001" step="any" value={profile.portion_g ?? ''} onChange={e => change({ portion_g: e.target.value })} /></label></div><label className="op-check"><input type="checkbox" checked={!!profile.same_scope} onChange={e => change({ same_scope: e.target.checked })} />Batch and ingredient scope checked</label><label className="op-check"><input type="checkbox" checked={!!profile.reviewed} onChange={e => onChange({ ...profile, reviewed: e.target.checked })} />Yield measurements and assumptions reviewed</label><YieldSummary profile={profile} /></section>;
}
