import { OFFLINE_QUEUE_STATUS_LABELS, OFFLINE_QUEUE_TYPES, OFFLINE_STATE, OFFLINE_STORAGE, buildRecipeAliases, classifyKitchenUnit, getMeasuredIngredientSummary, getRecipeLookupKey, normalizeSupabaseRecipeRecord } from './constants.js';

const safeStorage = () => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

const RECIPES_SQL_IMPORT_SOURCE = 'public.recipes';
const RECIPES_SQL_IMPORT_JSON_COLUMNS = new Set([
  'structured_recipe',
  'recipe_json',
  'ingredients',
  'steps',
  'nutrition',
  'serving_display',
  'nutrition_details',
  'nutrition_audit',
  'servings_details',
  'classification_confidence',
  'confidence_scores',
  'weights'
]);
const RECIPES_SQL_IMPORT_ARRAY_COLUMNS = new Set([
  'dietary',
  'allergens',
  'review_reasons'
]);

const normalizeScope = (value) => {
  if (!value) return null;
  return String(value).trim().toLowerCase();
};

const getSourceTrustRank = (recipe = {}) => {
  const sourceTrust = normalizeScope(recipe?.source_trust);
  if (sourceTrust === 'canonical') return 0;
  if (sourceTrust === 'canonical_with_local_changes') return 1;
  if (sourceTrust === 'synced_local') return 2;
  if (sourceTrust === 'local_fallback') return 3;
  if (sourceTrust === 'local_queue') return 4;
  return 5;
};

const getOfflineStateRank = (recipe = {}) => {
  const offlineState = normalizeScope(recipe?.offline_sync_state);
  if (!offlineState || offlineState === OFFLINE_STATE.ONLINE || offlineState === OFFLINE_STATE.SYNCED || offlineState === OFFLINE_STATE.APPROVED) return 0;
  if (offlineState === OFFLINE_STATE.PENDING || offlineState === OFFLINE_STATE.LOCAL || offlineState === OFFLINE_STATE.APPROVAL_REQUIRED) return 1;
  if (offlineState === OFFLINE_STATE.CONFLICT || offlineState === OFFLINE_STATE.FAILED || offlineState === OFFLINE_STATE.BLOCKED) return 2;
  return 1;
};

const getRecipeIdentityKey = (recipe = {}) => {
  return normalizeScope(getRecipeLookupKey(recipe));
};

const shouldPreferRecipeTruth = (candidate = {}, current = {}) => {
  const candidateSourceRank = getSourceTrustRank(candidate);
  const currentSourceRank = getSourceTrustRank(current);
  if (candidateSourceRank !== currentSourceRank) return candidateSourceRank < currentSourceRank;

  const candidateTruthTier = Number(candidate?.recipe_truth_tier ?? 9);
  const currentTruthTier = Number(current?.recipe_truth_tier ?? 9);
  if (candidateTruthTier !== currentTruthTier) return candidateTruthTier < currentTruthTier;

  const candidateOfflineRank = getOfflineStateRank(candidate);
  const currentOfflineRank = getOfflineStateRank(current);
  if (candidateOfflineRank !== currentOfflineRank) return candidateOfflineRank < currentOfflineRank;

  const candidateHasCanonical = Boolean(candidate?.canonical_id || candidate?.recipe_ref_id);
  const currentHasCanonical = Boolean(current?.canonical_id || current?.recipe_ref_id);
  if (candidateHasCanonical !== currentHasCanonical) return candidateHasCanonical;

  const candidateAliasCount = buildRecipeAliases(candidate).length;
  const currentAliasCount = buildRecipeAliases(current).length;
  if (candidateAliasCount !== currentAliasCount) return candidateAliasCount > currentAliasCount;

  return false;
};

const mergeRecipeTruthPair = (current = {}, candidate = {}) => {
  const winner = shouldPreferRecipeTruth(candidate, current) ? candidate : current;
  const loser = winner === candidate ? current : candidate;
  const currentFlags = Array.isArray(current?.recipe_truth_flags) ? current.recipe_truth_flags : [];
  const candidateFlags = Array.isArray(candidate?.recipe_truth_flags) ? candidate.recipe_truth_flags : [];
  const mergedAliases = [...new Set([
    ...buildRecipeAliases(current),
    ...buildRecipeAliases(candidate)
  ])];

  return {
    ...loser,
    ...winner,
    id: winner?.id || loser?.id,
    recipe_ref_id: winner?.recipe_ref_id || loser?.recipe_ref_id || winner?.canonical_id || loser?.canonical_id,
    canonical_id: winner?.canonical_id || loser?.canonical_id || winner?.recipe_ref_id || loser?.recipe_ref_id,
    canonical_name: winner?.canonical_name || loser?.canonical_name || winner?.clean_name || loser?.clean_name || winner?.name || loser?.name,
    clean_name: winner?.clean_name || loser?.clean_name || winner?.canonical_name || loser?.canonical_name || winner?.name || loser?.name,
    name: winner?.name || loser?.name,
    title: winner?.title || loser?.title || winner?.name || loser?.name,
    source_trust: winner?.source_trust || loser?.source_trust,
    recipe_truth_status: winner?.recipe_truth_status || loser?.recipe_truth_status,
    recipe_truth_tier: Math.min(Number(current?.recipe_truth_tier ?? 9), Number(candidate?.recipe_truth_tier ?? 9)),
    recipe_trust_score: Math.min(Number(current?.recipe_trust_score ?? 9), Number(candidate?.recipe_trust_score ?? 9)),
    recipe_truth_flags: [...new Set([...currentFlags, ...candidateFlags])],
    recipe_aliases: mergedAliases,
    has_unapproved_changes: Boolean(current?.has_unapproved_changes || candidate?.has_unapproved_changes),
    offline_sync_state: winner?.offline_sync_state || loser?.offline_sync_state,
    offline_sync_reason: winner?.offline_sync_reason || loser?.offline_sync_reason
  };
};

