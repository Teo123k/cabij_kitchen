const payload = items[0]?.json || {};
const { recipe, knowledge_context = {}, kitchen_profile = null, input = {}, match_context = {} } = payload;

if (!recipe) {
  throw new Error('Missing recipe payload in Workflow 2 generation step.');
}

const openAiKey = $env.OPENAI_API_KEY || '';
const model = $env.OPENAI_MODEL || 'gpt-4.1-mini';

const recipeRefId =
  recipe?.recipe_ref_id
  || recipe?.structured_recipe?.recipe?.recipe_ref_id
  || recipe?.canonical_id
  || recipe?.structured_recipe?.recipe?.canonical_id
  || recipe?.recipe_code
  || recipe?.structured_recipe?.recipe?.recipe_code
  || recipe?.id;
const clientId = input.client_id || recipe.client_id;
const expectedPortions = Number(input.expected_portions || input.portions || 0);
const serviceType = input.service_type || 'daily_service';
const recipePrepTaskRows = Array.isArray(recipe?.prep_task_rows)
  ? recipe.prep_task_rows
  : (Array.isArray(recipe?.prepTaskRows) ? recipe.prepTaskRows : []);
const injectedTaskTemplateRows = Array.isArray(knowledge_context?.task_templates)
  ? knowledge_context.task_templates.flatMap((row) => (
      Array.isArray(row?.task_rows)
        ? row.task_rows
        : (Array.isArray(row?.taskRows) ? row.taskRows : [])
    ))
  : [];
const baseExecutionRows = (recipePrepTaskRows.length > 0 ? recipePrepTaskRows : injectedTaskTemplateRows)
  .map((row = {}, index) => {
    const label = String(
      row?.task_name
      || row?.taskName
      || row?.task_label
      || row?.taskLabel
      || row?.raw_task_label
      || row?.rawTaskLabel
      || row?.instruction
      || row?.label
      || ''
    ).trim();
    if (!label) return null;
    return {
      id: String(row?.task_code || row?.id || `wf2-base-task-${index}`),
      task_name: label,
      task_label: label,
      estimated_minutes: Number(row?.estimated_minutes || row?.estimatedMinutes || 0) || null,
      station_group: row?.station_group || row?.stationGroup || row?.station || '',
      station: row?.station || row?.station_group || row?.stationGroup || '',
      ingredient_refs: Array.isArray(row?.ingredient_refs) ? row.ingredient_refs : [],
      service_phase: row?.service_phase || row?.servicePhase || 'prep',
      category: row?.category || 'PREP',
      skill_level: row?.skill_level || row?.skillLevel || 'commis',
      action_type: row?.action_type || row?.actionType || 'prep'
    };
  })
  .filter(Boolean);
const baseTaskBullets = baseExecutionRows.map((row) => row.task_name).filter(Boolean);

const fallbackProfile = {
  recipe_ref_id: recipeRefId,
  client_id: clientId,
  profile_version: 1,
  status: 'active',
  knowledge_source: 'chef_rules_fallback',
  knowledge_source_version: 'v1',
  generated_by: 'workflow_2',
  regen_reason: input.regen_reason || 'initial_generation',
  prep_intelligence: {
    lead_time: expectedPortions >= 100 ? 'Day before' : 'Morning',
    make_ahead: expectedPortions >= 100 ? 'Day before ok' : 'Same day only',
    storage_window: '24 hours',
    prep_time_minutes_regular: 60,
    prep_time_minutes_large: 180,
    handoff_note: 'Review generated plan before live service.'
  },
  scale_rule: {
    large_scale_threshold_portions: 100,
    regular_range: { min: 1, max: 99 },
    large_range: { min: 100, max: 500 }
  },
  regular_profile: {
    summary: 'Fallback prep profile generated without LLM.',
    equipment_required: [],
    execution_tasks: baseExecutionRows,
    estimated_total_minutes: 60
  },
  large_profile: {
    summary: 'Fallback large profile generated without LLM.',
    equipment_required: [],
    execution_tasks: baseExecutionRows,
    estimated_total_minutes: 180
  },
  storage: {
    shelf_life_hours: 24,
    label: '24 hours'
  },
  food_safety_ccp: ['Manager review required before live production.'],
  critical_checks: ['Confirm batch timing and station sequence manually.'],
  service_finish: ['Final seasoning and pass check near service.'],
  training_outline: {
    lesson_title: `${recipe.title || recipe.name || 'Recipe'} SOP`,
    sections: ['mise en place', 'prep flow', 'service finish']
  },
  training_key_points: ['Sequence control', 'Quality check', 'Food safety check'],
  ui_output: {
    task_bullets: baseTaskBullets,
    prep_card_rows: baseTaskBullets,
    execution_tasks: baseExecutionRows,
    prep_detail_rows: baseExecutionRows,
    show_large_profile_over_portions: 100,
    default_open_section: 'summary'
  },
  confidence_scores: {
    prep_profile: 0.55,
    training_outline: 0.55,
    ccp: 0.55
  },
  manager_review_required: true,
  source_evidence_ids: []
};

if (!openAiKey) {
  return [{
    json: {
      ...payload,
      prep_profile: fallbackProfile,
      workflow3_request: {
        recipe_ref_id: recipeRefId,
        client_id: clientId,
        trigger_reason: 'manager_review_required',
        service_type: serviceType,
      }
    }
  }];
}

const systemPrompt = `
You are generating restaurant chef prep intelligence.
Return only valid JSON.
Do not overwrite recipe truth.
Use the recipe and chef knowledge to produce:
- prep_intelligence
- regular_profile
- large_profile
- storage
- food_safety_ccp
- critical_checks
- service_finish
- training_outline
- training_key_points
- confidence_scores
- manager_review_required
`;

const userPrompt = {
  recipe,
  match_context,
  kitchen_profile,
  knowledge_context,
  input_context: {
    expected_portions: expectedPortions,
    service_type: serviceType,
    event_type: input.event_type || null,
  },
  required_shape: fallbackProfile,
};

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${openAiKey}`,
  },
  body: JSON.stringify({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPrompt) },
    ],
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`OpenAI request failed: ${response.status} ${response.statusText} ${text}`);
}

const parsed = JSON.parse(text);
const content = parsed.choices?.[0]?.message?.content;
if (!content) {
  throw new Error(`OpenAI returned no message content: ${text}`);
}

const generated = JSON.parse(content);
const prepProfile = {
  ...fallbackProfile,
  ...generated,
  recipe_ref_id: recipeRefId,
  client_id: clientId,
  generated_by: 'workflow_2',
  knowledge_source: generated.knowledge_source || 'chef_db_plus_llm',
  knowledge_source_version: generated.knowledge_source_version || 'v1',
};

const needsWorkflow3 = Boolean(
  prepProfile.manager_review_required
  || serviceType !== 'daily_service'
  || expectedPortions >= 100
  || kitchen_profile
);

return [{
  json: {
    ...payload,
    prep_profile: prepProfile,
    workflow3_request: {
      recipe_ref_id: recipeRefId,
      client_id: clientId,
      trigger_reason: needsWorkflow3 ? (generated.regen_reason || 'advanced_enrichment_required') : 'none',
      service_type: serviceType,
      expected_portions: expectedPortions,
    },
  },
}];
