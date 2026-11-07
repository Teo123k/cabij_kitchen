const baseUrl = $env.SUPABASE_URL || $env.VITE_SUPABASE_URL;
const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY || $env.SUPABASE_SERVICE_KEY || $env.VITE_SUPABASE_ANON_KEY;

if (!baseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in n8n environment.');
}

const input = items[0]?.json || {};
const originalPacket = input?.original_packet && typeof input.original_packet === 'object'
  ? input.original_packet
  : null;
const injectedRecipe = input?.recipe && typeof input.recipe === 'object'
  ? input.recipe
  : (originalPacket?.recipe && typeof originalPacket.recipe === 'object' ? originalPacket.recipe : null);
const injectedKnowledgeCandidates = Array.isArray(input?.chef_knowledge_candidates)
  ? input.chef_knowledge_candidates
  : (Array.isArray(originalPacket?.chef_knowledge_candidates) ? originalPacket.chef_knowledge_candidates : []);
const normalizedInput = {
  ...originalPacket,
  ...input,
  recipe: injectedRecipe || input?.recipe || null,
  chef_knowledge_candidates: injectedKnowledgeCandidates,
  recipe_ref_id:
    input?.recipe_ref_id
    || originalPacket?.recipe_ref_id
    || injectedRecipe?.recipe_ref_id
    || input?.canonical_id
    || originalPacket?.canonical_id
    || injectedRecipe?.canonical_id
    || '',
  canonical_id:
    input?.canonical_id
    || originalPacket?.canonical_id
    || injectedRecipe?.canonical_id
    || input?.recipe_ref_id
    || originalPacket?.recipe_ref_id
    || injectedRecipe?.recipe_ref_id
    || '',
  recipe_code:
    input?.recipe_code
    || originalPacket?.recipe_code
    || injectedRecipe?.recipe_code
    || injectedRecipe?.code
    || '',
  title:
    input?.title
    || injectedRecipe?.title
    || injectedRecipe?.name
    || originalPacket?.title
    || '',
  client_id:
    input?.client_id
    || originalPacket?.client_id
    || injectedRecipe?.client_id
    || '',
  service_type:
    input?.service_type
    || injectedRecipe?.service_type
    || originalPacket?.service_type
    || 'daily_service',
  expected_portions:
    input?.expected_portions
    ?? input?.portions
    ?? injectedRecipe?.expected_portions
    ?? originalPacket?.expected_portions
    ?? 0
};
const recipeLookupKey = String(
  normalizedInput.recipe_ref_id || normalizedInput.recipe_code || normalizedInput.title || normalizedInput.id || ''
).trim();

