import { workflowRecipe } from './workflowRecipe.js';
const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// Match retained source rows; callers cannot substitute a browser-generated recipe.
export async function matchDocumentCandidate(db, clientId, candidateId) {
  const candidate = checked(await db.from('recipe_document_candidates_v1').select('*').eq('client_id', clientId).eq('id', candidateId).single());
  if (!candidate || !['extracted', 'incomplete'].includes(candidate.status)) throw new Error('A saved extraction candidate is required.');
  const draft = workflowRecipe(candidate.source_recipe).draft;
  const matches = [];
  for (const [index, ingredient] of draft.ingredients.entries()) {
    const match = checked(await db.rpc('resolve_ingredient_identity_v1', { p_client_id: clientId, p_canonical_id: ingredient.canonical_id || '', p_source_name: ingredient.name || ingredient.clean_name || '', p_product_form: ingredient.product_form || '' }));
    matches.push(match);
    if (match.status === 'matched') Object.assign(ingredient, { canonical_id: match.canonical_id, canonical_name: match.canonical_name, canonical_match: match.canonical_match, needs_review: !!candidate.source_recipe.ingredients[index].needs_review || !Number.isFinite(Number(ingredient.quantity)) || Number(ingredient.quantity) <= 0 || !ingredient.unit || (!!ingredient.quantity_confidence && ingredient.quantity_confidence !== 'explicit') || (!!ingredient.amount_kind && ingredient.amount_kind !== 'explicit') });
    else { delete ingredient.canonical_id; delete ingredient.canonical_name; delete ingredient.canonical_match; ingredient.needs_review = true; }
  }
  return { candidateId: candidate.id, draft, matches, readyForCanonicalReview: matches.length > 0 && matches.every(m => m.status === 'matched') };
}

export function ingredientEvidenceRepository(db, clientId, userId) {
  return {
    matchDocumentCandidate: candidateId => matchDocumentCandidate(db, clientId, candidateId),
    async createAlias({ canonicalIngredientId, alias, productForm = '', sourceRef }) {
      return checked(await db.from('kitchen_ingredient_aliases_v1').insert({ client_id: clientId, canonical_ingredient_id: canonicalIngredientId, alias, product_form: productForm, source_ref: sourceRef, created_by: userId }).select('*').single());
    },
    async reviewAlias(id, status) {
      if (!['approved', 'rejected'].includes(status)) throw new Error('Choose approved or rejected.');
      const row = checked(await db.from('kitchen_ingredient_aliases_v1').update({ status }).eq('client_id', clientId).eq('id', id).eq('status', 'review').select('*').maybeSingle());
      if (!row) throw new Error('Alias changed or manager review is unavailable.'); return row;
    },
    async createPrice({ canonicalIngredientId, productForm = '', supplierName, supplierSku = null, sourceRef, sourceDate, sourceDocumentId = null, packQuantity, packUnit, packPrice, currency }) {
      if (packPrice === '' || packPrice === null || packPrice === undefined || !Number.isFinite(Number(packPrice)) || Number(packPrice) < 0 || !Number.isFinite(Number(packQuantity)) || Number(packQuantity) <= 0) throw new Error('PRICE REQUIRED: enter an explicit pack quantity and price.');
      return checked(await db.from('ingredient_price_evidence_v1').insert({ client_id: clientId, canonical_ingredient_id: canonicalIngredientId, product_form: productForm, supplier_name: supplierName, supplier_sku: supplierSku, source_document_ref: sourceRef, source_date: sourceDate, source_document_id: sourceDocumentId, pack_quantity: packQuantity, pack_unit: packUnit, pack_price: packPrice, currency, created_by: userId }).select('*').single());
    },
    async reviewPrice(id, status) {
      if (!['matched', 'rejected'].includes(status)) throw new Error('Choose matched or rejected.');
      const row = checked(await db.from('ingredient_price_evidence_v1').update({ match_status: status }).eq('client_id', clientId).eq('id', id).eq('match_status', 'review').select('*').maybeSingle());
      if (!row) throw new Error('Price changed or manager review is unavailable.'); return row;
    }
  };
}
