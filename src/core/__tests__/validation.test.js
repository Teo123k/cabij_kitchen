import fs from 'fs';
import { calculateBOM } from '../../utils/BOMEngine.js';
import { buildScaleMap } from '../../utils/calculations.js';
import { formatQuantity } from '../quantities.js';
import { chefRound, getRecipeBaselineGrams } from '../units.js';
import { getPortionWeight, getStandardBatchYield, getCanonicalBatchYield } from '../batch.js';
import { resolveRecipeId } from '../sku.js';
import { buildPrepActionAvailability, buildPrepCalendarPressure, buildPrepScheduleLane, buildPrepTaskCategoryLanes, buildPrepTaskExecutionSignal, buildPrepTaskFocusList, buildPrepTaskSessionDetail, buildPrepTaskTimePrediction, generateProductionTasks, resolvePrepFocusTarget, resolvePrepPlanForTask } from '../productionTaskEngine.js';
import { INVOICE_INGEST_PREVIEW_HISTORY, INVOICE_INGEST_PREVIEW_PACKET, buildAuthScopeState, buildGeneratedProfileReviewState, buildIdentitySessionState, buildOperationalObservabilityItems, buildOperationalStateCopy, buildRecipeBrowseGroups, buildRecipeCostWorkspace, buildRecipeOperationalIndex, buildRecipeQuickPickEntries, buildRecipeSearchIndexEntry, buildRecipeTrainingExecutionSupport, buildRecipeTrainingManagerSupport, buildRecipeTrainingSupport, buildRoleWorkspaceConfig, buildTrainingReadinessWorkspace, canonicalizeRecipeTaxonomy, getRecipeLookupKey, normalizeInvoiceIngestPacket, normalizeRecipeExtendedProfileRecord, normalizeRecipeInstructions, normalizeRecipePrepProfileRecord, normalizeSupabaseRecipeRecord, recipeMatchesLookup, resolveWorkflow2PrepCardRows, resolveWorkflow2PrepDetailRows, resolveRecipeBrowseGroup, scoreRecipeSearchIndex, selectLatestTrustedIngredientCost } from '../../config/constants.js';
import { buildQueuedRecipeEntry, buildRecipesTableWritePayload, buildUpstreamRecipePayload, markQueueEntriesForApproval, markQueueEntrySyncResult, mergeRecipesWithQueue, parseRecipesSqlSeed } from '../../config/offlineQueue.js';
import { OFFLINE_STATE } from '../../config/constants.js';
import { readOfflineCache, saveOfflineCache } from '../../config/offlineState.js';

const colors = {
    pass: '\x1b[32m',
    fail: '\x1b[31m',
    reset: '\x1b[0m',
    warn: '\x1b[33m'
};

function assert(condition, message) {
    if (condition) {
        console.log(`${colors.pass}✅ PASS: ${message}${colors.reset}`);
        return true;
    } else {
        console.error(`${colors.fail}❌ FAIL: ${message}${colors.reset}`);
        return false;
    }
}

console.log('--- STARTING BOMENGINE VALIDATION SUITE ---');

let totalTests = 0;
let passedTests = 0;

const installMemoryStorage = () => {
    const store = new Map();
    global.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear()
    };
    return store;
};

function runTest(name, fn) {
    totalTests++;
    console.log(`\nRunning Test ${totalTests}: ${name}`);
    try {
        if (fn()) passedTests++;
    } catch (e) {
        console.error(`${colors.fail}💥 CRASH: ${e.message}${colors.reset}`);
    }
}

// Test 1: Simple scaling
runTest('Simple scaling (1 ingredient, 2x)', () => {
    const recipes = [{
        id: 'chicken-stew',
        name: 'Chicken Stew',
        baseYield: 500,
        ingredients: [{ name: 'chicken', qty: 250, unit: 'g' }]
    }];
    const scales = { 'chicken-stew': 2 }; // factor = 2
    const res = calculateBOM(recipes, scales);
    return assert(res.demand['chicken-stew'] === 1000 && res.nodes['chicken-stew'].weight === 1000,
        'Correctly scaled base yield and node weight');
});

// Test 2: Unit conversion (metric)
runTest('Unit conversion (metric g -> kg)', () => {
    const res = formatQuantity(2500, 'g', 'metric');
    return assert(res.val === "2.5" && res.unit === "kg", 'Formatted 2500g to 2.5kg');
});

// Test 3: Unit conversion (imperial)
runTest('Unit conversion (imperial g -> lb)', () => {
    // 500g * 0.035274 = 17.637 oz
    // 17.637 / 16 = 1.102 lb
    const res = formatQuantity(500, 'g', 'imperial');
    return assert(res.val === "1.1" && res.unit === "lb", `Formatted 500g to 1.1lb (got ${res.val}${res.unit})`);
});

// Test 4: ChefRound (small units)
runTest('ChefRound (small units 0/5 rule)', () => {
    const res = chefRound(39, 'g');
    return assert(res === 40, 'Rounded 39g to 40g (0/5 rule)');
});

// Test 5: ChefRound (bulk units)
runTest('ChefRound (bulk units 0.1 step)', () => {
    const res = chefRound(2.34, 'kg');
    return assert(res === 2.3, 'Rounded 2.34kg to 2.3kg');
});

// Test 6: BOMEngine sub-recipe
runTest('BOMEngine sub-recipe demand without child scale mutation', () => {
    const recipes = [
        {
            id: 'sauce-a',
            name: 'Sauce A',
            baseYield: 1000,
            ingredients: [{ name: 'Stock B', qty: 500, unit: 'ml', sku: 'SKU-STOCK-B' }]
        },
        {
            id: 'stock-b',
            name: 'Stock B',
            sku: 'SKU-STOCK-B',
            baseYield: 500,
            ingredients: [{ name: 'Water', qty: 500, unit: 'ml' }]
        }
    ];
    const scales = { 'sauce-a': 2 };
    const res = calculateBOM(recipes, scales);

    if (!res.nodes['stock-b']) {
        return assert(false, 'Node "stock-b" missing from results');
    }

    return assert(
        res.nodes['stock-b'].scale === 0 &&
        res.nodes['stock-b'].demandWeight === 1000 &&
        res.nodes['stock-b'].shortageWeight === 1000,
        `Sub-recipe demand tracked without mutating child scale (scale ${res.nodes['stock-b'].scale}, demand ${res.nodes['stock-b'].demandWeight})`
    );
});

// Test 7: Edge case — zero quantity
runTest('Edge case — zero quantity', () => {
    const res = chefRound(0, 'g');
    return assert(res === 0, 'Zero returns zero');
});

// Test 8: Edge case — very large number
runTest('Edge case — very large number (auto-scale)', () => {
    const res = formatQuantity(50000, 'g', 'metric');
    return assert(res.val === "50" && res.unit === "kg", '50000g scales to 50kg');
});

// Test 9: Non-standard unit
runTest('Non-standard unit (passthrough + warning)', () => {
    console.log(`${colors.warn}Note: Expecting console warning below${colors.reset}`);
    const res = formatQuantity(100, 'gm', 'metric');
    return assert(res.val === "100" && res.unit === "gm", 'Non-standard "gm" passed through');
});

// Test 10: Settings portion sizing
runTest('Settings portion sizing (heuristics)', () => {
    const settings = { mainPortionSize: 300, sidePortionSize: 150, starterPortionSize: 100 };
    const res = getPortionWeight({ name: 'Side Salad', dishCategory: 'side' }, settings);
    return assert(res === 150, 'Heuristic mapping for "side" used sidePortionSize');
});

// Test 11: Yield Normalization Equivalence (Sauce with bulk units)
runTest('Yield Normalization Equivalence (Sauce with bulk units)', () => {
    const sauce = {
        id: 'magic-soy',
        name: 'Magic Soy Sauce',
        baseYield: 1.5,
        unit: 'kg',
        ingredients: [
            { name: 'Soy', qty: 1000, unit: 'ml' },
            { name: 'Sugar', qty: 500, unit: 'g' }
        ]
    };
    const settings = { portionsPerBatch: 6 };
    const standard = getStandardBatchYield(sauce, settings);
    const canonical = getCanonicalBatchYield(sauce);
    
    // Both should return 1500 (1.5kg * 1000)
    return assert(standard === 1500 && standard === canonical, 
        `Standard (${standard}) and Canonical (${canonical}) yields aligned at 1500g`);
});

runTest('Production batch uses source portion mass for portion-based mains', () => {
    const recipe = {
        id: 'katsu-curry',
        name: 'Katsu Curry',
        baseYield: 1,
        unit: 'Portion',
        dishStyle: 'fried',
        ingredients: [
            { name: 'Chicken Breast', qty: 220, unit: 'g' },
            { name: 'Panko', qty: 40, unit: 'g' },
            { name: 'Flour', qty: 30, unit: 'g' },
            { name: 'Egg', qty: 1, unit: 'pcs' },
            { name: 'Milk', qty: 50, unit: 'ml' },
            { name: 'Salt', qty: 2, unit: 'g' },
            { name: 'Black pepper', qty: 1, unit: 'g' },
            { name: 'Curry Roux', qty: 70, unit: 'g' },
            { name: 'Curry Vege Base', qty: 100, unit: 'g' },
            { name: 'Stock', qty: 280, unit: 'ml' },
            { name: 'Finish Butter', qty: 1, unit: 'g' },
            { name: 'Udon Base', qty: 1, unit: 'Portion' }
        ]
    };
    const settings = { portionsPerBatch: 50, mainPortionSize: 250 };
    const standard = getStandardBatchYield(recipe, settings);
    return assert(standard === 39800, `Katsu batch yield should be 39800g for 50 source portions (got ${standard})`);
});

runTest('Explicit ml yield remains baseline truth for prep sauces', () => {
    const recipe = {
        id: 'magic-soy',
        name: 'Magic Soy',
        baseYield: 11000,
        unit: 'ml',
        dishStyle: 'prep',
        ingredients: [
            { name: 'Light Soy', qty: 4000, unit: 'ml' },
            { name: 'Water', qty: 5000, unit: 'ml' },
            { name: 'Mirin', qty: 2000, unit: 'ml' },
            { name: 'Garlic puree', qty: 500, unit: 'g' },
            { name: 'Ginger puree', qty: 50, unit: 'g' },
            { name: 'Onion puree', qty: 500, unit: 'g' },
            { name: 'Pineapple puree', qty: 1000, unit: 'g' },
            { name: 'Sugar', qty: 200, unit: 'g' }
        ]
    };
    const baseline = getRecipeBaselineGrams(recipe, false, {});
    const standard = getStandardBatchYield(recipe, { portionsPerBatch: 50 });
    const canonical = getCanonicalBatchYield(recipe);
    return assert(
        baseline === 11000 && standard === 11000 && canonical === 11000,
        `Magic Soy baseline (${baseline}), standard (${standard}), and canonical (${canonical}) should all align at 11000ml`
    );
});

runTest('Explicit batch yield overrides stale base yield in recipe baseline truth', () => {
    const recipe = {
        id: 'batch-yield-ref',
        name: 'Batch Yield Sauce',
        baseYield: 1,
        batchYield: 1200,
        unit: 'ml',
        ingredients: [
            { name: 'Stock', qty: 800, unit: 'ml' },
            { name: 'Paste', qty: 400, unit: 'g' }
        ]
    };
    const baseline = getRecipeBaselineGrams(recipe, false, {});
    const canonical = getCanonicalBatchYield(recipe);

    return assert(
        baseline === 1200 && canonical === 1200,
        `Explicit batch yield should drive baseline truth (${JSON.stringify({ baseline, canonical })})`
    );
});

