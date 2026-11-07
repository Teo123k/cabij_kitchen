import { buildPlan } from '../src/operations/engine.js';
import { buildReviewedPlanFromEvidence } from '../src/operations/reviewedPrices.js';
const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function buildReviewedPlan(project, versions, clientId, db) {
  const demand = buildPlan({ ...project, prices: [] }, versions, clientId);
  const selections = project.priceEvidenceSelections || {};
  const ids = [...new Set(demand.purchasing.map(leaf => selections[leaf.key]).filter(id => typeof id === 'string' && id))];
  const evidence = ids.length ? checked(await db.from('ingredient_price_evidence_v1').select('*').eq('client_id', clientId).in('id', ids)) : [];
  const canonicalIds = [...new Set(demand.purchasing.map(leaf => leaf.canonicalId))];
  const catalog = canonicalIds.length ? checked(await db.from('canonical_ingredients_v1').select('id,canonical_id').in('canonical_id', canonicalIds)) : [];
  return buildReviewedPlanFromEvidence(project, versions, clientId, evidence, catalog);
}
