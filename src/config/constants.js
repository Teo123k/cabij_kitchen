/**
 * Global Configuration Constants for Cabij App
 */

export const DASHBOARD_VIEWS = {
  SCALER: 'scaler',
  ORDERING: 'ordering',
  BOARD: 'board',
  MANAGER: 'manager',
  PRESENTATION: 'presentation',
  PREP_SETUP: 'prep_setup',
  SETTINGS: 'settings'
};

export const DEFAULT_CLIENT_CONFIG = {
  SUBTITLE: 'Operation Hub',
  ACCENT_COLOR: '#d0aa49'
};

export const VOLUME_FOCUS_CONFIG = {
  MIN: 10,
  MAX: 1000,
  STEP: 10
};

export const SKELETON_CATEGORIES = [
  'PRODUCE',
  'PROTEIN',
  'DRY GOODS'
];

export const CONVERSION_UNITS = {
  LARGE: ['kg', 'l', 'liter'],
  SMALL: ['g', 'ml']
};

export const UI_LIMITS = {
  INGREDIENT_SKELETON_COUNT: 6,
  MARKET_SKELETON_COUNT: 4
};

export const AGGREGATION_CONFIG = {
  MAX_DEPTH: 6,
  DEFAULT_CATEGORY: 'other',
  DEFAULT_UNIT: 'units'
};

export const NEXT_ACTION_MESSAGES = {
  TEST_MODE: "Test Mode Active: Simulating required portions for service. Review specific ingredient weights before final prep.",
  PRODUCTION_MODE: (recipeName) => `Production Mode: Scaling ${recipeName || 'Recipe'} to target batch size. Click 'Clean & Fix' to find the most accurate operational weights.`
};

export const UNIT_SYSTEMS = {
  IMPERIAL: 'imperial',
  METRIC: 'metric'
};

export const TARGET_UNITS = {
  WEIGHT: 'g',
  VOLUME: 'ml'
};

export const DB_FIELDS = {
  RECIPE_JSON: 'recipe_json',
  DISH_STYLE: 'dish_style',
  CUISINE_TYPE: 'cuisine_type'
};

export const RECIPE_SOURCE = {
  SUPABASE_RECIPES: 'recipes'
};

export const MANAGER_APPROVAL_ROLE_KEYS = ['admin', 'manager', 'chef', 'head_chef', 'executive_chef', 'sous_chef', 'owner'];

export const ROLE_WORKSPACE_TYPES = {
  STAFF: 'staff',
  MANAGER: 'manager',
  OWNER: 'owner'
};

export const buildRoleWorkspaceConfig = ({
  normalizedRole = '',
  canApproveSync = false,
  identitySessionState = null
} = {}) => {
  const roleKey = normalizeText(normalizedRole);
  const managerRole = MANAGER_APPROVAL_ROLE_KEYS.includes(roleKey);
  const canUsePrivilegedWorkspace = identitySessionState?.canUsePrivilegedWorkspace !== false;

  if (!canUsePrivilegedWorkspace) {
    return {
      workspaceType: ROLE_WORKSPACE_TYPES.STAFF,
      label: 'Staff workspace',
      roleLabel: 'Staff',
      defaultView: DASHBOARD_VIEWS.BOARD,
      allowedViews: [
        DASHBOARD_VIEWS.BOARD,
        DASHBOARD_VIEWS.PRESENTATION,
        DASHBOARD_VIEWS.SCALER,
        DASHBOARD_VIEWS.PREP_SETUP
      ],
      startLabel: 'Start with prep',
      startView: DASHBOARD_VIEWS.BOARD,
      entryCopy: identitySessionState?.reason
        || 'Signed-in identity needs review. Stay in the lower-noise staff lane until trusted kitchen access returns.'
    };
  }

  if (roleKey === 'owner') {
    return {
      workspaceType: ROLE_WORKSPACE_TYPES.OWNER,
      label: 'Owner workspace',
      roleLabel: 'Owner',
      defaultView: DASHBOARD_VIEWS.ORDERING,
      allowedViews: [
        DASHBOARD_VIEWS.ORDERING,
        DASHBOARD_VIEWS.PRESENTATION,
        DASHBOARD_VIEWS.SCALER,
        DASHBOARD_VIEWS.BOARD,
        DASHBOARD_VIEWS.MANAGER,
        DASHBOARD_VIEWS.PREP_SETUP,
        DASHBOARD_VIEWS.SETTINGS
      ],
      startLabel: 'Start with cost',
      startView: DASHBOARD_VIEWS.ORDERING,
      entryCopy: 'Start with cost, readiness, and business pressure. Open recipe truth or approvals only when a decision needs owner attention.'
    };
  }

  if (canApproveSync || managerRole) {
    return {
      workspaceType: ROLE_WORKSPACE_TYPES.MANAGER,
      label: 'Manager workspace',
      roleLabel: 'Manager',
      defaultView: DASHBOARD_VIEWS.SCALER,
      allowedViews: [
        DASHBOARD_VIEWS.SCALER,
        DASHBOARD_VIEWS.BOARD,
        DASHBOARD_VIEWS.PRESENTATION,
        DASHBOARD_VIEWS.ORDERING,
        DASHBOARD_VIEWS.MANAGER,
        DASHBOARD_VIEWS.PREP_SETUP,
        DASHBOARD_VIEWS.SETTINGS
      ],
      startLabel: 'Start with recipe truth',
      startView: DASHBOARD_VIEWS.SCALER,
      entryCopy: 'Start with recipe truth and approvals, then move into prep, training, or cost when the kitchen needs direction.'
    };
  }

  return {
    workspaceType: ROLE_WORKSPACE_TYPES.STAFF,
    label: 'Staff workspace',
    roleLabel: 'Staff',
    defaultView: DASHBOARD_VIEWS.BOARD,
    allowedViews: [
      DASHBOARD_VIEWS.BOARD,
      DASHBOARD_VIEWS.PRESENTATION,
      DASHBOARD_VIEWS.SCALER,
      DASHBOARD_VIEWS.PREP_SETUP
    ],
    startLabel: 'Start with prep',
    startView: DASHBOARD_VIEWS.BOARD,
    entryCopy: 'Start with the prep board, follow the tasks, then open training or recipe truth only when you need the next instruction.'
  };
};

const parseJsonValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  return null;
};

const parseJsonRecipe = (value) => {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
};

const parseJsonArray = (value) => {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : null;
};