if (!recipeLookupKey && !injectedRecipe) {
  throw new Error('Workflow 2 requires recipe_ref_id, recipe_code, title, or id.');
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

const supabaseRequest = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${response.statusText} ${text}`);
  }
  return data;
};

const encodedKey = encodeURIComponent(recipeLookupKey);
const normalizedClientId = String(normalizedInput.client_id || '').trim();
const clientIdFilter = normalizedClientId
  ? `&client_id=eq.${encodeURIComponent(normalizedClientId)}`
  : '';
const recipeRows = recipeLookupKey
  ? await supabaseRequest(
      `/rest/v1/recipes?select=*&or=(recipe_ref_id.eq.${encodedKey},recipe_code.eq.${encodedKey},title.eq.${encodedKey},id.eq.${encodedKey})${clientIdFilter}&limit=1`
    )
  : [];

if ((!Array.isArray(recipeRows) || recipeRows.length === 0) && !injectedRecipe) {
  throw new Error(`No recipe found for lookup key: ${recipeLookupKey}`);
}

const rawRecipe = Array.isArray(recipeRows) ? (recipeRows[0] || {}) : {};
const nestedRecipe = rawRecipe?.structured_recipe?.recipe || rawRecipe?.recipe_json?.recipe || rawRecipe?.recipe_json || null;
const recipe = {
  ...rawRecipe,
  ...(nestedRecipe && typeof nestedRecipe === 'object' ? nestedRecipe : {}),
  ...(injectedRecipe && typeof injectedRecipe === 'object' ? injectedRecipe : {}),
  recipe_ref_id:
    injectedRecipe?.recipe_ref_id
    || rawRecipe?.recipe_ref_id
    || nestedRecipe?.recipe_ref_id
    || injectedRecipe?.canonical_id
    || rawRecipe?.canonical_id
    || nestedRecipe?.canonical_id
    || injectedRecipe?.recipe_code
    || rawRecipe?.recipe_code
    || nestedRecipe?.recipe_code
    || rawRecipe?.id
    || normalizedInput.recipe_ref_id
    || null,
  canonical_id:
    injectedRecipe?.canonical_id
    || rawRecipe?.canonical_id
    || nestedRecipe?.canonical_id
    || injectedRecipe?.recipe_ref_id
    || rawRecipe?.recipe_ref_id
    || nestedRecipe?.recipe_ref_id
    || injectedRecipe?.recipe_code
    || rawRecipe?.recipe_code
    || nestedRecipe?.recipe_code
    || rawRecipe?.id
    || normalizedInput.canonical_id
    || null,
  recipe_code:
    injectedRecipe?.recipe_code
    || injectedRecipe?.code
    || rawRecipe?.recipe_code
    || nestedRecipe?.recipe_code
    || nestedRecipe?.code
    || rawRecipe?.code
    || normalizedInput.recipe_code
    || null,
  client_id:
    injectedRecipe?.client_id
    || rawRecipe?.client_id
    || normalizedInput.client_id
    || null
};
const recipeClientId = String(normalizedInput.client_id || recipe.client_id || '');
const kitchenId = String(normalizedInput.kitchen_id || '');

const [
  methodTemplates,
  taskTemplates,
  cookingRules,
  operationalRules,
  prepPatterns,
  trainingTemplates,
  kitchenProfiles,
] = await Promise.all([
  supabaseRequest('/rest/v1/chef_method_templates?select=*'),
  supabaseRequest('/rest/v1/chef_task_templates?select=*'),
  supabaseRequest('/rest/v1/chef_cooking_rules?select=*'),
  supabaseRequest('/rest/v1/chef_operational_rules?select=*'),
  supabaseRequest('/rest/v1/chef_prep_patterns?select=*'),
  supabaseRequest('/rest/v1/chef_training_templates?select=*'),
  kitchenId
    ? supabaseRequest(`/rest/v1/kitchen_profiles?select=*&kitchen_id=eq.${encodeURIComponent(kitchenId)}&limit=1`)
    : recipeClientId
      ? supabaseRequest(`/rest/v1/kitchen_profiles?select=*&client_id=eq.${encodeURIComponent(recipeClientId)}&limit=1`)
      : Promise.resolve([]),
]);

const normalize = (value) => String(value || '').trim().toLowerCase();
const buildInjectedKnowledgeContext = (candidates = []) => {
  const buckets = {
    method_templates: [],
    task_templates: [],
    cooking_rules: [],
    operational_rules: [],
    prep_patterns: [],
    training_templates: []
  };
  const tableToBucket = {
    chef_method_templates: 'method_templates',
    chef_task_templates: 'task_templates',
    chef_cooking_rules: 'cooking_rules',
    chef_operational_rules: 'operational_rules',
    chef_prep_patterns: 'prep_patterns',
    chef_training_templates: 'training_templates'
  };

  (Array.isArray(candidates) ? candidates : []).forEach((candidate, index) => {
    const bucketKey = tableToBucket[candidate?.target_table];
    const mappedPayload = candidate?.mapped_payload;
    if (!bucketKey || !mappedPayload || typeof mappedPayload !== 'object') return;
    buckets[bucketKey].push({
      ...mappedPayload,
      injected_candidate_id: candidate?.candidate_id || `injected-${bucketKey}-${index}`,
      injected_confidence: candidate?.confidence ?? null,
      injected_mapping_reason: candidate?.mapping_reason || null,
      injected_source_excerpt: candidate?.source_excerpt || null,
      injected_evidence_basis: candidate?.evidence_basis || null,
      recipe_ref_id: mappedPayload?.recipe_ref_id || candidate?.recipe_ref_id || recipe?.recipe_ref_id || null
    });
  });

  return buckets;
};
const recipeStyle = normalize(recipe.dish_style || recipe.style || recipe.structured_recipe?.recipe?.style);
const recipeCuisine = normalize(recipe.cuisine || recipe.structured_recipe?.recipe?.cuisine);
const recipeType = normalize(recipe.recipe_type || 'main_recipe');
const serviceType = normalize(normalizedInput.service_type || 'daily_service');
const expectedPortions = Number(normalizedInput.expected_portions || normalizedInput.portions || 0);
const scaleBucket = expectedPortions >= 100 ? 'event' : expectedPortions >= 80 ? 'large' : 'regular';

const pickMatches = (rows, matcher) => (Array.isArray(rows) ? rows.filter(matcher) : []);
const injectedKnowledgeContext = buildInjectedKnowledgeContext(injectedKnowledgeCandidates);

return [
  {
    json: {
      input: normalizedInput,
      recipe,
      kitchen_profile: Array.isArray(kitchenProfiles) ? (kitchenProfiles[0] || null) : null,
      original_packet: originalPacket,
      chef_knowledge_candidates: injectedKnowledgeCandidates,
      match_context: {
        recipe_style: recipeStyle,
        recipe_cuisine: recipeCuisine,
        recipe_type: recipeType,
        service_type: serviceType,
        scale_bucket: scaleBucket,
      },
      knowledge_context: {
        method_templates: [
          ...injectedKnowledgeContext.method_templates,
          ...pickMatches(methodTemplates, (row) => {
            const rowStyle = normalize(row.dish_style);
            const rowCuisine = normalize(row.cuisine);
            return (!rowStyle || rowStyle === recipeStyle) && (!rowCuisine || rowCuisine === recipeCuisine);
          })
        ],
        task_templates: [
          ...injectedKnowledgeContext.task_templates,
          ...(Array.isArray(taskTemplates) ? taskTemplates : [])
        ],
        cooking_rules: [
          ...injectedKnowledgeContext.cooking_rules,
          ...(Array.isArray(cookingRules) ? cookingRules : [])
        ],
        operational_rules: [
          ...injectedKnowledgeContext.operational_rules,
          ...pickMatches(operationalRules, (row) => {
            const ruleStyle = normalize(row.applies_to_dish_style);
            const ruleCuisine = normalize(row.applies_to_cuisine);
            const ruleRecipeType = normalize(row.applies_to_recipe_type);
            const ruleServiceType = normalize(row.applies_to_service_type);
            const ruleScaleBucket = normalize(row.applies_to_scale_bucket);
            return (!ruleStyle || ruleStyle === recipeStyle)
              && (!ruleCuisine || ruleCuisine === recipeCuisine)
              && (!ruleRecipeType || ruleRecipeType === recipeType)
              && (!ruleServiceType || ruleServiceType === serviceType)
              && (!ruleScaleBucket || ruleScaleBucket === scaleBucket);
          })
        ],
        prep_patterns: [
          ...injectedKnowledgeContext.prep_patterns,
          ...pickMatches(prepPatterns, (row) => {
            const rowStyle = normalize(row.dish_style);
            const rowCuisine = normalize(row.cuisine);
            const rowRecipeType = normalize(row.recipe_type);
            const rowServiceType = normalize(row.service_type);
            const rowScaleBucket = normalize(row.scale_bucket);
            return (!rowStyle || rowStyle === recipeStyle)
              && (!rowCuisine || rowCuisine === recipeCuisine)
              && (!rowRecipeType || rowRecipeType === recipeType)
              && (!rowServiceType || rowServiceType === serviceType)
              && (!rowScaleBucket || rowScaleBucket === scaleBucket);
          })
        ],
        training_templates: [
          ...injectedKnowledgeContext.training_templates,
          ...pickMatches(trainingTemplates, (row) => {
            const rowStyle = normalize(row.dish_style);
            const rowCuisine = normalize(row.cuisine);
            const rowRecipeType = normalize(row.recipe_type);
            return (!rowStyle || rowStyle === recipeStyle)
              && (!rowCuisine || rowCuisine === recipeCuisine)
              && (!rowRecipeType || rowRecipeType === recipeType);
          })
        ]
      },
    },
  },
];