const consolidateRecipeTruths = (recipes = []) => {
  const recipeList = Array.isArray(recipes) ? recipes : [];
  const consolidated = [];
  const byKey = new Map();
  const byAlias = new Map();

  recipeList.forEach((recipe) => {
    const identityKey = getRecipeIdentityKey(recipe);
    const aliasKeys = buildRecipeAliases(recipe).map((alias) => normalizeScope(alias)).filter(Boolean);
    const matchedIndex = (
      (identityKey && byKey.has(identityKey)) ? byKey.get(identityKey)
        : aliasKeys.find((alias) => byAlias.has(alias)) !== undefined
          ? byAlias.get(aliasKeys.find((alias) => byAlias.has(alias)))
          : null
    );

    if (matchedIndex !== null && matchedIndex !== undefined) {
      const mergedRecipe = mergeRecipeTruthPair(consolidated[matchedIndex] || {}, recipe);
      consolidated[matchedIndex] = mergedRecipe;
      const mergedAliases = buildRecipeAliases(mergedRecipe).map((alias) => normalizeScope(alias)).filter(Boolean);
      const mergedKey = getRecipeIdentityKey(mergedRecipe);
      if (mergedKey) byKey.set(mergedKey, matchedIndex);
      mergedAliases.forEach((alias) => byAlias.set(alias, matchedIndex));
      return;
    }

    const nextIndex = consolidated.length;
    consolidated.push(recipe);
    if (identityKey) byKey.set(identityKey, nextIndex);
    aliasKeys.forEach((alias) => byAlias.set(alias, nextIndex));
  });

  return consolidated;
};

export const isLocalQueueRecipeId = (value) => {
  const normalizedValue = normalizeScope(value);
  return Boolean(normalizedValue && normalizedValue.startsWith('queued-'));
};

const queueKeyFor = ({ clientId, queueType }) => {
  const normalizedClientId = normalizeScope(clientId);
  const normalizedQueueType = normalizeScope(queueType);

  if (!normalizedClientId || !normalizedQueueType) return null;
  return `${OFFLINE_STORAGE.QUEUE_PREFIX}:${normalizedClientId}:${normalizedQueueType}`;
};

const queueIndexKeyFor = (clientId) => {
  const normalizedClientId = normalizeScope(clientId);
  if (!normalizedClientId) return null;
  return `${OFFLINE_STORAGE.QUEUE_INDEX_PREFIX}:${normalizedClientId}`;
};

const decodeSqlStringLiteral = (value = '') => value.replace(/''/g, "'");

const parseSqlArrayLiteral = (value = '') => {
  const inner = value
    .replace(/^ARRAY\[/i, '')
    .replace(/\](::[\w.\[\]]+)?$/i, '')
    .trim();

  if (!inner) return [];

  const items = [];
  const itemPattern = /'((?:''|[^'])*)'/g;
  let match = itemPattern.exec(inner);
  while (match) {
    items.push(decodeSqlStringLiteral(match[1]));
    match = itemPattern.exec(inner);
  }
  return items;
};

const parseSqlScalarValue = (rawValue = '', column = '') => {
  const value = String(rawValue || '').trim();
  if (!value || /^NULL$/i.test(value)) return null;
  if (/^TRUE$/i.test(value)) return true;
  if (/^FALSE$/i.test(value)) return false;
  if (/^ARRAY\[/i.test(value)) return parseSqlArrayLiteral(value);
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  const quotedMatch = value.match(/^'([\s\S]*)'(::[\w.\[\]]+)?$/);
  if (quotedMatch) {
    const decodedValue = decodeSqlStringLiteral(quotedMatch[1]);
    if (RECIPES_SQL_IMPORT_JSON_COLUMNS.has(column)) {
      if (decodedValue === 'null') return null;
      try {
        return JSON.parse(decodedValue);
      } catch (_error) {
        return decodedValue;
      }
    }
    if (RECIPES_SQL_IMPORT_ARRAY_COLUMNS.has(column)) {
      return decodedValue ? [decodedValue] : [];
    }
    return decodedValue;
  }

  return value;
};

const splitSqlTupleValues = (tupleText = '') => {
  const values = [];
  let current = '';
  let inQuote = false;
  let bracketDepth = 0;

  for (let index = 0; index < tupleText.length; index += 1) {
    const char = tupleText[index];
    const nextChar = tupleText[index + 1];

    if (char === "'") {
      current += char;
      if (inQuote && nextChar === "'") {
        current += nextChar;
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }

    if (!inQuote) {
      if (char === '[') bracketDepth += 1;
      if (char === ']' && bracketDepth > 0) bracketDepth -= 1;
      if (char === ',' && bracketDepth === 0) {
        values.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) values.push(current.trim());
  return values;
};

const extractSqlTuples = (valuesText = '') => {
  const tuples = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let index = 0; index < valuesText.length; index += 1) {
    const char = valuesText[index];
    const nextChar = valuesText[index + 1];

    if (char === "'") {
      if (parenDepth > 0) current += char;
      if (inQuote && nextChar === "'") {
        if (parenDepth > 0) current += nextChar;
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }

    if (!inQuote && char === '(') {
      if (parenDepth > 0) current += char;
      parenDepth += 1;
      continue;
    }

    if (!inQuote && char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        tuples.push(current);
        current = '';
        continue;
      }
      current += char;
      continue;
    }

    if (parenDepth > 0) current += char;
  }

  return tuples;
};

const findSqlStatementTerminator = (text = '', startIndex = 0) => {
  let inQuote = false;

  for (let index = Math.max(0, Number(startIndex) || 0); index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "'") {
      if (inQuote && nextChar === "'") {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }

    if (!inQuote && char === ';') {
      return index;
    }
  }

  return -1;
};

export const parseRecipesSqlSeed = (sqlText = '', clientId = null) => {
  const sql = String(sqlText || '');

  if (/INSERT INTO\s+public\.sop_recipes/i.test(sql)) {
    throw new Error('Use recipes_library_backup.sql as the live recipe seed source. sop_recipes_backup.sql is reference-only for this step.');
  }

  const insertStart = sql.search(/INSERT INTO\s+public\.recipes\b/i);
  if (insertStart === -1) {
    throw new Error('No public.recipes SQL seed block found.');
  }

  const columnsStart = sql.indexOf('(', insertStart);
  if (columnsStart === -1) {
    throw new Error('No public.recipes SQL column block found.');
  }

  const columnsEnd = sql.indexOf(')', columnsStart);
  if (columnsEnd === -1) {
    throw new Error('No public.recipes SQL column block found.');
  }

  const valuesMatch = sql.slice(columnsEnd + 1).match(/\bVALUES\b/i);
  if (!valuesMatch) {
    throw new Error('No public.recipes SQL VALUES block found.');
  }

  const valuesStart = columnsEnd + 1 + valuesMatch.index + valuesMatch[0].length;
  const statementEnd = findSqlStatementTerminator(sql, valuesStart);
  if (statementEnd === -1) {
    throw new Error('No public.recipes SQL seed terminator found.');
  }

  const columns = sql.slice(columnsStart + 1, columnsEnd)
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);

  const tuples = extractSqlTuples(sql.slice(valuesStart, statementEnd));
  if (!tuples.length) {
    throw new Error('No recipe rows found in the SQL seed.');
  }

  return tuples.map((tupleText) => {
    const values = splitSqlTupleValues(tupleText);
    const row = columns.reduce((acc, column, index) => {
      acc[column] = parseSqlScalarValue(values[index], column);
      return acc;
    }, {});
    return normalizeSupabaseRecipeRecord({
      row,
      clientId: clientId || row?.client_id || null
    });
  }).filter(Boolean);
};

const sanitizeIngredient = (ingredient = {}) => ({
  ...ingredient,
  name: ingredient?.name || '',
  qty: ingredient?.qty ?? ingredient?.quantity ?? 0,
  quantity: ingredient?.quantity ?? ingredient?.qty ?? 0,
  unit: ingredient?.unit || '',
  category: ingredient?.category || ingredient?.ingredient_category || ingredient?.group || 'General',
  quantity_confidence: ingredient?.quantity_confidence || 'missing'
});

const normalizeAuditText = (value = '') => String(value || '')
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .replace(/[_-]+/g, ' ');

const titleCaseText = (value = '') => normalizeAuditText(value)
  .replace(/\b\w/g, (char) => char.toUpperCase());

const normalizeAuditList = (value = []) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAuditText(item)).filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,|;/]+/g)
    .map((item) => normalizeAuditText(item))
    .filter(Boolean);
};