runTest('Recipe normalization carries recipe code aliases into app shape', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id',
            recipe_ref_id: 'recipe-ref-123',
            canonical_id: 'recipe-canon-123',
            name: 'Magic Soy',
            code: 'MS-001',
            cuisine: 'Pan-Asian',
            base_yield: 5000,
            unit: 'ml'
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.code === 'MS-001' &&
        normalized?.sku === 'MS-001' &&
        Array.isArray(normalized?.recipe_aliases) &&
        normalized.recipe_aliases.includes('MS-001') &&
        normalized.recipe_aliases.includes('recipe-ref-123'),
        `Expected normalized code aliases (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe normalization flags portion-based yield that still needs conversion reference', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-2',
            recipe_ref_id: 'recipe-ref-portion',
            name: 'Chicken Katsu',
            base_yield: 1,
            unit: 'portion',
            ingredients: [
                { name: 'Chicken Breast', qty: 220, unit: 'g' },
                { name: 'Sauce', qty: 60, unit: 'ml' }
            ]
        },
        clientId: 'cabij'
    });

    return assert(
        Array.isArray(normalized?.recipe_truth_flags)
        && normalized.recipe_truth_flags.includes('Portion-based yield needs conversion reference')
        && normalized.recipe_truth_status === 'warning',
        `Expected portion-based conversion warning (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe normalization keeps cuisine separate from dish category fallback', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-3',
            recipe_ref_id: 'recipe-ref-3',
            name: 'General Prep Base',
            dish_category: 'Foundation Prep',
            dish_style: 'Base',
            cuisine: '',
            base_yield: 1000,
            unit: 'ml',
            structured_recipe: JSON.stringify({
                recipe: {
                    name: 'General Prep Base',
                    ingredients: []
                }
            })
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.dishCategory === 'Foundation Prep'
        && normalized?.dishStyle === 'Base'
        && normalized?.cuisine === 'General',
        `Cuisine should not inherit dish category fallback (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe normalization supports additive direct-column metadata fields', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-4',
            recipe_ref_id: 'recipe-ref-4',
            name: 'Chili Oil Base',
            dish_category: 'foundation prep',
            dish_style: 'sauce prep',
            cuisine_type: 'pan asian',
            occasion: 'prep',
            ingredient_json: JSON.stringify([
                { name: 'Oil', qty: 1000, unit: 'ml' },
                { name: 'Chili Flake', qty: 80, unit: 'g' }
            ]),
            instructions: 'Warm oil\nInfuse chili\nCool and store',
            allergens: 'soy, sesame',
            notes: 'Keep chilled\nLabel with date',
            base_yield: 1000,
            unit: 'ml'
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.dishCategory === 'Foundation Prep'
        && normalized?.dishStyle === 'Sauce Prep'
        && normalized?.cuisine === 'Pan-Asian'
        && normalized?.occasion === 'Prep'
        && Array.isArray(normalized?.instructions)
        && normalized.instructions.length === 3
        && Array.isArray(normalized?.allergens)
        && normalized.allergens.includes('soy')
        && normalized.allergens.includes('sesame')
        && Array.isArray(normalized?.notes)
        && normalized.notes.includes('Keep chilled')
        && Array.isArray(normalized?.ingredients)
        && normalized.ingredients.length === 2,
        `Expected additive direct-column metadata support (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe normalization keeps direct editable columns authoritative over stale JSON duplicates', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-4b',
            recipe_ref_id: 'recipe-ref-4b',
            title: 'Direct Curry Base',
            recipe_code: 'CURRY-DIRECT',
            dish_category: 'service prep',
            dish_style: 'sauce prep',
            cuisine_type: 'pan asian',
            occasion: 'prep',
            base_yield: 1200,
            unit: 'g',
            yield_mode: 'batch_only',
            batch_yield: 1200,
            serving_size: 120,
            serving_kind: 'portion',
            portion_class: 'main',
            recorded_serving_weight: 140,
            recorded_serving_unit: 'g',
            production_strategy: 'fixed_batch',
            production_batch_size: 1200,
            ingredients: JSON.stringify([
                { name: 'Fresh Chili', qty: 120, unit: 'g' }
            ]),
            steps: JSON.stringify(['Toast', 'Blend', 'Store']),
            allergens: JSON.stringify(['soy']),
            recipe_json: JSON.stringify({
                name: 'Stale JSON Name',
                code: 'STALE-CODE',
                dishCategory: 'foundation prep',
                dishStyle: 'base',
                cuisine: 'French',
                occasion: 'service',
                baseYield: 800,
                unit: 'ml',
                yieldMode: 'portioned',
                batchYield: 800,
                servingSize: 80,
                servingKind: 'component_batch',
                portionClass: 'side',
                recordedServingWeight: 90,
                recordedServingUnit: 'ml',
                productionStrategy: 'dynamic_daily',
                productionBatchSize: 800,
                ingredients: [{ name: 'Old Chili', qty: 80, unit: 'g' }],
                instructions: ['Old step'],
                allergens: ['sesame']
            })
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.name === 'Direct Curry Base'
        && normalized?.title === 'Direct Curry Base'
        && normalized?.code === 'CURRY-DIRECT'
        && normalized?.dishCategory === 'Service'
        && normalized?.dishStyle === 'Sauce Prep'
        && normalized?.cuisine === 'Pan-Asian'
        && normalized?.occasion === 'Prep'
        && normalized?.baseYield === 1200
        && normalized?.unit === 'g'
        && normalized?.yieldMode === 'batch_only'
        && normalized?.batchYield === 1200
        && normalized?.servingSize === 120
        && normalized?.servingKind === 'portion'
        && normalized?.portionClass === 'main'
        && normalized?.recordedServingWeight === 140
        && normalized?.recordedServingUnit === 'g'
        && normalized?.productionStrategy === 'fixed_batch'
        && normalized?.productionBatchSize === 1200
        && Array.isArray(normalized?.instructions)
        && normalized.instructions.length === 3
        && Array.isArray(normalized?.ingredients)
        && normalized.ingredients[0]?.name === 'Fresh Chili'
        && Array.isArray(normalized?.allergens)
        && normalized.allergens.includes('soy')
        && !normalized.allergens.includes('sesame'),
        `Expected direct columns to override stale JSON duplicates (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe normalization preserves WF1 instruction rows and raw instruction text for UI read order', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-instruction-1',
            recipe_ref_id: 'recipe-ref-instruction-1',
            title: 'Instruction Rich Recipe',
            instruction_rows: JSON.stringify(['Step row one', 'Step row two']),
            instructions_raw: 'Raw instruction paragraph. Then another sentence.',
            base_yield: 24,
            unit: 'portion'
        },
        clientId: 'cabij'
    });

    return assert(
        Array.isArray(normalized?.instructionRows)
        && normalized.instructionRows[0] === 'Step row one'
        && normalized.instructionsRaw === 'Raw instruction paragraph. Then another sentence.',
        `Expected normalized recipe to preserve instruction rows and raw text (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe instruction display prefers WF2 recipe step rows over WF1 rows and raw recipe text', () => {
    const recipe = {
        instruction_rows: ['WF1 row one', 'WF1 row two'],
        instructions_raw: 'WF1 raw paragraph. Then second sentence.',
        instructions: ['Legacy row'],
        workflow2PrepProfile: {
            ui_output: {
                recipe_step_rows: ['WF2 first step', 'WF2 second step']
            }
        }
    };

    const normalized = normalizeRecipeInstructions(recipe);

    return assert(
        Array.isArray(normalized)
        && normalized.length === 2
        && normalized[0] === 'WF2 first step'
        && normalized[1] === 'WF2 second step',
        `Expected WF2 recipe step rows to win display order (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe instruction display falls back to WF1 instruction rows before raw paragraph text', () => {
    const recipe = {
        instruction_rows: ['WF1 row one', 'WF1 row two'],
        instructions_raw: 'Raw paragraph only. Then another sentence.'
    };

    const normalized = normalizeRecipeInstructions(recipe);

    return assert(
        Array.isArray(normalized)
        && normalized.length === 2
        && normalized[0] === 'WF1 row one'
        && normalized[1] === 'WF1 row two',
        `Expected WF1 instruction rows to outrank raw paragraph text (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe instruction display parses serialized raw JSON rows into clean steps instead of malformed fallback text', () => {
    const recipe = {
        instructions_raw: '["Toast bread","Blend filling","Store chilled"]',
        instructions: ['Legacy parsed row']
    };

    const normalized = normalizeRecipeInstructions(recipe);

    return assert(
        Array.isArray(normalized)
        && normalized.length === 3
        && normalized[0] === 'Toast bread'
        && normalized[2] === 'Store chilled',
        `Expected serialized raw JSON instruction text to normalize into clean rows (${JSON.stringify(normalized)})`
    );
});

runTest('Workflow2 prep UI prefers strict prep card rows and prep detail rows before legacy UI fallbacks', () => {
    const prepProfile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'prep-ref-1',
            client_id: 'cabij',
            ui_output: {
                prep_card_rows: ['Card row 1', 'Card row 2'],
                prep_detail_rows: ['Detail row 1', 'Detail row 2'],
                execution_steps: ['Legacy execution step'],
                task_bullets: ['Legacy card bullet']
            }
        },
        clientId: 'cabij'
    });

    const detailRows = resolveWorkflow2PrepDetailRows({
        prepProfile,
        methodProfile: null,
        fallbackProfile: null
    });
    const cardRows = resolveWorkflow2PrepCardRows({
        prepProfile,
        executionTaskRows: []
    });

    return assert(
        Array.isArray(detailRows)
        && detailRows[0]?.taskName === 'Detail row 1'
        && Array.isArray(cardRows)
        && cardRows[0] === 'Card row 1',
        `Expected strict prep UI rows to outrank legacy fallback rows (${JSON.stringify({ detailRows, cardRows })})`
    );
});

runTest('Workflow2 prep detail display keeps execution tasks as operational truth before prep detail rows', () => {
    const prepProfile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'prep-ref-2',
            client_id: 'cabij',
            regular_profile: {
                execution_tasks: [
                    { task_name: 'Operational truth row', estimated_minutes: 8 }
                ]
            },
            ui_output: {
                prep_detail_rows: ['UI detail fallback row']
            }
        },
        clientId: 'cabij'
    });

    const detailRows = resolveWorkflow2PrepDetailRows({
        prepProfile,
        methodProfile: prepProfile?.regularProfile,
        fallbackProfile: null
    });

    return assert(
        Array.isArray(detailRows)
        && detailRows.length === 1
        && detailRows[0]?.taskName === 'Operational truth row',
        `Expected execution tasks to stay operational truth above prep detail rows (${JSON.stringify(detailRows)})`
    );
});

runTest('Workflow2 prep detail rows preserve contract task metadata for Prep Board display', () => {
    const prepProfile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'prep-ref-2-contract-fields',
            client_id: 'cabij',
            regular_profile: {
                execution_tasks: [
                    {
                        sequence: 2,
                        task_name: 'Cook and season sushi rice',
                        action_type: 'cook_mix',
                        station: 'rice',
                        ingredient_refs: ['sushi_rice', 'rice_seasoning'],
                        quantity_text: '3 kg',
                        estimated_minutes: 20,
                        skill_level: 'basic',
                        equipment_required: ['rice cooker', 'mixing bowl'],
                        hold_rule: 'Cool to room temperature before rolling',
                        ccp_refs: ['cooling'],
                        critical_check_refs: ['rice_not_hot_when_rolled'],
                        completion_required: true
                    }
                ]
            }
        },
        clientId: 'cabij'
    });

    const detailRows = resolveWorkflow2PrepDetailRows({
        prepProfile,
        methodProfile: prepProfile?.regularProfile,
        fallbackProfile: null
    });
    const row = detailRows[0] || {};

    return assert(
        row.taskName === 'Cook and season sushi rice'
        && row.sequence === 2
        && row.quantityText === '3 kg'
        && row.holdRule === 'Cool to room temperature before rolling'
        && Array.isArray(row.equipmentRequired)
        && row.equipmentRequired.includes('rice cooker')
        && Array.isArray(row.ingredientRefs)
        && row.ingredientRefs.includes('sushi_rice')
        && Array.isArray(row.criticalCheckRefs)
        && row.criticalCheckRefs.includes('rice_not_hot_when_rolled'),
        `Expected WF2 execution task contract metadata to survive normalization (${JSON.stringify(row)})`
    );
});

runTest('Workflow2 prep detail display does not let helper board profile outrank execution tasks', () => {
    const prepProfile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'prep-ref-2b',
            client_id: 'cabij',
            regular_profile: {
                execution_tasks: [
                    {
                        sequence: 1,
                        task_name: 'Cook rice from execution task truth',
                        station: 'Rice',
                        action_type: 'cook_mix'
                    }
                ]
            },
            ui_output: {
                prep_board_profile: {
                    station_view: [
                        {
                            day_part: 'Before service',
                            station: 'Service',
                            tasks: [
                                { task_name: 'Stale helper board row' }
                            ]
                        }
                    ]
                }
            }
        },
        clientId: 'cabij'
    });

    const detailRows = resolveWorkflow2PrepDetailRows({
        prepProfile,
        methodProfile: prepProfile?.regularProfile,
        fallbackProfile: null
    });

    return assert(
        Array.isArray(detailRows)
        && detailRows.length === 1
        && detailRows[0]?.taskName === 'Cook rice from execution task truth'
        && detailRows[0]?.station === 'Rice',
        `Expected execution task truth to outrank non-contract helper board profile (${JSON.stringify(detailRows)})`
    );
});

runTest('Saved prep day-part view should use saved lanes when live lanes are empty', () => {
    const liveMorningBoard = {
        phaseKey: 'morning',
        label: 'Morning',
        lanes: [],
        totalTasks: 0
    };
    const savedMorningBoard = {
        phaseKey: 'morning',
        label: 'Morning',
        lanes: [
            {
                category: 'Rice',
                rows: [{ recipeKey: 'ginger-sauce', title: 'Ginger Teriyaki Sauce' }]
            }
        ],
        totalRows: 1
    };
    const focusedLiveLaneCount = Array.isArray(liveMorningBoard?.lanes) ? liveMorningBoard.lanes.length : 0;
    const savedLaneCount = Array.isArray(savedMorningBoard?.lanes) ? savedMorningBoard.lanes.length : 0;
    const hasFocusedLiveRows = focusedLiveLaneCount > 0 && Number(liveMorningBoard?.totalTasks || 0) > 0;
    const hasSavedRows = savedLaneCount > 0 && Number(savedMorningBoard?.totalRows || 0) > 0;
    const usingSavedPhaseBoard = !hasFocusedLiveRows && hasSavedRows;
    const resolvedFocusedDayPartBoard = usingSavedPhaseBoard
        ? savedMorningBoard
        : liveMorningBoard;

    return assert(
        usingSavedPhaseBoard === true
        && resolvedFocusedDayPartBoard?.lanes?.[0]?.rows?.[0]?.title === 'Ginger Teriyaki Sauce',
        `Expected saved-plan Morning lanes to render when live Morning board is empty (${JSON.stringify({ usingSavedPhaseBoard, resolvedFocusedDayPartBoard })})`
    );
});

runTest('Training support stays tied to live recipe truth fields instead of static SOP copy', () => {
    const recipe = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-4c',
            recipe_ref_id: 'recipe-ref-4c',
            title: 'Sesame Carrot Plate',
            recipe_code: 'CR-204',
            dish_category: 'service',
            dish_style: 'modern',
            cuisine_type: 'mediterranean',
            base_yield: 24,
            unit: 'portion',
            allergens: 'sesame, dairy',
            instructions: 'Char the carrots\nPlate with cold labneh\nFinish with seed crunch',
            structured_recipe: JSON.stringify({
                recipe: {
                    scalingTips: {
                        prepIntelligence: {
                            leadTime: 'Afternoon',
                            prepTimeMinutes: 18,
                            handoffNote: 'Keep the char visible at pass.'
                        },
                        notes: [{ title: 'Texture', body: 'Do not over-sauce the plate.' }]
                    }
                }
            })
        },
        clientId: 'cabij'
    });

    const training = buildRecipeTrainingSupport(recipe, { currentYieldValue: 36 });

    return assert(
        training?.title === 'Sesame Carrot Plate'
        && training?.versionLabel === 'CR-204'
        && training?.stationLabel === 'Service'
        && training?.allergenLabel === 'Sesame, Dairy'
        && training?.yieldLabel === '36 portion'
        && training?.readinessLabel === 'Ready for staff'
        && training?.reviewLabel === '18 min review'
        && training?.pendingCount === 0
        && Array.isArray(training?.stepCards)
        && training.stepCards.length === 3
        && training.stepCards[0]?.title === 'Char with control'
        && training.stepCards[0]?.copy === 'Char the carrots'
        && Array.isArray(training?.focusCards)
        && training.focusCards[0]?.badge === 'Ready for staff'
        && training.focusCards.some((card) => card?.copy === 'Keep the char visible at pass.')
        && Array.isArray(training?.proofCards)
        && training.proofCards[0]?.copy.includes('CR-204')
        && training.proofCards[2]?.badge === 'Afternoon',
        `Expected training support to derive from live recipe truth (${JSON.stringify(training)})`
    );
});

runTest('Staff training execution support tracks step completion and readiness honestly', () => {
    const support = buildRecipeTrainingExecutionSupport({
        title: 'Sesame Carrot Plate',
        recipe_code: 'CR-204',
        recipe_truth_status: 'trusted',
        allergens: 'sesame',
        unit: 'portion',
        base_yield: 24,
        instructions: 'Char the carrots\nPlate with cold labneh',
        structured_recipe: {
            recipe: {
                scalingTips: {
                    prepIntelligence: {
                        leadTime: 'Afternoon',
                        makeAhead: 'Same day only',
                        storageWindow: '24 hours',
                        handoffNote: 'Keep the char visible at pass.'
                    }
                }
            }
        }
    }, {
        currentYieldValue: 24,
        session: {
            traineeLabel: 'Chef Mina',
            completedSteps: [1],
            acknowledgements: {
                truth: true,
                allergen: false,
                handoff: true
            }
        }
    });

    return assert(
        support?.traineeLabel === 'Chef Mina'
        && support?.completedStepCount === 1
        && support?.totalStepCount === 2
        && support?.completionPercent === 60
        && support?.canComplete === false
        && support?.readinessBadge === 'Ready',
        `Expected training execution support to track progress honestly (${JSON.stringify(support)})`
    );
});

