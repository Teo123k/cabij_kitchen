import { canonicalizeRecipe, validateCanonicalRecipe, recipeRevisionFingerprint } from '../core/canonicalRecipe.js';
import { ingredientEvidenceRepository } from './ingredientEvidence.js';
const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
export function operationsRepository(db, clientId, userId) {
  const calculationRequest = async (operation, input) => {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.access_token) throw new Error('Sign in before calculating.');
    const response = await fetch(`/api/local-calculation/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ ...input, clientId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Trusted calculation is unavailable.');
    return result;
  };
  const documentRequest = async (operation, input) => {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.access_token) throw new Error('Sign in before accessing documents.');
    const response = await fetch(`/api/local-documents/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ ...input, clientId }) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Start the local dashboard server to access documents.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Document intake is unavailable.');
    return result;
  };
  return {
    ...ingredientEvidenceRepository(db, clientId, userId),
    async loadEvidence() {
      const results = await Promise.all([
        db.from('canonical_ingredients_v1').select('id,canonical_id,canonical_name'),
        db.from('kitchen_ingredient_aliases_v1').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
        db.from('ingredient_price_evidence_v1').select('*').eq('client_id', clientId).order('source_date', { ascending: false }),
        db.from('recipe_documents_v1').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
        db.from('recipe_document_candidates_v1').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
      ]);
      const [catalog, aliases, prices, documents, candidates] = results.map(checked);
      return { catalog, aliases, prices, documents, candidates };
    },
    uploadDocument: (filename, content) => documentRequest('upload', { filename, content }),
    uploadDraftDocument: (filename, content) => documentRequest('draft', { filename, content }),
    downloadDocument: documentId => documentRequest('download', { documentId }),
    async load() {
      const member = checked(await db.from('kitchen_memberships').select('role').eq('client_id', clientId).eq('user_id', userId).maybeSingle());
      if (!member) throw new Error('Kitchen membership is required. Ask your administrator to provision access.');
      const results = await Promise.all([
        db.from('operations_projects_v1').select('*').eq('client_id', clientId).order('updated_at', { ascending: false }),
        db.from('recipe_versions_v1').select('*').eq('client_id', clientId).order('version_number', { ascending: false }),
        db.from('canonical_ingredients_v1').select('canonical_id,canonical_name'),
        db.from('operations_packages_v1').select('*').eq('client_id', clientId).order('approved_at', { ascending: false }),
        db.from('recipe_workflow_imports_v1').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
      ]);
      const [projects, versions, ingredients, packages, workflowImports] = results.map(checked);
      return { role: member.role, projects, versions, ingredients, packages, workflowImports };
    },
    async slackBindings(operation, input = {}) {
      const { data: { session } } = await db.auth.getSession();
      if (!session?.access_token) throw new Error('Sign in before managing Slack links.');
      const response = await fetch(`/api/local-slack/bindings/${operation}`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify({ clientId, ...input }) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Start the local dashboard server to manage Slack links.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Slack linking is unavailable.');
      return result;
    },
    async loadTaskCompletions() {
      return checked(await db.from('operations_task_completion_v1').select('*').eq('client_id', clientId));
    },
    async setTaskCompletion(projectId, packageId, taskId, completed) {
      return checked(await db.from('operations_task_completion_v1').upsert({ client_id: clientId, project_id: projectId, package_id: packageId, task_id: taskId, status: completed ? 'completed' : 'pending' }, { onConflict: 'package_id,task_id' }).select('*').single());
    },
    async save(project, document) {
      const query = project?.id
        ? db.from('operations_projects_v1').update({ document, revision: project.revision + 1 }).eq('id', project.id).eq('client_id', clientId).eq('revision', project.revision)
        : db.from('operations_projects_v1').insert({ client_id: clientId, document, created_by: userId });
      const saved = checked(await query.select('*').maybeSingle());
      if (!saved) throw new Error('Another operator changed this project. Reload before saving; your edits have not overwritten theirs.');
      return saved;
    },
    async saveRecipe(input) {
      const recipe = canonicalizeRecipe({ ...input, client_id: clientId });
      const result = validateCanonicalRecipe(recipe);
      if (!result.ok) throw new Error(result.errors.join('; '));
      const prior = checked(await db.from('recipe_versions_v1').select('version_number').eq('client_id', clientId).eq('recipe_ref_id', recipe.recipe_ref_id).order('version_number', { ascending: false }).limit(1));
      recipe.recipe_version = (prior[0]?.version_number || 0) + 1;
      return checked(await db.from('recipe_versions_v1').insert({ client_id: clientId, recipe_ref_id: recipe.recipe_ref_id, canonical_id: recipe.canonical_id, version_number: recipe.recipe_version, title: recipe.title, status: 'draft', yield_quantity: recipe.yield.quantity, yield_unit: recipe.yield.unit, yield_basis: recipe.yield.basis, recipe_json: recipe, source_evidence_ids: recipe.source_evidence_ids, content_fingerprint: recipeRevisionFingerprint(recipe), ...(recipe.source_document_id || recipe.source_candidate_id ? { source_document_id: recipe.source_document_id || null, source_candidate_id: recipe.source_candidate_id || null } : {}), created_by: userId }).select('*').single());
    },
    async transition(row, status) {
      const changed = checked(await db.from('recipe_versions_v1').update({ status }).eq('id', row.id).eq('client_id', clientId).eq('status', row.status).select('*').maybeSingle());
      if (!changed) throw new Error('Recipe changed. Reload before reviewing.');
      return changed;
    },
    async calculate(project) {
      return calculationRequest('calculate', { projectId: project.id, projectRevision: project.revision, idempotencyKey: `reviewed-evidence-v1:reference-v3:${project.id}:${project.revision}` });
    },
    async calculationStatus(jobId) {
      return calculationRequest('status', { jobId });
    },
    async approve(project, runId) {
      if (typeof runId !== 'string') throw new Error('A trusted calculation run is required.');
      return calculationRequest('approve', { runId });
    }
  };
}
