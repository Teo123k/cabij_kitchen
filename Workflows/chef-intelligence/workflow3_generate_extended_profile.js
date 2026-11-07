const payload = items[0]?.json || {};
const trigger = payload.workflow3_request || {};

if (!trigger.trigger_reason || trigger.trigger_reason === 'none') {
  return [{
    json: {
      ...payload,
      workflow3_skipped: true,
      extended_profile: null,
    },
  }];
}

const openAiKey = $env.OPENAI_API_KEY || '';
const model = $env.OPENAI_MODEL || 'gpt-4.1-mini';
const prepProfile = payload.prep_profile || {};
const recipe = payload.recipe || {};
const kitchenProfile = payload.kitchen_profile || null;
const normalizedRecipeRefId =
  trigger.recipe_ref_id
  || recipe?.recipe_ref_id
  || recipe?.structured_recipe?.recipe?.recipe_ref_id
  || recipe?.canonical_id
  || recipe?.structured_recipe?.recipe?.canonical_id
  || recipe?.recipe_code
  || recipe?.structured_recipe?.recipe?.recipe_code
  || recipe?.id;

const fallbackExtended = {
  recipe_ref_id: normalizedRecipeRefId,
  client_id: trigger.client_id || recipe.client_id,
  status: 'active',
  extension_type: trigger.trigger_reason,
  dependency_map: {},
  container_label_rule: {
    container_type: 'gastro_pan',
    label_fields: ['recipe_name', 'prep_date', 'use_by'],
  },
  oversold_recovery: {
    supported: false,
    default_extra_portions: 0,
  },
  kitchen_adaptation: kitchenProfile ? { kitchen_id: kitchenProfile.kitchen_id || null } : {},
  manager_review_reason: prepProfile.manager_review_required ? 'Prep profile requested manager review.' : null,
  generated_by: 'workflow_3',
};

if (!openAiKey) {
  return [{
    json: {
      ...payload,
      workflow3_skipped: false,
      extended_profile: fallbackExtended,
    },
  }];
}

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
      {
        role: 'system',
        content: 'Return only valid JSON. Generate optional advanced operational enrichment for a restaurant recipe.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          recipe,
          prep_profile: prepProfile,
          kitchen_profile: kitchenProfile,
          workflow3_request: trigger,
          required_shape: fallbackExtended,
        }),
      },
    ],
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`OpenAI request failed in Workflow 3: ${response.status} ${response.statusText} ${text}`);
}

const parsed = JSON.parse(text);
const content = parsed.choices?.[0]?.message?.content;
if (!content) {
  throw new Error(`OpenAI returned no content for Workflow 3: ${text}`);
}

const generated = JSON.parse(content);
return [{
  json: {
    ...payload,
    workflow3_skipped: false,
    extended_profile: {
      ...fallbackExtended,
      ...generated,
      recipe_ref_id: fallbackExtended.recipe_ref_id,
      client_id: fallbackExtended.client_id,
      generated_by: 'workflow_3',
    },
  },
}];