const readRecipeAuditTrail = (recipe = {}) => {
  const primaryTrail = Array.isArray(recipe?.recipe_profile_change_log) ? recipe.recipe_profile_change_log : [];
  const fallbackTrail = Array.isArray(recipe?.recipe_profile_audit_log) ? recipe.recipe_profile_audit_log : [];
  if (primaryTrail.length > 0) return [...primaryTrail].filter(Boolean);
  return [...fallbackTrail].filter(Boolean);
};

export const buildRecipeProfileAuditEntry = ({
  recipe = {},
  eventType = 'recipe_change',
  actor = '',
  reason = '',
  changedFields = [],
  retrainingFields = [],
  status = '',
  source = 'recipe-queue',
  createdAt = '',
  approvedAt = '',
  approvedBy = '',
  syncedAt = '',
  syncedBy = '',
  previousValue = null,
  nextValue = null,
  queueEntryId = '',
  note = ''
} = {}) => {
  const normalizedEventType = normalizeScope(eventType) || 'recipe_change';
  const normalizedActor = normalizeAuditText(actor || recipe?.updated_by || recipe?.approvedBy || recipe?.syncedBy || source || 'system') || 'system';
  const normalizedReason = normalizeAuditText(reason || note || normalizedEventType);
  const normalizedChangedFields = normalizeAuditList(changedFields);
  const normalizedRetrainingFields = normalizeAuditList(retrainingFields);
  const createdAtValue = createdAt || approvedAt || syncedAt || new Date().toISOString();
  const recipeKey = normalizeScope(recipe?.recipe_ref_id || recipe?.canonical_id || recipe?.id || recipe?.name || 'recipe') || 'recipe';
  const fieldPath = normalizeAuditText(normalizedChangedFields[0] || normalizedEventType).replace(/\s+/g, '_');
  const retrainingLabel = normalizedRetrainingFields.length > 0
    ? `Retrain: ${normalizedRetrainingFields.join(', ')}`
    : '';

  return {
    id: `${recipeKey}:${normalizedEventType}:${createdAtValue}`,
    event_type: normalizedEventType,
    field_path: fieldPath,
    field_label: titleCaseText(normalizedChangedFields[0] || normalizedEventType),
    changed_by: normalizedActor,
    change_reason: [normalizedReason, retrainingLabel].filter(Boolean).join(' / '),
    created_at: createdAtValue,
    approved_at: approvedAt || '',
    approved_by: approvedBy || '',
    synced_at: syncedAt || '',
    synced_by: syncedBy || '',
    status: status || recipe?.offline_sync_state || '',
    retraining_required: normalizedRetrainingFields.length > 0,
    retraining_fields: normalizedRetrainingFields,
    queue_entry_id: queueEntryId || '',
    source,
    before_value: previousValue,
    after_value: nextValue
  };
};

export const appendRecipeProfileAuditEvent = ({
  recipe = {},
  event = {}
} = {}) => {
  const normalizedEvent = buildRecipeProfileAuditEntry({ recipe, ...event });
  if (!normalizedEvent?.id) return recipe;

  const nextTrail = [...readRecipeAuditTrail(recipe).filter((entry) => entry?.id !== normalizedEvent.id), normalizedEvent]
    .sort((left, right) => new Date(left?.created_at || 0).getTime() - new Date(right?.created_at || 0).getTime());

  return {
    ...recipe,
    recipe_profile_change_log: nextTrail,
    recipe_profile_audit_log: nextTrail
  };
};