runTest('Staff training execution support blocks completion when recipe truth is blocked', () => {
    const support = buildRecipeTrainingExecutionSupport({
        title: 'Blocked Curry Base',
        recipe_truth_status: 'blocked',
        recipe_truth_flags: ['Recipe truth is blocked pending review.'],
        instructions: 'Blend\nCook'
    }, {
        session: {
            completedSteps: [1, 2],
            acknowledgements: {
                truth: true,
                allergen: true,
                handoff: true
            }
        }
    });

    return assert(
        support?.readinessState === 'blocked'
        && support?.canComplete === false
        && support?.readinessBadge === 'Blocked',
        `Expected blocked recipe truth to stop lesson completion (${JSON.stringify(support)})`
    );
});

runTest('Manager training support becomes review-ready only after assigned staff complete the current lesson revision', () => {
    const support = buildRecipeTrainingManagerSupport({
        title: 'Sesame Carrot Plate',
        recipe_code: 'CR-204',
        recipe_truth_status: 'trusted',
        updated_at: '2026-04-17T09:00:00.000Z',
        allergens: 'sesame',
        instructions: 'Char the carrots\nPlate with cold labneh'
    }, {
        session: {
            traineeLabel: 'Chef Mina',
            assignedStaff: ['Chef Mina'],
            assignedAt: '2026-04-17T09:05:00.000Z',
            assignedBy: 'Chef Lead',
            completedAt: '2026-04-17T09:24:00.000Z',
            completedBy: 'Chef Mina',
            completedVersionLabel: 'CR-204',
            completedRevisionToken: '2026-04-17T09:00:00.000Z',
            completedSteps: [1, 2],
            acknowledgements: {
                truth: true,
                allergen: true,
                handoff: true
            }
        }
    });

    return assert(
        support?.hasAssignment === true
        && support?.reviewState === 'ready_for_review'
        && support?.reviewBadge === 'Ready to sign off'
        && support?.canReview === true,
        `Expected manager support to wait for assigned lesson completion before sign-off (${JSON.stringify(support)})`
    );
});

runTest('Manager training support triggers retraining when recipe revision changes after sign-off', () => {
    const support = buildRecipeTrainingManagerSupport({
        title: 'Sesame Carrot Plate',
        recipe_code: 'CR-204',
        recipe_truth_status: 'trusted',
        updated_at: '2026-04-18T11:00:00.000Z',
        allergens: 'sesame',
        instructions: 'Char the carrots\nPlate with cold labneh'
    }, {
        session: {
            traineeLabel: 'Chef Mina',
            assignedStaff: ['Chef Mina'],
            completedAt: '2026-04-17T09:24:00.000Z',
            completedBy: 'Chef Mina',
            completedVersionLabel: 'CR-204',
            completedRevisionToken: '2026-04-17T09:00:00.000Z',
            reviewedAt: '2026-04-17T09:40:00.000Z',
            reviewedBy: 'Chef Lead',
            reviewedVersionLabel: 'CR-204',
            reviewedRevisionToken: '2026-04-17T09:00:00.000Z',
            completedSteps: [1, 2],
            acknowledgements: {
                truth: true,
                allergen: true,
                handoff: true
            }
        }
    });

    return assert(
        support?.retrainingRequired === true
        && support?.reviewState === 'retraining_required'
        && support?.reviewBadge === 'Retraining required',
        `Expected manager support to force retraining when the live recipe revision changes (${JSON.stringify(support)})`
    );
});

runTest('Training readiness workspace groups recipe visibility by recipe and station', () => {
    const workspace = buildTrainingReadinessWorkspace([
        {
            title: 'Sauce Base',
            recipe_code: 'SB-101',
            recipe_truth_status: 'trusted',
            updated_at: '2026-04-17T09:00:00.000Z',
            dishStyle: 'Sauce Prep',
            instructions: 'Blend\nStore'
        },
        {
            title: 'Cold Slaw',
            recipe_code: 'CS-102',
            recipe_truth_status: 'trusted',
            updated_at: '2026-04-17T09:00:00.000Z',
            dishStyle: 'Cold Dish',
            instructions: 'Slice\nDress'
        },
        {
            title: 'Blocked Curry',
            recipe_code: 'BC-103',
            recipe_truth_status: 'blocked',
            recipe_truth_flags: ['Truth blocked'],
            updated_at: '2026-04-17T09:00:00.000Z',
            dishStyle: 'Sauce Prep',
            instructions: 'Cook\nHold'
        }
    ], {
        'SB-101': {
            assignedStaff: ['Chef Mina'],
            reviewedAt: '2026-04-17T09:40:00.000Z',
            reviewedBy: 'Chef Lead',
            reviewedVersionLabel: 'SB-101',
            reviewedRevisionToken: '2026-04-17T09:00:00.000Z',
            completedAt: '2026-04-17T09:20:00.000Z',
            completedBy: 'Chef Mina',
            completedVersionLabel: 'SB-101',
            completedRevisionToken: '2026-04-17T09:00:00.000Z',
            completedSteps: [1, 2],
            acknowledgements: { truth: true, allergen: true, handoff: true }
        },
        'CS-102': {
            assignedStaff: ['Chef Ali'],
            completedSteps: [1],
            acknowledgements: { truth: true, allergen: false, handoff: false }
        }
    }, {
        now: new Date('2026-04-18T09:00:00.000Z')
    });

    return assert(
        workspace?.counts?.trained === 1
        && workspace?.counts?.blocked === 1
        && workspace?.counts?.notReady === 1
        && Array.isArray(workspace?.stationGroups)
        && workspace.stationGroups[0]?.label === 'Sauce Prep'
        && workspace.stationGroups[0]?.blocked === 1
        && workspace.stationGroups[0]?.trained === 1,
        `Expected training readiness workspace to group counts by recipe and station (${JSON.stringify(workspace)})`
    );
});

runTest('Prep profile normalization keeps generated review metadata available to the UI', () => {
    const normalized = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'BEEF_BULGOGI_KIMBAP__cabij',
            client_id: 'cabij',
            review_required: true,
            review_summary: 'Low confidence in CCP and task detail.',
            low_confidence_fields: JSON.stringify([
                {
                    field_path: 'food_safety_ccp',
                    field_label: 'Food safety CCP',
                    score: 0.54,
                    reason_text: 'Weak CCP evidence.'
                }
            ]),
            knowledge_status: 'review_required',
            approval_level: 'generated',
            validated_by: 'Chef Lead',
            validated_at: '2026-04-22T12:00:00.000Z',
            knowledge_links: JSON.stringify({
                chef_operational_rules: ['rule-1']
            })
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.reviewRequired === true
        && normalized?.reviewSummary === 'Low confidence in CCP and task detail.'
        && Array.isArray(normalized?.lowConfidenceFields)
        && normalized.lowConfidenceFields.length === 1
        && normalized?.knowledgeStatus === 'review_required'
        && normalized?.approvalLevel === 'generated'
        && normalized?.validatedBy === 'Chef Lead'
        && normalized?.knowledgeLinks?.chef_operational_rules?.[0] === 'rule-1',
        `Expected prep profile normalization to preserve generated review metadata (${JSON.stringify(normalized)})`
    );
});

runTest('Generated profile review state summarizes low-confidence workflow issues and tracked changes', () => {
    const workflow2Profile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'BEEF_BULGOGI_KIMBAP__cabij',
            client_id: 'cabij',
            review_required: true,
            review_summary: 'Low confidence in CCP and task detail.',
            low_confidence_fields: JSON.stringify([
                {
                    field_path: 'food_safety_ccp',
                    field_label: 'Food safety CCP',
                    score: 0.54,
                    reason_text: 'Weak CCP evidence.'
                }
            ]),
            review_queue: JSON.stringify([
                {
                    id: 'queue-1',
                    field_path: 'food_safety_ccp',
                    field_label: 'Food safety CCP',
                    status: 'pending',
                    confidence_score: 0.54,
                    reason_text: 'Weak CCP evidence.'
                }
            ]),
            change_log: JSON.stringify([
                {
                    id: 'change-1',
                    field_path: 'critical_checks',
                    change_reason: 'Chef tightened the quality check wording.',
                    changed_by: 'Chef Mina',
                    created_at: '2026-04-22T12:10:00.000Z'
                }
            ])
        },
        clientId: 'cabij'
    });
    const workflow3Profile = normalizeRecipeExtendedProfileRecord({
        row: {
            recipe_ref_id: 'BEEF_BULGOGI_KIMBAP__cabij',
            client_id: 'cabij',
            manager_review_required: true
        },
        clientId: 'cabij'
    });

    const reviewState = buildGeneratedProfileReviewState({
        title: 'BEEF BULGOGI KIMBAP',
        workflow2PrepProfile: workflow2Profile,
        workflow3ExtendedProfile: workflow3Profile
    });

    return assert(
        reviewState?.hasSignals === true
        && reviewState?.reviewRequired === true
        && reviewState?.pendingQueueCount === 1
        && reviewState?.historyCount === 1
        && reviewState?.fieldPreview?.[0]?.fieldLabel === 'Food safety CCP'
        && reviewState?.badge === 'Review before use',
        `Expected generated profile review state to summarize live workflow review issues (${JSON.stringify(reviewState)})`
    );
});

runTest('Generated profile review state respects large-profile fallback labeling for prep risk', () => {
    const workflow2Profile = normalizeRecipePrepProfileRecord({
        row: {
            recipe_ref_id: 'BEEF_BULGOGI_KIMBAP__cabij',
            client_id: 'cabij',
            confidence_scores: JSON.stringify({
                prep_profile: 0.61
            })
        },
        clientId: 'cabij'
    });

    const reviewState = buildGeneratedProfileReviewState({
        title: 'BEEF BULGOGI KIMBAP',
        workflow2PrepProfile: workflow2Profile
    }, {
        activePrepProfile: 'large'
    });

    return assert(
        reviewState?.fieldPreview?.[0]?.fieldLabel === 'Large prep task rows'
        && reviewState?.fieldPreview?.[0]?.fieldPath === 'large_profile.execution_tasks',
        `Expected generated profile fallback review labeling to respect the active large profile (${JSON.stringify(reviewState)})`
    );
});

runTest('Training readiness workspace marks older signed-off lessons as expiring', () => {
    const oldReviewDate = new Date(Date.now() - (16 * 24 * 60 * 60 * 1000)).toISOString();
    const workspace = buildTrainingReadinessWorkspace([
        {
            title: 'Pastry Cream',
            recipe_code: 'PC-200',
            recipe_truth_status: 'trusted',
            updated_at: '2026-04-01T09:00:00.000Z',
            station: 'Pastry',
            instructions: 'Whisk\nChill'
        }
    ], {
        'PC-200': {
            assignedStaff: ['Chef Roya'],
            reviewedAt: oldReviewDate,
            reviewedBy: 'Chef Lead',
            reviewedVersionLabel: 'PC-200',
            reviewedRevisionToken: '2026-04-01T09:00:00.000Z',
            completedAt: oldReviewDate,
            completedBy: 'Chef Roya',
            completedVersionLabel: 'PC-200',
            completedRevisionToken: '2026-04-01T09:00:00.000Z',
            completedSteps: [1, 2],
            acknowledgements: { truth: true, allergen: true, handoff: true }
        }
    });

    return assert(
        workspace?.counts?.expiring === 1
        && workspace?.recipeRows?.[0]?.readinessState === 'expiring'
        && workspace?.summaryCards?.[3]?.count === '1',
        `Expected old sign-off to move into expiring visibility (${JSON.stringify(workspace)})`
    );
});

runTest('Auth scope trusts canonical live profile and enables safe live operations', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager'
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.ONLINE
    });

    return assert(
        authScope?.status === 'trusted'
        && authScope?.canReadLiveRecipes === true
        && authScope?.canQueueRecipeEdits === true
        && authScope?.canApproveRecipeSync === true
        && authScope?.canSyncUpstream === true,
        `Expected canonical profile auth scope to stay trusted (${JSON.stringify(authScope)})`
    );
});

runTest('Auth scope downgrades offline fallback profiles to read-only client safety mode', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            offline_ready: true,
            profileSnapshot: {
                client_id: 'cabij',
                role: 'manager'
            }
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.OFFLINE
    });

    return assert(
        authScope?.status === 'offline-fallback'
        && authScope?.canReadCachedRecipes === true
        && authScope?.canReadLiveRecipes === false
        && authScope?.canQueueRecipeEdits === false
        && authScope?.canSyncUpstream === false,
        `Expected offline fallback auth scope to stay read-only (${JSON.stringify(authScope)})`
    );
});

runTest('Auth scope allows live recipe reads for metadata fallback while keeping writes blocked', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager',
            profileSnapshot: {
                id: 'profile-1',
                client_id: 'cabij',
                role: 'manager'
            }
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.ONLINE
    });

    return assert(
        authScope?.status === 'profile-review'
        && authScope?.canReadLiveRecipes === true
        && authScope?.canReadCachedRecipes === true
        && authScope?.canQueueRecipeEdits === false
        && authScope?.canApproveRecipeSync === false
        && authScope?.canSyncUpstream === false,
        `Expected metadata fallback auth scope to allow read-only live recipe access (${JSON.stringify(authScope)})`
    );
});

runTest('Auth scope blocks mismatched client scope before recipe truth can load or sync', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            profileSnapshot: {
                client_id: 'wrong-client',
                role: 'manager'
            }
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.ONLINE
    });

    return assert(
        authScope?.status === 'blocked'
        && authScope?.canReadLiveRecipes === false
        && authScope?.canQueueRecipeEdits === false
        && authScope?.canApproveRecipeSync === false
        && authScope?.reason?.includes('do not match'),
        `Expected mismatched client scope to block recipe truth operations (${JSON.stringify(authScope)})`
    );
});

runTest('Role workspace config routes staff into low-noise execution defaults', () => {
    const config = buildRoleWorkspaceConfig({
        normalizedRole: 'staff',
        canApproveSync: false,
        identitySessionState: {
            canUsePrivilegedWorkspace: true
        }
    });

    return assert(
        config?.defaultView === 'board'
        && config?.startView === 'board'
        && Array.isArray(config?.allowedViews)
        && config.allowedViews.includes('presentation')
        && !config.allowedViews.includes('manager')
        && !config.allowedViews.includes('ordering'),
        `Expected staff workspace config to default to prep and hide manager/owner views (${JSON.stringify(config)})`
    );
});