const parseTextList = (value, splitPattern = /[\n|]+/) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }

  const parsedArray = parseJsonArray(value);
  if (parsedArray) {
    return parsedArray
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(splitPattern)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return null;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export const normalizeRecipeLookupValue = (value) => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/^[0-9]+[\.\)\s-]+/, '')
  .replace(/\s*\(.*?\)\s*/g, ' ')
  .replace(/[_/]+/g, ' ')
  .replace(/[^\w\s-]/g, ' ')
  .replace(/-/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const buildRecipeLookupAliases = (recipe = {}, fallback = null) => {
  const aliasCandidates = [
    recipe?.recipe_ref_id,
    recipe?.canonical_id,
    recipe?.id,
    recipe?.code,
    recipe?.recipeCode,
    recipe?.recipe_code,
    recipe?.sku,
    recipe?.canonical_name,
    recipe?.clean_name,
    recipe?.title,
    recipe?.name,
    ...(Array.isArray(recipe?.recipe_aliases) ? recipe.recipe_aliases : []),
    fallback
  ];

  const seen = new Set();
  return aliasCandidates.filter((alias) => {
    const normalizedAlias = normalizeRecipeLookupValue(alias);
    if (!normalizedAlias || seen.has(normalizedAlias)) return false;
    seen.add(normalizedAlias);
    return true;
  });
};

export const getRecipeLookupKey = (recipe = {}, fallback = null) => {
  const preferredKey = [
    recipe?.recipe_ref_id,
    recipe?.canonical_id,
    recipe?.id,
    recipe?.code,
    recipe?.recipeCode,
    recipe?.recipe_code,
    recipe?.sku,
    recipe?.clean_name,
    recipe?.name,
    fallback
  ].find((value) => normalizeRecipeLookupValue(value));

  return preferredKey || fallback;
};

export const recipeMatchesLookup = (recipe = {}, candidates = [], fallback = null) => {
  const normalizedCandidates = [...new Set(
    (Array.isArray(candidates) ? candidates : [candidates])
      .map((candidate) => normalizeRecipeLookupValue(candidate))
      .filter(Boolean)
  )];

  if (!normalizedCandidates.length) return false;

  const aliases = new Set(
    buildRecipeLookupAliases(recipe, fallback).map((alias) => normalizeRecipeLookupValue(alias)).filter(Boolean)
  );

  return normalizedCandidates.some((candidate) => aliases.has(candidate));
};

export const buildRecipeSearchIndexEntry = (recipe = {}, {
  getRecipeName = (target) => target?.name || target?.title || 'Unnamed',
  getRecipeStyle = (target) => canonicalizeRecipeTaxonomy('style', target?.dishStyle || target?.style || 'Kitchen Standard'),
  getRecipeCuisine = (target) => canonicalizeRecipeTaxonomy('cuisine', target?.cuisine || target?.cuisineType || target?.dishCuisine || target?.dish_cuisine || 'General'),
  getRecipeCategory = (target) => canonicalizeRecipeTaxonomy('category', target?.dishCategory || target?.category || 'General'),
  getRecipeOccasion = (target) => canonicalizeRecipeTaxonomy('occasion', target?.occasion || target?.serviceOccasion || target?.course || 'Service'),
  getRecipeCode = (target) => target?.code || target?.recipeCode || target?.recipe_code || target?.sku || target?.recipe_ref_id || target?.canonical_id || ''
} = {}) => {
  const title = normalizeRecipeLookupValue(getRecipeName(recipe));
  const canonical = normalizeRecipeLookupValue(recipe?.canonical_name || recipe?.clean_name || recipe?.title || '');
  const clean = normalizeRecipeLookupValue(recipe?.clean_name || '');
  const style = normalizeRecipeLookupValue(getRecipeStyle(recipe));
  const cuisine = normalizeRecipeLookupValue(getRecipeCuisine(recipe));
  const category = normalizeRecipeLookupValue(getRecipeCategory(recipe));
  const occasion = normalizeRecipeLookupValue(getRecipeOccasion(recipe));
  const code = normalizeRecipeLookupValue(getRecipeCode(recipe));
  const canonicalId = normalizeRecipeLookupValue(recipe?.canonical_id || recipe?.recipe_ref_id || '');
  const aliasTokens = buildRecipeLookupAliases(recipe)
    .map((alias) => normalizeRecipeLookupValue(alias))
    .filter(Boolean);
  const ingredients = normalizeRecipeLookupValue((Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
    .map((ingredient) => {
      if (typeof ingredient === 'string') return ingredient;
      return ingredient?.name || ingredient?.ingredient_name || '';
    })
    .filter(Boolean)
    .join(' '));

  return {
    title,
    titleTokens: title.split(/\s+/).filter(Boolean),
    canonical,
    canonicalTokens: canonical.split(/\s+/).filter(Boolean),
    clean,
    style,
    cuisine,
    category,
    occasion,
    code,
    canonicalId,
    aliasTokens,
    ingredients
  };
};

export const scoreRecipeSearchIndex = (indexedRecipe = {}, needle = '', chipMode = 'title') => {
  const normalizedNeedle = normalizeRecipeLookupValue(needle);
  if (!normalizedNeedle) return { score: 0, matched: true };

  const queryTokens = [...new Set(normalizedNeedle.split(/\s+/).filter(Boolean))];
  if (!queryTokens.length) return { score: 0, matched: true };

  const scoreToken = (token) => {
    if (!token) return { matched: true, score: 0, ingredientOnly: false };

    const titleExact = indexedRecipe.title === token;
    const titlePrefix = indexedRecipe.title.startsWith(token);
    const titleTokenPrefix = indexedRecipe.titleTokens.some((part) => part.startsWith(token));
    const titleContains = indexedRecipe.title.includes(token);
    const canonicalExact = indexedRecipe.canonical === token;
    const canonicalTokenPrefix = indexedRecipe.canonicalTokens.some((part) => part.startsWith(token));
    const canonicalContains = indexedRecipe.canonical.includes(token);
    const cleanContains = indexedRecipe.clean.includes(token);
    const codeExact = indexedRecipe.code === token;
    const codePrefix = indexedRecipe.code.startsWith(token);
    const codeContains = indexedRecipe.code.includes(token);
    const canonicalIdExact = indexedRecipe.canonicalId === token;
    const canonicalIdPrefix = indexedRecipe.canonicalId.startsWith(token);
    const aliasExact = indexedRecipe.aliasTokens.some((alias) => alias === token);
    const aliasPrefix = indexedRecipe.aliasTokens.some((alias) => alias.startsWith(token));
    const aliasContains = indexedRecipe.aliasTokens.some((alias) => alias.includes(token));
    const styleExact = indexedRecipe.style === token || indexedRecipe.style.startsWith(token) || indexedRecipe.style.includes(token);
    const cuisineExact = indexedRecipe.cuisine === token || indexedRecipe.cuisine.startsWith(token) || indexedRecipe.cuisine.includes(token);
    const categoryMatch = indexedRecipe.category === token || indexedRecipe.category.startsWith(token) || indexedRecipe.category.includes(token);
    const occasionMatch = indexedRecipe.occasion === token || indexedRecipe.occasion.startsWith(token) || indexedRecipe.occasion.includes(token);
    const ingredientMatch = indexedRecipe.ingredients.includes(token);

    const matches = [
      titleExact ? 0 : null,
      titlePrefix ? 2 : null,
      canonicalIdExact ? 2 : null,
      titleTokenPrefix ? 3 : null,
      codeExact ? 3 : null,
      aliasExact ? 4 : null,
      titleContains ? 5 : null,
      canonicalExact ? 5 : null,
      canonicalIdPrefix ? 5 : null,
      codePrefix ? 6 : null,
      canonicalTokenPrefix ? 6 : null,
      aliasPrefix ? 7 : null,
      canonicalContains ? 8 : null,
      codeContains ? 8 : null,
      cleanContains ? 9 : null,
      aliasContains ? 10 : null,
      styleExact ? 14 : null,
      cuisineExact ? 16 : null,
      categoryMatch ? 20 : null,
      occasionMatch ? 22 : null,
      ingredientMatch ? 24 : null
    ].filter((value) => value !== null && value !== undefined);

    if (!matches.length) {
      return { matched: false, score: 9999, ingredientOnly: false };
    }

    const bestScore = Math.min(...matches);
    return {
      matched: true,
      score: bestScore,
      ingredientOnly: bestScore >= 24 && ingredientMatch
    };
  };

  const tokenResults = queryTokens.map((token) => scoreToken(token));
  if (tokenResults.some((result) => !result.matched)) {
    return { score: 9999, matched: false };
  }

  const bestTokenScore = Math.min(...tokenResults.map((result) => result.score));
  const worstTokenScore = Math.max(...tokenResults.map((result) => result.score));
  const allIngredientOnly = tokenResults.every((result) => result.ingredientOnly);
  const multiTokenPenalty = queryTokens.length > 1 ? (queryTokens.length - 1) * 1.5 : 0;
  const ingredientOnlyPenalty = allIngredientOnly ? 4 : 0;

  const chipBonus = chipMode === 'style' && indexedRecipe.style.includes(normalizedNeedle) ? -3
    : chipMode === 'cuisine' && indexedRecipe.cuisine.includes(normalizedNeedle) ? -3
      : chipMode === 'occasion' && indexedRecipe.occasion.includes(normalizedNeedle) ? -3
      : 0;

  const score = Math.max(
    0,
    bestTokenScore + (worstTokenScore * 0.2) + multiTokenPenalty + ingredientOnlyPenalty + chipBonus
  );

  return { score, matched: true };
};

export const buildRecipeBrowseGroups = (entries = [], getLabel = () => 'General') => {
  const grouped = (Array.isArray(entries) ? entries : []).reduce((acc, entry) => {
    const label = String(getLabel(entry?.recipe) || 'General').trim() || 'General';
    const key = normalizeRecipeLookupValue(label) || 'general';
    if (!acc[key]) acc[key] = { key, label, entries: [] };
    acc[key].entries.push(entry);
    return acc;
  }, {});

  return Object.values(grouped).sort((left, right) => {
    if (right.entries.length !== left.entries.length) return right.entries.length - left.entries.length;
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
};

export const resolveRecipeBrowseGroup = (groups = [], activeKey = '') => {
  const normalizedKey = normalizeRecipeLookupValue(activeKey);
  if (!normalizedKey) {
    return {
      activeKey: '',
      selectedGroup: null
    };
  }

  const selectedGroup = (Array.isArray(groups) ? groups : []).find((group) => group?.key === normalizedKey) || null;
  return {
    activeKey: selectedGroup?.key || '',
    selectedGroup
  };
};

export const buildRecipeQuickPickEntries = (entries = [], {
  selectedId = '',
  limit = 6
} = {}) => {
  const seen = new Set();
  const ranked = (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((left, right) => {
      const leftSelected = String(left?.id || '') === String(selectedId || '');
      const rightSelected = String(right?.id || '') === String(selectedId || '');
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;

      if (right?.touchpoint !== left?.touchpoint) return Number(right?.touchpoint || 0) - Number(left?.touchpoint || 0);
      if (left?.canonicalPriority !== right?.canonicalPriority) return Number(left?.canonicalPriority || 0) - Number(right?.canonicalPriority || 0);
      if (left?.trust !== right?.trust) return Number(left?.trust || 0) - Number(right?.trust || 0);
      return String(left?.label || '').localeCompare(String(right?.label || ''));
    });

  return ranked.filter((entry) => {
    const identityKey = normalizeRecipeLookupValue(entry?.identityKey || entry?.id || entry?.label || '');
    if (!identityKey || seen.has(identityKey)) return false;
    seen.add(identityKey);
    return true;
  }).slice(0, limit);
};

const canonicalizeTokenSpacing = (value = '') => String(value || '')
  .trim()
  .replace(/[_/]+/g, ' ')
  .replace(/\s+/g, ' ');

const titleCaseWords = (value = '') => canonicalizeTokenSpacing(value)
  .split(' ')
  .filter(Boolean)
  .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`)
  .join(' ');

export const canonicalizeRecipeTaxonomy = (kind, value = '') => {
  const normalizedValue = normalizeText(canonicalizeTokenSpacing(value).replace(/-/g, ' '));
  if (!normalizedValue) {
    if (kind === 'style') return 'Kitchen Standard';
    if (kind === 'category') return 'General';
    if (kind === 'cuisine') return 'General';
    if (kind === 'occasion') return 'Service';
    return '';
  }

  const synonymMap = {
    style: [
      [/^(kitchen standard|standard|default)$/i, 'Kitchen Standard'],
      [/^(base|foundation|foundation prep|base prep)$/i, 'Base'],
      [/^(component|components)$/i, 'Component'],
      [/^(sauce|sauce prep|sauces)$/i, 'Sauce Prep'],
      [/^(stock|broth)$/i, 'Stock'],
      [/^(fried|fried protein|fry)$/i, 'Fried'],
      [/^(salad|salads)$/i, 'Salad'],
      [/^(dressing|dressings)$/i, 'Dressing'],
      [/^(prep|general prep)$/i, 'Prep']
    ],
    category: [
      [/^(general|general prep)$/i, 'General'],
      [/^(foundation|foundation prep|base)$/i, 'Foundation Prep'],
      [/^(component|components)$/i, 'Component'],
      [/^(service|service prep|line)$/i, 'Service'],
      [/^(sauce|sauce prep)$/i, 'Sauce Prep']
    ],
    cuisine: [
      [/^(general|house|house standard)$/i, 'General'],
      [/^(pan asian|pan-asian)$/i, 'Pan-Asian'],
      [/^(south east asian|southeast asian|south-east asian)$/i, 'Southeast Asian'],
      [/^(middle eastern|middle-east)$/i, 'Middle Eastern']
    ],
    occasion: [
      [/^(service|service prep)$/i, 'Service'],
      [/^(prep|production)$/i, 'Prep']
    ]
  };

  const kindMap = synonymMap[kind] || [];
  const matchedEntry = kindMap.find(([pattern]) => pattern.test(normalizedValue));
  if (matchedEntry) return matchedEntry[1];

  return titleCaseWords(value).replace(/\bAnd\b/g, 'and');
};

export const classifyKitchenUnit = (unit = '') => {
  const normalizedUnit = normalizeText(unit);
  if (!normalizedUnit) return '';

  if (/^(g|gram|grams|kg|kilogram|kilograms|oz|lb|pound|pounds)$/.test(normalizedUnit)) {
    return 'weight';
  }

  if (/^(ml|l|liter|litre|fl oz|cup|qt|tbsp|tsp)$/.test(normalizedUnit)) {
    return 'volume';
  }

  if (/^(portion|portions|pcs|piece|pieces|ea|each)$/.test(normalizedUnit)) {
    return 'count';
  }

  return 'unknown';
};

export const INVOICE_INGEST_CONTRACT_VERSION = 'cabij.invoice.ingest.v1';

export const INVOICE_INGEST_PREVIEW_PACKET = {
  contract_version: INVOICE_INGEST_CONTRACT_VERSION,
  packet_mode: 'preview',
  source_system: 'n8n.invoice-uploader',
  ingest_status: 'preview',
  supplier: {
    supplier_id: 'preview-supplier-produce-dairy',
    name: 'Preview Produce & Dairy'
  },
  invoice: {
    invoice_id: 'preview-invoice-2026-04-17',
    invoice_number: 'PREVIEW-2026-04-17',
    invoice_date: '2026-04-17',
    uploaded_at: '2026-04-17T07:00:00Z',
    currency: 'USD'
  },
  precedence: {
    strategy: 'most_recent_invoice_date',
    tie_breaker: 'latest_uploaded_at'
  },
  line_items: [
    {
      line_id: 'line-carrot',
      source_name: 'Carrot 5kg',
      canonical_ingredient_name: 'carrot',
      canonical_ingredient_key: 'carrot',
      canonical_aliases: ['carrot', 'carrots', 'carrots trimmed'],
      match_status: 'matched',
      match_confidence: 0.98,
      review_required: false,
      quantity: 1,
      pack_size: 5,
      pack_unit: 'kg',
      total_price: 10.5,
      normalized_cost_per_unit: 2.1,
      normalized_cost_unit: 'kg',
      source_date: '2026-04-17'
    },
    {
      line_id: 'line-tahini',
      source_name: 'Tahini Base 2L',
      canonical_ingredient_name: 'tahini base',
      canonical_ingredient_key: 'tahini-base',
      canonical_aliases: ['tahini base', 'tahini', 'sesame sauce'],
      match_status: 'matched',
      match_confidence: 0.94,
      review_required: false,
      quantity: 1,
      pack_size: 2,
      pack_unit: 'l',
      total_price: 15.6,
      normalized_cost_per_unit: 7.8,
      normalized_cost_unit: 'l',
      source_date: '2026-04-17'
    },
    {
      line_id: 'line-labneh',
      source_name: 'Green Herb Labneh 1kg',
      canonical_ingredient_name: 'green herb labneh',
      canonical_ingredient_key: 'green-herb-labneh',
      canonical_aliases: ['green herb labneh', 'labneh', 'herb labneh'],
      match_status: 'matched',
      match_confidence: 0.92,
      review_required: false,
      quantity: 1,
      pack_size: 1,
      pack_unit: 'kg',
      total_price: 8.4,
      normalized_cost_per_unit: 8.4,
      normalized_cost_unit: 'kg',
      source_date: '2026-04-17'
    },
    {
      line_id: 'line-smoked-oil',
      source_name: 'Garlic Oil 5L',
      canonical_ingredient_name: 'smoked garlic oil',
      canonical_ingredient_key: 'smoked-garlic-oil',
      canonical_aliases: ['smoked garlic oil', 'garlic oil'],
      match_status: 'review',
      match_confidence: 0.64,
      review_required: true,
      quantity: 1,
      pack_size: 5,
      pack_unit: 'l',
      total_price: 11,
      normalized_cost_per_unit: 2.2,
      normalized_cost_unit: 'l',
      source_date: '2026-04-17',
      review_reason: 'Invoice line says garlic oil. Chef must confirm it is the smoked prep oil.'
    },
    {
      line_id: 'line-seed-crunch',
      source_name: 'Mixed Seed Blend 2kg',
      canonical_ingredient_name: 'toasted seed crunch',
      canonical_ingredient_key: 'toasted-seed-crunch',
      canonical_aliases: ['toasted seed crunch', 'seed crunch', 'mixed seed blend'],
      match_status: 'review',
      match_confidence: 0.58,
      review_required: true,
      quantity: 1,
      pack_size: 2,
      pack_unit: 'kg',
      total_price: 36.8,
      normalized_cost_per_unit: 18.4,
      normalized_cost_unit: 'kg',
      source_date: '2026-04-17',
      review_reason: 'Supplier blend may include sesame and needs allergen confirmation.'
    },
    {
      line_id: 'line-lemon-dressing',
      source_name: 'Lemon Dressing 1L',
      canonical_ingredient_name: 'lemon dressing',
      canonical_ingredient_key: 'lemon-dressing',
      canonical_aliases: ['lemon dressing', 'lemon vinaigrette'],
      match_status: 'matched',
      match_confidence: 0.9,
      review_required: false,
      quantity: 1,
      pack_size: 1,
      pack_unit: 'l',
      total_price: 2.35,
      normalized_cost_per_unit: 2.35,
      normalized_cost_unit: 'l',
      source_date: '2026-04-17'
    }
  ]
};

export const INVOICE_INGEST_PREVIEW_HISTORY = [
  {
    contract_version: INVOICE_INGEST_CONTRACT_VERSION,
    packet_mode: 'preview',
    source_system: 'n8n.invoice-uploader',
    ingest_status: 'preview',
    supplier: {
      supplier_id: 'preview-supplier-market-wholesale',
      name: 'Market Wholesale'
    },
    invoice: {
      invoice_id: 'preview-invoice-2026-04-10',
      invoice_number: 'PREVIEW-2026-04-10',
      invoice_date: '2026-04-10',
      uploaded_at: '2026-04-10T07:00:00Z',
      currency: 'USD'
    },
    precedence: {
      strategy: 'most_recent_invoice_date',
      tie_breaker: 'latest_uploaded_at'
    },
    line_items: [
      {
        line_id: 'older-line-carrot',
        source_name: 'Carrots Trimmed 5kg',
        canonical_ingredient_name: 'carrot',
        canonical_ingredient_key: 'carrot',
        canonical_aliases: ['carrot', 'carrots', 'carrots trimmed'],
        match_status: 'matched',
        match_confidence: 0.95,
        review_required: false,
        quantity: 1,
        pack_size: 5,
        pack_unit: 'kg',
        total_price: 9.25,
        normalized_cost_per_unit: 1.85,
        normalized_cost_unit: 'kg',
        source_date: '2026-04-10'
      },
      {
        line_id: 'older-line-smoked-oil',
        source_name: 'Smoked Garlic Oil 2L',
        canonical_ingredient_name: 'smoked garlic oil',
        canonical_ingredient_key: 'smoked-garlic-oil',
        canonical_aliases: ['smoked garlic oil', 'garlic oil'],
        match_status: 'matched',
        match_confidence: 0.91,
        review_required: false,
        quantity: 1,
        pack_size: 2,
        pack_unit: 'l',
        total_price: 4.8,
        normalized_cost_per_unit: 2.4,
        normalized_cost_unit: 'l',
        source_date: '2026-04-10'
      }
    ]
  },
  INVOICE_INGEST_PREVIEW_PACKET
];

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const toComparableUnit = (qty, unit = '') => {
  const amount = Number(qty);
  if (!(amount > 0)) return { amount: 0, unit: '', domain: '' };

  const normalizedUnit = normalizeText(unit);
  const domain = classifyKitchenUnit(normalizedUnit);

  if (domain === 'weight') {
    if (/^(kg|kilogram|kilograms)$/.test(normalizedUnit)) return { amount: amount * 1000, unit: 'g', domain };
    if (/^(lb|pound|pounds)$/.test(normalizedUnit)) return { amount: amount * 453.592, unit: 'g', domain };
    if (/^(oz)$/.test(normalizedUnit)) return { amount: amount * 28.3495, unit: 'g', domain };
    return { amount, unit: 'g', domain };
  }

  if (domain === 'volume') {
    if (/^(l|liter|litre)$/.test(normalizedUnit)) return { amount: amount * 1000, unit: 'ml', domain };
    if (/^(cup)$/.test(normalizedUnit)) return { amount: amount * 240, unit: 'ml', domain };
    if (/^(tbsp)$/.test(normalizedUnit)) return { amount: amount * 15, unit: 'ml', domain };
    if (/^(tsp)$/.test(normalizedUnit)) return { amount: amount * 5, unit: 'ml', domain };
    if (/^(fl oz)$/.test(normalizedUnit)) return { amount: amount * 29.5735, unit: 'ml', domain };
    return { amount, unit: 'ml', domain };
  }

  if (domain === 'count') {
    return { amount, unit: 'each', domain };
  }

  return { amount, unit: normalizedUnit || String(unit || '').trim(), domain };
};

const formatCurrencyValue = (amount, currency = 'USD') => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return 'Review';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);
};

const formatInvoiceUsageQuantity = (qty, unit = '') => {
  const numericQty = Number(qty);
  const trimmedUnit = String(unit || '').trim();
  if (!(numericQty > 0)) return trimmedUnit || 'Not set';
  if (!trimmedUnit) return `${numericQty}`;
  return `${numericQty} ${trimmedUnit}`;
};

const buildInvoiceLineAliases = (lineItem = {}) => {
  const aliasCandidates = [
    lineItem?.canonical_ingredient_key,
    lineItem?.canonical_ingredient_name,
    ...(Array.isArray(lineItem?.canonical_aliases) ? lineItem.canonical_aliases : []),
    lineItem?.source_name
  ];

  const seen = new Set();
  return aliasCandidates.reduce((acc, candidate) => {
    const normalizedAlias = normalizeRecipeLookupValue(candidate);
    if (!normalizedAlias || seen.has(normalizedAlias)) return acc;
    seen.add(normalizedAlias);
    acc.push(normalizedAlias);
    return acc;
  }, []);
};

const buildIngredientInvoiceCandidates = (ingredient = {}, packets = []) => {
  const ingredientAliases = buildRecipeLookupAliases({
    name: ingredient?.name || ingredient?.ingredient_name || ingredient?.canonical_name || '',
    recipe_aliases: ingredient?.ingredient_aliases || ingredient?.aliases || []
  });

  const ingredientAliasSet = new Set(
    ingredientAliases
      .map((alias) => normalizeRecipeLookupValue(alias))
      .filter(Boolean)
  );

  return normalizeInvoiceIngestPackets(packets).flatMap((packet) => (
    (Array.isArray(packet?.lineItems) ? packet.lineItems : [])
      .filter((lineItem) => {
        const aliases = Array.isArray(lineItem?.aliases) ? lineItem.aliases : [];
        return aliases.some((alias) => ingredientAliasSet.has(alias));
      })
      .map((lineItem) => {
        const timestamps = buildInvoiceLineTimestamp(lineItem, packet);
        return {
          ...lineItem,
          supplierName: packet?.supplier?.name || 'Unknown supplier',
          invoiceId: packet?.invoice?.invoiceId || '',
          invoiceNumber: packet?.invoice?.invoiceNumber || '',
          invoiceDate: packet?.invoice?.invoiceDate || '',
          uploadedAt: packet?.invoice?.uploadedAt || '',
          currency: packet?.invoice?.currency || 'USD',
          packetMode: packet?.packetMode || 'live',
          ingestStatus: packet?.ingestStatus || 'parsed',
          precedenceStrategy: packet?.precedence?.strategy || 'most_recent_invoice_date',
          precedenceTieBreaker: packet?.precedence?.tieBreaker || 'latest_uploaded_at',
          sourceDateMs: timestamps.sourceDate,
          uploadedAtMs: timestamps.uploadedAt
        };
      })
  ));
};

export const selectLatestTrustedIngredientCost = (ingredient = {}, packets = []) => {
  const candidates = buildIngredientInvoiceCandidates(ingredient, packets);
  const trustedCandidates = candidates
    .filter((candidate) => (
      candidate?.matchStatus === 'matched'
      && !candidate?.reviewRequired
      && Number(candidate?.normalizedCostPerUnit || 0) > 0
      && classifyKitchenUnit(candidate?.normalizedCostUnit || '') !== 'unknown'
    ))
    .sort((a, b) => {
      if (b.sourceDateMs !== a.sourceDateMs) return b.sourceDateMs - a.sourceDateMs;
      if (b.uploadedAtMs !== a.uploadedAtMs) return b.uploadedAtMs - a.uploadedAtMs;
      if ((Number(b.matchConfidence) || 0) !== (Number(a.matchConfidence) || 0)) {
        return (Number(b.matchConfidence) || 0) - (Number(a.matchConfidence) || 0);
      }
      return String(a.lineId || '').localeCompare(String(b.lineId || ''));
    });

  const pendingReviewCandidate = candidates
    .filter((candidate) => candidate?.reviewRequired || candidate?.matchStatus === 'review')
    .sort((a, b) => {
      if (b.sourceDateMs !== a.sourceDateMs) return b.sourceDateMs - a.sourceDateMs;
      if (b.uploadedAtMs !== a.uploadedAtMs) return b.uploadedAtMs - a.uploadedAtMs;
      return (Number(b.matchConfidence) || 0) - (Number(a.matchConfidence) || 0);
    })[0] || null;

  return {
    selectedCandidate: trustedCandidates[0] || null,
    trustedCandidates,
    pendingReviewCandidate,
    candidateCount: candidates.length
  };
};

const resolveIngredientUsageCost = ({
  usageQty = 0,
  usageUnit = '',
  lineItem = null
} = {}) => {
  const comparableUsage = toComparableUnit(usageQty, usageUnit);
  const comparableInvoice = toComparableUnit(1, lineItem?.normalizedCostUnit || '');
  const unitPrice = Number(lineItem?.normalizedCostPerUnit || 0);

  if (!(unitPrice > 0) || !comparableUsage.unit || !comparableInvoice.unit) {
    return { totalCost: null, costLabel: 'Review', totalLabel: 'Review', requiresReview: true };
  }

  if (comparableUsage.domain !== comparableInvoice.domain || comparableUsage.unit !== comparableInvoice.unit) {
    return { totalCost: null, costLabel: `${formatCurrencyValue(unitPrice)} / ${lineItem?.normalizedCostUnit || 'unit'}`, totalLabel: 'Unit review', requiresReview: true };
  }

  const unitPricePerComparableUnit = unitPrice / comparableInvoice.amount;
  const totalCost = comparableUsage.amount * unitPricePerComparableUnit;

  return {
    totalCost,
    costLabel: `${formatCurrencyValue(unitPrice)} / ${lineItem?.normalizedCostUnit || 'unit'}`,
    totalLabel: formatCurrencyValue(totalCost),
    requiresReview: false
  };
};

export const normalizeInvoiceIngestPacket = (packet = {}) => {
  const lineItems = Array.isArray(packet?.line_items)
    ? packet.line_items
    : Array.isArray(packet?.lineItems)
      ? packet.lineItems
      : [];

  const normalizedLineItems = lineItems.map((lineItem, index) => {
    const matchStatus = String(lineItem?.match_status || lineItem?.matchStatus || 'unmatched').trim().toLowerCase();
    const normalizedCostPerUnit = Number(lineItem?.normalized_cost_per_unit ?? lineItem?.normalizedCostPerUnit ?? 0);

    return {
      lineId: lineItem?.line_id || lineItem?.lineId || `line-${index + 1}`,
      sourceName: lineItem?.source_name || lineItem?.sourceName || `Invoice line ${index + 1}`,
      canonicalIngredientName: lineItem?.canonical_ingredient_name || lineItem?.canonicalIngredientName || '',
      canonicalIngredientKey: lineItem?.canonical_ingredient_key || lineItem?.canonicalIngredientKey || normalizeRecipeLookupValue(lineItem?.canonical_ingredient_name || lineItem?.source_name || `line-${index + 1}`),
      aliases: buildInvoiceLineAliases(lineItem),
      matchStatus,
      matchConfidence: Math.max(0, Math.min(1, Number(lineItem?.match_confidence ?? lineItem?.matchConfidence ?? 0))),
      reviewRequired: Boolean(lineItem?.review_required ?? lineItem?.reviewRequired ?? (matchStatus === 'review')),
      reviewReason: lineItem?.review_reason || lineItem?.reviewReason || '',
      quantity: Number(lineItem?.quantity ?? 0),
      packSize: Number(lineItem?.pack_size ?? lineItem?.packSize ?? 0),
      packUnit: lineItem?.pack_unit || lineItem?.packUnit || '',
      totalPrice: Number(lineItem?.total_price ?? lineItem?.totalPrice ?? 0),
      normalizedCostPerUnit: normalizedCostPerUnit > 0 ? normalizedCostPerUnit : 0,
      normalizedCostUnit: lineItem?.normalized_cost_unit || lineItem?.normalizedCostUnit || '',
      sourceDate: lineItem?.source_date || lineItem?.sourceDate || packet?.invoice?.invoice_date || packet?.invoice?.invoiceDate || ''
    };
  });

  const matchedCount = normalizedLineItems.filter((lineItem) => lineItem.matchStatus === 'matched' && !lineItem.reviewRequired).length;
  const reviewCount = normalizedLineItems.filter((lineItem) => lineItem.reviewRequired || lineItem.matchStatus === 'review').length;
  const unmatchedCount = normalizedLineItems.filter((lineItem) => lineItem.matchStatus === 'unmatched').length;
  const coveragePercent = normalizedLineItems.length
    ? clampPercent((matchedCount / normalizedLineItems.length) * 100)
    : 0;

  return {
    contractVersion: packet?.contract_version || packet?.contractVersion || INVOICE_INGEST_CONTRACT_VERSION,
    packetMode: packet?.packet_mode || packet?.packetMode || 'live',
    sourceSystem: packet?.source_system || packet?.sourceSystem || 'unknown',
    ingestStatus: packet?.ingest_status || packet?.ingestStatus || 'parsed',
    supplier: {
      supplierId: packet?.supplier?.supplier_id || packet?.supplier?.supplierId || '',
      name: packet?.supplier?.name || 'Unknown supplier'
    },
    invoice: {
      invoiceId: packet?.invoice?.invoice_id || packet?.invoice?.invoiceId || '',
      invoiceNumber: packet?.invoice?.invoice_number || packet?.invoice?.invoiceNumber || '',
      invoiceDate: packet?.invoice?.invoice_date || packet?.invoice?.invoiceDate || '',
      uploadedAt: packet?.invoice?.uploaded_at || packet?.invoice?.uploadedAt || '',
      currency: packet?.invoice?.currency || 'USD'
    },
    precedence: {
      strategy: packet?.precedence?.strategy || 'most_recent_invoice_date',
      tieBreaker: packet?.precedence?.tie_breaker || packet?.precedence?.tieBreaker || 'latest_uploaded_at'
    },
    lineItems: normalizedLineItems,
    summary: {
      lineItemCount: normalizedLineItems.length,
      matchedCount,
      reviewCount,
      unmatchedCount,
      coveragePercent
    }
  };
};

export const normalizeInvoiceIngestPackets = (packets = []) => (
  (Array.isArray(packets) ? packets : [packets])
    .filter(Boolean)
    .map((packet) => (
      packet?.contractVersion && Array.isArray(packet?.lineItems)
        ? packet
        : normalizeInvoiceIngestPacket(packet)
    ))
);

const buildInvoiceLineTimestamp = (lineItem = {}, packet = {}) => {
  const sourceDate = Date.parse(lineItem?.sourceDate || packet?.invoice?.invoiceDate || '');
  const uploadedAt = Date.parse(packet?.invoice?.uploadedAt || '');

  return {
    sourceDate: Number.isFinite(sourceDate) ? sourceDate : 0,
    uploadedAt: Number.isFinite(uploadedAt) ? uploadedAt : 0
  };
};

const buildCostDeltaSummary = ({ selectedCandidate = null, trustedCandidates = [], pendingReviewCandidate = null } = {}) => {
  const previousTrustedCandidate = trustedCandidates[1] || null;

  if (selectedCandidate && previousTrustedCandidate) {
    const currentCost = Number(selectedCandidate.normalizedCostPerUnit || 0);
    const previousCost = Number(previousTrustedCandidate.normalizedCostPerUnit || 0);
    if (currentCost > 0 && previousCost > 0) {
      const changePercent = ((currentCost - previousCost) / previousCost) * 100;
      return {
        state: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
        changePercent,
        referenceLabel: `${previousTrustedCandidate.supplierName} / ${previousTrustedCandidate.invoiceDate || 'previous invoice'}`,
        copy: `${formatCurrencyValue(currentCost)} vs ${formatCurrencyValue(previousCost)} per ${selectedCandidate.normalizedCostUnit || 'unit'}.`
      };
    }
  }

  if (pendingReviewCandidate && selectedCandidate) {
    const pendingCost = Number(pendingReviewCandidate.normalizedCostPerUnit || 0);
    const trustedCost = Number(selectedCandidate.normalizedCostPerUnit || 0);
    if (pendingCost > 0 && trustedCost > 0) {
      const changePercent = ((pendingCost - trustedCost) / trustedCost) * 100;
      return {
        state: 'review',
        changePercent,
        referenceLabel: `${pendingReviewCandidate.supplierName} / ${pendingReviewCandidate.invoiceDate || 'newer invoice'}`,
        copy: `Newer review line suggests ${formatCurrencyValue(pendingCost)} per ${pendingReviewCandidate.normalizedCostUnit || 'unit'}, but trusted cost stays on ${formatCurrencyValue(trustedCost)} until review clears.`
      };
    }
  }

  return null;
};

const formatInvoiceLibraryDate = (value = '') => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Date pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date);
};

const buildInvoiceWeekLabel = (value = '') => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Week pending';
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `Week ${weekNo}`;
};

const summarizeRecipeInvoicePacket = ({ packet = {}, ingredientAliasSet = new Set(), recipeTitle = 'Selected recipe' } = {}) => {
  const lineItems = Array.isArray(packet?.lineItems) ? packet.lineItems : [];
  const matchedRecipeLines = lineItems.filter((lineItem) => (
    Array.isArray(lineItem?.aliases)
      ? lineItem.aliases.some((alias) => ingredientAliasSet.has(alias))
      : false
  ));
  const trustedCount = matchedRecipeLines.filter((lineItem) => lineItem.matchStatus === 'matched' && !lineItem.reviewRequired).length;
  const reviewCount = matchedRecipeLines.filter((lineItem) => lineItem.reviewRequired || lineItem.matchStatus === 'review').length;
  const latestDate = packet?.invoice?.invoiceDate || '';

  return {
    id: packet?.invoice?.invoiceId || packet?.invoice?.invoiceNumber || recipeTitle,
    recipeTitle,
    supplierName: packet?.supplier?.name || 'Unknown supplier',
    invoiceDate: latestDate,
    dayLabel: formatInvoiceLibraryDate(latestDate),
    weekLabel: buildInvoiceWeekLabel(latestDate),
    lineCount: matchedRecipeLines.length,
    trustedCount,
    reviewCount,
    badge: reviewCount > 0 ? `${reviewCount} review` : `${trustedCount} trusted`,
    tone: reviewCount > 0 ? 'warn' : trustedCount > 0 ? 'good' : '',
    meta: `${packet?.invoice?.invoiceNumber || 'Invoice'} / ${matchedRecipeLines.length} recipe lines`
  };
};

export const buildRecipeCostWorkspace = ({ recipe = {}, invoicePacket = null, invoicePackets = null, portionCount = 0, manualIncome = 0 } = {}) => {
  const normalizedPackets = normalizeInvoiceIngestPackets(invoicePackets || invoicePacket || INVOICE_INGEST_PREVIEW_HISTORY);
  const normalizedPacket = normalizedPackets[normalizedPackets.length - 1] || normalizeInvoiceIngestPacket(INVOICE_INGEST_PREVIEW_PACKET);
  const recipeIngredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const currency = normalizedPacket.invoice.currency || 'USD';
  const recipeTitle = recipe?.name || recipe?.title || 'Selected recipe';
  const ingredientAliasSet = new Set(
    recipeIngredients.flatMap((ingredient) => buildRecipeLookupAliases({
      name: ingredient?.name || ingredient?.ingredient_name || ingredient?.canonical_name || '',
      recipe_aliases: ingredient?.ingredient_aliases || ingredient?.aliases || []
    }))
      .map((alias) => normalizeRecipeLookupValue(alias))
      .filter(Boolean)
  );

  const costRows = recipeIngredients.map((ingredient, index) => {
    const matchState = selectLatestTrustedIngredientCost(ingredient, normalizedPackets);
    const lineItem = matchState.selectedCandidate;
    const reviewCandidate = matchState.pendingReviewCandidate;
    const usageQty = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
    const usageUnit = ingredient?.unit || '';
    const pricing = lineItem
      ? resolveIngredientUsageCost({
          usageQty,
          usageUnit,
          lineItem
        })
      : { totalCost: null, costLabel: 'No invoice cost', totalLabel: 'Pending', requiresReview: false };

    let matchLabel = 'Pending';
    let detail = 'No canonical invoice match yet.';
    let tone = '';

    if (lineItem) {
      matchLabel = reviewCandidate ? 'Matched + review' : 'Matched';
      tone = reviewCandidate ? 'warn' : 'good';
      detail = reviewCandidate
        ? `Using trusted ${lineItem.supplierName} cost from ${lineItem.invoiceDate || 'latest invoice'} while newer review lines stay blocked.`
        : `Canonical: ${lineItem.canonicalIngredientName || lineItem.sourceName} / ${clampPercent(lineItem.matchConfidence * 100)}% confidence`;
    } else if (reviewCandidate) {
      matchLabel = 'Review';
      tone = 'warn';
      detail = reviewCandidate.reviewReason || 'Check canonical ingredient, unit, or allergen details before trusting cost.';
    }

    return {
      id: ingredient?.id || ingredient?.sku || `${normalizeRecipeLookupValue(ingredient?.name || ingredient?.ingredient_name || `ingredient-${index + 1}`)}-${index + 1}`,
      ingredientName: ingredient?.name || ingredient?.ingredient_name || `Ingredient ${index + 1}`,
      quantityLabel: formatInvoiceUsageQuantity(usageQty, usageUnit),
      matchLabel,
      tone,
      detail,
      costLabel: pricing.costLabel,
      totalLabel: pricing.totalLabel,
      totalCost: pricing.totalCost,
      reviewRequired: lineItem ? Boolean(reviewCandidate || pricing.requiresReview) : Boolean(reviewCandidate),
      sourceLabel: lineItem ? `${lineItem.supplierName} / ${lineItem.invoiceDate || 'date pending'}` : (reviewCandidate ? `${reviewCandidate.supplierName} / ${reviewCandidate.invoiceDate || 'date pending'}` : ''),
      pendingReviewReason: reviewCandidate?.reviewReason || '',
      candidateCount: matchState.candidateCount,
      costDelta: buildCostDeltaSummary(matchState)
    };
  });

  const trustedRows = costRows.filter((row) => !row.reviewRequired && Number.isFinite(row.totalCost));
  const reviewRows = costRows.filter((row) => row.reviewRequired);
  const pendingRows = costRows.filter((row) => !row.reviewRequired && !Number.isFinite(row.totalCost));
  const recipeCost = trustedRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
  const reviewLockedCost = reviewRows.reduce((sum, row) => sum + (Number.isFinite(row.totalCost) ? Number(row.totalCost || 0) : 0), 0);
  const coveragePercent = costRows.length ? clampPercent((trustedRows.length / costRows.length) * 100) : 0;
  const costPerPortion = portionCount > 0 && recipeCost > 0 ? recipeCost / portionCount : null;
  const incomeValue = Number(manualIncome || 0) > 0 ? Number(manualIncome || 0) : null;
  const incomeProfit = incomeValue !== null ? incomeValue - recipeCost : null;
  const incomeFoodCostPercent = incomeValue && recipeCost > 0 ? clampPercent((recipeCost / incomeValue) * 100) : null;
  const supplierChangeCards = costRows
    .filter((row) => row.costDelta)
    .map((row) => ({
      title: row.ingredientName,
      badge: row.costDelta.state === 'review' ? 'Review change' : (row.costDelta.state === 'up' ? 'Price up' : row.costDelta.state === 'down' ? 'Price down' : 'Stable'),
      tone: row.costDelta.state === 'up' ? 'warn' : row.costDelta.state === 'review' ? 'warn' : 'good',
      copy: row.costDelta.copy,
      meta: row.costDelta.referenceLabel,
      changeLabel: `${row.costDelta.changePercent > 0 ? '+' : ''}${row.costDelta.changePercent.toFixed(1)}%`
    }));
  const cheaperSupplierCards = costRows
    .filter((row) => row.costDelta?.state === 'up')
    .map((row) => ({
      title: row.ingredientName,
      badge: 'Cheaper before',
      tone: 'warn',
      copy: `${row.costDelta.referenceLabel} was cheaper than the current trusted supplier line.`,
      meta: row.costDelta.copy
    }));
  const matchRiskCards = costRows
    .filter((row) => row.reviewRequired || row.matchLabel === 'Review')
    .map((row) => ({
      title: row.ingredientName,
      badge: row.pendingReviewReason ? 'Review line' : 'Pending match',
      tone: 'warn',
      copy: row.pendingReviewReason || row.detail,
      meta: row.sourceLabel || 'No safe supplier line yet'
    }));
  const marginPressureCard = {
    title: 'Recipe margin pressure',
    badge: incomeValue === null ? 'Optional' : (incomeProfit !== null && incomeProfit < 0 ? 'Loss risk' : incomeFoodCostPercent !== null && incomeFoodCostPercent > 35 ? 'Watch' : 'Healthy'),
    tone: incomeValue === null ? '' : (incomeProfit !== null && incomeProfit < 0 ? 'warn' : incomeFoodCostPercent !== null && incomeFoodCostPercent > 35 ? 'warn' : 'good'),
    copy: incomeValue === null
      ? 'Add sale income only when you want a margin check. Expense truth stays primary.'
      : incomeProfit !== null && incomeProfit < 0
        ? `Current manual income does not cover trusted ingredient expense for ${recipeTitle}.`
        : incomeFoodCostPercent !== null && incomeFoodCostPercent > 35
          ? `Food cost is running at ${incomeFoodCostPercent}% for this recipe.`
          : `Food cost is running at ${incomeFoodCostPercent}% and margin is still healthy.`,
    meta: incomeValue === null
      ? 'No sale income entered'
      : `Income ${formatCurrencyValue(incomeValue, currency)} / Profit ${formatCurrencyValue(incomeProfit, currency)}`
  };
  const intelligenceCards = [
    ...cheaperSupplierCards,
    ...matchRiskCards,
    marginPressureCard
  ].slice(0, 4);
  const invoiceLibraryEntries = normalizedPackets
    .map((packet) => summarizeRecipeInvoicePacket({ packet, ingredientAliasSet, recipeTitle }))
    .sort((left, right) => Date.parse(right.invoiceDate || '') - Date.parse(left.invoiceDate || ''));
  const invoiceLibrary = {
    byDish: [
      {
        key: normalizeRecipeLookupValue(recipeTitle) || 'selected-recipe',
        label: recipeTitle,
        entries: invoiceLibraryEntries
      }
    ],
    byDay: invoiceLibraryEntries.reduce((acc, entry) => {
      const existing = acc.find((group) => group.label === entry.dayLabel);
      if (existing) {
        existing.entries.push(entry);
        return acc;
      }
      acc.push({ key: entry.dayLabel, label: entry.dayLabel, entries: [entry] });
      return acc;
    }, []),
    byWeek: invoiceLibraryEntries.reduce((acc, entry) => {
      const existing = acc.find((group) => group.label === entry.weekLabel);
      if (existing) {
        existing.entries.push(entry);
        return acc;
      }
      acc.push({ key: entry.weekLabel, label: entry.weekLabel, entries: [entry] });
      return acc;
    }, [])
  };
  const expenseSummary = {
    headline: recipeCost > 0 ? formatCurrencyValue(recipeCost, currency) : 'Pending',
    copy: recipeCost > 0
      ? `Current trusted ingredient expense for this recipe is ${formatCurrencyValue(recipeCost, currency)}.`
      : 'Trusted invoice cost is still incomplete for this recipe.',
    trustedLabel: `${trustedRows.length} trusted`,
    reviewLabel: reviewRows.length > 0
      ? `${reviewRows.length} ingredient ${reviewRows.length === 1 ? 'needs' : 'need'} review`
      : 'No blocked review cost',
    pendingLabel: pendingRows.length > 0
      ? `${pendingRows.length} ingredient ${pendingRows.length === 1 ? 'still has' : 'still have'} no invoice cost`
      : 'No pending ingredient cost',
    lockedCostLabel: reviewLockedCost > 0 ? formatCurrencyValue(reviewLockedCost, currency) : 'None'
  };
  const incomeSummary = {
    value: incomeValue,
    incomeLabel: incomeValue !== null ? formatCurrencyValue(incomeValue, currency) : 'Optional',
    profitLabel: incomeProfit !== null ? formatCurrencyValue(incomeProfit, currency) : 'Pending',
    foodCostLabel: incomeFoodCostPercent !== null ? `${incomeFoodCostPercent}%` : 'Pending',
    copy: incomeValue !== null
      ? `With manual income added, estimated profit is ${formatCurrencyValue(incomeProfit, currency)} and food cost runs at ${incomeFoodCostPercent}%.`
      : 'Add sale income only when you want a simple profit view. Expense truth stays primary.',
    tone: incomeValue !== null && incomeProfit !== null && incomeProfit < 0 ? 'warn' : 'good'
  };

  const sourceCards = [
    {
      title: 'Invoice upload',
      badge: normalizedPackets.some((packet) => packet.packetMode === 'preview') ? 'Preview' : normalizedPacket.ingestStatus,
      tone: normalizedPackets.some((packet) => packet.packetMode === 'preview') ? '' : 'good',
      meta: `${normalizedPackets.length} invoice packets / ${normalizedPackets.reduce((sum, packet) => sum + Number(packet?.summary?.lineItemCount || 0), 0)} line items / latest ${normalizedPacket.invoice.invoiceDate || 'date pending'}`
    },
    {
      title: 'Ingredient matching',
      badge: `${coveragePercent}%`,
      tone: coveragePercent >= 80 ? 'good' : 'warn',
      meta: `${trustedRows.length} trusted / ${reviewRows.length} review / ${pendingRows.length} pending recipe ingredients`
    },
    {
      title: 'Needs human match',
      badge: `${reviewRows.length || normalizedPacket.summary.reviewCount}`,
      tone: (reviewRows.length || normalizedPacket.summary.reviewCount) > 0 ? 'warn' : 'good',
      meta: (reviewRows.length || normalizedPacket.summary.reviewCount) > 0
        ? 'Review uncertain ingredient lines before trusting recipe cost.'
        : 'No open review lines in the current packet.'
    },
    {
      title: 'POS integration',
      badge: 'Optional',
      tone: '',
      meta: 'Map recipe to menu item only after invoice cost is stable.'
    }
  ];

  const reviewDecisions = normalizedPackets
    .flatMap((packet) => packet.lineItems.map((lineItem) => ({ ...lineItem, packet })))
    .filter((lineItem) => lineItem.reviewRequired || lineItem.matchStatus === 'review')
    .map((lineItem) => ({
      title: `Confirm ${lineItem.canonicalIngredientName || lineItem.sourceName}`,
      badge: 'Review',
      tone: 'warn',
      copy: lineItem.reviewReason || `${lineItem.sourceName} needs human confirmation before it becomes trusted ingredient cost.`,
      checks: [
        `Invoice line: ${lineItem.sourceName}.`,
        `Confidence: ${clampPercent(lineItem.matchConfidence * 100)}%.`,
        `Supplier: ${lineItem.packet?.supplier?.name || 'Unknown supplier'} / ${lineItem.packet?.invoice?.invoiceDate || 'date pending'}.`
      ]
    }));

  const openDecisionCount = reviewDecisions.length;

  if (!reviewDecisions.length) {
    reviewDecisions.push({
      title: 'No open ingredient reviews',
      badge: 'Ready',
      tone: 'good',
      copy: 'All current invoice lines are matched or still waiting first upload.',
      checks: []
    });
  }

  reviewDecisions.push({
    title: 'POS menu map',
    badge: 'Optional',
    tone: 'good',
    copy: 'Connect menu performance only when invoice-driven cost truth is already trusted.',
    checks: [
      'Use POS later for theoretical margin and sales trend.',
      'Do not block first useful costing on POS setup.'
    ]
  });

  reviewDecisions.push({
    title: 'Public product rule',
    badge: 'Guard',
    tone: '',
    copy: 'Do not show actual-vs-theoretical cost until invoice, inventory, and POS flows are all validated.',
    checks: []
  });

  return {
    normalizedPacket,
    sourceCards,
    costRules: [
      {
        title: 'Recipe truth first',
        copy: 'Invoice price can update ingredient cost, but it never rewrites recipe method.',
        badge: 'Safe'
      },
      {
        title: 'Most recent supplier cost',
        copy: `Use ${normalizedPacket.precedence.strategy.replace(/_/g, ' ')} with ${normalizedPacket.precedence.tieBreaker.replace(/_/g, ' ')} when multiple trusted invoice lines exist.`,
        badge: 'Rule'
      }
    ],
    refreshMeta: normalizedPackets.some((packet) => packet.packetMode === 'preview')
      ? 'Preview history is active. Newer review lines stay visible, but trusted cost still falls back to the latest safe invoice.'
      : 'Auto-matched costs are reviewable before publish.',
    refreshBadge: normalizedPackets.some((packet) => packet.packetMode === 'preview') ? 'Preview' : 'Live',
    commandTitle: reviewRows.length > 0 || pendingRows.length > 0
      ? 'Recipe cost needs review'
      : 'Recipe cost is live',
    commandSub: normalizedPacket.packetMode === 'preview'
      ? 'This page is now driven by the n8n invoice packet contract. Replace the preview packet with a real upload next.'
      : 'Use invoice cost for ingredient truth, then map POS only when menu performance is needed.',
    metrics: {
      costPerPortionLabel: costPerPortion ? formatCurrencyValue(costPerPortion, currency) : 'Pending',
      costPerPortionSub: portionCount > 0 ? `${portionCount} portion scale` : 'Portion count pending',
      recipeCostLabel: recipeCost > 0 ? formatCurrencyValue(recipeCost, currency) : 'Pending',
      recipeCostSub: normalizedPacket.packetMode === 'preview' ? 'Preview packet cost' : 'Current trusted invoice price',
      confidenceLabel: `${coveragePercent}%`,
      confidenceSub: `${trustedRows.length}/${costRows.length || 0} ingredient costs trusted`
    },
    expenseSummary,
    incomeSummary,
    supplierChangeCards,
    intelligenceCards,
    invoiceLibrary,
    costRows,
    flowCards: [
      {
        title: '1. Upload',
        heading: normalizedPacket.packetMode === 'preview' ? 'Preview contract packet' : 'Invoice received',
        copy: 'Store original file and extracted line items.',
        tone: normalizedPacket.packetMode === 'preview' ? '' : 'good'
      },
      {
        title: '2. Match',
        heading: 'Canonical ingredient',
        copy: 'Never trust fuzzy match without review when confidence is low.',
        tone: normalizedPacket.summary.reviewCount > 0 ? 'warn' : 'good'
      },
      {
        title: '3. Cost recipe',
        heading: 'Usage cost by ingredient',
        copy: 'Recipe cost becomes trustworthy only when match coverage and unit conversion are visible.',
        tone: reviewRows.length > 0 || pendingRows.length > 0 ? 'warn' : 'good'
      },
      {
        title: '4. POS option',
        heading: 'Menu performance',
        copy: 'Map sold count only after invoice cost is stable.',
        tone: ''
      }
    ],
    openDecisionCount,
    decisionCards: reviewDecisions
  };
};

export const getMeasuredIngredientSummary = (recipe = {}) => {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  let measuredIngredientCount = 0;

  ingredients.forEach((ingredient) => {
    const quantity = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
    const ingredientUnitDomain = classifyKitchenUnit(ingredient?.unit || '');
    if (quantity > 0 && (ingredientUnitDomain === 'weight' || ingredientUnitDomain === 'volume')) {
      measuredIngredientCount += 1;
    }
  });

  return {
    measuredIngredientCount,
    hasMeasuredIngredients: measuredIngredientCount > 0
  };
};

const collectRecipeQuantityWarnings = (recipe = {}) => {
  const flags = [];
  const unitLabel = String(recipe?.unit || '').trim();
  const yieldUnitDomain = classifyKitchenUnit(unitLabel);
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const { measuredIngredientCount } = getMeasuredIngredientSummary(recipe);

  if (yieldUnitDomain === 'count' && measuredIngredientCount > 0) {
    flags.push('Portion-based yield needs conversion reference');
  }

  if (unitLabel && yieldUnitDomain === 'unknown') {
    flags.push(`Unsupported yield unit: ${unitLabel}`);
  }

  const missingIngredientUnitCount = ingredients.filter((ingredient) => {
    const quantity = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
    return quantity > 0 && !String(ingredient?.unit || '').trim();
  }).length;

  if (missingIngredientUnitCount > 0) {
    flags.push(
      `${missingIngredientUnitCount} ingredient ${missingIngredientUnitCount === 1 ? 'quantity is' : 'quantities are'} missing unit`
    );
  }

  const unrecognizedIngredientUnitCount = ingredients.filter((ingredient) => {
    const quantity = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
    const unit = String(ingredient?.unit || '').trim();
    return quantity > 0 && unit && classifyKitchenUnit(unit) === 'unknown';
  }).length;

  if (unrecognizedIngredientUnitCount > 0) {
    flags.push(
      `${unrecognizedIngredientUnitCount} ingredient ${unrecognizedIngredientUnitCount === 1 ? 'unit is' : 'units are'} unrecognized`
    );
  }

  return flags;
};

export const buildRecipeAliases = (recipe = {}, row = {}) => {
  const aliasCandidates = [
    recipe?.id,
    recipe?.sku,
    recipe?.code,
    recipe?.recipeCode,
    recipe?.recipe_code,
    recipe?.canonical_id,
    recipe?.recipe_ref_id,
    recipe?.clean_name,
    recipe?.canonical_name,
    recipe?.title,
    recipe?.name,
    ...(Array.isArray(recipe?.recipe_aliases) ? recipe.recipe_aliases : []),
    row?.id,
    row?.sku,
    row?.code,
    row?.recipe_code,
    row?.recipe_ref_id,
    row?.canonical_id,
    row?.clean_name,
    row?.canonical_name,
    row?.title,
    row?.name
  ];

  const seen = new Set();
  return aliasCandidates.filter((alias) => {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias || seen.has(normalizedAlias)) return false;
    seen.add(normalizedAlias);
    return true;
  });
};

const splitInstructionLine = (value = '') => {
  const normalized = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\s*[•●▪]\s*/g, '\n')
    .replace(/\s*;\s*/g, '\n')
    .replace(/(?:^|\s)(\d+[\.\)])\s+/g, '\n$1 ')
    .replace(/\s+(then|next|after that|once done|when ready)\s+/gi, '\n$1 ')
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = String(line || '').replace(/^\s*\d+[\.\)]\s*/, '').trim();
      if (!trimmed) return [];
      if (trimmed.length <= 110 && !/[.;,]\s+/.test(trimmed)) return [trimmed];
      return trimmed
        .split(/(?<=[.;!?])\s+(?=[A-Z0-9])|,\s+(?=(then|next|after|once|when)\b)/i)
        .map((segment) => String(segment || '').replace(/^\s*\d+[\.\)]\s*/, '').trim())
        .filter(Boolean);
    });
};

const normalizeInstructionCandidate = (candidate) => {
  const parsedCandidate = parseJsonValue(candidate);

  if (
    typeof candidate === 'string'
    && candidate.trim()
    && parsedCandidate !== null
    && parsedCandidate !== candidate
  ) {
    return normalizeInstructionCandidate(parsedCandidate);
  }

  if (Array.isArray(candidate)) {
    return candidate
      .flatMap((step) => {
        if (typeof step === 'string' || typeof step === 'number') return splitInstructionLine(step);
        if (step && typeof step === 'object') {
          return splitInstructionLine(
            step.text
            || step.instruction
            || step.title
            || step.step
            || step.label
            || step.value
            || ''
          );
        }
        return [];
      })
      .filter(Boolean);
  }

  if (typeof candidate === 'string' && candidate.trim()) {
    return splitInstructionLine(candidate).filter(Boolean);
  }

  return [];
};

export const normalizeRecipeInstructions = (recipe = {}) => {
  const workflow2UiOutput = (
    recipe?.workflow2PrepProfile?.uiOutput
    || recipe?.workflow2PrepProfile?.ui_output
    || recipe?.prepProfile?.uiOutput
    || recipe?.prepProfile?.ui_output
    || {}
  );

  const candidates = [
    workflow2UiOutput?.recipe_step_rows,
    workflow2UiOutput?.recipeStepRows,
    recipe?.instruction_rows,
    recipe?.instructionRows,
    recipe?.instructions_raw,
    recipe?.instructionsRaw,
    recipe?.instructions,
    recipe?.steps,
    recipe?.method,
    recipe?.directions
  ];

  for (const candidate of candidates) {
    const rows = normalizeInstructionCandidate(candidate);
    if (rows.length > 0) return rows;
  }

  return [];
};

const getWorkflow2UiOutput = (prepProfile = null) => (
  prepProfile?.uiOutput
  || prepProfile?.ui_output
  || {}
);

const getFirstWorkflow2ArrayCandidate = (...candidates) => (
  candidates.find((value) => Array.isArray(value) && value.length > 0) || []
);

const flattenWorkflow2PrepBoardRows = (prepBoardProfile = {}) => {
  const stationView = [
    ...(Array.isArray(prepBoardProfile?.station_view) ? prepBoardProfile.station_view : []),
    ...(Array.isArray(prepBoardProfile?.stationView) ? prepBoardProfile.stationView : [])
  ];
  const taskView = [
    ...(Array.isArray(prepBoardProfile?.task_view) ? prepBoardProfile.task_view : []),
    ...(Array.isArray(prepBoardProfile?.taskView) ? prepBoardProfile.taskView : [])
  ];
  const directRows = [
    ...(Array.isArray(prepBoardProfile?.tasks) ? [{ tasks: prepBoardProfile.tasks }] : []),
    ...(Array.isArray(prepBoardProfile?.execution_tasks) ? [{ tasks: prepBoardProfile.execution_tasks }] : []),
    ...(Array.isArray(prepBoardProfile?.executionTasks) ? [{ tasks: prepBoardProfile.executionTasks }] : [])
  ];
  const lanes = stationView.length > 0 ? stationView : (taskView.length > 0 ? taskView : directRows);

  return lanes.flatMap((lane = {}) => {
    const laneRows = [
      ...(Array.isArray(lane?.tasks) ? lane.tasks : []),
      ...(Array.isArray(lane?.rows) ? lane.rows : []),
      ...(Array.isArray(lane?.items) ? lane.items : [])
    ];

    return laneRows.map((row = {}) => ({
      ...row,
      day_part: row?.day_part ?? row?.dayPart ?? lane?.day_part ?? lane?.dayPart ?? lane?.prep_window ?? lane?.prepWindow,
      station: row?.station ?? row?.station_group ?? row?.stationGroup ?? lane?.station ?? lane?.station_group ?? lane?.stationGroup,
      station_group: row?.station_group ?? row?.stationGroup ?? lane?.station_group ?? lane?.stationGroup ?? lane?.station,
      task_category: row?.task_category ?? row?.taskCategory ?? row?.category ?? lane?.task_category ?? lane?.taskCategory ?? lane?.category
    }));
  });
};

const normalizeWorkflow2RowTextList = (value) => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeWorkflow2RowTextList(item))
      .filter(Boolean);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value || '').trim();
    return text ? [text] : [];
  }
  if (value && typeof value === 'object') {
    const text = String(value?.name || value?.label || value?.value || value?.id || '').trim();
    return text ? [text] : [];
  }
  return [];
};

const normalizeWorkflow2TaskRows = (rows = []) => (
  (Array.isArray(rows) ? rows : []).reduce((acc, row, index) => {
    if (!row) return acc;

    if (typeof row === 'string' || typeof row === 'number') {
      const taskName = String(row || '').trim();
      if (taskName) {
        acc.push({
          id: `wf2-task-${index}`,
          taskName,
          estimatedMinutes: null,
          category: '',
          skillLevel: '',
          actionType: '',
          station: ''
        });
      }
      return acc;
    }

    if (typeof row !== 'object') return acc;

    const taskName = String(
      row?.task_name
      || row?.taskName
      || row?.name
      || row?.title
      || row?.text
      || row?.instruction
      || row?.label
      || ''
    ).trim();
    if (!taskName) return acc;

    const estimatedMinutes = firstFiniteNumber(
      row?.estimated_minutes,
      row?.estimatedMinutes,
      row?.minutes
    );
    const sequence = firstFiniteNumber(
      row?.sequence,
      row?.order,
      row?.sort_order,
      row?.sortOrder,
      row?.position
    );
    const dayPartRaw = String(
      row?.day_part
      || row?.dayPart
      || row?.prep_window
      || row?.prepWindow
      || row?.service_window
      || row?.serviceWindow
      || row?.phase
      || row?.phase_key
      || row?.phaseKey
      || row?.time_slot
      || row?.timeSlot
      || ''
    ).trim();
    const normalizedDayPart = normalizeText(dayPartRaw);
    const dayPartKey = /morning/.test(normalizedDayPart)
      ? 'morning'
      : (/afternoon/.test(normalizedDayPart)
          ? 'afternoon'
          : ((/before[\s_-]*service|service|handoff|final/.test(normalizedDayPart)) ? 'before_service' : ''));

    acc.push({
      id: String(row?.id || `wf2-task-${index}`),
      taskName,
      estimatedMinutes,
      sequence: sequence === null ? index + 1 : sequence,
      dayPart: dayPartRaw,
      dayPartKey,
      category: String(row?.category || row?.task_category || row?.taskCategory || '').trim(),
      skillLevel: String(row?.skill_level || row?.skillLevel || '').trim(),
      actionType: String(row?.action_type || row?.actionType || row?.type || '').trim(),
      station: String(row?.station || row?.station_group || row?.stationGroup || row?.workstation || '').trim(),
      stationGroup: String(row?.station_group || row?.stationGroup || row?.station || row?.workstation || '').trim(),
      quantityText: String(row?.quantity_text || row?.quantityText || row?.display_quantity_text || row?.displayQuantityText || '').trim(),
      holdRule: String(row?.hold_rule || row?.holdRule || row?.holding_rule || row?.holdingRule || '').trim(),
      ingredientRefs: normalizeWorkflow2RowTextList(row?.ingredient_refs || row?.ingredientRefs),
      equipmentRequired: normalizeWorkflow2RowTextList(row?.equipment_required || row?.equipmentRequired || row?.equipment || row?.tools),
      ccpRefs: normalizeWorkflow2RowTextList(row?.ccp_refs || row?.ccpRefs),
      criticalCheckRefs: normalizeWorkflow2RowTextList(row?.critical_check_refs || row?.criticalCheckRefs),
      completionRequired: row?.completion_required ?? row?.completionRequired ?? true
    });
    return acc;
  }, [])
);

const normalizeWorkflow2TextList = (value, depth = 0) => {
  if (depth > 2 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeWorkflow2TextList(item, depth + 1));
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value || '').trim();
    return text ? [text] : [];
  }
  if (typeof value === 'object') {
    return Object.values(value).flatMap((item) => normalizeWorkflow2TextList(item, depth + 1));
  }
  return [];
};

export const resolveWorkflow2PrepDetailRows = ({
  prepProfile = null,
  methodProfile = null,
  fallbackProfile = null
} = {}) => {
  const uiOutput = getWorkflow2UiOutput(prepProfile);
  const strictExecutionRows = getFirstWorkflow2ArrayCandidate(
    methodProfile?.execution_tasks,
    methodProfile?.executionTasks,
    fallbackProfile?.execution_tasks,
    fallbackProfile?.executionTasks
  );
  if (strictExecutionRows.length > 0) return normalizeWorkflow2TaskRows(strictExecutionRows);

  const prepBoardProfile = prepProfile?.prep_board_profile
    || prepProfile?.prepBoardProfile
    || uiOutput?.prep_board_profile
    || uiOutput?.prepBoardProfile
    || null;
  const prepBoardRows = prepBoardProfile ? flattenWorkflow2PrepBoardRows(prepBoardProfile) : [];
  if (prepBoardRows.length > 0) return normalizeWorkflow2TaskRows(prepBoardRows);

  const detailRows = getFirstWorkflow2ArrayCandidate(
    uiOutput?.prep_detail_rows,
    uiOutput?.prepDetailRows
  );
  if (detailRows.length > 0) return normalizeWorkflow2TaskRows(detailRows);

  const legacyRows = getFirstWorkflow2ArrayCandidate(
    uiOutput?.execution_tasks,
    uiOutput?.executionTasks
  );
  return normalizeWorkflow2TaskRows(legacyRows);
};

export const resolveWorkflow2PrepCardRows = ({
  prepProfile = null,
  executionTaskRows = []
} = {}) => {
  const uiOutput = getWorkflow2UiOutput(prepProfile);
  const strictCardRows = normalizeWorkflow2TextList(
    uiOutput?.prep_card_rows ?? uiOutput?.prepCardRows
  ).filter(Boolean);
  if (strictCardRows.length > 0) return [...new Set(strictCardRows)];

  if (Array.isArray(executionTaskRows) && executionTaskRows.length > 0) {
    return executionTaskRows.map((row) => String(row?.taskName || '').trim()).filter(Boolean);
  }

  const legacyRows = normalizeWorkflow2TextList([
    uiOutput?.task_bullets,
    uiOutput?.taskBullets,
    uiOutput?.execution_steps,
    uiOutput?.executionSteps,
    uiOutput?.steps
  ]).filter(Boolean);
  return [...new Set(legacyRows)];
};

const normalizeRecipeAllergens = (recipe = {}) => {
  const candidate = Array.isArray(recipe?.allergens)
    ? recipe.allergens
    : parseTextList(recipe?.allergens, /[\n,|]+/);

  return (candidate || [])
    .map((entry) => {
      if (typeof entry === 'string') return titleCaseWords(entry);
      if (entry && typeof entry === 'object') {
        return titleCaseWords(entry.label || entry.name || entry.value || '');
      }
      return '';
    })
    .filter(Boolean);
};

const getTrainingBadgeTone = (status = '') => {
  const normalizedStatus = normalizeText(status);
  if (['blocked', 'conflict', 'failed'].includes(normalizedStatus)) return 'red';
  if (['review', 'warning', 'approval_required', 'pending'].includes(normalizedStatus)) return 'gold';
  if (['trusted', 'synced', 'approved'].includes(normalizedStatus)) return 'good';
  return '';
};

const formatTrainingStatusLabel = (status = '') => {
  const normalizedStatus = normalizeText(status);
  if (!normalizedStatus) return 'Linked';
  if (normalizedStatus === 'trusted') return 'Ready';
  if (normalizedStatus === 'warning') return 'Watch';
  if (normalizedStatus === 'review') return 'Review';
  if (normalizedStatus === 'blocked') return 'Blocked';
  return titleCaseWords(normalizedStatus);
};

const buildTrainingStepTitle = (step = '', index = 0) => {
  const normalizedStep = canonicalizeTokenSpacing(String(step || '').replace(/[.:;]+/g, ' ')).trim();
  if (!normalizedStep) return index === 0 ? 'Before you start' : `Step ${index + 1}`;

  const lowered = normalizedStep.toLowerCase();
  if (/\bconfirm\b/.test(lowered)) return 'Confirm setup';
  if (/\bchar\b/.test(lowered)) return 'Char with control';
  if (/\bplate\b|\bfinish\b|\bgarnish\b/.test(lowered)) return 'Plate and finish';
  if (/\blabel\b|\ballergen\b/.test(lowered)) return 'Label and call out';
  if (/\bhold\b|\bstore\b|\bchill\b/.test(lowered)) return 'Hold correctly';
  if (/\boverride\b|\badjust\b/.test(lowered)) return 'Chef override rule';

  const shortTitle = normalizedStep.split(' ').slice(0, 4).join(' ');
  return titleCaseWords(shortTitle);
};

const getRecipeWorkflow2TrainingProfile = (recipe = {}) => {
  if (recipe?.workflow2PrepProfile) return recipe.workflow2PrepProfile;
  if (recipe?.prepProfile) return recipe.prepProfile;
  return null;
};

const normalizeWorkflow2TrainingSectionList = (trainingOutline = {}) => {
  const rawSections = Array.isArray(trainingOutline?.sections) ? trainingOutline.sections : [];

  return rawSections
    .map((section) => {
      if (typeof section === 'string') {
        return {
          title: canonicalizeTokenSpacing(section).trim(),
          copy: ''
        };
      }

      if (section && typeof section === 'object') {
        return {
          title: firstPresentMeta(section?.title, section?.label, section?.heading, section?.name),
          copy: firstPresentMeta(section?.copy, section?.description, section?.detail, section?.summary)
        };
      }

      return null;
    })
    .filter((section) => Boolean(section?.title));
};

const buildWorkflow2TrainingStepCards = ({
  trainingSections = [],
  trainingKeyPoints = [],
  foodSafetyCcp = [],
  serviceFinish = [],
  fallbackInstructions = []
} = {}) => {
  if (trainingSections.length > 0) {
    return trainingSections.slice(0, 4).map((section, index) => {
      const fallbackCopy = firstPresentMeta(
        section?.copy,
        trainingKeyPoints[index],
        fallbackInstructions[index],
        foodSafetyCcp[index],
        index === trainingSections.length - 1 ? serviceFinish[0] : '',
        'Follow the approved kitchen method for this section.'
      );

      return {
        number: index + 1,
        title: titleCaseWords(section.title),
        copy: fallbackCopy
      };
    });
  }

  const instructionSteps = fallbackInstructions.length
    ? fallbackInstructions
    : ['Add Workflow 2 training outline or recipe instructions to activate this SOP lesson.'];

  return instructionSteps.slice(0, 4).map((step, index) => ({
    number: index + 1,
    title: instructionSteps.length === 1 && !fallbackInstructions.length
      ? 'Training outline missing'
      : buildTrainingStepTitle(step, index),
    copy: step
  }));
};

const GENERATED_PROFILE_FIELD_LABELS = {
  food_safety_ccp: 'Food safety CCP',
  critical_checks: 'Critical checks',
  storage: 'Storage',
  service_finish: 'Service finish',
  training_outline: 'Training outline',
  training_key_points: 'Training key points',
  regular_profile_execution_tasks: 'Regular prep task rows',
  large_profile_execution_tasks: 'Large prep task rows',
  regular_profile: 'Regular prep profile',
  large_profile: 'Large prep profile',
  operational_teaching: 'Operational teaching',
  prep_intelligence: 'Prep intelligence',
  scale_rule: 'Scale rule'
};

const GENERATED_PROFILE_CRITICAL_FIELD_LABELS = new Set([
  'Food safety CCP',
  'Critical checks',
  'Storage',
  'Service finish'
]);

const formatGeneratedProfileFieldLabel = (fieldPath = '', fallbackLabel = '') => {
  const fallback = canonicalizeTokenSpacing(String(fallbackLabel || '')).trim();
  if (fallback) return fallback;

  const normalizedPath = normalizeText(fieldPath);
  if (!normalizedPath) return 'Generated profile field';

  if (normalizedPath.includes('regular_profile_execution_tasks')) return GENERATED_PROFILE_FIELD_LABELS.regular_profile_execution_tasks;
  if (normalizedPath.includes('large_profile_execution_tasks')) return GENERATED_PROFILE_FIELD_LABELS.large_profile_execution_tasks;
  if (normalizedPath.includes('food_safety_ccp')) return GENERATED_PROFILE_FIELD_LABELS.food_safety_ccp;
  if (normalizedPath.includes('critical_checks')) return GENERATED_PROFILE_FIELD_LABELS.critical_checks;
  if (normalizedPath.includes('training_key_points')) return GENERATED_PROFILE_FIELD_LABELS.training_key_points;
  if (normalizedPath.includes('training_outline')) return GENERATED_PROFILE_FIELD_LABELS.training_outline;
  if (normalizedPath.includes('service_finish')) return GENERATED_PROFILE_FIELD_LABELS.service_finish;
  if (normalizedPath.includes('prep_intelligence')) return GENERATED_PROFILE_FIELD_LABELS.prep_intelligence;
  if (normalizedPath.includes('operational_teaching')) return GENERATED_PROFILE_FIELD_LABELS.operational_teaching;
  if (normalizedPath.includes('scale_rule')) return GENERATED_PROFILE_FIELD_LABELS.scale_rule;
  if (normalizedPath.includes('storage')) return GENERATED_PROFILE_FIELD_LABELS.storage;
  if (normalizedPath.includes('regular_profile')) return GENERATED_PROFILE_FIELD_LABELS.regular_profile;
  if (normalizedPath.includes('large_profile')) return GENERATED_PROFILE_FIELD_LABELS.large_profile;

  return titleCaseWords(
    String(fieldPath || '')
      .split('.')
      .filter(Boolean)
      .pop()
      ?.replace(/[_-]+/g, ' ') || 'Generated profile field'
  );
};

const normalizeGeneratedProfileFieldIssue = (entry = {}, { profileLabel = '' } = {}) => {
  if (!entry || typeof entry !== 'object') return null;

  const fieldPath = String(
    entry?.field_path
    || entry?.fieldPath
    || entry?.path
    || ''
  ).trim();
  const fieldLabel = formatGeneratedProfileFieldLabel(
    fieldPath,
    entry?.field_label || entry?.fieldLabel || ''
  );
  const score = firstFiniteNumber(
    entry?.score,
    entry?.confidence_score,
    entry?.confidenceScore
  );
  const reasonCode = String(entry?.reason_code || entry?.reasonCode || '').trim();
  const reasonText = String(
    entry?.reason_text
    || entry?.reasonText
    || entry?.note
    || entry?.summary
    || ''
  ).trim();

  if (!fieldPath && !fieldLabel && !reasonText) return null;

  return {
    fieldPath: fieldPath || normalizeText(fieldLabel || 'generated_profile_field'),
    fieldLabel: fieldLabel || 'Generated profile field',
    score,
    scoreLabel: score !== null ? `${Math.round(score * 100)}%` : '',
    reasonCode,
    reasonText,
    profileLabel: profileLabel || String(entry?.profile_type || entry?.profileType || '').trim() || 'Workflow profile',
    isCritical: GENERATED_PROFILE_CRITICAL_FIELD_LABELS.has(fieldLabel)
  };
};

const deriveGeneratedProfileFallbackIssues = (
  profile = {},
  {
    profileLabel = '',
    activePrepProfile = ''
  } = {}
) => {
  const confidence = profile?.confidenceScores || profile?.confidence_scores || {};
  const normalizedActiveProfile = normalizeText(
    activePrepProfile
    || profile?.scaleRule?.active_profile
    || profile?.scaleRule?.activeProfile
    || profile?.scale_rule?.active_profile
    || profile?.scale_rule?.activeProfile
    || profile?.scale_rule?.profile
    || profile?.scaleRule?.profile
  );
  const prepTaskFieldPath = normalizedActiveProfile === 'large'
    ? 'large_profile.execution_tasks'
    : 'regular_profile.execution_tasks';
  const prepTaskFieldLabel = normalizedActiveProfile === 'large'
    ? 'Large prep task rows'
    : 'Regular prep task rows';
  const fallbackCandidates = [
    {
      fieldPath: 'food_safety_ccp',
      fieldLabel: 'Food safety CCP',
      score: firstFiniteNumber(confidence?.ccp, confidence?.food_safety_ccp, confidence?.foodSafetyCcp),
      reasonText: 'Food safety guidance has weak confidence and should be reviewed before live use.'
    },
    {
      fieldPath: 'training_outline',
      fieldLabel: 'Training outline',
      score: firstFiniteNumber(confidence?.training_outline, confidence?.trainingOutline),
      reasonText: 'Training outline confidence is low and should be checked before staff use.'
    },
    {
      fieldPath: prepTaskFieldPath,
      fieldLabel: prepTaskFieldLabel,
      score: firstFiniteNumber(confidence?.prep_profile, confidence?.profile, confidence?.overall),
      reasonText: 'Prep task detail is low-confidence and should be reviewed before service.'
    }
  ];

  return fallbackCandidates
    .filter((entry) => entry.score !== null && entry.score < 0.75)
    .map((entry) => ({
      ...entry,
      scoreLabel: `${Math.round(entry.score * 100)}%`,
      reasonCode: 'low_confidence_fallback',
      profileLabel: profileLabel || 'Workflow profile',
      isCritical: GENERATED_PROFILE_CRITICAL_FIELD_LABELS.has(entry.fieldLabel)
    }));
};

const normalizeGeneratedProfileReviewQueueEntry = (entry = {}, { profileLabel = '' } = {}) => {
  if (!entry || typeof entry !== 'object') return null;

  const fieldPath = String(entry?.field_path || entry?.fieldPath || '').trim();
  const fieldLabel = formatGeneratedProfileFieldLabel(fieldPath, entry?.field_label || entry?.fieldLabel || '');
  const status = normalizeText(entry?.status || 'pending') || 'pending';
  const confidenceScore = firstFiniteNumber(entry?.confidence_score, entry?.confidenceScore, entry?.score);
  const reasonText = String(entry?.reason_text || entry?.reasonText || '').trim();

  if (!fieldPath && !fieldLabel && !reasonText) return null;

  return {
    id: String(entry?.id || `${profileLabel}-${fieldPath || fieldLabel}`),
    profileLabel: profileLabel || String(entry?.profile_type || entry?.profileType || '').trim() || 'Workflow profile',
    fieldPath: fieldPath || normalizeText(fieldLabel || 'generated_profile_field'),
    fieldLabel: fieldLabel || 'Generated profile field',
    status,
    statusLabel: titleCaseWords(status.replace(/_/g, ' ')),
    confidenceScore,
    confidenceLabel: confidenceScore !== null ? `${Math.round(confidenceScore * 100)}%` : '',
    reasonText,
    createdAt: firstPresentMeta(entry?.created_at, entry?.createdAt),
    reviewedAt: firstPresentMeta(entry?.reviewed_at, entry?.reviewedAt)
  };
};

const normalizeGeneratedProfileChangeLogEntry = (entry = {}, { profileLabel = '' } = {}) => {
  if (!entry || typeof entry !== 'object') return null;

  const fieldPath = String(entry?.field_path || entry?.fieldPath || '').trim();
  const fieldLabel = formatGeneratedProfileFieldLabel(fieldPath, entry?.field_label || entry?.fieldLabel || '');
  const changedBy = String(entry?.changed_by || entry?.changedBy || entry?.reviewed_by || entry?.reviewedBy || '').trim();
  const changeReason = String(entry?.change_reason || entry?.changeReason || '').trim();
  const eventType = String(entry?.event_type || entry?.eventType || '').trim();
  const retrainingFields = parseJsonArrayOrEmpty(entry?.retraining_fields || entry?.retrainingFields);
  const retrainingRequired = Boolean(entry?.retraining_required || entry?.retrainingRequired || retrainingFields.length > 0);
  const createdAt = firstPresentMeta(entry?.created_at, entry?.createdAt, entry?.updated_at, entry?.updatedAt);

  if (!fieldPath && !fieldLabel && !changedBy && !changeReason && !createdAt && !eventType) return null;

  return {
    id: String(entry?.id || `${profileLabel}-${fieldPath || fieldLabel}-${createdAt || 'change'}`),
    profileLabel: profileLabel || String(entry?.profile_type || entry?.profileType || '').trim() || 'Workflow profile',
    fieldPath: fieldPath || normalizeText(fieldLabel || 'generated_profile_field'),
    fieldLabel: fieldLabel || 'Generated profile field',
    changedBy,
    changeReason,
    eventType,
    retrainingFields,
    retrainingRequired,
    createdAt,
    oldValue: entry?.old_value ?? entry?.oldValue ?? null,
    newValue: entry?.new_value ?? entry?.newValue ?? null,
    approvedAt: firstPresentMeta(entry?.approved_at, entry?.approvedAt),
    approvedBy: firstPresentMeta(entry?.approved_by, entry?.approvedBy),
    syncedAt: firstPresentMeta(entry?.synced_at, entry?.syncedAt),
    syncedBy: firstPresentMeta(entry?.synced_by, entry?.syncedBy),
    queueEntryId: firstPresentMeta(entry?.queue_entry_id, entry?.queueEntryId),
    status: firstPresentMeta(entry?.status)
  };
};

const collectGeneratedProfileReviewArrays = (profile = {}, keys = []) => (
  keys.flatMap((key) => parseJsonArrayOrEmpty(profile?.[key]))
);

export const buildGeneratedProfileReviewState = (
  recipe = {},
  {
    activePrepProfile = ''
  } = {}
) => {
  const workflow2Profile = recipe?.workflow2PrepProfile || recipe?.prepProfile || null;
  const workflow3Profile = recipe?.workflow3ExtendedProfile || recipe?.extendedProfile || null;
  const reviewProfiles = [
    { label: 'WF2', profile: workflow2Profile },
    { label: 'WF3', profile: workflow3Profile }
  ].filter((entry) => entry.profile && typeof entry.profile === 'object');

  const rootQueueEntries = collectGeneratedProfileReviewArrays(recipe, [
    'recipe_profile_review_queue',
    'recipeProfileReviewQueue',
    'profile_review_queue',
    'profileReviewQueue'
  ]);
  const rootHistoryEntries = collectGeneratedProfileReviewArrays(recipe, [
    'recipe_profile_change_log',
    'recipeProfileChangeLog',
    'recipe_profile_audit_log',
    'recipeProfileAuditLog',
    'profile_change_log',
    'profileChangeLog',
    'profile_audit_log',
    'profileAuditLog'
  ]);

  const summaries = [];
  const profileLabels = [];
  const lowConfidenceFields = [];
  const queueItems = [];
  const historyItems = [];
  const knowledgeStates = [];
  const approvalLevels = [];
  const validationActors = [];
  let reviewRequired = false;
  let managerReviewRequired = false;

  reviewProfiles.forEach(({ label, profile }) => {
    profileLabels.push(label);
    if (profile?.reviewRequired || profile?.review_required) reviewRequired = true;
    if (profile?.managerReviewRequired || profile?.manager_review_required) managerReviewRequired = true;

    const summary = String(profile?.reviewSummary || profile?.review_summary || '').trim();
    if (summary) summaries.push(summary);

    const normalizedFieldIssues = collectGeneratedProfileReviewArrays(profile, [
      'low_confidence_fields',
      'lowConfidenceFields'
    ])
      .map((entry) => normalizeGeneratedProfileFieldIssue(entry, { profileLabel: label }))
      .filter(Boolean);

    const fallbackIssues = normalizedFieldIssues.length > 0
      ? []
      : deriveGeneratedProfileFallbackIssues(profile, {
        profileLabel: label,
        activePrepProfile
      });

    lowConfidenceFields.push(...normalizedFieldIssues, ...fallbackIssues);

    queueItems.push(
      ...collectGeneratedProfileReviewArrays(profile, [
        'review_queue',
        'reviewQueue',
        'recipe_profile_review_queue',
        'recipeProfileReviewQueue'
      ])
        .map((entry) => normalizeGeneratedProfileReviewQueueEntry(entry, { profileLabel: label }))
        .filter(Boolean)
    );

    historyItems.push(
      ...collectGeneratedProfileReviewArrays(profile, [
        'change_log',
        'changeLog',
        'audit_log',
        'auditLog',
        'recipe_profile_audit_log',
        'recipeProfileAuditLog',
        'profile_change_log',
        'profileChangeLog',
        'profile_audit_log',
        'profileAuditLog',
        'history'
      ])
        .map((entry) => normalizeGeneratedProfileChangeLogEntry(entry, { profileLabel: label }))
        .filter(Boolean)
    );

    const knowledgeStatus = String(profile?.knowledgeStatus || profile?.knowledge_status || '').trim();
    const approvalLevel = String(profile?.approvalLevel || profile?.approval_level || '').trim();
    const validatedBy = String(profile?.validatedBy || profile?.validated_by || '').trim();
    const validatedAt = firstPresentMeta(profile?.validatedAt, profile?.validated_at);

    if (knowledgeStatus) knowledgeStates.push(knowledgeStatus);
    if (approvalLevel) approvalLevels.push(approvalLevel);
    if (validatedBy || validatedAt) {
      validationActors.push(
        [validatedBy || 'Validated', validatedAt ? `on ${new Date(validatedAt).toLocaleDateString()}` : '']
          .filter(Boolean)
          .join(' ')
      );
    }
  });

  queueItems.push(
    ...rootQueueEntries
      .map((entry) => normalizeGeneratedProfileReviewQueueEntry(entry))
      .filter(Boolean)
  );
  historyItems.push(
    ...rootHistoryEntries
      .map((entry) => normalizeGeneratedProfileChangeLogEntry(entry))
      .filter(Boolean)
  );

  const uniqueFieldIssues = Array.from(
    new Map(
      lowConfidenceFields.map((entry) => [
        `${entry.profileLabel}:${entry.fieldPath}:${entry.reasonCode || entry.reasonText || ''}`,
        entry
      ])
    ).values()
  );
  const uniqueQueueItems = Array.from(new Map(queueItems.map((entry) => [entry.id, entry])).values());
  const uniqueHistoryItems = Array.from(new Map(historyItems.map((entry) => [entry.id, entry])).values())
    .sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime());
  const retrainingItems = uniqueHistoryItems.filter((entry) => Boolean(entry.retrainingRequired || (Array.isArray(entry.retrainingFields) && entry.retrainingFields.length > 0)));

  const pendingQueueCount = uniqueQueueItems.filter((entry) => ['pending', 'reviewing'].includes(entry.status)).length;
  const criticalIssueCount = uniqueFieldIssues.filter((entry) => entry.isCritical && (entry.score === null || entry.score < 0.8)).length;
  const hasSignals = reviewRequired
    || managerReviewRequired
    || uniqueFieldIssues.length > 0
    || uniqueQueueItems.length > 0
    || uniqueHistoryItems.length > 0;

  const tone = criticalIssueCount > 0
    ? 'danger'
    : (reviewRequired || managerReviewRequired || uniqueFieldIssues.length > 0 || pendingQueueCount > 0)
      ? 'warn'
      : 'good';
  const badge = criticalIssueCount > 0
    ? 'Review before use'
    : managerReviewRequired
      ? 'Manager review'
      : reviewRequired || uniqueFieldIssues.length > 0 || pendingQueueCount > 0
        ? 'Review required'
        : uniqueHistoryItems.length > 0
          ? 'Tracked'
          : 'Linked';

  const summary = summaries[0]
    || (criticalIssueCount > 0
      ? 'Critical generated profile fields need review before live kitchen use.'
      : pendingQueueCount > 0
        ? `${pendingQueueCount} generated profile item${pendingQueueCount === 1 ? '' : 's'} are waiting review.`
      : uniqueFieldIssues.length > 0
          ? 'Low-confidence generated profile fields should be reviewed before service.'
          : retrainingItems.length > 0
            ? 'Tracked changes include retraining impact for staff follow-up.'
          : uniqueHistoryItems.length > 0
            ? 'Chef corrections are being recorded on this linked profile.'
            : 'Generated profile review is not active.');

  return {
    hasSignals,
    reviewRequired,
    managerReviewRequired,
    tone,
    badge,
    summary,
    profileLabels,
    lowConfidenceFields: uniqueFieldIssues,
    queueItems: uniqueQueueItems,
    historyItems: uniqueHistoryItems,
    issueCount: uniqueFieldIssues.length,
    pendingQueueCount,
    historyCount: uniqueHistoryItems.length,
    retrainingCount: retrainingItems.length,
    knowledgeStates: Array.from(new Set(knowledgeStates)),
    approvalLevels: Array.from(new Set(approvalLevels)),
    validationActors: Array.from(new Set(validationActors)),
    queuePreview: uniqueQueueItems.slice(0, 2),
    historyPreview: uniqueHistoryItems.slice(0, 2),
    retrainingItems,
    retrainingPreview: retrainingItems.slice(0, 2),
    fieldPreview: uniqueFieldIssues.slice(0, 3)
  };
};

export const buildRecipeTrainingSupport = (recipe = {}, { currentYieldValue = 0 } = {}) => {
  const title = firstPresentMeta(recipe?.name, recipe?.title, recipe?.clean_name, recipe?.canonical_name, 'Selected Recipe');
  const recipeTruthStatus = String(recipe?.recipe_truth_status || '').trim() || 'candidate';
  const truthFlags = Array.isArray(recipe?.recipe_truth_flags) ? recipe.recipe_truth_flags.filter(Boolean) : [];
  const instructions = normalizeRecipeInstructions(recipe);
  const allergens = normalizeRecipeAllergens(recipe);
  const prepIntelligence = recipe?.scalingTips?.prepIntelligence || recipe?.prepIntelligence || {};
  const workflow2PrepProfile = getRecipeWorkflow2TrainingProfile(recipe);
  const trainingOutline = workflow2PrepProfile?.trainingOutline || workflow2PrepProfile?.training_outline || {};
  const trainingSections = normalizeWorkflow2TrainingSectionList(trainingOutline);
  const trainingKeyPoints = Array.isArray(workflow2PrepProfile?.trainingKeyPoints)
    ? workflow2PrepProfile.trainingKeyPoints.filter(Boolean)
    : Array.isArray(workflow2PrepProfile?.training_key_points)
      ? workflow2PrepProfile.training_key_points.filter(Boolean)
      : [];
  const foodSafetyCcp = Array.isArray(workflow2PrepProfile?.foodSafetyCcp)
    ? workflow2PrepProfile.foodSafetyCcp.filter(Boolean)
    : Array.isArray(workflow2PrepProfile?.food_safety_ccp)
      ? workflow2PrepProfile.food_safety_ccp.filter(Boolean)
      : [];
  const serviceFinish = Array.isArray(workflow2PrepProfile?.serviceFinish)
    ? workflow2PrepProfile.serviceFinish.filter(Boolean)
    : Array.isArray(workflow2PrepProfile?.service_finish)
      ? workflow2PrepProfile.service_finish.filter(Boolean)
      : [];
  const confidenceScores = workflow2PrepProfile?.confidenceScores || workflow2PrepProfile?.confidence_scores || {};
  const trainingConfidence = toFiniteNumber(
    firstPresentMeta(confidenceScores?.training_outline, confidenceScores?.trainingOutline)
  );
  const managerReviewRequired = Boolean(
    workflow2PrepProfile?.managerReviewRequired || workflow2PrepProfile?.manager_review_required
  );
  const managerNotes = Array.isArray(recipe?.scalingTips?.notes) ? recipe.scalingTips.notes.filter(Boolean) : [];
  const versionLabel = firstPresentMeta(
    recipe?.recipe_code,
    recipe?.recipeCode,
    recipe?.code,
    recipe?.sku,
    recipe?.recipe_ref_id,
    recipe?.canonical_id,
    'Unlinked'
  );
  const stationLabel = firstPresentMeta(
    recipe?.station,
    recipe?.dishCategory,
    recipe?.category,
    recipe?.dishStyle,
    recipe?.style,
    'General'
  );
  const yieldValue = Number(currentYieldValue || recipe?.baseYield || recipe?.base_yield || recipe?.yield || 0);
  const unitLabel = firstPresentMeta(recipe?.unit, 'units');
  const yieldLabel = yieldValue > 0 ? `${Math.round(yieldValue)} ${unitLabel}` : 'Yield not set';
  const prepTimeMinutes = Number(prepIntelligence?.prepTimeMinutes || 0);
  const leadTimeLabel = firstPresentMeta(prepIntelligence?.leadTime, 'Morning');
  const makeAheadLabel = firstPresentMeta(prepIntelligence?.makeAhead, 'Same day only');
  const storageWindowLabel = firstPresentMeta(prepIntelligence?.storageWindow, '24 hours');
  const handoffLabel = firstPresentMeta(prepIntelligence?.handoffNote, '');
  const truthTone = getTrainingBadgeTone(recipeTruthStatus);
  const truthLabel = formatTrainingStatusLabel(recipeTruthStatus);
  const reviewTone = prepTimeMinutes > 0 ? 'good' : (truthTone || 'gold');
  const reviewLabel = prepTimeMinutes > 0 ? `${prepTimeMinutes} min review` : 'Recipe truth review';
  const allergenLabel = allergens.length ? allergens.join(', ') : 'None listed';
  const leadTimeSummary = `${leadTimeLabel} prep`;
  const storageSummary = `${makeAheadLabel} / ${storageWindowLabel}`;
  const lessonTitle = firstPresentMeta(
    trainingOutline?.lesson_title,
    trainingOutline?.lessonTitle,
    title
  );
  const hasWorkflow2Training = trainingSections.length > 0 || trainingKeyPoints.length > 0 || foodSafetyCcp.length > 0;
  const stepCards = buildWorkflow2TrainingStepCards({
    trainingSections,
    trainingKeyPoints,
    foodSafetyCcp,
    serviceFinish,
    fallbackInstructions: instructions
  });
  const hasLiveSteps = stepCards.length > 0 && !(
    stepCards.length === 1 && stepCards[0].title === 'Training outline missing'
  );
  const prepWindowLabel = `${leadTimeLabel} / ${storageWindowLabel}`;
  const trainingSourceLabel = hasWorkflow2Training ? 'Workflow 2 linked' : 'Recipe fallback';
  const blockedOrReviewing = truthTone === 'red' || truthTone === 'gold';
  const readinessLabel = truthTone === 'red'
    ? 'Blocked'
    : (truthTone === 'gold' ? 'Review before rollout' : 'Ready for staff');
  const readinessCopy = truthTone === 'red'
    ? (truthFlags[0] || 'Recipe truth is blocked and training should not roll forward yet.')
    : (truthTone === 'gold'
      ? (truthFlags[0] || 'Review the linked recipe truth before staff rollout.')
      : hasWorkflow2Training
        ? `Train from ${lessonTitle} using Workflow 2 guidance linked to ${versionLabel}.`
        : `Train from version ${versionLabel} using ${yieldLabel} and the linked live recipe steps.`);
  const pendingCount = blockedOrReviewing ? 1 : 0;

  const focusCards = [
    {
      title: 'Before start',
      badge: readinessLabel,
      tone: truthTone || 'good',
      copy: readinessCopy
    },
    {
      title: 'Allergen callout',
      badge: allergens.length ? 'Must' : 'Check',
      tone: allergens.length ? 'red' : 'gold',
      copy: allergens.length
        ? `${allergens.join(', ')} must stay visible anywhere this recipe is trained or handed off.`
        : 'No allergens are listed yet. Confirm whether the live recipe truth needs an allergen note before staff rollout.'
    },
    {
      title: 'Recipe truth',
      badge: truthLabel,
      tone: truthTone || 'gold',
      copy: truthFlags[0] || 'Training stays tied to the same approved recipe truth used by prep and production.'
    },
    {
      title: 'Key teaching points',
      badge: trainingKeyPoints.length ? `${trainingKeyPoints.length} points` : 'Not listed',
      tone: trainingKeyPoints.length ? 'good' : 'gold',
      copy: trainingKeyPoints.length
        ? trainingKeyPoints.slice(0, 3).join(' / ')
        : 'Workflow 2 training key points are not listed yet.'
    },
    {
      title: 'Food safety CCP',
      badge: foodSafetyCcp.length ? `${foodSafetyCcp.length} CCP` : 'Not listed',
      tone: foodSafetyCcp.length ? 'red' : 'gold',
      copy: foodSafetyCcp.length
        ? foodSafetyCcp.slice(0, 2).join(' / ')
        : 'Critical food safety checkpoints are not listed yet.'
    },
    {
      title: 'Prep handoff',
      badge: leadTimeLabel,
      tone: '',
      copy: handoffLabel || `${makeAheadLabel}. Storage window: ${storageWindowLabel}.`
    },
    {
      title: 'Change control',
      badge: truthTone === 'red' ? 'Blocked' : 'Linked',
      tone: truthTone === 'red' ? 'red' : 'good',
      copy: 'If this recipe changes, the training lesson must refresh before the update moves downstream to staff execution.'
    }
  ];

  const proofCards = [
    {
      title: 'Recipe truth link',
      badge: truthLabel,
      tone: truthTone || 'gold',
      copy: `Version ${versionLabel} is the live source for this training card.`,
      checks: [
        hasWorkflow2Training
          ? `${stepCards.length} Workflow 2 section${stepCards.length === 1 ? '' : 's'} linked`
          : `${instructions.length || 0} recipe step${instructions.length === 1 ? '' : 's'} linked`,
        truthFlags[0] || 'No separate SOP document is acting as source truth'
      ]
    },
    {
      title: 'Training readiness',
      badge: hasLiveSteps && truthTone !== 'red' ? 'Ready' : 'Review',
      tone: hasLiveSteps && truthTone !== 'red' ? 'good' : 'gold',
      copy: hasLiveSteps
        ? hasWorkflow2Training
          ? `Staff can train from ${lessonTitle} using the current Workflow 2 lesson structure.`
          : `Staff can train from ${yieldLabel} using the current live recipe path.`
        : 'Add Workflow 2 training structure or live recipe steps before this lesson is ready for staff use.',
      checks: [
        allergens.length ? `Allergen callout: ${allergenLabel}` : 'Allergen callout still needs review',
        trainingKeyPoints.length > 0
          ? `${trainingKeyPoints.length} key teaching point${trainingKeyPoints.length === 1 ? '' : 's'} linked`
          : (prepTimeMinutes > 0 ? `Prep timing linked: ${prepTimeMinutes} min` : 'Prep timing not linked yet')
      ]
    },
    {
      title: 'Prep window',
      badge: leadTimeLabel,
      tone: reviewTone,
      copy: handoffLabel || `${leadTimeSummary}. ${storageSummary}.`,
      checks: [
        leadTimeSummary,
        storageSummary
      ]
    },
    {
      title: 'Quality confidence',
      badge: trainingConfidence !== null ? `${Math.round(trainingConfidence * 100)}%` : 'Not scored',
      tone: trainingConfidence !== null && trainingConfidence >= 0.8 ? 'good' : 'gold',
      copy: managerReviewRequired
        ? 'Workflow 2 marked this lesson for manager review before rollout.'
        : 'Manager approval remains the gate for recipe changes that would alter staff training or rollout.',
      checks: [
        managerReviewRequired ? 'Manager review required' : 'No extra manager review flag',
        foodSafetyCcp.length > 0 ? `${foodSafetyCcp.length} CCP linked` : 'No CCP linked yet'
      ]
    },
    {
      title: 'Manager rule',
      badge: 'Control',
      tone: '',
      copy: 'Manager approval remains the gate for recipe changes that would alter staff training or rollout.',
      checks: [
        'No stale PDF outside recipe truth',
        'Training refresh required when recipe truth changes'
      ]
    }
  ];

  const trainingSets = [
    {
      title,
      badge: truthLabel,
      tone: truthTone || 'gold',
      meta: `${stepCards.length} ${hasWorkflow2Training ? 'Workflow 2 training section' : 'live training step'}${stepCards.length === 1 ? '' : 's'} linked to ${yieldLabel}.`
    },
    {
      title: hasWorkflow2Training ? 'Training source' : 'Prep handoff',
      badge: hasWorkflow2Training ? trainingSourceLabel : reviewLabel,
      tone: hasWorkflow2Training ? (managerReviewRequired ? 'gold' : 'good') : reviewTone,
      meta: hasWorkflow2Training
        ? `${trainingKeyPoints.length || 0} key points. ${foodSafetyCcp.length || 0} CCP notes.`
        : (handoffLabel || `${leadTimeSummary} / ${storageSummary}.`)
    },
    {
      title: 'Change control',
      badge: truthTone === 'red' ? 'Blocked' : 'Linked',
      tone: truthTone === 'red' ? 'red' : 'good',
      meta: truthFlags[0] || 'Training updates when approved recipe truth changes.'
    }
  ];

  const roles = [
    {
      title: 'Prep Cook',
      meta: `Scale, label, and hand off ${yieldLabel} from the same live recipe truth used on the prep board.`
    },
    {
      title: 'Line Cook',
      meta: `Follow the same ${stepCards.length}-step ${hasWorkflow2Training ? 'Workflow 2 lesson' : 'recipe flow'}, allergen callouts, and finish cues during service.`
    },
    {
      title: 'Manager',
      meta: 'Approve recipe-truth changes before staff training refreshes downstream.'
    }
  ];

  return {
    title,
    versionLabel,
    stationLabel,
    truthLabel,
    truthTone,
    recipeTruthStatus,
    reviewLabel,
    reviewTone,
    allergenLabel,
    yieldLabel,
    readinessLabel,
    readinessCopy,
    pendingCount,
    hasLiveSteps,
    hasAllergenCallout: allergens.length > 0,
    leadTimeLabel,
    prepWindowLabel,
    storageSummary,
    handoffLabel,
    trainingSourceLabel,
    lessonTitle,
    trainingKeyPoints,
    foodSafetyCcp,
    managerReviewRequired,
    trainingConfidence,
    subtitle: `${titleCaseWords(stationLabel)} / ${titleCaseWords(firstPresentMeta(recipe?.dishStyle, recipe?.style, 'Kitchen Standard'))}`,
    heroCopy: hasWorkflow2Training
      ? `Train the team from Workflow 2 lesson structure linked to the same live recipe truth used by prep, production, and approval flow. ${yieldLabel !== 'Yield not set' ? `${yieldLabel} is the current teaching scale.` : ''}`.trim()
      : `Train the team from the same live recipe truth used by prep, production, and approval flow. ${yieldLabel !== 'Yield not set' ? `${yieldLabel} is the current teaching scale.` : ''}`.trim(),
    stepCards,
    focusCards,
    proofCards,
    trainingSets,
    roles
  };
};

export const buildRecipeTrainingExecutionSupport = (
  recipe = {},
  {
    currentYieldValue = 0,
    session = {}
  } = {}
) => {
  const trainingSupport = buildRecipeTrainingSupport(recipe, { currentYieldValue });
  const completedSteps = new Set(
    (Array.isArray(session?.completedSteps) ? session.completedSteps : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  const acknowledgements = {
    allergen: Boolean(session?.acknowledgements?.allergen),
    truth: Boolean(session?.acknowledgements?.truth),
    handoff: Boolean(session?.acknowledgements?.handoff)
  };
  const stepRows = trainingSupport.stepCards.map((step) => ({
    ...step,
    completed: completedSteps.has(step.number)
  }));
  const completedStepCount = stepRows.filter((step) => step.completed).length;
  const readinessState = trainingSupport.truthTone === 'red'
    ? 'blocked'
    : trainingSupport.truthTone === 'gold'
      ? 'review'
      : 'ready';
  const checkRows = [
    {
      id: 'truth',
      title: 'Recipe truth acknowledged',
      copy: trainingSupport.readinessCopy,
      completed: acknowledgements.truth
    },
    {
      id: 'allergen',
      title: 'Allergen callout acknowledged',
      copy: trainingSupport.hasAllergenCallout
        ? `${trainingSupport.allergenLabel} stays visible during prep and service.`
        : 'No allergen note is listed yet, so a manager should confirm this before rollout.',
      completed: acknowledgements.allergen
    },
    {
      id: 'handoff',
      title: 'Prep handoff acknowledged',
      copy: trainingSupport.handoffLabel || `${trainingSupport.leadTimeLabel} / ${trainingSupport.storageSummary}`,
      completed: acknowledgements.handoff
    }
  ];
  const completedCheckCount = checkRows.filter((check) => check.completed).length;
  const totalCheckCount = checkRows.length;
  const totalProgressItems = stepRows.length + totalCheckCount;
  const completedProgressItems = completedStepCount + completedCheckCount;
  const completionPercent = totalProgressItems > 0
    ? clampPercent((completedProgressItems / totalProgressItems) * 100)
    : 0;
  const canComplete = readinessState === 'ready'
    && trainingSupport.hasLiveSteps
    && completedStepCount === stepRows.length
    && completedCheckCount === totalCheckCount;
  const completionState = session?.completedAt
    ? 'completed'
    : canComplete
      ? 'ready_to_complete'
      : readinessState === 'blocked'
        ? 'blocked'
        : 'in_progress';

  return {
    trainingSupport,
    traineeLabel: String(session?.traineeLabel || '').trim() || 'Unassigned staff',
    startedAt: session?.startedAt || '',
    completedAt: session?.completedAt || '',
    completedBy: session?.completedBy || '',
    readinessState,
    readinessBadge: completionState === 'completed'
      ? 'Completed'
      : readinessState === 'blocked'
        ? 'Blocked'
        : readinessState === 'review'
          ? 'Review first'
          : 'Ready',
    readinessCopy: completionState === 'completed'
      ? `Lesson completed by ${String(session?.completedBy || session?.traineeLabel || 'staff').trim() || 'staff'}.`
      : readinessState === 'blocked'
        ? trainingSupport.readinessCopy
        : readinessState === 'review'
          ? 'Lesson can be read, but manager review should clear recipe truth before rollout.'
          : 'Staff can follow this lesson now and mark each step as completed.',
    stepRows,
    checkRows,
    completedStepCount,
    totalStepCount: stepRows.length,
    completionPercent,
    canComplete,
    completionState
  };
};

const normalizeTrainingAssignmentList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalizeTokenSpacing(String(item || '')).trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,;/]+/g)
    .map((item) => canonicalizeTokenSpacing(item).trim())
    .filter(Boolean);
};

const buildTrainingRevisionLabel = (token = '', fallback = '') => {
  const normalized = String(token || '').trim();
  if (!normalized) return String(fallback || '').trim() || 'Current revision';
  if (/^\d{4}-\d{2}-\d{2}t/i.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }
  return normalized;
};

export const buildRecipeTrainingManagerSupport = (
  recipe = {},
  {
    currentYieldValue = 0,
    session = {}
  } = {}
) => {
  const trainingSupport = buildRecipeTrainingSupport(recipe, { currentYieldValue });
  const executionSupport = buildRecipeTrainingExecutionSupport(recipe, { currentYieldValue, session });
  const assignedStaff = normalizeTrainingAssignmentList(session?.assignedStaff);
  const suggestedStaffLabel = canonicalizeTokenSpacing(String(session?.traineeLabel || session?.completedBy || '')).trim();
  const currentRevisionToken = firstPresentMeta(
    recipe?.recipe_truth_revision,
    recipe?.recipe_truth_updated_at,
    recipe?.updated_at,
    recipe?.updatedAt,
    trainingSupport.versionLabel
  );
  const currentRevisionLabel = buildTrainingRevisionLabel(currentRevisionToken, trainingSupport.versionLabel);
  const completedRevisionToken = firstPresentMeta(session?.completedRevisionToken, session?.completedVersionLabel, '');
  const reviewedRevisionToken = firstPresentMeta(session?.reviewedRevisionToken, session?.reviewedVersionLabel, '');
  const completionRevisionChanged = Boolean(executionSupport.completedAt)
    && Boolean(completedRevisionToken)
    && completedRevisionToken !== currentRevisionToken;
  const reviewRevisionChanged = Boolean(session?.reviewedAt)
    && Boolean(reviewedRevisionToken)
    && reviewedRevisionToken !== currentRevisionToken;
  const retrainingRequired = Boolean(session?.forceRetraining) || completionRevisionChanged || reviewRevisionChanged;
  const recipeTruthBlocked = trainingSupport.truthTone === 'red';
  const recipeTruthNeedsReview = trainingSupport.truthTone === 'gold';
  const hasAssignment = assignedStaff.length > 0;
  const lessonCompleted = executionSupport.completionState === 'completed';
  const signedOffCurrentRevision = Boolean(session?.reviewedAt) && !retrainingRequired;

  let reviewState = 'assignment_required';
  if (recipeTruthBlocked) {
    reviewState = 'blocked';
  } else if (recipeTruthNeedsReview) {
    reviewState = 'recipe_review_required';
  } else if (retrainingRequired) {
    reviewState = 'retraining_required';
  } else if (!hasAssignment) {
    reviewState = 'assignment_required';
  } else if (!lessonCompleted) {
    reviewState = 'lesson_pending';
  } else if (signedOffCurrentRevision) {
    reviewState = 'signed_off';
  } else {
    reviewState = 'ready_for_review';
  }

  const reviewTone = reviewState === 'signed_off'
    ? 'good'
    : reviewState === 'ready_for_review'
      ? 'gold'
      : reviewState === 'blocked' || reviewState === 'retraining_required'
        ? 'red'
        : 'gold';
  const reviewBadge = reviewState === 'signed_off'
    ? 'Signed off'
    : reviewState === 'ready_for_review'
      ? 'Ready to sign off'
      : reviewState === 'retraining_required'
        ? 'Retraining required'
        : reviewState === 'blocked'
          ? 'Blocked'
          : reviewState === 'recipe_review_required'
            ? 'Recipe review first'
            : reviewState === 'lesson_pending'
              ? 'Lesson pending'
              : 'Assign staff';
  const reviewCopy = reviewState === 'signed_off'
    ? `Manager sign-off is current for ${trainingSupport.versionLabel}.`
    : reviewState === 'ready_for_review'
      ? 'Staff completed the lesson on the current recipe revision. Manager can sign off now.'
      : reviewState === 'retraining_required'
        ? `This lesson was completed on an older revision. Retrain staff on ${currentRevisionLabel} before sign-off returns.`
        : reviewState === 'blocked'
          ? trainingSupport.readinessCopy
          : reviewState === 'recipe_review_required'
            ? 'Recipe truth still needs manager review before this lesson should be signed off for staff use.'
            : reviewState === 'lesson_pending'
              ? 'Assigned staff still need to finish the lesson steps and checks before manager sign-off.'
              : 'Assign at least one staff member before this lesson can move into sign-off tracking.';

  const assignmentLabel = hasAssignment
    ? assignedStaff.join(', ')
    : (suggestedStaffLabel || 'No staff assigned');
  const assignmentCopy = hasAssignment
    ? `${assignedStaff.length} staff assignment${assignedStaff.length === 1 ? '' : 's'} linked to this lesson.`
    : (suggestedStaffLabel
      ? `${suggestedStaffLabel} has started the lesson but has not been assigned by a manager yet.`
      : 'No manager assignment is recorded yet.');
  const retrainingCopy = retrainingRequired
    ? `Current revision: ${currentRevisionLabel}. Clear the old completion and run the lesson again before sign-off.`
    : `Current revision: ${currentRevisionLabel}. No retraining trigger is active.`;

  return {
    trainingSupport,
    executionSupport,
    assignedStaff,
    hasAssignment,
    assignmentLabel,
    assignmentCopy,
    assignedAt: session?.assignedAt || '',
    assignedBy: session?.assignedBy || '',
    suggestedStaffLabel,
    canAssignSuggestedStaff: Boolean(suggestedStaffLabel) && !assignedStaff.includes(suggestedStaffLabel),
    currentRevisionToken,
    currentRevisionLabel,
    completedRevisionLabel: buildTrainingRevisionLabel(completedRevisionToken, trainingSupport.versionLabel),
    reviewedRevisionLabel: buildTrainingRevisionLabel(reviewedRevisionToken, trainingSupport.versionLabel),
    reviewedAt: session?.reviewedAt || '',
    reviewedBy: session?.reviewedBy || '',
    retrainingRequired,
    retrainingCopy,
    reviewState,
    reviewTone,
    reviewBadge,
    reviewCopy,
    canReview: reviewState === 'ready_for_review',
    proofCards: [
      {
        title: 'Assignment control',
        badge: hasAssignment ? `${assignedStaff.length} assigned` : 'Unassigned',
        tone: hasAssignment ? 'good' : 'gold',
        copy: assignmentCopy,
        checks: [
          hasAssignment ? assignmentLabel : 'Add one or more staff names to start tracked training ownership.',
          session?.assignedAt ? `Assigned ${new Date(session.assignedAt).toLocaleString()}` : 'No assignment timestamp yet',
          session?.assignedBy ? `Assigned by ${session.assignedBy}` : 'Manager assignment actor not recorded yet'
        ]
      },
      {
        title: 'Manager sign-off',
        badge: reviewBadge,
        tone: reviewTone,
        copy: reviewCopy,
        checks: [
          lessonCompleted ? `Lesson completed ${executionSupport.completedAt ? `on ${new Date(executionSupport.completedAt).toLocaleString()}` : 'for this trainee'}` : 'Staff lesson completion is still pending',
          session?.reviewedAt ? `Reviewed ${new Date(session.reviewedAt).toLocaleString()}` : 'No manager review recorded yet',
          session?.reviewedBy ? `Reviewed by ${session.reviewedBy}` : 'Manager reviewer not recorded yet'
        ]
      },
      {
        title: 'Revision watch',
        badge: retrainingRequired ? 'Retrain' : 'Current',
        tone: retrainingRequired ? 'red' : 'good',
        copy: retrainingCopy,
        checks: [
          `Current revision ${currentRevisionLabel}`,
          completedRevisionToken ? `Lesson completed on ${buildTrainingRevisionLabel(completedRevisionToken, trainingSupport.versionLabel)}` : 'Lesson has not been completed on any revision yet',
          reviewedRevisionToken ? `Manager sign-off revision ${buildTrainingRevisionLabel(reviewedRevisionToken, trainingSupport.versionLabel)}` : 'Manager sign-off revision not recorded yet'
        ]
      }
    ]
  };
};

const TRAINING_READINESS_EXPIRY_DAYS = 14;

const buildTrainingReadinessAgeLabel = (daysSinceReview = 0) => {
  if (!Number.isFinite(daysSinceReview) || daysSinceReview <= 0) return 'Reviewed today';
  if (daysSinceReview === 1) return 'Reviewed 1 day ago';
  return `Reviewed ${daysSinceReview} days ago`;
};

export const buildTrainingReadinessWorkspace = (
  recipes = [],
  trainingProgressMap = {},
  {
    getRecipeKey = (recipe, index) => getRecipeLookupKey(recipe, `training-${index}`),
    now = new Date()
  } = {}
) => {
  const requestedNowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const nowMs = Number.isFinite(requestedNowMs) ? requestedNowMs : Date.now();
  const recipeRows = (Array.isArray(recipes) ? recipes : []).map((recipe, index) => {
    const recipeKey = getRecipeKey(recipe, index);
    const session = recipeKey ? (trainingProgressMap?.[recipeKey] || {}) : {};
    const managerSupport = buildRecipeTrainingManagerSupport(recipe, {
      currentYieldValue: Number(recipe?.baseYield || recipe?.base_yield || recipe?.batchYield || recipe?.batch_yield || 0),
      session
    });
    const reviewedMs = managerSupport.reviewedAt ? new Date(managerSupport.reviewedAt).getTime() : 0;
    const daysSinceReview = reviewedMs > 0
      ? Math.floor((nowMs - reviewedMs) / (1000 * 60 * 60 * 24))
      : 0;
    const isExpiring = managerSupport.reviewState === 'signed_off'
      && reviewedMs > 0
      && daysSinceReview >= TRAINING_READINESS_EXPIRY_DAYS;

    let readinessState = 'not_ready';
    let readinessBadge = 'Not ready';
    let readinessTone = 'gold';
    let readinessCopy = managerSupport.reviewCopy;

    if (managerSupport.reviewState === 'signed_off') {
      readinessState = isExpiring ? 'expiring' : 'trained';
      readinessBadge = isExpiring ? 'Expiring' : 'Trained';
      readinessTone = isExpiring ? 'gold' : 'good';
      readinessCopy = isExpiring
        ? `${buildTrainingReadinessAgeLabel(daysSinceReview)}. Refresh sign-off soon even though the current revision still matches.`
        : `Signed off for ${managerSupport.trainingSupport.versionLabel} and ready for service training.`;
    } else if (
      managerSupport.reviewState === 'blocked'
      || managerSupport.reviewState === 'retraining_required'
      || managerSupport.reviewState === 'recipe_review_required'
    ) {
      readinessState = 'blocked';
      readinessBadge = managerSupport.reviewState === 'retraining_required' ? 'Retraining' : 'Blocked';
      readinessTone = 'red';
      readinessCopy = managerSupport.reviewCopy;
    }

    return {
      recipeKey,
      title: managerSupport.trainingSupport.title,
      versionLabel: managerSupport.trainingSupport.versionLabel,
      stationLabel: managerSupport.trainingSupport.stationLabel,
      assignedStaffLabel: managerSupport.assignmentLabel,
      assignedStaffCount: managerSupport.assignedStaff.length,
      reviewState: managerSupport.reviewState,
      readinessState,
      readinessBadge,
      readinessTone,
      readinessCopy,
      isExpiring,
      daysSinceReview,
      traineeLabel: managerSupport.executionSupport.traineeLabel,
      stepProgressLabel: `${managerSupport.executionSupport.completedStepCount}/${managerSupport.executionSupport.totalStepCount} steps`,
      managerSupport
    };
  }).sort((left, right) => {
    const toneRank = { red: 0, gold: 1, good: 2 };
    const leftRank = toneRank[left.readinessTone] ?? 3;
    const rightRank = toneRank[right.readinessTone] ?? 3;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.title).localeCompare(String(right.title));
  });

  const counts = recipeRows.reduce((acc, row) => {
    if (row.readinessState === 'trained') acc.trained += 1;
    else if (row.readinessState === 'expiring') acc.expiring += 1;
    else if (row.readinessState === 'blocked') acc.blocked += 1;
    else acc.notReady += 1;
    return acc;
  }, {
    total: recipeRows.length,
    trained: 0,
    blocked: 0,
    expiring: 0,
    notReady: 0
  });

  const stationMap = recipeRows.reduce((acc, row) => {
    const key = normalizeText(row.stationLabel) || 'general';
    if (!acc[key]) {
      acc[key] = {
        key,
        label: row.stationLabel,
        total: 0,
        trained: 0,
        blocked: 0,
        expiring: 0,
        notReady: 0
      };
    }
    acc[key].total += 1;
    if (row.readinessState === 'trained') acc[key].trained += 1;
    else if (row.readinessState === 'expiring') acc[key].expiring += 1;
    else if (row.readinessState === 'blocked') acc[key].blocked += 1;
    else acc[key].notReady += 1;
    return acc;
  }, {});

  const stationGroups = Object.values(stationMap).sort((left, right) => {
    const leftPressure = (left.blocked * 3) + (left.notReady * 2) + left.expiring;
    const rightPressure = (right.blocked * 3) + (right.notReady * 2) + right.expiring;
    if (leftPressure !== rightPressure) return rightPressure - leftPressure;
    return String(left.label).localeCompare(String(right.label));
  }).map((group) => ({
    ...group,
    badge: group.blocked > 0
      ? `${group.blocked} blocked`
      : group.notReady > 0
        ? `${group.notReady} not ready`
        : group.expiring > 0
          ? `${group.expiring} expiring`
          : `${group.trained} trained`,
    tone: group.blocked > 0 ? 'red' : group.notReady > 0 || group.expiring > 0 ? 'gold' : 'good',
    meta: `${group.total} recipe${group.total === 1 ? '' : 's'} / ${group.trained} trained / ${group.notReady} not ready / ${group.expiring} expiring`
  }));

  const summaryCards = [
    {
      title: 'Trained',
      count: String(counts.trained),
      badge: counts.total > 0 ? `${Math.round((counts.trained / counts.total) * 100)}%` : '0%',
      tone: 'good',
      copy: counts.trained > 0
        ? `${counts.trained} recipe${counts.trained === 1 ? '' : 's'} are currently signed off.`
        : 'No recipes are fully signed off yet.'
    },
    {
      title: 'Blocked',
      count: String(counts.blocked),
      badge: counts.blocked > 0 ? 'Needs action' : 'Clear',
      tone: counts.blocked > 0 ? 'red' : 'good',
      copy: counts.blocked > 0
        ? `${counts.blocked} recipe${counts.blocked === 1 ? '' : 's'} are blocked by truth or retraining issues.`
        : 'No blocked training lanes are visible.'
    },
    {
      title: 'Not Ready',
      count: String(counts.notReady),
      badge: counts.notReady > 0 ? 'Pending' : 'Clear',
      tone: counts.notReady > 0 ? 'gold' : 'good',
      copy: counts.notReady > 0
        ? `${counts.notReady} recipe${counts.notReady === 1 ? '' : 's'} still need assignment, lesson completion, or manager review.`
        : 'No pending lesson lanes are visible.'
    },
    {
      title: 'Expiring',
      count: String(counts.expiring),
      badge: `${TRAINING_READINESS_EXPIRY_DAYS}d`,
      tone: counts.expiring > 0 ? 'gold' : 'good',
      copy: counts.expiring > 0
        ? `${counts.expiring} recipe${counts.expiring === 1 ? '' : 's'} have old sign-off that should be refreshed soon.`
        : 'No aging sign-off is currently at the refresh threshold.'
    }
  ];

  return {
    counts,
    summaryCards,
    stationGroups,
    recipeRows,
    attentionRows: recipeRows.filter((row) => row.readinessState !== 'trained').slice(0, 8)
  };
};

export const buildRecipeOperationalIndex = (recipes = [], {
  getRecipeKey = (recipe, index) => getRecipeLookupKey(recipe, `idx-${index}`),
  getPlanningDefaults = () => ({}),
  getRecipeTitle = (recipe) => String(recipe?.name || recipe?.title || 'Unnamed'),
  getRecipeStyle = (recipe) => String(recipe?.dishStyle || recipe?.style || 'Kitchen Standard'),
  getRecipeCuisine = (recipe) => String(recipe?.cuisine || recipe?.cuisineType || recipe?.dishCuisine || recipe?.dishCategory || recipe?.category || 'General'),
  getRecipeCode = (recipe) => String(recipe?.code || recipe?.recipeCode || recipe?.recipe_code || recipe?.sku || recipe?.recipe_ref_id || recipe?.canonical_id || '')
} = {}) => {
  const byKey = {};
  const orderedKeys = [];

  (Array.isArray(recipes) ? recipes : []).forEach((recipe, index) => {
    if (!recipe) return;
    const recipeKey = getRecipeKey(recipe, index);
    if (!recipeKey) return;

    const planningDefaults = getPlanningDefaults(recipe, index) || {};
    byKey[recipeKey] = {
      recipe,
      recipeKey,
      index,
      title: getRecipeTitle(recipe),
      style: getRecipeStyle(recipe),
      cuisine: getRecipeCuisine(recipe),
      code: getRecipeCode(recipe),
      standardBatchYield: Number(planningDefaults?.standardBatchYield || 0),
      defaultTargetYield: Number(planningDefaults?.defaultTargetYield || 0)
    };
    orderedKeys.push(recipeKey);
  });

  return {
    byKey,
    orderedKeys
  };
};

export const buildAuthScopeState = ({
  userProfile = null,
  clientId = null,
  connectionState = OFFLINE_STATE.ONLINE
} = {}) => {
  const normalizedClientId = normalizeText(clientId);
  const profileClientId = normalizeText(userProfile?.client_id);
  const snapshotClientId = normalizeText(userProfile?.profileSnapshot?.client_id);
  const effectiveClientId = normalizedClientId || profileClientId || snapshotClientId || '';
  const hasCanonicalProfile = Boolean(userProfile && !userProfile?.profileSnapshot && !userProfile?.offline_ready);
  const isOfflineFallback = Boolean(userProfile?.offline_ready);
  const isMetadataFallback = Boolean(!isOfflineFallback && userProfile?.profileSnapshot);
  const clientMismatch = (
    Boolean(normalizedClientId && profileClientId && normalizedClientId !== profileClientId)
    || Boolean(normalizedClientId && snapshotClientId && normalizedClientId !== snapshotClientId)
    || Boolean(profileClientId && snapshotClientId && profileClientId !== snapshotClientId)
  );

  if (!effectiveClientId) {
    return {
      status: 'blocked',
      label: 'Client scope missing',
      tone: 'red',
      reason: 'Missing client scope. Re-authenticate before loading or changing recipe truth.',
      normalizedClientId: '',
      canReadLiveRecipes: false,
      canReadCachedRecipes: false,
      canQueueRecipeEdits: false,
      canApproveRecipeSync: false,
      canSyncUpstream: false,
      isDegraded: true
    };
  }

  if (clientMismatch) {
    return {
      status: 'blocked',
      label: 'Client scope mismatch',
      tone: 'red',
      reason: 'Profile and client scope do not match. Stop here and re-authenticate before loading or changing recipe truth.',
      normalizedClientId: effectiveClientId,
      canReadLiveRecipes: false,
      canReadCachedRecipes: false,
      canQueueRecipeEdits: false,
      canApproveRecipeSync: false,
      canSyncUpstream: false,
      isDegraded: true
    };
  }

  if (isOfflineFallback) {
    return {
      status: 'offline-fallback',
      label: 'Offline auth fallback',
      tone: 'gold',
      reason: connectionState === OFFLINE_STATE.ONLINE
        ? 'Offline fallback profile is still active. Re-authenticate before editing or syncing recipe truth.'
        : 'Offline fallback profile is active. Read-only mode protects recipe truth until live auth returns.',
      normalizedClientId: effectiveClientId,
      canReadLiveRecipes: false,
      canReadCachedRecipes: true,
      canQueueRecipeEdits: false,
      canApproveRecipeSync: false,
      canSyncUpstream: false,
      isDegraded: true
    };
  }

  if (isMetadataFallback || !hasCanonicalProfile) {
    return {
      status: 'profile-review',
      label: 'Profile review required',
      tone: 'gold',
      reason: 'This session is missing a canonical profile row. Live recipe truth can be read, but edits and sync stay blocked until profile scope is confirmed.',
      normalizedClientId: effectiveClientId,
      canReadLiveRecipes: true,
      canReadCachedRecipes: true,
      canQueueRecipeEdits: false,
      canApproveRecipeSync: false,
      canSyncUpstream: false,
      isDegraded: true
    };
  }

  return {
    status: 'trusted',
    label: 'Trusted client scope',
    tone: 'good',
    reason: '',
    normalizedClientId: effectiveClientId,
    canReadLiveRecipes: true,
    canReadCachedRecipes: true,
    canQueueRecipeEdits: true,
    canApproveRecipeSync: true,
    canSyncUpstream: connectionState === OFFLINE_STATE.ONLINE,
    isDegraded: false
  };
};

export const buildIdentitySessionState = ({
  userProfile = null,
  sessionUser = null,
  authScopeState = null
} = {}) => {
  const sessionUserId = String(sessionUser?.id || '').trim();
  const sessionEmail = String(sessionUser?.email || '').trim();
  const profileId = String(userProfile?.id || userProfile?.profileSnapshot?.id || '').trim();
  const displayName = String(
    userProfile?.full_name
    || userProfile?.name
    || userProfile?.profileSnapshot?.full_name
    || userProfile?.profileSnapshot?.name
    || sessionEmail
    || 'Kitchen user'
  ).trim();
  const normalizedRole = normalizeText(
    userProfile?.role
    || userProfile?.profileSnapshot?.role
    || sessionUser?.user_metadata?.role
    || 'staff'
  );
  const roleLabel = normalizedRole ? titleCaseWords(normalizedRole.replace(/_/g, ' ')) : 'Staff';
  const authTrusted = authScopeState?.status === 'trusted';
  const hasSession = Boolean(sessionUserId);
  const profileMatchesSession = Boolean(sessionUserId && profileId && sessionUserId === profileId);

  if (!hasSession) {
    return {
      status: 'blocked',
      label: 'Sign-in required',
      tone: 'red',
      reason: 'No signed-in kitchen identity is active. Re-authenticate before using protected role surfaces.',
      displayName,
      roleLabel,
      sessionEmail,
      canUseStaffWorkspace: false,
      canUsePrivilegedWorkspace: false,
      isTrusted: false
    };
  }

  if (profileId && !profileMatchesSession) {
    return {
      status: 'blocked',
      label: 'Identity mismatch',
      tone: 'red',
      reason: 'Signed-in user and kitchen profile do not match. Stay read-only until the correct profile is restored.',
      displayName,
      roleLabel,
      sessionEmail,
      canUseStaffWorkspace: true,
      canUsePrivilegedWorkspace: false,
      isTrusted: false
    };
  }

  if (!authTrusted) {
    return {
      status: 'review',
      label: 'Identity review',
      tone: authScopeState?.tone || 'gold',
      reason: authScopeState?.reason || 'Kitchen identity is present, but trusted profile scope is not fully confirmed yet.',
      displayName,
      roleLabel,
      sessionEmail,
      canUseStaffWorkspace: true,
      canUsePrivilegedWorkspace: false,
      isTrusted: false
    };
  }

  return {
    status: 'trusted',
    label: 'Signed in',
    tone: 'good',
    reason: '',
    displayName,
    roleLabel,
    sessionEmail,
    canUseStaffWorkspace: true,
    canUsePrivilegedWorkspace: true,
    isTrusted: true
  };
};

export const buildOperationalStateCopy = ({
  kind = '',
  authScopeState = null,
  offlineDataState = null,
  hasRecipes = true,
  hasActiveRecipe = true
} = {}) => {
  const normalizedKind = normalizeText(kind);
  const source = normalizeText(offlineDataState?.source);
  const reason = String(offlineDataState?.reason || authScopeState?.reason || '').trim();

  if (normalizedKind === 'loading') {
    if (authScopeState?.isDegraded) {
      return {
        title: authScopeState.label || 'Client scope check',
        body: reason || 'Checking safe client scope before recipe truth becomes editable.',
        tone: authScopeState.tone || 'gold'
      };
    }

    if (source === 'offline-cache' || source === 'offline-cache-degraded') {
      return {
        title: 'Loading cached recipe truth',
        body: reason || 'Opening the last safe local recipe snapshot for this kitchen.',
        tone: source === 'offline-cache-degraded' ? 'gold' : 'good'
      };
    }

    return {
      title: 'Loading recipe truth',
      body: 'Bringing recipe, prep, and approval signals into one live workspace.',
      tone: 'good'
    };
  }

  if (normalizedKind === 'recipe-library-empty') {
    if (authScopeState?.isDegraded) {
      return {
        title: authScopeState.label || 'Recipe truth unavailable',
        body: reason || 'Recipe truth is in read-only safety mode until auth and client scope are trusted.',
        tone: authScopeState.tone || 'gold'
      };
    }

    if (!hasRecipes) {
      if (source === 'missing-cache') {
        return {
          title: 'No recipe truth loaded',
          body: reason || 'No live or cached recipe rows are available for this kitchen yet.',
          tone: 'gold'
        };
      }

      return {
        title: 'Recipe library is empty',
        body: reason || 'Import or create the first trusted recipe row before prep and training can flow downstream.',
        tone: 'gold'
      };
    }
  }

  if (normalizedKind === 'recipe-selection-empty') {
    return {
      title: 'Choose a recipe',
      body: hasRecipes
        ? 'Pick a recipe to view ingredients, instructions, prep guidance, and training truth.'
        : 'No recipe row is available yet for this kitchen.',
      tone: hasRecipes ? 'good' : 'gold'
    };
  }

  if (normalizedKind === 'ingredients-empty') {
    return {
      title: 'Ingredients missing',
      body: 'This recipe has no ingredient rows yet. Add ingredients before relying on BOM, prep, or training output.',
      tone: 'gold'
    };
  }

  if (normalizedKind === 'instructions-empty') {
    return {
      title: 'Instructions missing',
      body: 'This recipe has no live instruction steps yet. Add the cooking flow before using it for staff training or handoff.',
      tone: 'gold'
    };
  }

  return {
    title: 'State unavailable',
    body: reason || 'This operational view does not have enough trusted data yet.',
    tone: 'gold'
  };
};

export const buildOperationalObservabilityItems = ({
  authScopeState = null,
  offlineDataState = null,
  syncNotice = null
} = {}) => {
  const items = [];
  const pushItem = (item) => {
    if (!item?.title || !item?.body) return;
    const duplicate = items.some((existing) => existing.title === item.title && existing.body === item.body);
    if (!duplicate) items.push(item);
  };

  const source = normalizeText(offlineDataState?.source);
  const offlineReason = String(offlineDataState?.reason || '').trim();
  const syncMessage = String(syncNotice?.message || '').trim();
  const syncTone = normalizeText(syncNotice?.tone);

  if (authScopeState?.isDegraded && authScopeState?.reason) {
    pushItem({
      key: 'auth-scope',
      tone: authScopeState.tone || 'gold',
      title: authScopeState.label || 'Client scope attention',
      body: authScopeState.reason,
      action: 'Re-authenticate before editing, approval, or upstream sync.'
    });
  }

  if (source === 'supabase-transport-hang') {
    pushItem({
      key: 'fetch-transport-hang',
      tone: 'error',
      title: 'Live fetch stalled',
      body: offlineReason || 'Supabase did not return before the transport timeout expired.',
      action: 'Use cached recipe truth in read-only mode, then retry live hydration.'
    });
  } else if (source === 'missing-cache') {
    pushItem({
      key: 'fetch-missing-cache',
      tone: 'error',
      title: 'No safe recipe cache',
      body: offlineReason || 'This device does not have a usable live or cached recipe snapshot.',
      action: 'Reconnect and hydrate recipe truth before relying on this device offline.'
    });
  } else if (source === 'offline-cache-degraded') {
    pushItem({
      key: 'fetch-degraded-cache',
      tone: 'warning',
      title: 'Cached recipe truth is degraded',
      body: offlineReason || 'The local recipe snapshot is available but missing freshness or trust markers.',
      action: 'Treat this as read-only fallback until a fresh live hydration succeeds.'
    });
  }

  if (syncMessage && ['error', 'warning'].includes(syncTone)) {
    const normalizedMessage = normalizeText(syncMessage);
    let title = 'Operational attention';
    let action = 'Review the current state before continuing with recipe changes.';

    if (normalizedMessage.includes('sync') || normalizedMessage.includes('upstream')) {
      title = 'Sync attention';
      action = 'Open Approvals, review failed or conflicted entries, then retry explicit sync.';
    } else if (normalizedMessage.includes('upload') || normalizedMessage.includes('import')) {
      title = 'Import attention';
      action = 'Fix the import packet or auth state before retrying the recipe upload.';
    } else if (normalizedMessage.includes('offline')) {
      title = 'Offline queue state';
      action = 'Keep edits local until reconnect, manager approval, and explicit sync are available.';
    }

    pushItem({
      key: 'sync-notice',
      tone: syncTone,
      title,
      body: syncMessage,
      action
    });
  }

  return items.slice(0, 3);
};

const buildRecipeTruthMetadata = ({
  recipe = {},
  hasCanonicalSource = false,
  offlineSyncState = null
} = {}) => {
  const flags = [...collectRecipeQuantityWarnings(recipe)];
  const baseYieldValue = Number(recipe?.baseYield ?? recipe?.base_yield ?? recipe?.yield ?? 0);
  const unitLabel = String(recipe?.unit || '').trim();
  const normalizedOfflineState = normalizeText(offlineSyncState || recipe?.offline_sync_state);
  const { hasMeasuredIngredients } = getMeasuredIngredientSummary(recipe);

  if (!(baseYieldValue > 0) && !hasMeasuredIngredients) {
    flags.push('Missing base yield');
  }

  if (!unitLabel) {
    flags.push('Missing yield unit');
  }

  if (['local', 'pending', 'approval_required'].includes(normalizedOfflineState)) {
    flags.push(`Local recipe truth is ${normalizedOfflineState.replace(/_/g, ' ')}`);
  }

  if (['conflict', 'failed', 'blocked'].includes(normalizedOfflineState)) {
    flags.push(`Recipe truth is ${normalizedOfflineState.replace(/_/g, ' ')}`);
  }

  const hasBlockingFlag = flags.some((flag) => /missing base yield|conflict|failed|blocked/i.test(flag));
  const hasReviewFlag = flags.length > 0;

  let recipeTruthStatus = hasCanonicalSource ? 'trusted' : 'candidate';
  if (hasBlockingFlag) {
    recipeTruthStatus = 'blocked';
  } else if (hasReviewFlag) {
    recipeTruthStatus = hasCanonicalSource ? 'warning' : 'review';
  }

  const tierBase = hasCanonicalSource ? 0 : 5;
  const recipeTruthTier = Math.min(
    9,
    tierBase + (hasReviewFlag ? 1 : 0) + (hasBlockingFlag ? 2 : 0)
  );
  const recipeTrustScore = (hasCanonicalSource ? 0 : 2) + flags.length;

  return {
    recipe_truth_flags: flags,
    recipe_truth_status: recipeTruthStatus,
    recipe_truth_tier: recipeTruthTier,
    recipe_trust_score: recipeTrustScore,
    recipe_canonical_hint: hasCanonicalSource ? 'canonical' : 'candidate'
  };
};

const firstPresentMeta = (...values) => {
  for (const value of values) {
    const normalizedValue = String(value || '').trim().replace(/\s+/g, ' ');
    if (normalizedValue) return normalizedValue;
  }
  return '';
};

const firstPresentTextBlock = (...values) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalizedValue = value.trim();
    if (normalizedValue) return normalizedValue;
  }
  return '';
};

const firstDefinedMeta = (...values) => {
  for (const value of values) {
    if (value === 0 || value === false) return value;
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') {
      if (value.trim()) return value;
      continue;
    }
    if (value !== null && value !== undefined) return value;
  }
  return null;
};

const keepPresentRecipeFields = (value = {}) => Object.entries(value).reduce((acc, [key, fieldValue]) => {
  if (fieldValue === null || fieldValue === undefined) return acc;
  acc[key] = fieldValue;
  return acc;
}, {});

const toFiniteNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numericValue = toFiniteNumber(value);
    if (numericValue !== null) return numericValue;
  }
  return null;
};

const parseJsonObjectOrEmpty = (value) => parseJsonRecipe(value) || {};
const parseJsonArrayOrEmpty = (value) => parseJsonArray(value) || [];

export const normalizeRecipePrepProfileRecord = ({ row = {}, clientId = null }) => {
  const prepIntelligenceRaw = parseJsonObjectOrEmpty(row?.prep_intelligence || row?.prepIntelligence);
  const scaleRule = parseJsonObjectOrEmpty(row?.scale_rule || row?.scaleRule);
  const regularProfile = parseJsonObjectOrEmpty(row?.regular_profile || row?.regularProfile);
  const largeProfile = parseJsonObjectOrEmpty(row?.large_profile || row?.largeProfile);
  const storage = parseJsonObjectOrEmpty(row?.storage);
  const trainingOutline = parseJsonObjectOrEmpty(row?.training_outline || row?.trainingOutline);
  const uiOutput = parseJsonObjectOrEmpty(row?.ui_output || row?.uiOutput);
  const confidenceScores = parseJsonObjectOrEmpty(row?.confidence_scores || row?.confidenceScores);
  const foodSafetyCcp = parseJsonArrayOrEmpty(row?.food_safety_ccp || row?.foodSafetyCcp);
  const criticalChecks = parseJsonArrayOrEmpty(row?.critical_checks || row?.criticalChecks);
  const serviceFinish = parseJsonArrayOrEmpty(row?.service_finish || row?.serviceFinish);
  const trainingKeyPoints = parseJsonArrayOrEmpty(row?.training_key_points || row?.trainingKeyPoints);
  const strictContractMeta = parseJsonObjectOrEmpty(
    prepIntelligenceRaw?.strict_contract_meta
    || uiOutput?.strict_contract_meta
    || row?.strict_contract_meta
    || row?.strictContractMeta
  );
  const sourceEvidenceIds = parseJsonArrayOrEmpty(
    row?.source_evidence_ids
    || row?.sourceEvidenceIds
    || strictContractMeta?.source_evidence_ids
    || strictContractMeta?.sourceEvidenceIds
  );
  const lowConfidenceFields = parseJsonArrayOrEmpty(
    row?.low_confidence_fields
    || row?.lowConfidenceFields
    || strictContractMeta?.low_confidence_fields
    || strictContractMeta?.lowConfidenceFields
  );
  const knowledgeLinks = parseJsonObjectOrEmpty(
    row?.knowledge_links
    || row?.knowledgeLinks
    || strictContractMeta?.knowledge_links
    || strictContractMeta?.knowledgeLinks
  );

  const recipeRefId = firstDefinedMeta(row?.recipe_ref_id, row?.recipeRefId, row?.canonical_id, row?.canonicalId);
  if (!recipeRefId) return null;

  const prepTimeMinutes = firstFiniteNumber(
    prepIntelligenceRaw?.prep_time_minutes_regular,
    prepIntelligenceRaw?.prepTimeMinutesRegular,
    prepIntelligenceRaw?.prep_time_minutes_large,
    prepIntelligenceRaw?.prepTimeMinutesLarge,
    prepIntelligenceRaw?.prep_time_minutes,
    prepIntelligenceRaw?.prepTimeMinutes,
    row?.prep_time_minutes_regular,
    row?.prepTimeMinutesRegular,
    row?.prep_time_minutes_large,
    row?.prepTimeMinutesLarge,
    row?.prep_time_minutes,
    row?.prepTimeMinutes,
    0
  );

  return {
    ...row,
    recipe_ref_id: recipeRefId,
    recipeRefId: recipeRefId,
    client_id: row?.client_id || clientId,
    clientId: row?.client_id || clientId,
    profile_version: firstFiniteNumber(row?.profile_version, row?.profileVersion, 1),
    profileVersion: firstFiniteNumber(row?.profile_version, row?.profileVersion, 1),
    status: firstPresentMeta(row?.status, 'active') || 'active',
    knowledge_source: firstDefinedMeta(row?.knowledge_source, row?.knowledgeSource),
    knowledgeSource: firstDefinedMeta(row?.knowledge_source, row?.knowledgeSource),
    knowledge_source_version: firstDefinedMeta(row?.knowledge_source_version, row?.knowledgeSourceVersion),
    knowledgeSourceVersion: firstDefinedMeta(row?.knowledge_source_version, row?.knowledgeSourceVersion),
    generated_by: firstDefinedMeta(row?.generated_by, row?.generatedBy),
    generatedBy: firstDefinedMeta(row?.generated_by, row?.generatedBy),
    generated_at: firstDefinedMeta(row?.generated_at, row?.generatedAt),
    generatedAt: firstDefinedMeta(row?.generated_at, row?.generatedAt),
    regen_reason: firstDefinedMeta(row?.regen_reason, row?.regenReason),
    regenReason: firstDefinedMeta(row?.regen_reason, row?.regenReason),
    prep_intelligence: prepIntelligenceRaw,
    prepIntelligence: {
      leadTime: firstPresentMeta(prepIntelligenceRaw?.lead_time, prepIntelligenceRaw?.leadTime),
      makeAhead: firstPresentMeta(prepIntelligenceRaw?.make_ahead, prepIntelligenceRaw?.makeAhead),
      storageWindow: firstPresentMeta(prepIntelligenceRaw?.storage_window, prepIntelligenceRaw?.storageWindow),
      handoffNote: firstPresentMeta(prepIntelligenceRaw?.handoff_note, prepIntelligenceRaw?.handoffNote),
      prepTimeMinutes: prepTimeMinutes > 0 ? prepTimeMinutes : 0
    },
    scale_rule: scaleRule,
    scaleRule,
    regular_profile: regularProfile,
    regularProfile,
    large_profile: largeProfile,
    largeProfile,
    storage,
    food_safety_ccp: foodSafetyCcp,
    foodSafetyCcp,
    critical_checks: criticalChecks,
    criticalChecks,
    service_finish: serviceFinish,
    serviceFinish,
    training_outline: trainingOutline,
    trainingOutline,
    training_key_points: trainingKeyPoints,
    trainingKeyPoints,
    ui_output: uiOutput,
    uiOutput,
    confidence_scores: confidenceScores,
    confidenceScores,
    strict_contract_meta: strictContractMeta,
    strictContractMeta,
    review_required: Boolean(row?.review_required || row?.reviewRequired || strictContractMeta?.review_required || strictContractMeta?.reviewRequired),
    reviewRequired: Boolean(row?.review_required || row?.reviewRequired || strictContractMeta?.review_required || strictContractMeta?.reviewRequired),
    review_summary: firstPresentMeta(row?.review_summary, row?.reviewSummary, strictContractMeta?.review_summary, strictContractMeta?.reviewSummary),
    reviewSummary: firstPresentMeta(row?.review_summary, row?.reviewSummary, strictContractMeta?.review_summary, strictContractMeta?.reviewSummary),
    low_confidence_fields: lowConfidenceFields,
    lowConfidenceFields,
    knowledge_status: firstPresentMeta(row?.knowledge_status, row?.knowledgeStatus),
    knowledgeStatus: firstPresentMeta(row?.knowledge_status, row?.knowledgeStatus),
    approval_level: firstPresentMeta(row?.approval_level, row?.approvalLevel),
    approvalLevel: firstPresentMeta(row?.approval_level, row?.approvalLevel),
    validated_by: firstPresentMeta(row?.validated_by, row?.validatedBy),
    validatedBy: firstPresentMeta(row?.validated_by, row?.validatedBy),
    validated_at: firstPresentMeta(row?.validated_at, row?.validatedAt),
    validatedAt: firstPresentMeta(row?.validated_at, row?.validatedAt),
    manager_review_required: Boolean(row?.manager_review_required || row?.managerReviewRequired),
    managerReviewRequired: Boolean(row?.manager_review_required || row?.managerReviewRequired),
    source_evidence_ids: sourceEvidenceIds,
    sourceEvidenceIds,
    knowledge_links: knowledgeLinks,
    knowledgeLinks
  };
};

export const normalizeRecipeExtendedProfileRecord = ({ row = {}, clientId = null }) => {
  const recipeRefId = firstDefinedMeta(row?.recipe_ref_id, row?.recipeRefId, row?.canonical_id, row?.canonicalId);
  if (!recipeRefId) return null;

  const dependencyMap = parseJsonObjectOrEmpty(row?.dependency_map || row?.dependencyMap);
  const oversoldRecovery = parseJsonObjectOrEmpty(row?.oversold_recovery || row?.oversoldRecovery);
  const kitchenAdaptation = parseJsonObjectOrEmpty(row?.kitchen_adaptation || row?.kitchenAdaptation);
  const strictContractMeta = parseJsonObjectOrEmpty(
    kitchenAdaptation?.strict_contract_meta
    || kitchenAdaptation?.strictContractMeta
    || row?.strict_contract_meta
    || row?.strictContractMeta
  );
  const lowConfidenceFields = parseJsonArrayOrEmpty(
    row?.low_confidence_fields
    || row?.lowConfidenceFields
    || strictContractMeta?.low_confidence_fields
    || strictContractMeta?.lowConfidenceFields
  );
  const sourceEvidenceIds = parseJsonArrayOrEmpty(
    row?.source_evidence_ids
    || row?.sourceEvidenceIds
    || strictContractMeta?.source_evidence_ids
    || strictContractMeta?.sourceEvidenceIds
  );
  const sourceEvidence = parseJsonArrayOrEmpty(
    row?.source_evidence
    || row?.sourceEvidence
    || strictContractMeta?.source_evidence
    || strictContractMeta?.sourceEvidence
  );
  const knowledgeLinks = parseJsonObjectOrEmpty(
    row?.knowledge_links
    || row?.knowledgeLinks
    || strictContractMeta?.knowledge_links
    || strictContractMeta?.knowledgeLinks
  );
  const chefReviewNotes = parseJsonObjectOrEmpty(
    row?.chef_review_notes
    || row?.chefReviewNotes
    || strictContractMeta?.chef_review_notes
    || strictContractMeta?.chefReviewNotes
  );
  const wf2ClassificationValidation = parseJsonObjectOrEmpty(
    row?.wf2_classification_validation
    || row?.wf2ClassificationValidation
    || strictContractMeta?.wf2_classification_validation
    || strictContractMeta?.wf2ClassificationValidation
  );
  const wf2LookupRun = parseJsonObjectOrEmpty(
    row?.wf2_lookup_run
    || row?.wf2LookupRun
    || strictContractMeta?.wf2_lookup_run
    || strictContractMeta?.wf2LookupRun
  );

  return {
    ...row,
    recipe_ref_id: recipeRefId,
    recipeRefId: recipeRefId,
    client_id: row?.client_id || clientId,
    clientId: row?.client_id || clientId,
    profile_version: firstFiniteNumber(row?.profile_version, row?.profileVersion, 1),
    profileVersion: firstFiniteNumber(row?.profile_version, row?.profileVersion, 1),
    status: firstPresentMeta(row?.status, 'active') || 'active',
    generated_at: firstDefinedMeta(row?.generated_at, row?.generatedAt),
    generatedAt: firstDefinedMeta(row?.generated_at, row?.generatedAt),
    dependency_map: dependencyMap,
    dependencyMap,
    container_label_rule: parseJsonObjectOrEmpty(row?.container_label_rule || row?.containerLabelRule),
    containerLabelRule: parseJsonObjectOrEmpty(row?.container_label_rule || row?.containerLabelRule),
    oversold_recovery: oversoldRecovery,
    oversoldRecovery,
    kitchen_adaptation: kitchenAdaptation,
    kitchenAdaptation,
    manager_review_reason: firstPresentMeta(row?.manager_review_reason, row?.managerReviewReason),
    managerReviewReason: firstPresentMeta(row?.manager_review_reason, row?.managerReviewReason),
    strict_contract_meta: strictContractMeta,
    strictContractMeta,
    chef_review_notes: chefReviewNotes,
    chefReviewNotes,
    wf2_classification_validation: wf2ClassificationValidation,
    wf2ClassificationValidation,
    wf2_lookup_run: wf2LookupRun,
    wf2LookupRun,
    review_required: Boolean(row?.review_required || row?.reviewRequired || strictContractMeta?.review_required || strictContractMeta?.reviewRequired),
    reviewRequired: Boolean(row?.review_required || row?.reviewRequired || strictContractMeta?.review_required || strictContractMeta?.reviewRequired),
    review_summary: firstPresentMeta(row?.review_summary, row?.reviewSummary, strictContractMeta?.review_summary, strictContractMeta?.reviewSummary),
    reviewSummary: firstPresentMeta(row?.review_summary, row?.reviewSummary, strictContractMeta?.review_summary, strictContractMeta?.reviewSummary),
    low_confidence_fields: lowConfidenceFields,
    lowConfidenceFields,
    knowledge_status: firstPresentMeta(row?.knowledge_status, row?.knowledgeStatus),
    knowledgeStatus: firstPresentMeta(row?.knowledge_status, row?.knowledgeStatus),
    approval_level: firstPresentMeta(row?.approval_level, row?.approvalLevel),
    approvalLevel: firstPresentMeta(row?.approval_level, row?.approvalLevel),
    validated_by: firstPresentMeta(row?.validated_by, row?.validatedBy),
    validatedBy: firstPresentMeta(row?.validated_by, row?.validatedBy),
    validated_at: firstPresentMeta(row?.validated_at, row?.validatedAt),
    validatedAt: firstPresentMeta(row?.validated_at, row?.validatedAt),
    manager_review_required: Boolean(row?.manager_review_required || row?.managerReviewRequired),
    managerReviewRequired: Boolean(row?.manager_review_required || row?.managerReviewRequired),
    source_evidence_ids: sourceEvidenceIds,
    sourceEvidenceIds,
    source_evidence: sourceEvidence,
    sourceEvidence,
    knowledge_links: knowledgeLinks,
    knowledgeLinks
  };
};

export const mergeRecipeWithPrepProfile = (recipe = {}, prepProfile = null) => {
  if (!prepProfile) return recipe;

  const currentPrepIntelligence = parseJsonObjectOrEmpty(recipe?.prepIntelligence);

  const mergedPrepIntelligence = {
    leadTime: firstPresentMeta(prepProfile?.prepIntelligence?.leadTime, currentPrepIntelligence?.leadTime),
    makeAhead: firstPresentMeta(prepProfile?.prepIntelligence?.makeAhead, currentPrepIntelligence?.makeAhead),
    storageWindow: firstPresentMeta(prepProfile?.prepIntelligence?.storageWindow, currentPrepIntelligence?.storageWindow),
    handoffNote: firstPresentMeta(prepProfile?.prepIntelligence?.handoffNote, currentPrepIntelligence?.handoffNote),
    prepTimeMinutes: Math.max(
      0,
      firstFiniteNumber(
        prepProfile?.prepIntelligence?.prepTimeMinutes,
        currentPrepIntelligence?.prepTimeMinutes,
        0
      ) || 0
    )
  };

  return {
    ...recipe,
    prepProfile,
    workflow2PrepProfile: prepProfile,
    prepIntelligence: mergedPrepIntelligence
  };
};

export const mergeRecipeWithExtendedProfile = (recipe = {}, extendedProfile = null) => {
  if (!extendedProfile) return recipe;

  return {
    ...recipe,
    extendedProfile,
    workflow3ExtendedProfile: extendedProfile
  };
};

export const normalizeSupabaseRecipeRecord = ({ row = {}, clientId = null }) => {
  const structuredRecipe = parseJsonRecipe(row?.structured_recipe);
  const structuredRecipeRoot = parseJsonRecipe(structuredRecipe?.recipe) || structuredRecipe?.recipe || null;
  const recipeJson = parseJsonRecipe(row?.[DB_FIELDS.RECIPE_JSON]);
  const parsed = structuredRecipeRoot || recipeJson;
  const hasDbIdentity = Boolean(row?.id || row?.recipe_id || row?.recipe_ref_id || row?.canonical_id);
  const hasCanonicalSource = Boolean(row?.source === 'canonical' || row?.source_trust === 'canonical' || hasDbIdentity);

  const fallbackMeta = {
    name: firstDefinedMeta(row?.name, row?.title, row?.recipe_name, row?.clean_name),
    id: firstDefinedMeta(row?.id),
    canonical_id: firstDefinedMeta(row?.canonical_id, row?.recipe_ref_id, row?.recipe_id),
    recipe_ref_id: firstDefinedMeta(row?.recipe_ref_id, row?.recipe_id),
    sku: firstDefinedMeta(row?.sku, row?.code, row?.recipe_code),
    code: firstDefinedMeta(row?.code, row?.recipe_code, row?.sku),
    clean_name: firstDefinedMeta(row?.clean_name, row?.name, row?.title),
    title: firstDefinedMeta(row?.title, row?.name, row?.recipe_name, row?.clean_name),
    canonical_name: firstDefinedMeta(row?.canonical_name, row?.clean_name, row?.name),
    dishStyle: firstDefinedMeta(row?.dish_style, row?.dishStyle, row?.style),
    dishCategory: firstDefinedMeta(row?.dish_category, row?.dishCategory, row?.category),
    cuisine: firstDefinedMeta(row?.cuisine, row?.cuisine_type, row?.dish_cuisine),
    occasion: firstDefinedMeta(row?.occasion, row?.serviceOccasion, row?.course),
    ingredients: parseJsonArray(row?.ingredients || row?.ingredient_json || row?.ingredient_items),
    instruction_rows: parseJsonArray(row?.instruction_rows || row?.instructionRows) || parseTextList(row?.instruction_rows || row?.instructionRows),
    instructions_raw: firstDefinedMeta(
      row?.instructions_raw,
      row?.instructionsRaw,
      typeof row?.instructions === 'string' ? row.instructions : null,
      typeof row?.method === 'string' ? row.method : null,
      typeof row?.steps === 'string' ? row.steps : null,
      typeof row?.directions === 'string' ? row.directions : null
    ),
    instructions: parseTextList(row?.instructions || row?.method || row?.steps || row?.directions),
    method: parseTextList(row?.method || row?.instructions || row?.steps || row?.directions),
    allergens: parseTextList(row?.allergens || row?.allergen_list || row?.allergen_notes, /[,|\n]+/),
    dietaryTags: parseTextList(row?.dietary_tags || row?.dietaryTags || row?.dietary, /[,|\n]+/),
    notes: parseTextList(row?.notes || row?.recipe_notes || row?.manager_notes, /\n+/),
    baseYield: firstDefinedMeta(row?.baseYield, row?.base_yield, row?.yield),
    unit: firstDefinedMeta(row?.unit),
    yieldMode: firstDefinedMeta(row?.yieldMode, row?.yield_mode),
    batchYield: firstDefinedMeta(row?.batchYield, row?.batch_yield),
    servingSize: firstDefinedMeta(row?.servingSize, row?.serving_size),
    servingKind: firstDefinedMeta(row?.servingKind, row?.serving_kind),
    portionClass: firstDefinedMeta(row?.portionClass, row?.portion_class),
    recordedServingWeight: firstDefinedMeta(row?.recordedServingWeight, row?.recorded_serving_weight),
    recordedServingUnit: firstDefinedMeta(row?.recordedServingUnit, row?.recorded_serving_unit),
    productionStrategy: firstDefinedMeta(row?.productionStrategy, row?.production_strategy),
    productionBatchSize: firstDefinedMeta(row?.productionBatchSize, row?.production_batch_size)
  };

  const recipe = {
    ...(parsed || {}),
    ...keepPresentRecipeFields(fallbackMeta)
  };

  if (!recipe?.name && recipe?.title) {
    recipe.name = recipe.title;
  }

  if (!recipe?.name) return null;

  const recipeTitle = recipe.name || recipe.title || fallbackMeta.name || 'Unnamed Recipe';
  const recipeRefId = recipe.recipe_ref_id || recipe.id || recipe.canonical_id || row?.id || null;

  const recipeIngredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
    : Array.isArray(fallbackMeta.ingredients)
      ? fallbackMeta.ingredients
      : [];
  const recipeInstructionRows = Array.isArray(recipe.instruction_rows)
    ? recipe.instruction_rows
    : Array.isArray(recipe.instructionRows)
      ? recipe.instructionRows
      : Array.isArray(parseTextList(recipe.instruction_rows || recipe.instructionRows))
        ? parseTextList(recipe.instruction_rows || recipe.instructionRows)
        : Array.isArray(fallbackMeta.instruction_rows)
          ? fallbackMeta.instruction_rows
          : [];
  const recipeInstructionsRaw = firstPresentTextBlock(
    recipe.instructions_raw,
    recipe.instructionsRaw,
    fallbackMeta.instructions_raw
  );

  const recipeInstructions = Array.isArray(recipe.instructions)
    ? recipe.instructions
    : Array.isArray(parseTextList(recipe.instructions))
      ? parseTextList(recipe.instructions)
    : Array.isArray(recipe.steps)
      ? recipe.steps
      : Array.isArray(parseTextList(recipe.steps))
        ? parseTextList(recipe.steps)
      : Array.isArray(recipe.method)
        ? recipe.method
        : Array.isArray(parseTextList(recipe.method))
          ? parseTextList(recipe.method)
        : Array.isArray(recipe.directions)
          ? recipe.directions
          : Array.isArray(parseTextList(recipe.directions))
            ? parseTextList(recipe.directions)
        : Array.isArray(fallbackMeta.instructions)
          ? fallbackMeta.instructions
          : [];
  const recipeAllergens = Array.isArray(recipe.allergens)
    ? recipe.allergens
    : Array.isArray(parseTextList(recipe.allergens, /[,|\n]+/))
      ? parseTextList(recipe.allergens, /[,|\n]+/)
      : Array.isArray(fallbackMeta.allergens)
        ? fallbackMeta.allergens
        : [];
  const recipeNotes = Array.isArray(recipe.notes)
    ? recipe.notes
    : Array.isArray(parseTextList(recipe.notes, /\n+/))
      ? parseTextList(recipe.notes, /\n+/)
      : Array.isArray(fallbackMeta.notes)
        ? fallbackMeta.notes
        : [];
  const recipeDietaryTags = Array.isArray(recipe.dietaryTags)
    ? recipe.dietaryTags
    : Array.isArray(recipe.dietary_tags)
      ? recipe.dietary_tags
      : Array.isArray(parseTextList(recipe.dietaryTags || recipe.dietary_tags || recipe.dietary, /[,|\n]+/))
        ? parseTextList(recipe.dietaryTags || recipe.dietary_tags || recipe.dietary, /[,|\n]+/)
        : Array.isArray(fallbackMeta.dietaryTags)
          ? fallbackMeta.dietaryTags
          : [];
  const recipeTruth = buildRecipeTruthMetadata({
    recipe,
    hasCanonicalSource
  });
  const recipeAliases = buildRecipeAliases(recipe, row);
  const recipeCode = recipe?.code || recipe?.recipeCode || recipe?.recipe_code || recipe?.sku || row?.code || row?.recipe_code || row?.sku || null;
  const normalizedDishStyle = canonicalizeRecipeTaxonomy('style', firstPresentMeta(recipe.dishStyle, recipe.style, row?.[DB_FIELDS.DISH_STYLE], row?.dish_style, row?.dishStyle, row?.style, 'Kitchen Standard'));
  const normalizedDishCategory = canonicalizeRecipeTaxonomy('category', firstPresentMeta(recipe.dishCategory, recipe.category, recipe.dish_category, row?.dish_category, row?.dishCategory, row?.category, 'General'));
  const normalizedCuisine = canonicalizeRecipeTaxonomy('cuisine', firstPresentMeta(recipe.cuisine, recipe.cuisineType, recipe.dishCuisine, recipe.dish_cuisine, row?.[DB_FIELDS.CUISINE_TYPE], row?.cuisine, row?.cuisine_type, row?.dish_cuisine, 'General'));
  const normalizedOccasion = canonicalizeRecipeTaxonomy('occasion', firstPresentMeta(recipe.occasion, recipe.serviceOccasion, recipe.course, row?.occasion, row?.serviceOccasion, row?.course, 'Service'));

  return {
    ...recipe,
    ingredients: recipeIngredients.map((ingredient) => ({
      ...ingredient,
      category: ingredient?.category || ingredient?.ingredient_category || ingredient?.group || 'General'
    })),
    instruction_rows: recipeInstructionRows,
    instructionRows: recipeInstructionRows,
    instructions_raw: recipeInstructionsRaw,
    instructionsRaw: recipeInstructionsRaw,
    instructions: recipeInstructions,
    method: recipeInstructions,
    allergens: recipeAllergens,
    notes: recipeNotes,
    id: recipe.id || recipe.canonical_id || recipeRefId,
    name: recipeTitle,
    title: recipe.title || recipeTitle,
    clean_name: recipe.clean_name || recipeTitle,
    canonical_name: recipe.canonical_name || recipe.clean_name || recipeTitle,
    sku: recipe?.sku || recipeCode || null,
    code: recipeCode,
    recipeCode: recipeCode,
    recipe_code: recipeCode,
    recipe_aliases: recipeAliases,
    canonical_id: recipe.canonical_id || recipeRefId,
    recipe_ref_id: recipeRefId,
    client_id: recipe.client_id || row?.client_id || clientId,
    db_id: row?.id,
    dishStyle: normalizedDishStyle,
    style: normalizedDishStyle,
    dishCategory: normalizedDishCategory,
    category: normalizedDishCategory,
    cuisine: normalizedCuisine,
    occasion: normalizedOccasion,
    dietaryTags: recipeDietaryTags,
    dietary_tags: recipeDietaryTags,
    status: firstPresentMeta(recipe.status, row?.status, 'draft') || 'draft',
    ingredients_count: firstFiniteNumber(recipe?.ingredients_count, row?.ingredients_count, recipeIngredients.length, 0),
    baseYield: firstDefinedMeta(recipe.baseYield, recipe.base_yield, row?.baseYield, row?.base_yield, row?.yield, 0),
    base_yield: firstDefinedMeta(recipe.baseYield, recipe.base_yield, row?.baseYield, row?.base_yield, row?.yield, 0),
    unit: firstDefinedMeta(recipe.unit, row?.unit, ''),
    yieldMode: firstDefinedMeta(recipe.yieldMode, recipe.yield_mode, row?.yieldMode, row?.yield_mode),
    yield_mode: firstDefinedMeta(recipe.yieldMode, recipe.yield_mode, row?.yieldMode, row?.yield_mode),
    batchYield: firstDefinedMeta(recipe.batchYield, recipe.batch_yield, row?.batchYield, row?.batch_yield),
    batch_yield: firstDefinedMeta(recipe.batchYield, recipe.batch_yield, row?.batchYield, row?.batch_yield),
    servingSize: firstDefinedMeta(recipe.servingSize, recipe.serving_size, row?.servingSize, row?.serving_size),
    serving_size: firstDefinedMeta(recipe.servingSize, recipe.serving_size, row?.servingSize, row?.serving_size),
    servingKind: firstDefinedMeta(recipe.servingKind, recipe.serving_kind, row?.servingKind, row?.serving_kind),
    serving_kind: firstDefinedMeta(recipe.servingKind, recipe.serving_kind, row?.servingKind, row?.serving_kind),
    portionClass: firstDefinedMeta(recipe.portionClass, recipe.portion_class, row?.portionClass, row?.portion_class),
    portion_class: firstDefinedMeta(recipe.portionClass, recipe.portion_class, row?.portionClass, row?.portion_class),
    recordedServingWeight: firstDefinedMeta(recipe.recordedServingWeight, recipe.recorded_serving_weight, row?.recordedServingWeight, row?.recorded_serving_weight),
    recorded_serving_weight: firstDefinedMeta(recipe.recordedServingWeight, recipe.recorded_serving_weight, row?.recordedServingWeight, row?.recorded_serving_weight),
    recordedServingUnit: firstDefinedMeta(recipe.recordedServingUnit, recipe.recorded_serving_unit, row?.recordedServingUnit, row?.recorded_serving_unit),
    recorded_serving_unit: firstDefinedMeta(recipe.recordedServingUnit, recipe.recorded_serving_unit, row?.recordedServingUnit, row?.recorded_serving_unit),
    productionStrategy: firstDefinedMeta(recipe.productionStrategy, recipe.production_strategy, row?.productionStrategy, row?.production_strategy),
    production_strategy: firstDefinedMeta(recipe.productionStrategy, recipe.production_strategy, row?.productionStrategy, row?.production_strategy),
    productionBatchSize: firstDefinedMeta(recipe.productionBatchSize, recipe.production_batch_size, row?.productionBatchSize, row?.production_batch_size),
    production_batch_size: firstDefinedMeta(recipe.productionBatchSize, recipe.production_batch_size, row?.productionBatchSize, row?.production_batch_size),
    source_trust: hasCanonicalSource ? 'canonical' : 'local_fallback',
    ...recipeTruth
  };
};

export const APP_STRINGS = {
  WELCOME_TITLE: "Welcome to Your Command Center",
  WELCOME_SUBTITLE: "Your restaurant's operational brain is active. Start adding recipes to see dynamic scaling, automated market lists, and cinematic SOPs in action.",
  WELCOME_BADGE: "New Module Integrated",
  SOP_TITLE: "Culinary SOP Briefing",
  SOP_SUBTITLE: "Cinematic Training Experience",
  MARKET_TITLE: "Market Consolidation",
  MARKET_SUBTITLE: "Operational Logistics Hub",
  BOARD_TITLE: "Kitchen Commands",
  BOARD_SUBTITLE: "Shift Execution Planner",
  SKU_PENDING: "SKU-PENDING",
  SETTINGS_TITLE: "Master Rules Configuration",
  SETTINGS_SUBTITLE: "Global Operational Standards",
  SETTINGS_APPEARANCE_LABEL: "Appearance & Language",
  DARK_MODE: "Dark Mode",
  LIGHT_MODE: "Light Mode",
  LANGUAGE_EN: "English (SOP)",
  LANGUAGE_TR: "Türkçe (SOP)",
  VOLUME_FOCUS_LABEL: "Daily Volume Focus",
  VOLUME_FOCUS_MIN_HINT: "Small Batch",
  VOLUME_FOCUS_MAX_HINT: "Industrial Scale",
  MAIN_DISH_LABEL: "Main Dish Portion",
  SIDE_DISH_LABEL: "Side Dish Portion",
  STARTER_DISH_LABEL: "Starter Dish Portion",
  BATCH_SIZE_LABEL: "Batch Size (Standard)",
  PORTIONS_PER_BATCH_LABEL: "Portions per Batch",
  WEIGHT_G_ML: "Standard Weight (g/ml)",
  HEURISTIC_WEIGHT_G_ML: "Heuristic Weight (g/ml)",
  SETTINGS_FOOTNOTE: "Note: These weights are used globally to calculate portion counts from total production yields.",
  RETURN_BUTTON: "Return to Dashboard",
  OFFLINE_BLOCKED_TITLE: "Offline Access Blocked",
  OFFLINE_BLOCKED_SUBTITLE: "This device has not completed a hydrated sign-in for this kitchen. Reconnect once online so Cabij can confirm your profile and prepare offline access.",
  OFFLINE_READY_TITLE: "Offline Access Ready",
  OFFLINE_READY_SUBTITLE: "This kitchen has a hydrated offline marker. Cabij can open the app shell while the network is unavailable."
};

export const OFFLINE_STATE = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  LOCAL: 'local',
  PENDING: 'pending',
  APPROVAL_REQUIRED: 'approval_required',
  APPROVED: 'approved',
  SYNCED: 'synced',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  CONFLICT: 'conflict'
};

export const OFFLINE_BLOCK_REASONS = {
  MISSING_READINESS: 'missing_readiness',
  MISSING_CLIENT_SCOPE: 'missing_client_scope',
  MISSING_PROFILE_SCOPE: 'missing_profile_scope',
  OFFLINE_BEFORE_HYDRATION: 'offline_before_hydration',
  MISSING_CACHE: 'missing_cache'
};

export const OFFLINE_STORAGE = {
  VERSION: 1,
  READINESS_PREFIX: 'cabij:offline-readiness:v1',
  READINESS_INDEX_PREFIX: 'cabij:offline-readiness-index:v1',
  CACHE_PREFIX: 'cabij:offline-cache:v1',
  QUEUE_PREFIX: 'cabij:offline-queue:v1',
  QUEUE_INDEX_PREFIX: 'cabij:offline-queue-index:v1'
};

export const OFFLINE_CACHE_TYPES = {
  RECIPES: 'recipes',
  COMMAND_BOARD: 'command-board',
  SOP_PRESENTATIONS: 'sop-presentations',
  PREP_PLANS: 'prep-plans'
};

export const OFFLINE_QUEUE_TYPES = {
  RECIPE_EDITS: 'recipe-edits'
};

export const OFFLINE_QUEUE_STATUS_LABELS = {
  [OFFLINE_STATE.LOCAL]: 'Local',
  [OFFLINE_STATE.PENDING]: 'Pending',
  [OFFLINE_STATE.APPROVAL_REQUIRED]: 'Approval Required',
  [OFFLINE_STATE.APPROVED]: 'Approved',
  [OFFLINE_STATE.SYNCED]: 'Synced',
  [OFFLINE_STATE.FAILED]: 'Failed',
  [OFFLINE_STATE.BLOCKED]: 'Blocked',
  [OFFLINE_STATE.CONFLICT]: 'Conflict'
};

export const OFFLINE_STATE_META = {
  [OFFLINE_STATE.ONLINE]: {
    label: 'Online',
    description: 'Live data is available from the server.',
  },
  [OFFLINE_STATE.OFFLINE]: {
    label: 'Offline',
    description: 'The app is running without a network connection.',
  },
  [OFFLINE_STATE.LOCAL]: {
    label: 'Local',
    description: 'This change exists only on this device for now.',
  },
  [OFFLINE_STATE.PENDING]: {
    label: 'Pending',
    description: 'This recipe edit is waiting for a future sync decision.',
  },
  [OFFLINE_STATE.APPROVAL_REQUIRED]: {
    label: 'Approval Required',
    description: 'A manager needs to approve this queued recipe edit.',
  },
  [OFFLINE_STATE.APPROVED]: {
    label: 'Approved',
    description: 'This queued change has manager approval and can sync next.',
  },
  [OFFLINE_STATE.SYNCED]: {
    label: 'Synced',
    description: 'This change has already been sent upstream successfully.',
  },
  [OFFLINE_STATE.FAILED]: {
    label: 'Failed',
    description: 'The last sync attempt failed and the edit remains local.',
  },
  [OFFLINE_STATE.BLOCKED]: {
    label: 'Blocked',
    description: 'This action is blocked because the kitchen rule set does not allow it.',
  },
  [OFFLINE_STATE.CONFLICT]: {
    label: 'Conflict',
    description: 'The local edit is older than server truth and needs review.',
  }
};

export const OFFLINE_STATE_ORDER = [
  OFFLINE_STATE.ONLINE,
  OFFLINE_STATE.OFFLINE,
  OFFLINE_STATE.LOCAL,
  OFFLINE_STATE.PENDING,
  OFFLINE_STATE.APPROVAL_REQUIRED,
  OFFLINE_STATE.APPROVED,
  OFFLINE_STATE.SYNCED,
  OFFLINE_STATE.FAILED,
  OFFLINE_STATE.BLOCKED,
  OFFLINE_STATE.CONFLICT
];