const buildQueuedRecipeTruthMetadata = (recipe = {}, offlineState = null) => {
  const normalizedOfflineState = normalizeScope(offlineState || recipe?.offline_sync_state) || OFFLINE_STATE.PENDING;
  const flags = [];
  const baseYieldValue = Number(recipe?.baseYield ?? recipe?.base_yield ?? recipe?.yield ?? 0);
  const unitLabel = String(recipe?.unit || '').trim();
  const yieldUnitDomain = classifyKitchenUnit(unitLabel);
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const { hasMeasuredIngredients, measuredIngredientCount } = getMeasuredIngredientSummary(recipe);

  if (!(baseYieldValue > 0) && !hasMeasuredIngredients) {
    flags.push('Missing base yield');
  }

  if (!unitLabel) {
    flags.push('Missing yield unit');
  }

  if (unitLabel && yieldUnitDomain === 'unknown') {
    flags.push(`Unsupported yield unit: ${unitLabel}`);
  }

  if (yieldUnitDomain === 'count' && measuredIngredientCount > 0) {
    flags.push('Portion-based yield needs conversion reference');
  }

  let recipeTruthStatus = 'review';
  let recipeTruthTier = 6;
  let recipeTrustScore = 4;

  if ([OFFLINE_STATE.CONFLICT, OFFLINE_STATE.FAILED, OFFLINE_STATE.BLOCKED].includes(normalizedOfflineState)) {
    recipeTruthStatus = 'blocked';
    recipeTruthTier = 9;
    recipeTrustScore = 6;
    flags.push(`Local recipe truth is ${normalizedOfflineState.replace(/_/g, ' ')}`);
  } else if ([OFFLINE_STATE.LOCAL, OFFLINE_STATE.PENDING, OFFLINE_STATE.APPROVAL_REQUIRED].includes(normalizedOfflineState)) {
    recipeTruthStatus = 'review';
    recipeTruthTier = 7;
    recipeTrustScore = 5;
    flags.push(`Local recipe truth is ${normalizedOfflineState.replace(/_/g, ' ')}`);
  } else if (normalizedOfflineState === OFFLINE_STATE.APPROVED) {
    recipeTruthStatus = 'review';
    recipeTruthTier = 4;
    recipeTrustScore = 3;
    flags.push('Recipe truth approved locally and waiting for sync');
  } else if (normalizedOfflineState === OFFLINE_STATE.SYNCED) {
    recipeTruthStatus = flags.length > 0 ? 'warning' : 'trusted';
    recipeTruthTier = flags.length > 0 ? 2 : 0;
    recipeTrustScore = flags.length > 0 ? 2 : 0;
  }

  return {
    source_trust: normalizedOfflineState === OFFLINE_STATE.SYNCED ? 'synced_local' : 'local_queue',
    recipe_truth_flags: flags,
    recipe_truth_status: recipeTruthStatus,
    recipe_truth_tier: recipeTruthTier,
    recipe_trust_score: recipeTrustScore,
    recipe_canonical_hint: normalizedOfflineState === OFFLINE_STATE.SYNCED ? 'synced' : 'queued_local'
  };
};

const omitOfflineRecipeFields = (value) => {
  if (Array.isArray(value)) return value.map(omitOfflineRecipeFields);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value).sort().reduce((acc, key) => {
    if (key.startsWith('offline_')) return acc;
    if (['updated_at', 'created_at', 'offline_base_freshness', '_offline_base_freshness'].includes(key)) return acc;
    acc[key] = omitOfflineRecipeFields(value[key]);
    return acc;
  }, {});
};

const stableStringify = (value) => JSON.stringify(omitOfflineRecipeFields(value));

export const buildRecipeFreshnessMarker = ({ row = {}, recipe = {}, clientId } = {}) => {
  const recipeRefId = row?.id || recipe?.recipe_ref_id || recipe?.canonical_id || recipe?.id || null;
  const normalizedClientId = normalizeScope(row?.client_id || recipe?.client_id || clientId);

  if (!recipeRefId || !normalizedClientId) return null;

  return {
    recipe_ref_id: String(recipeRefId),
    client_id: normalizedClientId,
    updated_at: row?.updated_at || row?.updatedAt || recipe?.updated_at || null,
    fingerprint: stableStringify({
      ...recipe,
      id: recipe?.id || recipeRefId,
      client_id: recipe?.client_id || normalizedClientId,
      recipe_ref_id: recipe?.recipe_ref_id || recipeRefId,
      canonical_id: recipe?.canonical_id || recipeRefId
    })
  };
};

export const getQueuedRecipeBaseFreshness = (entry = {}) => (
  entry?.baseFreshness ||
  entry?.recipe?.offline_base_freshness ||
  entry?.recipe?._offline_base_freshness ||
  null
);

export const recipeFreshnessMatches = (baseFreshness, currentFreshness) => {
  if (!baseFreshness || !currentFreshness) return false;
  if (String(baseFreshness.recipe_ref_id || '') !== String(currentFreshness.recipe_ref_id || '')) return false;
  if (normalizeScope(baseFreshness.client_id) !== normalizeScope(currentFreshness.client_id)) return false;

  if (baseFreshness.updated_at || currentFreshness.updated_at) {
    return Boolean(baseFreshness.updated_at && currentFreshness.updated_at && baseFreshness.updated_at === currentFreshness.updated_at);
  }

  return Boolean(baseFreshness.fingerprint && baseFreshness.fingerprint === currentFreshness.fingerprint);
};