runTest('Role workspace config keeps manager and owner defaults inside the shared shell', () => {
    const managerConfig = buildRoleWorkspaceConfig({
        normalizedRole: 'manager',
        canApproveSync: true,
        identitySessionState: {
            canUsePrivilegedWorkspace: true
        }
    });
    const ownerConfig = buildRoleWorkspaceConfig({
        normalizedRole: 'owner',
        canApproveSync: true,
        identitySessionState: {
            canUsePrivilegedWorkspace: true
        }
    });

    return assert(
        managerConfig?.defaultView === 'scaler'
        && managerConfig.allowedViews.includes('manager')
        && ownerConfig?.defaultView === 'ordering'
        && ownerConfig.allowedViews.includes('ordering')
        && ownerConfig.allowedViews.includes('manager'),
        `Expected manager and owner configs to keep shared-shell defaults (${JSON.stringify({ managerConfig, ownerConfig })})`
    );
});

runTest('Identity session state trusts canonical signed-in kitchen identity', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager',
            full_name: 'Chef Teo'
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.ONLINE
    });
    const identityState = buildIdentitySessionState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager',
            full_name: 'Chef Teo'
        },
        sessionUser: {
            id: 'profile-1',
            email: 'chef@cabij.co'
        },
        authScopeState: authScope
    });

    return assert(
        identityState?.status === 'trusted'
        && identityState?.canUsePrivilegedWorkspace === true
        && identityState?.displayName === 'Chef Teo',
        `Expected canonical signed-in identity to stay trusted (${JSON.stringify(identityState)})`
    );
});

runTest('Identity session state blocks privileged role surfaces when signed-in user and profile do not match', () => {
    const authScope = buildAuthScopeState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager',
            full_name: 'Chef Teo'
        },
        clientId: 'cabij',
        connectionState: OFFLINE_STATE.ONLINE
    });
    const identityState = buildIdentitySessionState({
        userProfile: {
            id: 'profile-1',
            client_id: 'cabij',
            role: 'manager',
            full_name: 'Chef Teo'
        },
        sessionUser: {
            id: 'different-user',
            email: 'other@cabij.co'
        },
        authScopeState: authScope
    });
    const workspaceConfig = buildRoleWorkspaceConfig({
        normalizedRole: 'manager',
        canApproveSync: true,
        identitySessionState: identityState
    });

    return assert(
        identityState?.status === 'blocked'
        && identityState?.canUsePrivilegedWorkspace === false
        && workspaceConfig?.workspaceType === 'staff'
        && workspaceConfig?.defaultView === 'board',
        `Expected mismatched sign-in identity to downgrade privileged role entry (${JSON.stringify({ identityState, workspaceConfig })})`
    );
});

runTest('Operational state copy explains degraded auth loading state clearly', () => {
    const copy = buildOperationalStateCopy({
        kind: 'loading',
        authScopeState: {
            isDegraded: true,
            label: 'Offline auth fallback',
            tone: 'gold',
            reason: 'Offline fallback profile is active. Read-only mode protects recipe truth until live auth returns.'
        }
    });

    return assert(
        copy?.title === 'Offline auth fallback'
        && copy?.tone === 'gold'
        && copy?.body.includes('Read-only mode protects recipe truth'),
        `Expected loading state copy to explain degraded auth scope (${JSON.stringify(copy)})`
    );
});

runTest('Operational state copy makes missing instructions explicit for training safety', () => {
    const copy = buildOperationalStateCopy({ kind: 'instructions-empty' });

    return assert(
        copy?.title === 'Instructions missing'
        && copy?.tone === 'gold'
        && copy?.body.includes('staff training or handoff'),
        `Expected instruction-empty state copy to stay operationally explicit (${JSON.stringify(copy)})`
    );
});

runTest('Operational observability surfaces live fetch stalls with a next action', () => {
    const items = buildOperationalObservabilityItems({
        offlineDataState: {
            source: 'supabase-transport-hang',
            reason: 'Supabase request exceeded 8000ms without a response.'
        }
    });

    return assert(
        Array.isArray(items)
        && items[0]?.title === 'Live fetch stalled'
        && items[0]?.body.includes('8000ms')
        && items[0]?.action.includes('cached recipe truth'),
        `Expected observability items to explain fetch stalls (${JSON.stringify(items)})`
    );
});

runTest('Operational observability surfaces sync failures and queue guidance clearly', () => {
    const items = buildOperationalObservabilityItems({
        syncNotice: {
            tone: 'error',
            message: '2 recipe edits synced. 1 failed and 1 conflict remain local.'
        }
    });

    return assert(
        Array.isArray(items)
        && items[0]?.title === 'Sync attention'
        && items[0]?.body.includes('conflict remain local')
        && items[0]?.action.includes('Approvals'),
        `Expected observability items to explain sync failures (${JSON.stringify(items)})`
    );
});

runTest('Recipe operational index precomputes reusable export and planning truth', () => {
    const recipes = [
        {
            id: 'recipe-1',
            name: 'Sesame Carrot Plate',
            dishStyle: 'Service',
            cuisine: 'Modern Korean',
            code: 'CR-204'
        },
        {
            id: 'recipe-2',
            title: 'Stock Base',
            style: 'Foundation Prep',
            category: 'Base'
        }
    ];

    const index = buildRecipeOperationalIndex(recipes, {
        getRecipeKey: (recipe) => recipe.id,
        getPlanningDefaults: (recipe) => (
            recipe.id === 'recipe-1'
                ? { standardBatchYield: 24, defaultTargetYield: 36 }
                : { standardBatchYield: 10, defaultTargetYield: 20 }
        )
    });

    return assert(
        Array.isArray(index?.orderedKeys)
        && index.orderedKeys.length === 2
        && index.orderedKeys[0] === 'recipe-1'
        && index.byKey?.['recipe-1']?.title === 'Sesame Carrot Plate'
        && index.byKey?.['recipe-1']?.style === 'Service'
        && index.byKey?.['recipe-1']?.cuisine === 'Modern Korean'
        && index.byKey?.['recipe-1']?.code === 'CR-204'
        && index.byKey?.['recipe-1']?.standardBatchYield === 24
        && index.byKey?.['recipe-1']?.defaultTargetYield === 36
        && index.byKey?.['recipe-2']?.title === 'Stock Base'
        && index.byKey?.['recipe-2']?.style === 'Foundation Prep'
        && index.byKey?.['recipe-2']?.cuisine === 'Base',
        `Expected operational index to cache recipe identity and planning truth (${JSON.stringify(index)})`
    );
});

runTest('Recipe normalization preserves legacy recipe_json compatibility', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-5',
            recipe_ref_id: 'recipe-ref-5',
            recipe_json: JSON.stringify({
                name: 'Legacy Curry Paste',
                ingredients: [
                    { name: 'Shallot', qty: 200, unit: 'g' }
                ],
                instructions: ['Blend', 'Cook'],
                dishStyle: 'base',
                dishCategory: 'foundation prep'
            }),
            base_yield: 500,
            unit: 'g'
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.name === 'Legacy Curry Paste'
        && normalized?.dishStyle === 'Base'
        && normalized?.dishCategory === 'Foundation Prep'
        && Array.isArray(normalized?.instructions)
        && normalized.instructions.length === 2
        && Array.isArray(normalized?.ingredients)
        && normalized.ingredients[0]?.name === 'Shallot',
        `Expected legacy recipe_json compatibility (${JSON.stringify(normalized)})`
    );
});

runTest('Recipe taxonomy canonicalizes obvious style, category, and cuisine synonyms', () => {
    return assert(
        canonicalizeRecipeTaxonomy('style', 'sauce-prep') === 'Sauce Prep'
        && canonicalizeRecipeTaxonomy('style', 'foundation prep') === 'Base'
        && canonicalizeRecipeTaxonomy('category', 'service prep') === 'Service'
        && canonicalizeRecipeTaxonomy('cuisine', 'pan asian') === 'Pan-Asian',
        'Expected taxonomy synonym cleanup to normalize common label drift'
    );
});

runTest('BOMEngine resolves recipe_ref_id aliases while preserving node identity', () => {
    const recipes = [
        {
            recipe_ref_id: 'magic-soy-ref',
            canonical_id: 'magic-soy-canon',
            name: 'Magic Soy',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Soy', qty: 1000, unit: 'ml' }]
        }
    ];
    const res = calculateBOM(recipes, { 'magic-soy-ref': 1.5 });
    return assert(
        res.nodes['magic-soy-ref']?.weight === 1500 &&
        res.nodes['magic-soy-ref']?.portions > 0,
        `recipe_ref_id alias produced a stable BOM node (${JSON.stringify(res.nodes['magic-soy-ref'])})`
    );
});

