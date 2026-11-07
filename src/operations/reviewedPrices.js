import { buildPlan, convert } from './engine.js';
const formKey = value => String(value || '').trim().toLowerCase();

export function buildReviewedPlanFromEvidence(project, versions, clientId, evidence, catalog) {
  const demand = buildPlan({ ...project, prices: [] }, versions, clientId);
  const selections = project.priceEvidenceSelections || {};
  const prices = [], states = [];
  for (const leaf of demand.purchasing) {
    const selectedId = selections[leaf.key];
    const row = evidence.find(e => e.id === selectedId && e.client_id === clientId);
    const canonical = catalog.find(c => c.canonical_id === leaf.canonicalId);
    let reason = '';
    if (!selectedId) reason = 'Choose a reviewed price evidence ID.';
    else if (!row || row.match_status !== 'matched' || !row.reviewed_by || !row.reviewed_at) reason = 'The selected price is unavailable or has not completed manager review.';
    else if (!canonical || canonical.id !== row.canonical_ingredient_id || formKey(row.product_form) !== formKey(leaf.form)) reason = 'Canonical identity or product form does not match.';
    else if (row.currency !== project.currency) reason = 'Currency does not match the project.';
    else if (!row.source_document_ref?.trim() || !row.supplier_name?.trim()) reason = 'Supplier/source evidence is missing.';
    else if (row.pack_price === null || row.pack_price === '' || !Number.isFinite(Number(row.pack_price)) || Number(row.pack_price) < 0 || !Number.isFinite(Number(row.pack_quantity)) || Number(row.pack_quantity) <= 0) reason = 'Pack quantity or price is missing.';
    else {
      const age = (Date.parse(project.serviceDate) - Date.parse(row.source_date)) / 86400000;
      if (!Number.isFinite(age) || age < 0 || age > Number(project.priceMaxAgeDays)) reason = 'Price evidence is outside the saved project date/age policy.';
      else { try { convert(row.pack_quantity, row.pack_unit, leaf.unit); } catch { reason = 'UNIT CONVERSION REQUIRED: price pack and ingredient units are incompatible.'; } }
    }
    if (reason) { states.push({ key: leaf.key, evidenceId: typeof selectedId === 'string' ? selectedId : null, state: 'PRICE REQUIRED', reason }); continue; }
    const price = { key: leaf.key, packQuantity: row.pack_quantity, unit: row.pack_unit, packPrice: row.pack_price, currency: row.currency, date: row.source_date, source: row.source_document_ref, reviewed: true, evidenceId: row.id, evidence: structuredClone(row) };
    prices.push(price); states.push({ key: leaf.key, evidenceId: row.id, state: 'reviewed' });
  }
  const calculated = buildPlan({ ...project, prices }, versions, clientId);
  return { ...calculated, project: structuredClone(project), calculationInputs: { pricingPolicy: 'reviewed-evidence-v1', prices, selections: states } };
}