export const sanitizeQueuedRecipe = (recipe = {}, clientId) => {
  const normalizedClientId = normalizeScope(clientId || recipe?.client_id);
  const recipeRefId = recipe?.recipe_ref_id || recipe?.canonical_id || recipe?.id || null;
  const baseFreshness = recipe?.offline_base_freshness || recipe?._offline_base_freshness || null;
  const truthMetadata = buildQueuedRecipeTruthMetadata(recipe, recipe?.offline_sync_state);
  const recipeAliases = buildRecipeAliases(recipe);

  return {
    ...recipe,
    id: recipe?.id || recipeRefId || `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    client_id: recipe?.client_id || normalizedClientId,
    recipe_ref_id: recipeRefId,
    canonical_id: recipe?.canonical_id || recipeRefId,
    canonical_name: recipe?.canonical_name || recipe?.clean_name || recipe?.name || '',
    clean_name: recipe?.clean_name || recipe?.name || recipe?.canonical_name || '',
    name: recipe?.name || recipe?.clean_name || recipe?.canonical_name || 'Unnamed Recipe',
    title: recipe?.title || recipe?.name || recipe?.clean_name || recipe?.canonical_name || 'Unnamed Recipe',
    code: recipe?.code || recipe?.recipeCode || recipe?.recipe_code || recipe?.sku || null,
    recipe_aliases: recipeAliases,
    ingredients: Array.isArray(recipe?.ingredients)
      ? recipe.ingredients.map(sanitizeIngredient)
      : [],
    ...truthMetadata,
    offline_sync_state: recipe?.offline_sync_state || 'pending',
    offline_sync_reason: recipe?.offline_sync_reason || 'offline_recipe_queue',
    offline_queue_source: recipe?.offline_queue_source || 'local-queue',
    offline_base_freshness: baseFreshness,
    offline_queued_at: recipe?.offline_queued_at || new Date().toISOString()
  };
};

const UPSTREAM_RECIPE_FIELD_ALLOWLIST = [
  'id',
  'recipe_ref_id',
  'canonical_id',
  'recipe_profile_change_log',
  'recipe_profile_audit_log',
  'name',
  'title',
  'clean_name',
  'canonical_name',
  'sku',
  'code',
  'recipeCode',
  'recipe_code',
  'client_id',
  'dishStyle',
  'dish_style',
  'style',
  'dishCategory',
  'dish_category',
  'category',
  'cuisine',
  'cuisineType',
  'dishCuisine',
  'dish_cuisine',
  'occasion',
  'serviceOccasion',
  'course',
  'ingredients',
  'instructions',
  'method',
  'steps',
  'allergens',
  'notes',
  'baseYield',
  'base_yield',
  'unit',
  'yieldMode',
  'yield_mode',
  'batchYield',
  'batch_yield',
  'servingSize',
  'serving_size',
  'servingKind',
  'serving_kind',
  'portionClass',
  'portion_class',
  'recordedServingWeight',
  'recorded_serving_weight',
  'recordedServingUnit',
  'recorded_serving_unit',
  'productionStrategy',
  'production_strategy',
  'productionBatchSize',
  'production_batch_size'
];

const buildCanonicalUpstreamRecipeSnapshot = (recipe = {}) => UPSTREAM_RECIPE_FIELD_ALLOWLIST.reduce((acc, field) => {
  if (!Object.prototype.hasOwnProperty.call(recipe, field)) return acc;
  const value = recipe[field];
  if (value === undefined) return acc;
  acc[field] = value;
  return acc;
}, {});

export const buildUpstreamRecipePayload = ({
  recipe = {},
  clientId,
  upstreamRecipeId = null,
  forceUpstreamIdentity = false,
  status = OFFLINE_STATE.SYNCED,
  reason = 'manager_approved_sync'
} = {}) => {
  const normalizedRecipe = sanitizeQueuedRecipe(recipe, clientId);
  const upstreamId = upstreamRecipeId ? String(upstreamRecipeId) : null;
  const payload = {
    ...buildCanonicalUpstreamRecipeSnapshot(normalizedRecipe),
    client_id: normalizedRecipe.client_id || normalizeScope(clientId),
    offline_sync_state: status,
    offline_sync_reason: reason
  };
  const identityFields = ['id', 'recipe_ref_id', 'canonical_id'];

  identityFields.forEach((field) => {
    if (forceUpstreamIdentity && upstreamId) {
      payload[field] = upstreamId;
      return;
    }

    if (isLocalQueueRecipeId(payload[field])) {
      if (upstreamId) {
        payload[field] = upstreamId;
      } else {
        delete payload[field];
      }
    }
  });

  return payload;
};

export const buildRecipesTableWritePayload = ({
  recipe = {},
  clientId,
  upstreamRecipeId = null,
  forceUpstreamIdentity = false,
  status = OFFLINE_STATE.SYNCED,
  reason = 'manager_approved_sync'
} = {}) => {
  const upstreamRecipe = buildUpstreamRecipePayload({
    recipe,
    clientId,
    upstreamRecipeId,
    forceUpstreamIdentity,
    status,
    reason
  });
  const instructions = Array.isArray(upstreamRecipe?.instructions)
    ? upstreamRecipe.instructions
    : Array.isArray(upstreamRecipe?.method)
      ? upstreamRecipe.method
      : Array.isArray(upstreamRecipe?.steps)
        ? upstreamRecipe.steps
        : [];
  const recipeRefId = upstreamRecipe?.recipe_ref_id || upstreamRecipe?.canonical_id || upstreamRecipe?.id || null;
  const canonicalId = upstreamRecipe?.canonical_id || upstreamRecipe?.recipe_ref_id || upstreamRecipe?.id || null;
  const dishCategory = upstreamRecipe?.dishCategory || upstreamRecipe?.dish_category || upstreamRecipe?.category || null;
  const dishStyle = upstreamRecipe?.dishStyle || upstreamRecipe?.dish_style || upstreamRecipe?.style || null;
  const recipeCode = upstreamRecipe?.code || upstreamRecipe?.recipeCode || upstreamRecipe?.recipe_code || upstreamRecipe?.sku || null;

  return {
    client_id: upstreamRecipe.client_id || normalizeScope(clientId),
    recipe_ref_id: recipeRefId,
    canonical_id: canonicalId,
    title: upstreamRecipe?.title || upstreamRecipe?.name || null,
    dish_category: dishCategory,
    dish_style: dishStyle,
    cuisine: upstreamRecipe?.cuisine || upstreamRecipe?.cuisineType || upstreamRecipe?.dishCuisine || upstreamRecipe?.dish_cuisine || null,
    ingredients: Array.isArray(upstreamRecipe?.ingredients) ? upstreamRecipe.ingredients : [],
    steps: instructions,
    occasion: upstreamRecipe?.occasion || upstreamRecipe?.serviceOccasion || upstreamRecipe?.course || null,
    allergens: Array.isArray(upstreamRecipe?.allergens) ? upstreamRecipe.allergens : [],
    category: dishCategory,
    style: dishStyle,
    recipe_code: recipeCode,
    structured_recipe: { recipe: upstreamRecipe },
    recipe_json: upstreamRecipe
  };
};

const finalizeSyncedRecipeIdentity = (recipe = {}, syncedRecipeRefId) => {
  if (!syncedRecipeRefId) return recipe;

  const upstreamId = String(syncedRecipeRefId);
  return {
    ...recipe,
    id: upstreamId,
    recipe_ref_id: upstreamId,
    canonical_id: upstreamId
  };
};

export const buildQueuedRecipeEntry = ({ recipe, clientId, source = 'offline-upload', status = 'pending', reason = 'offline_recipe_queue', auditEvent = null }) => {
  const normalizedRecipe = sanitizeQueuedRecipe(recipe, clientId);
  const recipeWithAuditTrail = appendRecipeProfileAuditEvent({
    recipe: normalizedRecipe,
    event: auditEvent || {
      eventType: normalizedRecipe?.offline_sync_state === OFFLINE_STATE.SYNCED ? 'recipe_synced' : 'recipe_queued',
      actor: normalizedRecipe?.updated_by || source || 'system',
      reason,
      status,
      source,
      changedFields: Array.isArray(recipe?.changedFields) ? recipe.changedFields : [],
      retrainingFields: Array.isArray(recipe?.retrainingFields) ? recipe.retrainingFields : [],
      queueEntryId: normalizedRecipe?.id || '',
      note: normalizedRecipe?.offline_sync_reason || reason
    }
  });
  return {
    id: normalizedRecipe.id,
    clientId: normalizedRecipe.client_id,
    type: OFFLINE_QUEUE_TYPES.RECIPE_EDITS,
    source,
    status,
    reason,
    recipe: {
      ...recipeWithAuditTrail,
      offline_sync_state: status,
      offline_sync_reason: reason,
      offline_queue_source: source
    },
    baseFreshness: normalizedRecipe.offline_base_freshness || null,
    createdAt: normalizedRecipe.offline_queued_at,
    updatedAt: new Date().toISOString()
  };
};

export const readOfflineQueue = ({ clientId, queueType = OFFLINE_QUEUE_TYPES.RECIPE_EDITS }) => {
  const storage = safeStorage();
  const queueKey = queueKeyFor({ clientId, queueType });
  if (!storage || !queueKey) return null;

  const raw = storage.getItem(queueKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== OFFLINE_STORAGE.VERSION ||
      parsed?.clientId !== normalizeScope(clientId) ||
      parsed?.type !== normalizeScope(queueType)
    ) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
};

export const saveOfflineQueue = ({ clientId, queueType = OFFLINE_QUEUE_TYPES.RECIPE_EDITS, entries = [] }) => {
  const storage = safeStorage();
  const queueKey = queueKeyFor({ clientId, queueType });
  const indexKey = queueIndexKeyFor(clientId);

  if (!storage || !queueKey || !indexKey) {
    return { ok: false, reason: 'missing_scope' };
  }

  const payload = {
    version: OFFLINE_STORAGE.VERSION,
    clientId: normalizeScope(clientId),
    type: normalizeScope(queueType),
    updatedAt: new Date().toISOString(),
    entries
  };

  storage.setItem(queueKey, JSON.stringify(payload));
  storage.setItem(indexKey, JSON.stringify({
    version: OFFLINE_STORAGE.VERSION,
    clientId: payload.clientId,
    queueKey,
    updatedAt: payload.updatedAt
  }));

  return { ok: true, queueKey, payload };
};

export const appendOfflineQueueEntry = ({ clientId, entry, queueType = OFFLINE_QUEUE_TYPES.RECIPE_EDITS }) => {
  const queue = readOfflineQueue({ clientId, queueType });
  const nextEntries = [...(queue?.entries || []), entry];
  return saveOfflineQueue({ clientId, queueType, entries: nextEntries });
};

export const updateOfflineQueueEntryStatuses = ({
  entries = [],
  canUpdate,
  status,
  reason,
  extra = {}
}) => {
  const now = new Date().toISOString();
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    if (!canUpdate?.(entry)) return entry;

    const nextRecipe = {
      ...(entry?.recipe || {}),
      offline_sync_state: status,
      offline_sync_reason: reason || entry?.reason || entry?.recipe?.offline_sync_reason
    };

    return {
      ...entry,
      ...extra,
      status,
      reason: reason || entry?.reason,
      recipe: nextRecipe,
      updatedAt: now
    };
  });
};

export const markQueueEntriesForApproval = ({ entries = [], approver }) => updateOfflineQueueEntryStatuses({
  entries,
  status: OFFLINE_STATE.APPROVED,
  reason: 'manager_approved_for_sync',
  extra: {
    approvedAt: new Date().toISOString(),
    approvedBy: approver?.full_name || approver?.id || approver?.role || 'manager'
  },
  canUpdate: (entry) => [
    OFFLINE_STATE.LOCAL,
    OFFLINE_STATE.PENDING,
    OFFLINE_STATE.APPROVAL_REQUIRED,
    OFFLINE_STATE.FAILED
  ].includes(normalizeScope(entry?.status) || OFFLINE_STATE.PENDING) && isQueueEntryApprovalSafe(entry)
}).map((entry) => {
  if (normalizeScope(entry?.status) !== OFFLINE_STATE.APPROVED) return entry;

  return {
    ...entry,
    recipe: appendRecipeProfileAuditEvent({
      recipe: entry?.recipe || {},
      event: {
        eventType: 'manager_approved',
        actor: approver?.full_name || approver?.id || approver?.role || 'manager',
        reason: 'manager_approved_for_sync',
        status: OFFLINE_STATE.APPROVED,
        approvedAt: entry?.approvedAt || new Date().toISOString(),
        approvedBy: entry?.approvedBy || approver?.full_name || approver?.id || approver?.role || 'manager',
        queueEntryId: entry?.id || '',
        changedFields: Array.isArray(entry?.recipe?.changedFields) ? entry.recipe.changedFields : [],
        retrainingFields: Array.isArray(entry?.recipe?.retrainingFields) ? entry.recipe.retrainingFields : []
      }
    })
  };
});

export const markUnapprovedEntriesAsApprovalRequired = (entries = []) => updateOfflineQueueEntryStatuses({
  entries,
  status: OFFLINE_STATE.APPROVAL_REQUIRED,
  reason: 'manager_approval_required',
  canUpdate: (entry) => [
    OFFLINE_STATE.LOCAL,
    OFFLINE_STATE.PENDING
  ].includes(normalizeScope(entry?.status) || OFFLINE_STATE.PENDING)
});

const isQueueEntryApprovalSafe = (entry = {}) => {
  const normalizedStatus = normalizeScope(entry?.status) || OFFLINE_STATE.PENDING;
  const recipe = entry?.recipe || {};
  const normalizedReason = normalizeScope(entry?.reason || recipe?.offline_sync_reason);
  const truthStatus = normalizeScope(recipe?.recipe_truth_status);
  const offlineState = normalizeScope(recipe?.offline_sync_state || normalizedStatus);
  const hasFreshness = Boolean(getQueuedRecipeBaseFreshness(entry));

  if ([OFFLINE_STATE.CONFLICT, OFFLINE_STATE.BLOCKED].includes(normalizedStatus)) return false;
  if ([OFFLINE_STATE.CONFLICT, OFFLINE_STATE.BLOCKED].includes(offlineState)) return false;
  if (truthStatus === 'blocked') return false;
  if (normalizedReason === 'missing_recipe_freshness_conflict') return false;

  const referencesExistingRecipe = Boolean(
    recipe?.recipe_ref_id
    && !isLocalQueueRecipeId(recipe?.recipe_ref_id)
  );

  if (referencesExistingRecipe && !hasFreshness) return false;

  return true;
};

export const markQueueEntrySyncResult = ({ entry, status, reason, syncedRecipeRefId }) => {
  const now = new Date().toISOString();
  const syncedUpstreamId = status === OFFLINE_STATE.SYNCED && syncedRecipeRefId
    ? String(syncedRecipeRefId)
    : null;
  const nextRecipe = {
    ...(entry?.recipe || {}),
    recipe_ref_id: syncedUpstreamId || entry?.recipe?.recipe_ref_id,
    offline_sync_state: status,
    offline_sync_reason: reason
  };

  return {
    ...entry,
    status,
    reason,
    syncedAt: status === OFFLINE_STATE.SYNCED ? now : entry?.syncedAt,
    syncedRecipeRefId: syncedUpstreamId || entry?.syncedRecipeRefId,
    updatedAt: now,
    recipe: appendRecipeProfileAuditEvent({
      recipe: finalizeSyncedRecipeIdentity(nextRecipe, syncedUpstreamId),
      event: {
        eventType: status === OFFLINE_STATE.SYNCED ? 'recipe_synced' : 'recipe_sync_failed',
        actor: entry?.approvedBy || entry?.recipe?.approvedBy || entry?.recipe?.updated_by || 'manager',
        reason,
        status,
        syncedAt: status === OFFLINE_STATE.SYNCED ? now : '',
        syncedBy: entry?.approvedBy || entry?.recipe?.approvedBy || entry?.recipe?.updated_by || 'manager',
        queueEntryId: entry?.id || '',
        changedFields: Array.isArray(entry?.recipe?.changedFields) ? entry.recipe.changedFields : [],
        retrainingFields: Array.isArray(entry?.recipe?.retrainingFields) ? entry.recipe.retrainingFields : []
      }
    })
  };
};

export const summarizeOfflineQueue = (queue) => {
  const entries = Array.isArray(queue?.entries) ? queue.entries : [];
  const summary = {
    total: entries.length,
    local: 0,
    pending: 0,
    approval_required: 0,
    approved: 0,
    synced: 0,
    failed: 0,
    blocked: 0,
    conflict: 0
  };

  entries.forEach((entry) => {
    const status = normalizeScope(entry?.status) || 'pending';
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }
  });

  return {
    ...summary,
    hasQueue: summary.total > 0,
    labels: OFFLINE_QUEUE_STATUS_LABELS
  };
};

export const mergeRecipesWithQueue = (recipes = [], queue = null) => {
  const recipeList = consolidateRecipeTruths(recipes);
  const queueEntries = Array.isArray(queue?.entries) ? queue.entries : [];
  const merged = [...recipeList];
  const byKey = new Map();
  const byAlias = new Map();

  const keyFor = (recipe) => (
    recipe?.recipe_ref_id ||
    recipe?.canonical_id ||
    recipe?.id ||
    recipe?.clean_name ||
    recipe?.name ||
    null
  );
  const aliasKeysFor = (recipe = {}) => buildRecipeAliases(recipe).map((alias) => normalizeScope(alias)).filter(Boolean);
  const isCanonicalLikeRecipe = (recipe = {}) => ['canonical', 'canonical_with_local_changes'].includes(normalizeScope(recipe?.source_trust));
  const hasFreshnessAnchor = (entry = {}, recipe = {}) => Boolean(
    getQueuedRecipeBaseFreshness(entry)
    || recipe?.offline_base_freshness
    || recipe?._offline_base_freshness
  );

  merged.forEach((recipe, index) => {
    const key = keyFor(recipe);
    if (key) byKey.set(key, index);
    aliasKeysFor(recipe).forEach((alias) => {
      if (!byAlias.has(alias)) byAlias.set(alias, index);
    });
  });

  queueEntries.forEach((entry) => {
    const rawQueuedRecipe = sanitizeQueuedRecipe(entry?.recipe || {}, entry?.clientId);
    const syncedUpstreamId = entry?.status === OFFLINE_STATE.SYNCED
      ? entry?.syncedRecipeRefId || rawQueuedRecipe.recipe_ref_id
      : null;
    const queuedRecipe = finalizeSyncedRecipeIdentity(rawQueuedRecipe, syncedUpstreamId);
    const queuedTruth = buildQueuedRecipeTruthMetadata(queuedRecipe, entry?.status || queuedRecipe.offline_sync_state);
    const isSyncedEntry = (entry?.status || queuedRecipe.offline_sync_state) === OFFLINE_STATE.SYNCED;
    const key = keyFor(queuedRecipe);
    if (!key) return;
    const aliasKeys = aliasKeysFor(queuedRecipe);
    const matchedByKey = byKey.has(key);
    const matchedIndex = matchedByKey
      ? byKey.get(key)
      : aliasKeys.find((alias) => byAlias.has(alias)) !== undefined
        ? byAlias.get(aliasKeys.find((alias) => byAlias.has(alias)))
        : null;

    if (matchedIndex !== null && matchedIndex !== undefined) {
      if (isSyncedEntry) return;
      const existingIndex = matchedIndex;
      const existingRecipe = merged[existingIndex] || {};
      const existingFlags = Array.isArray(existingRecipe.recipe_truth_flags) ? existingRecipe.recipe_truth_flags : [];
      const freshnessBacked = hasFreshnessAnchor(entry, queuedRecipe);
      const shouldForceConflict = isCanonicalLikeRecipe(existingRecipe) && !freshnessBacked && !matchedByKey;
      const effectiveStatus = shouldForceConflict ? OFFLINE_STATE.CONFLICT : (entry?.status || queuedRecipe.offline_sync_state);
      const effectiveReason = shouldForceConflict ? 'missing_recipe_freshness_conflict' : (entry?.reason || queuedRecipe.offline_sync_reason);
      const effectiveTruth = shouldForceConflict
        ? buildQueuedRecipeTruthMetadata(queuedRecipe, OFFLINE_STATE.CONFLICT)
        : queuedTruth;
      const queuedFlags = Array.isArray(effectiveTruth.recipe_truth_flags) ? effectiveTruth.recipe_truth_flags : [];
      const mergedAliases = [...new Set([
        ...buildRecipeAliases(existingRecipe),
        ...buildRecipeAliases(queuedRecipe)
      ])];
      const preserveCanonicalIdentity = existingRecipe.source_trust === 'canonical' || existingRecipe.source_trust === 'canonical_with_local_changes';
      const mergedRecipeBase = shouldForceConflict
        ? existingRecipe
        : {
          ...existingRecipe,
          ...queuedRecipe
        };
      merged[existingIndex] = {
        ...mergedRecipeBase,
        ...(preserveCanonicalIdentity ? {
          id: existingRecipe.id,
          recipe_ref_id: existingRecipe.recipe_ref_id,
          canonical_id: existingRecipe.canonical_id,
          canonical_name: existingRecipe.canonical_name || existingRecipe.clean_name || existingRecipe.name || queuedRecipe.canonical_name,
          clean_name: existingRecipe.clean_name || existingRecipe.name || queuedRecipe.clean_name,
          name: existingRecipe.name || queuedRecipe.name,
          title: existingRecipe.title || existingRecipe.name || queuedRecipe.title
        } : {}),
        offline_sync_state: effectiveStatus,
        offline_sync_reason: effectiveReason,
        offline_queue_source: entry?.source || queuedRecipe.offline_queue_source,
        offline_queue_entry_id: entry?.id || queuedRecipe.id,
        source_trust: shouldForceConflict
          ? existingRecipe.source_trust
          : (existingRecipe.source_trust === 'canonical' ? 'canonical_with_local_changes' : effectiveTruth.source_trust),
        recipe_truth_status: effectiveTruth.recipe_truth_status,
        recipe_truth_tier: Math.max(Number(existingRecipe.recipe_truth_tier || 0), Number(effectiveTruth.recipe_truth_tier || 0)),
        recipe_trust_score: Math.max(Number(existingRecipe.recipe_trust_score || 0), Number(effectiveTruth.recipe_trust_score || 0)),
        recipe_truth_flags: [...new Set([...existingFlags, ...queuedFlags])],
        recipe_aliases: mergedAliases,
        recipe_canonical_hint: effectiveTruth.recipe_canonical_hint,
        has_unapproved_changes: [OFFLINE_STATE.LOCAL, OFFLINE_STATE.PENDING, OFFLINE_STATE.APPROVAL_REQUIRED, OFFLINE_STATE.CONFLICT].includes(effectiveStatus)
      };
      byKey.set(key, existingIndex);
      mergedAliases.map((alias) => normalizeScope(alias)).filter(Boolean).forEach((alias) => {
        if (!byAlias.has(alias)) byAlias.set(alias, existingIndex);
      });
      return;
    }

    byKey.set(key, merged.length);
    aliasKeys.forEach((alias) => {
      if (!byAlias.has(alias)) byAlias.set(alias, merged.length);
    });
    merged.push({
      ...queuedRecipe,
      offline_sync_state: entry?.status || queuedRecipe.offline_sync_state,
      offline_sync_reason: entry?.reason || queuedRecipe.offline_sync_reason,
      offline_queue_source: entry?.source || queuedRecipe.offline_queue_source,
      offline_queue_entry_id: entry?.id || queuedRecipe.id,
      ...queuedTruth,
      has_unapproved_changes: [OFFLINE_STATE.LOCAL, OFFLINE_STATE.PENDING, OFFLINE_STATE.APPROVAL_REQUIRED].includes(entry?.status || queuedRecipe.offline_sync_state)
    });
  });

  return merged;
};