runTest('BOMEngine accumulates child demand when the root scale uses recipe_ref_id aliases', () => {
    const recipes = [
        {
            recipe_ref_id: 'sauce-ref',
            canonical_id: 'sauce-canon',
            name: 'Prep Sauce',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_ref_id: 'stock-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const res = calculateBOM(recipes, { 'sauce-ref': 2 });
    return assert(
        res.nodes['stock-ref']?.scale === 0 &&
        res.nodes['stock-ref']?.demandWeight === 1000 &&
        res.nodes['stock-ref']?.shortageWeight === 1000,
        `recipe_ref_id child demand should accumulate without mutating child scale (${JSON.stringify(res.nodes['stock-ref'])})`
    );
});

runTest('BOMEngine blocks cross-domain child demand when ingredient unit mismatches child yield domain', () => {
    const recipes = [
        {
            recipe_ref_id: 'mismatch-parent-ref',
            canonical_id: 'mismatch-parent-canon',
            name: 'Mismatch Sauce',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Powder Base', recipe_ref_id: 'powder-base-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'powder-base-ref',
            canonical_id: 'powder-base-canon',
            name: 'Powder Base',
            baseYield: 1000,
            unit: 'g',
            ingredients: [{ name: 'Powder', qty: 1000, unit: 'g' }]
        }
    ];
    const res = calculateBOM(recipes, { 'mismatch-parent-ref': 1 });

    return assert(
        !res.nodes['powder-base-ref'] || res.nodes['powder-base-ref']?.demandWeight === 0,
        `Cross-domain child demand should not be counted as safe BOM truth (${JSON.stringify(res.nodes['powder-base-ref'])})`
    );
});

runTest('Production task engine groups active recipe targets by station', () => {
    const recipes = [
        {
            id: 'katsu-curry',
            name: 'Katsu Curry',
            dishStyle: 'fried protein',
            baseYield: 10,
            unit: 'portion',
            ingredients: [{ name: 'Curry Base', recipe_ref_id: 'curry-base', qty: 2, unit: 'kg' }]
        },
        {
            recipe_ref_id: 'curry-base',
            name: 'Curry Base',
            dishStyle: 'sauce prep',
            baseYield: 5,
            unit: 'kg',
            ingredients: [{ name: 'Stock', qty: 5, unit: 'kg' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'katsu-curry': 30, 'curry-base': 5 },
        portionsPerBatch: 10
    });

    return assert(
        plan.totalTasks === 2 &&
        plan.grouped['Hot Line']?.length === 1 &&
        plan.grouped['Sauce Prep']?.length === 1,
        `Expected Hot Line and Sauce Prep groups (${Object.keys(plan.grouped).join(', ')})`
    );
});

runTest('Production task engine assigns schedule phases from recipe truth', () => {
    const recipes = [
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Chicken Stock',
            dishStyle: 'stock',
            baseYield: 4000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 4000, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'katsu-ref',
            canonical_id: 'katsu-canon',
            name: 'Katsu Cutlet',
            dishStyle: 'fried protein',
            baseYield: 10,
            unit: 'portion',
            ingredients: [{ name: 'Chicken', qty: 10, unit: 'pcs' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'stock-ref': 4000, 'katsu-ref': 20 },
        portionsPerBatch: 10
    });
    const stockTask = plan.tasks.find((item) => item.recipeKey === 'stock-ref');
    const katsuTask = plan.tasks.find((item) => item.recipeKey === 'katsu-ref');

    return assert(
        stockTask?.schedulePhase === 'Foundation Prep' &&
        katsuTask?.schedulePhase === 'Service Finish',
        `Expected foundation/service phases (${JSON.stringify(plan.tasks.map((task) => ({ key: task.recipeKey, phase: task.schedulePhase })))})`
    );
});

runTest('Production task engine exposes prep-board metadata for station, dish, execution, and scaling logic', () => {
    const recipes = [
        {
            recipe_ref_id: 'bulgogi-ref',
            canonical_id: 'bulgogi-canon',
            name: 'Bulgogi Beef',
            dishStyle: 'main beef',
            dishCategory: 'main dish',
            cuisine: 'Korean',
            occasion: 'Main',
            baseYield: 20,
            unit: 'portion',
            tools: ['Slicer', 'Hotel pan'],
            instructions: [
                'Slice beef to 3mm.',
                'Marinate evenly.',
                'Label and hold cold.'
            ],
            ingredients: [
                { name: 'Beef', qty: 10, unit: 'kg' },
                { name: 'Bulgogi Marinade', qty: 2, unit: 'kg' }
            ]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'bulgogi-ref': 20 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'bulgogi-ref');

    return assert(
        task?.time_block === 'before_service'
        && typeof task?.station_group === 'string'
        && task.station_group.length > 0
        && typeof task?.dish_group === 'string'
        && task.dish_group.length > 0
        && Array.isArray(task?.execution_steps)
        && task.execution_steps.length > 0
        && Array.isArray(task?.checklist)
        && Array.isArray(task?.critical_checks)
        && Array.isArray(task?.equipment)
        && task?.basic_output?.recipe_name === 'Bulgogi Beef'
        && task?.smart_data?.yield_portions === 20
        && task?.context_tags?.cuisine === 'Korean'
        && task?.scaling_logic?.active_method === 'normal',
        `Expected prep-board metadata contract on production task (${JSON.stringify(task)})`
    );
});

runTest('Production task engine switches to batch method when prep exceeds 50 portions', () => {
    const recipes = [
        {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Chicken Curry',
            dishStyle: 'main curry',
            dishCategory: 'main dish',
            baseYield: 10,
            unit: 'portion',
            instructions: [
                'Dice chicken to 2cm.',
                'Cook sauce base.',
                'Finish in service pans.'
            ],
            ingredients: [
                { name: 'Chicken', qty: 5, unit: 'kg' }
            ]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'curry-ref': 80 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'curry-ref');

    return assert(
        task?.estimatedPortions === 80
        && task?.methodVariant === 'batch'
        && task?.scaling_logic?.active_method === 'batch'
        && task?.execution_steps?.length > 0,
        `Expected batch prep method over 50 portions (${JSON.stringify(task)})`
    );
});

runTest('Production task engine preserves sub-recipe dependency sequence without writes', () => {
    const recipes = [
        {
            recipe_ref_id: 'sauce-ref',
            canonical_id: 'sauce-canon',
            clean_name: 'Prep Sauce',
            name: 'Prep Sauce',
            dishStyle: 'sauce',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_ref_id: 'stock-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            clean_name: 'Prep Stock',
            name: 'Prep Stock',
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const before = JSON.stringify(recipes);
    const plan = generateProductionTasks({ recipes, dailyProduction: { 'sauce-ref': 2000 } });
    const task = plan.tasks.find((item) => item.recipeKey === 'sauce-ref');

    return assert(
        before === JSON.stringify(recipes) &&
        task?.dependencies?.[0]?.recipeKey === 'stock-ref' &&
        task?.dependencies?.[0]?.requiredQty === 1000 &&
        task?.dependencies?.[0]?.reason === 'Prep Stock: prep 1000 ml at Sauce Prep before this task.',
        `Dependency should require stock-ref at 1000ml with chef-readable guidance (${JSON.stringify(task?.dependencies)})`
    );
});

runTest('Production task engine uses specific wording for unresolved sub-recipe references', () => {
    const recipes = [
        {
            recipe_ref_id: 'missing-parent-ref',
            canonical_id: 'missing-parent-canon',
            name: 'Missing Dependency Sauce',
            dishStyle: 'sauce prep',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Ghost Stock', recipe_ref_id: 'ghost-stock-ref', qty: 500, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'missing-parent-ref': 2000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'missing-parent-ref');

    return assert(
        task?.taskState === 'blocked'
        && task?.missingDependencyCount === 1
        && task?.taskStateReason?.includes('unresolved sub-recipe reference')
        && task?.dependencyReasons?.[0]?.includes('Confirm the linked recipe before this task starts'),
        `Expected specific unresolved sub-recipe wording (${JSON.stringify(task)})`
    );
});

runTest('Production task engine marks approval-required prep as waiting approval', () => {
    const recipes = [
        {
            recipe_ref_id: 'approval-ref',
            canonical_id: 'approval-canon',
            name: 'Pending Curry Base',
            dishStyle: 'sauce prep',
            baseYield: 2000,
            unit: 'ml',
            offline_sync_state: OFFLINE_STATE.APPROVAL_REQUIRED,
            offline_sync_reason: 'manager_approval_required',
            ingredients: [{ name: 'Water', qty: 2000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'approval-ref': 2000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'approval-ref');

    return assert(
        task?.taskState === 'waiting approval' &&
        task?.readinessState === 'waiting approval' &&
        task?.taskStateReason?.includes('waiting approval'),
        `Expected waiting approval task state (${JSON.stringify(task)})`
    );
});

runTest('Production task engine distinguishes ready now from ready after dependency', () => {
    const recipes = [
        {
            recipe_ref_id: 'sauce-ref',
            canonical_id: 'sauce-canon',
            name: 'Magic Sauce',
            dishStyle: 'sauce prep',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_ref_id: 'stock-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'sauce-ref': 2000, 'stock-ref': 1000 },
        portionsPerBatch: 10
    });
    const sauceTask = plan.tasks.find((item) => item.recipeKey === 'sauce-ref');
    const stockTask = plan.tasks.find((item) => item.recipeKey === 'stock-ref');

    return assert(
        sauceTask?.taskState === 'ready after dependency' &&
        stockTask?.taskState === 'ready now' &&
        stockTask?.taskStateReason?.includes('executable now'),
        `Expected task state maturity (${JSON.stringify(plan.tasks)})`
    );
});

runTest('Production task engine marks downstream tasks changed when upstream prep was chef adjusted', () => {
    const recipes = [
        {
            recipe_ref_id: 'component-parent-ref',
            canonical_id: 'component-parent-canon',
            name: 'Adjusted Sauce Build',
            dishStyle: 'component',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_ref_id: 'stock-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'component-parent-ref': 2000, 'stock-ref': 1000 },
        taskOverrides: {
            'stock-ref': {
                type: 'yield_override',
                reason: 'manual_scale_adjustment',
                reasonText: 'Prep Stock target was chef-adjusted from 1000.00 to 1200.00 ml',
                previousYield: 1000,
                targetYield: 1200,
                updatedAt: '2026-04-15T20:00:00Z'
            }
        },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'component-parent-ref');

    return assert(
        task?.taskState === 'changed'
        && task?.hasChangedDependency === true
        && task?.changedDependencyCount === 1
        && task?.taskStateReason?.includes('Upstream prep changed'),
        `Expected downstream changed-task signal after upstream chef override (${JSON.stringify(task)})`
    );
});

runTest('Production task engine flags unresolved foundation prep as overdue risk', () => {
    const recipes = [
        {
            recipe_ref_id: 'foundation-parent-ref',
            canonical_id: 'foundation-parent-canon',
            name: 'Foundation Curry Base',
            dishStyle: 'base',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_ref_id: 'stock-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'foundation-parent-ref': 2000, 'stock-ref': 1000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'foundation-parent-ref');

    return assert(
        task?.schedulePhase === 'Foundation Prep'
        && task?.taskState === 'ready after dependency'
        && task?.isOverdueRisk === true
        && task?.overdueReason?.includes('needs escalation'),
        `Expected overdue-risk signal for unresolved foundation prep (${JSON.stringify(task)})`
    );
});

runTest('Production task engine preserves chef-adjusted prep override signals', () => {
    const recipes = [
        {
            recipe_ref_id: 'override-ref',
            canonical_id: 'override-canon',
            name: 'Chef Adjusted Stock',
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'override-ref': 1500 },
        taskOverrides: {
            'override-ref': {
                type: 'yield_override',
                reason: 'manual_scale_adjustment',
                reasonText: 'Chef Adjusted Stock target was chef-adjusted from 1000.00 to 1500.00 ml',
                previousYield: 1000,
                targetYield: 1500,
                updatedAt: '2026-04-15T19:00:00Z'
            }
        },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'override-ref');

    return assert(
        task?.hasChefOverride === true &&
        task?.taskChangeState === 'chef adjusted' &&
        task?.taskChangeReason?.includes('chef-adjusted'),
        `Expected chef override signal to stay attached to prep task (${JSON.stringify(task)})`
    );
});

runTest('Production task engine warns when sub-recipe quantity unit mismatches child yield unit', () => {
    const recipes = [
        {
            recipe_ref_id: 'mismatch-parent-ref',
            canonical_id: 'mismatch-parent-canon',
            name: 'Mismatch Sauce',
            dishStyle: 'sauce prep',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Powder Base', recipe_ref_id: 'powder-base-ref', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'powder-base-ref',
            canonical_id: 'powder-base-canon',
            name: 'Powder Base',
            dishStyle: 'component',
            baseYield: 1000,
            unit: 'g',
            ingredients: [{ name: 'Powder', qty: 1000, unit: 'g' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'mismatch-parent-ref': 1000, 'powder-base-ref': 1000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'mismatch-parent-ref');

    return assert(
        task?.truthPriority === 1
        && Array.isArray(task?.truthReasons)
        && task.truthReasons.some((reason) => reason.includes('Conversion review: Powder Base is referenced in ml but yields g.')),
        `Expected conversion mismatch review warning (${JSON.stringify(task)})`
    );
});

runTest('Production task engine resolves sub-recipes from recipe code aliases', () => {
    const recipes = [
        {
            recipe_ref_id: 'sauce-ref',
            canonical_id: 'sauce-canon',
            name: 'Magic Sauce',
            dishStyle: 'sauce prep',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Prep Stock', recipe_code: 'STK-001', qty: 500, unit: 'ml' }]
        },
        {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            code: 'STK-001',
            recipe_aliases: ['STK-001', 'stock-canon'],
            dishStyle: 'stock',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'sauce-ref': 2000, 'stock-ref': 1000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'sauce-ref');

    return assert(
        task?.dependencies?.[0]?.recipeKey === 'stock-ref' &&
        task?.dependencies?.[0]?.requiredQty === 1000 &&
        task?.dependencyCount === 1 &&
        task?.dependencies?.[0]?.reason === 'Prep Stock: prep 1000 ml at Sauce Prep before this task.',
        `Expected recipe_code alias to resolve to stock-ref (${JSON.stringify(task)})`
    );
});

runTest('Queued local recipe truth stays lower-confidence than canonical recipe truth', () => {
    const recipes = [{
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        name: 'Curry Roux',
        baseYield: 5000,
        unit: 'g',
        source_trust: 'canonical',
        recipe_truth_tier: 0,
        recipe_trust_score: 0
    }];
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.PENDING,
        recipe: {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Curry Roux',
            baseYield: 5000,
            unit: 'g'
        }
    });
    const merged = mergeRecipesWithQueue(recipes, { entries: [entry] });
    const recipe = merged.find((item) => item.recipe_ref_id === 'curry-ref');

    return assert(
        recipe?.recipe_truth_tier >= 7 &&
        recipe?.recipe_truth_status === 'review' &&
        recipe?.has_unapproved_changes === true,
        `Queued pending recipe should stay review-state and low-confidence (${JSON.stringify(recipe)})`
    );
});

runTest('Queue merge matches canonical recipe through normalized alias identity', () => {
    const recipes = [{
        recipe_ref_id: 'magic-soy-ref',
        canonical_id: 'magic-soy-canon',
        name: 'Magic Soy',
        clean_name: 'Magic Soy',
        code: 'MS-001',
        recipe_aliases: ['MS-001', 'magic-soy-canon', 'Magic Soy'],
        baseYield: 5000,
        unit: 'ml',
        source_trust: 'canonical',
        recipe_truth_tier: 0,
        recipe_trust_score: 0
    }];
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.PENDING,
        recipe: {
            offline_base_freshness: {
                recipe_ref_id: 'magic-soy-ref',
                client_id: 'cabij',
                updated_at: '2026-04-17T10:00:00Z'
            },
            name: 'Magic Soy Local',
            canonical_name: 'Magic Soy',
            code: 'MS-001',
            baseYield: 5000,
            unit: 'ml'
        }
    });
    const merged = mergeRecipesWithQueue(recipes, { entries: [entry] });
    const magicSoyRecipes = merged.filter((item) => item.canonical_id === 'magic-soy-canon' || item.recipe_ref_id === 'magic-soy-ref' || item.code === 'MS-001');
    const recipe = magicSoyRecipes[0];

    return assert(
        merged.length === 1
        && recipe?.canonical_id === 'magic-soy-canon'
        && recipe?.recipe_ref_id === 'magic-soy-ref'
        && recipe?.source_trust === 'canonical_with_local_changes'
        && Array.isArray(recipe?.recipe_aliases)
        && recipe.recipe_aliases.includes('MS-001')
        && recipe.recipe_aliases.includes('Magic Soy'),
        `Queued alias identity should merge into the existing canonical recipe (${JSON.stringify(merged)})`
    );
});

runTest('Queue merge forces conflict when a canonical alias match is not freshness-backed', () => {
    const recipes = [{
        recipe_ref_id: 'magic-soy-ref',
        canonical_id: 'magic-soy-canon',
        name: 'Magic Soy',
        clean_name: 'Magic Soy',
        code: 'MS-001',
        recipe_aliases: ['MS-001', 'magic-soy-canon', 'Magic Soy'],
        baseYield: 5000,
        unit: 'ml',
        source_trust: 'canonical',
        recipe_truth_tier: 0,
        recipe_trust_score: 0,
        recipe_truth_status: 'trusted'
    }];
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.PENDING,
        recipe: {
            name: 'Magic Soy Local',
            canonical_name: 'Magic Soy',
            code: 'MS-001',
            baseYield: 5000,
            unit: 'ml'
        }
    });
    const merged = mergeRecipesWithQueue(recipes, { entries: [entry] });
    const recipe = merged.find((item) => item.recipe_ref_id === 'magic-soy-ref');

    return assert(
        recipe?.name === 'Magic Soy'
        && recipe?.offline_sync_state === OFFLINE_STATE.CONFLICT
        && recipe?.offline_sync_reason === 'missing_recipe_freshness_conflict'
        && recipe?.recipe_truth_status === 'blocked'
        && recipe?.has_unapproved_changes === true,
        `Freshness-missing alias merge should surface a conflict instead of overriding canonical truth (${JSON.stringify(recipe)})`
    );
});

runTest('Base recipe merge collapses duplicate truths and keeps the canonical winner', () => {
    const recipes = [
        {
            recipe_ref_id: 'magic-soy-ref',
            canonical_id: 'magic-soy-canon',
            name: 'Magic Soy',
            clean_name: 'Magic Soy',
            code: 'MS-001',
            recipe_aliases: ['MS-001', 'Magic Soy'],
            baseYield: 5000,
            unit: 'ml',
            source_trust: 'canonical',
            recipe_truth_tier: 0,
            recipe_trust_score: 0,
            recipe_truth_status: 'trusted'
        },
        {
            id: 'queued-local-copy',
            canonical_name: 'Magic Soy',
            name: 'Magic Soy Local Draft',
            clean_name: 'Magic Soy',
            code: 'MS-001',
            recipe_aliases: ['MS-001', 'Magic Soy'],
            baseYield: 5000,
            unit: 'ml',
            source_trust: 'local_fallback',
            recipe_truth_tier: 6,
            recipe_trust_score: 4,
            recipe_truth_status: 'review',
            has_unapproved_changes: true
        }
    ];

    const merged = mergeRecipesWithQueue(recipes, { entries: [] });
    const recipe = merged[0];

    return assert(
        merged.length === 1
        && recipe?.name === 'Magic Soy'
        && recipe?.source_trust === 'canonical'
        && recipe?.recipe_truth_tier === 0
        && Array.isArray(recipe?.recipe_aliases)
        && recipe.recipe_aliases.includes('MS-001')
        && recipe.recipe_aliases.includes('Magic Soy'),
        `Duplicate truths should collapse to one canonical recipe (${JSON.stringify(merged)})`
    );
});

runTest('Synced queue entry does not keep overriding canonical recipe truth after upstream sync', () => {
    const recipes = [{
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        name: 'Curry Roux',
        baseYield: 5000,
        unit: 'g',
        source_trust: 'canonical',
        recipe_truth_tier: 0,
        recipe_trust_score: 0,
        recipe_truth_status: 'trusted'
    }];
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.SYNCED,
        recipe: {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Curry Roux Local Copy',
            baseYield: 5000,
            unit: 'g'
        }
    });
    const merged = mergeRecipesWithQueue(recipes, { entries: [entry] });
    const recipe = merged.find((item) => item.recipe_ref_id === 'curry-ref');

    return assert(
        recipe?.name === 'Curry Roux' &&
        recipe?.source_trust === 'canonical' &&
        recipe?.recipe_truth_status === 'trusted',
        `Synced queue entry should stop overriding canonical recipe truth (${JSON.stringify(recipe)})`
    );
});

runTest('Manager approval does not promote freshness-missing conflict entries', () => {
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.CONFLICT,
        reason: 'missing_recipe_freshness_conflict',
        recipe: {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Curry Roux',
            baseYield: 5000,
            unit: 'g',
            recipe_truth_status: 'blocked',
            offline_sync_state: OFFLINE_STATE.CONFLICT,
            offline_sync_reason: 'missing_recipe_freshness_conflict'
        }
    });
    const nextEntries = markQueueEntriesForApproval({
        entries: [entry],
        approver: { id: 'manager-1' }
    });
    const nextEntry = nextEntries[0];

    return assert(
        nextEntry?.status === OFFLINE_STATE.CONFLICT
        && nextEntry?.reason === 'missing_recipe_freshness_conflict'
        && nextEntry?.recipe?.offline_sync_state === OFFLINE_STATE.CONFLICT,
        `Unsafe conflict entry should stay out of approved state (${JSON.stringify(nextEntry)})`
    );
});

runTest('Manager approval only promotes safe queue entries into approved sync state', () => {
    const safeEntry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'recipe-truth-edit',
        status: OFFLINE_STATE.APPROVAL_REQUIRED,
        reason: 'recipe_edit_waiting_manager_approval',
        recipe: {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Curry Roux',
            baseYield: 5000,
            unit: 'g',
            recipe_truth_status: 'review',
            offline_base_freshness: {
                recipe_ref_id: 'curry-ref',
                client_id: 'cabij',
                updated_at: '2026-04-17T10:00:00Z'
            }
        }
    });
    const unsafeEntry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'offline-upload',
        status: OFFLINE_STATE.FAILED,
        reason: 'missing_recipe_freshness_conflict',
        recipe: {
            recipe_ref_id: 'stock-ref',
            canonical_id: 'stock-canon',
            name: 'Prep Stock',
            baseYield: 4000,
            unit: 'ml',
            recipe_truth_status: 'blocked',
            offline_sync_state: OFFLINE_STATE.CONFLICT,
            offline_sync_reason: 'missing_recipe_freshness_conflict'
        }
    });
    const nextEntries = markQueueEntriesForApproval({
        entries: [safeEntry, unsafeEntry],
        approver: { id: 'manager-1' }
    });

    return assert(
        nextEntries[0]?.status === OFFLINE_STATE.APPROVED
        && nextEntries[0]?.reason === 'manager_approved_for_sync'
        && nextEntries[1]?.status === OFFLINE_STATE.FAILED
        && nextEntries[1]?.reason === 'missing_recipe_freshness_conflict',
        `Only safe queue entries should move into approved sync state (${JSON.stringify(nextEntries)})`
    );
});

runTest('Recipe queue save records an audit trail with the changed fields and retraining impact', () => {
    const entry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'recipe-meta-edit',
        status: OFFLINE_STATE.APPROVAL_REQUIRED,
        reason: 'recipe_edit_waiting_manager_approval',
        recipe: {
            name: 'Chili Oil',
            recipe_ref_id: 'chili-oil-ref',
            canonical_id: 'chili-oil-canon',
            changedFields: ['title', 'baseYield'],
            retrainingFields: ['baseYield']
        }
    });
    const history = entry?.recipe?.recipe_profile_change_log || [];
    const reviewState = buildGeneratedProfileReviewState(entry.recipe);

    return assert(
        history.length === 1
        && history[0]?.event_type === 'recipe_queued'
        && history[0]?.changed_by
        && history[0]?.retraining_required === true
        && reviewState?.historyCount === 1
        && reviewState?.retrainingCount === 1,
        `Queued recipe should carry a readable audit event and retraining flag (${JSON.stringify({ history, reviewState })})`
    );
});

runTest('Manager approval and sync confirmation append explicit audit history entries', () => {
    const queuedEntry = buildQueuedRecipeEntry({
        clientId: 'cabij',
        source: 'recipe-truth-edit',
        status: OFFLINE_STATE.APPROVAL_REQUIRED,
        reason: 'recipe_edit_waiting_manager_approval',
        recipe: {
            recipe_ref_id: 'curry-ref',
            canonical_id: 'curry-canon',
            name: 'Curry Roux',
            baseYield: 5000,
            unit: 'g',
            offline_base_freshness: {
                recipe_ref_id: 'curry-ref',
                client_id: 'cabij',
                updated_at: '2026-04-17T10:00:00.000Z'
            },
            changedFields: ['ingredients', 'instructions']
        }
    });
    const approvedEntries = markQueueEntriesForApproval({
        entries: [queuedEntry],
        approver: { id: 'manager-1', full_name: 'Chef Mina' }
    });
    const approvedEntry = approvedEntries[0];
    const syncResult = markQueueEntrySyncResult({
        entry: approvedEntry,
        status: OFFLINE_STATE.SYNCED,
        reason: 'manager_approved_sync',
        syncedRecipeRefId: 'curry-sync-ref'
    });
    const history = syncResult?.recipe?.recipe_profile_change_log || [];
    const reviewState = buildGeneratedProfileReviewState(syncResult.recipe);

    return assert(
        approvedEntry?.status === OFFLINE_STATE.APPROVED
        && approvedEntry?.approvedBy
        && syncResult?.status === OFFLINE_STATE.SYNCED
        && syncResult?.syncedRecipeRefId === 'curry-sync-ref'
        && history.some((item) => item?.event_type === 'manager_approved')
        && history.some((item) => item?.event_type === 'recipe_synced')
        && reviewState?.historyCount >= 3
        && reviewState?.historyItems?.some((item) => item?.changedBy === 'Chef Mina'),
        `Approval and sync should write a durable audit trail (${JSON.stringify({ approvedEntry, syncResult, history, reviewState })})`
    );
});

runTest('Upstream recipe payload trims helper-only local fields before sync', () => {
    const payload = buildUpstreamRecipePayload({
        clientId: 'cabij',
        recipe: {
            recipe_ref_id: 'sync-ref',
            canonical_id: 'sync-canon',
            title: 'Sync Curry Base',
            code: 'SYNC-001',
            dishCategory: 'Foundation Prep',
            dishStyle: 'Sauce Prep',
            cuisine: 'Pan-Asian',
            occasion: 'Prep',
            ingredients: [{ name: 'Oil', qty: 1000, unit: 'ml' }],
            instructions: ['Warm', 'Blend'],
            allergens: ['soy'],
            baseYield: 1000,
            unit: 'ml',
            yieldMode: 'batch_only',
            productionStrategy: 'fixed_batch',
            scalingTips: {
                notes: [{ title: 'Manager', body: 'Keep chilled' }],
                prepIntelligence: { leadTime: 'Morning' }
            },
            prepIntelligence: { handoffNote: 'Do not sync' },
            recipe_truth_status: 'review',
            source_trust: 'canonical_with_local_changes'
        },
        status: OFFLINE_STATE.SYNCED,
        reason: 'manager_approved_sync'
    });

    return assert(
        payload?.title === 'Sync Curry Base'
        && payload?.code === 'SYNC-001'
        && payload?.yieldMode === 'batch_only'
        && payload?.productionStrategy === 'fixed_batch'
        && !Object.prototype.hasOwnProperty.call(payload, 'scalingTips')
        && !Object.prototype.hasOwnProperty.call(payload, 'prepIntelligence')
        && !Object.prototype.hasOwnProperty.call(payload, 'recipe_truth_status')
        && !Object.prototype.hasOwnProperty.call(payload, 'source_trust'),
        `Expected helper-only fields to stay out of upstream sync payload (${JSON.stringify(payload)})`
    );
});

runTest('Recipes table write payload mirrors safe direct columns for synced edits', () => {
    const rowPayload = buildRecipesTableWritePayload({
        clientId: 'cabij',
        recipe: {
            recipe_ref_id: 'sync-ref',
            canonical_id: 'sync-canon',
            title: 'Sync Curry Base',
            code: 'SYNC-001',
            dishCategory: 'Foundation Prep',
            dishStyle: 'Sauce Prep',
            cuisine: 'Pan-Asian',
            occasion: 'Prep',
            ingredients: [{ name: 'Oil', qty: 1000, unit: 'ml' }],
            instructions: ['Warm', 'Blend'],
            allergens: ['soy'],
            scalingTips: { notes: [{ title: 'Manager', body: 'Keep chilled' }] }
        },
        status: OFFLINE_STATE.SYNCED,
        reason: 'manager_approved_sync'
    });

    return assert(
        rowPayload?.recipe_ref_id === 'sync-ref'
        && rowPayload?.canonical_id === 'sync-canon'
        && rowPayload?.title === 'Sync Curry Base'
        && rowPayload?.recipe_code === 'SYNC-001'
        && rowPayload?.dish_category === 'Foundation Prep'
        && rowPayload?.dish_style === 'Sauce Prep'
        && rowPayload?.category === 'Foundation Prep'
        && rowPayload?.style === 'Sauce Prep'
        && rowPayload?.cuisine === 'Pan-Asian'
        && rowPayload?.occasion === 'Prep'
        && Array.isArray(rowPayload?.ingredients)
        && rowPayload.ingredients.length === 1
        && Array.isArray(rowPayload?.steps)
        && rowPayload.steps.length === 2
        && Array.isArray(rowPayload?.allergens)
        && rowPayload.allergens.includes('soy')
        && rowPayload?.structured_recipe?.recipe?.recipe_ref_id === 'sync-ref'
        && rowPayload?.structured_recipe?.recipe?.canonical_id === 'sync-canon'
        && !Object.prototype.hasOwnProperty.call(rowPayload?.recipe_json || {}, 'scalingTips'),
        `Expected synced row payload to mirror safe direct columns (${JSON.stringify(rowPayload)})`
    );
});

runTest('Recipe normalization prefers nested structured recipe identity when direct columns are blank', () => {
    const normalized = normalizeSupabaseRecipeRecord({
        row: {
            id: 'recipe-db-id-6',
            title: 'Nested Identity Curry',
            recipe_ref_id: null,
            canonical_id: null,
            recipe_code: null,
            structured_recipe: {
                recipe: {
                    name: 'Nested Identity Curry',
                    recipe_ref_id: 'NESTED_CURRY__cabij',
                    canonical_id: 'nested_curry',
                    recipe_code: 'nested_curry',
                    ingredients: [{ name: 'Oil', qty: 100, unit: 'ml' }],
                    instructions: ['Warm oil']
                }
            }
        },
        clientId: 'cabij'
    });

    return assert(
        normalized?.recipe_ref_id === 'NESTED_CURRY__cabij'
        && normalized?.canonical_id === 'nested_curry'
        && normalized?.recipe_code === 'nested_curry',
        `Expected nested structured recipe identity to survive normalization (${JSON.stringify(normalized)})`
    );
});

runTest('SQL recipe seed parser converts public.recipes backup rows into normalized recipe packets', () => {
    const sqlText = `
INSERT INTO public.recipes (
  id, client_id, status, structured_recipe, recipe_json, original_file_url, created_at, updated_at, title, dish_category, dish_style, cuisine, dietary, ingredients, steps, servings_text, source, occasion, allergens, nutrition, serving_display, nutrition_details, nutrition_audit, servings_details, classification_confidence, confidence_scores, weights, category, style, recipe_code, review_required, review_status, ai_review_status, human_review_status, review_reasons
) VALUES
('seed-1', 'cabij', 'draft', NULL, '{"name":"Seed Curry","dishStyle":"sauce prep","dishCategory":"foundation prep","ingredients":[{"name":"Oil","qty":1000,"unit":"ml"}],"instructions":["Warm","Blend"]}', NULL, '2026-04-17T00:00:00+00:00', '2026-04-17T00:00:00+00:00', 'Seed Curry', 'Foundation Prep', 'Sauce Prep', 'Pan-Asian', ARRAY['Vegan']::text[], '[{"name":"Oil","qty":1000,"unit":"ml"}]', '["Warm","Blend"]', NULL, 'upload', 'Prep', ARRAY['soy']::text[], NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Foundation Prep', 'Sauce Prep', 'SEED-001', TRUE, 'pending', 'pending', 'pending', ARRAY['auto_extracted']::text[]);
`;
    const packets = parseRecipesSqlSeed(sqlText, 'cabij');
    const recipe = packets[0];

    return assert(
        Array.isArray(packets)
        && packets.length === 1
        && recipe?.title === 'Seed Curry'
        && recipe?.code === 'SEED-001'
        && recipe?.dishCategory === 'Foundation Prep'
        && recipe?.dishStyle === 'Sauce Prep'
        && recipe?.cuisine === 'Pan-Asian'
        && recipe?.occasion === 'Prep'
        && Array.isArray(recipe?.ingredients)
        && recipe.ingredients[0]?.name === 'Oil'
        && Array.isArray(recipe?.instructions)
        && recipe.instructions.length === 2
        && Array.isArray(recipe?.allergens)
        && recipe.allergens.includes('soy'),
        `Expected SQL recipe seed to normalize into import packets (${JSON.stringify(packets)})`
    );
});

runTest('SQL recipe seed parser rejects sop_recipes backup as the live import source', () => {
    let error = null;
    try {
        parseRecipesSqlSeed(`
INSERT INTO public.sop_recipes (
  id, recipe_name
) VALUES
('seed-1', 'SOP Recipe');
`, 'cabij');
    } catch (nextError) {
        error = nextError;
    }

    return assert(
        error?.message?.includes('recipes_library_backup.sql'),
        `Expected sop_recipes backup rejection to point to recipes_library_backup.sql (${error?.message || 'no error'})`
    );
});

runTest('SQL recipe seed parser preserves semicolons and escaped quotes in a portable fixture', () => {
    const sqlText = fs.readFileSync(new URL('./fixtures/recipes.sql', import.meta.url), 'utf8');
    const packets = parseRecipesSqlSeed(sqlText, 'cabij');
    return assert(packets.length === 2 && packets.some(recipe => recipe.instructions.includes("Warm; then stir chef's sauce")), 'Expected two rows and preserved quoted instruction punctuation');
});

runTest('Recipe lookup key prefers the stable live recipe truth identity', () => {
    const recipe = {
        id: 'db-row-123',
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        code: 'CUR-001',
        clean_name: 'Curry Base'
    };

    return assert(
        getRecipeLookupKey(recipe) === 'curry-ref',
        `Expected stable lookup key to prefer recipe_ref_id (${JSON.stringify(recipe)})`
    );
});

runTest('Recipe lookup matching resolves aliases across code, canonical id, and display name', () => {
    const recipe = {
        recipe_ref_id: 'magic-soy-ref',
        canonical_id: 'magic-soy-canon',
        code: 'MS-001',
        name: 'Magic Soy',
        recipe_aliases: ['Magic Soy Master']
    };

    return assert(
        recipeMatchesLookup(recipe, ['MS-001'])
        && recipeMatchesLookup(recipe, ['magic soy canon'])
        && recipeMatchesLookup(recipe, ['Magic Soy Master'])
        && recipeMatchesLookup(recipe, ['Magic Soy']),
        `Expected lookup matcher to resolve stable aliases (${JSON.stringify(recipe)})`
    );
});

runTest('Scale map keys stay aligned to the shared recipe lookup identity', () => {
    const recipes = [{
        id: 'db-row-123',
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        name: 'Curry Base',
        baseYield: 1000
    }];
    const scaleMap = buildScaleMap(recipes, { 'curry-ref': 2000 });

    return assert(
        scaleMap['curry-ref'] === 2
        && !Object.prototype.hasOwnProperty.call(scaleMap, 'db-row-123'),
        `Expected scale map to use the shared lookup key (${JSON.stringify(scaleMap)})`
    );
});

runTest('Scale map still resolves demand keyed by older recipe aliases', () => {
    const recipes = [{
        id: 'db-row-123',
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        code: 'CUR-001',
        name: 'Curry Base',
        baseYield: 1000
    }];
    const scaleMap = buildScaleMap(recipes, { 'db-row-123': 2000 });

    return assert(
        scaleMap['curry-ref'] === 2
        && !Object.prototype.hasOwnProperty.call(scaleMap, 'db-row-123'),
        `Expected scale map to recover demand from older aliases (${JSON.stringify(scaleMap)})`
    );
});

runTest('Legacy SKU registry resolves to the stabilized live recipe identity', () => {
    const recipes = [{
        id: 'db-row-456',
        recipe_ref_id: 'magic-soy-ref',
        canonical_id: 'magic-soy-canon',
        code: 'MS-001',
        name: 'Magic Soy',
        recipe_aliases: ['magic-soy'],
        baseYield: 1000,
        unit: 'ml',
        ingredients: [{ name: 'Soy', qty: 1000, unit: 'ml' }]
    }];

    return assert(
        resolveRecipeId({ sku: 'INT-MAG-SOY', name: 'Magic Soy' }, recipes) === 'magic-soy-ref',
        'Expected legacy SKU registry to map to the stabilized recipe lookup key'
    );
});

runTest('BOMEngine keeps stabilized recipe_ref_id nodes when legacy SKU registry links a child recipe', () => {
    const recipes = [
        {
            recipe_ref_id: 'sauce-ref',
            canonical_id: 'sauce-canon',
            name: 'Prep Sauce',
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Magic Soy', sku: 'INT-MAG-SOY', qty: 500, unit: 'ml' }]
        },
        {
            id: 'db-row-456',
            recipe_ref_id: 'magic-soy-ref',
            canonical_id: 'magic-soy-canon',
            code: 'MS-001',
            name: 'Magic Soy',
            recipe_aliases: ['magic-soy'],
            baseYield: 1000,
            unit: 'ml',
            ingredients: [{ name: 'Soy', qty: 1000, unit: 'ml' }]
        }
    ];
    const res = calculateBOM(recipes, { 'sauce-ref': 2 });

    return assert(
        res.nodes['magic-soy-ref']?.demandWeight === 1000
        && !Object.prototype.hasOwnProperty.call(res.nodes, 'magic-soy'),
        `Expected BOM nodes to stay on stabilized recipe identity (${JSON.stringify(res.nodes)})`
    );
});

runTest('Offline recipe cache reports degraded trust when freshness markers are missing', () => {
    installMemoryStorage();
    saveOfflineCache({
        clientId: 'cabij',
        type: 'recipes',
        hydratedAt: '2026-04-17T09:00:00Z',
        payload: {
            recipes: [{
                recipe_ref_id: 'curry-ref',
                canonical_id: 'curry-canon',
                name: 'House Curry',
                recipe_truth_status: 'trusted',
                source_trust: 'canonical'
            }]
        }
    });
    const cached = readOfflineCache({ clientId: 'cabij', type: 'recipes' });

    return assert(
        cached?.trust?.isDegraded === true
        && cached?.trust?.missingFreshnessCount === 1
        && cached?.trust?.reason?.includes('missing freshness markers'),
        `Expected offline recipe cache trust warning for missing freshness (${JSON.stringify(cached?.trust)})`
    );
});

runTest('Offline command-board cache reports degraded trust when recipe truth metadata is missing', () => {
    installMemoryStorage();
    saveOfflineCache({
        clientId: 'cabij',
        type: 'command-board',
        hydratedAt: '2026-04-17T09:00:00Z',
        payload: {
            boardTasks: [{
                id: 'task-1',
                dish_name: 'House Curry',
                meta: {}
            }]
        }
    });
    const cached = readOfflineCache({ clientId: 'cabij', type: 'command-board' });

    return assert(
        cached?.trust?.isDegraded === true
        && cached?.trust?.missingMetaCount === 1
        && cached?.trust?.reason?.includes('missing recipe truth metadata'),
        `Expected command-board cache trust warning for missing recipe truth metadata (${JSON.stringify(cached?.trust)})`
    );
});

runTest('Recipe search index captures code, alias, and ingredient text for large-list lookup', () => {
    const searchIndex = buildRecipeSearchIndexEntry({
        recipe_ref_id: 'curry-ref',
        canonical_id: 'curry-canon',
        code: 'CUR-001',
        name: 'House Curry',
        recipe_aliases: ['Golden Curry Base'],
        ingredients: [{ name: 'Coconut Milk' }, { ingredient_name: 'Turmeric' }]
    });

    return assert(
        searchIndex.code === 'cur 001'
        && searchIndex.aliasTokens.includes('golden curry base')
        && searchIndex.ingredients.includes('coconut milk')
        && searchIndex.ingredients.includes('turmeric'),
        `Expected recipe search index to capture stable lookup text (${JSON.stringify(searchIndex)})`
    );
});

runTest('Recipe search scoring still matches alias and ingredient recovery paths', () => {
    const searchIndex = buildRecipeSearchIndexEntry({
        recipe_ref_id: 'magic-soy-ref',
        canonical_id: 'magic-soy-canon',
        code: 'MS-001',
        name: 'Magic Soy',
        recipe_aliases: ['Magic Soy Master'],
        ingredients: [{ name: 'Soy Sauce' }, { name: 'Garlic' }]
    });
    const aliasScore = scoreRecipeSearchIndex(searchIndex, 'Magic Soy Master', 'title');
    const ingredientScore = scoreRecipeSearchIndex(searchIndex, 'garlic', 'title');

    return assert(
        aliasScore.matched === true
        && ingredientScore.matched === true
        && ingredientScore.score >= aliasScore.score,
        `Expected alias search to outrank ingredient-only recovery (${JSON.stringify({ aliasScore, ingredientScore })})`
    );
});

runTest('Recipe browse groups stay ordered by count first and label second', () => {
    const groups = buildRecipeBrowseGroups([
        { recipe: { dishStyle: 'Sauce Prep' } },
        { recipe: { dishStyle: 'Kitchen Standard' } },
        { recipe: { dishStyle: 'Sauce Prep' } },
        { recipe: { dishStyle: 'Base' } },
        { recipe: { dishStyle: 'Base' } },
    ], (recipe) => recipe?.dishStyle || 'General');

    return assert(
        Array.isArray(groups)
        && groups[0]?.label === 'Base'
        && groups[0]?.entries?.length === 2
        && groups[1]?.label === 'Sauce Prep'
        && groups[1]?.entries?.length === 2
        && groups[2]?.label === 'Kitchen Standard',
        `Expected browse groups to order by count then label (${JSON.stringify(groups)})`
    );
});

runTest('Recipe browse group resolution clears stale filters safely', () => {
    const groups = buildRecipeBrowseGroups([
        { recipe: { cuisine: 'Pan-Asian' } },
        { recipe: { cuisine: 'General' } }
    ], (recipe) => recipe?.cuisine || 'General');
    const resolved = resolveRecipeBrowseGroup(groups, 'missing-group');

    return assert(
        resolved.activeKey === ''
        && resolved.selectedGroup === null,
        `Expected stale browse filters to clear safely (${JSON.stringify(resolved)})`
    );
});

runTest('Recipe quick picks prioritize selected then recent then trusted entries', () => {
    const quickPicks = buildRecipeQuickPickEntries([
        { id: 'trusted-b', label: 'Trusted B', identityKey: 'trusted-b', touchpoint: 0, trust: 0, canonicalPriority: 0 },
        { id: 'recent-a', label: 'Recent A', identityKey: 'recent-a', touchpoint: 200, trust: 0, canonicalPriority: 0 },
        { id: 'selected-c', label: 'Selected C', identityKey: 'selected-c', touchpoint: 10, trust: 1, canonicalPriority: 1 }
    ], {
        selectedId: 'selected-c',
        limit: 3
    });

    return assert(
        quickPicks[0]?.id === 'selected-c'
        && quickPicks[1]?.id === 'recent-a'
        && quickPicks[2]?.id === 'trusted-b',
        `Expected quick picks to prioritize selected/recent/trusted ordering (${JSON.stringify(quickPicks)})`
    );
});

runTest('Prep action availability disables print when no station tasks exist', () => {
    const actionState = buildPrepActionAvailability({
        recipe: { name: 'House Curry' },
        recipeKey: 'curry-ref',
        scopedTasks: [],
        prepPlan: null,
        sessionSnapshot: null
    });

    return assert(
        actionState.canOpenRecipeTruth === true
        && actionState.canSavePrepPlan === true
        && actionState.canPrintStationList === false
        && actionState.printStationListLabel === 'Print Station List',
        `Expected prep action availability to block print without tasks (${JSON.stringify(actionState)})`
    );
});

runTest('Prep action availability promotes refresh when a prep session already exists', () => {
    const actionState = buildPrepActionAvailability({
        recipe: { name: 'House Curry' },
        recipeKey: 'curry-ref',
        scopedTasks: [{ id: 'task-1' }, { id: 'task-2' }],
        prepPlan: { mode: 'prepThisWeek' },
        sessionSnapshot: { startedAt: '2026-04-17T08:00:00Z' }
    });

    return assert(
        actionState.canStartPrep === true
        && actionState.canPrintStationList === true
        && actionState.printStationListLabel === 'Print 2 tasks'
        && actionState.startPrepLabel === 'Refresh Prep',
        `Expected prep action availability to reflect live task/session state (${JSON.stringify(actionState)})`
    );
});

runTest('Prep focus target prefers the linked prep recipe when one is available', () => {
    const target = resolvePrepFocusTarget(
        { recipeKey: 'curry-ref', recipeName: 'House Curry' },
        { recipeKey: 'fallback-ref', recipeName: 'Fallback Curry' }
    );

    return assert(
        target?.recipeKey === 'curry-ref'
        && target?.recipeName === 'House Curry',
        `Expected prep focus target to preserve the direct linked recipe (${JSON.stringify(target)})`
    );
});

runTest('Prep focus target falls back cleanly when a summary row has no direct recipe link', () => {
    const target = resolvePrepFocusTarget(
        { recipeKey: '', recipeName: '' },
        { recipeKey: 'selected-ref', recipeName: 'Selected Curry' }
    );

    return assert(
        target?.recipeKey === 'selected-ref'
        && target?.recipeName === 'Selected Curry',
        `Expected prep focus target to reuse the current recipe instead of a stale summary row (${JSON.stringify(target)})`
    );
});

runTest('Prep plan resolution matches tasks by stable recipe identity and recipe name', () => {
    const prepPlans = {
        'curry-ref': { mode: 'prepThisWeek', days: [0, 2] },
        'stock-plan': { mode: 'prepThisWeek', recipeName: 'Prep Stock', days: [1] }
    };
    const directMatch = resolvePrepPlanForTask(prepPlans, {
        recipeKey: 'curry-ref',
        name: 'House Curry'
    });
    const nameMatch = resolvePrepPlanForTask(prepPlans, {
        recipeKey: 'unknown-ref',
        name: 'Prep Stock'
    });

    return assert(
        Array.isArray(directMatch?.days)
        && directMatch.days.includes(2)
        && Array.isArray(nameMatch?.days)
        && nameMatch.days.includes(1),
        `Expected prep plan resolution to match both direct keys and recipe names (${JSON.stringify({ directMatch, nameMatch })})`
    );
});

runTest('Prep calendar pressure reflects scheduled task load and attention state honestly', () => {
    const summary = buildPrepCalendarPressure({
        now: new Date('2026-04-20T09:00:00Z'),
        prepPlans: {
            'curry-ref': { mode: 'prepThisWeek', days: [0, 2] },
            'stock-ref': { mode: 'prepThisWeek', days: [1] }
        },
        tasks: [
            {
                recipeKey: 'curry-ref',
                taskState: 'ready now',
                isDependencyBlocked: false
            },
            {
                recipeKey: 'stock-ref',
                taskState: 'truth blocked',
                isTruthBlocked: true,
                truthPriority: 2
            }
        ]
    });

    const monday = summary.weekCells[0];
    const tuesday = summary.weekCells[1];
    const wednesday = summary.weekCells[2];

    return assert(
        monday?.count === 1
        && monday?.attentionCount === 0
        && tuesday?.count === 1
        && tuesday?.attentionCount === 1
        && tuesday?.blockedCount === 1
        && wednesday?.count === 1
        && summary.todayCount === 1
        && summary.weekCount === 3
        && summary.weekAttentionCount === 1,
        `Expected calendar pressure to count scheduled load and attention honestly (${JSON.stringify(summary)})`
    );
});

runTest('Prep schedule lane keeps morning, afternoon, and before-service tasks explicit before overflow', () => {
    const lane = buildPrepScheduleLane([
        {
            recipeKey: 'afternoon-ref',
            name: 'Afternoon Slaw',
            prepLeadTime: 'Afternoon',
            schedulePhasePriority: 1,
            taskStatePriority: 0
        },
        {
            recipeKey: 'morning-ref',
            name: 'Morning Stock',
            prepLeadTime: 'Morning first',
            schedulePhasePriority: 0,
            taskStatePriority: 0
        },
        {
            recipeKey: 'service-ref',
            name: 'Service Garnish',
            prepLeadTime: 'Before service',
            schedulePhasePriority: 2,
            taskStatePriority: 0
        },
        {
            recipeKey: 'overflow-ref',
            name: 'Overflow Base',
            prepLeadTime: 'Morning',
            schedulePhasePriority: 0,
            taskStatePriority: 1
        }
    ]);

    return assert(
        lane[0]?.scheduleSlotLabel === 'Morning'
        && lane[0]?.name === 'Morning Stock'
        && lane[1]?.scheduleSlotLabel === 'Afternoon'
        && lane[1]?.name === 'Afternoon Slaw'
        && lane[2]?.scheduleSlotLabel === 'Before service'
        && lane[2]?.name === 'Service Garnish'
        && lane[3]?.scheduleSlotLabel === 'Watch'
        && lane[3]?.name === 'Overflow Base',
        `Expected prep schedule lane to reserve explicit day-part slots before overflow (${JSON.stringify(lane)})`
    );
});

runTest('Prep focus list keeps the strongest next tasks in day-part order', () => {
    const focusList = buildPrepTaskFocusList([
        {
            id: 'task-1',
            recipeKey: 'morning-ref',
            name: 'Morning Stock',
            prepLeadTime: 'Morning first',
            schedulePhasePriority: 0,
            taskStatePriority: 0
        },
        {
            id: 'task-2',
            recipeKey: 'overflow-ref',
            name: 'Overflow Base',
            prepLeadTime: 'Morning',
            schedulePhasePriority: 0,
            taskStatePriority: 1
        },
        {
            id: 'task-3',
            recipeKey: 'afternoon-ref',
            name: 'Afternoon Slaw',
            prepLeadTime: 'Afternoon',
            schedulePhasePriority: 1,
            taskStatePriority: 0
        },
        {
            id: 'task-4',
            recipeKey: 'service-ref',
            name: 'Service Garnish',
            prepLeadTime: 'Before service',
            schedulePhasePriority: 2,
            taskStatePriority: 0
        }
    ], { mode: 'next' });

    return assert(
        Array.isArray(focusList)
        && focusList.length === 4
        && focusList[0]?.name === 'Morning Stock'
        && focusList[1]?.name === 'Afternoon Slaw'
        && focusList[2]?.name === 'Service Garnish'
        && focusList[3]?.name === 'Overflow Base',
        `Expected next-task focus list to preserve clean day-part order (${JSON.stringify(focusList.map((task) => task.name))})`
    );
});

runTest('Prep focus list supports morning-only and picked-task filtering', () => {
    const tasks = [
        {
            id: 'task-1',
            recipeKey: 'morning-ref',
            name: 'Morning Stock',
            prepLeadTime: 'Morning first',
            schedulePhasePriority: 0,
            taskStatePriority: 0
        },
        {
            id: 'task-2',
            recipeKey: 'morning-2-ref',
            name: 'Morning Slaw',
            prepLeadTime: 'Morning',
            schedulePhasePriority: 0,
            taskStatePriority: 1
        },
        {
            id: 'task-3',
            recipeKey: 'afternoon-ref',
            name: 'Afternoon Sauce',
            prepLeadTime: 'Afternoon',
            schedulePhasePriority: 1,
            taskStatePriority: 0
        }
    ];
    const dayPartList = buildPrepTaskFocusList(tasks, { mode: 'daypart', dayPartKey: 'morning' });
    const pickedList = buildPrepTaskFocusList(tasks, { mode: 'picked', pickedTaskIds: ['task-3'] });

    return assert(
        dayPartList.length === 2
        && dayPartList.every((task) => String(task?.prepLeadTime || '').toLowerCase().includes('morning'))
        && pickedList.length === 1
        && pickedList[0]?.id === 'task-3',
        `Expected focused prep filters to support day-part and picked-task views (${JSON.stringify({ dayPart: dayPartList.map((task) => task.name), picked: pickedList.map((task) => task.name) })})`
    );
});

runTest('Prep task category lanes stay grouped by schedule category and keep blocker/truth counts visible', () => {
    const lanes = buildPrepTaskCategoryLanes([
        {
            recipeKey: 'foundation-ref',
            name: 'Stock Base',
            schedulePhase: 'Foundation Prep',
            schedulePhasePriority: 0,
            taskStatePriority: 0,
            isDependencyBlocked: false,
            truthPriority: 0
        },
        {
            recipeKey: 'component-ref',
            name: 'Slaw Mix',
            schedulePhase: 'Component Prep',
            schedulePhasePriority: 1,
            taskStatePriority: 2,
            isDependencyBlocked: true,
            truthPriority: 1,
            isTruthBlocked: false,
            hasChangedDependency: true
        },
        {
            recipeKey: 'service-ref',
            name: 'Line Garnish',
            schedulePhase: 'Service Finish',
            schedulePhasePriority: 2,
            taskStatePriority: 0,
            isDependencyBlocked: false,
            truthPriority: 0
        }
    ]);

    return assert(
        lanes[0]?.category === 'Foundation Prep'
        && lanes[1]?.category === 'Component Prep'
        && lanes[1]?.blockedCount === 1
        && lanes[1]?.truthCount === 1
        && lanes[1]?.changedCount === 1
        && lanes[2]?.category === 'Service Finish',
        `Expected task-category lanes to preserve category order and counts (${JSON.stringify(lanes)})`
    );
});

runTest('Prep task execution signal favors actionable work over noisy blocked dependency churn', () => {
    const readySignal = buildPrepTaskExecutionSignal({
        name: 'Morning Stock',
        taskState: 'ready now',
        schedulePhasePriority: 0,
        prepTimeMinutes: 75,
        shortagePriority: 0
    });
    const blockedSignal = buildPrepTaskExecutionSignal({
        name: 'Slaw Mix',
        taskState: 'blocked',
        schedulePhasePriority: 1,
        blockedDependencyCount: 2,
        missingDependencyCount: 1,
        shortagePriority: 40
    });

    return assert(
        readySignal.operationalPriority < blockedSignal.operationalPriority
        && blockedSignal.nextActionReason.includes('resolve 1 missing recipe link'),
        `Expected execution signal to keep actionable prep ahead of noisy blocked work (${JSON.stringify({ readySignal, blockedSignal })})`
    );
});

runTest('Prep time prediction stays honest when timing still depends on blockers or review', () => {
    const readyPrediction = buildPrepTaskTimePrediction({
        name: 'Morning Stock',
        taskState: 'ready now',
        schedulePhasePriority: 0,
        prepTimeMinutes: 90
    });
    const blockedPrediction = buildPrepTaskTimePrediction({
        name: 'Slaw Mix',
        taskState: 'blocked',
        schedulePhasePriority: 0,
        blockedDependencyCount: 2,
        prepTimeMinutes: 45
    });
    const reviewPrediction = buildPrepTaskTimePrediction({
        name: 'Curry Base',
        taskState: 'truth review',
        schedulePhasePriority: 1,
        prepTimeMinutes: 30
    });

    return assert(
        readyPrediction.timeLabel === 'Start now'
        && readyPrediction.timeSummary.includes('90 min')
        && blockedPrediction.timeLabel === 'After upstream prep'
        && blockedPrediction.timeSummary.includes('45 min')
        && reviewPrediction.timeLabel === 'After review'
        && reviewPrediction.timeSummary.includes('30 min'),
        `Expected prep time prediction to stay truthful across ready, blocked, and review states (${JSON.stringify({ readyPrediction, blockedPrediction, reviewPrediction })})`
    );
});

runTest('Prep task execution signal pulls longer ready-now morning prep forward', () => {
    const longReadySignal = buildPrepTaskExecutionSignal({
        name: 'Long Broth',
        taskState: 'ready now',
        schedulePhasePriority: 0,
        prepTimeMinutes: 95
    });
    const shortReadySignal = buildPrepTaskExecutionSignal({
        name: 'Quick Garnish',
        taskState: 'ready now',
        schedulePhasePriority: 0,
        prepTimeMinutes: 15
    });

    return assert(
        longReadySignal.operationalPriority < shortReadySignal.operationalPriority
        && longReadySignal.timePrediction?.timeLabel === 'Start now',
        `Expected stronger prep-time prediction to pull longer ready-now work forward (${JSON.stringify({ longReadySignal, shortReadySignal })})`
    );
});

runTest('Prep task session detail exposes owner and completion truth for the active task', () => {
    const detail = buildPrepTaskSessionDetail({
        task: { id: 'task-curry', recipeKey: 'curry-ref' },
        sessionSnapshot: {
            taskProgress: {
                'task-curry': {
                    ownerLabel: 'Chef Teo',
                    claimedAt: '2026-04-17T09:00:00Z',
                    completedAt: '2026-04-17T09:25:00Z',
                    completedBy: 'Chef Teo'
                }
            }
        }
    });

    return assert(
        detail.taskId === 'task-curry'
        && detail.ownerLabel === 'Chef Teo'
        && detail.isCompleted === true
        && detail.statusLabel === 'Completed'
        && detail.completedBy === 'Chef Teo',
        `Expected prep task session detail to expose owner and completion truth (${JSON.stringify(detail)})`
    );
});

runTest('Invoice ingest packet normalizes review counts and precedence for n8n contract input', () => {
    const packet = normalizeInvoiceIngestPacket(INVOICE_INGEST_PREVIEW_PACKET);

    return assert(
        packet.contractVersion === 'cabij.invoice.ingest.v1'
        && packet.summary.lineItemCount === 6
        && packet.summary.matchedCount === 4
        && packet.summary.reviewCount === 2
        && packet.precedence.strategy === 'most_recent_invoice_date'
        && packet.precedence.tieBreaker === 'latest_uploaded_at',
        `Expected invoice ingest packet to normalize contract, counts, and precedence (${JSON.stringify(packet.summary)})`
    );
});

runTest('Latest trusted ingredient cost ignores newer review-only invoice lines', () => {
    const matchState = selectLatestTrustedIngredientCost(
        { name: 'Smoked Garlic Oil', aliases: ['garlic oil'] },
        INVOICE_INGEST_PREVIEW_HISTORY
    );

    return assert(
        matchState.selectedCandidate?.invoiceDate === '2026-04-10'
        && matchState.selectedCandidate?.supplierName === 'Market Wholesale'
        && matchState.pendingReviewCandidate?.invoiceDate === '2026-04-17'
        && matchState.candidateCount === 2,
        `Expected trusted selector to keep older safe cost while newer review line remains blocked (${JSON.stringify(matchState)})`
    );
});

runTest('Recipe cost workspace keeps expense-first truth and review warnings visible', () => {
    const workspace = buildRecipeCostWorkspace({
        recipe: {
            name: 'Preview Carrot Plate',
            ingredients: [
                { name: 'Carrot', qty: 4.8, unit: 'kg' },
                { name: 'Smoked Garlic Oil', qty: 180, unit: 'ml' },
                { name: 'Lemon Dressing', qty: 520, unit: 'ml' }
            ]
        },
        invoicePackets: INVOICE_INGEST_PREVIEW_HISTORY,
        portionCount: 24,
        manualIncome: 32
    });

    return assert(
        workspace.metrics.recipeCostLabel === '$11.30'
        && workspace.metrics.costPerPortionLabel === '$0.47'
        && workspace.metrics.confidenceLabel === '67%'
        && workspace.expenseSummary.headline === '$11.30'
        && workspace.incomeSummary.incomeLabel === '$32.00'
        && workspace.incomeSummary.profitLabel === '$20.70'
        && workspace.incomeSummary.foodCostLabel === '35%'
        && workspace.openDecisionCount === 2
        && workspace.costRows[0]?.matchLabel === 'Matched'
        && workspace.costRows[1]?.matchLabel === 'Matched + review'
        && workspace.costRows[1]?.totalLabel === '$0.43'
        && workspace.costRows[1]?.sourceLabel === 'Market Wholesale / 2026-04-10',
        `Expected cost workspace to keep trusted expense and review states visible (${JSON.stringify({ metrics: workspace.metrics, rows: workspace.costRows })})`
    );
});

runTest('Recipe cost workspace exposes supplier change alerts from invoice history', () => {
    const workspace = buildRecipeCostWorkspace({
        recipe: {
            name: 'Preview Carrot Plate',
            ingredients: [
                { name: 'Carrot', qty: 4.8, unit: 'kg' },
                { name: 'Smoked Garlic Oil', qty: 180, unit: 'ml' }
            ]
        },
        invoicePackets: INVOICE_INGEST_PREVIEW_HISTORY,
        portionCount: 24
    });

    return assert(
        workspace.supplierChangeCards.length >= 2
        && workspace.supplierChangeCards[0]?.title === 'Carrot'
        && workspace.supplierChangeCards.some((card) => card.badge === 'Review change')
        && workspace.supplierChangeCards.some((card) => String(card.changeLabel).includes('%')),
        `Expected supplier change cards to surface trusted deltas and review-only newer lines (${JSON.stringify(workspace.supplierChangeCards)})`
    );
});

runTest('Recipe cost workspace exposes compact owner intelligence without burying expense truth', () => {
    const workspace = buildRecipeCostWorkspace({
        recipe: {
            name: 'Preview Carrot Plate',
            ingredients: [
                { name: 'Carrot', qty: 4.8, unit: 'kg' },
                { name: 'Smoked Garlic Oil', qty: 180, unit: 'ml' }
            ]
        },
        invoicePackets: INVOICE_INGEST_PREVIEW_HISTORY,
        portionCount: 24,
        manualIncome: 18
    });

    return assert(
        workspace.intelligenceCards.length >= 3
        && workspace.intelligenceCards.some((card) => card.badge === 'Cheaper before')
        && workspace.intelligenceCards.some((card) => card.badge === 'Review line')
        && workspace.intelligenceCards.some((card) => card.title === 'Recipe margin pressure' && card.badge === 'Watch'),
        `Expected compact owner intelligence cards for cheaper suppliers, review hotspots, and margin pressure (${JSON.stringify(workspace.intelligenceCards)})`
    );
});

runTest('Recipe cost workspace exposes invoice library groups by dish, day, and week', () => {
    const workspace = buildRecipeCostWorkspace({
        recipe: {
            name: 'Preview Carrot Plate',
            ingredients: [
                { name: 'Carrot', qty: 4.8, unit: 'kg' },
                { name: 'Smoked Garlic Oil', qty: 180, unit: 'ml' }
            ]
        },
        invoicePackets: INVOICE_INGEST_PREVIEW_HISTORY,
        portionCount: 24
    });

    return assert(
        workspace.invoiceLibrary.byDish[0]?.label === 'Preview Carrot Plate'
        && workspace.invoiceLibrary.byDish[0]?.entries.length === 2
        && workspace.invoiceLibrary.byDay.length >= 2
        && workspace.invoiceLibrary.byWeek[0]?.entries.length >= 1,
        `Expected invoice library groupings to stay available by dish, day, and week (${JSON.stringify(workspace.invoiceLibrary)})`
    );
});

runTest('Production task engine blocks prep when recipe truth is missing yield', () => {
    const recipes = [
        {
            recipe_ref_id: 'missing-yield-ref',
            canonical_id: 'missing-yield-canon',
            name: 'Untrusted Prep Base',
            dishStyle: 'sauce prep',
            baseYield: 0,
            unit: 'ml',
            ingredients: [{ name: 'Water', qty: 1000, unit: 'ml' }]
        }
    ];
    const plan = generateProductionTasks({
        recipes,
        dailyProduction: { 'missing-yield-ref': 1000 },
        portionsPerBatch: 10
    });
    const task = plan.tasks.find((item) => item.recipeKey === 'missing-yield-ref');

    return assert(
        task?.truthState === 'truth blocked' &&
        task?.isTruthBlocked === true &&
        task?.readinessState === 'truth blocked' &&
        task?.scaleFactor === 0 &&
        task?.batchCount === 0 &&
        task?.reasons?.[0] === 'Recipe scale pending recipe truth correction',
        `Missing base yield should block prep execution (${JSON.stringify(task)})`
    );
});

console.log('\n--- VALIDATION SUMMARY ---');
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${totalTests - passedTests}`);

if (passedTests === totalTests) {
    console.log(`${colors.pass}✨ ALL TESTS PASSED${colors.reset}`);
    process.exit(0);
} else {
    console.error(`${colors.fail}❌ SOME TESTS FAILED${colors.reset}`);
    process.exit(1);
}
