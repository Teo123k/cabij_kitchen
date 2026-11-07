import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { getPortionSize, getStandardBatchYield, isSauceLikeRecipe } from './core/batch';
import { formatQuantity as coreFormatQuantity } from './core/units';
import { calculateBOM } from './core/BOMEngine';
import { buildPrepActionAvailability, buildPrepCalendarPressure, buildPrepScheduleLane, buildPrepTaskCategoryLanes, buildPrepTaskFocusList, buildPrepTaskSessionDetail, generateProductionTasks, resolvePrepFocusTarget, resolvePrepPlanForTask } from './core/productionTaskEngine';
import { resolveRecipeId } from './core/sku';
import { useSettings } from './SettingsContext';
import {
    buildAuthScopeState,
    buildGeneratedProfileReviewState,
    buildIdentitySessionState,
    buildOperationalObservabilityItems,
    buildOperationalStateCopy,
    buildRecipeBrowseGroups,
    buildRoleWorkspaceConfig,
    buildRecipeOperationalIndex,
    buildRecipeSearchIndexEntry,
    buildRecipeTrainingExecutionSupport,
    buildRecipeTrainingManagerSupport,
    buildTrainingReadinessWorkspace,
    canonicalizeRecipeTaxonomy,
    DASHBOARD_VIEWS,
    MANAGER_APPROVAL_ROLE_KEYS,
    NEXT_ACTION_MESSAGES,
    UNIT_SYSTEMS,
    DB_FIELDS,
    OFFLINE_CACHE_TYPES,
    OFFLINE_STATE,
    OFFLINE_QUEUE_TYPES,
    buildRecipeTrainingSupport,
    buildRecipeCostWorkspace,
    buildRecipeLookupAliases,
    getRecipeLookupKey,
    INVOICE_INGEST_PREVIEW_HISTORY,
    normalizeRecipeExtendedProfileRecord,
    normalizeRecipeInstructions,
    normalizeRecipePrepProfileRecord,
    normalizeSupabaseRecipeRecord,
    normalizeRecipeLookupValue,
    resolveWorkflow2PrepCardRows,
    resolveWorkflow2PrepDetailRows,
    mergeRecipeWithExtendedProfile,
    mergeRecipeWithPrepProfile,
    recipeMatchesLookup,
    RECIPE_SOURCE,
    resolveRecipeBrowseGroup,
    scoreRecipeSearchIndex,
} from './config/constants';
import { readOfflineCache, saveOfflineCache } from './config/offlineState';
import {
    buildRecipesTableWritePayload,
    buildRecipeFreshnessMarker,
    buildQueuedRecipeEntry,
    appendRecipeProfileAuditEvent,
    getQueuedRecipeBaseFreshness,
    isLocalQueueRecipeId,
    markQueueEntriesForApproval,
    markQueueEntrySyncResult,
    markUnapprovedEntriesAsApprovalRequired,
    mergeRecipesWithQueue,
    parseRecipesSqlSeed,
    recipeFreshnessMatches,
    readOfflineQueue,
    saveOfflineQueue,
    sanitizeQueuedRecipe,
    summarizeOfflineQueue,
} from './config/offlineQueue';
import { Zap, RotateCcw, Check, FileOutput, FileText, Download, X, Search } from 'lucide-react';
import RecipeSelector from './components/RecipeSelector';
import RecipeMetaPanel from './components/RecipeMetaPanel';
import ProfileReviewCard from './components/ProfileReviewCard';
import RecipeVersionReview from './components/RecipeVersionReview';
import {
    DashboardTopStatusChips,
    DashboardManagerQueuePage,
} from './components/DashboardSections';

const MANAGER_APPROVAL_ROLES = new Set(MANAGER_APPROVAL_ROLE_KEYS);
const CABIJ_WORKFLOW_VIEWS = [
    { id: DASHBOARD_VIEWS.SCALER, label: 'Recipe Truth' },
    { id: DASHBOARD_VIEWS.BOARD, label: 'Prep Board' },
    { id: DASHBOARD_VIEWS.PRESENTATION, label: 'SOP Training' },
    { id: DASHBOARD_VIEWS.ORDERING, label: 'BOM / Cost' },
    { id: DASHBOARD_VIEWS.MANAGER, label: 'Approvals' },
    { id: DASHBOARD_VIEWS.SETTINGS, label: 'Settings' },
];

const WORKFLOW_COPY = {
    [DASHBOARD_VIEWS.SCALER]: 'Single-source recipe truth with scale, ingredients, and setup metadata.',
    [DASHBOARD_VIEWS.BOARD]: 'Chef execution lane for now, next, then, and blocked station pressure.',
    [DASHBOARD_VIEWS.PRESENTATION]: 'Recipe-linked staff training that stays tied to approved truth.',
    [DASHBOARD_VIEWS.ORDERING]: 'Protected cost workflow with invoice sources, match confidence, and human review.',
    [DASHBOARD_VIEWS.MANAGER]: 'Manager decision room for pending, blocked, and conflict changes.',
    [DASHBOARD_VIEWS.SETTINGS]: 'Manager-only prep portion rules that change prep output without changing recipe truth.',
    [DASHBOARD_VIEWS.PREP_SETUP]: 'Popup scheduling flow for adding the current recipe to the prep board.'
};

const WORKFLOW_VIEW_LABELS = {
    [DASHBOARD_VIEWS.SCALER]: 'Recipe Truth',
    [DASHBOARD_VIEWS.BOARD]: 'Prep Board',
    [DASHBOARD_VIEWS.PRESENTATION]: 'SOP Training',
    [DASHBOARD_VIEWS.ORDERING]: 'BOM / Cost',
    [DASHBOARD_VIEWS.MANAGER]: 'Approvals',
    [DASHBOARD_VIEWS.SETTINGS]: 'Settings',
    [DASHBOARD_VIEWS.PREP_SETUP]: 'Prep Add',
};

const WORKFLOW_PANEL_IDS = {
    [DASHBOARD_VIEWS.SCALER]: 'cabij-view-scaler-main',
    [DASHBOARD_VIEWS.BOARD]: 'cabij-view-board',
    [DASHBOARD_VIEWS.PRESENTATION]: 'cabij-view-presentation',
    [DASHBOARD_VIEWS.ORDERING]: 'cabij-view-ordering',
    [DASHBOARD_VIEWS.MANAGER]: 'cabij-view-manager',
    [DASHBOARD_VIEWS.SETTINGS]: 'cabij-view-settings',
    [DASHBOARD_VIEWS.PREP_SETUP]: 'cabij-view-prep-setup',
};

const PREP_PORTION_RULE_FIELDS = [
    { key: 'prepMainPortionSize', label: 'Main', copy: 'Prep-only portion size for mains.' },
    { key: 'prepStarterPortionSize', label: 'Starter / Salad', copy: 'Prep-only portion size for starters and salads.' },
    { key: 'prepComponentPortionSize', label: 'Small component', copy: 'Prep-only portion size for supporting components.' },
    { key: 'prepDipPortionSize', label: 'Sauce dip', copy: 'Prep-only portion size for dips and sauces.' },
    { key: 'prepMarinadePortionSize', label: 'Marinade', copy: 'Prep-only portion size for marinades.' }
];

const parseKitchenPortionRules = (row = {}) => {
    const portionRules = row && typeof row.portion_rules === 'object' && !Array.isArray(row.portion_rules)
        ? row.portion_rules
        : {};
    const toPositiveInt = (value, fallback) => {
        const next = Number(value || 0);
        return Number.isFinite(next) && next > 0 ? Math.round(next) : fallback;
    };

    return {
        prepMainPortionSize: toPositiveInt(portionRules.main_g, 295),
        prepStarterPortionSize: toPositiveInt(portionRules.starter_g, 165),
        prepComponentPortionSize: toPositiveInt(portionRules.component_g ?? portionRules.side_g, 80),
        prepDipPortionSize: toPositiveInt(portionRules.dip_g ?? portionRules.sauce_g, 50),
        prepMarinadePortionSize: toPositiveInt(portionRules.marinade_g, 110)
    };
};

const buildKitchenProfilePortionRules = (draft = {}) => ({
    main_g: Math.round(Number(draft.prepMainPortionSize || 0)),
    starter_g: Math.round(Number(draft.prepStarterPortionSize || 0)),
    component_g: Math.round(Number(draft.prepComponentPortionSize || 0)),
    side_g: Math.round(Number(draft.prepComponentPortionSize || 0)),
    dip_g: Math.round(Number(draft.prepDipPortionSize || 0)),
    sauce_g: Math.round(Number(draft.prepDipPortionSize || 0)),
    marinade_g: Math.round(Number(draft.prepMarinadePortionSize || 0))
});

const moveWorkflowFocus = (viewId) => {
    requestAnimationFrame(() => {
        const panel = document.getElementById(WORKFLOW_PANEL_IDS[viewId]);
        if (!panel || !(panel instanceof HTMLElement)) return;
        panel.scrollTop = 0;
        panel.focus?.({ preventScroll: true });
    });
};

const COMMAND_PRIORITY_LABELS = ['Now', 'Next', 'Then', 'Watch'];
const COMMAND_TIMELINE_STEP_MINUTES = 15;
const RECENT_RECIPE_ACTIVITY_STORAGE_PREFIX = 'cabij:recent-recipe-activity:v1';
const TRAINING_PROGRESS_STORAGE_PREFIX = 'cabij:training-progress:v1';
const PREP_SCHEDULE_VIEWS = {
    TODAY: 'today',
    WEEK: 'week',
    MONTH: 'month',
};
const PREP_FOCUS_MODES = {
    BOARD: 'board',
    NEXT: 'next',
    DAY_PART: 'daypart',
    PICKED: 'picked',
};
const PREP_BOARD_GROUPINGS = {
    STATION: 'station',
    TASK: 'task',
    URGENT: 'urgent',
};
const TRAINING_VIEW_MODES = {
    STAFF: 'staff',
    MANAGER: 'manager',
};
const normalizeTrainingAssignmentDraft = (value = '') => (
    String(value || '')
        .split(/[\n,;/]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
);
const COST_LIBRARY_GROUPINGS = {
    DISH: 'dish',
    DAY: 'day',
    WEEK: 'week',
};
const PREP_WEEKDAY_SHORT_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const PREP_WEEKDAY_LONG_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PREP_DAY_PART_SEQUENCE = [
    { key: 'morning', label: 'Morning', maxPrimarySlots: 2 },
    { key: 'afternoon', label: 'Afternoon', maxPrimarySlots: 1 },
    { key: 'before_service', label: 'Before service', maxPrimarySlots: 1 }
];
const SERVICE_BRIEF_FIELDS = [
    {
        key: 'bookingContext',
        label: 'Booking context',
        placeholder: '2 birthdays at 7pm / large 12-top arriving early'
    },
    {
        key: 'guestMix',
        label: 'Guest mix',
        placeholder: 'Many vegan and vegetarian guests tonight'
    },
    {
        key: 'dietaryAlerts',
        label: 'Dietary alerts',
        placeholder: '1 shellfish allergy / 2 gluten-free guests'
    },
    {
        key: 'pushFirst',
        label: 'Push first',
        placeholder: 'Fryer and rolls first'
    }
];

const getKitchenWeekdayIndex = (date = new Date()) => {
    const jsDay = Number(date.getDay());
    return jsDay === 0 ? 6 : jsDay - 1;
};

const getFirstFiniteNumber = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) return numericValue;
    }
    return null;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeNameForLookup = (value) => normalizeRecipeLookupValue(value);

const formatPrepPlanDaySummary = ({ days = [], anyDay = false }) => {
    if (anyDay) return 'Any day';
    if (!Array.isArray(days) || days.length === 0) return 'No day selected';
    return days
        .map((dayIndex) => PREP_WEEKDAY_LONG_LABELS[dayIndex] || PREP_WEEKDAY_SHORT_LABELS[dayIndex] || '?')
        .join(', ');
};

const buildServiceBriefPreview = (serviceBrief = {}) => (
    SERVICE_BRIEF_FIELDS.map((field) => {
        const value = String(serviceBrief?.[field.key] || '').trim();
        if (!value) return '';
        return `${field.label}: ${value}`;
    }).filter(Boolean)
);

const getPrepStorageLifeLabelFromTask = (task = {}) => {
    const storageWindow = normalizeText(getWorkflow2PrepStorageLabel(task) || task?.prepStorageWindow || '');
    if (!storageWindow) return 'N';
    if (/(same day|same-day|use same day|today)/.test(storageWindow)) return '1 day';
    const numericMatch = storageWindow.match(/(\d+)\s*(day|days|hour|hours|week|weeks)/i);
    if (numericMatch) {
        const amount = numericMatch[1];
        const unit = numericMatch[2].toLowerCase();
        return `${amount} ${unit.endsWith('s') ? unit : (amount === '1' ? unit : `${unit}s`)}`;
    }
    return 'N';
};

const parseStorageLifeToHours = (label = '') => {
    const normalized = String(label || '').trim().toLowerCase();
    if (!normalized || normalized === 'n') return null;
    const match = normalized.match(/(\d+)\s*(hour|hours|day|days|week|weeks)/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = String(match[2] || '').toLowerCase();
    if (!Number.isFinite(amount)) return null;
    if (unit.startsWith('hour')) return amount;
    if (unit.startsWith('day')) return amount * 24;
    if (unit.startsWith('week')) return amount * 24 * 7;
    return null;
};

const formatPrepWeightValue = (value = 0, unit = '') => {
    const numericValue = Number(value || 0);
    const normalizedUnit = String(unit || '').trim();
    if (!(numericValue > 0)) return '';
    const roundedValue = numericValue >= 100 ? Math.round(numericValue) : Number(numericValue.toFixed(2));
    return normalizedUnit ? `${roundedValue} ${normalizedUnit}` : `${roundedValue}`;
};

const buildPrepWeightSummary = (tasks = []) => {
    const totalsByUnit = tasks.reduce((acc, task) => {
        const numericValue = Number(task?.targetYield || 0);
        const unit = String(task?.unit || '').trim() || 'unit';
        if (!(numericValue > 0)) return acc;
        acc[unit] = (acc[unit] || 0) + numericValue;
        return acc;
    }, {});

    const entries = Object.entries(totalsByUnit)
        .filter(([, total]) => Number(total || 0) > 0)
        .map(([unit, total]) => formatPrepWeightValue(total, unit === 'unit' ? '' : unit))
        .filter(Boolean);

    return entries.length > 0 ? entries.join(' / ') : 'N';
};

const INGREDIENT_CATEGORY_OPTIONS = [
    'Sauce',
    'Wet',
    'Dry',
    'Grain',
    'Meat',
    'Vegetable',
    'Aromatic',
    'Spice',
    'Fat',
    'Other'
];

const INGREDIENT_CATEGORY_ORDER = {
    Sauce: 0,
    Wet: 1,
    Dry: 2,
    Grain: 3,
    Meat: 4,
    Vegetable: 5,
    Aromatic: 6,
    Spice: 7,
    Fat: 8,
    Other: 9
};

const normalizeIngredientCategoryLabel = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'general') return '';
    if (['wet', 'liquid', 'wet / liquid'].includes(normalized)) return 'Wet';
    if (['sauce', 'dressing', 'marinade'].includes(normalized)) return 'Sauce';
    if (['dry', 'base', 'powder'].includes(normalized)) return 'Dry';
    if (['grain', 'rice', 'noodle', 'pasta'].includes(normalized)) return 'Grain';
    if (['meat', 'protein'].includes(normalized)) return 'Meat';
    if (['veg', 'vegetable'].includes(normalized)) return 'Vegetable';
    if (['aromatic'].includes(normalized)) return 'Aromatic';
    if (['spice', 'seasoning'].includes(normalized)) return 'Spice';
    if (['fat', 'oil', 'butter'].includes(normalized)) return 'Fat';
    if (['other'].includes(normalized)) return 'Other';
    return String(value || '').trim().replace(/\b\w/g, (token) => token.toUpperCase());
};

const inferIngredientCategoryLabel = (ingredient = {}) => {
    const explicitCategory = normalizeIngredientCategoryLabel(
        ingredient?.category || ingredient?.ingredient_category || ingredient?.group || ingredient?.cat || ''
    );
    if (explicitCategory) return explicitCategory;

    const combined = `${ingredient?.name || ''} ${ingredient?.unit || ''}`.toLowerCase();
    if (/(soy sauce|fish sauce|oyster sauce|hot sauce|sauce|dressing|mayo|mayonnaise|aioli|paste|gochujang|miso)/.test(combined)) return 'Sauce';
    if (/(water|stock|broth|vinegar|mirin|wine|juice|milk|cream|oil)/.test(combined)) return 'Wet';
    if (/(rice|grain|quinoa|barley|oat|noodle|pasta|flour)/.test(combined)) return 'Grain';
    if (/(beef|pork|chicken|lamb|fish|salmon|tuna|meat|shrimp|prawn)/.test(combined)) return 'Meat';
    if (/(garlic|ginger|shallot|onion|scallion|spring onion|leek|celery)/.test(combined)) return 'Aromatic';
    if (/(carrot|cabbage|lettuce|herb|parsley|coriander|cilantro|mint|vegetable|veg)/.test(combined)) return 'Vegetable';
    if (/(pepper|paprika|cumin|turmeric|spice|seasoning|msg|salt|sugar|powder)/.test(combined)) return 'Spice';
    if (/(butter|fat|ghee)/.test(combined)) return 'Fat';
    if (/(g|kg)\b/.test(String(ingredient?.unit || '').toLowerCase())) return 'Dry';
    return 'Other';
};

const getDependencyPriority = (task) => ({
    dependencyPriority: Number(task?.dependencyPriority || 0),
    dependencyCount: Number(task?.dependencies?.length || 0),
    shortagePriority: Number(task?.shortagePriority || 0),
    truthPriority: Number(task?.truthPriority || 0),
    taskStatePriority: Number(task?.taskStatePriority || 0),
    operationalPriority: Number(task?.operationalPriority || Number(task?.taskStatePriority || 0)),
    isDependencyBlocked: Boolean(task?.isDependencyBlocked),
    isTruthBlocked: Boolean(task?.isTruthBlocked),
    isOverdueRisk: Boolean(task?.isOverdueRisk),
    hasChangedDependency: Boolean(task?.hasChangedDependency),
    taskState: String(task?.taskState || '').trim()
});

const getDependencyStateLabel = (task) => {
    const taskState = task?.taskState;
    if (typeof taskState === 'string' && taskState.trim()) {
        return taskState.trim();
    }

    const readinessState = task?.readinessState;
    if (typeof readinessState === 'string' && readinessState.trim()) {
        return readinessState.trim();
    }

    const dependencyState = task?.dependencyState;
    if (typeof dependencyState === 'string' && dependencyState.trim()) {
        return dependencyState.trim();
    }

    const dependencyPriority = Number(task?.dependencyPriority || 0);
    return dependencyPriority === 0
        ? 'ready'
        : (dependencyPriority === 1 ? 'dependent' : 'blocked');
};

const isDependencyBlocked = (task) => {
    const order = getDependencyPriority(task);
    return order.taskState === 'waiting approval'
        || order.isTruthBlocked
        || order.isDependencyBlocked
        || (order.dependencyPriority === 2)
        || (order.dependencyCount > 0 && order.dependencyPriority === 2);
};

const compareTaskReadiness = (firstTask, secondTask) => {
    const firstOrder = getDependencyPriority(firstTask);
    const secondOrder = getDependencyPriority(secondTask);
    return (
        (firstOrder.operationalPriority - secondOrder.operationalPriority)
        || (Number(secondOrder.shortagePriority || 0) - Number(firstOrder.shortagePriority || 0))
        || (Number(secondOrder.isOverdueRisk) - Number(firstOrder.isOverdueRisk))
        || (Number(secondOrder.hasChangedDependency) - Number(firstOrder.hasChangedDependency))
        || (firstOrder.truthPriority - secondOrder.truthPriority)
        || (firstOrder.dependencyPriority - secondOrder.dependencyPriority)
        || (firstOrder.dependencyCount - secondOrder.dependencyCount)
        || (Number(firstOrder.dependencyDepth || 0) - Number(secondOrder.dependencyDepth || 0))
        || String(firstTask?.name || '').localeCompare(String(secondTask?.name || ''))
    );
};

const getCommandTaskStateRank = (task) => {
    const taskState = String(task?.taskState || '').trim();
    if (taskState === 'ready now') return 0;
    if (taskState === 'ready after dependency') return 1;
    if (taskState === 'changed') return 2;
    if (taskState === 'waiting approval') return 3;
    if (taskState === 'truth review') return 4;
    if (taskState === 'blocked') return 5;
    if (taskState === 'truth blocked') return 6;
    return 7;
};

const compareCommandTaskReadiness = (firstTask, secondTask) => {
    const commandStateRank = getCommandTaskStateRank(firstTask) - getCommandTaskStateRank(secondTask);
    if (commandStateRank !== 0) return commandStateRank;
    const compareReadiness = compareTaskReadiness(firstTask, secondTask);
    if (compareReadiness !== 0) return compareReadiness;
    return (Number(firstTask?.targetYield || 0) - Number(secondTask?.targetYield || 0))
        || String(firstTask?.name || '').localeCompare(String(secondTask?.name || ''));
};

const formatClockLabel = (valueMinutes) => {
    const totalMinutes = (valueMinutes % 1440 + 1440) % 1440;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const normalizedHour = String(hour).padStart(2, '0');
    const normalizedMinute = String(minute).padStart(2, '0');
    return `${normalizedHour}:${normalizedMinute}`;
};

const buildClockTimeFromNow = (slotIndex, reference = new Date()) => {
    const nowMinutes = reference.getHours() * 60 + reference.getMinutes();
    const alignedMinutes = Math.ceil(nowMinutes / COMMAND_TIMELINE_STEP_MINUTES) * COMMAND_TIMELINE_STEP_MINUTES;
    return formatClockLabel(alignedMinutes + slotIndex * COMMAND_TIMELINE_STEP_MINUTES);
};

const getPrepWindowLabel = (task = {}, slotIndex = 0) => {
    const explicitLeadTime = normalizeText(task?.prepLeadTime);
    if (explicitLeadTime.includes('morning first')) return 'Morning first';
    if (explicitLeadTime.includes('morning') || explicitLeadTime.includes('day before') || explicitLeadTime.includes('previous day')) return 'Morning';
    if (explicitLeadTime.includes('afternoon')) return 'Afternoon';
    if (/(before[\s_-]*service|service finish|final|handoff)/.test(explicitLeadTime)) return 'Before service';
    const phasePriority = Number(task?.schedulePhasePriority ?? 2);
    if (phasePriority <= 0) return slotIndex === 0 ? 'Morning first' : 'Morning';
    if (phasePriority === 1) return 'Afternoon';
    return 'Before service';
};

const getPrepStageGroup = (task = {}) => {
    const explicitLeadTime = normalizeText(task?.prepLeadTime);
    if (explicitLeadTime.includes('morning') || explicitLeadTime.includes('day before') || explicitLeadTime.includes('previous day')) {
        return { key: 'morning', label: 'Morning' };
    }
    if (explicitLeadTime.includes('afternoon')) {
        return { key: 'afternoon', label: 'Afternoon' };
    }
    if (/(before[\s_-]*service|service finish|final|handoff)/.test(explicitLeadTime)) {
        return { key: 'before_service', label: 'Before service' };
    }

    const phasePriority = Number(task?.schedulePhasePriority ?? 2);
    if (phasePriority <= 0) return { key: 'morning', label: 'Morning' };
    if (phasePriority === 1) return { key: 'afternoon', label: 'Afternoon' };
    return { key: 'before_service', label: 'Before service' };
};

const PREP_STATION_GROUP_ORDER = ['Cold Dish', 'Grill Station', 'Soup Station', 'Roll Station', 'Fryer Station', 'Pizza Station', 'Dessert', 'General Prep'];
const PREP_SERVICE_STATION_GROUP_ORDER = ['Grill Section', 'Fryer Station', 'Roll Station', 'Salad Station', 'Soup Station', 'Pizza Station', 'General Service'];
const PREP_TASK_GROUP_ORDER = ['Meat Prep', 'Veg Prep', 'Sauce', 'General Task'];
const PREP_SERVICE_TASK_GROUP_ORDER = ['Garnish', 'Sauce Ready', 'Reheat Check', 'General Service'];
const PREP_SERVICE_URGENT_GROUP_ORDER = PREP_SERVICE_STATION_GROUP_ORDER;

const toWorkflow2TextList = (value, depth = 0) => {
    if (depth > 2 || value === null || value === undefined) return [];
    if (Array.isArray(value)) {
        return value.flatMap((item) => toWorkflow2TextList(item, depth + 1));
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value || '').trim();
        return text ? [text] : [];
    }
    if (typeof value === 'object') {
        return Object.values(value).flatMap((item) => toWorkflow2TextList(item, depth + 1));
    }
    return [];
};

const pickFirstWorkflow2TextList = (...candidates) => {
    for (const candidate of candidates) {
        const values = toWorkflow2TextList(candidate).filter(Boolean);
        if (values.length > 0) return [...new Set(values)];
    }
    return [];
};

const getTaskWorkflow2PrepProfile = (task = {}) => task?.workflow2PrepProfile || task?.prepProfile || null;

const getWorkflow2ExecutionTaskRows = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    const methodProfile = getTaskWorkflow2MethodProfile(task);
    const fallbackProfile = methodProfile === (prepProfile?.largeProfile || prepProfile?.large_profile || null)
        ? (prepProfile?.regularProfile || prepProfile?.regular_profile || null)
        : (prepProfile?.largeProfile || prepProfile?.large_profile || null);
    return resolveWorkflow2PrepDetailRows({
        prepProfile,
        methodProfile,
        fallbackProfile
    });
};

const shouldUseWorkflow2LargeProfile = (task = {}) => {
    const profile = getTaskWorkflow2PrepProfile(task);
    const scaleRule = profile?.scaleRule || profile?.scale_rule || {};
    const estimatedPortions = Number(task?.estimatedPortions || 0);
    if (estimatedPortions > 50) return true;
    const explicitProfile = String(
        scaleRule?.active_profile
        || scaleRule?.activeProfile
        || scaleRule?.profile
        || scaleRule?.selected_profile
        || scaleRule?.selectedProfile
        || ''
    ).trim().toLowerCase();

    if (['large', 'event', 'batch'].includes(explicitProfile)) return true;
    if (['regular', 'normal'].includes(explicitProfile)) return false;

    const scaleBucket = String(
        scaleRule?.scale_bucket
        || scaleRule?.scaleBucket
        || scaleRule?.bucket
        || ''
    ).trim().toLowerCase();
    if (['large', 'event', 'batch'].includes(scaleBucket)) return true;
    if (['regular', 'normal'].includes(scaleBucket)) return false;

    const largeThreshold = getFirstFiniteNumber(
        scaleRule?.large_min_expected_portions,
        scaleRule?.largeMinExpectedPortions,
        scaleRule?.large_threshold_portions,
        scaleRule?.largeThresholdPortions,
        scaleRule?.large_min_portions,
        scaleRule?.largeMinPortions
    );
    if (largeThreshold !== null && estimatedPortions > 0) {
        return estimatedPortions >= largeThreshold;
    }

    return String(task?.methodVariant || '').trim() === 'batch';
};

const splitPrepDisplayText = (value = '') => {
    const normalized = String(value || '')
        .replace(/\r/g, '\n')
        .replace(/\s*[•●▪]\s*/g, '\n')
        .replace(/\s*;\s*/g, '\n')
        .replace(/(?:^|\s)(\d+[\.\)])\s+/g, '\n$1 ')
        .trim();

    if (!normalized) return [];

    return normalized
        .split(/\n+/)
        .flatMap((line) => {
            const trimmed = String(line || '').replace(/^\s*\d+[\.\)]\s*/, '').trim();
            if (!trimmed) return [];
            if (trimmed.length <= 110 && !/[.;]\s+/.test(trimmed)) return [trimmed];
            return trimmed
                .split(/(?<=[.;!?])\s+(?=[A-Z0-9])/)
                .map((segment) => segment.replace(/^\s*\d+[\.\)]\s*/, '').trim())
                .filter(Boolean);
        })
        .map((line) => compactPrepCopy(line, 140))
        .filter(Boolean);
};

const lineHasEmbeddedQuantity = (value = '') => /\b\d+(?:[.,]\d+)?\s*(kg|g|gram|grams|ml|l|liter|litre|oz|lb|lbs|pcs|piece|pieces)\b/i.test(String(value || ''));

const injectIngredientQuantityIntoLine = (line = '', ingredientRows = []) => {
    const baseLine = String(line || '').trim();
    if (!baseLine || lineHasEmbeddedQuantity(baseLine)) return baseLine;

    const matchingIngredient = (Array.isArray(ingredientRows) ? ingredientRows : []).find((ingredient) => {
        const name = String(ingredient?.name || '').trim();
        const quantity = String(ingredient?.quantity || '').trim();
        if (!name || !quantity) return false;
        return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(baseLine);
    });

    if (!matchingIngredient) return baseLine;

    const quantityLabel = [matchingIngredient.quantity, matchingIngredient.unit].filter(Boolean).join(' ').trim();
    if (!quantityLabel) return baseLine;

    const ingredientPattern = new RegExp(`\\b(${String(matchingIngredient.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
    return baseLine.replace(ingredientPattern, `$1 ${quantityLabel}`);
};

const shortenPrepCardLine = (line = '') => {
    const normalizedLine = String(line || '')
        .replace(/^(please|carefully|gently)\s+/i, '')
        .replace(/^(make sure to|ensure you|be sure to)\s+/i, '')
        .replace(/^(then|next|after that)\s+/i, '')
        .replace(/^(prep|cook|finish(?:\/serve)?|assemble|label|store)\s*:\s*/i, '')
        .replace(/\bI\s+(prep|cook|finish(?:\/serve)?|assemble|label|store)\s*:/gi, '')
        .replace(/\bprep all ingredients\s*:/gi, '')
        .replace(/\bmethodology\s*:/gi, '')
        .replace(/\bfor service\b/gi, '')
        .replace(/\bwhen finished\b/gi, 'when done')
        .replace(/\s+/g, ' ')
        .trim();

    const firstSegment = normalizedLine
        .split(/\s+\|\s+/)[0]
        .split(/\s+(?=I\s+(?:prep|cook|finish(?:\/serve)?|assemble|label|store)\s*:)/i)[0]
        .split(/\s+(?=Prep all ingredients\s*:)/i)[0]
        .split(/\s+(?=Methodology\s*:)/i)[0]
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)[0]
        .trim();

    return firstSegment
        .replace(/[;:.,\s]+$/g, '')
        .trim();
};

const getTaskWorkflow2MethodProfile = (task = {}) => {
    const profile = getTaskWorkflow2PrepProfile(task);
    if (!profile) return null;
    if (shouldUseWorkflow2LargeProfile(task)) {
        return profile?.largeProfile || profile?.large_profile || profile?.regularProfile || profile?.regular_profile || null;
    }
    return profile?.regularProfile || profile?.regular_profile || profile?.largeProfile || profile?.large_profile || null;
};

const getWorkflow2PrepTaskBullets = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    const executionTaskRows = getWorkflow2ExecutionTaskRows(task);
    const strictCardRows = resolveWorkflow2PrepCardRows({
        prepProfile,
        executionTaskRows
    });
    if (strictCardRows.length > 0) {
        return strictCardRows.slice(0, 4);
    }

    const methodProfile = getTaskWorkflow2MethodProfile(task);
    return pickFirstWorkflow2TextList(
        methodProfile?.task_bullets,
        methodProfile?.taskBullets,
        methodProfile?.execution_steps,
        methodProfile?.executionSteps,
        methodProfile?.steps,
        methodProfile?.actions,
        methodProfile?.prep_steps,
        methodProfile?.prepSteps,
        prepProfile?.uiOutput?.task_bullets,
        prepProfile?.uiOutput?.taskBullets,
        prepProfile?.uiOutput?.execution_steps,
        prepProfile?.uiOutput?.executionSteps,
        prepProfile?.uiOutput?.steps,
        prepProfile?.ui_output?.task_bullets,
        prepProfile?.ui_output?.taskBullets,
        prepProfile?.ui_output?.execution_steps,
        prepProfile?.ui_output?.executionSteps,
        prepProfile?.ui_output?.steps
    ).slice(0, 4);
};

const getPrepBoardTaskRows = (task = {}) => {
    const workflow2Rows = getWorkflow2ExecutionTaskRows(task);
    if (workflow2Rows.length > 0) {
        return workflow2Rows.map((row, index) => ({
            ...row,
            id: row?.id || `wf2-task-${index}`,
            taskName: String(row?.taskName || '').trim()
        })).filter((row) => row.taskName);
    }

    const fallbackBullets = (Array.isArray(task?.execution_steps) ? task.execution_steps : [])
        .flatMap((step) => splitPrepDisplayText(step))
        .filter(Boolean)
        .slice(0, 8);

    if (fallbackBullets.length > 0) {
        return fallbackBullets.map((taskName, index) => ({
            id: `fallback-task-${index}`,
            taskName,
            estimatedMinutes: index === 0 && Number(task?.prepTimeMinutes || 0) > 0 ? Number(task.prepTimeMinutes) : null,
            category: '',
            skillLevel: ''
        }));
    }

    return [{
        id: 'fallback-task-0',
        taskName: compactPrepCopy(task?.reasons?.[0] || 'Prep task', 88),
        estimatedMinutes: Number(task?.prepTimeMinutes || 0) > 0 ? Number(task.prepTimeMinutes) : null,
        category: '',
        skillLevel: ''
    }];
};

const getDisplayPrepTaskRows = (task = {}, ingredientRows = []) => (
    getPrepBoardTaskRows(task).map((row, index) => ({
        ...row,
        taskName: injectIngredientQuantityIntoLine(row?.taskName || '', ingredientRows),
        sourceIndexes: Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0 ? row.sourceIndexes : [index]
    }))
);

const summarizePrepCardChunk = (rows = [], chunkIndex = 0) => {
    const normalizedRows = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            taskName: shortenPrepCardLine(row?.taskName || ''),
            sourceIndexes: Array.isArray(row?.sourceIndexes) ? row.sourceIndexes : []
        }))
        .filter((row) => row.taskName)
        .map((row) => row)
        .filter(Boolean);

    const joinedSourceIndexes = [...new Set(
        normalizedRows.flatMap((row) => row.sourceIndexes || [])
    )];

    if (normalizedRows.length === 0) return null;
    if (normalizedRows.length === 1) {
        return {
            id: `prep-card-summary-${chunkIndex}`,
            taskName: normalizedRows[0].taskName,
            sourceIndexes: joinedSourceIndexes
        };
    }

    const summary = normalizedRows
        .map((row) => row.taskName)
        .filter(Boolean);
    return {
        id: `prep-card-summary-${chunkIndex}`,
        taskName: summary.join(' | '),
        sourceIndexes: joinedSourceIndexes
    };
};

const resolvePrepCardSourceIndexes = (taskName = '', detailRows = [], usedIndexSet = new Set()) => {
    const normalizedTaskName = shortenPrepCardLine(taskName || '');
    if (!normalizedTaskName) return [];

    const detailCandidates = (Array.isArray(detailRows) ? detailRows : []).map((row, index) => ({
        index,
        taskName: shortenPrepCardLine(row?.taskName || ''),
        sourceIndexes: Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0
            ? row.sourceIndexes
            : [index]
    }));

    const exactMatch = detailCandidates.find((candidate) => (
        !usedIndexSet.has(candidate.index)
        && candidate.taskName
        && candidate.taskName === normalizedTaskName
    ));
    if (exactMatch) {
        usedIndexSet.add(exactMatch.index);
        return [...new Set(exactMatch.sourceIndexes)];
    }

    const looseMatch = detailCandidates.find((candidate) => (
        !usedIndexSet.has(candidate.index)
        && candidate.taskName
        && (candidate.taskName.includes(normalizedTaskName) || normalizedTaskName.includes(candidate.taskName))
    ));
    if (looseMatch) {
        usedIndexSet.add(looseMatch.index);
        return [...new Set(looseMatch.sourceIndexes)];
    }

    return [];
};

const getPrepCardTaskRows = (task = {}, ingredientRows = []) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    const executionTaskRows = getWorkflow2ExecutionTaskRows(task);
    const strictCardRows = resolveWorkflow2PrepCardRows({
        prepProfile,
        executionTaskRows
    });
    if (strictCardRows.length > 0) {
        const detailRows = getDisplayPrepTaskRows(task, ingredientRows);
        const usedIndexSet = new Set();
        return strictCardRows.slice(0, 4).map((taskName, index) => {
            const sourceIndexes = resolvePrepCardSourceIndexes(taskName, detailRows, usedIndexSet);
            const matchedDetailRow = detailRows.find((detailRow, detailIndex) => {
                const rowIndexes = Array.isArray(detailRow?.sourceIndexes) && detailRow.sourceIndexes.length > 0
                    ? detailRow.sourceIndexes
                    : [detailIndex];
                return rowIndexes.some((sourceIndex) => sourceIndexes.includes(sourceIndex));
            }) || {};
            return {
                ...matchedDetailRow,
                id: `prep-card-row-${task?.id || 'task'}-${index}`,
                taskName: shortenPrepCardLine(taskName),
                sourceIndexes
            };
        }).filter((row) => row.taskName);
    }

    const compactBaseRows = getPrepBoardTaskRows(task)
        .map((row, index) => ({
            ...row,
            id: row?.id || `prep-card-row-${task?.id || 'task'}-${index}`,
            taskName: shortenPrepCardLine(row?.taskName || ''),
            sourceIndexes: Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0 ? row.sourceIndexes : [index]
        }))
        .filter((row) => row.taskName);
    if (compactBaseRows.length > 0) {
        return compactBaseRows.slice(0, 4);
    }

    const detailRows = getDisplayPrepTaskRows(task, ingredientRows);
    if (detailRows.length <= 4) {
        return detailRows.map((row) => ({
            ...row,
            taskName: shortenPrepCardLine(row?.taskName || '')
        }));
    }

    const targetGroups = 4;
    const chunkSize = Math.ceil(detailRows.length / targetGroups);
    const summarizedRows = [];
    for (let index = 0; index < detailRows.length; index += chunkSize) {
        const chunk = detailRows.slice(index, index + chunkSize);
        const summaryRow = summarizePrepCardChunk(chunk, summarizedRows.length);
        if (summaryRow) summarizedRows.push(summaryRow);
    }
    return summarizedRows.slice(0, 4);
};

const getWorkflow2PrepStorageLabel = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    if (!prepProfile) return '';
    const storage = prepProfile?.storage || {};
    const methodKey = shouldUseWorkflow2LargeProfile(task) ? 'large' : 'regular';
    const scopedStorage = storage?.[methodKey] || storage?.profile || storage;
    const candidates = [
        scopedStorage?.storage_life,
        scopedStorage?.storageLife,
        scopedStorage?.shelf_life,
        scopedStorage?.shelfLife,
        scopedStorage?.storage_window,
        scopedStorage?.storageWindow,
        scopedStorage?.label,
        scopedStorage?.summary,
        storage?.storage_life,
        storage?.storageLife,
        storage?.storage_window,
        storage?.storageWindow,
        storage?.label,
        storage?.summary
    ];
    for (const candidate of candidates) {
        const text = String(candidate || '').trim();
        if (text) return text;
    }
    return '';
};

const getWorkflow2PrepCriticalChecks = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    return pickFirstWorkflow2TextList(
        prepProfile?.criticalChecks,
        prepProfile?.critical_checks
    ).slice(0, 5);
};

const getWorkflow2PrepFoodSafetyCcp = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    return pickFirstWorkflow2TextList(
        prepProfile?.foodSafetyCcp,
        prepProfile?.food_safety_ccp
    ).slice(0, 5);
};

const getWorkflow2PrepStorageMeta = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    if (!prepProfile) {
        return {
            label: '',
            shelfLifeHours: null
        };
    }

    const storage = prepProfile?.storage || {};
    const methodKey = shouldUseWorkflow2LargeProfile(task) ? 'large' : 'regular';
    const scopedStorage = storage?.[methodKey] || storage?.profile || storage;
    const label = [
        scopedStorage?.label,
        scopedStorage?.storage_life,
        scopedStorage?.storageLife,
        scopedStorage?.storage_window,
        scopedStorage?.storageWindow,
        storage?.label,
        storage?.storage_life,
        storage?.storageLife
    ].map((value) => String(value || '').trim()).find(Boolean) || '';
    const shelfLifeHours = getFirstFiniteNumber(
        scopedStorage?.shelf_life_hours,
        scopedStorage?.shelfLifeHours,
        storage?.shelf_life_hours,
        storage?.shelfLifeHours
    );

    return {
        label,
        shelfLifeHours
    };
};

const getWorkflow2PrepIntelligenceRows = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    const prepIntelligence = prepProfile?.prepIntelligence
        || prepProfile?.prep_intelligence
        || task?.prepIntelligence
        || task?.prep_intelligence
        || {};
    const leadTime = String(
        prepIntelligence?.leadTime
        || prepIntelligence?.lead_time
        || task?.prepLeadTime
        || ''
    ).trim();
    const makeAhead = String(
        prepIntelligence?.makeAhead
        || prepIntelligence?.make_ahead
        || task?.prepMakeAhead
        || ''
    ).trim();
    const handoffNote = String(
        prepIntelligence?.handoffNote
        || prepIntelligence?.handoff_note
        || task?.prepHandoffNote
        || ''
    ).trim();
    const prepTimeMinutes = getFirstFiniteNumber(
        prepIntelligence?.prepTimeMinutes,
        prepIntelligence?.prep_time_minutes,
        prepIntelligence?.prepTimeMinutesRegular,
        prepIntelligence?.prep_time_minutes_regular,
        task?.prepTimeMinutes
    );

    return [
        leadTime ? `Best time: ${leadTime}` : '',
        prepTimeMinutes && prepTimeMinutes > 0 ? `Expected time: ${prepTimeMinutes} min` : '',
        makeAhead ? `Make-ahead: ${makeAhead}` : '',
        handoffNote ? `Handoff: ${handoffNote}` : ''
    ].filter(Boolean);
};

const getWorkflow2PrepEquipment = (task = {}) => {
    const methodProfile = getTaskWorkflow2MethodProfile(task);
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    const rowEquipment = getWorkflow2ExecutionTaskRows(task)
        .flatMap((row) => Array.isArray(row?.equipmentRequired) ? row.equipmentRequired : [])
        .filter(Boolean);
    return pickFirstWorkflow2TextList(
        rowEquipment,
        methodProfile?.equipment,
        methodProfile?.equipment_required,
        methodProfile?.equipmentRequired,
        methodProfile?.tools,
        methodProfile?.tools_equipment,
        methodProfile?.toolsEquipment,
        prepProfile?.uiOutput?.equipment,
        prepProfile?.uiOutput?.tools,
        prepProfile?.ui_output?.equipment,
        prepProfile?.ui_output?.tools
    ).slice(0, 5);
};

const getWorkflow2PrepSupportNotes = (task = {}) => {
    const prepProfile = getTaskWorkflow2PrepProfile(task);
    if (!prepProfile) return [];
    const serviceNotes = pickFirstWorkflow2TextList(
        prepProfile?.serviceFinish,
        prepProfile?.service_finish
    ).slice(0, 3);

    const notes = [...serviceNotes];
    const reviewSummary = String(prepProfile?.reviewSummary || prepProfile?.review_summary || '').trim();
    if (reviewSummary) {
        notes.push(reviewSummary);
    }
    const lowConfidenceFields = Array.isArray(prepProfile?.lowConfidenceFields)
        ? prepProfile.lowConfidenceFields
        : (Array.isArray(prepProfile?.low_confidence_fields) ? prepProfile.low_confidence_fields : []);
    lowConfidenceFields.slice(0, 2).forEach((field) => {
        const label = String(field?.field_label || field?.fieldLabel || field?.field_path || field?.fieldPath || 'Generated profile field').trim();
        const reason = String(field?.reason_text || field?.reasonText || field?.reason_code || field?.reasonCode || 'Review recommended.').trim();
        notes.push(`${label}: ${reason}`);
    });
    if (prepProfile?.reviewRequired || prepProfile?.review_required || prepProfile?.managerReviewRequired || prepProfile?.manager_review_required) {
        notes.push('Manager review required before handoff.');
    }
    const confidence = prepProfile?.confidenceScores || prepProfile?.confidence_scores || {};
    const numericConfidence = Number(confidence?.overall ?? confidence?.profile ?? 0);
    if (numericConfidence > 0 && numericConfidence < 0.7) {
        notes.push('Low-confidence prep profile. Review before service.');
    }
    return [...new Set(notes)].slice(0, 5);
};

const getPrepBoardTaskBullets = (task = {}) => (
    getPrepBoardTaskRows(task)
        .map((row) => String(row?.taskName || '').trim())
        .filter(Boolean)
        .slice(0, 8)
);

const getPrepTaskActionCount = (task = {}) => {
    const bulletCount = getPrepBoardTaskBullets(task).length;
    return bulletCount > 0 ? bulletCount : 1;
};

const getPrepTaskTakenActionCount = (task = {}, pickedTaskIds = []) => (
    pickedTaskIds.includes(String(task?.id || '').trim()) ? getPrepTaskActionCount(task) : 0
);

const getPrepTaskUrgencyTone = (task = {}) => {
    const urgency = normalizeText(task?.urgency_level);
    if (urgency === 'high') return 'high';
    if (urgency === 'medium') return 'medium';
    return 'normal';
};

const getPrepTaskStationGroup = (task = {}) => {
    const group = String(task?.station_group || '').trim();
    return group || String(task?.station || 'General Prep').trim() || 'General Prep';
};

const getPrepTaskServiceGroup = (task = {}) => {
    if (Boolean(task?.isTruthBlocked) || Boolean(task?.isDependencyBlocked) || String(task?.taskState || '').trim() === 'waiting approval') {
        return 'Shift Notes / Communication';
    }
    if (Boolean(task?.isOverdueRisk) || normalizeText(task?.urgency_level) === 'high') {
        return 'Top Priorities';
    }
    if (String(task?.taskState || '').trim() === 'ready now' || String(task?.taskState || '').trim() === 'changed') {
        return 'Dish Availability';
    }
    return 'Readiness';
};

const toTitleWords = (value = '') => String(value || '')
    .trim()
    .replace(/\b\w/g, (token) => token.toUpperCase());

const getPrepTaskContentHaystack = (task = {}) => (
    [
        task?.station_group,
        task?.station,
        task?.dish_group,
        task?.name,
        task?.smart_data?.station,
        task?.context_tags?.dish_style,
        task?.context_tags?.occasion,
        task?.context_tags?.event_location,
        ...(Array.isArray(task?.execution_steps) ? task.execution_steps : []),
        ...(Array.isArray(task?.checklist) ? task.checklist : []),
        ...(Array.isArray(task?.critical_checks) ? task.critical_checks : [])
    ]
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join(' ')
);

const getPrepExplicitStationLabel = (task = {}) => {
    const explicit = [
        task?.smart_data?.station,
        task?.station,
        task?.station_group
    ]
        .map((value) => String(value || '').trim())
        .find((value) => value && !/^(general|general prep|service|component|kitchen standard)$/i.test(value));

    return explicit ? toTitleWords(explicit) : '';
};

const isWeakPrepStationLabel = (value = '') => {
    const normalized = normalizeText(value);
    return !normalized
        || /^(general|general prep|service|component|components|component prep|marinated|marinade|rolled|roll|kitchen standard|prep this week|before service)$/i.test(normalized);
};

const mapPrepStationLabel = (value = '', phaseKey = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return '';

    if (phaseKey === 'before_service') {
        if (/(sauce|dip|dressing|marinade|glaze|aioli|vinaigrette)/.test(normalized)) return 'Sauce Station';
        if (/(grill|char|bbq|yakitori|roast)/.test(normalized)) return 'Grill Section';
        if (/(fryer|deep fry|fried|tempura|katsu|karaage)/.test(normalized)) return 'Fryer Station';
        if (/(roll|sushi|kimbap|gimbap|maki|nori|temaki)/.test(normalized)) return 'Roll Station';
        if (/(salad|cold|pickle|kimchi|banchan|garnish|herb)/.test(normalized)) return 'Salad Station';
        if (/(soup|broth|ramen|udon|curry|stew|reheat)/.test(normalized)) return 'Soup Station';
        if (/(pizza|oven|flatbread)/.test(normalized)) return 'Pizza Station';
        return '';
    }

    if (/(sauce|dip|dressing|marinade|glaze|aioli|vinaigrette)/.test(normalized)) return 'Sauce Station';
    if (/(dessert|pastry|sweet|cake|bread|bakery)/.test(normalized)) return 'Dessert';
    if (/(cold|pickle|kimchi|salad|banchan|roll|rolls|sushi|kimbap|gimbap|starter)/.test(normalized)) return 'Cold Dish';
    if (/(grill|char|bbq|yakitori|roast)/.test(normalized)) return 'Grill Station';
    if (/(soup|broth|ramen|udon|curry|stew|hot main soup)/.test(normalized)) return 'Soup Station';
    if (/(roll|sushi|kimbap|gimbap|maki|nori|temaki)/.test(normalized)) return 'Roll Station';
    if (/(fryer|deep fry|fried|tempura|katsu|karaage)/.test(normalized)) return 'Fryer Station';
    if (/(pizza|oven|flatbread)/.test(normalized)) return 'Pizza Station';
    return '';
};

const getPrepTaskStationViewGroup = (task = {}, phaseKey = '') => {
    const explicitStation = getPrepExplicitStationLabel(task);
    const haystack = getPrepTaskContentHaystack(task);
    const mappedExplicitStation = mapPrepStationLabel(
        explicitStation
        || task?.station_group
        || task?.station
        || task?.smart_data?.station
        || task?.dish_group
        || task?.category
        || task?.dishCategory
        || task?.context_tags?.dish_style
        || task?.dishStyle
        || task?.style
        || '',
        phaseKey
    );

    if (mappedExplicitStation) return mappedExplicitStation;
    if (explicitStation && !isWeakPrepStationLabel(explicitStation)) return explicitStation;

    if (phaseKey === 'before_service') {
        if (/(sauce|dip|dressing|marinade|glaze|aioli|vinaigrette)/.test(haystack)) return 'Sauce Station';
        if (/(grill|char|bbq|yakitori|roast)/.test(haystack)) return 'Grill Section';
        if (/(fryer|deep fry|fried|tempura|katsu|karaage)/.test(haystack)) return 'Fryer Station';
        if (/(roll|sushi|kimbap|gimbap|maki|nori|temaki)/.test(haystack)) return 'Roll Station';
        if (/(salad|cold|pickle|kimchi|banchan|garnish|herb)/.test(haystack)) return 'Salad Station';
        if (/(soup|broth|ramen|udon|curry|stew|reheat)/.test(haystack)) return 'Soup Station';
        if (/(pizza|oven|flatbread)/.test(haystack)) return 'Pizza Station';
        return explicitStation || 'General Service';
    }

    if (/(sauce|dip|dressing|marinade|glaze|aioli|vinaigrette)/.test(haystack)) return 'Sauce Station';
    if (/(dessert|pastry|sweet|cake|bread|bakery)/.test(haystack)) return 'Dessert';
    if (/(cold|pickle|kimchi|salad|banchan|roll|sushi|kimbap|gimbap|starter)/.test(haystack)) return 'Cold Dish';
    if (/(grill|char|bbq|yakitori|roast|skewer)/.test(haystack)) return 'Grill Station';
    if (/(soup|broth|ramen|udon|curry|stew|stock pot|hot main soup)/.test(haystack)) return 'Soup Station';
    if (/(roll|sushi|kimbap|gimbap|maki|nori|temaki)/.test(haystack)) return 'Roll Station';
    if (/(fryer|deep fry|fried|tempura|katsu|karaage)/.test(haystack)) return 'Fryer Station';
    if (/(pizza|oven|flatbread)/.test(haystack)) return 'Pizza Station';
    const styleLabel = String(
        task?.context_tags?.dish_style
        || task?.dishStyle
        || task?.style
        || ''
    ).trim();
    if (styleLabel && !isWeakPrepStationLabel(styleLabel)) return toTitleWords(styleLabel);
    return explicitStation && !isWeakPrepStationLabel(explicitStation) ? explicitStation : 'General Prep';
};

const getPrepTaskRecipeCategoryLabel = (task = {}) => String(
    task?.dish_group
    || task?.dishCategory
    || task?.category
    || 'General'
).trim();

const getPrepTaskCategoryGroup = (task = {}, phaseKey = '') => {
    const haystack = getPrepTaskContentHaystack(task);

    if (phaseKey === 'before_service') {
        if (/(garnish|finish with|top with|herb|sesame|spring onion|scallion|lemon|micro|nori strip)/.test(haystack)) return 'Garnish';
        if (/(sauce ready|sauce bottle|bottle placement|dip cup|dressing ready|portion the sauce|set cold dip|sauce should stay cold|bottled sauce)/.test(haystack)) return 'Sauce Ready';
        if (/(reheat|heat up|warm through|bring to simmer|hot hold|heat and hold|retherm)/.test(haystack)) return 'Reheat Check';
        return 'General Service';
    }

    if (/(sauce|dressing|dip|mayo|mayonnaise|vinaigrette|marinade|glaze|aioli)/.test(haystack)) return 'Sauce';
    if (/(beef|chicken|pork|lamb|fish|salmon|tuna|meat|protein|trim|slice beef|dice chicken|portion chicken|marinate chicken|marinate beef)/.test(haystack)) return 'Meat Prep';
    if (/(veg|vegetable|cabbage|carrot|onion|scallion|spring onion|lettuce|cucumber|daikon|radish|kimchi|pickle|salad|herb|greens|chop veg|slice veg)/.test(haystack)) return 'Veg Prep';
    return 'General Task';
};

const getPrepTaskCategoryGroupForRow = (task = {}, row = {}, phaseKey = '') => {
    const structuredCategory = normalizeText(row?.category || '');
    const structuredActionType = normalizeText(row?.actionType || row?.action_type || '');
    const structuredStation = normalizeText(row?.station || '');
    const structuredHaystack = [structuredCategory, structuredActionType, structuredStation].filter(Boolean).join(' ');

    if (structuredHaystack) {
        if (phaseKey === 'before_service') {
            if (/(garnish|finish|top|plate|herb|sesame|scallion|spring onion|lemon|micro|nori)/.test(structuredHaystack)) return 'Garnish';
            if (/(sauce|dip|dressing|bottle|bottled|portion sauce|condiment)/.test(structuredHaystack)) return 'Sauce Ready';
            if (/(reheat|heat|warm|hold|retherm)/.test(structuredHaystack)) return 'Reheat Check';
            if (/(rolled|roll|sushi|kimbap|gimbap|maki)/.test(structuredStation)) return 'General Service';
        } else {
            if (/(sauce|dip|dressing|mayo|marinade|glaze|aioli|vinaigrette)/.test(structuredHaystack)) return 'Sauce';
            if (/(fish|salmon|tuna|seafood|shellfish)/.test(structuredHaystack)) return 'Fish Prep';
            if (/(beef|chicken|pork|lamb|meat|protein|butcher|trim|slice|dice|marinate)/.test(structuredHaystack)) return 'Meat Prep';
            if (/(veg|vegetable|greens|herb|salad|pickle|kimchi|cabbage|carrot|onion|scallion|cucumber|daikon|radish)/.test(structuredHaystack)) return 'Veg Prep';
        }
    }

    const rowHaystack = normalizeText([
        row?.taskName || '',
        row?.category || '',
        row?.actionType || '',
        row?.station || '',
        row?.skillLevel || '',
        task?.name || '',
        task?.style || '',
        task?.dishStyle || '',
        task?.category || ''
    ].join(' '));

    if (phaseKey === 'before_service') {
        if (/(garnish|finish with|top with|herb|sesame|spring onion|scallion|lemon|micro|nori strip)/.test(rowHaystack)) return 'Garnish';
        if (/(sauce|bottle|dip|dressing|portion the sauce|set cold dip|bottled sauce)/.test(rowHaystack)) return 'Sauce Ready';
        if (/(reheat|heat up|warm through|bring to simmer|hot hold|retherm)/.test(rowHaystack)) return 'Reheat Check';
        return 'General Service';
    }

    if (/(sauce|dressing|dip|mayo|mayonnaise|vinaigrette|marinade|glaze|aioli)/.test(rowHaystack)) return 'Sauce';
    if (/(beef|chicken|pork|lamb|fish|salmon|tuna|meat|protein|trim|slice beef|dice chicken|portion chicken|marinate chicken|marinate beef)/.test(rowHaystack)) return 'Meat Prep';
    if (/(veg|vegetable|cabbage|carrot|onion|scallion|spring onion|lettuce|cucumber|daikon|radish|kimchi|pickle|salad|herb|greens|chop veg|slice veg)/.test(rowHaystack)) return 'Veg Prep';
    return getPrepTaskCategoryGroup(task, phaseKey);
};

const getPrepTaskStationDisplayLabel = (task = {}) => (
    getPrepTaskStationViewGroup(task, getPrepDayPartKey(task))
);

const getPrepTaskSkillLevels = (task = {}) => (
    [...new Set(
        getPrepBoardTaskRows(task)
            .map((row) => String(row?.skillLevel || '').trim())
            .filter(Boolean)
    )]
);

const buildPrepTaskRowContext = (row = {}, { includeHold = true, maxParts = 4 } = {}) => {
    const parts = [
        row?.quantityText ? `Qty ${row.quantityText}` : '',
        row?.estimatedMinutes ? `${row.estimatedMinutes} min` : '',
        row?.station || row?.stationGroup || '',
        row?.category || '',
        row?.skillLevel || '',
        includeHold && row?.holdRule ? row.holdRule : ''
    ]
        .map((item) => String(item || '').trim())
        .filter(Boolean);

    return [...new Set(parts)].slice(0, maxParts).join(' / ');
};

const buildPrepTaskRowSupportNotes = (rows = []) => {
    const supportRows = (Array.isArray(rows) ? rows : []).flatMap((row) => {
        const notes = [];
        if (row?.holdRule) notes.push(`Hold: ${row.holdRule}`);
        if (Array.isArray(row?.equipmentRequired) && row.equipmentRequired.length > 0) {
            notes.push(`Equipment: ${row.equipmentRequired.join(', ')}`);
        }
        if (Array.isArray(row?.criticalCheckRefs) && row.criticalCheckRefs.length > 0) {
            notes.push(`Critical refs: ${row.criticalCheckRefs.join(', ')}`);
        }
        if (Array.isArray(row?.ccpRefs) && row.ccpRefs.length > 0) {
            notes.push(`CCP refs: ${row.ccpRefs.join(', ')}`);
        }
        return notes;
    });
    return [...new Set(supportRows)].slice(0, 5);
};

const getPrepGroupingOrder = (groupingMode = PREP_BOARD_GROUPINGS.STATION, phaseKey = '') => {
    if (groupingMode === PREP_BOARD_GROUPINGS.URGENT) {
        return PREP_SERVICE_URGENT_GROUP_ORDER;
    }
    if (groupingMode === PREP_BOARD_GROUPINGS.TASK) {
        return phaseKey === 'before_service' ? PREP_SERVICE_TASK_GROUP_ORDER : PREP_TASK_GROUP_ORDER;
    }
    return phaseKey === 'before_service' ? PREP_SERVICE_STATION_GROUP_ORDER : PREP_STATION_GROUP_ORDER;
};

const getPrepGroupingLabel = (groupingMode = PREP_BOARD_GROUPINGS.STATION) => (
    groupingMode === PREP_BOARD_GROUPINGS.TASK ? 'by task' : (groupingMode === PREP_BOARD_GROUPINGS.URGENT ? 'urgent' : 'by station')
);

const getExplicitPrepRowDayPartKey = (row = {}) => {
    const explicitKey = String(row?.dayPartKey || '').trim();
    if (explicitKey) return explicitKey;

    const normalizedValue = normalizeText(
        row?.dayPart
        || row?.day_part
        || row?.prepWindow
        || row?.prep_window
        || row?.serviceWindow
        || row?.service_window
        || row?.phaseKey
        || row?.phase_key
        || row?.phase
        || row?.timeSlot
        || row?.time_slot
        || ''
    );

    if (normalizedValue.includes('morning') || /day[\s_-]*-?1|day before|previous day/.test(normalizedValue)) return 'morning';
    if (normalizedValue.includes('afternoon')) return 'afternoon';
    if (/(before[\s_-]*service|service|handoff|final)/.test(normalizedValue)) return 'before_service';

    return '';
};

const getPrepRowDayPartKey = (row = {}, fallbackTask = {}) => {
    const explicitKey = getExplicitPrepRowDayPartKey(row);
    if (explicitKey) return explicitKey;
    return getPrepDayPartKey(fallbackTask);
};

const getSavedPrepRowGroupingLabel = ({
    task = {},
    row = {},
    phaseKey = '',
    groupingMode = PREP_BOARD_GROUPINGS.STATION
} = {}) => {
    if (groupingMode === PREP_BOARD_GROUPINGS.URGENT) return 'Urgent';
    if (groupingMode === PREP_BOARD_GROUPINGS.TASK) {
        return getPrepTaskCategoryGroupForRow(task, row, phaseKey);
    }

    const explicitStation = String(
        row?.stationGroup
        || row?.station_group
        || row?.station
        || ''
    ).trim();

    if (explicitStation) {
        return getPrepTaskStationViewGroup({
            ...task,
            station_group: explicitStation,
            station: explicitStation,
            smart_data: {
                ...(task?.smart_data || {}),
                station: explicitStation
            }
        }, phaseKey);
    }

    return getPrepTaskStationViewGroup(task, phaseKey);
};

const getPrepCommandTopLabel = (command = {}) => {
    const label = String(command?.label || '').trim();
    const time = String(command?.time || '').trim();
    if (!label) return time;
    if (!time) return label;

    const normalizedLabel = normalizeText(label);
    const normalizedTime = normalizeText(time);
    if (!normalizedLabel || !normalizedTime) return [label, time].filter(Boolean).join(' / ');
    if (normalizedTime.startsWith(normalizedLabel)) return time;
    if (normalizedLabel.startsWith(normalizedTime)) return label;
    return `${label} / ${time}`;
};

const getPrepDayPartKey = (task = {}) => {
    const explicitLeadTime = normalizeText(task?.prepLeadTime);
    if (explicitLeadTime.includes('morning') || explicitLeadTime.includes('day before') || explicitLeadTime.includes('previous day')) return 'morning';
    if (explicitLeadTime.includes('afternoon')) return 'afternoon';
    if (/(before[\s_-]*service|service finish|final|handoff)/.test(explicitLeadTime)) return 'before_service';
    const phasePriority = Number(task?.schedulePhasePriority ?? 2);
    if (phasePriority <= 0) return 'morning';
    if (phasePriority === 1) return 'afternoon';
    return 'before_service';
};

const getPrepLeadTimeRank = (task = {}) => {
    const explicitLeadTime = normalizeText(task?.prepLeadTime);
    if (explicitLeadTime.includes('morning first')) return 0;
    if (explicitLeadTime.includes('morning') || explicitLeadTime.includes('day before') || explicitLeadTime.includes('previous day')) return 1;
    if (explicitLeadTime.includes('afternoon')) return 2;
    if (/(before[\s_-]*service|service finish|final|handoff)/.test(explicitLeadTime)) return 3;
    return Number(task?.schedulePhasePriority ?? 2);
};

const getPrepMakeAheadRank = (task = {}) => {
    const makeAhead = normalizeText(task?.prepMakeAhead);
    if (makeAhead === 'same day only') return 0;
    if (makeAhead === 'day before ok') return 1;
    if (makeAhead === 'two days ahead ok') return 2;
    return 3;
};

const normalizePrepAheadState = (state = '') => {
    const normalized = normalizeText(state);
    if (!normalized) return '';
    if (normalized === 'partial' || normalized === 'partial prep' || normalized === 'partial prep possible') return 'partial';
    if (normalized === 'tomorrow' || normalized.includes('next day') || normalized.includes('day before')) return 'tomorrow';
    if (normalized === 'same day' || normalized === 'same-day' || normalized === 'same_day' || normalized === 'today') return 'same day';
    return normalized;
};

const getTaskCanBePartialPrep = (task = {}) => {
    const stateHint = normalizePrepAheadState(task?.prepAheadState);
    if (stateHint === 'partial') return true;
    const handoffNote = normalizeText(task?.prepHandoffNote);
    return /\b(partial|staged|stage|split|half|finish|hold|batch|marinade|soak|ferment|brine)\b/.test(handoffNote);
};

const getTaskPrepAheadState = (task = {}) => {
    const explicitState = normalizePrepAheadState(task?.prepAheadState);
    if (explicitState === 'partial' || explicitState === 'tomorrow') {
        return explicitState;
    }
    if (explicitState === 'same day') return 'same day';

    const canMoveTomorrow = Boolean(task?.prepAheadCanMoveTomorrow)
        || (getPrepMakeAheadRank(task) > 0 && normalizeText(task?.prepStorageWindow) !== 'use same day');
    if (getTaskCanBePartialPrep(task)) return 'partial';
    if (canMoveTomorrow) return 'tomorrow';
    return 'same day';
};

const getTaskPrepAheadChip = (task = {}) => {
    const state = getTaskPrepAheadState(task);
    if (state === 'partial') return 'Partial prep';
    if (state === 'tomorrow') return 'Tomorrow prep';
    return '';
};

const getTaskScheduleScope = ({
    task = {},
    prepPlans = {},
    view = PREP_SCHEDULE_VIEWS.TODAY,
    selectedWeekday = null,
    defaultWeekday = null
} = {}) => {
    const taskPlan = resolvePrepPlanForTask(prepPlans, task);
    const hasSavedPrepPlans = Object.keys(prepPlans || {}).length > 0;
    const day = Number.isInteger(selectedWeekday) ? selectedWeekday : defaultWeekday;
    const todayIndex = Number.isInteger(day) && day >= 0 && day < 7 ? day : null;

    if (!taskPlan || typeof taskPlan !== 'object') {
        return {
            matchesView: !hasSavedPrepPlans,
            hasPlan: false,
            planMode: 'no-plan',
            planDays: []
        };
    }

    const planMode = String(taskPlan.mode || 'prepThisWeek');
    const autoPlan = Boolean(taskPlan.auto);
    const anyDayPlan = Boolean(taskPlan.anyDay);
    const planDays = Array.isArray(taskPlan.days)
        ? taskPlan.days
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < 7)
        : [];

    if (autoPlan || anyDayPlan) {
        return {
            matchesView: true,
            hasPlan: true,
            planMode,
            planDays
        };
    }

    if (!planDays.length) {
        return {
            matchesView: true,
            hasPlan: true,
            planMode,
            planDays
        };
    }

    if (view === PREP_SCHEDULE_VIEWS.TODAY && todayIndex !== null) {
        return {
            matchesView: planDays.includes(todayIndex),
            hasPlan: true,
            planMode,
            planDays
        };
    }

    return {
        matchesView: true,
        hasPlan: true,
        planMode,
        planDays
    };
};

const buildPrepTaskIntelligenceNotes = (task = {}) => {
    const notes = [...getWorkflow2PrepSupportNotes(task)];
    const prepLeadTime = String(task?.prepLeadTime || '').trim();
    const prepMakeAhead = String(task?.prepMakeAhead || '').trim();
    const prepStorageWindow = String(getWorkflow2PrepStorageLabel(task) || task?.prepStorageWindow || '').trim();
    const prepHandoffNote = String(task?.prepHandoffNote || '').trim();
    const prepTimeMinutes = Number(task?.prepTimeMinutes || 0);
    const timePredictionSummary = String(task?.timePredictionSummary || '').trim();
    const prepAheadChip = getTaskPrepAheadChip(task);

    if (prepLeadTime) {
        notes.push(`Lead time: ${prepLeadTime}.`);
    }
    if (timePredictionSummary) {
        notes.push(`Timing: ${timePredictionSummary}`);
    } else if (prepTimeMinutes > 0) {
        notes.push(`Prep time estimate: ${prepTimeMinutes} min.`);
    }
    if (prepMakeAhead || prepStorageWindow) {
        notes.push([
            prepMakeAhead ? `Make ahead: ${prepMakeAhead}` : '',
            prepStorageWindow ? `Storage: ${prepStorageWindow}` : ''
        ].filter(Boolean).join(' / '));
    }
    if (prepHandoffNote) {
        notes.push(`Handoff: ${prepHandoffNote}`);
    }
    if (prepAheadChip) {
        notes.push(`Prep schedule option: ${prepAheadChip}.`);
    }
    if (typeof task?.nextActionReason === 'string' && task.nextActionReason.trim()) {
        notes.push(`Next move: ${task.nextActionReason.trim()}`);
    }

    return notes;
};

const buildPrepAheadOpportunitySummary = (tasks = []) => {
    const taskList = Array.isArray(tasks) ? tasks : [];
    const safeTomorrowTasks = taskList.filter((task) => (
        getTaskPrepAheadState(task) === 'tomorrow' || getTaskPrepAheadState(task) === 'partial'
    ));
    const partialPrepCandidates = taskList.filter((task) => getTaskCanBePartialPrep(task));
    const longestLeadTask = [...safeTomorrowTasks]
        .sort((left, right) => (
            getPrepLeadTimeRank(left) - getPrepLeadTimeRank(right)
            || Number(right?.prepTimeMinutes || 0) - Number(left?.prepTimeMinutes || 0)
            || compareCommandTaskReadiness(left, right)
        ))[0] || null;

    return {
        safeTomorrowCount: safeTomorrowTasks.length,
        partialPrepCount: partialPrepCandidates.length,
        tomorrowPrepCount: safeTomorrowTasks.filter((task) => getTaskPrepAheadState(task) === 'tomorrow').length,
        longestLeadTask
    };
};

const buildPrepDayPartBuckets = (tasks = []) => {
    const groupedTasks = PREP_DAY_PART_SEQUENCE.reduce((acc, phase) => ({
        ...acc,
        [phase.key]: []
    }), {});

    tasks.forEach((task) => {
        const key = getPrepDayPartKey(task);
        if (!groupedTasks[key]) groupedTasks[key] = [];
        groupedTasks[key].push(task);
    });

    Object.keys(groupedTasks).forEach((key) => {
        groupedTasks[key] = groupedTasks[key].sort((left, right) => {
            if (key === 'morning') {
                return (
                    getPrepLeadTimeRank(left) - getPrepLeadTimeRank(right)
                    || Number(right?.prepTimeMinutes || 0) - Number(left?.prepTimeMinutes || 0)
                    || compareCommandTaskReadiness(left, right)
                );
            }

            if (key === 'afternoon') {
                return (
                    getPrepMakeAheadRank(left) - getPrepMakeAheadRank(right)
                    || compareCommandTaskReadiness(left, right)
                );
            }

            return compareCommandTaskReadiness(left, right);
        });
    });

    return groupedTasks;
};

const buildTodayWorkflowSummary = (tasks = []) => {
    const groupedTasks = buildPrepDayPartBuckets(tasks);
    const morningTasks = groupedTasks.morning || [];
    const afternoonTasks = groupedTasks.afternoon || [];
    const beforeServiceTasks = groupedTasks.before_service || [];
    const startTask = morningTasks[0] || afternoonTasks[0] || beforeServiceTasks[0] || null;
    const thenTask = afternoonTasks[0] || beforeServiceTasks[0] || null;
    const holdTask = beforeServiceTasks[0] || null;
    const prepAheadCount = tasks.filter((task) => getPrepMakeAheadRank(task) > 0).length;

    return {
        counts: {
            morning: morningTasks.length,
            afternoon: afternoonTasks.length,
            beforeService: beforeServiceTasks.length
        },
        startTask,
        thenTask,
        holdTask,
        prepAheadCount
    };
};

const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const recentRecipeActivityKeyFor = (clientId) => {
    const normalizedClientId = normalizeKey(clientId);
    return normalizedClientId ? `${RECENT_RECIPE_ACTIVITY_STORAGE_PREFIX}:${normalizedClientId}` : null;
};

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeFilename = (value, fallback = 'cabij-recipes') => {
    const cleaned = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
};

const downloadTextFile = ({ filename, content, mimeType }) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.target = '_self';
    anchor.style.position = 'fixed';
    anchor.style.top = '0';
    anchor.style.left = '0';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    requestAnimationFrame(() => {
        if (anchor.parentNode) {
            anchor.parentNode.removeChild(anchor);
        }
    });
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
};

const buildRecipeExportHtml = ({ recipes = [], orientation = 'portrait', layout = 'compact', autoPrint = false }) => {
    const orientationSize = orientation === 'landscape' ? 'landscape' : 'portrait';
    const compactLayout = layout === 'compact';
    const compactGridColumns = orientation === 'landscape' ? 4 : 2;
    const cards = recipes.map((recipe, index) => {
        const ingredientGroups = Array.isArray(recipe?.ingredientGroups) ? recipe.ingredientGroups : [];
        const instructions = Array.isArray(recipe?.instructions) ? recipe.instructions : [];
        const compactIngredientRows = ingredientGroups.flatMap((group) => ([
            { type: 'cat', label: group.category || 'Other' },
            ...(Array.isArray(group.items) ? group.items : []).map((item) => ({
                type: 'item',
                name: item?.name || 'Ingredient',
                qty: item?.displayQuantity || '',
                linkedRecipeName: item?.linkedRecipeName || '',
                note: item?.note || ''
            }))
        ]));

        const compactIngredientMarkup = `
            <div class="export-sheet-ingredient-table">
                ${compactIngredientRows.map((row) => {
                    if (row.type === 'cat') {
                        return `<div class="export-sheet-ingredient-cat">${escapeHtml(row.label)}</div>`;
                    }
                    const notes = [
                        row.linkedRecipeName ? `Sub recipe: ${row.linkedRecipeName}` : '',
                        row.note ? row.note : ''
                    ].filter(Boolean);
                    return `
                        <div class="export-sheet-ingredient-item">
                            <div class="export-sheet-ingredient-name-wrap">
                                <div class="export-sheet-ingredient-name">${escapeHtml(row.name)}</div>
                                ${notes.length ? `<div class="export-sheet-ingredient-note">${escapeHtml(notes.join(' | '))}</div>` : ''}
                            </div>
                            <div class="export-sheet-ingredient-qty">${escapeHtml(row.qty)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const detailedIngredientMarkup = ingredientGroups.map((group) => `
            <section class="export-sheet-group">
                <div class="export-sheet-group-title">${escapeHtml(group.category || 'Other')}</div>
                <div class="export-sheet-group-list">
                    ${(Array.isArray(group.items) ? group.items : []).map((item) => `
                        <div class="export-sheet-ingredient-row">
                            <div class="export-sheet-ingredient-name-wrap">
                                <div class="export-sheet-ingredient-name">${escapeHtml(item.name || 'Ingredient')}</div>
                                ${item.linkedRecipeName ? `<div class="export-sheet-ingredient-note">Sub recipe: ${escapeHtml(item.linkedRecipeName)}</div>` : ''}
                                ${item.note ? `<div class="export-sheet-ingredient-note">${escapeHtml(item.note)}</div>` : ''}
                            </div>
                            <div class="export-sheet-ingredient-qty">${escapeHtml(item.displayQuantity || '')}</div>
                        </div>
                    `).join('')}
                </div>
            </section>
        `).join('');

        const instructionsMarkup = !compactLayout && instructions.length
            ? `
                <section class="export-sheet-section export-sheet-instructions">
                    <div class="export-sheet-section-title">Instructions</div>
                    <ol class="export-sheet-steps">
                        ${instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
                    </ol>
                </section>
            `
            : '';

        return `
            <article class="export-sheet-card ${compactLayout ? 'compact' : 'single'}" ${!compactLayout && index < recipes.length - 1 ? 'data-page-break="true"' : ''}>
                <header class="export-sheet-header">
                    ${compactLayout ? '' : '<div class="export-sheet-kicker">Cabij recipe export</div>'}
                    <h1 class="export-sheet-title">${escapeHtml(recipe.title || 'Recipe')}</h1>
                    ${compactLayout ? (
                        recipe.scaleLabel ? `
                            <div class="export-sheet-meta export-sheet-meta-compact">
                                <span>${escapeHtml(recipe.scaleLabel)}</span>
                            </div>
                        ` : ''
                    ) : `
                        <div class="export-sheet-meta">
                            <span>${escapeHtml(recipe.scaleLabel || '')}</span>
                            ${recipe.yieldLabel ? `<span>${escapeHtml(recipe.yieldLabel)}</span>` : ''}
                            ${recipe.cuisine ? `<span>${escapeHtml(recipe.cuisine)}</span>` : ''}
                            ${recipe.style ? `<span>${escapeHtml(recipe.style)}</span>` : ''}
                            ${recipe.category ? `<span>${escapeHtml(recipe.category)}</span>` : ''}
                        </div>
                    `}
                </header>
                <section class="export-sheet-section">
                    ${compactLayout ? '' : '<div class="export-sheet-section-title">Ingredients</div>'}
                    ${compactLayout
                        ? (compactIngredientRows.length ? compactIngredientMarkup : '<div class="export-sheet-empty">No ingredients saved for this recipe.</div>')
                        : `<div class="export-sheet-groups single">${detailedIngredientMarkup || '<div class="export-sheet-empty">No ingredients saved for this recipe.</div>'}</div>`
                    }
                </section>
                ${instructionsMarkup}
            </article>
        `;
    }).join('');

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Cabij Recipe Export</title>
    <style>
        @page { size: ${orientationSize}; margin: ${compactLayout ? '8mm' : '12mm'}; }
        :root {
            color-scheme: light;
            --ink: #101214;
            --muted: #5f6770;
            --line: #d6dde5;
            --soft: #eef2f5;
            --gold: #8a6a13;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: Arial, Helvetica, sans-serif;
            background: #f4f6f8;
            color: var(--ink);
        }
        .export-sheet-toolbar {
            position: sticky;
            top: 0;
            z-index: 20;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--line);
            background: rgba(255,255,255,0.96);
            backdrop-filter: blur(8px);
        }
        .export-sheet-toolbar strong { font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
        .export-sheet-toolbar span { color: var(--muted); font-size: 12px; }
        .export-sheet-toolbar-actions { display: flex; gap: 8px; }
        .export-sheet-toolbar button {
            border: 1px solid var(--line);
            border-radius: 999px;
            background: white;
            color: var(--ink);
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }
        .export-sheet-shell {
            padding: 18px;
        }
        .export-sheet-grid {
            display: grid;
            gap: 14px;
            grid-template-columns: ${compactLayout ? `repeat(${compactGridColumns}, minmax(0, 1fr))` : 'minmax(0, 1fr)'};
            align-items: start;
            grid-auto-flow: row dense;
        }
        .export-sheet-card {
            background: white;
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 16px 18px;
            break-inside: avoid;
            page-break-inside: avoid;
        }
        .export-sheet-card.compact {
            padding: 12px 12px;
            border-radius: 14px;
        }
        .export-sheet-card[data-page-break="true"] {
            break-after: page;
            page-break-after: always;
        }
        .export-sheet-kicker {
            color: var(--gold);
            font-size: 10px;
            letter-spacing: 0.16em;
            font-weight: 800;
            text-transform: uppercase;
        }
        .export-sheet-title {
            margin: 8px 0 0;
            font-size: 28px;
            line-height: 1.02;
            letter-spacing: -0.04em;
        }
        .export-sheet-card.compact .export-sheet-title {
            font-size: 16px;
            line-height: 1.1;
            letter-spacing: -0.02em;
        }
        .export-sheet-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
        }
        .export-sheet-meta-compact {
            margin-top: 8px;
            gap: 6px;
        }
        .export-sheet-meta span {
            padding: 4px 8px;
            border-radius: 999px;
            background: var(--soft);
        }
        .export-sheet-section {
            margin-top: 16px;
        }
        .export-sheet-card.compact .export-sheet-section {
            margin-top: 10px;
        }
        .export-sheet-section-title {
            margin-bottom: 10px;
            font-size: 11px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            font-weight: 800;
            color: var(--muted);
        }
        .export-sheet-groups {
            display: grid;
            gap: 10px;
            grid-template-columns: ${compactLayout ? 'repeat(2, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))'};
        }
        .export-sheet-ingredient-table {
            display: grid;
            gap: 0;
            border: 1px solid var(--line);
            border-radius: 12px;
            overflow: hidden;
            background: #fcfdff;
        }
        .export-sheet-ingredient-cat {
            padding: 7px 10px;
            background: var(--soft);
            border-top: 1px solid rgba(16, 18, 20, 0.06);
            color: var(--gold);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
        }
        .export-sheet-ingredient-cat:first-child { border-top: 0; }
        .export-sheet-ingredient-item {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
            padding: 7px 10px;
            border-top: 1px solid rgba(16, 18, 20, 0.06);
            align-items: start;
        }
        .export-sheet-ingredient-item .export-sheet-ingredient-name {
            font-size: 12px;
        }
        .export-sheet-ingredient-item .export-sheet-ingredient-qty {
            font-size: 12px;
        }
        .export-sheet-card.compact .export-sheet-ingredient-item {
            padding: 6px 10px;
        }
        .export-sheet-card.compact .export-sheet-ingredient-item .export-sheet-ingredient-name {
            font-size: 11px;
            font-weight: 800;
        }
        .export-sheet-card.compact .export-sheet-ingredient-item .export-sheet-ingredient-qty {
            font-size: 11px;
        }
        .export-sheet-group {
            border: 1px solid var(--line);
            border-radius: 12px;
            overflow: hidden;
            background: #fcfdff;
        }
        .export-sheet-group-title {
            padding: 8px 10px;
            border-bottom: 1px solid var(--line);
            background: var(--soft);
            color: var(--gold);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
        }
        .export-sheet-group-list {
            display: grid;
            gap: 0;
            padding: 6px 10px;
        }
        .export-sheet-ingredient-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
            padding: 7px 0;
            border-top: 1px solid rgba(16, 18, 20, 0.06);
            align-items: start;
        }
        .export-sheet-ingredient-row:first-child { border-top: 0; }
        .export-sheet-ingredient-name {
            font-size: 13px;
            font-weight: 800;
            line-height: 1.3;
        }
        .export-sheet-ingredient-note {
            margin-top: 3px;
            color: var(--muted);
            font-size: 10px;
            line-height: 1.35;
        }
        .export-sheet-ingredient-qty {
            font-size: 13px;
            font-weight: 800;
            white-space: nowrap;
            color: var(--gold);
        }
        .export-sheet-steps {
            margin: 0;
            padding-left: 20px;
            display: grid;
            gap: 8px;
        }
        .export-sheet-steps li {
            font-size: 12px;
            line-height: 1.5;
        }
        .export-sheet-empty {
            color: var(--muted);
            font-size: 12px;
            padding: 10px 0;
        }
        @media screen and (max-width: 960px) {
            .export-sheet-grid,
            .export-sheet-groups {
                grid-template-columns: minmax(0, 1fr);
            }
        }
        @media print {
            body { background: white; }
            .export-sheet-toolbar { display: none; }
            .export-sheet-shell { padding: 0; }
            .export-sheet-card {
                border-radius: 0;
                box-shadow: none;
            }
            .export-sheet-grid {
                gap: 10px;
                grid-template-columns: ${compactLayout ? `repeat(${compactGridColumns}, minmax(0, 1fr))` : 'minmax(0, 1fr)'};
            }
            .export-sheet-card.compact {
                border-radius: 0;
                padding: 10px 10px;
            }
        }
    </style>
</head>
<body class="${escapeHtml(layout)} ${escapeHtml(orientation)}">
    <div class="export-sheet-toolbar">
        <div>
            <strong>Cabij Recipe Export</strong>
            <span>${escapeHtml(`${recipes.length} recipe${recipes.length === 1 ? '' : 's'} ready for print or PDF`)}</span>
        </div>
        <div class="export-sheet-toolbar-actions">
            <button type="button" onclick="window.print()">Download PDF / Print</button>
            <button type="button" onclick="window.close()">Close</button>
        </div>
    </div>
    <main class="export-sheet-shell">
        <section class="export-sheet-grid">
            ${cards}
        </section>
    </main>
    ${autoPrint ? `
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          try {
            window.focus();
            window.print();
          } catch (err) {}
        }, 400);
      });
    </script>
    ` : ''}
</body>
</html>`;
};

const buildRecipeExportCsvPreviewHtml = ({ title, filename, csvText }) => {
    const safeTitle = escapeHtml(title || 'Cabij Recipe Export (CSV)');
    const safeFilename = escapeHtml(filename || 'cabij-recipes-export.csv');
    const csvEscaped = String(csvText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; --ink:#101214; --muted:#5f6770; --line:#d6dde5; --soft:#eef2f5; --gold:#8a6a13; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Arial, Helvetica, sans-serif; background:#f4f6f8; color:var(--ink); }
    .toolbar { position: sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line); background:rgba(255,255,255,0.96); backdrop-filter: blur(8px); }
    .toolbar strong { font-size:13px; letter-spacing:0.04em; text-transform:uppercase; }
    .toolbar span { color:var(--muted); font-size:12px; }
    .toolbar-actions { display:flex; gap:8px; }
    .toolbar button { border:1px solid var(--line); border-radius:999px; background:white; color:var(--ink); padding:8px 12px; font-size:12px; font-weight:700; cursor:pointer; }
    main { padding: 16px; }
    .sheet { border:1px solid var(--line); border-radius:16px; overflow:hidden; background:white; }
    pre { margin:0; padding:14px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size:12px; line-height:1.45; white-space:pre; overflow:auto; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div>
      <strong>Cabij CSV Export</strong>
      <span>${safeFilename}</span>
    </div>
    <div class="toolbar-actions">
      <button type="button" onclick="downloadCsv()">Download CSV</button>
      <button type="button" onclick="window.close()">Close</button>
    </div>
  </div>
  <main>
    <div class="sheet">
      <pre id="csv">${csvEscaped}</pre>
    </div>
  </main>
  <script>
    function downloadCsv() {
      try {
        var csv = document.getElementById('csv').innerText || '';
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = ${JSON.stringify(filename || 'cabij-recipes-export.csv')};
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        requestAnimationFrame(function () {
          if (a.parentNode) a.parentNode.removeChild(a);
        });
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (err) {}
    }
  </script>
</body>
</html>`;
};

const buildRecipeExportCsv = ({ recipes = [] }) => {
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = [
        'recipe_title',
        'scale',
        'yield',
        'cuisine',
        'style',
        'category',
        'ingredient_category',
        'ingredient_name',
        'quantity',
        'unit',
        'note',
        'instructions'
    ];
    const lines = [header.map(escapeCsv).join(',')];

    recipes.forEach((recipe) => {
        const instructions = Array.isArray(recipe?.instructions) ? recipe.instructions.join(' | ') : '';
        const ingredientGroups = Array.isArray(recipe?.ingredientGroups) ? recipe.ingredientGroups : [];

        if (ingredientGroups.length === 0) {
            lines.push([
                recipe.title,
                recipe.scaleLabel,
                recipe.yieldLabel,
                recipe.cuisine,
                recipe.style,
                recipe.category,
                '',
                '',
                '',
                '',
                '',
                instructions
            ].map(escapeCsv).join(','));
            return;
        }

        ingredientGroups.forEach((group) => {
            group.items.forEach((item) => {
                lines.push([
                    recipe.title,
                    recipe.scaleLabel,
                    recipe.yieldLabel,
                    recipe.cuisine,
                    recipe.style,
                    recipe.category,
                    group.category,
                    item.name,
                    item.quantityRaw,
                    item.unit,
                    item.note || item.linkedRecipeName || '',
                    instructions
                ].map(escapeCsv).join(','));
            });
        });
    });

    return lines.join('\n');
};

const WorkflowCard = ({ eyebrow, title, copy, children, className = '' }) => (
    <section className={`workflow-card ${className}`}>
        <div className="workflow-eyebrow">{eyebrow}</div>
        <div className="workflow-card-title">{title}</div>
        {copy && <div className="workflow-copy">{copy}</div>}
        {children}
    </section>
);

const createSyncConflictError = (message) => {
    const error = new Error(message);
    error.offlineStatus = OFFLINE_STATE.CONFLICT;
    return error;
};

const SUPABASE_FETCH_HANG_TIMEOUT_MS = 12000;

const createSupabaseTransportHangError = ({ operation, timeoutMs, clientId }) => {
    const error = new Error(`Supabase transport hang detected for ${operation} after ${timeoutMs}ms`);
    error.code = 'supabase_transport_hang';
    error.isSupabaseTransportHang = true;
    error.operation = operation;
    error.timeoutMs = timeoutMs;
    error.clientId = clientId;
    return error;
};

const withSupabaseTransportDiagnostic = async ({ operation, timeoutMs = SUPABASE_FETCH_HANG_TIMEOUT_MS, clientId, run }) => {
    const startedAt = Date.now();
    let timeoutHandle;
    try {
        return await Promise.race([
            run(),
            new Promise((_, reject) => {
                timeoutHandle = window.setTimeout(() => {
                    reject(createSupabaseTransportHangError({ operation, timeoutMs, clientId }));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutHandle) window.clearTimeout(timeoutHandle);
        const elapsed = Date.now() - startedAt;
        if (elapsed >= Math.max(1000, timeoutMs * 0.8)) {
            console.warn(`[Dashboard] Slow Supabase response (${elapsed}ms) during ${operation}`, { clientId, timeoutMs });
        }
    }
};

const getRecipeIngredients = (recipe) => (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []);

const getEngineRecipeId = (recipe, fallback = null) => (
    recipe?.id ||
    recipe?.recipe_id ||
    recipe?.recipe_ref_id ||
    recipe?.canonical_id ||
    recipe?.clean_name ||
    fallback
);

const getRecipePlanningDefaults = (recipe, settings = {}, allRecipes = [], focus = 0) => {
    const portionSize = getPortionSize(recipe, settings, allRecipes);
    const platedTargetYield = Number((Number(focus || 0) * Number(portionSize || 0)).toFixed(2));
    const standardBatchYield = Number(getStandardBatchYield(recipe, settings, allRecipes) || 0);
    const unitLabel = String(recipe?.unit || '').trim().toLowerCase();
    const yieldMode = String(recipe?.yieldMode || recipe?.yield_mode || '').trim().toLowerCase();
    const useBatchDefault = isSauceLikeRecipe(recipe)
        || yieldMode === 'batch_only'
        || yieldMode === 'component_usage'
        || unitLabel === 'batch'
        || unitLabel === 'batches';

    return {
        portionSize,
        platedTargetYield,
        standardBatchYield,
        defaultTargetYield: useBatchDefault && standardBatchYield > 0 ? standardBatchYield : platedTargetYield
    };
};

const getBomNodeForRecipe = (nodes = {}, recipe = null, fallbackKey = null) => {
    if (!nodes || typeof nodes !== 'object') return null;
    const aliases = [
        fallbackKey,
        recipe?.id,
        recipe?.recipe_id,
        recipe?.recipe_ref_id,
        recipe?.canonical_id,
        recipe?.clean_name,
        recipe?.name
    ].filter(Boolean).map(String);

    for (const alias of aliases) {
        if (nodes[alias]) return nodes[alias];
    }

    return null;
};

const formatPrepTaskQuantity = (value, unit = '') => {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) return '';
    const normalizedQuantity = quantity >= 100
        ? Math.round(quantity)
        : Number(quantity.toFixed(quantity % 1 === 0 ? 0 : 2));
    return `${normalizedQuantity}${unit ? ` ${unit}` : ''}`;
};

const compactPrepCopy = (value, maxChars = 132) => {
    const replacements = [
        [/Escalate:\s*/gi, 'Escalate '],
        [/Confirm the linked recipe before this task starts\./gi, 'Check linked recipe.'],
        [/Confirm linked recipe\./gi, 'Check linked recipe.'],
        [/Confirm recipe truth before prep starts\./gi, 'Check recipe truth.'],
        [/Finish that prep before this task\./gi, 'Finish upstream prep first.'],
        [/before downstream service pressure grows/gi, 'before service pressure grows'],
        [/becomes executable after upstream prep dependencies are completed\./gi, 'Ready after upstream prep finishes.'],
        [/is executable now from current recipe and dependency truth\./gi, 'Ready to run now.'],
        [/is unresolved in .*? and needs escalation/gi, 'needs escalation'],
        [/sub-recipe reference is unresolved in recipe truth/gi, 'recipe link unresolved'],
        [/is blocked upstream because/gi, 'blocked upstream:'],
        [/is missing base yield and cannot be scaled safely\./gi, 'is missing base yield.'],
        [/needs recipe-truth review before prep handoff\./gi, 'needs truth review.'],
        [/These prep cards are waiting manager approval before they should be treated as executable production work\./gi, 'Wait for manager approval before running these tasks.'],
        [/Keep the execution change visible without weakening canonical recipe truth\./gi, 'Keep the local change visible without replacing canonical truth.'],
        [/One or more prep cards are using lower-confidence recipe truth and should be reviewed before handoff\./gi, 'Review lower-confidence recipe truth before handoff.'],
        [/Resolve missing yield, sync conflict, or blocked recipe truth before those prep cards become executable\./gi, 'Resolve missing yield, sync conflict, or blocked recipe truth first.'],
        [/Every visible item answers who, what, when, and why without opening a detail page\./gi, 'Scan the next prep moves without opening another page.'],
        [/recipe link unresolved \([^)]+\)\.?\s*Check linked recipe\./gi, 'Linked recipe missing.'],
        [/recipe link unresolved/gi, 'Linked recipe missing'],
        [/missing base yield and cannot be scaled safely/gi, 'Base yield missing'],
        [/truth blocked/gi, 'truth block'],
        [/waiting approval/gi, 'approval'],
        [/upstream changed/gi, 'upstream']
    ];

    let text = String(value || '').replace(/\s+/g, ' ').trim();
    replacements.forEach(([pattern, replacement]) => {
        text = text.replace(pattern, replacement);
    });
    text = text.replace(/\s+([/,:;])/g, '$1').trim();
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars - 1);
    const safeBreak = truncated.lastIndexOf(' ');
    return `${(safeBreak > 48 ? truncated.slice(0, safeBreak) : truncated).trim()}...`;
};

const buildPrepPressureSummaryParts = ({
    truthBlockedCount = 0,
    overdueRiskCount = 0,
    waitingApprovalCount = 0,
    truthReviewCount = 0,
    dependencyBlockedCount = 0,
    changedDependencyCount = 0
} = {}) => ([
    truthBlockedCount > 0 ? `${truthBlockedCount} blocked` : null,
    overdueRiskCount > 0 ? `${overdueRiskCount} overdue` : null,
    waitingApprovalCount > 0 ? `${waitingApprovalCount} approval` : null,
    truthReviewCount > 0 ? `${truthReviewCount} review` : null,
    dependencyBlockedCount > 0 ? `${dependencyBlockedCount} upstream` : null,
    changedDependencyCount > 0 ? `${changedDependencyCount} changed` : null
].filter(Boolean));

const getPrimaryPrepReason = (task, { maxChars = 132, preferEscalation = false } = {}) => {
    let reason = preferEscalation
        ? `${task?.schedulePhase || 'Prep'} unresolved before service pressure grows.`
        : (typeof task?.overdueReason === 'string' && task.overdueReason.trim()
            ? task.overdueReason
            : (typeof task?.nextActionReason === 'string' && task.nextActionReason.trim()
                ? task.nextActionReason
            : (typeof task?.taskStateReason === 'string' && task.taskStateReason.trim()
                ? task.taskStateReason
                : (Array.isArray(task?.truthReasons) && task.truthReasons.length > 0
                    ? task.truthReasons[0]
                    : (Array.isArray(task?.dependencyReasons) && task.dependencyReasons.length > 0
                        ? task.dependencyReasons[0]
                        : (Array.isArray(task?.reasons) ? task.reasons[0] : ''))))));

    const rawName = String(task?.name || '').trim();
    const displayName = formatPrepDisplayName(rawName);
    if (rawName && displayName && rawName !== displayName) {
        reason = String(reason || '').split(rawName).join(displayName);
    }

    return compactPrepCopy(reason, maxChars);
};

const getPrepCardActionSummary = (task) => {
    const blockedDependencyCount = Number(task?.blockedDependencyCount || 0);
    const missingDependencyCount = Number(task?.missingDependencyCount || 0);

    if (blockedDependencyCount > 0 && missingDependencyCount > 0) {
        return `Finish ${blockedDependencyCount} upstream item${blockedDependencyCount === 1 ? '' : 's'} and fix ${missingDependencyCount} recipe link${missingDependencyCount === 1 ? '' : 's'}.`;
    }
    if (blockedDependencyCount > 0) {
        return `Finish ${blockedDependencyCount} upstream prep item${blockedDependencyCount === 1 ? '' : 's'} first.`;
    }
    if (missingDependencyCount > 0) {
        return `Fix ${missingDependencyCount} recipe link${missingDependencyCount === 1 ? '' : 's'} before prep starts.`;
    }
    if (task?.hasChangedDependency) {
        return 'Check the upstream change before continuing this prep.';
    }
    if (task?.isOverdueRisk) {
        return 'This prep should move now to protect service timing.';
    }
    const workflow2Bullets = getWorkflow2PrepTaskBullets(task);
    if (workflow2Bullets.length > 0) {
        return compactPrepCopy(workflow2Bullets[0], 84);
    }
    return getPrimaryPrepReason(task, { maxChars: 84, preferEscalation: Boolean(task?.isOverdueRisk) });
};

const getPrepCardDetailParts = (task, { stateChip = '', prepAheadChip = '' } = {}) => {
    const blockedDependencyCount = Number(task?.blockedDependencyCount || 0);
    const missingDependencyCount = Number(task?.missingDependencyCount || 0);
    const detailParts = [
        formatPrepTaskQuantity(task?.targetYield, task?.unit || '') ? `Qty ${formatPrepTaskQuantity(task?.targetYield, task?.unit || '')}` : null,
        prepAheadChip || null,
        task?.isOverdueRisk ? 'overdue' : null,
        blockedDependencyCount > 0 ? `${blockedDependencyCount} upstream` : null,
        missingDependencyCount > 0 ? `${missingDependencyCount} unresolved` : null,
        stateChip && !['truth blocked', 'blocked'].includes(stateChip) ? stateChip : null
    ].filter(Boolean);

    return detailParts.slice(0, 4);
};

const getPrepStateChip = (task) => {
    const state = String(getDependencyStateLabel(task) || '').trim();
    if (state === 'ready now') return 'ready';
    if (state === 'ready after dependency') return 'after prep';
    if (state === 'waiting approval') return 'approval';
    if (state === 'truth review') return 'review';
    if (state === 'truth blocked') return 'truth blocked';
    if (state === 'changed') return 'changed';
    if (state === 'blocked') return 'blocked';
    return state;
};

const formatPrepDisplayName = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    const ingredientDumpMatch = text.match(/^(.*?)(?:\s+[A-Z][A-Za-z()'/-]{1,30}:\s*\d)/);
    let cleaned = ingredientDumpMatch?.[1]?.trim() || text;

    if (ingredientDumpMatch) {
        cleaned = cleaned.replace(/\s+[A-Z][A-Z\s&/-]{3,}$/, '').trim();
    }

    if (!cleaned) cleaned = text;
    if (cleaned.length > 56) {
        cleaned = `${cleaned.slice(0, 53).trimEnd()}...`;
    }

    if (/[A-Z]/.test(cleaned)) return cleaned;
    return cleaned.replace(/\b([a-z])/g, (match, letter) => letter.toUpperCase());
};

const Dashboard = ({ client_id, userProfile, sessionUser = null }) => {
    const [recipes, setRecipes] = useState([]);
    const [recipeQueue, setRecipeQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState(DASHBOARD_VIEWS.SCALER);
    const roleWorkspaceInitializedRef = useRef(false);
    const workflowTabRefs = useRef({});
    const workflowPanelRefs = useRef({});
    const recipeWorkspaceRef = useRef(null);
    const scalerBoardRef = useRef(null);
    const exportPreviewWindowRef = useRef(null);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedQueueEntryId, setSelectedQueueEntryId] = useState(null);
    const [dailyProduction, setDailyProduction] = useState({});
    const [offlineDataState, setOfflineDataState] = useState({ source: 'online', reason: null });
    const [connectionState, setConnectionState] = useState(
        typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_STATE.OFFLINE : OFFLINE_STATE.ONLINE
    );
    const [syncNotice, setSyncNotice] = useState(null);
    const [scaleInputValue, setScaleInputValue] = useState('1');
    const [ingredientEditMode, setIngredientEditMode] = useState(false);
    const [ingredientDrafts, setIngredientDrafts] = useState({});
    const [customIngredientCategories, setCustomIngredientCategories] = useState([]);
    const [addingCategory, setAddingCategory] = useState(false);
    const [newCategoryDraft, setNewCategoryDraft] = useState('');
    const [editingCategoryName, setEditingCategoryName] = useState(null);
    const [categoryNameDraft, setCategoryNameDraft] = useState('');
    const [draggedIngredientKey, setDraggedIngredientKey] = useState(null);
    const [dragTargetCategory, setDragTargetCategory] = useState(null);
    const [editingRecipeTitle, setEditingRecipeTitle] = useState(false);
    const [editingIngredientField, setEditingIngredientField] = useState(null);
    const [editingInstructionIndex, setEditingInstructionIndex] = useState(null);
    const [editingInstructionDraft, setEditingInstructionDraft] = useState('');
    const [recipeTitleDraft, setRecipeTitleDraft] = useState('');
    const [prepScheduleView, setPrepScheduleView] = useState(PREP_SCHEDULE_VIEWS.TODAY);
    const [prepFocusMode, setPrepFocusMode] = useState(PREP_FOCUS_MODES.BOARD);
    const [prepFocusDayPart, setPrepFocusDayPart] = useState('morning');
    const [pickedPrepTaskIds, setPickedPrepTaskIds] = useState([]);
    const [prepBoardPhase, setPrepBoardPhase] = useState('');
    const [prepBoardGrouping, setPrepBoardGrouping] = useState(PREP_BOARD_GROUPINGS.STATION);
    const [prepGroupingMenuOpen, setPrepGroupingMenuOpen] = useState(false);
    const [prepTaskStepChecks, setPrepTaskStepChecks] = useState({});
    const [prepJobIngredientDrafts, setPrepJobIngredientDrafts] = useState({});
    const [prepExpandedDayView, setPrepExpandedDayView] = useState(false);
    const [prepActionNotice, setPrepActionNotice] = useState(null);
    const [prepBoardDetail, setPrepBoardDetail] = useState(null);
    const [prepScheduleDayFilter, setPrepScheduleDayFilter] = useState(null);
    const [prepPlans, setPrepPlans] = useState({});
    const [recentRecipeActivity, setRecentRecipeActivity] = useState({});
    const [prepTaskOverrides, setPrepTaskOverrides] = useState({});
    const [prepExecutionSessions, setPrepExecutionSessions] = useState({});
    const [serviceBookingCount, setServiceBookingCount] = useState('');
    const [serviceTimeLabel, setServiceTimeLabel] = useState('');
    const [serviceBrief, setServiceBrief] = useState({
        bookingContext: '',
        guestMix: '',
        dietaryAlerts: '',
        pushFirst: ''
    });
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportQuery, setExportQuery] = useState('');
    const [exportSelectionMap, setExportSelectionMap] = useState({});
    const [exportScaleOverrides, setExportScaleOverrides] = useState({});
    const [exportBulkScale, setExportBulkScale] = useState('1');
    const [exportOrientation, setExportOrientation] = useState('portrait');
    const [exportLayout, setExportLayout] = useState('compact');
    const [exportNotice, setExportNotice] = useState(null);
    const [prepSetupModalOpen, setPrepSetupModalOpen] = useState(false);
    const [prepSetupMode, setPrepSetupMode] = useState('none');
    const [prepSetupDays, setPrepSetupDays] = useState([]);
    const [prepSetupUrgent, setPrepSetupUrgent] = useState(false);
    const [prepSetupAnyDay, setPrepSetupAnyDay] = useState(false);
    const [prepSetupAuto, setPrepSetupAuto] = useState(false);
    const [prepSetupRotateMode, setPrepSetupRotateMode] = useState('week');
    const [prepSetupRotateCount, setPrepSetupRotateCount] = useState('1');
    const [prepSetupQuery, setPrepSetupQuery] = useState('');
    const [prepSetupSelectionMap, setPrepSetupSelectionMap] = useState({});
    const [prepSetupScaleOverrides, setPrepSetupScaleOverrides] = useState({});
    const [prepSetupScaleDrafts, setPrepSetupScaleDrafts] = useState({});
    const [prepSetupActiveChip, setPrepSetupActiveChip] = useState('title');
    const [prepSetupStyleFilter, setPrepSetupStyleFilter] = useState('');
    const [prepSetupCuisineFilter, setPrepSetupCuisineFilter] = useState('');
    const [prepSetupCategoryFilter, setPrepSetupCategoryFilter] = useState('');
    const [prepSetupOccasionFilter, setPrepSetupOccasionFilter] = useState('');
    const [trainingMode, setTrainingMode] = useState(TRAINING_VIEW_MODES.STAFF);
    const [trainingRecipeCategoryFilter, setTrainingRecipeCategoryFilter] = useState('all');
    const [trainingProgressMap, setTrainingProgressMap] = useState(() => {
        if (typeof localStorage === 'undefined') return {};
        try {
            const raw = localStorage.getItem(TRAINING_PROGRESS_STORAGE_PREFIX);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    });
    const [trainingAssignmentDraft, setTrainingAssignmentDraft] = useState('');
    const [costIncomeDrafts, setCostIncomeDrafts] = useState({});
    const [costLibraryGrouping, setCostLibraryGrouping] = useState(COST_LIBRARY_GROUPINGS.DISH);
    const {
        theme, setTheme,
        language, setLanguage,
        unitSystem, setUnitSystem,
        mainPortionSize, setMainPortionSize,
        sidePortionSize, setSidePortionSize,
        starterPortionSize, setStarterPortionSize,
        prepMainPortionSize, setPrepMainPortionSize,
        prepStarterPortionSize, setPrepStarterPortionSize,
        prepComponentPortionSize, setPrepComponentPortionSize,
        prepDipPortionSize, setPrepDipPortionSize,
        prepMarinadePortionSize, setPrepMarinadePortionSize,
        volumeFocus, setVolumeFocus,
        portionsPerBatch, setPortionsPerBatch,
        batchSettings, setBatchSettings,
        translateIngredient, toggleTheme
    } = useSettings();
    const [portionMode, setPortionMode] = useState(false);
    const prepPortionSettings = useMemo(() => ({
        mainPortionSize: prepMainPortionSize,
        sidePortionSize: prepComponentPortionSize,
        starterPortionSize: prepStarterPortionSize,
        portionsPerBatch,
        portionWeightComponent: prepComponentPortionSize,
        portionWeightDip: prepDipPortionSize,
        portionWeightSauce: prepDipPortionSize,
        portionWeightMarinade: prepMarinadePortionSize
    }), [
        portionsPerBatch,
        prepComponentPortionSize,
        prepDipPortionSize,
        prepMainPortionSize,
        prepMarinadePortionSize,
        prepStarterPortionSize
    ]);
    const prepPortionSettingEntries = useMemo(() => ([
        { key: 'prepMainPortionSize', label: 'Main', value: prepMainPortionSize, setter: setPrepMainPortionSize },
        { key: 'prepStarterPortionSize', label: 'Starter / Salad', value: prepStarterPortionSize, setter: setPrepStarterPortionSize },
        { key: 'prepComponentPortionSize', label: 'Small component', value: prepComponentPortionSize, setter: setPrepComponentPortionSize },
        { key: 'prepDipPortionSize', label: 'Sauce dip', value: prepDipPortionSize, setter: setPrepDipPortionSize },
        { key: 'prepMarinadePortionSize', label: 'Marinade', value: prepMarinadePortionSize, setter: setPrepMarinadePortionSize }
    ]), [
        prepComponentPortionSize,
        prepDipPortionSize,
        prepMainPortionSize,
        prepMarinadePortionSize,
        prepStarterPortionSize,
        setPrepComponentPortionSize,
        setPrepDipPortionSize,
        setPrepMainPortionSize,
        setPrepMarinadePortionSize,
        setPrepStarterPortionSize
    ]);
    const [settingsDraft, setSettingsDraft] = useState(() => ({
        prepMainPortionSize,
        prepStarterPortionSize,
        prepComponentPortionSize,
        prepDipPortionSize,
        prepMarinadePortionSize
    }));
    const [activeKitchenProfile, setActiveKitchenProfile] = useState(null);
    const [settingsNotice, setSettingsNotice] = useState(null);
    const settingsDraftDirty = useMemo(() => (
        PREP_PORTION_RULE_FIELDS.some((field) => Number(settingsDraft?.[field.key] || 0) !== Number(
            prepPortionSettingEntries.find((entry) => entry.key === field.key)?.value || 0
        ))
    ), [prepPortionSettingEntries, settingsDraft]);

    useEffect(() => {
        setSettingsDraft({
            prepMainPortionSize,
            prepStarterPortionSize,
            prepComponentPortionSize,
            prepDipPortionSize,
            prepMarinadePortionSize
        });
    }, [
        prepComponentPortionSize,
        prepDipPortionSize,
        prepMainPortionSize,
        prepMarinadePortionSize,
        prepStarterPortionSize
    ]);

    const saveKitchenPortionSettings = async () => {
        const normalizedClientId = typeof scopedClientId === 'string' ? scopedClientId.trim() : '';
        if (!normalizedClientId) {
            setSettingsNotice({ tone: 'error', message: 'Missing client id. Cannot save kitchen defaults.' });
            return;
        }

        const normalizedDraft = PREP_PORTION_RULE_FIELDS.reduce((acc, field) => {
            const nextValue = Number(settingsDraft?.[field.key] || 0);
            if (Number.isFinite(nextValue) && nextValue > 0) {
                acc[field.key] = Math.round(nextValue);
            }
            return acc;
        }, {});

        try {
            const payload = {
                kitchen_id: activeKitchenProfile?.kitchen_id || `${normalizedClientId}-default-kitchen`,
                client_id: normalizedClientId,
                name: activeKitchenProfile?.name || 'Main Kitchen',
                equipment_inventory: Array.isArray(activeKitchenProfile?.equipment_inventory) ? activeKitchenProfile.equipment_inventory : [],
                portion_rules: buildKitchenProfilePortionRules(normalizedDraft),
                prep_rules: activeKitchenProfile?.prep_rules && typeof activeKitchenProfile.prep_rules === 'object' && !Array.isArray(activeKitchenProfile.prep_rules)
                    ? activeKitchenProfile.prep_rules
                    : {},
                updated_by: userProfile?.email || userProfile?.id || 'dashboard_settings'
            };

            const { data: upsertedProfile, error: kitchenProfileError } = await withSupabaseTransportDiagnostic({
                operation: 'kitchen_profiles.upsert',
                timeoutMs: SUPABASE_FETCH_HANG_TIMEOUT_MS,
                clientId: normalizedClientId,
                run: () => supabase
                    .from('kitchen_profiles')
                    .upsert(payload, { onConflict: 'kitchen_id' })
                    .select('*')
                    .single()
            });

            if (kitchenProfileError) throw kitchenProfileError;

            setActiveKitchenProfile(upsertedProfile || payload);
            prepPortionSettingEntries.forEach((entry) => {
                const nextValue = Number(normalizedDraft?.[entry.key] || entry.value || 0);
                if (Number.isFinite(nextValue) && nextValue > 0) {
                    entry.setter(Math.round(nextValue));
                }
            });
            setSettingsNotice({ tone: 'success', message: 'Kitchen defaults saved to Supabase. Prep Board portion output is updated.' });
        } catch (error) {
            console.error('Kitchen profile save failed:', error);
            setSettingsNotice({ tone: 'error', message: 'Could not save kitchen defaults to Supabase. Local settings were not changed.' });
        }
    };

    const normalizedRole = String(userProfile?.role || userProfile?.profileSnapshot?.role || 'staff').toLowerCase();
    const authScopeState = useMemo(
        () => buildAuthScopeState({ userProfile, clientId: client_id, connectionState }),
        [userProfile, client_id, connectionState]
    );
    const identitySessionState = useMemo(
        () => buildIdentitySessionState({ userProfile, sessionUser, authScopeState }),
        [userProfile, sessionUser, authScopeState]
    );
    const scopedClientId = authScopeState.normalizedClientId || client_id;
    const canApproveSync = MANAGER_APPROVAL_ROLES.has(normalizedRole) && authScopeState.canApproveRecipeSync;
    const roleWorkspaceConfig = useMemo(
        () => buildRoleWorkspaceConfig({ normalizedRole, canApproveSync, identitySessionState }),
        [normalizedRole, canApproveSync, identitySessionState]
    );
    const isStaffWorkspace = roleWorkspaceConfig.workspaceType === 'staff';
    const canUseManagerTrainingMode = canApproveSync && identitySessionState.canUsePrivilegedWorkspace;
    const visibleWorkflowViews = useMemo(
        () => CABIJ_WORKFLOW_VIEWS.filter((item) => roleWorkspaceConfig.allowedViews.includes(item.id)),
        [roleWorkspaceConfig]
    );
    const prepOperatorLabel = String(
        userProfile?.full_name
        || userProfile?.name
        || userProfile?.profileSnapshot?.full_name
        || userProfile?.profileSnapshot?.name
        || userProfile?.email
        || normalizedRole
        || 'Kitchen team'
    ).trim();

    useEffect(() => {
        setTrainingMode((current) => {
            if (!canUseManagerTrainingMode) return TRAINING_VIEW_MODES.STAFF;
            if (current === TRAINING_VIEW_MODES.MANAGER || current === TRAINING_VIEW_MODES.STAFF) return current;
            return canApproveSync ? TRAINING_VIEW_MODES.MANAGER : TRAINING_VIEW_MODES.STAFF;
        });
    }, [canApproveSync, canUseManagerTrainingMode]);

    useEffect(() => {
        const allowedViews = Array.isArray(roleWorkspaceConfig.allowedViews) ? roleWorkspaceConfig.allowedViews : [];
        setView((current) => {
            if (!allowedViews.includes(current)) {
                return roleWorkspaceConfig.defaultView;
            }
            if (!roleWorkspaceInitializedRef.current) {
                roleWorkspaceInitializedRef.current = true;
                if (current === DASHBOARD_VIEWS.SCALER && roleWorkspaceConfig.defaultView !== DASHBOARD_VIEWS.SCALER) {
                    return roleWorkspaceConfig.defaultView;
                }
            }
            return current;
        });
    }, [roleWorkspaceConfig]);

    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(TRAINING_PROGRESS_STORAGE_PREFIX, JSON.stringify(trainingProgressMap));
        } catch (error) {
            // Ignore storage write failures on unsupported devices.
        }
    }, [trainingProgressMap]);

    const getRecipeKey = (recipe, fallback = null) => (
        getRecipeLookupKey(recipe, fallback)
    );

    const readQueuedRecipeEdits = () => {
        const queued = readOfflineQueue({ clientId: scopedClientId, queueType: OFFLINE_QUEUE_TYPES.RECIPE_EDITS });
        const entries = Array.isArray(queued?.entries) ? queued.entries : [];
        setRecipeQueue(entries);
        return { ...queued, entries };
    };

    const persistQueueEntries = (entries) => {
        const saved = saveOfflineQueue({
            clientId: scopedClientId,
            queueType: OFFLINE_QUEUE_TYPES.RECIPE_EDITS,
            entries
        });

        if (!saved.ok) {
            setSyncNotice({
                tone: 'error',
                message: saved.reason || 'Queue could not be saved on this device.'
            });
            return false;
        }

        setRecipeQueue(entries);
        const nextVisible = mergeRecipesWithQueue(recipes, { entries });
        setRecipes(nextVisible);
        persistVisibleRecipes(nextVisible, entries);
        return true;
    };

    const persistRecipeEditToQueue = (recipe, {
        source = 'recipe-truth-edit',
        reason = null,
        auditEvent = null
    } = {}) => {
        if (!recipe) return false;
        if (!authScopeState.canQueueRecipeEdits) {
            setSyncNotice({
                tone: authScopeState.tone === 'red' ? 'error' : 'warning',
                message: authScopeState.reason || 'Recipe truth is read-only until auth and client scope are trusted.'
            });
            return false;
        }

        const currentEntries = readQueuedRecipeEdits().entries;
        const status = canApproveSync ? OFFLINE_STATE.APPROVED : OFFLINE_STATE.APPROVAL_REQUIRED;
        const nextReason = reason || (canApproveSync ? 'manager_recipe_edit_ready_for_sync' : 'recipe_edit_waiting_manager_approval');
        const queuedEntry = buildQueuedRecipeEntry({
            recipe: sanitizeQueuedRecipe({
                ...recipe,
                offline_sync_state: status,
                offline_sync_reason: nextReason
            }, scopedClientId),
            clientId: scopedClientId,
            source,
            status,
            reason: nextReason,
            auditEvent: auditEvent || {
                eventType: 'recipe_queued',
                actor: userProfile?.full_name || userProfile?.id || userProfile?.role || prepOperatorLabel || 'editor',
                reason: nextReason,
                status,
                source,
                changedFields: Array.isArray(recipe?.changedFields) ? recipe.changedFields : [],
                retrainingFields: Array.isArray(recipe?.retrainingFields) ? recipe.retrainingFields : [],
                note: nextReason
            }
        });

        const nextEntries = [
            ...currentEntries.filter((entry) => String(entry?.id || '') !== String(queuedEntry.id || '')),
            queuedEntry
        ];

        const saved = persistQueueEntries(nextEntries);
        if (saved) {
            setSyncNotice({
                tone: canApproveSync ? 'success' : 'info',
                message: canApproveSync
                    ? 'Recipe edit saved locally and marked ready for manager sync confirmation.'
                    : 'Recipe edit saved locally and is waiting for manager approval.'
            });
        }
        return saved;
    };

    const saveRecipePatch = (patch, { source = 'recipe-meta-edit' } = {}) => {
        if (!activeRecipe) return false;
        const nextRecipe = {
            ...activeRecipe,
            ...patch
        };
        return persistRecipeEditToQueue(nextRecipe, {
            source,
            auditEvent: {
                eventType: 'recipe_updated',
                actor: userProfile?.full_name || userProfile?.id || userProfile?.role || prepOperatorLabel || 'editor',
                reason: source,
                source,
                changedFields: Object.keys(patch || {}),
                retrainingFields: Object.keys(patch || {}).filter((field) => ['ingredients', 'instructions', 'method', 'steps', 'allergens', 'baseYield', 'base_yield', 'unit', 'yieldMode', 'yield_mode', 'prepIntelligence', 'scalingTips'].includes(field))
            }
        });
    };

    const buildPrepPlanEntry = ({
        mode = 'prepThisWeek',
        recipe,
        days = [],
        urgent = false,
        anyDay = false,
        auto = false,
        rotateMode = 'week',
        rotateCount = 1,
        quantityOverride = null,
        existingPlan = null
    } = {}) => {
        if (!recipe) return null;
        const recipePlanKey = String(getRecipeKey(recipe) || '');
        if (!recipePlanKey) return null;
        const previousPlan = existingPlan || prepPlans?.[recipePlanKey] || {};
        const plannedQuantity = getFirstFiniteNumber(
            quantityOverride,
            dailyProduction?.[recipePlanKey],
            previousPlan?.quantity,
            recipe?.baseYield,
            recipe?.yield,
            0
        );
        const historyEntry = {
            quantity: Number(plannedQuantity || 0),
            updatedAt: new Date().toISOString()
        };
        const nextPlan = {
            mode,
            recipeKey: recipePlanKey,
            recipeName: recipe?.name || recipe?.title || 'Recipe',
            quantity: Number(plannedQuantity || 0),
            days,
            urgent,
            anyDay,
            auto,
            rotateMode,
            rotateCount: Number(rotateCount || 1),
            updatedAt: historyEntry.updatedAt,
            history: [historyEntry, ...(Array.isArray(previousPlan?.history) ? previousPlan.history : [])].slice(0, 6)
        };
        return nextPlan;
    };

    const savePrepPlanForRecipe = ({
        mode = 'prepThisWeek',
        recipe,
        days = [],
        urgent = false,
        anyDay = false,
        auto = false,
        rotateMode = 'week',
        rotateCount = 1,
        quantityOverride = null,
        silent = false
    } = {}) => {
        const nextPlan = buildPrepPlanEntry({
            mode,
            recipe,
            days,
            urgent,
            anyDay,
            auto,
            rotateMode,
            rotateCount,
            quantityOverride
        });
        if (!nextPlan) return false;
        persistPrepPlans({
            ...(prepPlans || {}),
            [nextPlan.recipeKey]: nextPlan
        });
        if (!silent) {
            setPrepActionNotice({
                tone: 'success',
                message: `${nextPlan.recipeName} prep plan saved for this kitchen.`
            });
        }
        return true;
    };

    const visibleRecipes = useMemo(() => recipes, [recipes]);
    const recipeOperationalIndex = useMemo(() => buildRecipeOperationalIndex(visibleRecipes, {
        getRecipeKey: (recipe, index) => getRecipeKey(recipe, `idx-${index}`),
        getPlanningDefaults: (recipe) => getRecipePlanningDefaults(recipe, {
            mainPortionSize,
            sidePortionSize,
            starterPortionSize,
            portionsPerBatch
        }, visibleRecipes, volumeFocus)
    }), [
        visibleRecipes,
        mainPortionSize,
        sidePortionSize,
        starterPortionSize,
        portionsPerBatch,
        volumeFocus
    ]);

    const clearPrepTaskOverride = (recipeKey) => {
        if (!recipeKey) return;
        setPrepTaskOverrides((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, recipeKey)) return prev;
            const next = { ...prev };
            delete next[recipeKey];
            return next;
        });
    };

    const clearAllPrepTaskOverrides = () => {
        setPrepTaskOverrides({});
    };

    const applyRecipeYieldTarget = ({
        recipe,
        recipeKey,
        nextYield,
        overrideReason = null,
        clearOverride = false
    }) => {
        if (!recipeKey) return;
        const normalizedYield = Number(Number(nextYield || 0).toFixed(2));
        setDailyProduction((prev) => ({
            ...prev,
            [recipeKey]: normalizedYield
        }));

        if (clearOverride) {
            clearPrepTaskOverride(recipeKey);
            return;
        }

        if (!overrideReason) return;

        const previousYield = Number(dailyProduction?.[recipeKey] || recipe?.baseYield || recipe?.yield || 0);
        const reasonText = `${recipe?.name || 'Recipe'} target was chef-adjusted from ${Number(previousYield || 0).toFixed(2)} to ${normalizedYield.toFixed(2)} ${String(recipe?.unit || '').trim()}`.trim();
        setPrepTaskOverrides((prev) => ({
            ...prev,
            [recipeKey]: {
                type: 'yield_override',
                reason: overrideReason,
                reasonText,
                previousYield: Number(previousYield.toFixed(2)),
                targetYield: normalizedYield,
                updatedAt: new Date().toISOString()
            }
        }));
    };

    const formatPrepSessionDuration = (startedAtIso) => {
        if (!startedAtIso) return '';
        const startedAtMs = new Date(startedAtIso).getTime();
        if (!Number.isFinite(startedAtMs)) return '';
        const elapsedMs = Date.now() - startedAtMs;
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '';
        const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
        if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
        const hours = Math.floor(elapsedMinutes / 60);
        const minutes = elapsedMinutes % 60;
        return `${hours}h ${minutes}m`;
    };

    const persistVisibleRecipes = (serverRecipes, queueEntries) => {
        const visible = mergeRecipesWithQueue(serverRecipes, { entries: Array.isArray(queueEntries) ? queueEntries : [] });
        saveOfflineCache({
            clientId: scopedClientId,
            type: OFFLINE_CACHE_TYPES.RECIPES,
            payload: { recipes: visible }
        });
        return visible;
    };

    const persistPrepPlans = (nextPlans) => {
        setPrepPlans(nextPlans);
        saveOfflineCache({
            clientId: scopedClientId,
            type: OFFLINE_CACHE_TYPES.PREP_PLANS,
            payload: { plans: nextPlans }
        });
    };

    const buildDailyProduction = (recipeList, focus = volumeFocus) => {
        return recipeList.reduce((acc, recipe, index) => {
            if (!recipe) return acc;
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const defaultTargetYield = Number(
                recipeOperationalIndex.byKey?.[recipeKey]?.defaultTargetYield
                || recipe?.baseYield
                || recipe?.yield
                || 0
            );
            acc[recipeKey] = Number(defaultTargetYield.toFixed(2));
            return acc;
        }, {});
    };

    const applyRecipeList = (recipeList, source = 'online', reason = null) => {
        setRecipes(recipeList);
        setOfflineDataState({ source, reason });
        if (recipeList.length > 0) {
            if (!selectedId) setSelectedId(getRecipeKey(recipeList[0], 'idx-0'));
            setDailyProduction(prev => ({ ...buildDailyProduction(recipeList), ...prev }));
        }
    };

    const readCachedRecipes = () => {
        const cached = readOfflineCache({ clientId: scopedClientId, type: OFFLINE_CACHE_TYPES.RECIPES });
        const cachedRecipes = cached?.payload?.recipes;
        if (!Array.isArray(cachedRecipes)) return false;
        applyRecipeList(
            cachedRecipes,
            cached?.trust?.isDegraded ? 'offline-cache-degraded' : 'offline-cache',
            cached?.trust?.reason || null
        );
        return true;
    };

    useEffect(() => {
        if (typeof localStorage === 'undefined') {
            setRecentRecipeActivity({});
            return;
        }

        const storageKey = recentRecipeActivityKeyFor(scopedClientId);
        if (!storageKey) {
            setRecentRecipeActivity({});
            return;
        }

        try {
            const raw = localStorage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : {};
            setRecentRecipeActivity(parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_error) {
            setRecentRecipeActivity({});
        }
    }, [scopedClientId]);

    useEffect(() => {
        const cachedPrepPlans = readOfflineCache({ clientId: scopedClientId, type: OFFLINE_CACHE_TYPES.PREP_PLANS });
        const plans = cachedPrepPlans?.payload?.plans;
        setPrepPlans(plans && typeof plans === 'object' ? plans : {});
    }, [scopedClientId]);

    const parseRecipeRows = (rows) => {
        return (rows || [])
            .map((row) => {
                const recipe = normalizeSupabaseRecipeRecord({ row, clientId: row?.client_id || scopedClientId });
                if (!recipe) return null;

                return {
                    ...recipe,
                    offline_base_freshness: buildRecipeFreshnessMarker({
                        row,
                        recipe,
                        clientId: row?.client_id || scopedClientId
                    }),
                    canonical_name: recipe.canonical_name || recipe.clean_name || recipe.name,
                };
            })
            .filter(Boolean);
    };

    const parsePrepProfileRows = (rows) => {
        return (rows || [])
            .map((row) => normalizeRecipePrepProfileRecord({ row, clientId: row?.client_id || scopedClientId }))
            .filter(Boolean);
    };

    const parseExtendedProfileRows = (rows) => {
        return (rows || [])
            .map((row) => normalizeRecipeExtendedProfileRecord({ row, clientId: row?.client_id || scopedClientId }))
            .filter(Boolean);
    };

    const buildProfilesByRef = (profiles) => {
        return (profiles || []).reduce((acc, profile) => {
            const lookupKeys = [
                profile?.recipe_ref_id,
                profile?.recipeRefId,
                profile?.canonical_id,
                profile?.canonicalId,
                profile?.recipe_code,
                profile?.recipeCode,
                profile?.id
            ]
                .map((value) => normalizeRecipeLookupValue(value))
                .filter(Boolean);

            if (lookupKeys.length === 0) return acc;
            lookupKeys.forEach((lookupKey) => {
                if (!acc[lookupKey]) acc[lookupKey] = profile;
            });
            return acc;
        }, {});
    };

    const mergeRecipesWithProfiles = (recipes, prepProfilesByRef, extendedProfilesByRef) => {
        return (recipes || []).map((recipe) => {
            const lookupKeys = [
                recipe?.recipe_ref_id,
                recipe?.canonical_id,
                recipe?.code,
                recipe?.id
            ]
                .map((value) => normalizeRecipeLookupValue(value))
                .filter(Boolean);

            const prepLookupKey = lookupKeys.find((value) => Boolean(prepProfilesByRef?.[value]));
            const extendedLookupKey = lookupKeys.find((value) => Boolean(extendedProfilesByRef?.[value]));
            const withPrepProfile = mergeRecipeWithPrepProfile(
                recipe,
                prepLookupKey ? prepProfilesByRef?.[prepLookupKey] || null : null
            );
            return mergeRecipeWithExtendedProfile(
                withPrepProfile,
                extendedLookupKey ? extendedProfilesByRef?.[extendedLookupKey] || null : null
            );
        });
    };

    const fetchRecipes = async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        try {
            const normalizedClientId = typeof scopedClientId === 'string' ? scopedClientId.trim() : '';
            if (!normalizedClientId) {
                console.error('[Dashboard] Missing client_id. Recipe fetch aborted before Supabase call.', { client_id });
                setRecipeQueue([]);
                setRecipes([]);
                setOfflineDataState({ source: 'missing-client-id', reason: 'Missing client_id. Re-authenticate and retry.' });
                setSyncNotice({
                    tone: 'error',
                    message: 'Missing client id. Cannot load recipe library for this profile.'
                });
                return;
            }

            if (!authScopeState.canReadLiveRecipes) {
                setRecipeQueue([]);
                if (authScopeState.canReadCachedRecipes && readCachedRecipes()) {
                    setOfflineDataState({ source: authScopeState.status, reason: authScopeState.reason || null });
                    setSyncNotice({
                        tone: authScopeState.tone === 'red' ? 'error' : 'warning',
                        message: authScopeState.reason || 'Read-only auth fallback is active. Live recipe truth edits and sync are disabled.'
                    });
                    return;
                }

                setRecipes([]);
                setOfflineDataState({ source: authScopeState.status, reason: authScopeState.reason || null });
                setSyncNotice({
                    tone: authScopeState.tone === 'red' ? 'error' : 'warning',
                    message: authScopeState.reason || 'Recipe truth is blocked until auth and client scope are trusted.'
                });
                return;
            }

            const queued = readQueuedRecipeEdits();

            if (typeof navigator !== 'undefined' && navigator.onLine === false && readCachedRecipes()) {
                return;
            }

            const { data, error } = await withSupabaseTransportDiagnostic({
                operation: 'recipes.select',
                timeoutMs: SUPABASE_FETCH_HANG_TIMEOUT_MS,
                clientId: normalizedClientId,
                run: () => supabase
                    .from(RECIPE_SOURCE.SUPABASE_RECIPES)
                    .select('*')
                    .eq('client_id', normalizedClientId)
            });

            if (error) throw error;

            let prepProfileRows = [];
            let extendedProfileRows = [];
            try {
                const { data: prepProfileData, error: prepProfileError } = await withSupabaseTransportDiagnostic({
                    operation: 'recipe_prep_profiles.select',
                    timeoutMs: SUPABASE_FETCH_HANG_TIMEOUT_MS,
                    clientId: normalizedClientId,
                    run: () => supabase
                        .from('recipe_prep_profiles')
                        .select('*')
                        .eq('client_id', normalizedClientId)
                        .in('status', ['active', 'review_required'])
                        .order('profile_version', { ascending: false })
                        .order('generated_at', { ascending: false })
                });

                if (prepProfileError) throw prepProfileError;
                prepProfileRows = prepProfileData || [];
            } catch (prepProfileError) {
                console.warn('[Dashboard] Workflow 2 prep profile fetch failed; continuing with recipe truth only.', prepProfileError);
            }

            try {
                const { data: extendedProfileData, error: extendedProfileError } = await withSupabaseTransportDiagnostic({
                    operation: 'recipe_extended_profiles.select',
                    timeoutMs: SUPABASE_FETCH_HANG_TIMEOUT_MS,
                    clientId: normalizedClientId,
                    run: () => supabase
                        .from('recipe_extended_profiles')
                        .select('*')
                        .eq('client_id', normalizedClientId)
                        .eq('status', 'active')
                        .order('generated_at', { ascending: false })
                });

                if (extendedProfileError) throw extendedProfileError;
                extendedProfileRows = extendedProfileData || [];
            } catch (extendedProfileError) {
                console.warn('[Dashboard] Workflow 3 extended profile fetch failed; continuing with WF1/WF2 only.', extendedProfileError);
            }

            try {
                const { data: kitchenProfileData, error: kitchenProfileError } = await withSupabaseTransportDiagnostic({
                    operation: 'kitchen_profiles.select',
                    timeoutMs: SUPABASE_FETCH_HANG_TIMEOUT_MS,
                    clientId: normalizedClientId,
                    run: () => supabase
                        .from('kitchen_profiles')
                        .select('*')
                        .eq('client_id', normalizedClientId)
                        .order('updated_at', { ascending: false })
                        .limit(1)
                });

                if (kitchenProfileError) throw kitchenProfileError;
                const nextKitchenProfile = Array.isArray(kitchenProfileData) ? kitchenProfileData[0] || null : null;
                setActiveKitchenProfile(nextKitchenProfile);
                if (nextKitchenProfile) {
                    const nextPortionRules = parseKitchenPortionRules(nextKitchenProfile);
                    setPrepMainPortionSize(nextPortionRules.prepMainPortionSize);
                    setPrepStarterPortionSize(nextPortionRules.prepStarterPortionSize);
                    setPrepComponentPortionSize(nextPortionRules.prepComponentPortionSize);
                    setPrepDipPortionSize(nextPortionRules.prepDipPortionSize);
                    setPrepMarinadePortionSize(nextPortionRules.prepMarinadePortionSize);
                }
            } catch (kitchenProfileError) {
                console.warn('[Dashboard] kitchen_profiles fetch failed; continuing with local portion settings only.', kitchenProfileError);
            }

            const parsed = parseRecipeRows(data);
            const prepProfilesByRef = buildProfilesByRef(parsePrepProfileRows(prepProfileRows));
            const extendedProfilesByRef = buildProfilesByRef(parseExtendedProfileRows(extendedProfileRows));
            const mergedRecipes = mergeRecipesWithProfiles(parsed, prepProfilesByRef, extendedProfilesByRef);
            const visible = persistVisibleRecipes(mergedRecipes, queued.entries);
            applyRecipeList(visible, 'online');
        } catch (error) {
            console.error('Recipe hydration failed:', error);
            const transportHang = error?.isSupabaseTransportHang === true;
            if (transportHang) {
                console.error(
                    `[Dashboard] Supabase transport hang confirmed (${error.timeoutMs}ms timeout) while fetching recipes`,
                    { operation: error.operation, clientId: error.clientId }
                );
                setSyncNotice({
                    tone: 'error',
                    message: `Supabase transport hang detected (${error.timeoutMs}ms). Showing local cache when available.`
                });
            }
            if (!readCachedRecipes()) {
                setRecipes([]);
                setOfflineDataState({
                    source: transportHang ? 'supabase-transport-hang' : 'missing-cache',
                    reason: transportHang
                        ? `Supabase request exceeded ${error.timeoutMs}ms without a response.`
                        : error.message
                });
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchRecipesRef = useRef(fetchRecipes);
    fetchRecipesRef.current = fetchRecipes;

    useEffect(() => {
        fetchRecipes();
    }, [authScopeState, scopedClientId]);

    useEffect(() => {
        if (!authScopeState?.canReadLiveRecipes) return undefined;
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

        const refreshLiveRecipes = () => {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            fetchRecipesRef.current?.({ silent: true });
        };

        const handleWindowFocus = () => refreshLiveRecipes();
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') refreshLiveRecipes();
        };

        window.addEventListener('focus', handleWindowFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', handleWindowFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [authScopeState, scopedClientId]);

    useEffect(() => {
        const updateConnection = () => {
            const nextState = typeof navigator !== 'undefined' && navigator.onLine === false
                ? OFFLINE_STATE.OFFLINE
                : OFFLINE_STATE.ONLINE;
            setConnectionState(nextState);

            if (nextState === OFFLINE_STATE.ONLINE) {
                const queued = readQueuedRecipeEdits();
                if ((queued.entries || []).some((entry) => [OFFLINE_STATE.LOCAL, OFFLINE_STATE.PENDING, OFFLINE_STATE.APPROVAL_REQUIRED, OFFLINE_STATE.APPROVED, OFFLINE_STATE.FAILED].includes(entry?.status || OFFLINE_STATE.PENDING))) {
                    setSyncNotice({
                        tone: 'warning',
                        message: 'Connection restored. Review the local recipe queue, approve as manager, then confirm sync.'
                    });
                }
            } else {
                setSyncNotice({
                    tone: 'warning',
                    message: 'Offline mode is active. Recipe edits stay local until reconnect, manager approval, and sync confirmation.'
                });
            }

            if (authScopeState.isDegraded) {
                setSyncNotice({
                    tone: authScopeState.tone === 'red' ? 'error' : 'warning',
                    message: authScopeState.reason
                });
            }
        };

        updateConnection();
        window.addEventListener('online', updateConnection);
        window.addEventListener('offline', updateConnection);
        return () => {
            window.removeEventListener('online', updateConnection);
            window.removeEventListener('offline', updateConnection);
        };
    }, [authScopeState, scopedClientId]);

    const handleApproveQueueForSync = () => {
        if (!authScopeState.canApproveRecipeSync) {
            setSyncNotice({
                tone: authScopeState.tone === 'red' ? 'error' : 'warning',
                message: authScopeState.reason || 'Trusted manager auth is required before approval can change recipe truth.'
            });
            return;
        }
        const currentEntries = readQueuedRecipeEdits().entries;
        if (!currentEntries.length) {
            setSyncNotice({ tone: 'info', message: 'No local recipe edits are queued for approval.' });
            return;
        }

        if (!canApproveSync) {
            const nextEntries = markUnapprovedEntriesAsApprovalRequired(currentEntries);
            persistQueueEntries(nextEntries);
            setSyncNotice({
                tone: 'error',
                message: 'Manager approval required. This profile cannot approve recipe sync.'
            });
            return;
        }

        const nextEntries = markQueueEntriesForApproval({ entries: currentEntries, approver: userProfile });
        if (persistQueueEntries(nextEntries)) {
            setSyncNotice({
                tone: 'success',
                message: 'Manager approval recorded. Approved recipe edits are ready for explicit sync confirmation.'
            });
        }
    };

    const syncApprovedRecipeEntry = async (entry) => {
        const recipe = appendRecipeProfileAuditEvent({
            recipe: sanitizeQueuedRecipe(entry?.recipe || {}, scopedClientId),
            event: {
                eventType: 'recipe_sync_ready',
                actor: userProfile?.full_name || userProfile?.id || userProfile?.role || prepOperatorLabel || 'manager',
                reason: 'manager_approved_sync',
                status: OFFLINE_STATE.APPROVED,
                queueEntryId: entry?.id || '',
                changedFields: Array.isArray(entry?.recipe?.changedFields) ? entry.recipe.changedFields : [],
                retrainingFields: Array.isArray(entry?.recipe?.retrainingFields) ? entry.recipe.retrainingFields : []
            }
        });
        const recipeRefId = recipe.recipe_ref_id ? String(recipe.recipe_ref_id) : '';
        const canUpdateExisting = recipeRefId && !isLocalQueueRecipeId(recipeRefId);

        if (canUpdateExisting) {
            const baseFreshness = getQueuedRecipeBaseFreshness(entry);
            if (!baseFreshness) {
                throw createSyncConflictError('missing_recipe_freshness_conflict');
            }

            const { data: currentRows, error: currentError } = await supabase
                .from('recipes')
                .select('*')
                .eq('client_id', scopedClientId)
                .eq('id', recipeRefId)
                .limit(1);
            if (currentError) throw currentError;

            const currentRow = Array.isArray(currentRows) ? currentRows[0] : null;
            if (!currentRow) {
                throw createSyncConflictError('upstream_recipe_not_found_conflict');
            }

            const currentRecipe = typeof currentRow[DB_FIELDS.RECIPE_JSON] === 'string'
                ? JSON.parse(currentRow[DB_FIELDS.RECIPE_JSON])
                : currentRow[DB_FIELDS.RECIPE_JSON];
            const currentFreshness = buildRecipeFreshnessMarker({
                row: currentRow,
                recipe: currentRecipe || {},
                clientId: scopedClientId
            });

            if (!recipeFreshnessMatches(baseFreshness, currentFreshness)) {
                throw createSyncConflictError('stale_recipe_freshness_conflict');
            }

            const rowPayload = buildRecipesTableWritePayload({
                recipe,
                clientId: scopedClientId,
                status: OFFLINE_STATE.SYNCED,
                reason: 'manager_approved_sync'
            });
            const { data, error } = await supabase
                .from('recipes')
                .update(rowPayload)
                .eq('client_id', scopedClientId)
                .eq('id', recipeRefId)
                .select('id');
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) return data[0].id;
            throw createSyncConflictError('upstream_recipe_not_found_conflict');
        }

        const insertPayload = buildRecipesTableWritePayload({
            recipe,
            clientId: scopedClientId,
            status: OFFLINE_STATE.SYNCED,
            reason: 'manager_approved_sync'
        });
        const { data, error } = await supabase
            .from('recipes')
            .insert(insertPayload)
            .select('id')
            .single();
        if (error) throw error;
        const insertedRecipeId = data?.id;
        if (!insertedRecipeId) throw new Error('upstream_recipe_id_missing_after_insert');

        const finalizedPayload = buildRecipesTableWritePayload({
            recipe,
            clientId: scopedClientId,
            upstreamRecipeId: insertedRecipeId,
            forceUpstreamIdentity: true,
            status: OFFLINE_STATE.SYNCED,
            reason: 'manager_approved_sync'
        });
        const { error: finalizeError } = await supabase
            .from('recipes')
            .update(finalizedPayload)
            .eq('client_id', scopedClientId)
            .eq('id', insertedRecipeId);
        if (finalizeError) throw finalizeError;
        return insertedRecipeId;
    };

    const activeRecipe = useMemo(() => {
        if (!Array.isArray(visibleRecipes) || visibleRecipes.length === 0) return null;
        const found = visibleRecipes.find((r, index) => r && getRecipeKey(r, `idx-${index}`) === selectedId);
        return found || visibleRecipes[0];
    }, [selectedId, visibleRecipes]);
    const activeRecipeKey = activeRecipe ? getRecipeKey(activeRecipe) : selectedId;
    const currentYieldValue = activeRecipeKey ? (dailyProduction[activeRecipeKey] || 0) : 0;

    const currentPortionWeight = useMemo(() => {
        return getPortionSize(activeRecipe, {
            mainPortionSize,
            sidePortionSize,
            starterPortionSize,
            portionsPerBatch
        }, visibleRecipes);
    }, [activeRecipe, mainPortionSize, sidePortionSize, starterPortionSize, portionsPerBatch, visibleRecipes]);

    const currentPortionCount = useMemo(() => {
        if (!activeRecipe) return 0;
        if (activeRecipe.unit?.toLowerCase().includes('portion')) return Math.round(currentYieldValue);
        return Math.round(currentYieldValue / currentPortionWeight);
    }, [currentYieldValue, activeRecipe, currentPortionWeight]);
    const activeCostIncomeDraft = activeRecipeKey ? (costIncomeDrafts?.[activeRecipeKey] || '') : '';

    const activePrepPlan = useMemo(() => {
        if (!activeRecipe) return null;
        const recipePlanKey = String(getRecipeKey(activeRecipe) || '');
        return prepPlans?.[recipePlanKey] || null;
    }, [activeRecipe, prepPlans]);
    const activePrepPlanSummary = useMemo(() => {
        if (!activeRecipe) return null;
        if (!activePrepPlan) {
            const fallbackQuantity = getFirstFiniteNumber(
                dailyProduction?.[activeRecipeKey],
                activeRecipe?.baseYield,
                activeRecipe?.yield,
                0
            );
            return {
                title: activeRecipe?.name || activeRecipe?.title || 'Selected recipe',
                modeLabel: 'No saved prep plan',
                detail: 'Save Prep this week or Rotate prep from Recipe Truth or this board.',
                quantityLabel: formatPrepTaskQuantity(
                    Number(fallbackQuantity || 0),
                    activeRecipe?.unit || ''
                ) || 'No target',
                badges: []
            };
        }

        const resolvedPlanQuantity = getFirstFiniteNumber(
            activePrepPlan?.quantity,
            dailyProduction?.[activeRecipeKey],
            0
        );
        const quantityLabel = formatPrepTaskQuantity(
            Number(resolvedPlanQuantity || 0),
            activeRecipe?.unit || ''
        ) || 'No target';
        const dayLabel = formatPrepPlanDaySummary({
            days: activePrepPlan?.days,
            anyDay: activePrepPlan?.anyDay
        });
        const modeLabel = activePrepPlan?.mode === 'rotatePrep'
            ? `Rotate prep / ${activePrepPlan?.rotateCount || 1}x per ${activePrepPlan?.rotateMode || 'week'}`
            : 'Prep this week';
        const badges = [
            activePrepPlan?.urgent ? 'Urgent' : '',
            activePrepPlan?.auto ? 'Auto' : '',
            quantityLabel ? `Qty ${quantityLabel}` : ''
        ].filter(Boolean);

        return {
            title: activeRecipe?.name || activeRecipe?.title || activePrepPlan?.recipeName || 'Selected recipe',
            modeLabel,
            detail: dayLabel,
            quantityLabel,
            badges
        };
    }, [activePrepPlan, activeRecipe, activeRecipeKey, dailyProduction]);

    const queueSummary = useMemo(() => summarizeOfflineQueue({ entries: recipeQueue }), [recipeQueue]);
    const selectedQueueEntry = useMemo(() => {
        if (!Array.isArray(recipeQueue) || recipeQueue.length === 0) return null;
        return recipeQueue.find((entry) => entry?.id === selectedQueueEntryId) || recipeQueue[0];
    }, [recipeQueue, selectedQueueEntryId]);
    const selectedQueueRecipe = selectedQueueEntry?.recipe || null;
    const selectedQueueRecipeKey = useMemo(() => getRecipeKey(selectedQueueRecipe), [selectedQueueRecipe]);
    const selectedQueueYieldValue = selectedQueueRecipeKey ? (dailyProduction[selectedQueueRecipeKey] || 0) : 0;
    const selectedQueuePortionWeight = getPortionSize(selectedQueueRecipe, {
        mainPortionSize,
        sidePortionSize,
        starterPortionSize,
        portionsPerBatch
    }, visibleRecipes);
    const selectedQueuePortionCount = useMemo(() => {
        if (!selectedQueueRecipe) return 0;
        if (selectedQueueRecipe.unit?.toLowerCase().includes('portion')) return Math.round(selectedQueueYieldValue);
        if (!selectedQueuePortionWeight) return 0;
        return Math.round(selectedQueueYieldValue / selectedQueuePortionWeight);
    }, [selectedQueueRecipe, selectedQueueYieldValue, selectedQueuePortionWeight]);

    const isPrepSetupWeekMode = prepSetupMode === 'prepThisWeek';
    const isPrepSetupRotateMode = prepSetupMode === 'rotatePrep';
    const isPrepSetupActive = isPrepSetupWeekMode || isPrepSetupRotateMode;
    const prepSetupQuantity = getFirstFiniteNumber(
        dailyProduction?.[activeRecipeKey],
        activePrepPlan?.quantity,
        activeRecipe?.baseYield,
        activeRecipe?.yield,
        0
    );
    const prepSetupQuantityLabel = formatPrepTaskQuantity(
        Number(prepSetupQuantity || 0),
        activeRecipe?.unit || ''
    ) || 'No target';
    const prepSetupCurrentPlanLabel = activePrepPlan?.mode === 'rotatePrep'
        ? `Rotate prep / ${Number(activePrepPlan?.rotateCount || 1)}x per ${activePrepPlan?.rotateMode || 'week'}`
        : (activePrepPlan?.mode === 'prepThisWeek' ? 'Prep this week' : 'No prep plan yet');
    const prepSetupCurrentPlanDetail = activePrepPlan?.mode
        ? formatPrepPlanDaySummary({ days: activePrepPlan?.days, anyDay: activePrepPlan?.anyDay })
        : 'This recipe is not scheduled on the prep board yet.';

    useEffect(() => {
        if (!Array.isArray(recipeQueue) || recipeQueue.length === 0) {
            if (selectedQueueEntryId) setSelectedQueueEntryId(null);
            return;
        }

        const found = recipeQueue.some((entry) => entry?.id === selectedQueueEntryId);
        if (!found) {
            const preferred = recipeQueue.find((entry) => [
                OFFLINE_STATE.LOCAL,
                OFFLINE_STATE.PENDING,
                OFFLINE_STATE.APPROVAL_REQUIRED,
                OFFLINE_STATE.FAILED,
                OFFLINE_STATE.CONFLICT,
                OFFLINE_STATE.BLOCKED
            ].includes(entry?.status)) || recipeQueue[0];
            setSelectedQueueEntryId(preferred?.id || null);
        }
    }, [recipeQueue, selectedQueueEntryId]);

    const nextActionSummary = useMemo(() => (
        portionMode
            ? NEXT_ACTION_MESSAGES.TEST_MODE
            : NEXT_ACTION_MESSAGES.PRODUCTION_MODE(activeRecipe?.name)
    ), [activeRecipe, portionMode]);

    const activateWorkflowView = (nextView) => {
        if (!roleWorkspaceConfig.allowedViews.includes(nextView)) {
            setView(roleWorkspaceConfig.defaultView);
            moveWorkflowFocus(roleWorkspaceConfig.defaultView);
            return;
        }
        setView(nextView);
        moveWorkflowFocus(nextView);
    };

    const productionScaleMap = useMemo(() => {
        if (!Array.isArray(visibleRecipes) || visibleRecipes.length === 0) return {};

        return visibleRecipes.reduce((acc, recipe, index) => {
            if (!recipe) return acc;
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const targetYield = Number(dailyProduction?.[recipeKey] || 0);
            const standardBatchYield = Number(recipeOperationalIndex.byKey?.[recipeKey]?.standardBatchYield || 0);
            if (!(targetYield > 0) || !(standardBatchYield > 0)) return acc;
            acc[recipeKey] = Number((targetYield / standardBatchYield).toFixed(4));
            return acc;
        }, {});
    }, [visibleRecipes, dailyProduction, recipeOperationalIndex]);

    const productionBOM = useMemo(() => {
        if (!visibleRecipes?.length || !activeRecipeKey) return null;
        return calculateBOM(
            visibleRecipes,
            productionScaleMap,
            portionsPerBatch,
            prepPortionSettings
        );
    }, [visibleRecipes, productionScaleMap, activeRecipeKey, portionsPerBatch, prepPortionSettings]);

    const activeBomNode = useMemo(
        () => getBomNodeForRecipe(productionBOM?.nodes || {}, activeRecipe, activeRecipeKey),
        [productionBOM, activeRecipe, activeRecipeKey]
    );

    const activeBomInsight = useMemo(() => {
        if (!activeRecipe || !activeRecipeKey || currentYieldValue <= 0) return null;
        const baseYield = Number(activeRecipe?.baseYield) || 0;
        if (baseYield <= 0) return null;
        const result = productionBOM;
        if (!result) return null;
        const rootAliases = new Set([
            activeRecipeKey,
            activeRecipe?.id,
            activeRecipe?.recipe_id,
            activeRecipe?.recipe_ref_id,
            activeRecipe?.canonical_id,
            activeRecipe?.clean_name
        ].filter(Boolean).map(String));
        const componentNodes = Object.entries(result.nodes || {})
            .filter(([nodeId, node]) => !rootAliases.has(String(nodeId)) && (node?.demandWeight || 0) > 0);

        return {
            componentCount: componentNodes.length,
            shortageCount: componentNodes.filter(([, node]) => (node?.shortageWeight || 0) > 0).length,
            demandWeight: Number(componentNodes.reduce((sum, [, node]) => sum + (Number(node?.demandWeight) || 0), 0).toFixed(2)),
            rootWeight: activeBomNode?.weight || 0
        };
    }, [
        activeRecipe,
        activeRecipeKey,
        activeBomNode,
        currentYieldValue,
        productionBOM,
        portionsPerBatch,
        prepPortionSettings
    ]);

    const costWorkspace = useMemo(() => buildRecipeCostWorkspace({
        recipe: activeRecipe,
        invoicePackets: INVOICE_INGEST_PREVIEW_HISTORY,
        portionCount: currentPortionCount,
        manualIncome: Number(activeCostIncomeDraft || 0)
    }), [activeRecipe, currentPortionCount, activeCostIncomeDraft]);
    const activeInvoiceLibraryGroups = useMemo(() => {
        if (costLibraryGrouping === COST_LIBRARY_GROUPINGS.DAY) return costWorkspace.invoiceLibrary?.byDay || [];
        if (costLibraryGrouping === COST_LIBRARY_GROUPINGS.WEEK) return costWorkspace.invoiceLibrary?.byWeek || [];
        return costWorkspace.invoiceLibrary?.byDish || [];
    }, [costWorkspace, costLibraryGrouping]);

    const productionPlan = useMemo(() => {
        const basePlan = generateProductionTasks({
            recipes: visibleRecipes,
            dailyProduction,
            prepPlans,
            taskOverrides: prepTaskOverrides,
            portionsPerBatch,
            productionInputs: {
                nodes: productionBOM?.nodes || null,
                demand: productionBOM?.demand || null
            }
        });

        const recipeByAlias = new Map();
        (Array.isArray(visibleRecipes) ? visibleRecipes : []).forEach((recipe, index) => {
            if (!recipe || typeof recipe !== 'object') return;
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            [
                recipeKey,
                recipe?.id,
                recipe?.recipe_id,
                recipe?.recipe_ref_id,
                recipe?.canonical_id,
                recipe?.clean_name,
                recipe?.name
            ].map((value) => normalizeKey(value)).filter(Boolean).forEach((alias) => {
                if (!recipeByAlias.has(alias)) {
                    recipeByAlias.set(alias, recipe);
                }
            });
        });

        const attachWorkflow2Profile = (task = {}) => {
            const matchedRecipe = [
                task?.recipeKey,
                task?.id,
                task?.name
            ].map((value) => normalizeKey(value)).filter(Boolean).map((alias) => recipeByAlias.get(alias)).find(Boolean) || null;

            if (!matchedRecipe) return task;
            const prepProfile = matchedRecipe?.workflow2PrepProfile || matchedRecipe?.prepProfile || null;
            return {
                ...task,
                recipe: matchedRecipe,
                workflow2PrepProfile: prepProfile,
                prepProfile
            };
        };

        const enrichedTasks = Array.isArray(basePlan?.tasks)
            ? basePlan.tasks.map((task) => attachWorkflow2Profile(task))
            : [];
        const enrichedTaskById = new Map(
            enrichedTasks.map((task) => [String(task?.id || ''), task])
        );
        const enrichedGrouped = Object.fromEntries(
            Object.entries(basePlan?.grouped || {}).map(([station, tasks]) => [
                station,
                (Array.isArray(tasks) ? tasks : []).map((task) => enrichedTaskById.get(String(task?.id || '')) || attachWorkflow2Profile(task))
            ])
        );

        return {
            ...basePlan,
            tasks: enrichedTasks,
            grouped: enrichedGrouped
        };
    }, [visibleRecipes, dailyProduction, prepPlans, prepTaskOverrides, portionsPerBatch, productionBOM]);
    const productionBoardPressure = useMemo(() => {
        const groupedStations = productionPlan?.grouped || {};
        const stationCount = Object.keys(groupedStations).length;
        const taskEntries = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        const totalTasks = Number(productionPlan?.totalTasks || 0);
        const dependencyCount = Number(productionPlan?.dependencyCount || 0);
        const truthReviewCount = taskEntries.filter((task) => Number(task?.truthPriority || 0) === 1).length;
        const truthBlockedCount = taskEntries.filter((task) => Number(task?.truthPriority || 0) >= 2).length;
        const changedTaskCount = taskEntries.filter((task) => Boolean(task?.hasChefOverride)).length;
        const changedDependencyTaskCount = taskEntries.filter((task) => Boolean(task?.hasChangedDependency) && !Boolean(task?.hasChefOverride)).length;
        const waitingApprovalCount = taskEntries.filter((task) => String(task?.taskState || '').trim() === 'waiting approval').length;
        const readyAfterDependencyCount = taskEntries.filter((task) => String(task?.taskState || '').trim() === 'ready after dependency').length;
        const overdueRiskCount = taskEntries.filter((task) => Boolean(task?.isOverdueRisk)).length;
        const pressureScore = Math.max(
            0,
            Math.min(
                100,
                100
                - (dependencyCount * 4)
                - (truthReviewCount * 6)
                - (truthBlockedCount * 12)
                - (waitingApprovalCount * 8)
                - (changedTaskCount * 3)
                - (changedDependencyTaskCount * 4)
                - (overdueRiskCount * 6)
            )
        );
        const hasBOMSignal = Boolean(activeBomInsight);
        const bomShortageCount = Number(activeBomInsight?.shortageCount || 0);

        return {
            stationCount,
            totalTasks,
            dependencyCount,
            truthReviewCount,
            truthBlockedCount,
            changedTaskCount,
            changedDependencyTaskCount,
            waitingApprovalCount,
            readyAfterDependencyCount,
            overdueRiskCount,
            pressureScore,
            hasBOMSignal,
            bomShortageCount
        };
    }, [activeBomInsight, productionPlan]);
    const scopedPrepTasks = useMemo(() => {
        const defaultWeekday = getKitchenWeekdayIndex(new Date());
        const tasks = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        if (!tasks.length) return [];

        const selectedWeekday = prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
            && Number.isInteger(prepScheduleDayFilter)
            ? prepScheduleDayFilter
            : null;

        const sortedTasks = [...tasks].sort(compareCommandTaskReadiness);
        const readyTasks = sortedTasks.filter((task) => !isDependencyBlocked(task));
        const blockedTasks = sortedTasks.filter((task) => isDependencyBlocked(task));
        const orderedTasks = [...readyTasks, ...blockedTasks];

        const scopedBySchedule = orderedTasks.filter((task) => {
            const scope = getTaskScheduleScope({
                task,
                prepPlans,
                view: prepScheduleView,
                selectedWeekday,
                defaultWeekday
            });
            return scope.matchesView;
        });

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH) {
            return [...scopedBySchedule].sort((left, right) => (
                Number(left?.schedulePhasePriority || 0) - Number(right?.schedulePhasePriority || 0)
                || Number(right?.isOverdueRisk || 0) - Number(left?.isOverdueRisk || 0)
                || Number(right?.targetYield || 0) - Number(left?.targetYield || 0)
                || compareCommandTaskReadiness(left, right)
            ));
        }

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.WEEK) {
            return [...scopedBySchedule].sort((left, right) => (
                Number(left?.schedulePhasePriority || 0) - Number(right?.schedulePhasePriority || 0)
                || Number(right?.hasChangedDependency || 0) - Number(left?.hasChangedDependency || 0)
                || Number(right?.isOverdueRisk || 0) - Number(left?.isOverdueRisk || 0)
                || compareCommandTaskReadiness(left, right)
            ));
        }

        return scopedBySchedule;
    }, [prepScheduleDayFilter, prepScheduleView, prepPlans, productionPlan]);
    const todayPrepTasks = useMemo(() => {
        const defaultWeekday = getKitchenWeekdayIndex(new Date());
        const tasks = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        if (!tasks.length) return [];

        const sortedTasks = [...tasks].sort(compareCommandTaskReadiness);
        const readyTasks = sortedTasks.filter((task) => !isDependencyBlocked(task));
        const blockedTasks = sortedTasks.filter((task) => isDependencyBlocked(task));
        const orderedTasks = [...readyTasks, ...blockedTasks];

        const todayTasks = orderedTasks.filter((task) => {
            const scope = getTaskScheduleScope({
                task,
                prepPlans,
                view: PREP_SCHEDULE_VIEWS.TODAY,
                selectedWeekday: defaultWeekday,
                defaultWeekday
            });
            return scope.matchesView;
        });

        return todayTasks;
    }, [prepPlans, productionPlan]);
    const activePrepTasks = useMemo(() => (
        prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY ? todayPrepTasks : scopedPrepTasks
    ), [prepScheduleView, scopedPrepTasks, todayPrepTasks]);
    const scopedPrepPressure = useMemo(() => {
        const tasks = Array.isArray(scopedPrepTasks) ? scopedPrepTasks : [];
        if (!tasks.length) {
            return {
                totalTasks: 0,
                truthBlockedCount: 0,
                truthReviewCount: 0,
                waitingApprovalCount: 0,
                dependencyBlockedCount: 0,
                overdueRiskCount: 0,
                changedTaskCount: 0,
                changedDependencyCount: 0,
                readyCount: 0,
                attentionTaskCount: 0,
                confidenceScore: 100,
                summaryParts: []
            };
        }

        const counts = tasks.reduce((acc, task) => {
            const taskState = String(task?.taskState || '').trim();
            const isTruthBlocked = taskState === 'truth blocked' || Boolean(task?.isTruthBlocked);
            const isTruthReview = !isTruthBlocked && (taskState === 'truth review' || Number(task?.truthPriority || 0) === 1);
            const isWaitingApproval = taskState === 'waiting approval';
            const isDependencyOnlyBlocked = isDependencyBlocked(task) && !isTruthBlocked && !isWaitingApproval;
            const isOverdueRisk = Boolean(task?.isOverdueRisk);
            const hasChefOverride = Boolean(task?.hasChefOverride);
            const hasChangedDependency = Boolean(task?.hasChangedDependency);

            if (isTruthBlocked) acc.truthBlockedCount += 1;
            if (isTruthReview) acc.truthReviewCount += 1;
            if (isWaitingApproval) acc.waitingApprovalCount += 1;
            if (isDependencyOnlyBlocked) acc.dependencyBlockedCount += 1;
            if (isOverdueRisk) acc.overdueRiskCount += 1;
            if (hasChefOverride) acc.changedTaskCount += 1;
            if (hasChangedDependency) acc.changedDependencyCount += 1;

            if (!isDependencyOnlyBlocked && !isTruthBlocked && !isWaitingApproval) {
                acc.readyCount += 1;
            }

            if (isTruthBlocked || isTruthReview || isWaitingApproval || isDependencyOnlyBlocked || isOverdueRisk || hasChefOverride || hasChangedDependency) {
                acc.attentionTaskCount += 1;
            }

            return acc;
        }, {
            truthBlockedCount: 0,
            truthReviewCount: 0,
            waitingApprovalCount: 0,
            dependencyBlockedCount: 0,
            overdueRiskCount: 0,
            changedTaskCount: 0,
            changedDependencyCount: 0,
            readyCount: 0,
            attentionTaskCount: 0
        });

        const totalTasks = tasks.length;
        const weightedHealthyTasks = Math.max(
            0,
            totalTasks
            - counts.truthBlockedCount
            - counts.waitingApprovalCount
            - counts.dependencyBlockedCount
            - Math.ceil(counts.truthReviewCount * 0.75)
            - Math.ceil(counts.overdueRiskCount * 0.5)
            - Math.ceil(counts.changedDependencyCount * 0.35)
        );
        const confidenceScore = totalTasks > 0
            ? Math.max(0, Math.min(100, Math.round((weightedHealthyTasks / totalTasks) * 100)))
            : 100;

        return {
            totalTasks,
            ...counts,
            confidenceScore,
            summaryParts: buildPrepPressureSummaryParts(counts)
        };
    }, [scopedPrepTasks]);
    const productionCommandLanes = useMemo(() => {
        const tasks = Array.isArray(scopedPrepTasks) ? scopedPrepTasks : [];
        if (!tasks.length) return [];

        const orderedTasks = prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
            ? buildPrepScheduleLane(tasks)
            : tasks;

        return orderedTasks.slice(0, COMMAND_PRIORITY_LABELS.length).map((task, index) => {
            const station = String(task?.station || 'General Prep');
            const targetQty = formatPrepTaskQuantity(task?.targetYield, task?.unit || '');
            const stateChip = getPrepStateChip(task);
            const prepAheadChip = getTaskPrepAheadChip(task);
            const isOverdueRisk = Boolean(task?.isOverdueRisk);
            const pressureToken = Number(task?.missingDependencyCount || 0) > 0
                ? `${Number(task.missingDependencyCount || 0)} unresolved`
                : (Number(task?.blockedDependencyCount || 0) > 0
                    ? `${Number(task.blockedDependencyCount || 0)} blocked`
                    : (Number(task?.shortagePriority || 0) > 0 ? `${Number(task?.shortagePriority || 0).toFixed(0)}g shortage` : null));
            const compactMeta = [
                station === 'General Prep' ? null : station,
                targetQty ? `Qty ${targetQty}` : null,
                Number(task?.prepTimeMinutes || 0) > 0 ? `${Number(task.prepTimeMinutes)} min` : null,
                stateChip && stateChip !== 'ready' ? stateChip : null,
                prepAheadChip || null,
                task?.hasChefOverride ? 'chef adjusted' : null,
                task?.hasChangedDependency ? 'upstream changed' : null,
                isOverdueRisk ? 'escalate' : null
            ].filter(Boolean);
            const dependencySummary = [
                ...compactMeta.slice(0, pressureToken ? 3 : 4),
                pressureToken
            ].filter(Boolean);
            const reason = getPrimaryPrepReason(task, { maxChars: 118, preferEscalation: isOverdueRisk });
            const detailMeta = dependencySummary.join(' / ');
            const detail = [detailMeta, reason].filter(Boolean).join(' - ');

            return {
                taskId: String(task?.id || ''),
                label: prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
                    ? (task?.scheduleSlotLabel || COMMAND_PRIORITY_LABELS[index] || `Step ${index + 1}`)
                    : (COMMAND_PRIORITY_LABELS[index] || `Step ${index + 1}`),
                time: prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
                    ? (task?.scheduleSlotTime || getPrepWindowLabel(task, index))
                    : getPrepWindowLabel(task, index),
                title: formatPrepDisplayName(task?.name || 'Unnamed task'),
                detail,
                notes: buildPrepTaskIntelligenceNotes(task),
                isPrimary: index === 0,
                recipeKey: String(task?.recipeKey || ''),
                recipeName: String(task?.name || ''),
            };
        });
    }, [prepScheduleView, scopedPrepTasks]);
    const todayWorkflowSummary = useMemo(() => {
        const tasks = Array.isArray(todayPrepTasks) ? todayPrepTasks : [];
        if (!tasks.length) {
            return {
                counts: { morning: 0, afternoon: 0, beforeService: 0 },
                startTask: null,
                thenTask: null,
                holdTask: null,
                prepAheadCount: 0
            };
        }
        return buildTodayWorkflowSummary(tasks);
    }, [todayPrepTasks]);
    const productionCategoryLanes = useMemo(
        () => buildPrepTaskCategoryLanes(scopedPrepTasks),
        [scopedPrepTasks]
    );
    const effectivePrepFocusMode = prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
        ? prepFocusMode
        : PREP_FOCUS_MODES.BOARD;
    const focusedPrepTasks = useMemo(() => {
        if (effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD) return [];
        return buildPrepTaskFocusList(scopedPrepTasks, {
            mode: effectivePrepFocusMode,
            dayPartKey: prepFocusDayPart,
            pickedTaskIds: pickedPrepTaskIds
        });
    }, [effectivePrepFocusMode, pickedPrepTaskIds, prepFocusDayPart, scopedPrepTasks]);
    const prepFocusSummary = useMemo(() => {
        if (effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD) {
            return {
                title: 'Full board',
                copy: 'Today keeps the whole prep board visible.',
                emptyTitle: 'No full-board filter active.',
                emptyDetail: 'Switch to a focused mode when the chef wants a smaller working lane.'
            };
        }

        if (effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART) {
            const nextDayPart = PREP_DAY_PART_SEQUENCE.find((part) => part.key === prepFocusDayPart);
            return {
                title: nextDayPart ? `${nextDayPart.label} tasks` : 'Day-part tasks',
                copy: 'Show only the prep window the cook should work in now.',
                emptyTitle: 'No tasks are active in this prep window.',
                emptyDetail: 'Try another day part or return to My next tasks.'
            };
        }

        if (effectivePrepFocusMode === PREP_FOCUS_MODES.PICKED) {
            return {
                title: 'Picked task list',
                copy: 'A short hand-picked list for focused execution.',
                emptyTitle: 'No tasks are in the picked list yet.',
                emptyDetail: 'Open a prep task in Chef Focus, then add it to the picked list.'
            };
        }

        return {
            title: 'My next tasks',
            copy: 'Show the first few tasks in execution order, not the whole kitchen at once.',
            emptyTitle: 'No immediate prep tasks are available.',
            emptyDetail: 'Return to the full board or check Week and Month planning views.'
        };
    }, [effectivePrepFocusMode, prepFocusDayPart]);
    const visibleProductionCategoryLanes = useMemo(() => {
        if (effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD) return productionCategoryLanes;
        if (!focusedPrepTasks.length) return [];

        const blockedCount = focusedPrepTasks.filter((task) => isDependencyBlocked(task)).length;
        const truthCount = focusedPrepTasks.filter((task) => Boolean(task?.isTruthBlocked) || Number(task?.truthPriority || 0) > 0).length;
        const overdueCount = focusedPrepTasks.filter((task) => Boolean(task?.isOverdueRisk)).length;
        const changedCount = focusedPrepTasks.filter((task) => Boolean(task?.hasChefOverride) || Boolean(task?.hasChangedDependency)).length;
        const loadParts = [`${focusedPrepTasks.length} visible`];
        if (blockedCount > 0) loadParts.push(`${blockedCount} blocked`);
        if (truthCount > 0) loadParts.push(`${truthCount} truth`);
        if (overdueCount > 0) loadParts.push(`${overdueCount} overdue`);
        if (changedCount > 0) loadParts.push(`${changedCount} changed`);

        return [{
            category: prepFocusSummary.title,
            loadLabel: loadParts.join(' / '),
            tasks: focusedPrepTasks
        }];
    }, [effectivePrepFocusMode, focusedPrepTasks, prepFocusSummary.title, productionCategoryLanes]);
    const commandLaneTaskIds = useMemo(
        () => new Set(
            (Array.isArray(productionCommandLanes) ? productionCommandLanes : [])
                .map((command) => String(command?.taskId || '').trim())
                .filter(Boolean)
        ),
        [productionCommandLanes]
    );
    const displayProductionCategoryLanes = useMemo(() => {
        const lanes = Array.isArray(visibleProductionCategoryLanes) ? visibleProductionCategoryLanes : [];
        if (!lanes.length || !commandLaneTaskIds.size) return lanes;

        return lanes.reduce((acc, lane) => {
            const filteredTasks = (Array.isArray(lane?.tasks) ? lane.tasks : []).filter((task) => !commandLaneTaskIds.has(String(task?.id || '').trim()));
            if (!filteredTasks.length) return acc;

            const blockedCount = filteredTasks.filter((task) => Boolean(task?.isDependencyBlocked) || String(task?.taskState || '').trim() === 'waiting approval').length;
            const truthCount = filteredTasks.filter((task) => Boolean(task?.isTruthBlocked) || Number(task?.truthPriority || 0) > 0).length;
            const overdueCount = filteredTasks.filter((task) => Boolean(task?.isOverdueRisk)).length;
            const changedCount = filteredTasks.filter((task) => Boolean(task?.hasChefOverride) || Boolean(task?.hasChangedDependency)).length;
            const loadParts = [`${filteredTasks.length} remaining`];
            if (blockedCount > 0) loadParts.push(`${blockedCount} blocked`);
            if (truthCount > 0) loadParts.push(`${truthCount} truth`);
            if (overdueCount > 0) loadParts.push(`${overdueCount} overdue`);
            if (changedCount > 0) loadParts.push(`${changedCount} changed`);

            acc.push({
                ...lane,
                tasks: filteredTasks,
                blockedCount,
                truthCount,
                overdueCount,
                changedCount,
                loadLabel: loadParts.join(' / ')
            });
            return acc;
        }, []);
    }, [commandLaneTaskIds, visibleProductionCategoryLanes]);
    const selectedPrepTasks = useMemo(() => (
        (Array.isArray(activePrepTasks) ? activePrepTasks : [])
            .filter((task) => pickedPrepTaskIds.includes(String(task?.id || '').trim()))
            .sort(compareCommandTaskReadiness)
    ), [activePrepTasks, pickedPrepTaskIds]);

    const selectedPrepTaskCount = selectedPrepTasks.length;
    const selectedPrepActionCount = selectedPrepTasks.reduce((sum, task) => sum + getPrepTaskActionCount(task), 0);
    const totalPrepActionCount = (Array.isArray(activePrepTasks) ? activePrepTasks : []).reduce((sum, task) => sum + getPrepTaskActionCount(task), 0);
    const selectedPrepTaskMinutes = selectedPrepTasks.reduce((sum, task) => sum + Number(task?.prepTimeMinutes || 0), 0);
    const selectedPrepTaskLabel = `${selectedPrepActionCount}/${totalPrepActionCount}`;
    const hasActivePrepTasks = Array.isArray(activePrepTasks) && activePrepTasks.length > 0;
    const hasCommandPrepTasks = Array.isArray(productionCommandLanes) && productionCommandLanes.length > 0;
    const hasSavedPrepSchedule = Object.keys(prepPlans || {}).length > 0;
    const showPrepBoardEmptyState = !hasActivePrepTasks && !hasCommandPrepTasks && !hasSavedPrepSchedule;
    const showSavedPlanBoardFallback = !hasActivePrepTasks && !hasCommandPrepTasks && hasSavedPrepSchedule;
    const collapsePrepBoardLayout = showPrepBoardEmptyState;
    const firstPrepCommand = productionCommandLanes?.[0] || null;
    const upNextPrepCommands = Array.isArray(productionCommandLanes)
        ? productionCommandLanes.slice(1, 4)
        : [];
    const buildPrepIngredientRowsForRecipe = (recipe = {}) => (
        getRecipeIngredients(recipe).map((ingredient, index) => ({
            key: String(ingredient?._ingredientKey || ingredient?.id || `${ingredient?.name || 'ingredient'}-${index}`),
            name: String(ingredient?.name || 'Ingredient').trim(),
            quantity: String(ingredient?.qty ?? ingredient?.quantity ?? ''),
            unit: String(ingredient?.unit || '').trim(),
            category: String(ingredient?.category || ingredient?.ingredient_category || ingredient?.group || 'General').trim()
        }))
    );
    const savedPrepScheduleRows = useMemo(() => {
        return Object.values(prepPlans || {}).reduce((rows, plan, index) => {
            const plannedSelection = resolveVisibleRecipeSelection({
                recipeKey: plan?.recipeKey,
                recipeName: plan?.recipeName
            });
            if (!plannedSelection?.recipe || !plannedSelection?.recipeKey) return rows;

            const recipe = plannedSelection.recipe;
            const recipeKey = plannedSelection.recipeKey;
            const plannedQuantity = Number(plan?.quantity || dailyProduction?.[recipeKey] || recipe?.baseYield || recipe?.yield || 0);
            const unit = String(recipe?.unit || '').trim();
            const station = String(recipe?.station || recipe?.dishStyle || recipe?.style || 'General Prep');
            const quantityLabel = plannedQuantity > 0
                ? formatPrepTaskQuantity(plannedQuantity, unit) || `${Number(plannedQuantity.toFixed(2))}${unit ? ` ${unit}` : ''}`
                : 'No target';
            const modeLabel = String(plan?.mode || 'prepThisWeek') === 'rotatePrep'
                ? `Rotate prep / ${Number(plan?.rotateCount || 1)}x per ${plan?.rotateMode || 'week'}`
                : `Prep this week / ${formatPrepPlanDaySummary({ days: plan?.days, anyDay: plan?.anyDay })}`;

            rows.push({
                title: recipe?.name || recipe?.title || `Recipe ${index + 1}`,
                meta: compactPrepCopy(`${station} / ${modeLabel}`, 74),
                count: quantityLabel,
                recipeKey,
                detail: `${modeLabel} / ${quantityLabel}`,
                badge: String(plan?.mode || 'prepThisWeek') === 'rotatePrep' ? 'Rotate prep' : 'Prep this week',
                planMode: String(plan?.mode || 'prepThisWeek'),
                quantityLabel,
                plan,
                recipe,
                sourceType: 'saved_plan'
            });
            return rows;
        }, []);
    }, [dailyProduction, prepPlans, visibleRecipes]);
    const buildSavedPrepPlanTask = (row = {}) => {
        const recipe = row?.recipe || {};
        const prepProfile = recipe?.workflow2PrepProfile || recipe?.prepProfile || null;
        const prepIntelligence = prepProfile?.prepIntelligence
            || prepProfile?.prep_intelligence
            || recipe?.prepIntelligence
            || recipe?.prep_intelligence
            || {};
        const prepLeadTime = String(
            prepIntelligence?.leadTime
            || prepIntelligence?.lead_time
            || prepProfile?.prepIntelligence?.leadTime
            || prepProfile?.prep_intelligence?.lead_time
            || ''
        ).trim();
        const normalizedLeadTime = normalizeText(prepLeadTime);
        const schedulePhasePriority = (
            normalizedLeadTime.includes('morning')
            || normalizedLeadTime.includes('day before')
            || normalizedLeadTime.includes('previous day')
            || !normalizedLeadTime
        )
            ? 0
            : (normalizedLeadTime.includes('afternoon') ? 1 : 2);

        const estimatedPortions = Number(recipe?.baseYield || 0) > 0 && Number(row?.plan?.quantity || 0) > 0
            ? Math.max(1, Math.round(Number(row?.plan?.quantity || 0) / Number(recipe?.baseYield || 1)))
            : 0;
        const methodVariant = String(
            prepProfile?.scaleRule?.active_profile
            || prepProfile?.scale_rule?.active_profile
            || ''
        ).trim().toLowerCase() === 'large' ? 'batch' : 'normal';

        const draftTask = {
            workflow2PrepProfile: prepProfile,
            prepProfile,
            estimatedPortions,
            methodVariant
        };
        const workflow2TaskRows = getWorkflow2ExecutionTaskRows(draftTask);
        const previewExecutionSteps = workflow2TaskRows.map((taskRow) => String(taskRow?.taskName || '').trim()).filter(Boolean);
        const previewLeadReason = String(previewExecutionSteps[0] || '').trim()
            || 'Workflow 2 prep preview is ready for this recipe.';
        const derivedLeadTime = workflow2TaskRows.find((taskRow) => getExplicitPrepRowDayPartKey(taskRow) === 'morning')
            ? 'Morning prep'
            : (workflow2TaskRows.find((taskRow) => getExplicitPrepRowDayPartKey(taskRow) === 'afternoon')
                ? 'Afternoon prep'
                : (workflow2TaskRows.find((taskRow) => getExplicitPrepRowDayPartKey(taskRow) === 'before_service')
                    ? 'Before service'
                    : ''));
        const resolvedPrepLeadTime = prepLeadTime || derivedLeadTime;
        const normalizedResolvedLeadTime = normalizeText(resolvedPrepLeadTime);
        const resolvedSchedulePhasePriority = (
            normalizedResolvedLeadTime.includes('morning')
            || normalizedResolvedLeadTime.includes('day before')
            || normalizedResolvedLeadTime.includes('previous day')
            || !normalizedResolvedLeadTime
        )
            ? 0
            : (normalizedResolvedLeadTime.includes('afternoon') ? 1 : 2);

        return {
            id: `saved-plan-${String(row?.recipeKey || row?.title || '').trim()}`,
            recipeKey: String(row?.recipeKey || '').trim(),
            name: row?.title || recipe?.name || recipe?.title || 'Saved recipe',
            unit: recipe?.unit || '',
            targetYield: Number(row?.plan?.quantity || 0),
            estimatedPortions,
            station: recipe?.station || recipe?.dishStyle || recipe?.style || 'General Prep',
            station_group: recipe?.station_group || recipe?.station || '',
            dish_group: recipe?.dishCategory || recipe?.category || recipe?.dish_group || '',
            category: recipe?.dishCategory || recipe?.category || '',
            dishStyle: recipe?.dishStyle || recipe?.style || '',
            style: recipe?.style || recipe?.dishStyle || '',
            workflow2PrepProfile: prepProfile,
            prepProfile,
            execution_steps: previewExecutionSteps,
            critical_checks: Array.isArray(prepProfile?.foodSafetyCcp)
                ? prepProfile.foodSafetyCcp
                : (Array.isArray(prepProfile?.food_safety_ccp) ? prepProfile.food_safety_ccp : []),
            equipment: Array.isArray(prepProfile?.equipment)
                ? prepProfile.equipment
                : [],
            prepTimeMinutes: Number(
                prepIntelligence?.prepTimeMinutes
                || prepIntelligence?.prep_time_minutes
                || prepIntelligence?.prepTimeMinutesRegular
                || prepIntelligence?.prep_time_minutes_regular
                || 0
            ),
            prepStorageWindow: prepIntelligence?.storageWindow || prepIntelligence?.storage_window || '',
            prepHandoffNote: prepIntelligence?.handoffNote || prepIntelligence?.handoff_note || '',
            smart_data: {
                station: recipe?.station || recipe?.dishStyle || recipe?.style || ''
            },
            context_tags: {
                dish_style: recipe?.dishStyle || recipe?.style || '',
                cuisine: recipe?.cuisine || ''
            },
            prepIntelligence,
            prepLeadTime: resolvedPrepLeadTime,
            schedulePhasePriority: resolvedSchedulePhasePriority,
            methodVariant,
            urgent: Boolean(row?.plan?.urgent),
            taskState: Boolean(row?.plan?.urgent) ? 'changed' : 'ready now',
            reasons: [
                previewLeadReason,
                'Preview the Workflow 2 prep steps here until live execution tasks are generated.'
            ]
        };
    };
    const buildPrepBoardColumns = (groupingMode = PREP_BOARD_GROUPINGS.STATION) => (
        PREP_DAY_PART_SEQUENCE.map((phase) => {
            const taskList = (Array.isArray(activePrepTasks) ? activePrepTasks : [])
                .filter((task) => getPrepDayPartKey(task) === phase.key)
                .filter((task) => {
                    if (groupingMode !== PREP_BOARD_GROUPINGS.URGENT) return true;
                    if (phase.key !== 'before_service') return false;
                    const taskState = String(task?.taskState || '').trim();
                    return isDependencyBlocked(task)
                        || ['waiting approval', 'truth blocked', 'blocked', 'ready after dependency', 'truth review', 'changed'].includes(taskState)
                        || !Boolean(buildPrepTaskSessionDetail({
                            task,
                            sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                            fallbackOwner: prepOperatorLabel
                        })?.isCompleted);
                });
            const grouped = taskList.reduce((acc, task) => {
                const category = groupingMode === PREP_BOARD_GROUPINGS.TASK
                    ? getPrepTaskCategoryGroup(task, phase.key)
                    : getPrepTaskStationViewGroup(task, phase.key);
                if (!acc[category]) {
                    acc[category] = {
                        category,
                        loadLabel: '',
                        tasks: []
                    };
                }
                acc[category].tasks.push(task);
                return acc;
            }, {});

            const order = getPrepGroupingOrder(groupingMode, phase.key);

            const lanes = Object.values(grouped)
                .map((lane) => {
                    const tasks = lane.tasks.slice().sort((left, right) => (
                        String(formatPrepDisplayName(left?.name || '')).localeCompare(String(formatPrepDisplayName(right?.name || '')))
                        || compareCommandTaskReadiness(left, right)
                    ));
                    const totalActionCount = tasks.reduce((sum, task) => sum + getPrepTaskActionCount(task), 0);
                    const takenActionCount = tasks.reduce((sum, task) => sum + getPrepTaskTakenActionCount(task, pickedPrepTaskIds), 0);
                    const blockedCount = tasks.filter((task) => isDependencyBlocked(task)).length;
                    const truthCount = tasks.filter((task) => Boolean(task?.isTruthBlocked) || Number(task?.truthPriority || 0) > 0).length;
                    const overdueCount = tasks.filter((task) => Boolean(task?.isOverdueRisk) || normalizeText(task?.urgency_level) === 'high').length;
                    const selectedCount = tasks.filter((task) => pickedPrepTaskIds.includes(String(task?.id || '').trim())).length;
                    const completedCount = tasks.filter((task) => Boolean(prepExecutionSessions?.[task?.recipeKey]?.taskProgress?.[task?.id]?.completedAt)).length;
                    const loadParts = [`${takenActionCount}/${totalActionCount} taken`];
                    if (selectedCount > 0) loadParts.push(`${selectedCount} selected`);
                    if (completedCount > 0) loadParts.push(`${completedCount} done`);
                    if (blockedCount > 0) loadParts.push(`${blockedCount} blocked`);
                    if (truthCount > 0) loadParts.push(`${truthCount} truth`);
                    if (overdueCount > 0) loadParts.push(`${overdueCount} urgent`);

                    return {
                        ...lane,
                        totalActionCount,
                        takenActionCount,
                        loadLabel: loadParts.join(' / '),
                        tasks
                    };
                })
                .sort((left, right) => {
                    const leftOrder = order.indexOf(left.category);
                    const rightOrder = order.indexOf(right.category);
                    const normalizedLeft = leftOrder === -1 ? 99 : leftOrder;
                    const normalizedRight = rightOrder === -1 ? 99 : rightOrder;
                    return normalizedLeft - normalizedRight
                        || String(left.category || '').localeCompare(String(right.category || ''));
                });

            return {
                phaseKey: phase.key,
                label: phase.label,
                lanes,
                totalTasks: taskList.length,
                totalActionCount: taskList.reduce((sum, task) => sum + getPrepTaskActionCount(task), 0),
                takenActionCount: taskList.reduce((sum, task) => sum + getPrepTaskTakenActionCount(task, pickedPrepTaskIds), 0)
            };
        })
    );
    const buildSavedPrepBoardColumns = (groupingMode = PREP_BOARD_GROUPINGS.STATION) => (
        PREP_DAY_PART_SEQUENCE.map((phase) => {
            const plannedRows = savedPrepScheduleRows
                .flatMap((row) => {
                    const task = buildSavedPrepPlanTask(row);
                    const ingredientRows = buildPrepIngredientRowsForRecipe(row?.recipe || {});
                    const detailRows = getDisplayPrepTaskRows(task, ingredientRows);
                    const phaseBuckets = detailRows.reduce((acc, detailRow) => {
                        const phaseKey = getExplicitPrepRowDayPartKey(detailRow);
                        if (!phaseKey) return acc;
                        if (!acc[phaseKey]) acc[phaseKey] = [];
                        acc[phaseKey].push(detailRow);
                        return acc;
                    }, {});

                    const explicitPhaseKeys = Object.keys(phaseBuckets);
                    if (explicitPhaseKeys.length === 0) {
                        const fallbackPhaseKey = getPrepDayPartKey(task);
                        return [{
                            ...row,
                            task,
                            phaseKey: fallbackPhaseKey,
                            filteredTaskRows: detailRows,
                            sortSequence: 999
                        }];
                    }

                    return explicitPhaseKeys.map((phaseKey) => {
                        const filteredTaskRows = (phaseBuckets[phaseKey] || [])
                            .slice()
                            .sort((left, right) => (
                                Number(left?.sequence || 999) - Number(right?.sequence || 999)
                                || String(left?.taskName || '').localeCompare(String(right?.taskName || ''))
                            ));
                        const sortSequence = filteredTaskRows.reduce((lowest, item) => (
                            Math.min(lowest, Number(item?.sequence || 999))
                        ), 999);
                        return {
                            ...row,
                            task,
                            phaseKey,
                            filteredTaskRows,
                            sortSequence
                        };
                    });
                })
                .filter((row) => row.phaseKey === phase.key)
                .filter((row) => {
                    if (groupingMode !== PREP_BOARD_GROUPINGS.URGENT) return true;
                    if (phase.key !== 'before_service') return false;
                    return Boolean(row?.plan?.urgent);
                })
                .flatMap((row) => {
                    if (groupingMode === PREP_BOARD_GROUPINGS.URGENT) {
                        return [{
                            ...row,
                            groupLabel: 'Urgent'
                        }];
                    }

                    const baseRows = Array.isArray(row?.filteredTaskRows) && row.filteredTaskRows.length > 0
                        ? row.filteredTaskRows
                        : [{}];
                    const groupedTaskRows = baseRows.reduce((acc, detailRow) => {
                        const groupLabel = getSavedPrepRowGroupingLabel({
                            task: row.task,
                            row: detailRow,
                            phaseKey: phase.key,
                            groupingMode
                        });
                        if (!acc[groupLabel]) acc[groupLabel] = [];
                        acc[groupLabel].push(detailRow);
                        return acc;
                    }, {});

                    return Object.entries(groupedTaskRows).flatMap(([groupLabel, groupedRows]) => {
                        const sortedRows = (groupedRows || [])
                            .slice()
                            .sort((left, right) => (
                                Number(left?.sequence || 999) - Number(right?.sequence || 999)
                                || String(left?.taskName || '').localeCompare(String(right?.taskName || ''))
                            ));

                        if (groupingMode === PREP_BOARD_GROUPINGS.TASK) {
                            return sortedRows.map((detailRow, detailRowIndex) => ({
                                ...row,
                                groupLabel,
                                filteredTaskRows: [detailRow],
                                primaryTaskName: String(detailRow?.taskName || '').trim(),
                                primaryTaskRowId: String(detailRow?.id || detailRowIndex).trim(),
                                sortSequence: Number(detailRow?.sequence || row?.sortSequence || 999)
                            }));
                        }

                        return [{
                            ...row,
                            groupLabel,
                            filteredTaskRows: sortedRows,
                            sortSequence: sortedRows.reduce((lowest, item) => (
                                Math.min(lowest, Number(item?.sequence || 999))
                            ), Number(row?.sortSequence || 999))
                        }];
                    });
                });

            const grouped = plannedRows.reduce((acc, row) => {
                const category = String(row?.groupLabel || '').trim() || 'General Prep';
                if (!acc[category]) {
                    acc[category] = {
                        category,
                        loadLabel: '',
                        rows: []
                    };
                }
                acc[category].rows.push(row);
                return acc;
            }, {});

            const order = getPrepGroupingOrder(groupingMode, phase.key);
            const lanes = Object.values(grouped)
                .map((lane) => {
                    const urgentCount = lane.rows.filter((row) => Boolean(row?.plan?.urgent)).length;
                    const loadParts = [`${lane.rows.length} planned`];
                    if (urgentCount > 0) loadParts.push(`${urgentCount} urgent`);
                    return {
                        ...lane,
                        loadLabel: loadParts.join(' / '),
                        rows: lane.rows.slice().sort((left, right) => (
                            Number(left?.sortSequence || 999) - Number(right?.sortSequence || 999)
                            || String(left?.title || '').localeCompare(String(right?.title || ''))
                        ))
                    };
                })
                .sort((left, right) => {
                    const leftOrder = order.indexOf(left.category);
                    const rightOrder = order.indexOf(right.category);
                    const normalizedLeft = leftOrder === -1 ? 99 : leftOrder;
                    const normalizedRight = rightOrder === -1 ? 99 : rightOrder;
                    return normalizedLeft - normalizedRight
                        || String(left.category || '').localeCompare(String(right.category || ''));
                });

            return {
                phaseKey: phase.key,
                label: phase.label,
                lanes,
                totalRows: plannedRows.length
            };
        })
    );

    const buildDayPartTaskModeRows = (lane = {}, phaseKey = '') => {
        const laneTasks = Array.isArray(lane?.tasks) ? lane.tasks : [];
        return laneTasks.flatMap((task) => {
            const ingredientRows = Array.isArray(prepJobIngredientDrafts?.[String(task?.id || '').trim()])
                ? prepJobIngredientDrafts[String(task?.id || '').trim()]
                : [];
            const taskRows = getDisplayPrepTaskRows(task, ingredientRows);
            return taskRows.map((row, rowIndex) => ({
                id: `${task?.id || 'task'}-${row.id || rowIndex}`,
                task,
                row: {
                    ...row,
                    category: getPrepTaskCategoryGroupForRow(task, row, phaseKey)
                },
                rowIndex
            }));
        });
    };
    const fullBoardTaskColumns = useMemo(
        () => buildPrepBoardColumns(PREP_BOARD_GROUPINGS.STATION),
        [activePrepTasks, pickedPrepTaskIds, prepExecutionSessions]
    );
    const savedPlanFullBoardColumns = useMemo(
        () => buildSavedPrepBoardColumns(PREP_BOARD_GROUPINGS.STATION),
        [savedPrepScheduleRows]
    );
    const filteredTodayTaskColumns = useMemo(
        () => buildPrepBoardColumns(prepBoardGrouping),
        [activePrepTasks, pickedPrepTaskIds, prepBoardGrouping, prepExecutionSessions]
    );
    const filteredSavedPrepBoardColumns = useMemo(
        () => buildSavedPrepBoardColumns(prepBoardGrouping),
        [prepBoardGrouping, savedPrepScheduleRows]
    );
    const selectedPhaseBoard = useMemo(
        () => filteredTodayTaskColumns.find((column) => column.phaseKey === prepBoardPhase) || null,
        [filteredTodayTaskColumns, prepBoardPhase]
    );
    const selectedSavedPhaseBoard = useMemo(
        () => filteredSavedPrepBoardColumns.find((column) => column.phaseKey === prepFocusDayPart) || null,
        [filteredSavedPrepBoardColumns, prepFocusDayPart]
    );
    const focusedDayPartBoard = useMemo(
        () => filteredTodayTaskColumns.find((column) => column.phaseKey === prepFocusDayPart) || null,
        [filteredTodayTaskColumns, prepFocusDayPart]
    );
    const focusedDayPartTaskModeLanes = useMemo(() => {
        if (!focusedDayPartBoard || prepBoardGrouping !== PREP_BOARD_GROUPINGS.TASK) return [];

        const taskItems = (Array.isArray(focusedDayPartBoard?.lanes) ? focusedDayPartBoard.lanes : [])
            .flatMap((lane) => buildDayPartTaskModeRows(lane, focusedDayPartBoard.phaseKey));

        if (!taskItems.length) return [];

        const grouped = taskItems.reduce((acc, item) => {
            const category = String(item?.row?.category || 'General Task').trim() || 'General Task';
            if (!acc[category]) {
                acc[category] = {
                    category,
                    items: []
                };
            }
            acc[category].items.push(item);
            return acc;
        }, {});

        const order = getPrepGroupingOrder(PREP_BOARD_GROUPINGS.TASK, focusedDayPartBoard.phaseKey);

        return Object.values(grouped)
            .map((lane) => {
                const takenCount = lane.items.filter((item) => {
                    const taskId = String(item?.task?.id || '').trim();
                    if (!taskId) return false;
                    const indexes = Array.isArray(item?.row?.sourceIndexes) && item.row.sourceIndexes.length > 0
                        ? item.row.sourceIndexes
                        : [item.rowIndex];
                    return indexes.every((stepIndex) => Boolean(prepTaskStepChecks?.[`${taskId}::${stepIndex}`]));
                }).length;
                const blockedCount = lane.items.filter((item) => isDependencyBlocked(item.task)).length;
                const truthCount = lane.items.filter((item) => Boolean(item?.task?.isTruthBlocked) || Number(item?.task?.truthPriority || 0) > 0).length;
                const urgentCount = lane.items.filter((item) => Boolean(item?.task?.isOverdueRisk) || normalizeText(item?.task?.urgency_level) === 'high').length;
                const loadParts = [`${takenCount}/${lane.items.length} taken`];
                if (blockedCount > 0) loadParts.push(`${blockedCount} blocked`);
                if (truthCount > 0) loadParts.push(`${truthCount} truth`);
                if (urgentCount > 0) loadParts.push(`${urgentCount} urgent`);
                return {
                    category: lane.category,
                    loadLabel: loadParts.join(' / '),
                    items: lane.items
                };
            })
            .sort((left, right) => {
                const leftOrder = order.indexOf(left.category);
                const rightOrder = order.indexOf(right.category);
                const normalizedLeft = leftOrder === -1 ? 99 : leftOrder;
                const normalizedRight = rightOrder === -1 ? 99 : rightOrder;
                return normalizedLeft - normalizedRight
                    || String(left.category || '').localeCompare(String(right.category || ''));
            });
    }, [focusedDayPartBoard, prepBoardGrouping, prepJobIngredientDrafts, prepTaskStepChecks]);
    const displayVisiblePrepEntries = useMemo(() => {
        if (effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART && prepBoardGrouping === PREP_BOARD_GROUPINGS.TASK && focusedDayPartTaskModeLanes.length > 0) {
            return focusedDayPartTaskModeLanes.flatMap((lane) => (
                Array.isArray(lane?.items)
                    ? lane.items.map((item) => ({
                        task: item.task,
                        entryKey: `${String(item?.task?.id || '').trim()}::${String(item?.row?.id || item?.rowIndex || 0).trim()}`,
                        selectedStep: String(item?.row?.taskName || '').trim(),
                        selectedStepKey: String(item?.row?.id || item?.rowIndex || 0).trim()
                    }))
                    : []
            )).filter((entry) => String(entry?.task?.id || '').trim());
        }

        const sourceColumns = selectedPhaseBoard ? [selectedPhaseBoard] : fullBoardTaskColumns;
        return sourceColumns.flatMap((column) => (
            Array.isArray(column?.lanes)
                ? column.lanes.flatMap((lane) => (
                    Array.isArray(lane?.tasks)
                        ? lane.tasks.map((task) => ({
                            task,
                            entryKey: String(task?.id || '').trim(),
                            selectedStep: '',
                            selectedStepKey: ''
                        }))
                        : []
                ))
                : []
        )).filter((entry) => String(entry?.task?.id || '').trim());
    }, [effectivePrepFocusMode, focusedDayPartTaskModeLanes, fullBoardTaskColumns, prepBoardGrouping, selectedPhaseBoard]);
    const displayVisiblePrepTaskIds = useMemo(() => (
        [...new Set(
            displayVisiblePrepEntries
                .map((entry) => String(entry?.task?.id || '').trim())
                .filter(Boolean)
        )]
    ), [displayVisiblePrepEntries]);
    const displayVisiblePrepTasks = useMemo(() => (
        displayVisiblePrepEntries.map((entry) => entry.task).filter(Boolean)
    ), [displayVisiblePrepEntries]);
    const displayVisibleUniquePrepTasks = useMemo(() => {
        const seen = new Set();
        return displayVisiblePrepEntries.reduce((acc, entry) => {
            const task = entry?.task;
            const taskId = String(task?.id || '').trim();
            if (!taskId || seen.has(taskId)) return acc;
            seen.add(taskId);
            acc.push(task);
            return acc;
        }, []);
    }, [displayVisiblePrepEntries]);
    const focusedPrepTaskIndex = useMemo(() => {
        const taskId = String(prepBoardDetail?.taskId || '').trim();
        const detailKey = String(prepBoardDetail?.selectedStepKey || '').trim();
        if (!taskId) return -1;
        const focusedEntryKey = detailKey ? `${taskId}::${detailKey}` : taskId;
        return displayVisiblePrepEntries.findIndex((entry) => String(entry?.entryKey || '').trim() === focusedEntryKey);
    }, [displayVisiblePrepEntries, prepBoardDetail]);
    const focusedPrepTask = useMemo(() => {
        const taskId = String(prepBoardDetail?.taskId || '').trim();
        if (!taskId) return null;
        return (Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : []).find((task) => String(task?.id || '').trim() === taskId) || null;
    }, [prepBoardDetail, productionPlan]);
    const focusedPrepRecipe = useMemo(() => {
        const recipeKey = String(
            prepBoardDetail?.recipeKey
            || focusedPrepTask?.recipeKey
            || focusedPrepTask?.lookupKey
            || ''
        ).trim();
        if (!recipeKey) return null;
        if (String(activeRecipeKey || '').trim() === recipeKey) return activeRecipe || null;
        return (Array.isArray(visibleRecipes) ? visibleRecipes : []).find((recipe, index) => (
            String(getRecipeKey(recipe, `idx-${index}`)).trim() === recipeKey
        )) || null;
    }, [activeRecipe, activeRecipeKey, focusedPrepTask, prepBoardDetail, visibleRecipes]);
    const focusedPrepActiveProfileHint = String(
        prepBoardDetail?.methodVariant
        || focusedPrepTask?.methodVariant
        || ''
    ).trim().toLowerCase() === 'batch' ? 'large' : 'regular';
    const focusedPrepReviewState = useMemo(
        () => buildGeneratedProfileReviewState(focusedPrepRecipe, {
            activePrepProfile: focusedPrepActiveProfileHint
        }),
        [focusedPrepActiveProfileHint, focusedPrepRecipe]
    );
    const handleFocusAdjacentPrepTask = (direction = 1) => {
        if (!Array.isArray(displayVisiblePrepEntries) || displayVisiblePrepEntries.length === 0) return;
        const currentIndex = focusedPrepTaskIndex >= 0 ? focusedPrepTaskIndex : 0;
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= displayVisiblePrepEntries.length) return;
        const nextEntry = displayVisiblePrepEntries[nextIndex];
        openPrepTaskInFocus(nextEntry.task, {
            selectedStep: nextEntry.selectedStep,
            selectedStepKey: nextEntry.selectedStepKey
        });
    };
    const beforeServiceVisibleTasks = useMemo(() => (
        displayVisibleUniquePrepTasks.filter((task) => getPrepDayPartKey(task) === 'before_service')
    ), [displayVisibleUniquePrepTasks]);
    const beforeServiceReadinessRows = useMemo(() => {
        const grouped = beforeServiceVisibleTasks.reduce((acc, task) => {
            const station = getPrepTaskStationDisplayLabel(task) || 'General Service';
            if (!acc[station]) {
                acc[station] = {
                    station,
                    tasks: [],
                    completedCount: 0,
                    startedCount: 0,
                    blockedCount: 0
                };
            }
            const sessionDetail = buildPrepTaskSessionDetail({
                task,
                sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                fallbackOwner: prepOperatorLabel
            });
            const stepCount = getPrepBoardTaskBullets(task).length || 1;
            const checkedCount = Array.from({ length: stepCount }, (_, index) => (
                Boolean(prepTaskStepChecks[`${String(task?.id || '').trim()}::${Number(index)}`]) ? 1 : 0
            )).reduce((sum, value) => sum + value, 0);
            const isStarted = sessionDetail.isCompleted || pickedPrepTaskIds.includes(String(task?.id || '').trim()) || checkedCount > 0;

            acc[station].tasks.push(task);
            if (sessionDetail.isCompleted) acc[station].completedCount += 1;
            if (isStarted) acc[station].startedCount += 1;
            if (isDependencyBlocked(task) || ['waiting approval', 'truth blocked', 'blocked'].includes(String(task?.taskState || '').trim())) {
                acc[station].blockedCount += 1;
            }
            return acc;
        }, {});

        return Object.values(grouped)
            .map((row) => {
                const totalCount = row.tasks.length;
                let readiness = 'not_ready';
                if (totalCount > 0 && row.completedCount === totalCount) {
                    readiness = 'ready';
                } else if (row.startedCount > 0 || row.completedCount > 0) {
                    readiness = 'risk';
                }
                return {
                    ...row,
                    totalCount,
                    readinessPct: totalCount > 0 ? Math.round((row.completedCount / totalCount) * 100) : 0,
                    readiness,
                    recipeNames: row.tasks.map((task) => formatPrepDisplayName(task?.name || 'Task'))
                };
            })
            .sort((left, right) => (
                ({ ready: 0, risk: 1, not_ready: 2 }[left.readiness] - { ready: 0, risk: 1, not_ready: 2 }[right.readiness])
                || String(left.station || '').localeCompare(String(right.station || ''))
            ));
    }, [beforeServiceVisibleTasks, pickedPrepTaskIds, prepExecutionSessions, prepOperatorLabel, prepTaskStepChecks]);
    const beforeServiceSummary = useMemo(() => {
        const readyRows = beforeServiceReadinessRows.filter((row) => row.readiness === 'ready');
        const riskRows = beforeServiceReadinessRows.filter((row) => row.readiness === 'risk');
        const notReadyRows = beforeServiceReadinessRows.filter((row) => row.readiness === 'not_ready');
        const totalRecipes = beforeServiceVisibleTasks.length;
        const readyRecipes = beforeServiceVisibleTasks.filter((task) => {
            const sessionDetail = buildPrepTaskSessionDetail({
                task,
                sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                fallbackOwner: prepOperatorLabel
            });
            return sessionDetail.isCompleted;
        }).length;
        return {
            readyRows,
            riskRows,
            notReadyRows,
            totalRecipes,
            readyRecipes
        };
    }, [beforeServiceReadinessRows, beforeServiceVisibleTasks, prepExecutionSessions, prepOperatorLabel]);
    const showBeforeServiceFocusPanel = effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART && prepFocusDayPart === 'before_service';
    const activeGroupingPhaseKey = effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART
        ? prepFocusDayPart
        : prepBoardPhase;
    const prepGroupingOptions = useMemo(() => (
        activeGroupingPhaseKey === 'before_service'
            ? [
                { id: PREP_BOARD_GROUPINGS.STATION, label: 'By station' },
                { id: PREP_BOARD_GROUPINGS.TASK, label: 'By task' },
                { id: PREP_BOARD_GROUPINGS.URGENT, label: 'Urgent' }
            ]
            : [
                { id: PREP_BOARD_GROUPINGS.STATION, label: 'By station' },
                { id: PREP_BOARD_GROUPINGS.TASK, label: 'By task' }
            ]
    ), [activeGroupingPhaseKey]);
    const beforeServiceDemandRows = useMemo(() => {
        const totalBooking = Number(serviceBookingCount || 0);
        const totalPrepPortions = beforeServiceReadinessRows.reduce((sum, row) => (
            sum + row.tasks.reduce((taskSum, task) => taskSum + Number(task?.estimatedPortions || 0), 0)
        ), 0);

        return beforeServiceReadinessRows.map((row) => {
            const prepPortions = row.tasks.reduce((sum, task) => sum + Number(task?.estimatedPortions || 0), 0);
            const demandPct = totalPrepPortions > 0 ? Math.round((prepPortions / totalPrepPortions) * 100) : 0;
            const bookingNeed = totalBooking > 0 ? Math.round((totalBooking * demandPct) / 100) : 0;
            return {
                station: row.station,
                demandPct,
                prepPortions,
                bookingNeed,
                readiness: row.readiness
            };
        }).sort((left, right) => Number(right.demandPct || 0) - Number(left.demandPct || 0));
    }, [beforeServiceReadinessRows, serviceBookingCount]);
    const serviceBriefPreview = useMemo(
        () => buildServiceBriefPreview(serviceBrief),
        [serviceBrief]
    );
    const selectedPrepDayTasks = useMemo(() => (
        prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY && Number.isInteger(prepScheduleDayFilter)
            ? (Array.isArray(scopedPrepTasks) ? scopedPrepTasks : [])
            : []
    ), [prepScheduleDayFilter, prepScheduleView, scopedPrepTasks]);
    const selectedPrepDayStationRows = useMemo(() => {
        if (!selectedPrepDayTasks.length) return [];
        const totalBooking = Number(serviceBookingCount || 0);
        const totalPlannedPortions = selectedPrepDayTasks.reduce((sum, task) => sum + Number(task?.estimatedPortions || 0), 0);
        const grouped = selectedPrepDayTasks.reduce((acc, task) => {
            const station = getPrepTaskStationDisplayLabel(task) || 'General Prep';
            if (!acc[station]) {
                acc[station] = {
                    station,
                    tasks: [],
                    plannedPortions: 0,
                    completedPortions: 0,
                    urgentCount: 0,
                    blockedCount: 0,
                    doneCount: 0,
                    shortestStorageHours: null,
                    shortestStorageLabel: 'N'
                };
            }

            const estimatedPortions = Number(task?.estimatedPortions || 0);
            const sessionDetail = buildPrepTaskSessionDetail({
                task,
                sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                fallbackOwner: prepOperatorLabel
            });
            const storageLifeLabel = getPrepStorageLifeLabelFromTask(task);
            const storageLifeHours = parseStorageLifeToHours(storageLifeLabel);
            const isUrgent = Boolean(prepPlans?.[task?.recipeKey]?.urgent)
                || Boolean(task?.isOverdueRisk)
                || normalizeText(task?.urgency_level) === 'high';

            acc[station].tasks.push(task);
            acc[station].plannedPortions += estimatedPortions;
            if (sessionDetail.isCompleted) {
                acc[station].completedPortions += estimatedPortions;
                acc[station].doneCount += 1;
            }
            if (isUrgent && !sessionDetail.isCompleted) acc[station].urgentCount += 1;
            if (isDependencyBlocked(task)) acc[station].blockedCount += 1;
            if (storageLifeHours !== null && (acc[station].shortestStorageHours === null || storageLifeHours < acc[station].shortestStorageHours)) {
                acc[station].shortestStorageHours = storageLifeHours;
                acc[station].shortestStorageLabel = storageLifeLabel;
            }
            return acc;
        }, {});

        return Object.values(grouped)
            .map((row) => {
                const stationShare = totalPlannedPortions > 0 ? (row.plannedPortions / totalPlannedPortions) : 0;
                const demandPortions = totalBooking > 0 ? Math.round(totalBooking * stationShare) : row.plannedPortions;
                const missingPortions = Math.max(demandPortions - row.completedPortions, 0);
                const extraReadyNow = Math.max(row.completedPortions - demandPortions, 0);
                const extraPlanned = Math.max(row.plannedPortions - demandPortions, 0);
                return {
                    ...row,
                    demandPortions,
                    missingPortions,
                    extraReadyNow,
                    extraPlanned,
                    stationSharePct: Math.round(stationShare * 100),
                    totalWeightLabel: buildPrepWeightSummary(row.tasks)
                };
            })
            .sort((left, right) => (
                Number(right.urgentCount || 0) - Number(left.urgentCount || 0)
                || Number(right.missingPortions || 0) - Number(left.missingPortions || 0)
                || Number(right.plannedPortions || 0) - Number(left.plannedPortions || 0)
                || String(left.station || '').localeCompare(String(right.station || ''))
            ));
    }, [prepExecutionSessions, prepOperatorLabel, prepPlans, scopedPrepTasks, selectedPrepDayTasks, serviceBookingCount]);
    const selectedPrepDayUrgentRows = useMemo(() => (
        selectedPrepDayTasks
            .filter((task) => {
                const sessionDetail = buildPrepTaskSessionDetail({
                    task,
                    sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                    fallbackOwner: prepOperatorLabel
                });
                return !sessionDetail.isCompleted && (
                    Boolean(prepPlans?.[task?.recipeKey]?.urgent)
                    || Boolean(task?.isOverdueRisk)
                    || normalizeText(task?.urgency_level) === 'high'
                );
            })
            .sort(compareCommandTaskReadiness)
            .slice(0, 4)
            .map((task) => ({
                id: String(task?.id || task?.recipeKey || task?.name || ''),
                title: formatPrepDisplayName(task?.name || 'Task'),
                station: getPrepTaskStationDisplayLabel(task),
                portions: Number(task?.estimatedPortions || 0),
                source: Boolean(prepPlans?.[task?.recipeKey]?.urgent) ? 'Manager urgent' : (Boolean(task?.isOverdueRisk) ? 'Overdue risk' : 'High demand')
            }))
    ), [prepExecutionSessions, prepOperatorLabel, prepPlans, selectedPrepDayTasks]);
    const selectedPrepDayDoneRows = useMemo(() => (
        selectedPrepDayTasks
            .filter((task) => {
                const sessionDetail = buildPrepTaskSessionDetail({
                    task,
                    sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                    fallbackOwner: prepOperatorLabel
                });
                return sessionDetail.isCompleted;
            })
            .sort((left, right) => Number(right?.estimatedPortions || 0) - Number(left?.estimatedPortions || 0))
            .slice(0, 4)
            .map((task) => ({
                id: String(task?.id || task?.recipeKey || task?.name || ''),
                title: formatPrepDisplayName(task?.name || 'Task'),
                station: getPrepTaskStationDisplayLabel(task),
                portions: Number(task?.estimatedPortions || 0),
                storageLife: getPrepStorageLifeLabelFromTask(task)
            }))
    ), [prepExecutionSessions, prepOperatorLabel, selectedPrepDayTasks]);
    const selectedPrepDayNotes = useMemo(() => (
        Array.isArray(prepBoardDetail?.notes)
            ? prepBoardDetail.notes.filter((note) => typeof note === 'string' && note.trim())
            : []
    ), [prepBoardDetail]);
    const selectedPrepDaySummaryStats = useMemo(() => {
        const plannedPortions = selectedPrepDayStationRows.reduce((sum, row) => sum + Number(row.plannedPortions || 0), 0);
        const readyPortions = selectedPrepDayStationRows.reduce((sum, row) => sum + Number(row.completedPortions || 0), 0);
        const demandPortions = selectedPrepDayStationRows.reduce((sum, row) => sum + Number(row.demandPortions || 0), 0);
        const urgentCount = selectedPrepDayUrgentRows.length;
        const readyStations = selectedPrepDayStationRows.filter((row) => Number(row.missingPortions || 0) <= 0 && Number(row.demandPortions || 0) > 0).length;
        const shortLifeCount = selectedPrepDayDoneRows.filter((row) => {
            const storageHours = parseStorageLifeToHours(row.storageLife);
            return storageHours !== null && storageHours <= 24;
        }).length;
        return {
            plannedPortions,
            readyPortions,
            demandPortions,
            urgentCount,
            readyStations,
            shortLifeCount
        };
    }, [selectedPrepDayDoneRows, selectedPrepDayStationRows, selectedPrepDayUrgentRows]);
    const selectedPrepDayPartRows = useMemo(() => (
        PREP_DAY_PART_SEQUENCE.map((phase) => {
            const phaseTasks = selectedPrepDayTasks.filter((task) => getPrepDayPartKey(task) === phase.key);
            const doneCount = phaseTasks.filter((task) => {
                const sessionDetail = buildPrepTaskSessionDetail({
                    task,
                    sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                    fallbackOwner: prepOperatorLabel
                });
                return sessionDetail.isCompleted;
            }).length;
            return {
                key: phase.key,
                label: phase.label,
                totalCount: phaseTasks.length,
                doneCount
            };
        })
    ), [prepExecutionSessions, prepOperatorLabel, selectedPrepDayTasks]);
    const selectedPrepDayPriorityTask = useMemo(() => {
        if (!selectedPrepDayTasks.length) return null;
        const openTasks = selectedPrepDayTasks.filter((task) => {
            const sessionDetail = buildPrepTaskSessionDetail({
                task,
                sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                fallbackOwner: prepOperatorLabel
            });
            return !sessionDetail.isCompleted;
        });
        if (!openTasks.length) return null;
        const rankedTask = [...openTasks].sort(compareCommandTaskReadiness)[0] || null;
        if (!rankedTask) return null;
        return {
            title: formatPrepDisplayName(rankedTask?.name || 'Task'),
            station: getPrepTaskStationDisplayLabel(rankedTask),
            portions: Number(rankedTask?.estimatedPortions || 0),
            source: Boolean(prepPlans?.[rankedTask?.recipeKey]?.urgent)
                ? 'Manager urgent'
                : (Boolean(rankedTask?.isOverdueRisk) ? 'Do first' : 'Next prep'),
            weight: formatPrepTaskQuantity(rankedTask?.targetYield || 0, rankedTask?.unit || '') || 'Weight not saved'
        };
    }, [prepExecutionSessions, prepOperatorLabel, prepPlans, selectedPrepDayTasks]);
    const showSelectedPrepDaySummaryPanel = (
        prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
        && effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD
        && Number.isInteger(prepScheduleDayFilter)
        && !showBeforeServiceFocusPanel
        && !String(prepBoardDetail?.taskId || '').trim()
        && (
            !prepBoardDetail
            || String(prepBoardDetail?.source || '').trim() === 'This week'
        )
    );
    const prepEmptyGuidance = useMemo(() => {
        if (!showPrepBoardEmptyState) return [];
        return [
            {
                title: 'Choose recipes in Recipe Truth',
                copy: 'Pick the dishes you want to run today and set the scale first.'
            },
            {
                title: 'Save or rotate the prep plan',
                copy: 'Use the prep actions below so the board knows what belongs to today.'
            },
            {
                title: 'Return here to follow the work',
                copy: 'Today tasks will appear by station or prep stage, with the first move pinned at the top.'
            }
        ];
    }, [showPrepBoardEmptyState]);
    useEffect(() => {
        const validTaskIds = new Set(
            (Array.isArray(scopedPrepTasks) ? scopedPrepTasks : [])
                .map((task) => String(task?.id || '').trim())
                .filter(Boolean)
        );
        setPickedPrepTaskIds((previous) => {
            const nextTaskIds = previous.filter((taskId) => validTaskIds.has(taskId));
            return nextTaskIds.length === previous.length ? previous : nextTaskIds;
        });
    }, [scopedPrepTasks]);
    const productionBoardFocusSignals = useMemo(() => {
        const taskList = Array.isArray(scopedPrepTasks) ? scopedPrepTasks : [];
        const stationList = productionCategoryLanes;
        const activePrepSession = activeRecipeKey ? prepExecutionSessions?.[activeRecipeKey] : null;
        const activePrepSessionRuntime = formatPrepSessionDuration(activePrepSession?.startedAt || '');

        if (!taskList.length) {
            return [
                {
                    title: 'No live prep yet',
                    badge: 'Start',
                    type: 'warm',
                    copy: compactPrepCopy(activeRecipe
                        ? `Scale ${activeRecipe?.name || 'a recipe'} to generate live prep signals.`
                        : 'Select and scale a recipe to generate prep signals.', 92)
                }
            ];
        }

        const blockedTasks = taskList
            .filter((task) => isDependencyBlocked(task))
            .sort(compareTaskReadiness);
        const firstBlockedTask = blockedTasks[0] || null;
        const blockedDependencyReasons = Array.isArray(firstBlockedTask?.dependencies)
            ? firstBlockedTask.dependencies
                .map((dependency) => dependency?.reason)
                .filter((reason) => typeof reason === 'string' && reason.trim())
                .slice(0, 2)
            : [];
        const topTask = taskList.reduce((winner, task) => {
            if (!winner) return task;
            const compareResult = compareTaskReadiness(task, winner);
            if (compareResult !== 0) return compareResult < 0 ? task : winner;
            const winnerYield = Number(winner?.targetYield || 0);
            const taskYield = Number(task?.targetYield || 0);
            if (taskYield !== winnerYield) return taskYield > winnerYield ? task : winner;
            return String(task?.name || '').localeCompare(String(winner?.name || '')) > 0 ? task : winner;
        }, null);
        const workflowStartTask = todayWorkflowSummary.startTask || taskList[0] || null;
        const prepAheadSummary = buildPrepAheadOpportunitySummary(taskList);

        const signals = [
            {
                title: productionBoardPressure.hasBOMSignal ? 'BOM-driven prep live' : 'Manual prep state',
                badge: productionBoardPressure.hasBOMSignal ? 'Active' : 'Review',
                type: productionBoardPressure.hasBOMSignal ? 'good' : 'warm',
                copy: compactPrepCopy(productionBoardPressure.hasBOMSignal
                    ? `${scopedPrepPressure.totalTasks} active prep task${scopedPrepPressure.totalTasks === 1 ? '' : 's'} in this ${prepScheduleView} view across ${stationList.length} categor${stationList.length === 1 ? 'y' : 'ies'}.`
                    : 'Load recipe scales so prep actions come from BOM truth, not notes.', 92)
            }
        ];
        if (activePrepSession) {
            const startCount = Number(activePrepSession?.startCount || 0);
            signals.push({
                title: `${startCount} prep session start${startCount === 1 ? '' : 's'} recorded`,
                badge: 'Track',
                type: 'warm',
                copy: compactPrepCopy(
                    `${activePrepSession?.recipeName || activeRecipe?.name || 'Selected recipe'} has an active prep session${activePrepSessionRuntime ? ` (${activePrepSessionRuntime})` : ''}. Use Start Prep to refresh timing when a new shift takes over.`,
                    120
                )
            });
        }

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY && taskList.length > 0) {
            signals.push({
                title: 'Day-part guide',
                badge: 'Flow',
                type: 'good',
                copy: compactPrepCopy(
                `Start ${formatPrepDisplayName(workflowStartTask?.name || 'the first prep task')}${Number(workflowStartTask?.prepTimeMinutes || 0) > 0 ? ` (${workflowStartTask.prepTimeMinutes} min)` : ''}. Then ${formatPrepDisplayName(todayWorkflowSummary.thenTask?.name || 'component prep')}. Hold ${formatPrepDisplayName(todayWorkflowSummary.holdTask?.name || 'service finish')} for before service. Morning ${todayWorkflowSummary.counts.morning} / Afternoon ${todayWorkflowSummary.counts.afternoon} / Before service ${todayWorkflowSummary.counts.beforeService}.${todayWorkflowSummary.prepAheadCount > 0 ? ` ${todayWorkflowSummary.prepAheadCount} task${todayWorkflowSummary.prepAheadCount === 1 ? '' : 's'} can move earlier if prep-ahead space opens.` : ''}`,
                    125
                )
            });
        }

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.WEEK && taskList.length > 0) {
            signals.push({
                title: prepAheadSummary.safeTomorrowCount > 0
                    ? `${prepAheadSummary.safeTomorrowCount} task${prepAheadSummary.safeTomorrowCount === 1 ? '' : 's'} can prep ahead`
                    : 'Week view is load compare',
                badge: prepAheadSummary.safeTomorrowCount > 0 ? 'Ahead' : 'Use',
                type: prepAheadSummary.safeTomorrowCount > 0 ? 'good' : 'warm',
                copy: compactPrepCopy(
                    prepAheadSummary.safeTomorrowCount > 0
                        ? `${formatPrepDisplayName(prepAheadSummary.longestLeadTask?.name || 'The longest-lead recipe')} can move earlier this week.`
                            + `${prepAheadSummary.tomorrowPrepCount > 0 ? ` ${prepAheadSummary.tomorrowPrepCount} can shift to tomorrow prep.` : ''}`
                            + `${prepAheadSummary.partialPrepCount > 0 ? ` ${prepAheadSummary.partialPrepCount} can be scheduled for partial prep.` : ''}`
                        : 'Use week view to compare days, then pull safe make-ahead work forward before pressure stacks.',
                    125
                )
            });
        }

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH && taskList.length > 0) {
            signals.push({
                title: prepAheadSummary.safeTomorrowCount > 0
                    ? `${prepAheadSummary.safeTomorrowCount} repeat prep opportunities visible`
                    : 'Month pressure active',
                badge: prepAheadSummary.safeTomorrowCount > 0 ? 'Plan' : 'Use',
                type: prepAheadSummary.safeTomorrowCount > 0 ? 'warm' : '',
                copy: compactPrepCopy(
                    prepAheadSummary.safeTomorrowCount > 0
                        ? `${prepAheadSummary.safeTomorrowCount} task${prepAheadSummary.safeTomorrowCount === 1 ? '' : 's'} have enough make-ahead/storage room to smooth the month load.`
                            + `${prepAheadSummary.tomorrowPrepCount > 0 ? ` ${prepAheadSummary.tomorrowPrepCount} move safely to tomorrow-prep windows.` : ''}`
                            + `${prepAheadSummary.partialPrepCount > 0 ? ` ${prepAheadSummary.partialPrepCount} also support staged partial prep.` : ''}`
                        : 'Use month view to catch repeat-heavy days and decide where prep should shift earlier.',
                    125
                )
            });
        }

        if (productionBoardPressure.bomShortageCount > 0) {
            signals.push({
                title: `${productionBoardPressure.bomShortageCount} shortage${productionBoardPressure.bomShortageCount === 1 ? '' : 's'} active`,
                badge: 'Risk',
                type: 'alert',
                copy: compactPrepCopy(`${productionBoardPressure.bomShortageCount} component${productionBoardPressure.bomShortageCount === 1 ? '' : 's'} are short against demand. Refill in priority order.`, 92)
            });
        }

        if (scopedPrepPressure.truthBlockedCount > 0 || scopedPrepPressure.truthReviewCount > 0) {
            const blockedCount = Number(scopedPrepPressure.truthBlockedCount || 0);
            const reviewCount = Number(scopedPrepPressure.truthReviewCount || 0);
            signals.push({
                title: blockedCount > 0 ? `${blockedCount} prep task${blockedCount === 1 ? '' : 's'} blocked by recipe truth` : `${reviewCount} prep task${reviewCount === 1 ? '' : 's'} need truth review`,
                badge: blockedCount > 0 ? 'Truth' : 'Review',
                type: blockedCount > 0 ? 'alert' : 'warm',
                copy: compactPrepCopy(blockedCount > 0
                    ? 'Fix missing yield, unit, or linked recipe truth before these prep cards can run.'
                    : 'Review lower-confidence recipe truth before this handoff moves downstream.', 120)
            });
        }

        if (scopedPrepPressure.waitingApprovalCount > 0) {
            const approvalCount = Number(scopedPrepPressure.waitingApprovalCount || 0);
            signals.push({
                title: `${approvalCount} prep task${approvalCount === 1 ? '' : 's'} waiting approval`,
                badge: 'Approval',
                type: 'warm',
                copy: compactPrepCopy('Wait for manager approval before running these tasks.', 88)
            });
        }

        if (scopedPrepPressure.overdueRiskCount > 0 || scopedPrepPressure.changedDependencyCount > 0) {
            const overdueCount = Number(scopedPrepPressure.overdueRiskCount || 0);
            const upstreamChangedCount = Number(scopedPrepPressure.changedDependencyCount || 0);
            signals.push({
                title: overdueCount > 0
                    ? `${overdueCount} prep task${overdueCount === 1 ? '' : 's'} carry overdue risk`
                    : `${upstreamChangedCount} prep task${upstreamChangedCount === 1 ? '' : 's'} need sequence reconfirm`,
                badge: overdueCount > 0 ? 'Escalate' : 'Changed',
                type: overdueCount > 0 ? 'alert' : 'warm',
                copy: compactPrepCopy(overdueCount > 0
                    ? `Early prep is slipping in ${prepScheduleView} view. Escalate the first blocked lane before service pressure builds.${upstreamChangedCount > 0 ? ` ${upstreamChangedCount} downstream task${upstreamChangedCount === 1 ? '' : 's'} also need sequence reconfirm.` : ''}`
                    : `${upstreamChangedCount} downstream prep task${upstreamChangedCount === 1 ? '' : 's'} should be reconfirmed because upstream prep changed.`, 125)
            });
        }

        if (scopedPrepPressure.changedTaskCount > 0) {
            const changedCount = Number(scopedPrepPressure.changedTaskCount || 0);
            signals.push({
                title: `${changedCount} prep task${changedCount === 1 ? '' : 's'} chef adjusted`,
                badge: 'Changed',
                type: 'warm',
                copy: compactPrepCopy('Chef-adjusted prep targets are live. Keep the local execution change visible without replacing canonical truth.', 120)
            });
        }

        if (blockedTasks.length > 0 && blockedTasks[0]) {
            const blockedTask = blockedTasks[0];
            const blockedDependencyCount = Number(blockedTask?.blockedDependencyCount || 0);
            const missingDependencyCount = Number(blockedTask?.missingDependencyCount || 0);
            const blockedFocusFallback = missingDependencyCount > 0 && blockedDependencyCount > 0
                ? `${blockedTask.name || 'This task'} cannot start yet: ${blockedDependencyCount} upstream prep dependenc${blockedDependencyCount === 1 ? 'y is' : 'ies are'} still blocked and ${missingDependencyCount} sub-recipe reference${missingDependencyCount === 1 ? ' is' : 's are'} unresolved. Confirm recipe truth and finish upstream prep first.`
                : missingDependencyCount > 0
                    ? `${blockedTask.name || 'This task'} cannot start yet because ${missingDependencyCount} sub-recipe reference${missingDependencyCount === 1 ? ' is' : 's are'} unresolved. Confirm recipe truth first.`
                    : blockedDependencyCount > 0
                        ? `${blockedTask.name || 'This task'} cannot start yet because ${blockedDependencyCount} upstream prep dependenc${blockedDependencyCount === 1 ? 'y is' : 'ies are'} still blocked. Finish that prep first.`
                        : `${blockedTask.name || 'This task'} is blocked by upstream prep dependencies.`;
            signals.push({
                title: `${blockedTask?.name || 'Task'} is blocked upstream`,
                badge: 'Block',
                type: 'alert',
                copy: compactPrepCopy(blockedDependencyReasons.length > 0
                    ? blockedDependencyReasons[0]
                    : blockedFocusFallback, 110)
            });
        }

        if (topTask) {
            const topTaskQty = formatPrepTaskQuantity(topTask?.targetYield, topTask?.unit || '');
            signals.push({
                title: `Top focus: ${formatPrepDisplayName(topTask.name || 'Highest-demand task')}`,
                badge: 'Now',
                type: 'good',
                copy: compactPrepCopy(`${topTask.station || 'General Prep'} starts this move. Target ${topTaskQty || 'current output'} in ${topTask.schedulePhase || 'active prep'} and keep the lane moving.`, 118)
            });
        }

        if (stationList.length > 0) {
            const busiestStation = stationList[0];
            signals.push({
                title: `${busiestStation?.category || 'Highest-load category'} is currently leading`,
                badge: stationList.length > 0 ? 'Load' : 'Quiet',
                type: busiestStation?.tasks?.length > 5 || busiestStation?.blockedCount > 0 ? 'alert' : 'warm',
                copy: compactPrepCopy(`${busiestStation?.tasks?.length || 0} active / ${busiestStation?.loadLabel || 'standard flow'}`, 92)
            });
        }

        const operationalSignals = signals.slice(0, 3);
        operationalSignals.push({
            title: prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH ? 'Month pressure active' : 'Week view',
            badge: 'Use',
            type: '',
            copy: prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH
                ? 'Month = long-horizon load, repeat prep, and safe make-ahead planning.'
                : 'Week = load, safe prep-ahead, and rebalance.'
        });
        operationalSignals.push({
            title: prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY ? 'Today view active' : 'Today view',
            badge: 'Use',
            type: '',
            copy: prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY
                ? 'Today = urgent execution, blockers, and immediate prep.'
                : 'Today = urgent action and service-first execution.'
        });

        return operationalSignals;
    }, [
        activeRecipe,
        activeRecipeKey,
        prepExecutionSessions,
        productionBoardPressure.bomShortageCount,
        productionBoardPressure.hasBOMSignal,
        scopedPrepPressure,
        prepScheduleView,
        scopedPrepTasks,
        todayWorkflowSummary,
        productionCategoryLanes,
        productionBoardPressure.stationCount
    ]);
    const visibleProductionBoardFocusSignals = useMemo(
        () => (effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD
            ? productionBoardFocusSignals
            : productionBoardFocusSignals.slice(0, 2)),
        [effectivePrepFocusMode, productionBoardFocusSignals]
    );
    const chefFocusSignals = useMemo(() => {
        const hiddenTitles = new Set([
            'manual prep state',
            'bom-driven prep live',
            'today view active',
            'today view',
            'week view',
            'month pressure active',
            'day-part guide'
        ]);

        const filtered = (Array.isArray(visibleProductionBoardFocusSignals) ? visibleProductionBoardFocusSignals : []).filter((signal) => {
            const normalizedTitle = normalizeText(signal?.title);
            return normalizedTitle && !hiddenTitles.has(normalizedTitle);
        });

        return filtered.slice(0, prepBoardDetail ? 1 : 2);
    }, [prepBoardDetail, visibleProductionBoardFocusSignals]);

    const scheduleServiceRows = useMemo(() => {
        if (!productionCommandLanes.length) {
            return [{
                title: 'No active service sets',
                meta: 'Connect recipes for live scheduling',
                count: '0'
            }];
        }

        const firstStation = productionCategoryLanes[0];
        const nextStationLabel = firstStation ? firstStation.category : 'General Prep';
        const stationCount = productionBoardPressure.stationCount || 0;
        const leadingTask = Array.isArray(scopedPrepTasks)
            ? [...scopedPrepTasks].sort(compareCommandTaskReadiness)[0]
            : null;
        const leadingFocusTarget = resolvePrepFocusTarget(
            {
                recipeKey: leadingTask?.recipeKey,
                recipeName: leadingTask?.name
            },
            {
                recipeKey: activeRecipeKey,
                recipeName: activeRecipe?.name || activeRecipe?.title || ''
            }
        );
        const readinessLabel = leadingTask ? getDependencyStateLabel(leadingTask) : 'ready';
        const leadingPhase = leadingTask?.schedulePhase || 'General Prep';
        const truthPressureParts = buildPrepPressureSummaryParts(scopedPrepPressure);
        const truthPressureCount = Number(scopedPrepPressure.attentionTaskCount || 0);

        return [
            {
                title: `${leadingPhase}: ${leadingTask?.name || nextStationLabel}`,
                meta: `${getPrepWindowLabel(leadingTask, 0)} / ${nextStationLabel} / ${readinessLabel}`,
                count: productionCommandLanes[0]?.label || 'Now',
                focusRecipeKey: leadingFocusTarget.recipeKey,
                focusRecipeName: leadingFocusTarget.recipeName
            },
            {
                title: 'Station load',
                meta: `${stationCount} station${stationCount === 1 ? '' : 's'} / ${scopedPrepPressure.totalTasks} active`,
                count: `${stationCount}`,
                focusRecipeKey: leadingFocusTarget.recipeKey,
                focusRecipeName: leadingFocusTarget.recipeName
            },
            {
                title: truthPressureCount > 0 ? 'Prep pressure' : 'Prep signal',
                meta: truthPressureParts.length > 0
                    ? compactPrepCopy(truthPressureParts.join(' / '), 72)
                    : 'Clean prep signal',
                count: `${truthPressureCount}`,
                focusRecipeKey: leadingFocusTarget.recipeKey,
                focusRecipeName: leadingFocusTarget.recipeName
            }
        ];
    }, [
        activeRecipe,
        activeRecipeKey,
        productionBoardPressure.stationCount,
        productionCommandLanes,
        scopedPrepTasks,
        scopedPrepPressure,
        productionCategoryLanes
    ]);

    const prepCalendarSummary = useMemo(() => {
        const summary = buildPrepCalendarPressure({
            tasks: Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [],
            prepPlans,
            now: new Date(),
            monthHorizon: 14
        });

        return {
            ...summary,
            weekCells: summary.weekCells.map((dayCell, dayIndex) => {
                const dayLabel = PREP_WEEKDAY_LONG_LABELS[dayIndex] || dayCell.label;
                const pressureParts = [
                    dayCell.count > 0 ? `${dayCell.count} task${dayCell.count === 1 ? '' : 's'}` : 'No plan',
                    dayCell.attentionCount > 0 ? `${dayCell.attentionCount} attention` : '',
                    dayCell.blockedCount > 0 ? `${dayCell.blockedCount} blocked` : ''
                ].filter(Boolean);

                return {
                    ...dayCell,
                    label: dayLabel,
                    loadLabel: pressureParts.join(' / ')
                };
            })
        };
    }, [prepPlans, productionPlan]);
    const visibleWeekCells = useMemo(
        () => prepCalendarSummary.weekCells.filter((dayCell) => dayCell.isToday || Number(dayCell.count || 0) > 0),
        [prepCalendarSummary.weekCells]
    );
    const selectedPrepDayCell = useMemo(() => (
        Number.isInteger(prepScheduleDayFilter)
            ? (prepCalendarSummary?.weekCells?.[prepScheduleDayFilter] || null)
            : null
    ), [prepCalendarSummary, prepScheduleDayFilter]);

    const recipeLibraryScheduleRows = useMemo(() => {
        const taskEntries = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        if (taskEntries.length > 0) {
            const groupedRows = taskEntries.reduce((acc, task) => {
                const key = String(task?.recipeKey || task?.name || '').trim();
                if (!key) return acc;

                if (!acc[key]) {
                    acc[key] = {
                        recipeKey: key,
                        title: formatPrepDisplayName(task?.name || 'Unnamed task'),
                        schedulePhase: task?.schedulePhase || 'General Prep',
                        schedulePhasePriority: Number(task?.schedulePhasePriority || 0),
                        station: task?.station || 'General Prep',
                        totalYield: 0,
                        taskCount: 0,
                        blockedCount: 0,
                        truthReviewCount: 0,
                        truthBlockedCount: 0,
                        changedCount: 0,
                        changedDependencyCount: 0,
                        overdueRiskCount: 0,
                        taskState: task?.taskState || 'ready now',
                        maxOperationalPriority: 0
                    };
                }

                acc[key].totalYield += Number(task?.targetYield || 0);
                acc[key].taskCount += 1;
                acc[key].blockedCount += isDependencyBlocked(task) ? 1 : 0;
                acc[key].truthReviewCount += Number(task?.truthPriority || 0) === 1 ? 1 : 0;
                acc[key].truthBlockedCount += Number(task?.truthPriority || 0) >= 2 ? 1 : 0;
                acc[key].changedCount += task?.hasChefOverride ? 1 : 0;
                acc[key].changedDependencyCount += task?.hasChangedDependency ? 1 : 0;
                acc[key].overdueRiskCount += task?.isOverdueRisk ? 1 : 0;
                if (Number(task?.operationalPriority || 0) >= Number(acc[key].maxOperationalPriority || 0)) {
                    acc[key].taskState = task?.taskState || acc[key].taskState;
                }
                acc[key].maxOperationalPriority = Math.max(acc[key].maxOperationalPriority, Number(task?.operationalPriority || 0));
                return acc;
            }, {});

            return Object.values(groupedRows)
                .sort((left, right) => (
                    Number(left.maxOperationalPriority || 0) - Number(right.maxOperationalPriority || 0)
                    || Number(left.schedulePhasePriority || 0) - Number(right.schedulePhasePriority || 0)
                    || Number(right.truthBlockedCount || 0) - Number(left.truthBlockedCount || 0)
                    || Number(right.blockedCount || 0) - Number(left.blockedCount || 0)
                    || String(left.title || '').localeCompare(String(right.title || ''))
                ))
                .map((row) => {
                    const metaParts = [
                        row.schedulePhase,
                        row.station,
                        row.taskState === 'waiting approval' ? 'waiting approval' : null,
                        row.changedCount > 0 ? `${row.changedCount} chef adjusted` : null,
                        row.changedDependencyCount > 0 ? `${row.changedDependencyCount} upstream changed` : null,
                        row.overdueRiskCount > 0 ? `${row.overdueRiskCount} overdue` : null,
                        row.taskState === 'ready after dependency' ? 'after dependency' : null,
                        row.taskState === 'ready now' ? 'ready now' : null,
                        row.truthBlockedCount > 0
                            ? `${row.truthBlockedCount} truth blocked`
                            : (row.truthReviewCount > 0 ? `${row.truthReviewCount} truth review` : null),
                        row.blockedCount > 0 ? `${row.blockedCount} blocked` : 'ready flow'
                    ].filter(Boolean);
                    const totalYieldLabel = formatPrepTaskQuantity(row.totalYield || 0, '');

                    return {
                        title: row.title,
                        meta: compactPrepCopy(metaParts.join(' / '), 74),
                        count: row.taskCount > 1 ? `${row.taskCount} tasks` : `${totalYieldLabel || Math.round(row.totalYield || 0)}`,
                        recipeKey: row.recipeKey,
                        sourceType: 'active_tasks'
                    };
                });
        }

        const libraryRecipes = Array.isArray(visibleRecipes) ? visibleRecipes : [];
        if (savedPrepScheduleRows.length > 0) {
            return savedPrepScheduleRows;
        }

        if (!libraryRecipes.length) {
            return [{
                title: 'No recipe library rows',
                meta: 'Add or upload recipes in Recipe Truth',
                count: '0'
            }];
        }

        const rows = libraryRecipes.map((recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const plannedYield = Number(dailyProduction?.[recipeKey] || recipe?.baseYield || recipe?.yield || 0);
            const normalizedYield = Number.isFinite(plannedYield) ? plannedYield : 0;
            const unit = String(recipe?.unit || '').trim();
            const station = String(recipe?.station || recipe?.dishStyle || recipe?.style || 'General Prep');
            const yieldLabel = normalizedYield > 0
                ? `${Number(normalizedYield.toFixed(2))}${unit ? ` ${unit}` : ''}`
                : 'No target';

            return {
                title: recipe?.name || recipe?.title || `Recipe ${index + 1}`,
                meta: compactPrepCopy(`${station} / recipe library ${yieldLabel}`, 56),
                count: normalizedYield > 0 ? `${Math.round(normalizedYield)}` : 'Preview',
                recipeKey,
                badge: 'Recipe ready',
                sourceType: 'library_preview'
            };
        });

        return rows.sort((a, b) => Number(b.count === 'Plan' ? 0 : b.count) - Number(a.count === 'Plan' ? 0 : a.count) || a.title.localeCompare(b.title));
    }, [dailyProduction, productionPlan, savedPrepScheduleRows, visibleRecipes]);

    const visibleScheduleRows = useMemo(() => {
        if (recipeLibraryScheduleRows.length > 0) {
            if (prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH) {
                return recipeLibraryScheduleRows.slice(0, 6);
            }
            if (prepScheduleView === PREP_SCHEDULE_VIEWS.WEEK) {
                return recipeLibraryScheduleRows.slice(0, 4);
            }
            return recipeLibraryScheduleRows.slice(0, 4);
        }

        if (prepScheduleView === PREP_SCHEDULE_VIEWS.WEEK) {
            return recipeLibraryScheduleRows.slice(0, 3);
        }
        if (prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH) {
            return recipeLibraryScheduleRows.slice(0, 5);
        }
        return scheduleServiceRows.length > 0 ? scheduleServiceRows : recipeLibraryScheduleRows.slice(0, 2);
    }, [prepScheduleView, recipeLibraryScheduleRows, scheduleServiceRows]);
    const hasRealPrepScheduleRows = useMemo(() => (
        visibleScheduleRows.some((row) => row?.sourceType === 'saved_plan' || row?.sourceType === 'active_tasks')
    ), [visibleScheduleRows]);
    const prepScheduleRowsLabel = hasRealPrepScheduleRows ? 'Planned Recipes' : 'Recipe Library Preview';
    const prepScheduleRowsAriaLabel = hasRealPrepScheduleRows ? 'Selected prep recipes' : 'Recipe library preview';
    const prepBoardPreviewTasks = useMemo(() => (
        (Array.isArray(visibleRecipes) ? visibleRecipes : []).reduce((rows, recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `preview-${index}`);
            const prepProfile = recipe?.workflow2PrepProfile || recipe?.prepProfile || null;
            if (!recipeKey || !prepProfile) return rows;

            rows.push({
                id: `preview-${recipeKey}`,
                recipeKey,
                name: recipe?.name || recipe?.title || `Recipe ${index + 1}`,
                recipe,
                workflow2PrepProfile: prepProfile,
                prepProfile,
                station: String(recipe?.dishStyle || recipe?.style || recipe?.station || 'Kitchen Standard').trim() || 'Kitchen Standard',
                station_group: String(recipe?.dishStyle || recipe?.style || recipe?.station || 'Kitchen Standard').trim() || 'Kitchen Standard',
                dishStyle: String(recipe?.dishStyle || recipe?.style || '').trim(),
                style: String(recipe?.style || recipe?.dishStyle || '').trim(),
                category: String(recipe?.category || recipe?.dishCategory || '').trim(),
                context_tags: {
                    cuisine: String(recipe?.cuisine || '').trim(),
                    dish_style: String(recipe?.dishStyle || recipe?.style || '').trim(),
                    occasion: String(recipe?.occasion || '').trim(),
                    event_location: ''
                },
                prepTimeMinutes: Number(prepProfile?.prepIntelligence?.prepTimeMinutes || prepProfile?.prep_intelligence?.prepTimeMinutes || 0),
                targetYield: Number(recipe?.baseYield || recipe?.yield || 0),
                estimatedPortions: 0,
                unit: String(recipe?.unit || '').trim(),
                methodVariant: 'normal',
                taskState: 'recipe ready',
                reasons: ['Recipe is linked to Workflow 2 prep content and is ready to move into the prep board plan.'],
                critical_checks: Array.isArray(prepProfile?.criticalChecks)
                    ? prepProfile.criticalChecks
                    : (Array.isArray(prepProfile?.critical_checks) ? prepProfile.critical_checks : []),
                service_finish: Array.isArray(prepProfile?.serviceFinish)
                    ? prepProfile.serviceFinish
                    : (Array.isArray(prepProfile?.service_finish) ? prepProfile.service_finish : [])
            });
            return rows;
        }, [])
    ), [visibleRecipes]);
    const prepBoardPreviewLanes = useMemo(
        () => buildPrepTaskCategoryLanes(prepBoardPreviewTasks),
        [prepBoardPreviewTasks]
    );
    const showPrepBoardRecipePreview = !hasActivePrepTasks && !hasCommandPrepTasks && !hasSavedPrepSchedule && prepBoardPreviewLanes.length > 0;
    const resolvedShowPrepBoardEmptyState = showPrepBoardEmptyState && !showPrepBoardRecipePreview;
    const prepEmptyRecipePreviewRows = useMemo(() => {
        return (Array.isArray(recipeLibraryScheduleRows) ? recipeLibraryScheduleRows : [])
            .filter((row) => String(row?.recipeKey || '').trim())
            .slice(0, 5);
    }, [recipeLibraryScheduleRows]);
    const prepBoardPreviewFocusTask = useMemo(() => {
        if (!showPrepBoardRecipePreview) return null;
        const selectedPreview = prepBoardPreviewTasks.find((task) => String(task?.recipeKey || '') === String(activeRecipeKey || ''));
        return selectedPreview || prepBoardPreviewTasks[0] || null;
    }, [activeRecipeKey, prepBoardPreviewTasks, showPrepBoardRecipePreview]);
    const prepBoardPreviewFocusDetail = useMemo(() => {
        const task = prepBoardPreviewFocusTask;
        if (!task) return null;
        const ingredientRows = Array.isArray(prepJobIngredientDrafts?.[String(task?.id || '').trim()])
            ? prepJobIngredientDrafts[String(task?.id || '').trim()]
            : [];
        const taskRows = getDisplayPrepTaskRows(task, ingredientRows);
        const storageMeta = getWorkflow2PrepStorageMeta(task);
        const foodSafetyChecks = getWorkflow2PrepFoodSafetyCcp(task);
        const skillLevels = getPrepTaskSkillLevels(task);
        return buildPrepBoardDetail({
            title: formatPrepDisplayName(task?.name || ''),
            badge: getPrepTaskStationDisplayLabel(task) || 'Recipe ready',
            type: 'warm',
            source: ['Recipe Truth', getPrepTaskRecipeCategoryLabel(task)].filter(Boolean).join(' / '),
            summary: getPrepTaskRecipeCategoryLabel(task),
            detail: taskRows[0]?.taskName || 'Recipe is linked to Workflow 2 prep content and ready for planning.',
            prepEstimate: getPrepEstimateLabel(task),
            portionSummary: getPrepPortionSummary(task),
            portionMeta: getPrepPortionMeta(task),
            storageLife: storageMeta.label || getPrepStorageLifeLabel(task),
            chips: [task?.context_tags?.cuisine || ''].filter(Boolean),
            notes: ['Open Recipe Truth or Prep Add to place this recipe into today’s prep board plan.'],
            executionSteps: taskRows.map((row) => row.taskName).filter(Boolean),
            taskRows,
            checklist: [],
            criticalChecks: getWorkflow2PrepCriticalChecks(task),
            foodSafetyChecks,
            equipment: getScaledEquipmentDetails(task),
            taskId: task?.id || '',
            taskRecipeKey: task?.recipeKey || '',
            recipeCategory: getPrepTaskRecipeCategoryLabel(task),
            storageLabel: storageMeta.label,
            storageShelfLifeHours: storageMeta.shelfLifeHours !== null ? `${storageMeta.shelfLifeHours} hr` : '',
            skillLevels,
            ownerLabel: '',
            statusLabel: 'Recipe ready',
            completedBy: '',
            isCompleted: false
        });
    }, [prepBoardPreviewFocusTask, prepJobIngredientDrafts]);
    const formatQuantity = (val, unit = '') => coreFormatQuantity(val, unit, unitSystem === UNIT_SYSTEMS.IMPERIAL);

    const recordRecipeActivity = (recipe, fallbackKey = null) => {
        const timestamp = Date.now();
        const aliases = [
            fallbackKey,
            recipe?.id,
            recipe?.recipe_id,
            recipe?.recipe_ref_id,
            recipe?.canonical_id,
            recipe?.clean_name,
            recipe?.canonical_name,
            recipe?.name,
            recipe?.sku,
            recipe?.code,
            recipe?.recipeCode
        ].map((value) => normalizeKey(value)).filter(Boolean);
        if (aliases.length === 0) return;

        setRecentRecipeActivity((prev) => {
            const next = { ...prev };
            aliases.forEach((alias) => {
                next[alias] = timestamp;
            });

            if (typeof localStorage !== 'undefined') {
                const storageKey = recentRecipeActivityKeyFor(scopedClientId);
                if (storageKey) {
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(next));
                    } catch (_error) {
                        // Ignore local persistence failures; in-memory state remains available.
                    }
                }
            }

            return next;
        });
    };

    useEffect(() => {
        setIngredientDrafts({});
        setIngredientEditMode(false);
        setCustomIngredientCategories(Array.isArray(activeRecipe?.scalingTips?.customIngredientCategories)
            ? activeRecipe.scalingTips.customIngredientCategories.filter(Boolean)
            : []);
        setAddingCategory(false);
        setNewCategoryDraft('');
        setEditingCategoryName(null);
        setCategoryNameDraft('');
        setDraggedIngredientKey(null);
        setDragTargetCategory(null);
        setEditingRecipeTitle(false);
        setEditingIngredientField(null);
        setEditingInstructionIndex(null);
        setEditingInstructionDraft('');
    }, [activeRecipeKey]);

    const scalingSettings = {
        mainPortionSize,
        sidePortionSize,
        starterPortionSize,
        portionsPerBatch
    };
    const { standardBatchYield: activeStandardBatchYield } = getRecipePlanningDefaults(
        activeRecipe,
        scalingSettings,
        visibleRecipes,
        volumeFocus
    );
    const baseYieldValue = Number(activeStandardBatchYield || activeRecipe?.baseYield || 0);
    const scaleMultiplier = Math.max(
        1,
        activeBomNode?.scale
            ? Math.round(Number(activeBomNode.scale) || 1)
            : (baseYieldValue > 0 ? Math.round(currentYieldValue / baseYieldValue) : 1)
    );
    const recipeTitle = activeRecipe?.name || activeRecipe?.title || 'Selected Recipe';
    useEffect(() => {
        setScaleInputValue(String(scaleMultiplier));
    }, [activeRecipeKey, scaleMultiplier]);

    useEffect(() => {
        setRecipeTitleDraft(recipeTitle);
    }, [recipeTitle, activeRecipeKey]);

    const recipeInstructions = normalizeRecipeInstructions(activeRecipe);
    const trainingSupport = useMemo(
        () => buildRecipeTrainingSupport(activeRecipe, { currentYieldValue }),
        [activeRecipe, currentYieldValue]
    );
    const activeGeneratedProfileReviewState = useMemo(
        () => buildGeneratedProfileReviewState(activeRecipe),
        [activeRecipe]
    );
    const workflow2TrainingProfile = activeRecipe?.workflow2PrepProfile || activeRecipe?.prepProfile || null;
    const workflow3ExtendedProfile = activeRecipe?.workflow3ExtendedProfile || activeRecipe?.extendedProfile || null;
    const sopLessonTitle = String(
        workflow2TrainingProfile?.trainingOutline?.lesson_title
        || workflow2TrainingProfile?.trainingOutline?.lessonTitle
        || workflow2TrainingProfile?.training_outline?.lesson_title
        || workflow2TrainingProfile?.training_outline?.lessonTitle
        || trainingSupport.lessonTitle
        || recipeTitle
    ).trim() || recipeTitle;
    const sopTrainingSections = useMemo(() => {
        const trainingOutline = workflow2TrainingProfile?.trainingOutline || workflow2TrainingProfile?.training_outline || {};
        const rawSections = Array.isArray(trainingOutline?.sections) ? trainingOutline.sections : [];
        const normalizedSections = rawSections.reduce((acc, section, index) => {
            if (typeof section === 'string') {
                const title = String(section || '').trim();
                if (title) acc.push({ id: `section-${index}`, title, copy: '' });
                return acc;
            }
            if (!section || typeof section !== 'object') return acc;
            const title = String(section?.title || section?.label || section?.heading || section?.name || `Section ${index + 1}`).trim();
            const copy = String(section?.copy || section?.description || section?.detail || section?.summary || '').trim();
            acc.push({ id: String(section?.id || `section-${index}`), title, copy });
            return acc;
        }, []);

        if (normalizedSections.length > 0) return normalizedSections;
        return (Array.isArray(trainingSupport.stepCards) ? trainingSupport.stepCards : []).map((step) => ({
            id: `fallback-step-${step.number}`,
            title: step.title,
            copy: step.copy
        }));
    }, [trainingSupport.stepCards, workflow2TrainingProfile]);
    const sopTrainingKeyPoints = useMemo(() => {
        const points = Array.isArray(workflow2TrainingProfile?.trainingKeyPoints)
            ? workflow2TrainingProfile.trainingKeyPoints
            : Array.isArray(workflow2TrainingProfile?.training_key_points)
                ? workflow2TrainingProfile.training_key_points
                : [];
        return points.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }, [workflow2TrainingProfile]);
    const sopServiceFinish = useMemo(() => {
        const rows = Array.isArray(workflow2TrainingProfile?.serviceFinish)
            ? workflow2TrainingProfile.serviceFinish
            : Array.isArray(workflow2TrainingProfile?.service_finish)
                ? workflow2TrainingProfile.service_finish
                : [];
        return rows.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }, [workflow2TrainingProfile]);
    const sopCriticalChecks = useMemo(() => {
        const rows = Array.isArray(workflow2TrainingProfile?.criticalChecks)
            ? workflow2TrainingProfile.criticalChecks
            : Array.isArray(workflow2TrainingProfile?.critical_checks)
                ? workflow2TrainingProfile.critical_checks
                : [];
        return rows.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }, [workflow2TrainingProfile]);
    const sopFoodSafetyCcp = useMemo(() => {
        const rows = Array.isArray(workflow2TrainingProfile?.foodSafetyCcp)
            ? workflow2TrainingProfile.foodSafetyCcp
            : Array.isArray(workflow2TrainingProfile?.food_safety_ccp)
                ? workflow2TrainingProfile.food_safety_ccp
                : [];
        return rows.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }, [workflow2TrainingProfile]);
    const sopPrepIntelligence = workflow2TrainingProfile?.prepIntelligence || workflow2TrainingProfile?.prep_intelligence || activeRecipe?.prepIntelligence || {};
    const sopStorageMeta = useMemo(() => {
        const storage = workflow2TrainingProfile?.storage || {};
        const useLargeProfile = Number(currentPortionCount || 0) > 50;
        const scopedStorage = storage?.[useLargeProfile ? 'large' : 'regular'] || storage?.profile || storage;
        return {
            label: String(
                scopedStorage?.label
                || scopedStorage?.storage_life
                || scopedStorage?.storageLife
                || scopedStorage?.storage_window
                || scopedStorage?.storageWindow
                || storage?.label
                || storage?.storage_life
                || storage?.storageLife
                || storage?.summary
                || ''
            ).trim(),
            shelfLifeHours: scopedStorage?.shelf_life_hours
                ?? scopedStorage?.shelfLifeHours
                ?? storage?.shelf_life_hours
                ?? storage?.shelfLifeHours
                ?? null
        };
    }, [currentPortionCount, workflow2TrainingProfile]);
    const sopStorageLabel = sopStorageMeta.label;
    const sopStorageShelfLifeHours = sopStorageMeta.shelfLifeHours;
    const sopScaleRule = workflow2TrainingProfile?.scaleRule || workflow2TrainingProfile?.scale_rule || {};
    const sopScaleRuleRows = useMemo(() => {
        const activeProfile = String(
            sopScaleRule?.active_profile
            || sopScaleRule?.activeProfile
            || sopScaleRule?.profile
            || ''
        ).trim();
        const scaleBucket = String(
            sopScaleRule?.scale_bucket
            || sopScaleRule?.scaleBucket
            || ''
        ).trim();
        const largeThreshold = sopScaleRule?.large_min_expected_portions
            ?? sopScaleRule?.largeMinExpectedPortions
            ?? sopScaleRule?.large_threshold_portions
            ?? sopScaleRule?.largeThresholdPortions
            ?? null;
        return [
            activeProfile ? `Active profile: ${activeProfile}` : '',
            scaleBucket ? `Scale bucket: ${scaleBucket}` : '',
            largeThreshold ? `Large-scale threshold: ${largeThreshold} portions` : 'Prep board switches to large-scale logic when portions exceed the threshold.'
        ].filter(Boolean);
    }, [sopScaleRule]);
    const sopEcoPrepRows = useMemo(() => {
        const operationalTeaching = workflow2TrainingProfile?.operationalTeaching
            || workflow2TrainingProfile?.operational_teaching
            || {};
        const ecoPrepRule = workflow2TrainingProfile?.ecoPrepRule
            || workflow2TrainingProfile?.eco_prep_rule
            || operationalTeaching?.ecoPrepRule
            || operationalTeaching?.eco_prep_rule
            || null;
        if (!ecoPrepRule) return [];

        const rawRows = Array.isArray(ecoPrepRule)
            ? ecoPrepRule
            : typeof ecoPrepRule === 'string'
                ? [ecoPrepRule]
                : [
                    ecoPrepRule?.summary,
                    ecoPrepRule?.goal,
                    ecoPrepRule?.method,
                    ecoPrepRule?.target,
                    ecoPrepRule?.note,
                    ecoPrepRule?.why,
                    ...(Array.isArray(ecoPrepRule?.tips) ? ecoPrepRule.tips : []),
                    ...(Array.isArray(ecoPrepRule?.steps) ? ecoPrepRule.steps : []),
                    ...(Array.isArray(ecoPrepRule?.rules) ? ecoPrepRule.rules : [])
                ];

        return [...new Set(
            rawRows.flatMap((row) => splitPrepDisplayText(String(row || '').trim()))
        )].filter(Boolean);
    }, [workflow2TrainingProfile]);
    const sopOperationalRows = useMemo(() => (
        [...new Set([...sopScaleRuleRows, ...sopEcoPrepRows])].filter(Boolean)
    ), [sopEcoPrepRows, sopScaleRuleRows]);
    const sopPrepIntelRows = useMemo(() => ([
        sopPrepIntelligence?.leadTime ? `Lead time: ${sopPrepIntelligence.leadTime}` : '',
        sopPrepIntelligence?.makeAhead ? `Make ahead: ${sopPrepIntelligence.makeAhead}` : '',
        sopPrepIntelligence?.handoffNote ? `Handoff: ${sopPrepIntelligence.handoffNote}` : '',
        Number(sopPrepIntelligence?.prepTimeMinutes || 0) > 0 ? `Prep time: ${Number(sopPrepIntelligence.prepTimeMinutes)} min` : ''
    ].filter(Boolean)), [sopPrepIntelligence]);
    const sopAdvancedRows = useMemo(() => {
        if (!workflow3ExtendedProfile) return [];
        const dependencyMap = workflow3ExtendedProfile?.dependencyMap || workflow3ExtendedProfile?.dependency_map || {};
        const oversoldRecovery = workflow3ExtendedProfile?.oversoldRecovery || workflow3ExtendedProfile?.oversold_recovery || {};
        const kitchenAdaptation = workflow3ExtendedProfile?.kitchenAdaptation || workflow3ExtendedProfile?.kitchen_adaptation || {};
        const strictMeta = workflow3ExtendedProfile?.strictContractMeta
            || workflow3ExtendedProfile?.strict_contract_meta
            || kitchenAdaptation?.strictContractMeta
            || kitchenAdaptation?.strict_contract_meta
            || {};

        const sections = [];
        const dependencyItems = Array.isArray(dependencyMap?.upstream_items)
            ? dependencyMap.upstream_items
            : Array.isArray(dependencyMap?.items)
            ? dependencyMap.items
            : Array.isArray(dependencyMap?.dependencies)
                ? dependencyMap.dependencies
                : [];
        if (dependencyItems.length > 0) {
            sections.push({
                title: 'Dependency Map',
                rows: dependencyItems.map((item) => (
                    typeof item === 'string'
                        ? item
                        : [
                            item?.sequence ? `#${item.sequence}` : '',
                            item?.task_name || item?.label || item?.name || '',
                            item?.station ? `(${item.station})` : ''
                        ].filter(Boolean).join(' ')
                ).map((item) => String(item || '').trim()).filter(Boolean))
            });
        }
        if (Array.isArray(dependencyMap?.blocking_dependencies) && dependencyMap.blocking_dependencies.length > 0) {
            sections.push({
                title: 'Blocking Dependencies',
                rows: dependencyMap.blocking_dependencies.map((item) => [
                    item?.task_name || item?.name || '',
                    item?.blocked_by ? `after ${item.blocked_by}` : '',
                    item?.reason ? `- ${item.reason}` : ''
                ].filter(Boolean).join(' ').trim()).filter(Boolean)
            });
        }
        if (Array.isArray(dependencyMap?.parallel_tasks) && dependencyMap.parallel_tasks.length > 0) {
            sections.push({
                title: 'Parallel Tasks',
                rows: dependencyMap.parallel_tasks.map((item) => [
                    item?.task_name || item?.name || '',
                    item?.station ? `at ${item.station}` : ''
                ].filter(Boolean).join(' ').trim()).filter(Boolean)
            });
        }
        if (workflow3ExtendedProfile?.containerLabelRule || workflow3ExtendedProfile?.container_label_rule) {
            const labelRule = workflow3ExtendedProfile?.containerLabelRule || workflow3ExtendedProfile?.container_label_rule || {};
            sections.push({
                title: 'Container Label Rule',
                rows: (
                    typeof labelRule === 'string'
                        ? [String(labelRule).trim()]
                        : [
                            labelRule?.container_type ? `Container: ${labelRule.container_type}` : '',
                            Array.isArray(labelRule?.label_fields) && labelRule.label_fields.length > 0
                                ? `Label fields: ${labelRule.label_fields.join(', ')}`
                                : '',
                            labelRule?.display_rule ? `Display: ${labelRule.display_rule}` : ''
                        ]
                ).filter(Boolean)
            });
        }
        const oversoldRows = [
            oversoldRecovery?.summary,
            oversoldRecovery?.note,
            oversoldRecovery?.action,
            typeof oversoldRecovery?.supported === 'boolean' ? `Supported: ${oversoldRecovery.supported ? 'yes' : 'review first'}` : '',
            Number.isFinite(Number(oversoldRecovery?.default_extra_portions)) ? `Default extra portions: ${Number(oversoldRecovery.default_extra_portions)}` : '',
            ...(Array.isArray(oversoldRecovery?.notes) ? oversoldRecovery.notes : [])
        ].map((item) => String(item || '').trim()).filter(Boolean);
        if (oversoldRows.length > 0) {
            sections.push({
                title: 'Oversold Recovery',
                rows: oversoldRows
            });
        }
        const adaptationRows = [
            kitchenAdaptation?.summary,
            kitchenAdaptation?.note,
            kitchenAdaptation?.action,
            ...(Array.isArray(kitchenAdaptation?.space_notes) ? kitchenAdaptation.space_notes : []),
            ...(Array.isArray(kitchenAdaptation?.batching_notes) ? kitchenAdaptation.batching_notes : [])
        ].map((item) => String(item || '').trim()).filter(Boolean);
        if (adaptationRows.length > 0) {
            sections.push({
                title: 'Kitchen Adaptation',
                rows: adaptationRows
            });
        }
        const evidenceRows = [
            ...(Array.isArray(workflow3ExtendedProfile?.sourceEvidenceIds) ? workflow3ExtendedProfile.sourceEvidenceIds : []),
            ...(Array.isArray(workflow3ExtendedProfile?.source_evidence_ids) ? workflow3ExtendedProfile.source_evidence_ids : []),
            ...(Array.isArray(strictMeta?.source_evidence_ids) ? strictMeta.source_evidence_ids : [])
        ].map((item) => String(item || '').trim()).filter(Boolean);
        if (evidenceRows.length > 0) {
            sections.push({
                title: 'Evidence Trail',
                rows: evidenceRows.slice(0, 8)
            });
        }
        if (workflow3ExtendedProfile?.managerReviewReason || workflow3ExtendedProfile?.manager_review_reason) {
            sections.push({
                title: 'Manager Review Reason',
                rows: [String(workflow3ExtendedProfile?.managerReviewReason || workflow3ExtendedProfile?.manager_review_reason || '').trim()].filter(Boolean)
            });
        }
        return sections;
    }, [workflow3ExtendedProfile]);
    const sopHasAdvancedContent = sopAdvancedRows.length > 0;
    const activeTrainingSession = useMemo(
        () => (activeRecipeKey ? (trainingProgressMap?.[activeRecipeKey] || {}) : {}),
        [activeRecipeKey, trainingProgressMap]
    );
    const trainingExecutionSupport = useMemo(
        () => buildRecipeTrainingExecutionSupport(activeRecipe, {
            currentYieldValue,
            session: activeTrainingSession
        }),
        [activeRecipe, currentYieldValue, activeTrainingSession]
    );
    const trainingManagerSupport = useMemo(
        () => buildRecipeTrainingManagerSupport(activeRecipe, {
            currentYieldValue,
            session: activeTrainingSession
        }),
        [activeRecipe, currentYieldValue, activeTrainingSession]
    );
    const trainingReadinessWorkspace = useMemo(
        () => buildTrainingReadinessWorkspace(visibleRecipes, trainingProgressMap),
        [visibleRecipes, trainingProgressMap]
    );
    const trainingModeIsStaff = trainingMode === TRAINING_VIEW_MODES.STAFF;
    const trainingSummaryCards = trainingModeIsStaff
        ? [
            {
                title: 'Lesson status',
                value: trainingExecutionSupport.readinessBadge,
                copy: trainingExecutionSupport.readinessCopy
            },
            {
                title: 'Version linked',
                value: trainingSupport.versionLabel,
                copy: 'This lesson stays tied to the current approved recipe truth.'
            },
            {
                title: 'Prep window',
                value: trainingSupport.prepWindowLabel,
                copy: trainingSupport.subtitle
            }
        ]
        : [
            {
                title: 'Assigned staff',
                value: trainingManagerSupport.assignmentLabel,
                copy: trainingManagerSupport.assignmentCopy
            },
            {
                title: 'Sign-off',
                value: trainingManagerSupport.reviewBadge,
                copy: trainingManagerSupport.reviewCopy
            },
            {
                title: 'Version linked',
                value: trainingSupport.versionLabel,
                copy: 'Training updates when the approved recipe changes.'
            }
        ];
    const sopPrepBoardRecipeRows = useMemo(() => (
        Object.values(prepPlans || {}).reduce((rows, plan, index) => {
            const plannedSelection = resolveVisibleRecipeSelection({
                recipeKey: plan?.recipeKey,
                recipeName: plan?.recipeName
            });
            if (!plannedSelection?.recipe || !plannedSelection?.recipeKey) return rows;

            const recipe = plannedSelection.recipe;
            const recipeKey = plannedSelection.recipeKey;
            const plannedQuantity = Number(plan?.quantity || dailyProduction?.[recipeKey] || recipe?.baseYield || recipe?.yield || 0);
            const unit = String(recipe?.unit || '').trim();
            const station = String(recipe?.station || recipe?.dishStyle || recipe?.style || 'General Prep');
            const quantityLabel = plannedQuantity > 0
                ? formatPrepTaskQuantity(plannedQuantity, unit) || `${Number(plannedQuantity.toFixed(2))}${unit ? ` ${unit}` : ''}`
                : 'No target';
            const modeLabel = String(plan?.mode || 'prepThisWeek') === 'rotatePrep'
                ? `Rotate prep / ${Number(plan?.rotateCount || 1)}x per ${plan?.rotateMode || 'week'}`
                : `Prep this week / ${formatPrepPlanDaySummary({ days: plan?.days, anyDay: plan?.anyDay })}`;

            rows.push({
                recipeKey,
                title: recipe?.name || recipe?.title || `Recipe ${index + 1}`,
                meta: compactPrepCopy(`${station} / ${modeLabel}`, 74),
                count: quantityLabel,
                category: String(recipe?.category || recipe?.dishCategory || 'General').trim() || 'General'
            });
            return rows;
        }, []).sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')))
    ), [dailyProduction, prepPlans, resolveVisibleRecipeSelection]);
    const trainingRecipeCategoryOptions = useMemo(() => (
        [...new Set(
            sopPrepBoardRecipeRows
                .map((row) => String(row?.category || '').trim())
                .filter(Boolean)
        )].sort((left, right) => left.localeCompare(right))
    ), [sopPrepBoardRecipeRows]);
    const visibleTrainingPrepBoardRecipeRows = useMemo(() => {
        if (trainingRecipeCategoryFilter === 'all') return sopPrepBoardRecipeRows;
        return sopPrepBoardRecipeRows.filter((row) => String(row?.category || '').trim() === trainingRecipeCategoryFilter);
    }, [sopPrepBoardRecipeRows, trainingRecipeCategoryFilter]);

    useEffect(() => {
        const nextDraft = trainingManagerSupport.assignedStaff.length > 0
            ? trainingManagerSupport.assignedStaff.join(', ')
            : trainingManagerSupport.suggestedStaffLabel;
        setTrainingAssignmentDraft((current) => (current === nextDraft ? current : nextDraft));
    }, [activeRecipeKey, trainingManagerSupport.assignedStaff, trainingManagerSupport.suggestedStaffLabel]);

    useEffect(() => {
        if (trainingRecipeCategoryFilter === 'all') return;
        if (trainingRecipeCategoryOptions.includes(trainingRecipeCategoryFilter)) return;
        setTrainingRecipeCategoryFilter('all');
    }, [trainingRecipeCategoryFilter, trainingRecipeCategoryOptions]);

    const updateTrainingSession = (updater) => {
        if (!activeRecipeKey) return;
        setTrainingProgressMap((current) => {
            const previousEntry = current?.[activeRecipeKey] || {};
            const nextEntry = updater(previousEntry);
            return {
                ...current,
                [activeRecipeKey]: nextEntry
            };
        });
    };

    const toggleTrainingStep = (stepNumber) => {
        updateTrainingSession((previousEntry) => {
            const completedSteps = new Set(
                Array.isArray(previousEntry?.completedSteps) ? previousEntry.completedSteps : []
            );
            if (completedSteps.has(stepNumber)) {
                completedSteps.delete(stepNumber);
            } else {
                completedSteps.add(stepNumber);
            }
            return {
                ...previousEntry,
                traineeLabel: prepOperatorLabel,
                startedAt: previousEntry?.startedAt || new Date().toISOString(),
                completedAt: '',
                completedBy: '',
                startedVersionLabel: trainingSupport.versionLabel,
                startedRevisionToken: trainingManagerSupport.currentRevisionToken,
                completedVersionLabel: '',
                completedRevisionToken: '',
                reviewedAt: '',
                reviewedBy: '',
                reviewedVersionLabel: '',
                reviewedRevisionToken: '',
                forceRetraining: false,
                completedSteps: Array.from(completedSteps).sort((left, right) => left - right),
                acknowledgements: {
                    ...(previousEntry?.acknowledgements || {})
                }
            };
        });
    };

    const toggleTrainingAcknowledgement = (checkId) => {
        updateTrainingSession((previousEntry) => ({
            ...previousEntry,
            traineeLabel: prepOperatorLabel,
            startedAt: previousEntry?.startedAt || new Date().toISOString(),
            completedAt: '',
            completedBy: '',
            startedVersionLabel: trainingSupport.versionLabel,
            startedRevisionToken: trainingManagerSupport.currentRevisionToken,
            completedVersionLabel: '',
            completedRevisionToken: '',
            reviewedAt: '',
            reviewedBy: '',
            reviewedVersionLabel: '',
            reviewedRevisionToken: '',
            forceRetraining: false,
            completedSteps: Array.isArray(previousEntry?.completedSteps) ? previousEntry.completedSteps : [],
            acknowledgements: {
                ...(previousEntry?.acknowledgements || {}),
                [checkId]: !Boolean(previousEntry?.acknowledgements?.[checkId])
            }
        }));
    };

    const markTrainingComplete = () => {
        if (!trainingExecutionSupport.canComplete) return;
        updateTrainingSession((previousEntry) => ({
            ...previousEntry,
            traineeLabel: prepOperatorLabel,
            startedAt: previousEntry?.startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            completedBy: prepOperatorLabel,
            startedVersionLabel: previousEntry?.startedVersionLabel || trainingSupport.versionLabel,
            startedRevisionToken: previousEntry?.startedRevisionToken || trainingManagerSupport.currentRevisionToken,
            completedVersionLabel: trainingSupport.versionLabel,
            completedRevisionToken: trainingManagerSupport.currentRevisionToken,
            reviewedAt: '',
            reviewedBy: '',
            reviewedVersionLabel: '',
            reviewedRevisionToken: '',
            forceRetraining: false,
            completedSteps: trainingExecutionSupport.stepRows.map((step) => step.number),
            acknowledgements: trainingExecutionSupport.checkRows.reduce((acc, check) => {
                acc[check.id] = true;
                return acc;
            }, {})
        }));
    };

    const resetTrainingSession = () => {
        if (!activeRecipeKey) return;
        setTrainingProgressMap((current) => ({
            ...current,
            [activeRecipeKey]: {}
        }));
    };

    const saveTrainingAssignment = (nextDraft = trainingAssignmentDraft) => {
        if (!activeRecipeKey) return;
        const nextAssignedStaff = normalizeTrainingAssignmentDraft(nextDraft);
        const normalizedDraft = nextAssignedStaff.join(', ');
        setTrainingAssignmentDraft(normalizedDraft);
        updateTrainingSession((previousEntry) => {
            const previousAssignedStaff = Array.isArray(previousEntry?.assignedStaff) ? previousEntry.assignedStaff : [];
            const assignmentChanged = previousAssignedStaff.join('|') !== nextAssignedStaff.join('|');
            const nextEntry = {
                ...previousEntry,
                assignedStaff: nextAssignedStaff,
                assignedAt: nextAssignedStaff.length > 0 ? new Date().toISOString() : '',
                assignedBy: nextAssignedStaff.length > 0 ? prepOperatorLabel : '',
                traineeLabel: previousEntry?.traineeLabel || nextAssignedStaff[0] || trainingManagerSupport.suggestedStaffLabel || ''
            };

            if (assignmentChanged) {
                nextEntry.reviewedAt = '';
                nextEntry.reviewedBy = '';
                nextEntry.reviewedVersionLabel = '';
                nextEntry.reviewedRevisionToken = '';
            }

            return nextEntry;
        });
    };

    const assignSuggestedTrainingStaff = () => {
        if (!trainingManagerSupport.suggestedStaffLabel) return;
        saveTrainingAssignment(trainingManagerSupport.suggestedStaffLabel);
    };

    const markTrainingReviewed = () => {
        if (!trainingManagerSupport.canReview) return;
        updateTrainingSession((previousEntry) => ({
            ...previousEntry,
            assignedStaff: Array.isArray(previousEntry?.assignedStaff) ? previousEntry.assignedStaff : [],
            assignedAt: previousEntry?.assignedAt || '',
            assignedBy: previousEntry?.assignedBy || '',
            reviewedAt: new Date().toISOString(),
            reviewedBy: prepOperatorLabel,
            reviewedVersionLabel: trainingSupport.versionLabel,
            reviewedRevisionToken: trainingManagerSupport.currentRevisionToken,
            forceRetraining: false
        }));
    };

    const resetTrainingForRetraining = () => {
        if (!activeRecipeKey) return;
        updateTrainingSession((previousEntry) => ({
            ...previousEntry,
            startedAt: '',
            completedAt: '',
            completedBy: '',
            completedSteps: [],
            acknowledgements: {},
            completedVersionLabel: '',
            completedRevisionToken: '',
            reviewedAt: '',
            reviewedBy: '',
            reviewedVersionLabel: '',
            reviewedRevisionToken: '',
            forceRetraining: false
        }));
    };

    const savedCustomIngredientCategories = Array.isArray(activeRecipe?.scalingTips?.customIngredientCategories)
        ? activeRecipe.scalingTips.customIngredientCategories.filter(Boolean)
        : [];
    const hasIngredientDrafts = Object.keys(ingredientDrafts).length > 0;
    const hasCustomCategoryChanges = JSON.stringify(customIngredientCategories) !== JSON.stringify(savedCustomIngredientCategories);
    const hasPendingIngredientChanges = hasIngredientDrafts || hasCustomCategoryChanges;

    useEffect(() => {
        if (!ingredientEditMode || hasPendingIngredientChanges) return undefined;

        const handlePointerDown = (event) => {
            const workspace = recipeWorkspaceRef.current;
            if (workspace && workspace.contains(event.target)) return;
            setIngredientEditMode(false);
            setEditingIngredientField(null);
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [ingredientEditMode, hasPendingIngredientChanges]);

    const activeStyle = activeRecipe?.dishStyle || activeRecipe?.style || 'Kitchen Standard';
    const activeCuisine = activeRecipe?.cuisine || activeRecipe?.cuisineType || activeRecipe?.dishCuisine || activeRecipe?.dishCategory || activeRecipe?.category || 'General';
    const numericScaleFactor = activeBomNode?.scale
        ? Number(activeBomNode.scale)
        : (baseYieldValue > 0 ? (currentYieldValue / baseYieldValue) : 0);
    const isBatchDrivenRecipe = isSauceLikeRecipe(activeRecipe)
        || ['batch_only', 'component_usage'].includes(String(activeRecipe?.yieldMode || activeRecipe?.yield_mode || '').trim().toLowerCase())
        || ['batch', 'batches'].includes(String(activeRecipe?.unit || '').trim().toLowerCase());
    const scaleSummaryLabel = isBatchDrivenRecipe
        ? `Batch x${scaleMultiplier}`
        : `Scale ${currentPortionCount} portions`;
    const previewIngredients = getRecipeIngredients(activeRecipe);
    const scheduleWindowLabel = prepScheduleView === PREP_SCHEDULE_VIEWS.MONTH
        ? 'Month'
        : (prepScheduleView === PREP_SCHEDULE_VIEWS.WEEK ? 'Week' : 'Today');
    const normalizeExportScaleValue = (value) => {
        const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    };
    const getDefaultExportScaleForRecipe = (recipe, recipeKey) => {
        if (!recipeKey) return 1;
        if (activeRecipeKey && String(recipeKey) === String(activeRecipeKey)) {
            return Math.max(1, scaleMultiplier);
        }
        const planningDefaults = recipeOperationalIndex.byKey?.[recipeKey] || {};
        const referenceYield = Number(
            planningDefaults?.standardBatchYield
            || recipe?.baseYield
            || recipe?.yield
            || planningDefaults?.defaultTargetYield
            || 0
        );
        const plannedYield = Number(dailyProduction?.[recipeKey] || 0);
        if (referenceYield > 0 && plannedYield > 0) {
            return Math.max(1, Math.round(plannedYield / referenceYield));
        }
        return 1;
    };
    const getRecipeExportScaleValue = (recipe, recipeKey) => normalizeExportScaleValue(
        exportScaleOverrides?.[recipeKey] ?? getDefaultExportScaleForRecipe(recipe, recipeKey)
    );
    const getPrepSetupRecipeTitle = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.title
        || recipe?.name
        || recipe?.title
        || 'Unnamed'
    );
    const getPrepSetupRecipeStyle = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.style
        || canonicalizeRecipeTaxonomy('style', recipe?.dishStyle || recipe?.style || 'Kitchen Standard')
    );
    const getPrepSetupRecipeCuisine = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.cuisine
        || canonicalizeRecipeTaxonomy('cuisine', recipe?.cuisine || recipe?.cuisineType || recipe?.dishCuisine || recipe?.dish_cuisine || 'General')
    );
    const getPrepSetupRecipeCategory = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.category
        || canonicalizeRecipeTaxonomy('category', recipe?.dishCategory || recipe?.category || recipe?.station || 'General')
    );
    const getPrepSetupRecipeOccasion = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.occasion
        || canonicalizeRecipeTaxonomy('occasion', recipe?.occasion || recipe?.serviceOccasion || recipe?.course || 'Service')
    );
    const getPrepSetupRecipeCode = (recipe, recipeKey) => String(
        recipeOperationalIndex.byKey?.[recipeKey]?.code
        || recipe?.code
        || recipe?.recipeCode
        || recipe?.recipe_code
        || recipe?.sku
        || recipe?.recipe_ref_id
        || recipe?.canonical_id
        || recipeKey
        || ''
    );
    const normalizePrepSetupScaleValue = (value, fallback = 1) => {
        const normalizedText = String(value ?? '')
            .replace(/,/g, '.')
            .replace(/[^0-9.]/g, '')
            .replace(/(\..*)\./g, '$1');
        const parsed = Number.parseFloat(normalizedText);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Number(parsed.toFixed(2));
        }
        return Number(fallback) > 0 ? Number(fallback) : 1;
    };
    const getDefaultPrepSetupScaleForRecipe = (recipe, recipeKey) => getDefaultExportScaleForRecipe(recipe, recipeKey);
    const getPrepSetupScaleValue = (recipe, recipeKey) => normalizePrepSetupScaleValue(
        prepSetupScaleOverrides?.[recipeKey] ?? getDefaultPrepSetupScaleForRecipe(recipe, recipeKey)
    );
    const getPrepSetupScaleDisplayValue = (recipe, recipeKey) => {
        if (Object.prototype.hasOwnProperty.call(prepSetupScaleDrafts || {}, recipeKey)) {
            return prepSetupScaleDrafts?.[recipeKey];
        }
        return String(getPrepSetupScaleValue(recipe, recipeKey));
    };
    const getPrepSetupTargetQuantity = (recipe, recipeKey) => {
        const planningDefaults = recipeOperationalIndex.byKey?.[recipeKey] || {};
        const baseQuantity = Number(
            planningDefaults?.standardBatchYield
            || recipe?.baseYield
            || recipe?.yield
            || planningDefaults?.defaultTargetYield
            || 0
        );
        const scaleValue = getPrepSetupScaleValue(recipe, recipeKey);
        if (baseQuantity > 0) {
            return Number((baseQuantity * scaleValue).toFixed(2));
        }
        return Number(scaleValue || 1);
    };
    const getPrepSetupQuantityLabelForRecipe = (recipe, recipeKey) => {
        const quantity = getPrepSetupTargetQuantity(recipe, recipeKey);
        const unit = recipe?.unit || recipeOperationalIndex.byKey?.[recipeKey]?.yieldUnit || '';
        const scaleValue = getPrepSetupScaleValue(recipe, recipeKey);
        const formattedQuantity = formatPrepTaskQuantity(quantity, unit);
        return formattedQuantity
            ? `Scale x${scaleValue} / ${formattedQuantity}`
            : `Scale x${scaleValue}`;
    };
    const getPrepSetupTouchpoint = (recipe, recipeKey) => {
        const recentCandidates = [
            recipeKey,
            recipe?.id,
            recipe?.recipe_id,
            recipe?.recipe_ref_id,
            recipe?.canonical_id,
            recipe?.clean_name,
            recipe?.canonical_name,
            recipe?.name,
            recipe?.title,
            recipe?.sku,
            recipe?.code,
            recipe?.recipeCode
        ].map((alias) => {
            const normalizedAlias = normalizeRecipeLookupValue(alias);
            if (!normalizedAlias) return 0;
            const recentValue = recentRecipeActivity?.[normalizedAlias];
            const parsedRecent = typeof recentValue === 'number' ? recentValue : Date.parse(recentValue);
            return Number.isFinite(parsedRecent) ? parsedRecent : 0;
        });
        const recentTouchpoint = recentCandidates.reduce((latest, value) => Math.max(latest, value || 0), 0);
        if (recentTouchpoint > 0) return recentTouchpoint;
        const newest = [
            recipe?.updated_at,
            recipe?.updatedAt,
            recipe?.offline_queued_at,
            recipe?.updated_at_local,
            recipe?.created_at,
            recipe?.createdAt,
            recipe?.last_modified_at
        ].find(Boolean);
        const parsed = newest ? Date.parse(newest) : NaN;
        return Number.isNaN(parsed) ? 0 : parsed;
    };
    const prepSetupRecipeBaseEntries = useMemo(() => (
        (Array.isArray(visibleRecipes) ? visibleRecipes : []).map((recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const title = getPrepSetupRecipeTitle(recipe, recipeKey);
            const style = getPrepSetupRecipeStyle(recipe, recipeKey);
            const cuisine = getPrepSetupRecipeCuisine(recipe, recipeKey);
            const category = getPrepSetupRecipeCategory(recipe, recipeKey);
            const occasion = getPrepSetupRecipeOccasion(recipe, recipeKey);
            const code = getPrepSetupRecipeCode(recipe, recipeKey);
            return {
                recipe,
                index,
                recipeKey,
                title,
                style,
                cuisine,
                category,
                occasion,
                code,
                selected: Boolean(prepSetupSelectionMap?.[recipeKey]),
                scale: getPrepSetupScaleValue(recipe, recipeKey),
                scaleDisplay: getPrepSetupScaleDisplayValue(recipe, recipeKey),
                quantityLabel: getPrepSetupQuantityLabelForRecipe(recipe, recipeKey),
                targetQuantity: getPrepSetupTargetQuantity(recipe, recipeKey),
                touchpoint: getPrepSetupTouchpoint(recipe, recipeKey),
                searchIndex: buildRecipeSearchIndexEntry(recipe, {
                    getRecipeName: () => title,
                    getRecipeStyle: () => style,
                    getRecipeCuisine: () => cuisine,
                    getRecipeCategory: () => category,
                    getRecipeOccasion: () => occasion,
                    getRecipeCode: () => code
                })
            };
        })
    ), [visibleRecipes, prepSetupSelectionMap, prepSetupScaleOverrides, prepSetupScaleDrafts, recentRecipeActivity, recipeOperationalIndex, activeRecipeKey, scaleMultiplier, dailyProduction]);
    const prepSetupStyleGroups = useMemo(
        () => buildRecipeBrowseGroups(prepSetupRecipeBaseEntries, (recipe) => getPrepSetupRecipeStyle(recipe, getRecipeKey(recipe))),
        [prepSetupRecipeBaseEntries]
    );
    const prepSetupCuisineGroups = useMemo(
        () => buildRecipeBrowseGroups(prepSetupRecipeBaseEntries, (recipe) => getPrepSetupRecipeCuisine(recipe, getRecipeKey(recipe))),
        [prepSetupRecipeBaseEntries]
    );
    const prepSetupCategoryGroups = useMemo(
        () => buildRecipeBrowseGroups(prepSetupRecipeBaseEntries, (recipe) => getPrepSetupRecipeCategory(recipe, getRecipeKey(recipe))),
        [prepSetupRecipeBaseEntries]
    );
    const prepSetupOccasionGroups = useMemo(
        () => buildRecipeBrowseGroups(prepSetupRecipeBaseEntries, (recipe) => getPrepSetupRecipeOccasion(recipe, getRecipeKey(recipe))),
        [prepSetupRecipeBaseEntries]
    );
    const resolvedPrepSetupStyleBrowse = useMemo(
        () => resolveRecipeBrowseGroup(prepSetupStyleGroups, prepSetupStyleFilter),
        [prepSetupStyleFilter, prepSetupStyleGroups]
    );
    const resolvedPrepSetupCuisineBrowse = useMemo(
        () => resolveRecipeBrowseGroup(prepSetupCuisineGroups, prepSetupCuisineFilter),
        [prepSetupCuisineFilter, prepSetupCuisineGroups]
    );
    const resolvedPrepSetupCategoryBrowse = useMemo(
        () => resolveRecipeBrowseGroup(prepSetupCategoryGroups, prepSetupCategoryFilter),
        [prepSetupCategoryFilter, prepSetupCategoryGroups]
    );
    const resolvedPrepSetupOccasionBrowse = useMemo(
        () => resolveRecipeBrowseGroup(prepSetupOccasionGroups, prepSetupOccasionFilter),
        [prepSetupOccasionFilter, prepSetupOccasionGroups]
    );
    const prepSetupRecipeEntries = useMemo(() => {
        const query = String(prepSetupQuery || '').trim();
        const chipMode = prepSetupActiveChip === 'recent' ? 'title' : prepSetupActiveChip;
        const filtered = prepSetupRecipeBaseEntries
            .map((entry) => {
                const { matched, score } = scoreRecipeSearchIndex(entry.searchIndex, query, chipMode);
                return {
                    ...entry,
                    matched: query ? matched : true,
                    matchScore: query ? score : 0
                };
            })
            .filter((entry) => entry.matched);

        const taxonomyKey = !query && prepSetupActiveChip === 'style'
            ? resolvedPrepSetupStyleBrowse.activeKey
            : (!query && prepSetupActiveChip === 'cuisine'
                ? resolvedPrepSetupCuisineBrowse.activeKey
                : (!query && prepSetupActiveChip === 'category'
                    ? resolvedPrepSetupCategoryBrowse.activeKey
                    : (!query && prepSetupActiveChip === 'occasion'
                        ? resolvedPrepSetupOccasionBrowse.activeKey
                        : '')));

        const taxonomyFiltered = taxonomyKey
            ? filtered.filter((entry) => {
                if (prepSetupActiveChip === 'style') return normalizeRecipeLookupValue(entry.style) === taxonomyKey;
                if (prepSetupActiveChip === 'cuisine') return normalizeRecipeLookupValue(entry.cuisine) === taxonomyKey;
                if (prepSetupActiveChip === 'category') return normalizeRecipeLookupValue(entry.category) === taxonomyKey;
                if (prepSetupActiveChip === 'occasion') return normalizeRecipeLookupValue(entry.occasion) === taxonomyKey;
                return true;
            })
            : filtered;

        return taxonomyFiltered.sort((left, right) => {
            if (left.selected !== right.selected) return Number(right.selected) - Number(left.selected);
            if (query && left.matchScore !== right.matchScore) return left.matchScore - right.matchScore;
            if (!query && prepSetupActiveChip === 'recent' && right.touchpoint !== left.touchpoint) {
                return right.touchpoint - left.touchpoint;
            }
            if (left.recipeKey === activeRecipeKey) return -1;
            if (right.recipeKey === activeRecipeKey) return 1;
            return left.title.localeCompare(right.title);
        });
    }, [
        prepSetupActiveChip,
        prepSetupQuery,
        prepSetupRecipeBaseEntries,
        resolvedPrepSetupCategoryBrowse.activeKey,
        resolvedPrepSetupCuisineBrowse.activeKey,
        resolvedPrepSetupOccasionBrowse.activeKey,
        resolvedPrepSetupStyleBrowse.activeKey,
        activeRecipeKey
    ]);
    const prepSetupVisibleKeys = prepSetupRecipeEntries.map((entry) => entry.recipeKey).filter(Boolean);
    const selectedPrepSetupCount = Object.values(prepSetupSelectionMap || {}).filter(Boolean).length;
    const prepSetupSelectedEntries = prepSetupRecipeBaseEntries.filter((entry) => prepSetupSelectionMap?.[entry.recipeKey]);
    const prepSetupPrimaryEntry = prepSetupSelectedEntries.find((entry) => entry.recipeKey === activeRecipeKey) || prepSetupSelectedEntries[0] || null;
    const prepSetupPrimaryPlan = prepSetupPrimaryEntry ? prepPlans?.[prepSetupPrimaryEntry.recipeKey] : null;
    useEffect(() => {
        const normalizedPlan = prepSetupPrimaryEntry
            ? (prepSetupPrimaryPlan || {})
            : (activePrepPlan || {});
        setPrepSetupDays((prev) => {
            const nextDays = Array.isArray(normalizedPlan?.days) ? normalizedPlan.days : [];
            return JSON.stringify(prev) === JSON.stringify(nextDays) ? prev : nextDays;
        });
        setPrepSetupUrgent(Boolean(normalizedPlan?.urgent));
        setPrepSetupAnyDay(Boolean(normalizedPlan?.anyDay));
        setPrepSetupAuto(Boolean(normalizedPlan?.auto));
        setPrepSetupRotateMode(String(normalizedPlan?.rotateMode || 'week'));
        setPrepSetupRotateCount(String(normalizedPlan?.rotateCount || 1));
        setPrepSetupMode(String(normalizedPlan?.mode || 'none'));
    }, [activePrepPlan, prepSetupPrimaryEntry, prepSetupPrimaryPlan]);
    const prepSetupPrimaryPlanLabel = !prepSetupPrimaryPlan
        ? 'No prep plan yet'
        : (prepSetupPrimaryPlan.mode === 'rotatePrep'
            ? `Rotate prep / ${Number(prepSetupPrimaryPlan.rotateCount || 1)}x per ${prepSetupPrimaryPlan.rotateMode || 'week'}`
            : `Prep this week / ${formatPrepPlanDaySummary({
                days: prepSetupPrimaryPlan.days,
                anyDay: prepSetupPrimaryPlan.anyDay
            })}`);
    const prepSetupChipButtons = [
        { key: 'title', label: 'Title-first' },
        { key: 'style', label: 'Style' },
        { key: 'cuisine', label: 'Cuisine' },
        { key: 'category', label: 'Category' },
        { key: 'occasion', label: 'Event' },
        { key: 'recent', label: 'Recent' }
    ];
    const renderPrepSetupTaxonomyRows = (groups = [], mode = 'style') => {
        const activeFilter = mode === 'style'
            ? prepSetupStyleFilter
            : (mode === 'cuisine'
                ? prepSetupCuisineFilter
                : (mode === 'category' ? prepSetupCategoryFilter : prepSetupOccasionFilter));
        const totalCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
        if (!groups.length) {
            return <div className="prep-setup-empty-note">{`No ${mode} groups available`}</div>;
        }
        return (
            <div className="taxonomy-list prep-setup-taxonomy-list">
                <button
                    type="button"
                    className={`taxonomy-row ${!activeFilter ? 'active' : ''}`}
                    aria-pressed={!activeFilter}
                    onClick={() => {
                        if (mode === 'style') setPrepSetupStyleFilter('');
                        if (mode === 'cuisine') setPrepSetupCuisineFilter('');
                        if (mode === 'category') setPrepSetupCategoryFilter('');
                        if (mode === 'occasion') setPrepSetupOccasionFilter('');
                    }}
                >
                    <span className="taxonomy-name">
                        {mode === 'style'
                            ? 'All Styles'
                            : (mode === 'cuisine'
                                ? 'All Cuisines'
                                : (mode === 'category' ? 'All Categories' : 'All Events'))}
                    </span>
                    <span className="taxonomy-count">{totalCount}</span>
                </button>
                {groups.map((group) => {
                    const isActive = activeFilter === group.key;
                    return (
                        <button
                            type="button"
                            key={`${mode}-${group.key}`}
                            className={`taxonomy-row ${isActive ? 'active' : ''}`}
                            aria-pressed={isActive}
                            onClick={() => {
                                if (mode === 'style') setPrepSetupStyleFilter(isActive ? '' : group.key);
                                if (mode === 'cuisine') setPrepSetupCuisineFilter(isActive ? '' : group.key);
                                if (mode === 'category') setPrepSetupCategoryFilter(isActive ? '' : group.key);
                                if (mode === 'occasion') setPrepSetupOccasionFilter(isActive ? '' : group.key);
                            }}
                        >
                            <span className="taxonomy-name">{group.label}</span>
                            <span className="taxonomy-count">{group.entries.length}</span>
                        </button>
                    );
                })}
            </div>
        );
    };
    const exportRecipeEntries = useMemo(() => {
        const needle = normalizeKey(exportQuery);
        const entries = (Array.isArray(visibleRecipes) ? visibleRecipes : []).map((recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const recipeIndexEntry = recipeOperationalIndex.byKey?.[recipeKey] || {};
            const title = String(recipeIndexEntry?.title || recipe?.name || recipe?.title || 'Unnamed');
            const style = String(recipeIndexEntry?.style || recipe?.dishStyle || recipe?.style || 'Kitchen Standard');
            const cuisine = String(recipeIndexEntry?.cuisine || recipe?.cuisine || recipe?.cuisineType || recipe?.dishCuisine || recipe?.dishCategory || recipe?.category || 'General');
            const code = String(recipeIndexEntry?.code || recipe?.code || recipe?.recipeCode || recipe?.recipe_code || recipe?.sku || recipe?.recipe_ref_id || recipe?.canonical_id || '');
            const haystack = `${title} ${code} ${style} ${cuisine}`.toLowerCase();
            const titleScore = needle ? (title.toLowerCase().startsWith(needle) ? 0 : (title.toLowerCase().includes(needle) ? 1 : 99)) : 0;
            const matchScore = !needle
                ? 0
                : (titleScore < 99 ? titleScore : (haystack.includes(needle) ? 4 : 999));
            return {
                recipe,
                recipeKey,
                title,
                style,
                cuisine,
                code,
                selected: Boolean(exportSelectionMap?.[recipeKey]),
                scale: getRecipeExportScaleValue(recipe, recipeKey),
                matchScore,
            };
        });

        return entries
            .filter((entry) => entry.matchScore < 999)
            .sort((left, right) => {
                if (left.selected !== right.selected) return Number(right.selected) - Number(left.selected);
                if (left.matchScore !== right.matchScore) return left.matchScore - right.matchScore;
                return left.title.localeCompare(right.title);
            });
    }, [exportQuery, exportScaleOverrides, exportSelectionMap, visibleRecipes, activeRecipeKey, scaleMultiplier, dailyProduction, recipeOperationalIndex]);
    const selectedExportCount = Object.values(exportSelectionMap || {}).filter(Boolean).length;
    const exportVisibleKeys = exportRecipeEntries.map((entry) => entry.recipeKey).filter(Boolean);

    useEffect(() => {
        if (!exportModalOpen) return undefined;

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closeExportModal();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [exportModalOpen]);

    useEffect(() => {
        if (!exportModalOpen) return;

        setExportScaleOverrides((prev) => {
            const next = { ...prev };
            let changed = false;
            (Array.isArray(visibleRecipes) ? visibleRecipes : []).forEach((recipe, index) => {
                const recipeKey = getRecipeKey(recipe, `idx-${index}`);
                if (!recipeKey || Object.prototype.hasOwnProperty.call(next, recipeKey)) return;
                next[recipeKey] = getDefaultExportScaleForRecipe(recipe, recipeKey);
                changed = true;
            });
            return changed ? next : prev;
        });

        setExportSelectionMap((prev) => {
            if (Object.values(prev || {}).some(Boolean)) return prev;
            if (!activeRecipeKey) return prev;
            return { [activeRecipeKey]: true };
        });
    }, [exportModalOpen, visibleRecipes, activeRecipeKey, scaleMultiplier, dailyProduction, volumeFocus, mainPortionSize, sidePortionSize, starterPortionSize, portionsPerBatch]);

    useEffect(() => {
        if (!prepSetupModalOpen) return undefined;

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closePrepSetupModal();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [prepSetupModalOpen]);

    useEffect(() => {
        if (!prepSetupModalOpen) return;

        setPrepSetupScaleOverrides((prev) => {
            const next = { ...prev };
            let changed = false;
            (Array.isArray(visibleRecipes) ? visibleRecipes : []).forEach((recipe, index) => {
                const recipeKey = getRecipeKey(recipe, `idx-${index}`);
                if (!recipeKey || Object.prototype.hasOwnProperty.call(next, recipeKey)) return;
                next[recipeKey] = getDefaultPrepSetupScaleForRecipe(recipe, recipeKey);
                changed = true;
            });
            return changed ? next : prev;
        });

        setPrepSetupSelectionMap((prev) => {
            if (Object.values(prev || {}).some(Boolean)) return prev;
            if (!activeRecipeKey) return prev;
            return { [activeRecipeKey]: true };
        });
    }, [prepSetupModalOpen, visibleRecipes, activeRecipeKey, scaleMultiplier, dailyProduction, volumeFocus, mainPortionSize, sidePortionSize, starterPortionSize, portionsPerBatch]);

    const activePrepScopedTasks = useMemo(() => {
        if (!activeRecipeKey) return [];
        const taskEntries = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        const activeAliases = new Set([
            activeRecipeKey,
            activeRecipe?.id,
            activeRecipe?.recipe_id,
            activeRecipe?.recipe_ref_id,
            activeRecipe?.canonical_id,
            activeRecipe?.clean_name,
            ...(Array.isArray(activeRecipe?.recipe_aliases) ? activeRecipe.recipe_aliases : [])
        ].map((value) => normalizeNameForLookup(value)).filter(Boolean));

        return taskEntries.filter((task) => {
            const taskAliases = [
                task?.recipeKey,
                task?.recipeName,
                task?.name
            ].map((value) => normalizeNameForLookup(value)).filter(Boolean);
            return taskAliases.some((alias) => activeAliases.has(alias));
        });
    }, [activeRecipe, activeRecipeKey, productionPlan]);

    const prepActionState = useMemo(() => buildPrepActionAvailability({
        recipe: activeRecipe,
        recipeKey: activeRecipeKey,
        scopedTasks: activePrepScopedTasks,
        prepPlan: activePrepPlan,
        sessionSnapshot: activeRecipeKey ? prepExecutionSessions?.[activeRecipeKey] : null
    }), [activePrepPlan, activePrepScopedTasks, activeRecipe, activeRecipeKey, prepExecutionSessions]);
    const loadingStateCopy = useMemo(
        () => buildOperationalStateCopy({
            kind: 'loading',
            authScopeState,
            offlineDataState
        }),
        [authScopeState, offlineDataState]
    );
    const recipeLibraryEmptyCopy = useMemo(
        () => buildOperationalStateCopy({
            kind: 'recipe-library-empty',
            authScopeState,
            offlineDataState,
            hasRecipes: Array.isArray(visibleRecipes) && visibleRecipes.length > 0
        }),
        [authScopeState, offlineDataState, visibleRecipes]
    );
    const recipeSelectionEmptyCopy = useMemo(
        () => buildOperationalStateCopy({
            kind: 'recipe-selection-empty',
            hasRecipes: Array.isArray(visibleRecipes) && visibleRecipes.length > 0,
            hasActiveRecipe: Boolean(activeRecipe)
        }),
        [visibleRecipes, activeRecipe]
    );
    const ingredientsEmptyCopy = useMemo(
        () => buildOperationalStateCopy({ kind: 'ingredients-empty' }),
        []
    );
    const instructionsEmptyCopy = useMemo(
        () => buildOperationalStateCopy({ kind: 'instructions-empty' }),
        []
    );
    const operationalObservabilityItems = useMemo(
        () => buildOperationalObservabilityItems({
            authScopeState,
            offlineDataState,
            syncNotice
        }),
        [authScopeState, offlineDataState, syncNotice]
    );

    const saveRecipeTitleDraft = () => {
        setEditingRecipeTitle(false);
        const nextTitle = String(recipeTitleDraft || '').trim();
        if (!nextTitle || nextTitle === recipeTitle) return;
        saveRecipePatch({
            name: nextTitle,
            title: nextTitle,
            clean_name: nextTitle
        }, { source: 'recipe-title-inline-edit' });
    };
    const cancelRecipeTitleEdit = () => {
        setRecipeTitleDraft(recipeTitle);
        setEditingRecipeTitle(false);
    };
    const startRecipeTitleEdit = () => {
        if (!ingredientEditMode) return;
        setEditingRecipeTitle(true);
        setRecipeTitleDraft(recipeTitle);
    };
    const normalizedRecipeInstructions = Array.isArray(recipeInstructions) ? recipeInstructions : [];
    const startInstructionEdit = (index) => {
        const current = normalizedRecipeInstructions[index] || '';
        setEditingInstructionIndex(index);
        setEditingInstructionDraft(String(current));
    };
    const saveInstructionEdit = () => {
        if (editingInstructionIndex === null || !activeRecipe) return;
        const currentIndex = editingInstructionIndex;
        const nextText = String(editingInstructionDraft || '').trim();
        const nextInstructions = [...normalizedRecipeInstructions];

        if (!nextText) {
            if (currentIndex >= 0 && currentIndex < nextInstructions.length) {
                nextInstructions.splice(currentIndex, 1);
            }
        } else if (currentIndex >= 0 && currentIndex < nextInstructions.length) {
            nextInstructions[currentIndex] = nextText;
        } else if (nextText) {
            nextInstructions.push(nextText);
        }

        if (JSON.stringify(nextInstructions) !== JSON.stringify(normalizedRecipeInstructions)) {
            saveRecipePatch({ instructions: nextInstructions }, { source: 'recipe-instruction-inline-edit' });
        }

        setEditingInstructionIndex(null);
        setEditingInstructionDraft('');
    };
    const cancelInstructionEdit = () => {
        setEditingInstructionIndex(null);
        setEditingInstructionDraft('');
    };

    function resolveVisibleRecipeSelection({ recipeKey = '', recipeName = '' } = {}) {
        const targetRecipeName = normalizeNameForLookup(recipeName);
        const normalizedCandidates = new Set([
            normalizeKey(recipeKey),
            normalizeNameForLookup(recipeName)
        ].filter(Boolean));
        if (targetRecipeName) {
            normalizedCandidates.add(normalizeText(targetRecipeName));
        }
        if (!normalizedCandidates.size || !Array.isArray(visibleRecipes) || visibleRecipes.length === 0) return null;

        for (let index = 0; index < visibleRecipes.length; index += 1) {
            const recipe = visibleRecipes[index];
            if (!recipe) continue;
            const resolvedRecipeKey = getRecipeKey(recipe, `idx-${index}`);
            if (recipeMatchesLookup(recipe, [...normalizedCandidates], resolvedRecipeKey)) {
                return { recipe, recipeKey: resolvedRecipeKey };
            }

            const recipeNameAlias = normalizeNameForLookup(
                buildRecipeLookupAliases(recipe, resolvedRecipeKey).find(Boolean) || recipe?.name || recipe?.title || recipe?.clean_name || ''
            );
            if (recipeNameAlias && targetRecipeName && (
                recipeNameAlias === targetRecipeName
                || recipeNameAlias.includes(targetRecipeName)
                || targetRecipeName.includes(recipeNameAlias)
            )) {
                return { recipe, recipeKey: resolvedRecipeKey };
            }
        }

        return null;
    }

    const focusPrepRecipeSelection = (selection, {
        message = '',
        tone = 'info',
        viewId = DASHBOARD_VIEWS.BOARD,
        detail = null,
    } = {}) => {
        if (!selection?.recipe || !selection?.recipeKey) return false;
        setSelectedId(selection.recipeKey);
        recordRecipeActivity(selection.recipe, selection.recipeKey);
        if (detail) {
            setPrepBoardDetail(detail);
        }
        if (viewId) activateWorkflowView(viewId);
        if (message) {
            setPrepActionNotice({ tone, message });
        }
        return true;
    };

    const focusPrepRecipeFromBoard = ({
        recipeKey = '',
        recipeName = '',
        message = '',
        tone = 'info',
        viewId = DASHBOARD_VIEWS.BOARD,
        detail = null,
    } = {}) => {
        const selection = resolveVisibleRecipeSelection({ recipeKey, recipeName });
        if (!selection) {
            const fallbackSelection = ensurePrepRecipeSelection();
            if (!fallbackSelection) {
                const fallbackMessage = recipeName
                    ? `${recipeName} is visible on the prep board, but no matching recipe truth row was found.`
                    : 'No linked recipe truth row was found for that prep item.';
                setPrepActionNotice({
                    tone: 'warning',
                    message: message || fallbackMessage
                });
                if (detail) {
                    setPrepBoardDetail(detail);
                }
                if (message && message !== fallbackMessage) {
                    setPrepActionNotice({
                        tone,
                        message
                    });
                }
                return false;
            }

            return focusPrepRecipeSelection(fallbackSelection, {
                message: recipeName
                    ? `${recipeName} could not be resolved directly, so we kept your current focused recipe.`
                    : message,
                tone,
                viewId,
                detail
            });
        }
        return focusPrepRecipeSelection(selection, { message, tone, viewId, detail });
    };

    const buildPrepBoardDetail = ({
        title = 'Prep detail',
        badge = 'Detail',
        type = 'warm',
        source = '',
        summary = '',
        detail = '',
        prepEstimate = '',
        portionSummary = '',
        portionMeta = '',
        storageLife = '',
        chips = [],
        notes = [],
        executionSteps = [],
        taskRows = [],
        checklist = [],
        criticalChecks = [],
        foodSafetyChecks = [],
        equipment = [],
        prepIntelligenceRows = [],
        taskId = '',
        taskRecipeKey = '',
        selectedStepKey = '',
        recipeCategory = '',
        storageLabel = '',
        storageShelfLifeHours = '',
        skillLevels = [],
        ownerLabel = '',
        statusLabel = '',
        completedBy = '',
        isCompleted = false
    } = {}) => ({
        title: String(title || 'Prep detail'),
        badge: String(badge || 'Detail'),
        type: String(type || 'warm'),
        source: String(source || '').trim(),
        summary: String(summary || '').trim(),
        detail: String(detail || '').trim(),
        prepEstimate: String(prepEstimate || '').trim(),
        portionSummary: String(portionSummary || '').trim(),
        portionMeta: String(portionMeta || '').trim(),
        storageLife: String(storageLife || '').trim(),
        chips: Array.isArray(chips) ? chips.filter(Boolean).map((chip) => String(chip).trim()).filter(Boolean) : [],
        notes: Array.isArray(notes) ? notes.filter(Boolean).map((note) => String(note).trim()).filter(Boolean) : [],
        executionSteps: Array.isArray(executionSteps) ? executionSteps.filter(Boolean).map((step) => String(step).trim()).filter(Boolean) : [],
        taskRows: Array.isArray(taskRows) ? taskRows.filter(Boolean) : [],
        checklist: Array.isArray(checklist) ? checklist.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        criticalChecks: Array.isArray(criticalChecks) ? criticalChecks.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        foodSafetyChecks: Array.isArray(foodSafetyChecks) ? foodSafetyChecks.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        equipment: Array.isArray(equipment) ? equipment.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        prepIntelligenceRows: Array.isArray(prepIntelligenceRows) ? prepIntelligenceRows.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        taskId: String(taskId || '').trim(),
        taskRecipeKey: String(taskRecipeKey || '').trim(),
        selectedStepKey: String(selectedStepKey || '').trim(),
        recipeCategory: String(recipeCategory || '').trim(),
        storageLabel: String(storageLabel || '').trim(),
        storageShelfLifeHours: String(storageShelfLifeHours || '').trim(),
        skillLevels: Array.isArray(skillLevels) ? skillLevels.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [],
        ownerLabel: String(ownerLabel || '').trim(),
        statusLabel: String(statusLabel || '').trim(),
        completedBy: String(completedBy || '').trim(),
        isCompleted: Boolean(isCompleted)
    });

    const resolvePrepRecipeForTask = useCallback((task = {}) => {
        const aliases = new Set([
            task?.recipeKey,
            task?.id,
            task?.name
        ].map(normalizeKey).filter(Boolean));
        if (!aliases.size) return null;

        return (Array.isArray(visibleRecipes) ? visibleRecipes : []).find((recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            const recipeAliases = [
                recipeKey,
                recipe?.id,
                recipe?.recipe_ref_id,
                recipe?.canonical_id,
                recipe?.clean_name,
                recipe?.name,
                recipe?.title
            ].map(normalizeKey).filter(Boolean);
            return recipeAliases.some((alias) => aliases.has(alias));
        }) || null;
    }, [visibleRecipes]);

    const buildPrepJobIngredientRows = useCallback((recipe = {}) => (
        buildPrepIngredientRowsForRecipe(recipe)
    ), [buildPrepIngredientRowsForRecipe]);

    const ensurePrepJobIngredientsForTask = useCallback((task = {}) => {
        const taskId = String(task?.id || '').trim();
        if (!taskId) return;

        setPrepJobIngredientDrafts((previous) => {
            if (Array.isArray(previous?.[taskId])) return previous;
            const recipe = resolvePrepRecipeForTask(task);
            return {
                ...previous,
                [taskId]: recipe ? buildPrepJobIngredientRows(recipe) : []
            };
        });
    }, [buildPrepJobIngredientRows, resolvePrepRecipeForTask]);

    useEffect(() => {
        (Array.isArray(activePrepTasks) ? activePrepTasks : []).forEach((task) => {
            ensurePrepJobIngredientsForTask(task);
        });
    }, [activePrepTasks, ensurePrepJobIngredientsForTask]);

    if (loading || !visibleRecipes) return (
        <div className="hybrid-loading">
            <Zap className="hybrid-loading-icon" size={48} />
            <div className="hybrid-loading-copy">{loadingStateCopy.title}</div>
            <div className="hybrid-loading-sub">{loadingStateCopy.body}</div>
        </div>
    );

    const ensurePrepRecipeSelection = () => {
        if (activeRecipe && activeRecipeKey) {
            return { recipe: activeRecipe, recipeKey: activeRecipeKey };
        }

        const leadTask = Array.isArray(productionPlan?.tasks)
            ? [...productionPlan.tasks].sort(compareCommandTaskReadiness)[0]
            : null;
        if (leadTask) {
            const matchedSelection = resolveVisibleRecipeSelection({
                recipeKey: leadTask?.recipeKey,
                recipeName: leadTask?.name
            });
            if (matchedSelection) {
                setSelectedId(matchedSelection.recipeKey);
                recordRecipeActivity(matchedSelection.recipe, matchedSelection.recipeKey);
                return matchedSelection;
            }
        }

        const fallbackRecipe = Array.isArray(visibleRecipes) && visibleRecipes.length > 0 ? visibleRecipes[0] : null;
        const fallbackKey = fallbackRecipe ? getRecipeKey(fallbackRecipe, 'idx-0') : null;
        if (!fallbackRecipe || !fallbackKey) return null;
        setSelectedId(fallbackKey);
        recordRecipeActivity(fallbackRecipe, fallbackKey);
        return { recipe: fallbackRecipe, recipeKey: fallbackKey };
    };

    function getPrepTasksForRecipe(recipe, recipeKey) {
        const activeAliases = new Set([
            recipeKey,
            recipe?.id,
            recipe?.recipe_id,
            recipe?.recipe_ref_id,
            recipe?.canonical_id,
            recipe?.clean_name,
            recipe?.name
        ].map(normalizeKey).filter(Boolean));

        const allTasks = Array.isArray(productionPlan?.tasks) ? productionPlan.tasks : [];
        return allTasks.filter((task) => {
            const taskRecipeKey = normalizeKey(task?.recipeKey);
            const taskName = normalizeKey(task?.name);
            return activeAliases.has(taskRecipeKey) || activeAliases.has(taskName);
        });
    }

    const getPrepStorageLifeLabel = (task = {}) => getPrepStorageLifeLabelFromTask(task);

    const getPrepPortionSummary = (task = {}) => {
        const portionCount = Number(task?.estimatedPortions || 0);
        if (portionCount > 0) return `${portionCount}`;
        return 'N';
    };

    const getPrepPortionMeta = (task = {}) => {
        const totalWeight = Number(task?.targetYield || 0);
        const unit = String(task?.unit || '').trim();
        const portionCount = Number(task?.estimatedPortions || 0);
        const totalWeightLabel = totalWeight > 0 ? formatPrepTaskQuantity(totalWeight, unit) : '';
        const perPortionWeight = portionCount > 0 && totalWeight > 0 ? (totalWeight / portionCount) : 0;
        const perPortionLabel = perPortionWeight > 0 ? formatPrepTaskQuantity(Number(perPortionWeight.toFixed(2)), unit) : '';

        const smallParts = [
            perPortionLabel ? `${perPortionLabel} each` : 'N each',
            totalWeightLabel ? `${totalWeightLabel} total` : 'N total'
        ];
        return smallParts.join(' / ');
    };

    const getPrepEstimateLabel = (task = {}) => {
        const rowMinutes = getPrepBoardTaskRows(task).reduce((sum, row) => (
            sum + Number(row?.estimatedMinutes || 0)
        ), 0);
        if (rowMinutes > 0) return `${rowMinutes} min`;
        const minutes = Number(task?.prepTimeMinutes || 0);
        if (minutes > 0) return `${minutes} min`;
        return 'N';
    };

    const getScaledEquipmentDetails = (task = {}) => {
        const workflow2Equipment = getWorkflow2PrepEquipment(task);
        const baseEquipment = workflow2Equipment.length > 0
            ? workflow2Equipment
            : (Array.isArray(task?.equipment) ? task.equipment.filter(Boolean).slice(0, 4) : []);
        const portionCount = Number(task?.estimatedPortions || 0);
        const isBatch = String(task?.methodVariant || '').trim() === 'batch';
        const scaleHint = isBatch
            ? (portionCount >= 1000
                ? 'Use 40L pot or 60x40 deep tubs for this scale.'
                : (portionCount >= 250
                    ? 'Use 20L pot or full-size gastro trays for this scale.'
                    : 'Use medium hotel pans or 12L cambros for this scale.'))
            : (portionCount >= 50
                ? 'Use medium gastronorm trays and labeled containers.'
                : 'Use standard prep bowls, 1/3 gastro trays, and labeled deli containers.');

        if (baseEquipment.length === 0) return [scaleHint];
        return baseEquipment.map((item, index) => index === 0 ? `${item} - ${scaleHint}` : item);
    };

    const getPrepFocusSourceLabel = (task = {}, fallbackSource = '') => {
        if (String(fallbackSource || '').trim()) return String(fallbackSource || '').trim();
        const phaseKey = getPrepDayPartKey(task);
        return prepBoardGrouping === PREP_BOARD_GROUPINGS.TASK
            ? getPrepTaskCategoryGroup(task, phaseKey)
            : getPrepTaskStationDisplayLabel(task);
    };

    const buildFocusedPrepTaskDetail = (task, {
        source = '',
        selectedStep = '',
        selectedStepKey = ''
    } = {}) => {
        if (!task) return null;
        const taskSessionDetail = buildPrepTaskSessionDetail({
            task,
            sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
            fallbackOwner: prepOperatorLabel
        });
        const displayTaskName = formatPrepDisplayName(task?.name || '');
        const ingredientRows = Array.isArray(prepJobIngredientDrafts?.[String(task?.id || '').trim()])
            ? prepJobIngredientDrafts[String(task?.id || '').trim()]
            : [];
        const taskRows = getDisplayPrepTaskRows(task, ingredientRows);
        const executionSteps = taskRows.map((row) => row.taskName).filter(Boolean);
        const storageMeta = getWorkflow2PrepStorageMeta(task);
        const prepIntelligenceRows = getWorkflow2PrepIntelligenceRows(task);
        const foodSafetyChecks = getWorkflow2PrepFoodSafetyCcp(task);
        const skillLevels = getPrepTaskSkillLevels(task);
        const chosenStep = String(selectedStep || '').trim();
        const selectedTaskRow = taskRows.find((row) => {
            const rowId = String(row?.id || '').trim();
            return (selectedStepKey && rowId === String(selectedStepKey).trim())
                || (chosenStep && String(row?.taskName || '').trim() === chosenStep);
        }) || null;
        const detailStep = chosenStep || executionSteps[0] || compactPrepCopy(task?.reasons?.[0] || 'Prep task', 100);
        const sourceLabel = getPrepFocusSourceLabel(task, source);
        const rowSupportNotes = buildPrepTaskRowSupportNotes(selectedTaskRow ? [selectedTaskRow] : taskRows);
        return buildPrepBoardDetail({
            title: displayTaskName,
            badge: getPrepTaskStationDisplayLabel(task) || getPrepWindowLabel(task),
            type: taskSessionDetail?.isCompleted ? 'good' : ((isDependencyBlocked(task) || task?.isOverdueRisk) ? 'alert' : 'warm'),
            source: [sourceLabel, getPrepTaskRecipeCategoryLabel(task)].filter(Boolean).join(' / '),
            summary: getPrepTaskRecipeCategoryLabel(task),
            detail: detailStep,
            prepEstimate: getPrepEstimateLabel(task),
            portionSummary: getPrepPortionSummary(task),
            portionMeta: getPrepPortionMeta(task),
            storageLife: storageMeta.label || getPrepStorageLifeLabel(task),
            chips: [
                selectedTaskRow?.quantityText || '',
                task?.context_tags?.cuisine || ''
            ].filter(Boolean),
            notes: [...rowSupportNotes, ...buildPrepTaskIntelligenceNotes(task)].slice(0, 5),
            executionSteps,
            taskRows,
            checklist: [],
            criticalChecks: (getWorkflow2PrepCriticalChecks(task).length > 0 ? getWorkflow2PrepCriticalChecks(task) : (Array.isArray(task?.critical_checks) ? task.critical_checks.slice(0, 4) : [])),
            foodSafetyChecks,
            equipment: getScaledEquipmentDetails(task),
            prepIntelligenceRows,
            taskId: task?.id || '',
            taskRecipeKey: task?.recipeKey || '',
            selectedStepKey,
            recipeCategory: getPrepTaskRecipeCategoryLabel(task),
            storageLabel: storageMeta.label,
            storageShelfLifeHours: storageMeta.shelfLifeHours !== null ? `${storageMeta.shelfLifeHours} hr` : '',
            skillLevels,
            ownerLabel: taskSessionDetail.ownerLabel,
            statusLabel: taskSessionDetail.statusLabel,
            completedBy: taskSessionDetail.completedBy,
            isCompleted: taskSessionDetail.isCompleted
        });
    };

    const openPrepTaskInFocus = (task, { source = '', selectedStep = '', selectedStepKey = '' } = {}) => {
        if (!task) return;
        ensurePrepJobIngredientsForTask(task);
        focusPrepRecipeFromBoard({
            recipeKey: String(task?.recipeKey || ''),
            recipeName: task?.name || '',
            message: `${formatPrepDisplayName(task?.name || 'Task')} moved into Chef Focus from ${getPrepFocusSourceLabel(task, source)}.`,
            tone: isDependencyBlocked(task) ? 'warn' : 'info',
            viewId: DASHBOARD_VIEWS.BOARD,
            detail: buildFocusedPrepTaskDetail(task, { source, selectedStep, selectedStepKey })
        });
    };

    const renderPrepRecipeCard = (task, taskIndex, sourceLabel = '') => {
        const isBlocked = isDependencyBlocked(task);
        const taskSessionDetail = buildPrepTaskSessionDetail({
            task,
            sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
            fallbackOwner: prepOperatorLabel
        });
        const isTaken = pickedPrepTaskIds.includes(String(task?.id || '').trim());
        const isCompleted = Boolean(taskSessionDetail?.isCompleted);
        const urgencyTone = getPrepTaskUrgencyTone(task);
        const statusClass = isCompleted
            ? 'done'
            : (isTaken ? 'selected' : (isBlocked ? 'blocked' : (taskIndex === 0 ? 'now' : '')));
        const displayTaskName = formatPrepDisplayName(task?.name || '');
        const ingredientRows = Array.isArray(prepJobIngredientDrafts?.[String(task?.id || '').trim()])
            ? prepJobIngredientDrafts[String(task?.id || '').trim()]
            : [];
        const detailTaskRows = getDisplayPrepTaskRows(task, ingredientRows);
        const taskRows = getPrepCardTaskRows(task, ingredientRows);
        const allRowsChecked = detailTaskRows.every((_, idx) => isPrepStepChecked(task.id, idx));
        const isFocused = String(prepBoardDetail?.taskId || '') === String(task.id);
        const focusPrepTask = (selectedStep = '') => {
            openPrepTaskInFocus(task, { source: sourceLabel, selectedStep });
        };

        return (
            <article
                className={`prep-task-card ${statusClass} ${allRowsChecked ? 'all-checked' : ''} ${isFocused ? 'is-focused-detail' : ''} urgency-${urgencyTone}`.trim()}
                key={task.id || `${sourceLabel}-${taskIndex}`}
                aria-label={`${displayTaskName} prep task card.`}
            >
                {isFocused ? (
                    <button
                        type="button"
                        className="task-box-close-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            handleClosePrepContext();
                        }}
                        title="Close focus"
                    >
                        &ndash;
                    </button>
                ) : null}
                <button
                    type="button"
                    className="prep-task-header prep-card-button"
                    onClick={() => focusPrepTask()}
                >
                    <div className="task-card-top">
                        {isCompleted ? <div className="task-selected-badge">Done</div> : (isTaken ? <div className="task-selected-badge">Taken</div> : null)}
                    </div>
                    <div className="task-main-row">
                        <div className="task-main">{displayTaskName}</div>
                    </div>
                </button>
                <div className="task-action-list" aria-label={`${displayTaskName} prep tasks`}>
                    {taskRows.map((row, rowIndex) => {
                        const sourceIndexes = Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0
                            ? row.sourceIndexes
                            : [];
                        const isBoundToStep = sourceIndexes.length > 0;
                        const isChecked = isBoundToStep ? arePrepStepIndexesChecked(task.id, sourceIndexes) : false;
                        const rowMeta = buildPrepTaskRowContext(row, { includeHold: false, maxParts: 3 });
                        return (
                            <div
                                className={`task-action-card ${isChecked ? 'checked' : ''} ${allRowsChecked ? 'all-checked' : ''} ${isCompleted ? 'done' : (isTaken ? 'selected' : '')} ${!isBoundToStep ? 'unbound' : ''}`.trim()}
                                key={`${task.id}-wf2-row-${row.id || rowIndex}`}
                            >
                                <button
                                    type="button"
                                    className={`task-bullet-checkbox ${isChecked ? 'checked' : ''}`.trim()}
                                    aria-pressed={isChecked}
                                    aria-label={`${isBoundToStep ? (isChecked ? 'Uncheck' : 'Check') : 'Review only'} ${row.taskName}`}
                                    onClick={() => {
                                        if (!isBoundToStep) return;
                                        togglePrepStepGroupChecked(task.id, sourceIndexes);
                                    }}
                                    disabled={!isBoundToStep}
                                />
                                <button
                                    type="button"
                                    className="task-action-main prep-card-button"
                                    onClick={() => focusPrepTask(row.taskName)}
                                >
                                    <span className="task-action-copy">
                                        <span className="task-bullet-item">{row.taskName}</span>
                                        {rowMeta ? <span className="task-action-context">{rowMeta}</span> : null}
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </article>
        );
    };

    const getSavedPrepCardTaskRowsForPhase = (detailRows = []) => {
        const normalizedRows = (Array.isArray(detailRows) ? detailRows : [])
            .map((row, index) => ({
                ...row,
                id: row?.id || `saved-prep-row-${index}`,
                taskName: shortenPrepCardLine(row?.taskName || ''),
                sourceIndexes: Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0 ? row.sourceIndexes : [index]
            }))
            .filter((row) => row.taskName);

        if (normalizedRows.length <= 4) return normalizedRows;

        const targetGroups = 4;
        const chunkSize = Math.ceil(normalizedRows.length / targetGroups);
        const summarizedRows = [];
        for (let index = 0; index < normalizedRows.length; index += chunkSize) {
            const chunk = normalizedRows.slice(index, index + chunkSize);
            const summaryRow = summarizePrepCardChunk(chunk, summarizedRows.length);
            if (summaryRow) summarizedRows.push(summaryRow);
        }
        return summarizedRows.slice(0, 4);
    };

    const renderSavedPrepPlanCard = (row, rowIndex, sourceLabel = '', { taskFirst = false } = {}) => {
        if (!row?.recipeKey) return null;
        const plannedTask = buildSavedPrepPlanTask(row);
        const planWindowLabel = String(getPrepWindowLabel(plannedTask) || sourceLabel || 'Saved prep').trim();
        const cardMeta = [row?.planMode === 'rotatePrep' ? 'Rotate prep' : 'Prep this week', planWindowLabel].filter(Boolean).join(' / ');
        const cardDetail = [formatPrepPlanDaySummary({ days: row?.plan?.days, anyDay: row?.plan?.anyDay }), row?.count || 'No target'].filter(Boolean).join(' / ');
        const ingredientRows = buildPrepJobIngredientRows(row?.recipe || {});
        const allDetailTaskRows = getDisplayPrepTaskRows(plannedTask, ingredientRows);
        const detailTaskRows = Array.isArray(row?.filteredTaskRows) && row.filteredTaskRows.length > 0
            ? row.filteredTaskRows
            : allDetailTaskRows;
        const taskRows = getSavedPrepCardTaskRowsForPhase(detailTaskRows);
        const previewDetail = buildFocusedPrepTaskDetail(plannedTask, { source: sourceLabel || planWindowLabel });
        const primaryTaskName = String(row?.primaryTaskName || taskRows?.[0]?.taskName || '').trim();
        const headerTitle = taskFirst && primaryTaskName ? primaryTaskName : row.title;
        const headerMeta = taskFirst ? row.title : cardMeta;
        const headerDetail = taskFirst ? '' : cardDetail;
        const selectedStepKey = String(row?.primaryTaskRowId || taskRows?.[0]?.id || rowIndex).trim();
        const selectedStep = taskFirst ? primaryTaskName : '';
        const savedCheckTarget = getSavedPrepCheckTarget(row);
        const isSavedChecked = arePrepStepIndexesChecked(savedCheckTarget.taskId, savedCheckTarget.stepIndexes);
        const toggleSavedCheck = (event) => {
            event.stopPropagation();
            togglePrepStepGroupChecked(savedCheckTarget.taskId, savedCheckTarget.stepIndexes);
        };

        return (
            <article
                className={`prep-task-card planned-preview ${taskFirst ? 'planned-preview--task-first' : ''} ${isSavedChecked ? 'all-checked' : ''} ${row.recipeKey === activeRecipeKey ? 'is-focused-detail' : ''} ${row?.plan?.urgent ? 'urgency-high' : ''}`.trim()}
                key={`${row.recipeKey}-${rowIndex}-${sourceLabel}`}
            >
                {taskFirst ? (
                    <button
                        type="button"
                        className={`task-bullet-checkbox saved-task-checkbox ${isSavedChecked ? 'checked' : ''}`.trim()}
                        aria-pressed={isSavedChecked}
                        aria-label={`${isSavedChecked ? 'Uncheck' : 'Check'} ${headerTitle}`}
                        onClick={toggleSavedCheck}
                    />
                ) : null}
                <button
                    type="button"
                    className="prep-task-header prep-card-button"
                    onClick={() => {
                        focusPrepRecipeFromBoard({
                            recipeKey: row.recipeKey,
                            recipeName: row.title,
                            message: `${row.title} moved into Chef Focus from ${sourceLabel || planWindowLabel}.`,
                            tone: row?.plan?.urgent ? 'warn' : 'info',
                            viewId: DASHBOARD_VIEWS.BOARD,
                            detail: {
                                ...previewDetail,
                                badge: row?.plan?.urgent ? 'Urgent plan' : 'Planned preview',
                                type: row?.plan?.urgent ? 'alert' : 'good',
                                source: [sourceLabel || planWindowLabel, 'Prep plan preview'].filter(Boolean).join(' / '),
                                summary: row.meta || row.detail || 'Saved prep plan',
                                detail: taskFirst && selectedStep
                                    ? selectedStep
                                    : `${row.title} is saved in the prep plan for ${planWindowLabel.toLowerCase()}.`,
                                executionSteps: detailTaskRows.map((item) => item.taskName).filter(Boolean),
                                taskRows: detailTaskRows,
                                chips: [row.quantityLabel || row.count || '', row?.plan?.urgent ? 'Urgent' : '', planWindowLabel, 'Preview'].filter(Boolean),
                                selectedStepKey,
                                notes: [
                                    'This recipe is already saved into the prep plan.',
                                    'These are planned preview steps from Workflow 2, not live generated execution tasks.'
                                ]
                            }
                        });
                    }}
                >
                    {!taskFirst ? (
                        <div className="task-card-top">
                            <div className="task-selected-badge task-selected-badge--compact">
                                {row?.plan?.urgent ? 'Urgent plan' : 'Planned preview'}
                            </div>
                            <div className="task-time">{row.count}</div>
                        </div>
                    ) : null}
                    <div className="task-main-row">
                        <div className="task-main">{headerTitle}</div>
                        <div className="task-meta">{headerMeta}</div>
                        {headerDetail ? <div className="task-detail">{headerDetail}</div> : null}
                    </div>
                </button>
                {!taskFirst ? (
                <div className="task-action-list" aria-label={`${row.title} planned prep tasks`}>
                    {taskRows.map((taskRow, taskRowIndex) => (
                        (() => {
                            const taskRowMeta = buildPrepTaskRowContext(taskRow, { includeHold: false, maxParts: 3 });
                            return (
                        <div
                            className={`task-action-card task-action-card--preview ${arePrepStepIndexesChecked(plannedTask.id, taskRow.sourceIndexes) ? 'checked' : ''}`.trim()}
                            key={`${plannedTask.id}-preview-row-${taskRow.id || taskRowIndex}`}
                        >
                            <button
                                type="button"
                                className={`task-bullet-checkbox ${arePrepStepIndexesChecked(plannedTask.id, taskRow.sourceIndexes) ? 'checked' : ''}`.trim()}
                                aria-pressed={arePrepStepIndexesChecked(plannedTask.id, taskRow.sourceIndexes)}
                                aria-label={`${arePrepStepIndexesChecked(plannedTask.id, taskRow.sourceIndexes) ? 'Uncheck' : 'Check'} ${taskRow.taskName}`}
                                onClick={() => togglePrepStepGroupChecked(plannedTask.id, taskRow.sourceIndexes)}
                            />
                            <button
                                type="button"
                                className="task-action-main prep-card-button"
                                onClick={() => {
                                    const rowFocusKey = String(taskRow?.id || taskRowIndex).trim();
                                    focusPrepRecipeFromBoard({
                                        recipeKey: row.recipeKey,
                                        recipeName: row.title,
                                        message: `${row.title} moved into Chef Focus from ${sourceLabel || planWindowLabel}.`,
                                        tone: row?.plan?.urgent ? 'warn' : 'info',
                                        viewId: DASHBOARD_VIEWS.BOARD,
                                        detail: {
                                            ...buildFocusedPrepTaskDetail(plannedTask, {
                                                source: sourceLabel || planWindowLabel,
                                                selectedStep: taskRow.taskName,
                                                selectedStepKey: rowFocusKey
                                            }),
                                            executionSteps: detailTaskRows.map((item) => item.taskName).filter(Boolean),
                                            taskRows: detailTaskRows
                                        }
                                    });
                                }}
                            >
                                <span className="task-action-copy">
                                    <span className="task-bullet-item">{taskRow.taskName}</span>
                                    <span className="task-action-context task-action-context--preview">
                                        {taskRowMeta || (detailTaskRows.length > 0 ? 'Workflow 2 planned step preview' : 'Saved prep plan preview')}
                                    </span>
                                </span>
                            </button>
                        </div>
                            );
                        })()
                    ))}
                </div>
                ) : null}
            </article>
        );
    };

    const renderPrepTaskModeRow = (task, row, rowIndex, sourceLabel = '') => {
        const displayTaskName = formatPrepDisplayName(task?.name || '');
        const sourceIndexes = Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0
            ? row.sourceIndexes
            : [rowIndex];
        const isChecked = arePrepStepIndexesChecked(task.id, sourceIndexes);
        const rowFocusKey = String(row?.id || rowIndex).trim();
        const isFocused = String(prepBoardDetail?.taskId || '') === String(task.id)
            && String(prepBoardDetail?.selectedStepKey || '').trim() === rowFocusKey;
        const rowMeta = buildPrepTaskRowContext({
            ...row,
            station: String(row?.station || '').trim() || getPrepTaskStationDisplayLabel(task),
            category: row?.category || getPrepTaskRecipeCategoryLabel(task)
        }, { includeHold: false, maxParts: 4 });

        return (
            <div
                className={`task-action-card task-action-card--task-mode ${isChecked ? 'checked' : ''} ${isFocused ? 'selected' : ''}`.trim()}
                key={`${task.id}-task-mode-${row.id || rowIndex}`}
            >
                <button
                    type="button"
                    className={`task-bullet-checkbox ${isChecked ? 'checked' : ''}`.trim()}
                    aria-pressed={isChecked}
                    aria-label={`${isChecked ? 'Uncheck' : 'Check'} ${row.taskName}`}
                    onClick={() => togglePrepStepGroupChecked(task.id, sourceIndexes)}
                />
                <button
                    type="button"
                    className="task-action-main prep-card-button"
                    onClick={() => openPrepTaskInFocus(task, {
                        source: sourceLabel,
                        selectedStep: row.taskName,
                        selectedStepKey: rowFocusKey
                    })}
                >
                    <span className="task-action-copy">
                        <span className="task-bullet-item">{row.taskName}</span>
                        <span className="task-action-context task-action-context--recipe">{displayTaskName}</span>
                        {rowMeta ? <span className="task-action-context">{rowMeta}</span> : null}
                    </span>
                </button>
            </div>
        );
    };

    const updatePrepTaskSession = (task, { claim = false, completeState = null } = {}) => {
        const taskId = String(task?.id || '').trim();
        const recipeKey = String(task?.recipeKey || '').trim();
        if (!taskId || !recipeKey) return;

        const nowIso = new Date().toISOString();
        setPrepExecutionSessions((prev) => {
            const existingSession = prev?.[recipeKey] || {
                recipeKey,
                recipeName: task?.name || 'Recipe',
                startedAt: nowIso,
                lastStartedAt: nowIso,
                startCount: 0,
                lastAction: 'task_update',
                lastPlanMode: 'none'
            };
            const taskProgress = existingSession?.taskProgress && typeof existingSession.taskProgress === 'object'
                ? existingSession.taskProgress
                : {};
            const existingTaskState = taskProgress[taskId] || {};
            const nextTaskState = {
                ...existingTaskState,
                ownerLabel: claim ? prepOperatorLabel : (existingTaskState.ownerLabel || prepOperatorLabel),
                claimedAt: claim ? (existingTaskState.claimedAt || nowIso) : (existingTaskState.claimedAt || ''),
                completedAt: completeState === null ? (existingTaskState.completedAt || '') : (completeState ? nowIso : ''),
                completedBy: completeState === null ? (existingTaskState.completedBy || '') : (completeState ? prepOperatorLabel : ''),
                lastUpdatedAt: nowIso
            };

            return {
                ...prev,
                [recipeKey]: {
                    ...existingSession,
                    lastAction: completeState === null ? 'claim_task' : (completeState ? 'complete_task' : 'reopen_task'),
                    lastTaskId: taskId,
                    lastTaskName: task?.name || '',
                    taskProgress: {
                        ...taskProgress,
                        [taskId]: nextTaskState
                    }
                }
            };
        });
    };

    const handleClaimPrepTask = () => {
        const taskId = String(prepBoardDetail?.taskId || '').trim();
        const task = (productionPlan?.tasks || []).find((entry) => String(entry?.id || '') === taskId);
        if (!task) return;

        updatePrepTaskSession(task, { claim: true });
        setPrepBoardDetail((prev) => prev ? {
            ...prev,
            ownerLabel: prepOperatorLabel,
            statusLabel: prev.isCompleted ? 'Completed' : 'Owned',
            chips: [...new Set([...(prev.chips || []), `Owner ${prepOperatorLabel}`])]
        } : prev);
        setPrepActionNotice({
            tone: 'success',
            message: `${formatPrepDisplayName(task?.name || 'Task')} is now owned by ${prepOperatorLabel}.`
        });
    };

    const handleCompletePrepTask = () => {
        const taskId = String(prepBoardDetail?.taskId || '').trim();
        const task = (productionPlan?.tasks || []).find((entry) => String(entry?.id || '') === taskId);
        if (!task) return;

        const nextCompletedState = !Boolean(prepBoardDetail?.isCompleted);
        updatePrepTaskSession(task, { claim: true, completeState: nextCompletedState });
        setPrepBoardDetail(buildFocusedPrepTaskDetail(task, {
            source: prepBoardDetail?.source || '',
            selectedStep: prepBoardDetail?.detail || ''
        }));
        setPrepActionNotice({
            tone: 'success',
            message: nextCompletedState
                ? `${formatPrepDisplayName(task?.name || 'Task')} marked complete by ${prepOperatorLabel}.`
                : `${formatPrepDisplayName(task?.name || 'Task')} moved back to not complete.`
        });
    };

    const registerPrepTaskStart = (taskIds = []) => {
        const taskIdSet = new Set(
            (Array.isArray(taskIds) ? taskIds : [])
                .map((taskId) => String(taskId || '').trim())
                .filter(Boolean)
        );
        if (!taskIdSet.size) return;
        (productionPlan?.tasks || []).forEach((task) => {
            const taskId = String(task?.id || '').trim();
            if (!taskIdSet.has(taskId)) return;
            updatePrepTaskSession(task, { claim: true });
        });
    };

    const applyTakenPrepTaskIds = (taskIds = [], {
        replace = false,
        notice = ''
    } = {}) => {
        const validTaskIds = [...new Set(
            (Array.isArray(taskIds) ? taskIds : [])
                .map((taskId) => String(taskId || '').trim())
                .filter(Boolean)
        )];
        if (!validTaskIds.length && !replace) return;

        let addedTaskIds = [];
        setPickedPrepTaskIds((previous) => {
            const previousIds = Array.isArray(previous) ? previous : [];
            const nextIds = replace
                ? validTaskIds
                : [...new Set([...previousIds, ...validTaskIds])];
            addedTaskIds = nextIds.filter((taskId) => !previousIds.includes(taskId));
            if (replace) return validTaskIds;
            return nextIds;
        });
        if (addedTaskIds.length > 0) {
            registerPrepTaskStart(addedTaskIds);
        }

        if (notice) {
            setPrepActionNotice({
                tone: 'info',
                message: notice
            });
        }
    };

    const removeTakenPrepTaskIds = (taskIds = [], notice = '') => {
        const taskIdSet = new Set(
            (Array.isArray(taskIds) ? taskIds : [])
                .map((taskId) => String(taskId || '').trim())
                .filter(Boolean)
        );
        if (!taskIdSet.size) return;
        setPickedPrepTaskIds((previous) => previous.filter((taskId) => !taskIdSet.has(String(taskId || '').trim())));
        if (notice) {
            setPrepActionNotice({
                tone: 'info',
                message: notice
            });
        }
    };

    const handleTogglePickedPrepTask = () => {
        const taskId = String(prepBoardDetail?.taskId || '').trim();
        if (!taskId) return;

        const taskTitle = formatPrepDisplayName(prepBoardDetail?.title || 'Task');
        let nextPicked = [];
        let addedTask = false;
        setPickedPrepTaskIds((previous) => {
            const hasTask = previous.includes(taskId);
            addedTask = !hasTask;
            nextPicked = hasTask
                ? previous.filter((candidate) => candidate !== taskId)
                : [...previous, taskId];
            return nextPicked;
        });
        if (addedTask) {
            registerPrepTaskStart([taskId]);
        }
        setPrepFocusMode(PREP_FOCUS_MODES.PICKED);
        setPrepScheduleView(PREP_SCHEDULE_VIEWS.TODAY);
        setPrepActionNotice({
            tone: 'info',
            message: nextPicked.includes(taskId)
                ? `${taskTitle} taken for today's prep list.`
                : `${taskTitle} removed from today's taken list.`
        });
    };

    const handleTakeFirstPrepTask = () => {
        const firstTaskId = String(productionCommandLanes?.[0]?.taskId || '').trim();
        if (!firstTaskId) return;
        const firstTaskTitle = formatPrepDisplayName(productionCommandLanes?.[0]?.title || 'Task');
        applyTakenPrepTaskIds([firstTaskId], {
            notice: `${firstTaskTitle} added as the first taken task.`
        });
    };

    const handleTakeAllVisiblePrepTasks = () => {
        const taskIds = displayVisiblePrepTaskIds;
        if (!taskIds.length) return;
        const allSelected = taskIds.every((taskId) => pickedPrepTaskIds.includes(taskId));
        if (allSelected) {
            removeTakenPrepTaskIds(taskIds, `${taskIds.length} visible prep task${taskIds.length === 1 ? '' : 's'} cleared from today's taken list.`);
            return;
        }
        applyTakenPrepTaskIds(taskIds, {
            notice: `${taskIds.length} visible prep task${taskIds.length === 1 ? '' : 's'} added to today's taken list.`
        });
    };

    const handleClearTakenPrepTasks = () => {
        setPickedPrepTaskIds([]);
        setPrepActionNotice({
            tone: 'info',
            message: 'Today taken task list cleared.'
        });
    };

    const handleTakePrepLane = (tasks = [], laneLabel = 'Lane') => {
        const taskIds = (Array.isArray(tasks) ? tasks : [])
            .map((task) => String(task?.id || '').trim())
            .filter(Boolean);
        if (!taskIds.length) return;
        const allSelected = taskIds.every((taskId) => pickedPrepTaskIds.includes(taskId));
        if (allSelected) {
            removeTakenPrepTaskIds(taskIds, `${taskIds.length} task${taskIds.length === 1 ? '' : 's'} cleared from ${laneLabel}.`);
            return;
        }
        applyTakenPrepTaskIds(taskIds, {
            notice: `${taskIds.length} task${taskIds.length === 1 ? '' : 's'} taken from ${laneLabel}.`
        });
    };

    const isPrepStepChecked = (taskId, stepIndex) => (
        Boolean(prepTaskStepChecks[`${String(taskId || '').trim()}::${Number(stepIndex)}`])
    );

    const arePrepStepIndexesChecked = (taskId, stepIndexes = []) => {
        const normalizedIndexes = [...new Set(
            (Array.isArray(stepIndexes) ? stepIndexes : [])
                .map((stepIndex) => Number(stepIndex))
                .filter((stepIndex) => Number.isInteger(stepIndex) && stepIndex >= 0)
        )];
        if (!normalizedIndexes.length) return false;
        return normalizedIndexes.every((stepIndex) => isPrepStepChecked(taskId, stepIndex));
    };

    const togglePrepStepGroupChecked = (taskId, stepIndexes = []) => {
        const normalizedTaskId = String(taskId || '').trim();
        const normalizedIndexes = [...new Set(
            (Array.isArray(stepIndexes) ? stepIndexes : [])
                .map((stepIndex) => Number(stepIndex))
                .filter((stepIndex) => Number.isInteger(stepIndex) && stepIndex >= 0)
        )];
        if (!normalizedTaskId || !normalizedIndexes.length) return;

        setPrepTaskStepChecks((previous) => {
            const next = { ...previous };
            const shouldCheck = !normalizedIndexes.every((stepIndex) => !!previous[`${normalizedTaskId}::${stepIndex}`]);
            normalizedIndexes.forEach((stepIndex) => {
                next[`${normalizedTaskId}::${stepIndex}`] = shouldCheck;
            });

            const task = (productionPlan?.tasks || []).find((t) => String(t.id) === normalizedTaskId);
            if (task) {
                const taskBullets = getPrepBoardTaskBullets(task);
                const displayedBullets = taskBullets.length > 0 ? taskBullets : [''];
                const allChecked = displayedBullets.every((_, idx) => !!next[`${normalizedTaskId}::${idx}`]);

                const taskSession = buildPrepTaskSessionDetail({
                    task,
                    sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                    fallbackOwner: prepOperatorLabel
                });

                if (allChecked && !taskSession.isCompleted) {
                    updatePrepTaskSession(task, { claim: true, completeState: true });
                } else if (!allChecked && taskSession.isCompleted) {
                    updatePrepTaskSession(task, { claim: true, completeState: false });
                }
            }

            return next;
        });
    };

    const togglePrepStepChecked = (taskId, stepIndex) => {
        const stepKey = `${String(taskId || '').trim()}::${Number(stepIndex)}`;
        if (!String(taskId || '').trim()) return;

        setPrepTaskStepChecks((previous) => {
            const next = {
                ...previous,
                [stepKey]: !previous[stepKey]
            };

            // Auto-complete logic: check if all bullets for this task are now checked
            const task = (productionPlan?.tasks || []).find((t) => String(t.id) === String(taskId));
            if (task) {
                const taskBullets = getPrepBoardTaskBullets(task);
                const displayedBullets = taskBullets.length > 0 ? taskBullets : ['']; 
                const allChecked = displayedBullets.every((_, idx) => !!next[`${String(taskId)}::${idx}`]);
                
                const taskSession = buildPrepTaskSessionDetail({
                    task,
                    sessionSnapshot: prepExecutionSessions?.[task?.recipeKey] || null,
                    fallbackOwner: prepOperatorLabel
                });

                if (allChecked && !taskSession.isCompleted) {
                    updatePrepTaskSession(task, { claim: true, completeState: true });
                } else if (!allChecked && taskSession.isCompleted) {
                    // Optional: un-complete if a box is unticked? User said: 
                    // "however it can be ticked by mistake so it still stay in there so user can untick the check box then goes back to previous colour box."
                    updatePrepTaskSession(task, { claim: true, completeState: false });
                }
            }

            return next;
        });
    };

    const getSavedPrepCheckTarget = (row = {}) => {
        const taskId = `saved-plan-${String(row?.recipeKey || row?.title || '').trim()}`;
        const taskRows = Array.isArray(row?.filteredTaskRows) && row.filteredTaskRows.length > 0
            ? row.filteredTaskRows
            : [];
        const stepIndexes = taskRows.flatMap((taskRow, taskRowIndex) => (
            Array.isArray(taskRow?.sourceIndexes) && taskRow.sourceIndexes.length > 0
                ? taskRow.sourceIndexes
                : [taskRowIndex]
        ));
        return {
            taskId,
            stepIndexes: [...new Set(stepIndexes.map((index) => Number(index)).filter((index) => Number.isInteger(index) && index >= 0))]
        };
    };

    const isSavedPrepRowChecked = (row = {}) => {
        const target = getSavedPrepCheckTarget(row);
        return arePrepStepIndexesChecked(target.taskId, target.stepIndexes);
    };

    const areSavedPrepRowsChecked = (rows = []) => {
        const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => {
            const target = getSavedPrepCheckTarget(row);
            return target.taskId && target.stepIndexes.length > 0;
        });
        return visibleRows.length > 0 && visibleRows.every((row) => isSavedPrepRowChecked(row));
    };

    const toggleSavedPrepRowsDone = (rows = [], laneLabel = 'Lane') => {
        const visibleRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
        const targets = visibleRows
            .map((row) => getSavedPrepCheckTarget(row))
            .filter((target) => target.taskId && target.stepIndexes.length > 0);
        if (!targets.length) return;

        const shouldCheck = !areSavedPrepRowsChecked(visibleRows);
        setPrepTaskStepChecks((previous) => {
            const next = { ...previous };
            targets.forEach((target) => {
                target.stepIndexes.forEach((stepIndex) => {
                    next[`${target.taskId}::${stepIndex}`] = shouldCheck;
                });
            });
            return next;
        });
        setPrepActionNotice({
            tone: shouldCheck ? 'success' : 'info',
            message: shouldCheck
                ? `${targets.length} prep task${targets.length === 1 ? '' : 's'} marked done in ${laneLabel}.`
                : `${targets.length} prep task${targets.length === 1 ? '' : 's'} reopened in ${laneLabel}.`
        });
    };

    const getLivePrepLaneCheckTargets = (tasks = []) => (
        (Array.isArray(tasks) ? tasks : []).flatMap((task) => {
            const taskId = String(task?.id || '').trim();
            if (!taskId) return [];
            const taskRows = getPrepBoardTaskRows(task);
            const stepIndexes = taskRows.flatMap((row, rowIndex) => (
                Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0
                    ? row.sourceIndexes
                    : [rowIndex]
            ));
            return [{
                taskId,
                stepIndexes: [...new Set(stepIndexes.map((index) => Number(index)).filter((index) => Number.isInteger(index) && index >= 0))]
            }];
        }).filter((target) => target.taskId && target.stepIndexes.length > 0)
    );

    const areLivePrepLaneRowsChecked = (tasks = []) => {
        const targets = getLivePrepLaneCheckTargets(tasks);
        return targets.length > 0 && targets.every((target) => arePrepStepIndexesChecked(target.taskId, target.stepIndexes));
    };

    const toggleLivePrepLaneDone = (tasks = [], laneLabel = 'Lane') => {
        const targets = getLivePrepLaneCheckTargets(tasks);
        if (!targets.length) return;
        const shouldCheck = !areLivePrepLaneRowsChecked(tasks);
        setPrepTaskStepChecks((previous) => {
            const next = { ...previous };
            targets.forEach((target) => {
                target.stepIndexes.forEach((stepIndex) => {
                    next[`${target.taskId}::${stepIndex}`] = shouldCheck;
                });
            });
            return next;
        });
        setPrepActionNotice({
            tone: shouldCheck ? 'success' : 'info',
            message: shouldCheck
                ? `${targets.length} prep task${targets.length === 1 ? '' : 's'} marked done in ${laneLabel}.`
                : `${targets.length} prep task${targets.length === 1 ? '' : 's'} reopened in ${laneLabel}.`
        });
    };

    const getLiveTaskModeCheckTargets = (items = []) => (
        (Array.isArray(items) ? items : []).flatMap((item) => {
            const taskId = String(item?.task?.id || '').trim();
            if (!taskId) return [];
            const sourceIndexes = Array.isArray(item?.row?.sourceIndexes) && item.row.sourceIndexes.length > 0
                ? item.row.sourceIndexes
                : [item?.rowIndex];
            const stepIndexes = [...new Set(sourceIndexes.map((index) => Number(index)).filter((index) => Number.isInteger(index) && index >= 0))];
            return stepIndexes.length > 0 ? [{ taskId, stepIndexes }] : [];
        })
    );

    const areLiveTaskModeItemsChecked = (items = []) => {
        const targets = getLiveTaskModeCheckTargets(items);
        return targets.length > 0 && targets.every((target) => arePrepStepIndexesChecked(target.taskId, target.stepIndexes));
    };

    const toggleLiveTaskModeItemsDone = (items = [], laneLabel = 'Lane') => {
        const targets = getLiveTaskModeCheckTargets(items);
        if (!targets.length) return;
        const shouldCheck = !areLiveTaskModeItemsChecked(items);
        setPrepTaskStepChecks((previous) => {
            const next = { ...previous };
            targets.forEach((target) => {
                target.stepIndexes.forEach((stepIndex) => {
                    next[`${target.taskId}::${stepIndex}`] = shouldCheck;
                });
            });
            return next;
        });
        setPrepActionNotice({
            tone: shouldCheck ? 'success' : 'info',
            message: shouldCheck
                ? `${targets.length} prep task${targets.length === 1 ? '' : 's'} marked done in ${laneLabel}.`
                : `${targets.length} prep task${targets.length === 1 ? '' : 's'} reopened in ${laneLabel}.`
        });
    };

    const handleClosePrepContext = () => {
        setPrepBoardPhase('');
        setPrepBoardGrouping(PREP_BOARD_GROUPINGS.STATION);
        setPrepExpandedDayView(false);
        setPrepBoardDetail(null);
        setPrepFocusMode(PREP_FOCUS_MODES.BOARD);
    };

    const handlePrepScheduleViewSelect = (nextView, detail = null, selectedWeekday = null) => {
        setPrepScheduleView(nextView);
        if (nextView === PREP_SCHEDULE_VIEWS.TODAY) {
            setPrepFocusMode(PREP_FOCUS_MODES.BOARD);
        } else {
            setPrepFocusMode(PREP_FOCUS_MODES.BOARD);
            setPrepExpandedDayView(false);
        }
        if (nextView === PREP_SCHEDULE_VIEWS.TODAY) {
            setPrepScheduleDayFilter(
                Number.isInteger(selectedWeekday)
                    ? selectedWeekday
                    : (detail?.source === 'This week' ? getKitchenWeekdayIndex(new Date()) : null)
            );
        } else {
            setPrepScheduleDayFilter(null);
        }
        if (detail) {
            setPrepBoardDetail(detail);
        }
        const pressureBaseline = `Today ${prepCalendarSummary.todayCount} / Week ${prepCalendarSummary.weekCount} / Month ${prepCalendarSummary.monthCount}`;
        const viewCopy = nextView === PREP_SCHEDULE_VIEWS.MONTH
            ? `Month focus: ${prepCalendarSummary.monthCount} prep tasks in current cadence. ${pressureBaseline}.`
            : (nextView === PREP_SCHEDULE_VIEWS.WEEK
                ? `Week focus: ${prepCalendarSummary.weekCount} prep tasks in the next 7 days. ${pressureBaseline}.`
                : `Today focus: ${prepCalendarSummary.todayCount} prep tasks active now. ${pressureBaseline}.`);
        setPrepActionNotice({
            tone: 'info',
            message: viewCopy
        });
    };

    const handleOpenRecipeTruthFromPrep = () => {
        const selectedRecipe = ensurePrepRecipeSelection();
        if (selectedRecipe) {
            recordRecipeActivity(selectedRecipe.recipe, selectedRecipe.recipeKey);
        }
        activateWorkflowView(DASHBOARD_VIEWS.SCALER);
    };

    const handleOpenPrepSetupPage = () => {
        openPrepSetupModal();
    };

    const handlePrepSetupChipSelect = (chipKey) => {
        setPrepSetupActiveChip(chipKey);
        if (chipKey !== 'style') setPrepSetupStyleFilter('');
        if (chipKey !== 'cuisine') setPrepSetupCuisineFilter('');
        if (chipKey !== 'category') setPrepSetupCategoryFilter('');
        if (chipKey !== 'occasion') setPrepSetupOccasionFilter('');
    };

    const togglePrepSetupRecipeSelection = (recipeKey) => {
        if (!recipeKey) return;
        setPrepSetupSelectionMap((prev) => ({
            ...(prev || {}),
            [recipeKey]: !prev?.[recipeKey]
        }));
    };

    const setPrepSetupRecipeScale = (recipeKey, nextValue) => {
        if (!recipeKey) return;
        const rawValue = String(nextValue ?? '')
            .replace(/,/g, '.')
            .replace(/[^0-9.]/g, '')
            .replace(/(\..*)\./g, '$1');
        setPrepSetupScaleDrafts((prev) => ({
            ...(prev || {}),
            [recipeKey]: rawValue
        }));
        if (!rawValue || rawValue === '.') return;
        const normalized = normalizePrepSetupScaleValue(rawValue, prepSetupScaleOverrides?.[recipeKey]);
        setPrepSetupScaleOverrides((prev) => ({
            ...(prev || {}),
            [recipeKey]: normalized
        }));
    };

    const commitPrepSetupRecipeScale = (recipe, recipeKey) => {
        if (!recipeKey) return;
        const fallbackValue = getPrepSetupScaleValue(recipe, recipeKey);
        const draftValue = prepSetupScaleDrafts?.[recipeKey];
        const normalized = normalizePrepSetupScaleValue(draftValue, fallbackValue);
        setPrepSetupScaleOverrides((prev) => ({
            ...(prev || {}),
            [recipeKey]: normalized
        }));
        setPrepSetupScaleDrafts((prev) => {
            const next = { ...(prev || {}) };
            next[recipeKey] = String(normalized);
            return next;
        });
    };

    const selectCurrentRecipeForPrepSetup = () => {
        if (!activeRecipeKey) return;
        setPrepSetupSelectionMap((prev) => ({
            ...(prev || {}),
            [activeRecipeKey]: true
        }));
    };

    const selectVisiblePrepSetupRecipes = () => {
        if (!prepSetupVisibleKeys.length) return;
        setPrepSetupSelectionMap((prev) => {
            const next = { ...(prev || {}) };
            prepSetupVisibleKeys.forEach((recipeKey) => {
                next[recipeKey] = true;
            });
            return next;
        });
    };

    const clearVisiblePrepSetupRecipes = () => {
        if (!prepSetupVisibleKeys.length) return;
        setPrepSetupSelectionMap((prev) => {
            const next = { ...(prev || {}) };
            prepSetupVisibleKeys.forEach((recipeKey) => {
                delete next[recipeKey];
            });
            return next;
        });
    };

    const selectAllPrepSetupRecipes = () => {
        setPrepSetupSelectionMap(() => (
            (Array.isArray(visibleRecipes) ? visibleRecipes : []).reduce((acc, recipe, index) => {
                const recipeKey = getRecipeKey(recipe, `idx-${index}`);
                if (recipeKey) acc[recipeKey] = true;
                return acc;
            }, {})
        ));
    };

    const clearAllPrepSetupRecipes = () => {
        setPrepSetupSelectionMap({});
    };

    const togglePrepSetupDay = (dayIndex) => {
        setPrepSetupDays((prev) => (
            prev.includes(dayIndex)
                ? prev.filter((value) => value !== dayIndex)
                : [...prev, dayIndex].sort((left, right) => left - right)
        ));
    };

    const selectPrepSetupMode = (nextMode) => {
        if (!['prepThisWeek', 'rotatePrep', 'none'].includes(nextMode)) return;
        const prepSetupBaselinePlan = prepSetupPrimaryEntry
            ? (prepSetupPrimaryPlan || {})
            : (activePrepPlan || {});
        setPrepSetupMode((currentMode) => {
            const resolvedMode = currentMode === nextMode ? 'none' : nextMode;
            if (resolvedMode !== currentMode) {
                const defaultDay = getKitchenWeekdayIndex(new Date());
                const nextDays = Array.isArray(prepSetupBaselinePlan?.days) && prepSetupBaselinePlan.days.length > 0
                    ? prepSetupBaselinePlan.days
                    : (resolvedMode === 'none' ? [] : [defaultDay]);
                setPrepSetupDays(nextDays);
                setPrepSetupAnyDay(Boolean(resolvedMode === 'prepThisWeek' ? prepSetupBaselinePlan?.anyDay : false));
                setPrepSetupAuto(Boolean(resolvedMode === 'prepThisWeek' ? prepSetupBaselinePlan?.auto : false));
            }
            if (resolvedMode === 'none') {
                setPrepSetupAnyDay(false);
                setPrepSetupAuto(false);
            }
            return resolvedMode;
        });
    };

    const handleSubmitPrepSetupPlan = () => {
        const selectedEntries = prepSetupSelectedEntries;
        if (!selectedEntries.length || prepSetupMode === 'none') {
            setPrepActionNotice({
                tone: 'warning',
                message: 'Choose one or more recipes and a prep mode before saving.'
            });
            return;
        }

        const selectedDays = Array.isArray(prepSetupDays) ? prepSetupDays : [];
        const isRotate = prepSetupMode === 'rotatePrep';
        const hasValidDaySelection = isRotate ? selectedDays.length > 0 : (prepSetupAnyDay || selectedDays.length > 0);

        if (!hasValidDaySelection) {
            window.alert(isRotate
                ? 'Select at least one weekday for rotate prep before saving.'
                : 'Select at least one day or choose Any day before saving prep this week.');
            return;
        }

        const confirmed = window.confirm(
            `Add ${selectedEntries.length} recipe${selectedEntries.length === 1 ? '' : 's'} to ${prepSetupMode === 'rotatePrep' ? 'rotate prep' : 'prep this week'}?\n\n${selectedEntries
                .slice(0, 4)
                .map((entry) => `${entry.title} / ${entry.quantityLabel}`)
                .join('\n')}${selectedEntries.length > 4 ? `\n+ ${selectedEntries.length - 4} more` : ''}\n\n${formatPrepPlanDaySummary({
                days: prepSetupMode === 'prepThisWeek' && prepSetupAnyDay ? [] : selectedDays,
                anyDay: prepSetupMode === 'prepThisWeek' ? prepSetupAnyDay : false
            })}${prepSetupUrgent ? '\nUrgent' : ''}${prepSetupMode === 'prepThisWeek' && prepSetupAuto ? '\nAuto' : ''}`
        );
        if (!confirmed) return;

        const nextPlans = { ...(prepPlans || {}) };
        let savedCount = 0;
        selectedEntries.forEach((entry) => {
            const nextPlan = buildPrepPlanEntry({
                mode: prepSetupMode,
                recipe: entry.recipe,
                days: prepSetupMode === 'prepThisWeek' && prepSetupAnyDay ? [] : selectedDays,
                urgent: prepSetupUrgent,
                anyDay: prepSetupMode === 'prepThisWeek' ? prepSetupAnyDay : false,
                auto: prepSetupMode === 'prepThisWeek' ? prepSetupAuto : false,
                rotateMode: prepSetupMode === 'rotatePrep' ? prepSetupRotateMode : 'week',
                rotateCount: prepSetupMode === 'rotatePrep' ? Number(prepSetupRotateCount || 1) : 1,
                quantityOverride: entry.targetQuantity,
                existingPlan: nextPlans?.[entry.recipeKey]
            });
            if (!nextPlan) return;
            nextPlans[entry.recipeKey] = nextPlan;
            savedCount += 1;
            recordRecipeActivity(entry.recipe, entry.recipeKey);
        });

        if (!savedCount) {
            setPrepActionNotice({
                tone: 'error',
                message: 'Unable to save prep plan for the selected recipes.'
            });
            return;
        }

        persistPrepPlans(nextPlans);
        setPrepScheduleView(PREP_SCHEDULE_VIEWS.TODAY);
        setPrepScheduleDayFilter(getKitchenWeekdayIndex(new Date()));
        setPrepActionNotice({
            tone: 'success',
            message: `${savedCount} recipe${savedCount === 1 ? '' : 's'} saved to the prep board.`
        });
    };

    const handleQuickPrepPlanSave = (mode) => {
        const selectedRecipe = ensurePrepRecipeSelection();
        if (!selectedRecipe) {
            setPrepActionNotice({
                tone: 'warning',
                message: 'Choose a recipe from Recipe Truth before saving a prep plan.'
            });
            activateWorkflowView(DASHBOARD_VIEWS.SCALER);
            return;
        }

        recordRecipeActivity(selectedRecipe.recipe, selectedRecipe.recipeKey);

        const existingPlan = prepPlans?.[selectedRecipe.recipeKey] || {};
        const defaultDay = getKitchenWeekdayIndex(new Date());
        const nextMode = mode === 'rotatePrep' ? 'rotatePrep' : 'prepThisWeek';
        const selectedDays = Array.isArray(existingPlan?.days) && existingPlan.days.length > 0
            ? existingPlan.days
            : [defaultDay];
        const nextUrgent = Boolean(existingPlan?.urgent);
        const nextAnyDay = nextMode === 'prepThisWeek' ? Boolean(existingPlan?.anyDay) : false;
        const nextAuto = nextMode === 'prepThisWeek' ? Boolean(existingPlan?.auto) : false;
        const nextRotateMode = nextMode === 'rotatePrep' ? (existingPlan?.rotateMode || 'week') : 'week';
        const nextRotateCount = nextMode === 'rotatePrep' ? Number(existingPlan?.rotateCount || 1) : 1;
        const nextDaySummary = formatPrepPlanDaySummary({
            days: nextMode === 'prepThisWeek' && nextAnyDay ? [] : selectedDays,
            anyDay: nextAnyDay
        });
        const nextQuantity = getFirstFiniteNumber(
            dailyProduction?.[selectedRecipe.recipeKey],
            existingPlan?.quantity,
            selectedRecipe.recipe?.baseYield,
            selectedRecipe.recipe?.yield,
            0
        );
        const nextQuantityLabel = formatPrepTaskQuantity(
            Number(nextQuantity || 0),
            selectedRecipe.recipe?.unit || ''
        ) || 'No target';
        const nextSummary = nextMode === 'rotatePrep'
            ? `Rotate prep / ${nextRotateCount}x per ${nextRotateMode} / ${nextDaySummary}`
            : `Prep this week / ${nextDaySummary}${nextAuto ? ' / Auto' : ''}`;
        const existingSummary = existingPlan?.mode
            ? (existingPlan.mode === 'rotatePrep'
                ? `Current plan: Rotate prep / ${Number(existingPlan?.rotateCount || 1)}x per ${existingPlan?.rotateMode || 'week'} / ${formatPrepPlanDaySummary({ days: existingPlan?.days, anyDay: existingPlan?.anyDay })}`
                : `Current plan: Prep this week / ${formatPrepPlanDaySummary({ days: existingPlan?.days, anyDay: existingPlan?.anyDay })}${existingPlan?.auto ? ' / Auto' : ''}`)
            : 'No existing prep plan';
        const confirmed = window.confirm(
            `${existingSummary}\n\nSave new plan:\n${nextSummary}\nQty ${nextQuantityLabel}${nextUrgent ? '\nUrgent' : ''}`
        );
        if (!confirmed) {
            setPrepActionNotice({
                tone: 'info',
                message: 'Prep plan save canceled.'
            });
            return;
        }

        const saved = savePrepPlanForRecipe({
            mode: nextMode,
            recipe: selectedRecipe.recipe,
            days: nextMode === 'prepThisWeek' && nextAnyDay ? [] : selectedDays,
            urgent: nextUrgent,
            anyDay: nextAnyDay,
            auto: nextAuto,
            rotateMode: nextRotateMode,
            rotateCount: nextRotateCount
        });

        if (!saved) {
            setPrepActionNotice({
                tone: 'error',
                message: 'Unable to save prep plan from the prep board.'
            });
            return;
        }

        const scopedTasks = getPrepTasksForRecipe(selectedRecipe.recipe, selectedRecipe.recipeKey);
        const leadTask = scopedTasks.reduce((winner, task) => {
            if (!winner) return task;
            return compareTaskReadiness(task, winner) < 0 ? task : winner;
        }, null);
        const stationCount = new Set(
            scopedTasks
                .map((task) => String(task?.station || 'General Prep').trim() || 'General Prep')
                .filter(Boolean)
        ).size;
        setPrepScheduleView(PREP_SCHEDULE_VIEWS.TODAY);
        setPrepScheduleDayFilter(getKitchenWeekdayIndex(new Date()));
        setPrepBoardDetail(buildPrepBoardDetail({
            title: selectedRecipe.recipe?.name || 'Selected recipe',
            badge: nextMode === 'rotatePrep' ? 'Rotate saved' : 'Prep saved',
            type: scopedTasks.length > 0 ? 'good' : 'warm',
            source: nextMode === 'rotatePrep' ? 'Rotate prep' : 'Prep this week',
            summary: `${nextSummary} / Qty ${nextQuantityLabel}`,
            detail: scopedTasks.length > 0
                ? `${scopedTasks.length} prep task${scopedTasks.length === 1 ? '' : 's'} across ${stationCount} station${stationCount === 1 ? '' : 's'}. Start with ${formatPrepDisplayName(leadTask?.name || 'the top prep task')}.`
                : 'Plan saved, but no live prep tasks exist yet for this recipe. Check recipe truth and prep logic inputs.',
            chips: [
                'Today view',
                nextMode === 'rotatePrep' ? 'Rotate prep' : 'Prep this week',
                nextUrgent ? 'Urgent' : '',
                stationCount > 0 ? `${stationCount} station${stationCount === 1 ? '' : 's'}` : ''
            ],
            notes: scopedTasks.length > 0
                ? [
                    `Lead task: ${formatPrepDisplayName(leadTask?.name || 'Top prep task')}`,
                    getPrepCardActionSummary(leadTask || {}),
                    'Run the station lanes below in this saved-plan order.'
                ]
                : [
                    'Saved plan is active for this recipe.',
                    'Generate/repair recipe-truth-backed prep tasks before handoff.'
                ]
        }));
        activateWorkflowView(DASHBOARD_VIEWS.BOARD);
        setPrepActionNotice({
            tone: 'success',
            message: `${selectedRecipe.recipe?.name || 'Selected recipe'} saved to ${nextMode === 'rotatePrep' ? 'Rotate prep' : 'Prep this week'}.`
        });
    };

    const handlePrintStationList = () => {
        const selectedRecipe = ensurePrepRecipeSelection();
        if (!selectedRecipe) {
            setPrepActionNotice({
                tone: 'warning',
                message: 'Select a recipe from Recipe Truth before printing station tasks.'
            });
            activateWorkflowView(DASHBOARD_VIEWS.SCALER);
            return;
        }

        recordRecipeActivity(selectedRecipe.recipe, selectedRecipe.recipeKey);

        const scopedTasks = getPrepTasksForRecipe(selectedRecipe.recipe, selectedRecipe.recipeKey);
        if (!scopedTasks.length) {
            setPrepBoardDetail(buildPrepBoardDetail({
                title: selectedRecipe.recipe?.name || 'Selected recipe',
                badge: 'No tasks',
                type: 'warm',
                source: 'Print Station List',
                summary: 'No generated station tasks to print.',
                detail: 'Generate or repair recipe-truth-backed prep tasks first, then print the station list.',
                chips: ['Recipe truth'],
                notes: ['This action only prints tasks that are currently generated on the prep board.']
            }));
            setPrepActionNotice({
                tone: 'warning',
                message: `${selectedRecipe.recipe?.name || 'Selected recipe'} has no generated prep tasks yet.`
            });
            return;
        }

        const stationGroups = scopedTasks.reduce((acc, task) => {
            const station = String(task?.station || 'General Prep').trim() || 'General Prep';
            if (!acc[station]) acc[station] = [];
            acc[station].push(task);
            return acc;
        }, {});
        const stationEntries = Object.entries(stationGroups);
        const topStation = stationEntries
            .map(([station, tasks]) => ({ station, count: Array.isArray(tasks) ? tasks.length : 0 }))
            .sort((left, right) => (right.count - left.count) || String(left.station).localeCompare(String(right.station)))[0];

        const printableBody = Object.entries(stationGroups)
            .map(([station, tasks]) => {
                const stationTasks = tasks
                    .map((task, index) => `<li><strong>${escapeHtml(task?.name || `Task ${index + 1}`)}</strong> — Qty ${escapeHtml(Number(task?.targetYield || 0).toFixed(2))}${task?.unit ? ` ${escapeHtml(task.unit)}` : ''}</li>`)
                    .join('');
                return `<section><h2>${escapeHtml(station)}</h2><ul>${stationTasks}</ul></section>`;
            })
            .join('');

        const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720');
        if (!printWindow) {
            setPrepActionNotice({
                tone: 'error',
                message: 'Popup blocked. Allow popups to print station list.'
            });
            return;
        }

        printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(selectedRecipe.recipe?.name || 'Recipe')} Station List</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{margin-bottom:6px}h2{margin:18px 0 8px}ul{margin:0;padding-left:18px}li{margin:6px 0}</style></head><body><h1>${escapeHtml(selectedRecipe.recipe?.name || 'Selected Recipe')}</h1><p>Station prep list generated from recipe library truth.</p>${printableBody}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        window.setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 120);

        setPrepBoardDetail(buildPrepBoardDetail({
            title: selectedRecipe.recipe?.name || 'Selected recipe',
            badge: 'Printed',
            type: 'good',
            source: 'Print Station List',
            summary: `${scopedTasks.length} task${scopedTasks.length === 1 ? '' : 's'} across ${stationEntries.length} station${stationEntries.length === 1 ? '' : 's'}.`,
            detail: topStation
                ? `${topStation.station} has the heaviest print load (${topStation.count} task${topStation.count === 1 ? '' : 's'}).`
                : 'Station list printed from current prep-board truth.',
            chips: [
                stationEntries.length > 0 ? `${stationEntries.length} station${stationEntries.length === 1 ? '' : 's'}` : '',
                'Printed'
            ],
            notes: [
                'Print output is generated from current recipe-truth prep tasks.',
                'Re-print after recipe yield or plan changes to keep handoff aligned.'
            ]
        }));
        setPrepActionNotice({
            tone: 'success',
            message: `Printed station list for ${selectedRecipe.recipe?.name || 'selected recipe'}.`
        });
    };

    const openExportModal = () => {
        setExportNotice(null);
        setExportQuery('');
        setExportBulkScale(String(Math.max(1, scaleMultiplier)));
        setExportSelectionMap((prev) => {
            if (Object.values(prev || {}).some(Boolean)) return prev;
            if (!activeRecipeKey) return prev;
            return { [activeRecipeKey]: true };
        });
        setExportModalOpen(true);
    };

    const closeExportModal = () => {
        setExportModalOpen(false);
        if (exportPreviewWindowRef.current && !exportPreviewWindowRef.current.closed) {
            exportPreviewWindowRef.current.close();
        }
        exportPreviewWindowRef.current = null;
    };

    const openPrepSetupModal = () => {
        if (activeRecipe && activeRecipeKey) {
            recordRecipeActivity(activeRecipe, activeRecipeKey);
            setPrepSetupSelectionMap((prev) => ({ ...prev, [activeRecipeKey]: true }));
        }
        setView(DASHBOARD_VIEWS.SCALER);
        moveWorkflowFocus(DASHBOARD_VIEWS.SCALER);
        setPrepSetupModalOpen(true);
    };

    const closePrepSetupModal = () => {
        setPrepSetupModalOpen(false);
        setView(DASHBOARD_VIEWS.SCALER);
        moveWorkflowFocus(DASHBOARD_VIEWS.SCALER);
    };

    const toggleExportRecipeSelection = (recipeKey) => {
        if (!recipeKey) return;
        setExportSelectionMap((prev) => ({
            ...prev,
            [recipeKey]: !prev?.[recipeKey]
        }));
    };

    const setExportRecipeScale = (recipeKey, nextValue) => {
        if (!recipeKey) return;
        setExportScaleOverrides((prev) => ({
            ...prev,
            [recipeKey]: normalizeExportScaleValue(nextValue)
        }));
    };

    const selectAllExportRecipes = () => {
        const next = {};
        (Array.isArray(visibleRecipes) ? visibleRecipes : []).forEach((recipe, index) => {
            const recipeKey = getRecipeKey(recipe, `idx-${index}`);
            if (recipeKey) next[recipeKey] = true;
        });
        setExportSelectionMap(next);
    };

    const selectVisibleExportRecipes = () => {
        setExportSelectionMap((prev) => {
            const next = { ...prev };
            exportVisibleKeys.forEach((recipeKey) => {
                next[recipeKey] = true;
            });
            return next;
        });
    };

    const clearVisibleExportRecipes = () => {
        setExportSelectionMap((prev) => {
            const next = { ...prev };
            exportVisibleKeys.forEach((recipeKey) => {
                delete next[recipeKey];
            });
            return next;
        });
    };

    const selectCurrentRecipeForExport = () => {
        if (!activeRecipeKey) return;
        setExportSelectionMap({ [activeRecipeKey]: true });
    };

    const applyBulkScaleToSelectedRecipes = () => {
        const nextScale = normalizeExportScaleValue(exportBulkScale);
        const selectedKeys = Object.entries(exportSelectionMap || {})
            .filter(([, selected]) => Boolean(selected))
            .map(([recipeKey]) => recipeKey);
        if (!selectedKeys.length) {
            setExportNotice({ tone: 'warning', message: 'Select at least one recipe before applying a bulk scale.' });
            return;
        }
        setExportScaleOverrides((prev) => {
            const next = { ...prev };
            selectedKeys.forEach((recipeKey) => {
                next[recipeKey] = nextScale;
            });
            return next;
        });
        setExportNotice({ tone: 'success', message: `Applied x${nextScale} to ${selectedKeys.length} selected recipe${selectedKeys.length === 1 ? '' : 's'}.` });
    };

    const resetSelectedExportScalesToDefault = () => {
        const selectedKeys = new Set(
            Object.entries(exportSelectionMap || {})
                .filter(([, selected]) => Boolean(selected))
                .map(([recipeKey]) => recipeKey)
        );
        if (!selectedKeys.size) {
            setExportNotice({ tone: 'warning', message: 'Select at least one recipe before resetting scales.' });
            return;
        }
        setExportScaleOverrides((prev) => {
            const next = { ...prev };
            (Array.isArray(visibleRecipes) ? visibleRecipes : []).forEach((recipe, index) => {
                const recipeKey = getRecipeKey(recipe, `idx-${index}`);
                if (!recipeKey || !selectedKeys.has(recipeKey)) return;
                next[recipeKey] = getDefaultExportScaleForRecipe(recipe, recipeKey);
            });
            return next;
        });
        setExportNotice({ tone: 'success', message: 'Reset selected recipes back to their default export scale.' });
    };

    const buildSelectedRecipeExportPayloads = () => {
        const selectedEntries = (Array.isArray(visibleRecipes) ? visibleRecipes : [])
            .map((recipe, index) => ({
                recipe,
                recipeKey: getRecipeKey(recipe, `idx-${index}`)
            }))
            .filter((entry) => entry.recipeKey && exportSelectionMap?.[entry.recipeKey]);

        if (!selectedEntries.length) {
            setExportNotice({ tone: 'warning', message: 'Select one or more recipes before exporting.' });
            return [];
        }

        return selectedEntries.map(({ recipe, recipeKey }) => {
            const multiplier = getRecipeExportScaleValue(recipe, recipeKey);
            const planningDefaults = recipeOperationalIndex.byKey?.[recipeKey] || {};
            const baseYield = Number(
                planningDefaults?.standardBatchYield
                || recipe?.baseYield
                || recipe?.yield
                || planningDefaults?.defaultTargetYield
                || 0
            );
            const scaledYield = baseYield > 0 ? Number((baseYield * multiplier).toFixed(2)) : 0;
            const yieldUnit = String(recipe?.unit || '').trim();
            const ingredients = getRecipeIngredients(recipe).map((ingredient, ingredientIndex) => {
                const rawQuantity = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
                const scaledQuantity = Number.isFinite(rawQuantity) ? Number((rawQuantity * multiplier).toFixed(2)) : 0;
                const formatted = formatQuantity(scaledQuantity, ingredient?.unit || '');
                const category = normalizeIngredientCategoryLabel(
                    ingredient?.category || ingredient?.ingredient_category || ingredient?.group || inferIngredientCategoryLabel(ingredient)
                ) || inferIngredientCategoryLabel(ingredient);
                const linkedId = resolveRecipeId(ingredient, visibleRecipes);
                const linkedRecipe = linkedId
                    ? visibleRecipes.find((candidate) => String(getEngineRecipeId(candidate)) === String(linkedId)) || null
                    : null;

                return {
                    id: ingredient?.id || ingredient?.name || `ingredient-${ingredientIndex}`,
                    name: String(ingredient?.name || 'Ingredient'),
                    category,
                    unit: String(formatted?.unit || ingredient?.unit || '').trim(),
                    quantityRaw: scaledQuantity,
                    displayQuantity: `${formatted?.val ?? scaledQuantity}${formatted?.unit ? ` ${formatted.unit}` : ''}`.trim(),
                    note: ingredient?.note || ingredient?.state || '',
                    linkedRecipeName: linkedRecipe?.name || linkedRecipe?.title || ''
                };
            });

            const ingredientGroups = ingredients.reduce((groups, ingredient) => {
                const groupKey = ingredient.category || 'Other';
                const existingGroup = groups.find((group) => group.category === groupKey);
                if (existingGroup) {
                    existingGroup.items.push(ingredient);
                    return groups;
                }
                groups.push({ category: groupKey, items: [ingredient] });
                return groups;
            }, []);

            ingredientGroups.sort((left, right) => {
                const leftOrder = INGREDIENT_CATEGORY_ORDER[left.category] ?? 99;
                const rightOrder = INGREDIENT_CATEGORY_ORDER[right.category] ?? 99;
                return leftOrder - rightOrder || left.category.localeCompare(right.category);
            });

            return {
                recipeKey,
                title: String(recipe?.name || recipe?.title || 'Recipe'),
                code: String(recipe?.code || recipe?.recipeCode || recipe?.recipe_ref_id || recipe?.canonical_id || ''),
                cuisine: String(recipe?.cuisine || recipe?.cuisineType || recipe?.dishCuisine || '').trim(),
                style: String(recipe?.dishStyle || recipe?.style || '').trim(),
                category: String(recipe?.dishCategory || recipe?.category || '').trim(),
                station: String(recipe?.station || recipe?.workstation || '').trim(),
                multiplier,
                scaleLabel: `${isSauceLikeRecipe(recipe) ? 'Batch' : 'Scale'} x${multiplier}`,
                yieldLabel: scaledYield > 0 ? `${scaledYield}${yieldUnit ? ` ${yieldUnit}` : ''}` : '',
                ingredientGroups,
                instructions: normalizeRecipeInstructions(recipe)
            };
        });
    };

    const handlePreviewRecipeExport = () => {
        try {
            const payloads = buildSelectedRecipeExportPayloads();
            if (!payloads.length) return;
            const html = buildRecipeExportHtml({
                recipes: payloads,
                orientation: exportOrientation,
                layout: exportLayout,
                autoPrint: true
            });

            if (exportPreviewWindowRef.current && !exportPreviewWindowRef.current.closed) {
                exportPreviewWindowRef.current.close();
            }

            const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const htmlUrl = URL.createObjectURL(htmlBlob);
            const previewWindow = window.open(htmlUrl, '_blank', 'noopener,noreferrer,width=1180,height=900');
            if (!previewWindow) {
                URL.revokeObjectURL(htmlUrl);
                setExportNotice({
                    tone: 'error',
                    message: 'Popup blocked. Allow popups for this site to open the export preview.'
                });
                return;
            }

            previewWindow.focus();
            window.setTimeout(() => {
                URL.revokeObjectURL(htmlUrl);
            }, 10000);
            previewWindow.focus();
            exportPreviewWindowRef.current = previewWindow;

            setExportNotice({
                tone: 'success',
                message: `${payloads.length} recipe${payloads.length === 1 ? '' : 's'} opened in print preview. Cancel to return, or save as PDF from the dialog.`
            });
        } catch (error) {
            console.error('[Dashboard] Recipe export preview failed', error);
            setExportNotice({
                tone: 'error',
                message: error?.message ? `Export failed: ${error.message}` : 'Export failed before the preview could render.'
            });
        }
    };

    const handleDownloadRecipeCsv = () => {
        try {
            const payloads = buildSelectedRecipeExportPayloads();
            if (!payloads.length) return;

            const csv = buildRecipeExportCsv({ recipes: payloads });
            const filename = payloads.length === 1
                ? `${sanitizeFilename(payloads[0]?.title, 'recipe')}-export.csv`
                : `cabij-recipes-${payloads.length}-export.csv`;
            const csvPreviewHtml = buildRecipeExportCsvPreviewHtml({
                title: `Cabij CSV Export (${payloads.length} recipe${payloads.length === 1 ? '' : 's'})`,
                filename,
                csvText: csv
            });

            if (exportPreviewWindowRef.current && !exportPreviewWindowRef.current.closed) {
                exportPreviewWindowRef.current.close();
            }

            const htmlBlob = new Blob([csvPreviewHtml], { type: 'text/html;charset=utf-8' });
            const htmlUrl = URL.createObjectURL(htmlBlob);
            const previewWindow = window.open(htmlUrl, '_blank', 'noopener,noreferrer,width=1180,height=900');
            if (!previewWindow) {
                URL.revokeObjectURL(htmlUrl);
                setExportNotice({
                    tone: 'error',
                    message: 'Popup blocked. Allow popups for this site to open the CSV preview.'
                });
                return;
            }
            previewWindow.focus();
            window.setTimeout(() => URL.revokeObjectURL(htmlUrl), 10000);
            exportPreviewWindowRef.current = previewWindow;
            setExportNotice({
                tone: 'success',
                message: `CSV preview opened for ${payloads.length} recipe${payloads.length === 1 ? '' : 's'}. Use "Download CSV" inside the popup.`
            });
        } catch (error) {
            console.error('[Dashboard] Recipe CSV export failed', error);
            setExportNotice({
                tone: 'error',
                message: error?.message ? `CSV export failed: ${error.message}` : 'CSV export failed before the download could start.'
            });
        }
    };

    const handleStartPrep = () => {
        const selectedRecipe = ensurePrepRecipeSelection();
        if (!selectedRecipe) {
            setPrepActionNotice({
                tone: 'warning',
                message: 'Choose a recipe from Recipe Truth before starting prep.'
            });
            activateWorkflowView(DASHBOARD_VIEWS.SCALER);
            return;
        }

        recordRecipeActivity(selectedRecipe.recipe, selectedRecipe.recipeKey);

        const selectedPrepPlan = prepPlans?.[selectedRecipe.recipeKey] || null;
        const scopedTasks = getPrepTasksForRecipe(selectedRecipe.recipe, selectedRecipe.recipeKey);
        const plannedYield = Number(selectedPrepPlan?.quantity || 0);
        const existingYield = Number(dailyProduction?.[selectedRecipe.recipeKey] || 0);
        const defaultYield = Number(selectedRecipe.recipe?.baseYield || selectedRecipe.recipe?.yield || 0);
        const nextYield = plannedYield > 0
            ? plannedYield
            : (existingYield > 0 ? existingYield : (defaultYield > 0 ? defaultYield : 1));
        const leadTask = scopedTasks.reduce((winner, task) => {
            if (!winner) return task;
            return compareTaskReadiness(task, winner) < 0 ? task : winner;
        }, null);
        const stationCount = new Set(
            scopedTasks
                .map((task) => String(task?.station || 'General Prep').trim() || 'General Prep')
                .filter(Boolean)
        ).size;
        const planLabel = selectedPrepPlan?.mode
            ? (selectedPrepPlan.mode === 'rotatePrep'
                ? `Rotate prep / ${Number(selectedPrepPlan?.rotateCount || 1)}x per ${selectedPrepPlan?.rotateMode || 'week'}`
                : `Prep this week / ${formatPrepPlanDaySummary({ days: selectedPrepPlan?.days, anyDay: selectedPrepPlan?.anyDay })}${selectedPrepPlan?.auto ? ' / Auto' : ''}`)
            : 'Recipe truth start';
        const sessionSnapshot = prepExecutionSessions?.[selectedRecipe.recipeKey] || null;
        const sessionStartedAtIso = sessionSnapshot?.startedAt || new Date().toISOString();
        const sessionRuntime = formatPrepSessionDuration(sessionStartedAtIso);
        const nextSessionStarts = Number(sessionSnapshot?.startCount || 0) + 1;
        const nowIso = new Date().toISOString();
        applyRecipeYieldTarget({
            recipe: selectedRecipe.recipe,
            recipeKey: selectedRecipe.recipeKey,
            nextYield,
            clearOverride: true
        });
        setPrepExecutionSessions((prev) => ({
            ...prev,
            [selectedRecipe.recipeKey]: {
                recipeKey: selectedRecipe.recipeKey,
                recipeName: selectedRecipe.recipe?.name || selectedRecipe.recipe?.title || 'Recipe',
                startedAt: sessionStartedAtIso,
                lastStartedAt: nowIso,
                startCount: nextSessionStarts,
                lastAction: 'start_prep',
                lastPlanMode: selectedPrepPlan?.mode || 'none'
            }
        }));

        setPrepScheduleView(PREP_SCHEDULE_VIEWS.TODAY);
        setPrepScheduleDayFilter(getKitchenWeekdayIndex(new Date()));
        setPrepBoardDetail(buildPrepBoardDetail({
            title: selectedRecipe.recipe?.name || 'Selected recipe',
            badge: 'Prep started',
            type: scopedTasks.length > 0 ? 'good' : 'warm',
            source: 'Start Prep',
            summary: `${planLabel} / ${formatPrepTaskQuantity(nextYield, selectedRecipe.recipe?.unit || '') || `Qty ${Number(nextYield || 0).toFixed(0)}`}`,
            detail: scopedTasks.length > 0
                ? `${scopedTasks.length} prep task${scopedTasks.length === 1 ? '' : 's'} across ${stationCount} station${stationCount === 1 ? '' : 's'}. Start with ${formatPrepDisplayName(leadTask?.name || 'the top prep task')}.`
                : 'Yield is loaded, but no live prep tasks exist yet for this recipe. Check recipe truth and prep logic inputs.',
            chips: [
                'Today view',
                selectedPrepPlan?.urgent ? 'Urgent' : '',
                selectedPrepPlan?.mode === 'rotatePrep' ? 'Rotate prep' : (selectedPrepPlan?.mode === 'prepThisWeek' ? 'Prep this week' : 'Recipe truth'),
                stationCount > 0 ? `${stationCount} station${stationCount === 1 ? '' : 's'}` : '',
                sessionRuntime ? `Session ${sessionRuntime}` : ''
            ],
            notes: scopedTasks.length > 0
                ? [
                    `Lead task: ${formatPrepDisplayName(leadTask?.name || 'Top prep task')}`,
                    getPrepCardActionSummary(leadTask || {}),
                    `Prep session starts recorded: ${nextSessionStarts}.`,
                    'Use the command board and station lanes below to run the loaded prep sequence in-place.'
                ]
                : [
                    'Scale/yield is now loaded into the prep board context.',
                    `Prep session starts recorded: ${nextSessionStarts}.`,
                    'Generate or repair recipe-truth-backed prep tasks before handoff.'
                ]
        }));
        activateWorkflowView(DASHBOARD_VIEWS.BOARD);
        setPrepActionNotice({
            tone: 'success',
            message: `Prep started for ${selectedRecipe.recipe?.name || 'selected recipe'}${selectedPrepPlan?.mode ? ` using the saved ${selectedPrepPlan.mode === 'rotatePrep' ? 'rotate prep' : 'prep this week'} plan` : ' from recipe library truth'}.`
        });
    };

    const getIngredientAdjustKey = (ingredient, index) => `${activeRecipeKey || 'recipe'}:${ingredient?.id || ingredient?.name || index}`;
    const updateIngredientDraft = (key, patch) => {
        setIngredientDrafts((prev) => ({
            ...prev,
            [key]: {
                ...(prev[key] || {}),
                ...patch
            }
        }));
    };
    const resetIngredientDrafts = () => {
        setIngredientDrafts({});
        setIngredientEditMode(false);
        setCustomIngredientCategories(Array.isArray(activeRecipe?.scalingTips?.customIngredientCategories)
            ? activeRecipe.scalingTips.customIngredientCategories.filter(Boolean)
            : []);
        setAddingCategory(false);
        setNewCategoryDraft('');
        setEditingCategoryName(null);
        setCategoryNameDraft('');
        setDraggedIngredientKey(null);
        setDragTargetCategory(null);
        setEditingIngredientField(null);
    };
    const beginIngredientFieldEdit = (ingredientKey, field) => {
        if (!ingredientEditMode) return;
        setIngredientEditMode(true);
        setEditingIngredientField({ key: ingredientKey, field });
    };
    const stopIngredientFieldEdit = () => {
        setEditingIngredientField(null);
    };
    const isIngredientFieldEditing = (ingredientKey, field) => (
        editingIngredientField?.key === ingredientKey && editingIngredientField?.field === field
    );
    const updateScaleMultiplier = (nextMultiplier) => {
        const parsed = Number.parseInt(String(nextMultiplier), 10);
        if (!activeRecipeKey || !Number.isFinite(parsed) || parsed <= 0) return;
        const safeMultiplier = Math.max(1, parsed);
        const nextYield = baseYieldValue > 0
            ? Number((baseYieldValue * safeMultiplier).toFixed(2))
            : Number(currentYieldValue || 0);
        applyRecipeYieldTarget({
            recipe: activeRecipe,
            recipeKey: activeRecipeKey,
            nextYield,
            overrideReason: 'manual_scale_adjustment'
        });
    };
    const commitScaleInputValue = () => {
        if (!activeRecipeKey) {
            setScaleInputValue('1');
            return;
        }

        const parsed = Number.parseInt(String(scaleInputValue).replace(/[^\d]/g, ''), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setScaleInputValue(String(scaleMultiplier));
            return;
        }

        updateScaleMultiplier(parsed);
    };
    const displayIngredients = previewIngredients.map((ingredient, index) => {
        const ingredientKey = getIngredientAdjustKey(ingredient, index);
        const draft = ingredientDrafts[ingredientKey] || {};
        const parsedBaseQuantity = Number(ingredient?.qty ?? ingredient?.quantity ?? 0);
        const storedBaseQty = Number.isFinite(parsedBaseQuantity) ? parsedBaseQuantity : 0;
        const scaledQty = numericScaleFactor > 0 ? storedBaseQty * numericScaleFactor : storedBaseQty;
        const formattedDisplay = formatQuantity(scaledQty, ingredient?.unit || '');
        const rawQuantity = draft.quantity ?? String(formattedDisplay?.val ?? '');
        const parsedQuantity = Number(rawQuantity);
        const displayQty = Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
        const unit = String(draft.unit ?? formattedDisplay?.unit ?? ingredient?.unit ?? '').trim();
        const category = normalizeIngredientCategoryLabel(
            draft.category
                ?? ingredient?.category
                ?? ingredient?.ingredient_category
                ?? ingredient?.group
                ?? inferIngredientCategoryLabel(ingredient)
        ) || inferIngredientCategoryLabel(ingredient);
        const ingredientName = draft.name ?? ingredient?.name ?? 'Ingredient';

        return {
            ...ingredient,
            qty: Number.isFinite(parsedBaseQuantity) ? parsedBaseQuantity : 0,
            quantity: Number.isFinite(parsedBaseQuantity) ? parsedBaseQuantity : 0,
            name: ingredientName,
            unit,
            category,
            _ingredientKey: ingredientKey,
            _rawQuantity: rawQuantity,
            _rawUnit: unit,
            _displayQuantity: displayQty,
            _scaledQuantity: scaledQty
        };
    });
    const ingredientSections = displayIngredients.reduce((sections, ingredient) => {
        const categoryKey = ingredient?.category || inferIngredientCategoryLabel(ingredient);
        const existingSection = sections.find((section) => section.category === categoryKey);
        if (existingSection) {
            existingSection.items.push(ingredient);
            return sections;
        }
        sections.push({ category: categoryKey, items: [ingredient] });
        return sections;
    }, []);

    customIngredientCategories.forEach((categoryName) => {
        if (!ingredientSections.some((section) => section.category === categoryName)) {
            ingredientSections.push({ category: categoryName, items: [] });
        }
    });

    ingredientSections.sort((left, right) => (
        Number(INGREDIENT_CATEGORY_ORDER[left.category] ?? 999) - Number(INGREDIENT_CATEGORY_ORDER[right.category] ?? 999)
        || String(left.category || '').localeCompare(String(right.category || ''))
    ));

    const renameCategorySection = (previousCategory, nextCategoryName) => {
        const normalizedCategory = normalizeIngredientCategoryLabel(nextCategoryName) || String(nextCategoryName || '').trim();
        if (!normalizedCategory) {
            setEditingCategoryName(null);
            setCategoryNameDraft('');
            return;
        }

        setIngredientDrafts((prev) => {
            const next = { ...prev };
            const matchingItems = ingredientSections.find((section) => section.category === previousCategory)?.items || [];
            matchingItems.forEach((ingredient) => {
                const ingredientKey = ingredient?._ingredientKey;
                if (!ingredientKey) return;
                next[ingredientKey] = {
                    ...(next[ingredientKey] || {}),
                    category: normalizedCategory
                };
            });
            return next;
        });

        setCustomIngredientCategories((prev) => {
            const filtered = prev.filter((category) => category !== previousCategory && category !== normalizedCategory);
            const hadCustomCategory = prev.includes(previousCategory) || !Object.prototype.hasOwnProperty.call(INGREDIENT_CATEGORY_ORDER, normalizedCategory);
            return hadCustomCategory ? [...filtered, normalizedCategory] : filtered;
        });
        setEditingCategoryName(null);
        setCategoryNameDraft('');
    };

    const createIngredientCategory = () => {
        const normalizedCategory = normalizeIngredientCategoryLabel(newCategoryDraft) || String(newCategoryDraft || '').trim();
        if (!normalizedCategory) return;
        setCustomIngredientCategories((prev) => (
            prev.includes(normalizedCategory) ? prev : [...prev, normalizedCategory]
        ));
        setAddingCategory(false);
        setNewCategoryDraft('');
    };

    const moveIngredientToCategory = (ingredientKey, nextCategory) => {
        if (!ingredientKey || !nextCategory) return;
        setIngredientDrafts((prev) => ({
            ...prev,
            [ingredientKey]: {
                ...(prev[ingredientKey] || {}),
                category: nextCategory
            }
        }));
        setDragTargetCategory(null);
        setDraggedIngredientKey(null);
    };

    const saveIngredientDrafts = () => {
        if (!activeRecipe || !activeRecipeKey) return;

        const nextIngredients = previewIngredients.map((ingredient, index) => {
            const ingredientKey = getIngredientAdjustKey(ingredient, index);
            const draft = ingredientDrafts[ingredientKey] || {};
            const nextDisplayQuantity = Number(draft.quantity ?? (displayIngredients[index]?._displayQuantity ?? 0));
            const nextBaseQuantity = numericScaleFactor > 0
                ? Number((nextDisplayQuantity / numericScaleFactor).toFixed(4))
                : Number(nextDisplayQuantity || 0);
            const nextCategory = normalizeIngredientCategoryLabel(
                draft.category
                    ?? ingredient?.category
                    ?? ingredient?.ingredient_category
                    ?? ingredient?.group
                    ?? inferIngredientCategoryLabel(ingredient)
            ) || 'Other';

            return {
                ...ingredient,
                name: String(draft.name ?? ingredient?.name ?? '').trim() || ingredient?.name || 'Ingredient',
                qty: Number.isFinite(nextBaseQuantity) ? nextBaseQuantity : 0,
                quantity: Number.isFinite(nextBaseQuantity) ? nextBaseQuantity : 0,
                unit: String(draft.unit ?? displayIngredients[index]?._rawUnit ?? ingredient?.unit ?? '').trim(),
                category: nextCategory,
                ingredient_category: nextCategory,
                group: nextCategory,
                cat: nextCategory
            };
        });

        const nextRecipe = {
            ...activeRecipe,
            ingredients: nextIngredients,
            scalingTips: {
                ...(activeRecipe?.scalingTips || {}),
                customIngredientCategories
            }
        };

        if (persistRecipeEditToQueue(nextRecipe, { source: 'recipe-ingredient-edit' })) {
            setIngredientDrafts({});
            setIngredientEditMode(false);
            setAddingCategory(false);
            setNewCategoryDraft('');
            setEditingCategoryName(null);
            setCategoryNameDraft('');
            setDraggedIngredientKey(null);
            setDragTargetCategory(null);
        }
    };

    return (
        <main className="hybrid-app">
            <header className="hybrid-topbar final-desktop-topbar">
                <div className="hybrid-brand">
                    <div className="hybrid-mark">CB</div>
                    <div>
                        <div className="hybrid-brand-title">Cabij Chef Workspace</div>
                        <div className="hybrid-brand-sub">
                            {authScopeState.isDegraded
                                ? authScopeState.label
                                : (connectionState === OFFLINE_STATE.ONLINE ? 'Live recipe truth' : 'Offline reader active')}
                        </div>
                    </div>
                </div>

                <nav className="workflow-tabs" style={{ display: 'flex' }} role="tablist" aria-label="Cabij workflow">
                    {visibleWorkflowViews.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            id={`${item.id}-tab`}
                            onClick={() => activateWorkflowView(item.id)}
                            onKeyDown={(event) => {
                                const activeIndex = visibleWorkflowViews.findIndex((candidate) => candidate.id === view);
                                const currentIndex = activeIndex === -1 ? 0 : activeIndex;
                                const lastIndex = visibleWorkflowViews.length - 1;
                                let nextIndex = null;

                                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
                                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
                                } else if (event.key === 'Home') {
                                    event.preventDefault();
                                    nextIndex = 0;
                                } else if (event.key === 'End') {
                                    event.preventDefault();
                                    nextIndex = lastIndex;
                                }

                                if (nextIndex !== null) {
                                    const nextId = visibleWorkflowViews[nextIndex].id;
                                    activateWorkflowView(nextId);
                                    moveWorkflowFocus(nextId);
                                    window.requestAnimationFrame(() => {
                                        workflowTabRefs.current[nextId]?.focus?.();
                                    });
                                }
                            }}
                            role="tab"
                            aria-label={`Switch to ${WORKFLOW_VIEW_LABELS[item.id]} view`}
                            aria-controls={WORKFLOW_PANEL_IDS[item.id]}
                            ref={(node) => {
                                workflowTabRefs.current[item.id] = node;
                            }}
                            tabIndex={view === item.id ? 0 : -1}
                            aria-selected={view === item.id}
                            className={`tab ${view === item.id ? 'active' : ''}`}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', margin: 0, padding: 0 }}
                            title={item.label}
                        >
                            <span className="tab-dot" />
                            <span className="tab-label">{item.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="hybrid-top-actions">
                    <a href="?workspace=projects" className="hybrid-button" title="Client intake, production planning and delivery">Client projects</a>
                    <div className={`identity-entry-pill tone-${identitySessionState.tone || 'gold'}`.trim()} title={identitySessionState.reason || `${identitySessionState.displayName} is the current signed-in kitchen identity.`}>
                        <span className="identity-entry-label">{identitySessionState.label}</span>
                        <span className="identity-entry-name">{identitySessionState.displayName}</span>
                        <span className="identity-entry-copy">
                            {[identitySessionState.roleLabel, identitySessionState.sessionEmail].filter(Boolean).join(' / ')}
                        </span>
                    </div>
                    <DashboardTopStatusChips
                        offlineState={offlineDataState}
                        connectionState={connectionState}
                    />
                    <button
                        type="button"
                        onClick={openExportModal}
                        className={`hybrid-button ${exportModalOpen ? 'primary' : ''}`}
                        title="Export one or more recipes as clean PDF/print sheets or CSV."
                    >
                        <FileOutput size={14} />
                        Export
                    </button>
                    {!isStaffWorkspace ? (
                        <button
                            type="button"
                            onClick={handleOpenPrepSetupPage}
                            className={`hybrid-button ${prepSetupModalOpen ? 'primary' : ''}`}
                            title="Open Prep Add as a popup and save recipes into the prep board."
                        >
                            <Zap size={14} />
                            Prep Add
                        </button>
                    ) : null}
                </div>
            </header>

            {exportModalOpen && (
                <div className="export-overlay" role="presentation" onClick={closeExportModal}>
                    <section
                        className="export-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Export recipes"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="export-modal-head">
                            <div>
                                <div className="eyebrow">Recipe export</div>
                                <div className="export-modal-title">Print-ready recipe sheets for kitchen use</div>
                                <div className="export-modal-copy">
                                    Select the recipes you need, set scale once, then open a print-ready PDF view or download CSV.
                                </div>
                            </div>
                            <button type="button" className="hybrid-button" onClick={closeExportModal} aria-label="Close export">
                                <X size={14} />
                                Close
                            </button>
                        </div>

                        <div className="export-toolbar">
                            <label className="search-box export-search-box">
                                <Search size={14} className="search-icon" />
                                <input
                                    type="search"
                                    value={exportQuery}
                                    onChange={(event) => setExportQuery(event.target.value)}
                                    placeholder="Find recipe by title, code, style, or cuisine"
                                    aria-label="Search recipes for export"
                                />
                            </label>
                            <div className="export-toolbar-actions">
                                <button type="button" className="chip" onClick={selectCurrentRecipeForExport}>Current</button>
                                <button type="button" className="chip" onClick={selectVisibleExportRecipes}>Select visible</button>
                                <button type="button" className="chip" onClick={clearVisibleExportRecipes}>Clear visible</button>
                                <button type="button" className="chip" onClick={selectAllExportRecipes}>Select all</button>
                            </div>
                        </div>

                        <div className="export-modal-body">
                            <section className="export-recipes-pane">
                                <div className="export-pane-head">
                                    <div>
                                        <div className="block-title">Recipe list</div>
                                        <div className="block-sub">Find recipes fast and set the scale you need for each one.</div>
                                    </div>
                                    <div className="export-stats">
                                        <span>{selectedExportCount} selected</span>
                                        <span>{exportRecipeEntries.length} visible</span>
                                    </div>
                                </div>

                                <div className="export-bulk-row">
                                    <label className="export-bulk-scale">
                                        <span>Bulk scale</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={exportBulkScale}
                                            onChange={(event) => setExportBulkScale(event.target.value.replace(/[^\d]/g, '') || '1')}
                                            aria-label="Bulk scale multiplier"
                                        />
                                    </label>
                                    <button type="button" className="chip" onClick={applyBulkScaleToSelectedRecipes}>Apply all</button>
                                    <button type="button" className="chip" onClick={resetSelectedExportScalesToDefault}>Default all</button>
                                </div>

                                <div className="export-recipe-list">
                                    {exportRecipeEntries.length === 0 ? (
                                        <div className="export-empty">No recipes match this export search.</div>
                                    ) : exportRecipeEntries.map((entry) => (
                                        <div className={`export-recipe-row ${entry.selected ? 'selected' : ''}`} key={entry.recipeKey}>
                                            <label className="export-check">
                                                <input
                                                    type="checkbox"
                                                    checked={entry.selected}
                                                    onChange={() => toggleExportRecipeSelection(entry.recipeKey)}
                                                    aria-label={`Select ${entry.title} for export`}
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                className="export-recipe-main"
                                                onClick={() => toggleExportRecipeSelection(entry.recipeKey)}
                                                title={entry.title}
                                            >
                                                <div className="export-recipe-title">{entry.title}</div>
                                                <div className="export-recipe-meta">
                                                    {[entry.style || 'Kitchen Standard', entry.cuisine || 'General', entry.code || 'No code'].filter(Boolean).join(' | ')}
                                                </div>
                                            </button>
                                            <div className="export-scale-control">
                                                <button
                                                    type="button"
                                                    className="export-scale-step"
                                                    onClick={() => setExportRecipeScale(entry.recipeKey, Math.max(1, entry.scale - 1))}
                                                    aria-label={`Reduce scale for ${entry.title}`}
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    className="export-scale-input"
                                                    value={String(entry.scale)}
                                                    onChange={(event) => setExportRecipeScale(entry.recipeKey, event.target.value)}
                                                    aria-label={`Scale for ${entry.title}`}
                                                />
                                                <button
                                                    type="button"
                                                    className="export-scale-step"
                                                    onClick={() => setExportRecipeScale(entry.recipeKey, entry.scale + 1)}
                                                    aria-label={`Increase scale for ${entry.title}`}
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <aside className="export-options-pane">
                                <div className="export-option-group">
                                    <div className="block-title">Sheet layout</div>
                                    <div className="block-sub">Choose the easiest reading mode for station work, prep, or printing.</div>
                                    <div className="export-segmented">
                                        <button
                                            type="button"
                                            className={`export-segment ${exportLayout === 'compact' ? 'active' : ''}`}
                                            onClick={() => setExportLayout('compact')}
                                        >
                                            Compact multi
                                        </button>
                                        <button
                                            type="button"
                                            className={`export-segment ${exportLayout === 'single' ? 'active' : ''}`}
                                            onClick={() => setExportLayout('single')}
                                        >
                                            One page each
                                        </button>
                                    </div>
                                </div>

                                <div className="export-option-group">
                                    <div className="block-title">Orientation</div>
                                    <div className="export-segmented">
                                        <button
                                            type="button"
                                            className={`export-segment ${exportOrientation === 'portrait' ? 'active' : ''}`}
                                            onClick={() => setExportOrientation('portrait')}
                                        >
                                            Vertical
                                        </button>
                                        <button
                                            type="button"
                                            className={`export-segment ${exportOrientation === 'landscape' ? 'active' : ''}`}
                                            onClick={() => setExportOrientation('landscape')}
                                        >
                                            Horizontal
                                        </button>
                                    </div>
                                </div>

                                <div className="export-option-group">
                                    <div className="block-title">Output</div>
                                    <div className="export-actions">
                                        <button type="button" className="hybrid-button primary" onClick={handlePreviewRecipeExport}>
                                            <FileText size={14} />
                                            PDF
                                        </button>
                                        <button type="button" className="hybrid-button" onClick={handleDownloadRecipeCsv}>
                                            <Download size={14} />
                                            CSV
                                        </button>
                                    </div>
                                </div>

                                <div className="export-option-group export-guidance">
                                    <div className="block-title">Recommended flow</div>
                                    <div className="block-sub">
                                        Search by title, select only what the shift needs, set scale once, then export compact for review or one-page mode for station clarity.
                                    </div>
                                </div>

                                {exportNotice ? (
                                    <div className={`export-notice ${exportNotice.tone || 'info'}`}>
                                        {exportNotice.message}
                                    </div>
                                ) : null}
                            </aside>
                        </div>

                    </section>
                </div>
            )}

            <section
                className={`hybrid-workspace final-desktop-workspace view-${view} ${isStaffWorkspace ? 'staff-workspace' : 'manager-workspace'}`.trim()}
                ref={recipeWorkspaceRef}
            >
                {prepSetupModalOpen && (
                    <div className="export-overlay" role="presentation" onClick={closePrepSetupModal}>
                        <section
                            className="export-modal prep-setup-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Prep Add"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="export-modal-head">
                                <div>
                                    <div className="eyebrow">Prep Add</div>
                                    <div className="export-modal-title">Choose recipes and place them into prep</div>
                                    <div className="export-modal-copy">
                                        Select one or many recipes, set scale, choose timing, then save them into the same live prep plan the board already reads.
                                    </div>
                                </div>
                                <button type="button" className="hybrid-button" onClick={closePrepSetupModal} aria-label="Close prep add">
                                    <X size={14} />
                                    Close
                                </button>
                            </div>

                            <div className="prep-setup-view prep-setup-modal-body">
                                <section className="prep-setup-main">
                                    <div className="prep-setup-card">
                                        <div className="export-toolbar prep-setup-toolbar">
                                            <label className="search-box export-search-box">
                                                <Search size={14} className="search-icon" />
                                                <input
                                                    type="search"
                                                    value={prepSetupQuery}
                                                    onChange={(event) => setPrepSetupQuery(event.target.value)}
                                                    placeholder="Find recipe by name, code, style, cuisine, category, event, or ingredient…"
                                                    aria-label="Search recipes for prep add"
                                                />
                                            </label>
                                        </div>

                                        <div className="prep-setup-chip-row prep-setup-filter-row">
                                            {prepSetupChipButtons.map((chip) => (
                                                <button
                                                    type="button"
                                                    key={chip.key}
                                                    className={`chip ${prepSetupActiveChip === chip.key ? 'active' : ''}`}
                                                    aria-pressed={prepSetupActiveChip === chip.key}
                                                    onClick={() => handlePrepSetupChipSelect(chip.key)}
                                                >
                                                    {chip.label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="prep-setup-chip-row prep-setup-filter-row">
                                            <button
                                                type="button"
                                                className="chip"
                                                onClick={selectVisiblePrepSetupRecipes}
                                                disabled={!prepSetupVisibleKeys.length}
                                            >
                                                Select visible
                                            </button>
                                            <button
                                                type="button"
                                                className="chip"
                                                onClick={clearVisiblePrepSetupRecipes}
                                                disabled={!prepSetupVisibleKeys.length}
                                            >
                                                Clear visible
                                            </button>
                                            <button
                                                type="button"
                                                className="chip"
                                                onClick={selectAllPrepSetupRecipes}
                                                disabled={!visibleRecipes?.length}
                                            >
                                                Select all
                                            </button>
                                            <button
                                                type="button"
                                                className="chip"
                                                onClick={clearAllPrepSetupRecipes}
                                                disabled={!selectedPrepSetupCount}
                                            >
                                                Clear all
                                            </button>
                                        </div>

                                        {!prepSetupQuery && prepSetupActiveChip === 'style' ? renderPrepSetupTaxonomyRows(prepSetupStyleGroups, 'style') : null}
                                        {!prepSetupQuery && prepSetupActiveChip === 'cuisine' ? renderPrepSetupTaxonomyRows(prepSetupCuisineGroups, 'cuisine') : null}
                                        {!prepSetupQuery && prepSetupActiveChip === 'category' ? renderPrepSetupTaxonomyRows(prepSetupCategoryGroups, 'category') : null}
                                        {!prepSetupQuery && prepSetupActiveChip === 'occasion' ? renderPrepSetupTaxonomyRows(prepSetupOccasionGroups, 'occasion') : null}

                                        <div className="export-pane-head prep-setup-pane-head">
                                            <div>
                                                <div className="block-title">Recipe table</div>
                                                <div className="block-sub">Choose one or many recipes, bulk-select by the visible search or taxonomy result, then control scale for each before saving the schedule.</div>
                                            </div>
                                            <div className="export-stats">
                                                <span>{selectedPrepSetupCount} selected</span>
                                                <span>{prepSetupRecipeEntries.length} visible</span>
                                            </div>
                                        </div>
                                        <div className="export-recipe-list prep-setup-recipe-list">
                                            {prepSetupRecipeEntries.length === 0 ? (
                                                <div className="export-empty">No recipes match this prep search.</div>
                                            ) : prepSetupRecipeEntries.map((entry) => (
                                                <div className={`export-recipe-row ${entry.selected ? 'selected' : ''}`} key={entry.recipeKey}>
                                                    <label className="export-check">
                                                        <input
                                                            type="checkbox"
                                                            checked={entry.selected}
                                                            onChange={() => togglePrepSetupRecipeSelection(entry.recipeKey)}
                                                            aria-label={`Select ${entry.title} for prep add`}
                                                        />
                                                    </label>
                                                    <button
                                                        type="button"
                                                        className="export-recipe-main"
                                                        onClick={() => togglePrepSetupRecipeSelection(entry.recipeKey)}
                                                        title={entry.title}
                                                    >
                                                        <div className="export-recipe-title">{entry.title}</div>
                                                        <div className="export-recipe-meta">
                                                            {[entry.style || 'Kitchen Standard', entry.cuisine || 'General', entry.category || 'General', entry.occasion || 'Service', entry.code || 'No code'].filter(Boolean).join(' | ')}
                                                        </div>
                                                        <div className="prep-setup-row-note">{entry.quantityLabel}</div>
                                                    </button>
                                                    <div className="export-scale-control">
                                                        <button
                                                            type="button"
                                                            className="export-scale-step"
                                                            onClick={() => setPrepSetupRecipeScale(entry.recipeKey, Math.max(1, entry.scale - 1))}
                                                            aria-label={`Reduce scale for ${entry.title}`}
                                                        >
                                                            -
                                                        </button>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            pattern="[0-9]*[.]?[0-9]*"
                                                            className="export-scale-input"
                                                            value={entry.scaleDisplay}
                                                            onChange={(event) => setPrepSetupRecipeScale(entry.recipeKey, event.target.value)}
                                                            onBlur={() => commitPrepSetupRecipeScale(entry.recipe, entry.recipeKey)}
                                                            aria-label={`Scale for ${entry.title}`}
                                                        />
                                                        <button
                                                            type="button"
                                                            className="export-scale-step"
                                                            onClick={() => setPrepSetupRecipeScale(entry.recipeKey, entry.scale + 1)}
                                                            aria-label={`Increase scale for ${entry.title}`}
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </section>

                                <aside className="prep-setup-side">
                                    <div className="prep-setup-card">
                                        <div className="block-head">
                                            <div>
                                                <div className="block-title">Prep timing</div>
                                                <div className="block-sub">Pick when this work belongs on the board while the main table handles recipe choice and quantity.</div>
                                            </div>
                                        </div>
                                        <div className="prep-mode-grid prep-setup-mode-grid">
                                            <button
                                                type="button"
                                                className={`chip ${prepSetupMode === 'prepThisWeek' ? 'active' : ''}`}
                                                onClick={() => selectPrepSetupMode('prepThisWeek')}
                                            >
                                                Prep this week
                                            </button>
                                            <button
                                                type="button"
                                                className={`chip ${prepSetupMode === 'rotatePrep' ? 'active' : ''}`}
                                                onClick={() => selectPrepSetupMode('rotatePrep')}
                                            >
                                                Rotate prep
                                            </button>
                                        </div>
                                        <div className="side-toggle-grid prep-setup-toggle-grid">
                                            <label className="side-toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={prepSetupUrgent}
                                                    onChange={(event) => setPrepSetupUrgent(event.target.checked)}
                                                    disabled={!isPrepSetupActive}
                                                />
                                                Urgent
                                            </label>
                                            <label className="side-toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={prepSetupAnyDay}
                                                    onChange={(event) => setPrepSetupAnyDay(event.target.checked)}
                                                    disabled={!isPrepSetupWeekMode}
                                                />
                                                Any day
                                            </label>
                                            <label className="side-toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={prepSetupAuto}
                                                    onChange={(event) => setPrepSetupAuto(event.target.checked)}
                                                    disabled={!isPrepSetupWeekMode}
                                                />
                                                Auto
                                            </label>
                                        </div>
                                        <div className="weekday-grid prep-setup-weekday-grid">
                                            {PREP_WEEKDAY_SHORT_LABELS.map((day, index) => (
                                                <button
                                                    type="button"
                                                    key={`${day}-${index}`}
                                                    className={`weekday-btn ${prepSetupDays.includes(index) ? 'active' : ''}`}
                                                    disabled={!isPrepSetupActive}
                                                    onClick={() => togglePrepSetupDay(index)}
                                                >
                                                    {day}
                                                </button>
                                            ))}
                                        </div>
                                        {isPrepSetupRotateMode ? (
                                            <div className="rotate-grid prep-setup-rotate-grid">
                                                <select className="side-input" value={prepSetupRotateMode} onChange={(event) => setPrepSetupRotateMode(event.target.value)}>
                                                    <option value="week">Week</option>
                                                    <option value="month">Month</option>
                                                </select>
                                                <select className="side-input" value={prepSetupRotateCount} onChange={(event) => setPrepSetupRotateCount(event.target.value)}>
                                                    <option value="1">1</option>
                                                    <option value="2">2</option>
                                                    <option value="3">3</option>
                                                </select>
                                            </div>
                                        ) : null}
                                        <div className="prep-setup-copy">
                                            {isPrepSetupRotateMode
                                                ? (prepSetupDays.length > 0
                                                    ? `Rotate ${prepSetupRotateCount} time${prepSetupRotateCount === '1' ? '' : 's'} per ${prepSetupRotateMode} on ${prepSetupDays.map((day) => PREP_WEEKDAY_SHORT_LABELS[day]).join(', ')}.`
                                                    : 'Choose one or more weekdays for rotate prep.')
                                                : (isPrepSetupWeekMode
                                                    ? (prepSetupAnyDay
                                                        ? 'Any day selected for one-time prep.'
                                                        : (prepSetupDays.length > 0
                                                            ? `Planned for ${prepSetupDays.map((day) => PREP_WEEKDAY_SHORT_LABELS[day]).join(', ')}.`
                                                            : 'Choose one or more weekdays, or toggle Any day.'))
                                                    : 'Choose Prep this week or Rotate prep to continue.')}
                                        </div>
                                        <div className="prep-setup-actions">
                                            <button
                                                type="button"
                                                className="button"
                                                onClick={closePrepSetupModal}
                                            >
                                                Back to recipe
                                            </button>
                                            <button
                                                type="button"
                                                className="button primary"
                                                onClick={handleSubmitPrepSetupPlan}
                                                disabled={!selectedPrepSetupCount || prepSetupMode === 'none'}
                                            >
                                                Send to prep board
                                            </button>
                                        </div>
                                    </div>
                                </aside>
                            </div>
                        </section>
                    </div>
                )}

                {view === DASHBOARD_VIEWS.SCALER && (
                    <>
                        <aside className="panel finder">
                        <RecipeSelector
                            recipes={visibleRecipes}
                            selectedId={selectedId}
                            onSelectedIdChange={(nextSelectedId) => {
                                const selectedRecipeEntry = Array.isArray(visibleRecipes)
                                    ? visibleRecipes.find((recipe, index) => getRecipeKey(recipe, `idx-${index}`) === nextSelectedId)
                                    : null;
                                if (selectedRecipeEntry) {
                                    recordRecipeActivity(selectedRecipeEntry, nextSelectedId);
                                }
                                setSelectedId(nextSelectedId);
                            }}
                            translateIngredient={translateIngredient}
                            verticalLayout
                            recentActivity={recentRecipeActivity}
                        />
                    </aside>
                    <section className="hybrid-main">
                        <section
                            className="work-panel"
                            id={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.SCALER]}
                            role="tabpanel"
                            ref={(node) => {
                                workflowPanelRefs.current[DASHBOARD_VIEWS.SCALER] = node;
                            }}
                            aria-labelledby={`${DASHBOARD_VIEWS.SCALER}-tab`}
                            tabIndex={-1}
                        >
                            <header className="work-header">
                                <div className="work-header-row">
                                    <div className="work-header-title-group">
                                        <div className="eyebrow">Recipe Truth</div>
                                        {!isStaffWorkspace && editingRecipeTitle ? (
                                            <input
                                                className="recipe-title-inline-input"
                                                value={recipeTitleDraft}
                                                onChange={(event) => setRecipeTitleDraft(event.target.value)}
                                                onBlur={saveRecipeTitleDraft}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.currentTarget.blur();
                                                    } else if (event.key === 'Escape') {
                                                        cancelRecipeTitleEdit();
                                                    }
                                                }}
                                                aria-label="Recipe title"
                                            />
                                        ) : isStaffWorkspace || !ingredientEditMode ? (
                                            <div className="h1 recipe-title-static">{recipeTitle}</div>
                                        ) : (
                                            <button
                                                type="button"
                                                className="h1 recipe-title-trigger"
                                                onClick={startRecipeTitleEdit}
                                            >
                                                {recipeTitle}
                                            </button>
                                        )}
                                        <div className="filter-row">
                                            <div className="chip active">{scaleSummaryLabel}</div>
                                            <div className="chip">Station: {activeRecipe?.station || 'General'}</div>
                                            <div className="chip">Cuisine: {activeCuisine}</div>
                                        </div>
                                    </div>
                                    {isStaffWorkspace ? (
                                        <div className="staff-readiness-summary">
                                            <div className="staff-readiness-title">Current batch</div>
                                            <div className="staff-readiness-value">{scaleSummaryLabel}</div>
                                            <div className="staff-readiness-copy">Read the ingredients and method below. Manager-only setup stays hidden in staff mode.</div>
                                        </div>
                                    ) : (
                                        <div className="scale-control-row">
                                            <span className="scale-label">Batch Multiplier</span>
                                            <button
                                                type="button"
                                                className="scale-btn"
                                                onClick={() => updateScaleMultiplier(Math.max(1, scaleMultiplier - 1))}
                                                aria-label="Reduce recipe batch multiplier"
                                                title="Reduce batch multiplier"
                                            >
                                                -
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                className="scale-input"
                                                value={scaleInputValue}
                                                onChange={(event) => setScaleInputValue(event.target.value.replace(/[^\d]/g, ''))}
                                                onBlur={commitScaleInputValue}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.currentTarget.blur();
                                                    } else if (event.key === 'Escape') {
                                                        setScaleInputValue(String(scaleMultiplier));
                                                        event.currentTarget.blur();
                                                    }
                                                }}
                                                aria-label="Recipe scale multiplier"
                                            />
                                            <button
                                                type="button"
                                                className="scale-btn"
                                                onClick={() => updateScaleMultiplier(scaleMultiplier + 1)}
                                                aria-label="Increase recipe batch multiplier"
                                                title="Increase batch multiplier"
                                            >
                                                +
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </header>

                            <section className="scaler-board" aria-label="Ingredient preview" ref={scalerBoardRef}>
                                <div className="block-head">
                                    <div>
                                        <div className="block-title">Scaled Ingredient Preview</div>
                                        <div className="block-sub">{isStaffWorkspace ? 'Read the live ingredient truth grouped by category. This staff surface stays read-only and easy to follow.' : 'Live recipe ingredient truth grouped by category. Edit mode unlocks name, quantity, unit, and category.'}</div>
                                    </div>
                                    {!isStaffWorkspace ? (
                                    <div className="preview-head-actions">
                                        <button
                                            type="button"
                                            className="chip"
                                            onClick={() => {
                                                if (!activeRecipeKey) return;
                                                const resetYield = baseYieldValue > 0 ? baseYieldValue : (Number(currentYieldValue || 1) || 1);
                                                applyRecipeYieldTarget({
                                                    recipe: activeRecipe,
                                                    recipeKey: activeRecipeKey,
                                                    nextYield: Number(resetYield.toFixed(2)),
                                                    clearOverride: true
                                                });
                                            }}
                                        >
                                            Default
                                        </button>
                                        <button
                                            type="button"
                                            className={`chip ${ingredientEditMode ? 'active' : ''}`}
                                            onClick={() => {
                                                setIngredientEditMode((prev) => {
                                                    const next = !prev;
                                                    if (!next) {
                                                        setIngredientDrafts({});
                                                        setEditingIngredientField(null);
                                                    }
                                                    return next;
                                                });
                                            }}
                                            aria-pressed={ingredientEditMode}
                                        >
                                            {ingredientEditMode ? 'Editing' : 'Edit'}
                                        </button>
                                        {ingredientEditMode ? (
                                            <>
                                                <div className="side-edit-stack ingredient-category-stack">
                                                    <button
                                                        type="button"
                                                        className={`chip ${addingCategory ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setAddingCategory((prev) => !prev);
                                                            setEditingCategoryName(null);
                                                            setCategoryNameDraft('');
                                                            setNewCategoryDraft('');
                                                        }}
                                                    >
                                                        + Category
                                                    </button>
                                                    {addingCategory || editingCategoryName ? (
                                                        <div className="ingredient-category-create">
                                                            <span className="side-key">
                                                                {editingCategoryName ? `Rename ${editingCategoryName}` : 'Create new category'}
                                                            </span>
                                                            <input
                                                                className="ingredient-inline-input"
                                                                type="text"
                                                                placeholder={editingCategoryName ? 'Rename category' : 'New category name'}
                                                                value={editingCategoryName ? categoryNameDraft : newCategoryDraft}
                                                                onChange={(event) => {
                                                                    const nextValue = event.target.value;
                                                                    if (editingCategoryName) {
                                                                        setCategoryNameDraft(nextValue);
                                                                    } else {
                                                                        setNewCategoryDraft(nextValue);
                                                                    }
                                                                }}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'Enter') {
                                                                        if (editingCategoryName) {
                                                                            renameCategorySection(editingCategoryName, categoryNameDraft);
                                                                        } else {
                                                                            createIngredientCategory();
                                                                        }
                                                                    } else if (event.key === 'Escape') {
                                                                        setAddingCategory(false);
                                                                        setEditingCategoryName(null);
                                                                        setNewCategoryDraft('');
                                                                        setCategoryNameDraft('');
                                                                    }
                                                                }}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="chip active"
                                                                onClick={() => {
                                                                    if (editingCategoryName) {
                                                                        renameCategorySection(editingCategoryName, categoryNameDraft);
                                                                    } else {
                                                                        createIngredientCategory();
                                                                    }
                                                                }}
                                                            >
                                                                {editingCategoryName ? 'Rename' : 'Add'}
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <button
                                                    type="button"
                                                    className="chip active"
                                                    onClick={saveIngredientDrafts}
                                                    disabled={!hasPendingIngredientChanges}
                                                >
                                                    <Check size={14} />
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    className="chip"
                                                    onClick={resetIngredientDrafts}
                                                >
                                                    <RotateCcw size={14} />
                                                    Undo
                                                </button>
                                            </>
                                        ) : null}
                                    </div>
                                    ) : (
                                        <div className="staff-preview-note">Read-only staff recipe view</div>
                                    )}
                                </div>
                                <div className="scaler-list">
                                    {!activeRecipe ? (
                                        <div className="instruction-empty">
                                            <strong>{recipeSelectionEmptyCopy.title}</strong>
                                            <div>{recipeSelectionEmptyCopy.body}</div>
                                        </div>
                                    ) : ingredientSections.length === 0 ? (
                                        <div className="instruction-empty">
                                            <strong>{ingredientsEmptyCopy.title}</strong>
                                            <div>{ingredientsEmptyCopy.body}</div>
                                        </div>
                                    ) : (
                                        ingredientSections.map((section) => (
                                            <section
                                                className={`ingredient-category-section ${dragTargetCategory === section.category ? 'drop-target' : ''}`}
                                                key={section.category}
                                                onDragOver={(event) => {
                                                    if (!ingredientEditMode) return;
                                                    event.preventDefault();
                                                    setDragTargetCategory(section.category);
                                                }}
                                                onDragLeave={() => {
                                                    if (dragTargetCategory === section.category) {
                                                        setDragTargetCategory(null);
                                                    }
                                                }}
                                                onDrop={(event) => {
                                                    if (!ingredientEditMode) return;
                                                    event.preventDefault();
                                                    moveIngredientToCategory(draggedIngredientKey, section.category);
                                                }}
                                            >
                                                <div className="ingredient-category-header">
                                                    {ingredientEditMode && editingCategoryName === section.category ? (
                                                        <input
                                                            className="ingredient-category-header-input"
                                                            type="text"
                                                            value={categoryNameDraft}
                                                            onChange={(event) => setCategoryNameDraft(event.target.value)}
                                                            onBlur={() => renameCategorySection(section.category, categoryNameDraft)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') {
                                                                    event.currentTarget.blur();
                                                                } else if (event.key === 'Escape') {
                                                                    setEditingCategoryName(null);
                                                                    setCategoryNameDraft('');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className={`ingredient-category-header-trigger ${ingredientEditMode ? 'editable' : ''}`}
                                                            onClick={() => {
                                                                if (!ingredientEditMode) return;
                                                                setEditingCategoryName(section.category);
                                                                setCategoryNameDraft(section.category);
                                                            }}
                                                        >
                                                            {section.category}
                                                        </button>
                                                    )}
                                                    <span className="ingredient-category-count">{section.items.length}</span>
                                                </div>
                                                <div className="ingredient-category-grid">
                                                    {section.items.map((ing, idx) => {
                                                        const ingredientKey = ing._ingredientKey || getIngredientAdjustKey(ing, idx);
                                                        const parsedQty = Number(ing?.qty ?? ing?.quantity ?? 0);
                                                        const baseQty = Number.isFinite(parsedQty) ? parsedQty : 0;
                                                        const scaledQty = numericScaleFactor > 0 ? baseQty * numericScaleFactor : baseQty;
                                                        const formatted = formatQuantity(scaledQty, ing?.unit || '');
                                                        const ingredientName = translateIngredient ? translateIngredient(ing?.name || 'Ingredient') : ing?.name || 'Ingredient';
                                                        const ingredientCategory = ing?.category || 'General';
                                                        const linkedId = resolveRecipeId(ing, visibleRecipes);
                                                        const childRecipe = linkedId
                                                            ? visibleRecipes.find((recipe) => String(getEngineRecipeId(recipe)) === String(linkedId)) || null
                                                            : null;
                                                        const linkedRecipeName = childRecipe?.name || childRecipe?.title || null;

                                                        return (
                                                            <div
                                                                className="ingredient-item"
                                                                key={`${section.category}-${ing.id || ing.name || idx}`}
                                                                draggable={ingredientEditMode}
                                                                onDragStart={() => setDraggedIngredientKey(ingredientKey)}
                                                                onDragEnd={() => {
                                                                    setDraggedIngredientKey(null);
                                                                    setDragTargetCategory(null);
                                                                }}
                                                            >
                                                                {linkedId ? (
                                                                    <div className="ingredient-head-row">
                                                                        <div className="ingredient-subrecipe-chip mono">{linkedRecipeName || linkedId}</div>
                                                                    </div>
                                                                ) : null}
                                                                <div className="ingredient-primary">
                                                                    {ingredientEditMode ? (
                                                                        <button
                                                                            type="button"
                                                                            className="ingredient-inline-trigger"
                                                                            onClick={() => beginIngredientFieldEdit(ingredientKey, 'name')}
                                                                            title="Edit ingredient name"
                                                                        >
                                                                            {isIngredientFieldEditing(ingredientKey, 'name') ? (
                                                                                <input
                                                                                    className="ingredient-inline-input"
                                                                                    value={ingredientName}
                                                                                    onChange={(event) => updateIngredientDraft(ingredientKey, { name: event.target.value })}
                                                                                    onBlur={stopIngredientFieldEdit}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter') {
                                                                                            event.currentTarget.blur();
                                                                                        } else if (event.key === 'Escape') {
                                                                                            stopIngredientFieldEdit();
                                                                                            event.currentTarget.blur();
                                                                                        }
                                                                                    }}
                                                                                    aria-label={`Edit ingredient name for ${ingredientName}`}
                                                                                />
                                                                            ) : (
                                                                                <div className="ingredient-name">{ingredientName}</div>
                                                                            )}
                                                                        </button>
                                                                    ) : (
                                                                        <div className="ingredient-name">{ingredientName}</div>
                                                                    )}
                                                                    {ingredientEditMode ? (
                                                                        <button
                                                                            type="button"
                                                                            className="ingredient-inline-trigger ingredient-inline-trigger--qty"
                                                                            onClick={() => beginIngredientFieldEdit(ingredientKey, 'quantity')}
                                                                            title="Edit quantity and unit at current scale"
                                                                        >
                                                                            {isIngredientFieldEditing(ingredientKey, 'quantity') ? (
                                                                                <div className="ingredient-qty-editor">
                                                                                    <input
                                                                                        className="ingredient-inline-input mono"
                                                                                        type="number"
                                                                                        step="0.01"
                                                                                        min="0"
                                                                                        value={ing._rawQuantity}
                                                                                        onChange={(event) => updateIngredientDraft(ingredientKey, { quantity: event.target.value })}
                                                                                        onBlur={stopIngredientFieldEdit}
                                                                                        onKeyDown={(event) => {
                                                                                            if (event.key === 'Enter') {
                                                                                                event.currentTarget.blur();
                                                                                            } else if (event.key === 'Escape') {
                                                                                                stopIngredientFieldEdit();
                                                                                                event.currentTarget.blur();
                                                                                            }
                                                                                        }}
                                                                                        aria-label={`Edit ingredient quantity for ${ingredientName}`}
                                                                                    />
                                                                                    <input
                                                                                        className="ingredient-inline-input ingredient-inline-input--unit"
                                                                                        type="text"
                                                                                        value={ing._rawUnit}
                                                                                        onChange={(event) => updateIngredientDraft(ingredientKey, { unit: event.target.value })}
                                                                                        onBlur={stopIngredientFieldEdit}
                                                                                        onKeyDown={(event) => {
                                                                                            if (event.key === 'Enter') {
                                                                                                event.currentTarget.blur();
                                                                                            } else if (event.key === 'Escape') {
                                                                                                stopIngredientFieldEdit();
                                                                                                event.currentTarget.blur();
                                                                                            }
                                                                                        }}
                                                                                        aria-label={`Edit ingredient unit for ${ingredientName}`}
                                                                                    />
                                                                                </div>
                                                                            ) : (
                                                                                <div className="ingredient-qty mono">{formatted.val} {formatted.unit}</div>
                                                                            )}
                                                                        </button>
                                                                    ) : (
                                                                        <div className="ingredient-qty mono">{formatted.val} {formatted.unit}</div>
                                                                    )}
                                                                </div>
                                                                {linkedId ? (
                                                                    <div className="ingredient-subrecipe">
                                                                        Sub recipe: {linkedRecipeName || linkedId}
                                                                    </div>
                                                                ) : null}
                                                                {ing.note || ing.state ? (
                                                                    <div className="ingredient-note">{ing.note || ing.state}</div>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </section>
                                        ))
                                    )}
                                </div>
                            </section>
                            
                            <section className="prep-board" aria-label="Recipe instructions">
                                <div className="block-head">
                                    <div>
                                        <div className="block-title">Recipe Instructions</div>
                                        <div className="block-sub">Always-visible cooking flow for the selected recipe.</div>
                                    </div>
                                    <div className="badge good">{normalizedRecipeInstructions.length || 0} steps</div>
                                </div>
                                <div className="instruction-list">
                                    {normalizedRecipeInstructions.length === 0 ? (
                                        <div className="instruction-empty">
                                            <strong>{instructionsEmptyCopy.title}</strong>
                                            <div>{instructionsEmptyCopy.body}</div>
                                        </div>
                                    ) : (
                                        normalizedRecipeInstructions.map((step, index) => (
                                            <div className="instruction-step" key={`step-${index}`}>
                                                <div className="instruction-number">{index + 1}</div>
                                                {!isStaffWorkspace && editingInstructionIndex === index ? (
                                                    <input
                                                        className="instruction-inline-input"
                                                        type="text"
                                                        value={editingInstructionDraft}
                                                        onChange={(event) => setEditingInstructionDraft(event.target.value)}
                                                        onBlur={saveInstructionEdit}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                event.currentTarget.blur();
                                                            } else if (event.key === 'Escape') {
                                                                cancelInstructionEdit();
                                                                event.currentTarget.blur();
                                                            }
                                                        }}
                                                        aria-label={`Edit recipe step ${index + 1}`}
                                                    />
                                                ) : !isStaffWorkspace ? (
                                                    <button
                                                        type="button"
                                                        className="instruction-copy-button"
                                                        onClick={() => startInstructionEdit(index)}
                                                    >
                                                        <span className="instruction-copy">{step}</span>
                                                    </button>
                                                ) : (
                                                    <div className="instruction-copy-static">
                                                        <span className="instruction-copy">{step}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        </section>
                    </section>
                    </>
                )}

{view === DASHBOARD_VIEWS.MANAGER && <>
                {import.meta.env.VITE_ENABLE_RECIPE_V1 === 'true' && <RecipeVersionReview supabase={supabase} clientId={scopedClientId} user={sessionUser} sourceRecipe={activeRecipe} />}
                <DashboardManagerQueuePage
                        queueSummary={queueSummary}
                        queueEntries={recipeQueue}
                        offlineState={offlineDataState}
                        connectionState={connectionState}
                        syncNotice={syncNotice}
                        operationalObservabilityItems={operationalObservabilityItems}
                        userRole={normalizedRole}
                        canApproveSync={canApproveSync}
                        onApproveQueue={handleApproveQueueForSync}
                        onBackToRecipe={() => {
                            setSelectedQueueEntryId(null);
                            activateWorkflowView(DASHBOARD_VIEWS.SCALER);
                        }}
                        selectedQueueEntry={selectedQueueEntry}
                        selectedQueueEntryId={selectedQueueEntryId}
                        onSelectQueueEntry={setSelectedQueueEntryId}
                        panelId={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.MANAGER]}
                        panelLabelId={`${DASHBOARD_VIEWS.MANAGER}-tab`}
                        activeRecipe={selectedQueueRecipe || activeRecipe}
                        formatQuantity={formatQuantity}
                        portionMode={portionMode}
                        onPortionModeToggle={() => setPortionMode(!portionMode)}
                        currentYieldValue={selectedQueueYieldValue || currentYieldValue}
                        currentPortionCount={selectedQueuePortionCount || currentPortionCount}
                        portionsPerBatch={portionsPerBatch}
                        getPortionSize={() => selectedQueuePortionWeight}
                        setDailyProduction={setDailyProduction}
                        dailyProduction={dailyProduction}
                        nextActionSummary={nextActionSummary}
                        bomInsight={activeBomInsight}
                        onOptimizeYield={() => {
                            const targetRecipe = selectedQueueRecipe || activeRecipe;
                            const targetYield = Number((Number(targetRecipe?.baseYield) || selectedQueueYieldValue || 0).toFixed(2));
                            const targetKey = getRecipeKey(targetRecipe, selectedQueueRecipeKey);
                            if (targetKey) {
                                applyRecipeYieldTarget({
                                    recipe: targetRecipe,
                                    recipeKey: targetKey,
                                    nextYield: targetYield,
                                    overrideReason: 'optimized_yield_target'
                                });
                            }
                        }}
                        onResetActive={() => {
                            const targetRecipe = selectedQueueRecipe || activeRecipe;
                            const targetKey = getRecipeKey(targetRecipe, selectedQueueRecipeKey);
                            if (targetKey) {
                                applyRecipeYieldTarget({
                                    recipe: targetRecipe,
                                    recipeKey: targetKey,
                                    nextYield: Number((Number(targetRecipe?.baseYield) || 0).toFixed(2)),
                                    clearOverride: true
                                });
                            }
                        }}
                        onDefaultAll={() => {
                            setDailyProduction(buildDailyProduction(visibleRecipes));
                            clearAllPrepTaskOverrides();
                        }}
                    />
                </>}

            {view === DASHBOARD_VIEWS.BOARD && (
            <section
                    className={`prep-view page-view ${prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY ? 'today-default' : 'planning-mode'} ${prepScheduleView === PREP_SCHEDULE_VIEWS.TODAY && prepExpandedDayView ? 'expanded-day' : ''} ${effectivePrepFocusMode !== PREP_FOCUS_MODES.BOARD ? 'focused-mode' : ''}`.trim()}
                    id={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.BOARD]}
                    role="tabpanel"
                    aria-labelledby={`${DASHBOARD_VIEWS.BOARD}-tab`}
                    tabIndex={-1}
                >
        <aside className="prep-calendar" aria-label="Prep schedule range">
            <div className="panel-head">
              <div className="eyebrow">Prep Schedule</div>
              <div className="h1">This week</div>
              <div className="copy">Use the saved prep plan as planning context, then return to Today for the actual working board.</div>
            </div>

            <div className="calendar-body">
              <div className="section-label">This Week</div>
              {visibleWeekCells.map((dayCell, dayIndex) => (
                <button
                  type="button"
                  className={`day-cell prep-surface-button ${dayCell.isToday ? 'today' : ''} ${dayCell.blockedCount > 0 ? 'critical' : (dayCell.attentionCount > 0 ? 'busy' : (dayCell.count > 0 ? 'normal' : 'quiet'))}`.trim()}
                  key={dayCell.key}
                  onClick={() => {
                    handlePrepScheduleViewSelect(PREP_SCHEDULE_VIEWS.TODAY, buildPrepBoardDetail({
                      title: `${dayCell.label} ${dayCell.dateLabel}`,
                      badge: dayCell.isToday ? 'Today' : 'Day',
                      type: dayCell.count > 0 ? 'good' : 'warm',
                      source: 'This week',
                      summary: dayCell.loadLabel,
                      detail: dayCell.count > 0
                        ? `${dayCell.count} prep task${dayCell.count === 1 ? '' : 's'} are currently visible for ${dayCell.label}.`
                        : `No prep plan is currently saved for ${dayCell.label}.`,
                      chips: ['Today view', dayCell.isToday ? 'Current day' : '', dayCell.count > 0 ? `${dayCell.count} task${dayCell.count === 1 ? '' : 's'}` : 'No plan'],
                      notes: [dayCell.count > 0 ? 'Return to Today to work the live prep rows.' : 'Save Prep this week or Rotate prep from Recipe Truth to add work here.']
                    }), dayIndex);
                  }}
                  aria-label={`${dayCell.label} ${dayCell.dateLabel}, ${dayCell.loadLabel}`}
                >
                  <div className="day-name">{dayCell.label}</div>
                  <div className="day-main">
                    <div className="day-date">{dayCell.dateLabel}</div>
                    <div className="day-load">{dayCell.loadLabel}</div>
                  </div>
                </button>
              ))}
              <div className="prep-week-legend" aria-label="Weekly pressure guide">
                <div className="prep-week-legend-chip quiet">Quiet</div>
                <div className="prep-week-legend-chip normal">Regular</div>
                <div className="prep-week-legend-chip busy">Busy</div>
                <div className="prep-week-legend-chip critical">Urgent</div>
              </div>
              <div className="prep-schedule-recipes" aria-label={prepScheduleRowsAriaLabel}>
                <div className="section-label">{prepScheduleRowsLabel}</div>
                {visibleScheduleRows.length > 0 ? visibleScheduleRows.map((row) => (
                  <button
                    type="button"
                    key={`${row.recipeKey || row.title}-${row.count}`}
                    className={`prep-schedule-row prep-surface-button ${row.recipeKey && row.recipeKey === activeRecipeKey ? 'active' : ''}`.trim()}
                    onClick={() => {
                      if (!row.recipeKey) return;
                      focusPrepRecipeFromBoard({
                        recipeKey: row.recipeKey,
                        recipeName: row.title,
                        message: `${row.title} moved into Chef Focus from the prep schedule.`,
                        tone: 'info',
                        viewId: DASHBOARD_VIEWS.BOARD,
                        detail: buildPrepBoardDetail({
                          title: row.title,
                          badge: row.badge || (row.sourceType === 'library_preview' ? 'Recipe ready' : 'Planned'),
                          type: row.sourceType === 'library_preview' ? 'warm' : 'good',
                          source: row.sourceType === 'library_preview' ? 'Recipe Truth' : 'Prep schedule',
                          summary: row.meta,
                          detail: row.sourceType === 'library_preview'
                            ? `${row.title} is visible in the recipe library but is not yet saved into the prep plan.`
                            : `${row.title} is currently included in the saved prep schedule.`,
                          chips: [row.count || '', scheduleWindowLabel].filter(Boolean),
                          notes: [row.sourceType === 'library_preview'
                            ? 'Save Prep this week or Rotate prep before expecting live task lanes here.'
                            : 'Return to Today to run the active prep task rows.']
                        })
                      });
                    }}
                    disabled={!row.recipeKey}
                  >
                    <div className="prep-schedule-row-main">
                      <div className="prep-schedule-row-title">{row.title}</div>
                      <div className="prep-schedule-row-meta">{row.meta}</div>
                    </div>
                    <div className="prep-schedule-row-count">{row.count}</div>
                  </button>
                )) : (
                  <div className="prep-schedule-empty">Save recipes from Prep Add to pin them into this schedule.</div>
                )}
              </div>
            </div>
          </aside>

        <section className={`prep-command ${collapsePrepBoardLayout ? 'empty-state' : ''}`.trim()} aria-label="Prep board working surface">
          <div className={`prep-section-head prep-section-head--lanes ${collapsePrepBoardLayout ? 'empty-state' : ''}`.trim()}>
            <div className="prep-section-head-main">
              <div className="section-label">
                {resolvedShowPrepBoardEmptyState
                  ? 'Before tasks appear'
                  : (showPrepBoardRecipePreview ? 'Prep board preview' : (showSavedPlanBoardFallback ? 'Saved prep recipes' : 'Today prep board'))}
              </div>
              <div className="prep-section-copy">
                {resolvedShowPrepBoardEmptyState
                  ? 'Choose recipes in Recipe Truth, send them through Prep Add, then come back here to work the live prep rows.'
                  : (showPrepBoardRecipePreview
                      ? 'Workflow-linked recipes already have prep structure. Save them into the prep plan and this same board will switch from preview rows to live task execution.'
                      : (showSavedPlanBoardFallback
                      ? 'The saved prep plan is still here. Live task lanes are missing, so the board is holding the recipe plan instead of pretending work is ready.'
                      : 'Grouped by style / station first, then recipe, then actionable prep task rows. Keep full instructions on the Recipe page and run only the prep tasks here.'))}
              </div>
            </div>
            {!collapsePrepBoardLayout && !showSavedPlanBoardFallback ? (
              <div className="prep-section-controls" aria-label="Today board task actions">
                <button
                  type="button"
                  className="prep-focus-button"
                  onClick={handleTakeFirstPrepTask}
                >
                  Take first
                </button>
                <button
                  type="button"
                  className="prep-focus-button"
                  onClick={handleTakeAllVisiblePrepTasks}
                >
                  Take all shown
                </button>
                <button
                  type="button"
                  className="prep-focus-button"
                  onClick={handleClearTakenPrepTasks}
                >
                  Clear taken
                </button>
              </div>
            ) : null}
          </div>

          {!collapsePrepBoardLayout ? (
            <div className="prep-mode-stack">
              <div className="focus-metric-grid">
                <div className="focus-metric-card">
                  <div className="focus-metric-label">Today load</div>
                  <div className="focus-metric-value">{String(prepCalendarSummary.todayCount || 0)}</div>
                </div>
                <div className="focus-metric-card">
                  <div className="focus-metric-label">Needs attention</div>
                  <div className="focus-metric-value">{String(scopedPrepPressure.attentionTaskCount || 0)}</div>
                </div>
                <div className="focus-metric-card">
                  <div className="focus-metric-label">Taken</div>
                  <div className="focus-metric-value">{selectedPrepTaskLabel}</div>
                </div>
              </div>

              <div className="prep-focus-controls" aria-label="Prep board focus modes">
                <button
                  type="button"
                  className={`prep-layout-toggle ${effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD ? 'active' : ''}`.trim()}
                  onClick={() => setPrepFocusMode(PREP_FOCUS_MODES.BOARD)}
                >
                  Full board
                </button>
                {PREP_DAY_PART_SEQUENCE.map((phase) => (
                  <button
                    type="button"
                    key={`focus-phase-${phase.key}`}
                    className={`prep-layout-toggle ${effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART && prepFocusDayPart === phase.key ? 'active' : ''}`.trim()}
                    onClick={() => {
                      setPrepFocusMode(PREP_FOCUS_MODES.DAY_PART);
                      setPrepFocusDayPart(phase.key);
                      setPrepBoardGrouping(PREP_BOARD_GROUPINGS.STATION);
                    }}
                  >
                    {phase.label}
                  </button>
                ))}
              </div>

              {effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART ? (
                <div className="prep-grouping-stack">
                  <div className="prep-grouping-copy">View selected prep window</div>
                  <div className="prep-grouping-inline">
                    {prepGroupingOptions.map((option) => (
                      <button
                        type="button"
                        key={`grouping-${option.id}`}
                        className={`phase-column-jump prep-grouping-option ${prepBoardGrouping === option.id ? 'active' : ''}`.trim()}
                        onClick={() => setPrepBoardGrouping(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`station-board category-board ${collapsePrepBoardLayout ? 'empty-state' : ''} station-grouping`.trim()} aria-label="Today's prep lanes">
            {(() => {
              if (effectivePrepFocusMode === PREP_FOCUS_MODES.BOARD && (
                fullBoardTaskColumns.some((column) => Number(column?.totalTasks || 0) > 0)
                || savedPlanFullBoardColumns.some((column) => Number(column?.totalRows || 0) > 0)
              )) {
                const activeFullBoardColumns = fullBoardTaskColumns.some((column) => Number(column?.totalTasks || 0) > 0)
                  ? fullBoardTaskColumns
                  : savedPlanFullBoardColumns;
                const usingSavedPlanColumns = activeFullBoardColumns === savedPlanFullBoardColumns;
                return (
                  <div className="phase-columns-board">
                    {activeFullBoardColumns.map((column) => (
                      <section className="phase-column active" key={`full-board-${column.phaseKey}`}>
                        <div className="phase-column-head">
                          <div>
                            <div className="phase-column-title">{column.label}</div>
                            <div className="phase-column-sub">
                              {usingSavedPlanColumns
                                ? `${Number(column?.totalRows || 0)} planned`
                                : `${column.takenActionCount}/${column.totalActionCount} checked`}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="phase-column-jump"
                            onClick={() => {
                              setPrepFocusMode(PREP_FOCUS_MODES.DAY_PART);
                              setPrepFocusDayPart(column.phaseKey);
                              setPrepBoardGrouping(PREP_BOARD_GROUPINGS.STATION);
                            }}
                          >
                            Focus
                          </button>
                        </div>
                        <div className="phase-column-body filtered-phase-column-body">
                          {Array.isArray(column.lanes) && column.lanes.length > 0 ? (
                            column.lanes.map((lane, index) => (
                              <section className="phase-task-group" key={`${column.phaseKey}-${lane.category}-${index}`}>
                                <div className="phase-task-group-head">
                                  <div>
                                    <div className="phase-task-group-title">{lane.category}</div>
                                    <div className="phase-task-group-copy">{lane.loadLabel}</div>
                                  </div>
                                  {usingSavedPlanColumns ? (
                                    <button
                                      type="button"
                                      className="station-take-button"
                                      onClick={() => toggleSavedPrepRowsDone(lane.rows, lane.category)}
                                    >
                                      {areSavedPrepRowsChecked(lane.rows) ? 'Undo all' : 'All done'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="station-take-button"
                                      onClick={() => toggleLivePrepLaneDone(lane.tasks, lane.category)}
                                    >
                                      {areLivePrepLaneRowsChecked(lane.tasks) ? 'Undo all' : 'All done'}
                                    </button>
                                  )}
                                </div>
                                <div className="phase-task-list">
                                  {usingSavedPlanColumns
                                    ? lane.rows.map((row, rowIndex) => renderSavedPrepPlanCard(row, rowIndex, lane.category))
                                    : lane.tasks.map((task, taskIndex) => renderPrepRecipeCard(task, taskIndex, lane.category))}
                                </div>
                              </section>
                            ))
                          ) : (
                            <div className="phase-column-empty">
                              No active prep tasks are scheduled in this prep window yet.
                            </div>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                );
              }

              if (effectivePrepFocusMode === PREP_FOCUS_MODES.DAY_PART && (focusedDayPartBoard || selectedSavedPhaseBoard)) {
                const focusedLiveLaneCount = Array.isArray(focusedDayPartBoard?.lanes) ? focusedDayPartBoard.lanes.length : 0;
                const savedLaneCount = Array.isArray(selectedSavedPhaseBoard?.lanes) ? selectedSavedPhaseBoard.lanes.length : 0;
                const hasFocusedLiveRows = focusedLiveLaneCount > 0 && Number(focusedDayPartBoard?.totalTasks || 0) > 0;
                const hasSavedRows = savedLaneCount > 0 && Number(selectedSavedPhaseBoard?.totalRows || 0) > 0;
                const usingSavedPhaseBoard = !hasFocusedLiveRows && hasSavedRows;
                const resolvedFocusedDayPartBoard = usingSavedPhaseBoard
                  ? selectedSavedPhaseBoard
                  : focusedDayPartBoard;
                if (!usingSavedPhaseBoard && prepBoardGrouping === PREP_BOARD_GROUPINGS.TASK && focusedDayPartTaskModeLanes.length > 0) {
                  return (
                    <div className="category-scroll-strip">
                      {focusedDayPartTaskModeLanes.map((lane, index) => (
                        <section className="phase-column category-column filtered-phase-column active" key={`${focusedDayPartBoard.phaseKey}-taskmode-${lane.category}-${index}`}>
                          <div className="phase-column-head">
                            <div>
                              <div className="phase-task-group-title">{lane.category}</div>
                              <div className="phase-task-group-copy">{lane.loadLabel}</div>
                            </div>
                            <button
                              type="button"
                              className="station-take-button"
                              onClick={() => toggleLiveTaskModeItemsDone(lane.items, lane.category)}
                            >
                              {areLiveTaskModeItemsChecked(lane.items) ? 'Undo all' : 'All done'}
                            </button>
                          </div>
                          <div className="phase-column-body filtered-phase-column-body">
                            <section className="phase-task-group">
                              <div className="phase-task-list phase-task-list--task-mode">
                                {lane.items.map((item) => (
                                  renderPrepTaskModeRow(item.task, item.row, item.rowIndex, lane.category)
                                ))}
                              </div>
                            </section>
                          </div>
                        </section>
                      ))}
                    </div>
                  );
                }

                if ((prepBoardGrouping !== PREP_BOARD_GROUPINGS.TASK && (!Array.isArray(resolvedFocusedDayPartBoard?.lanes) || resolvedFocusedDayPartBoard.lanes.length === 0))
                  || (prepBoardGrouping === PREP_BOARD_GROUPINGS.TASK && focusedDayPartTaskModeLanes.length === 0 && (!usingSavedPhaseBoard || !Array.isArray(resolvedFocusedDayPartBoard?.lanes) || resolvedFocusedDayPartBoard.lanes.length === 0))) {
                  return (
                    <div className="phase-columns-board">
                      <section className="phase-column active">
                        <div className="phase-column-head">
                          <div>
                            <div className="phase-column-title">{resolvedFocusedDayPartBoard?.label || 'Selected prep window'}</div>
                            <div className="phase-column-sub">No active tasks in this prep window</div>
                          </div>
                        </div>
                        <div className="phase-column-body filtered-phase-column-body">
                          <div className="phase-column-empty">
                            No active prep tasks are scheduled here yet. Switch to another prep window or return to Full board.
                          </div>
                        </div>
                      </section>
                    </div>
                  );
                }
                return (
                  <div className="category-scroll-strip">
                    {resolvedFocusedDayPartBoard.lanes.map((lane, index) => (
                      <section className="phase-column category-column filtered-phase-column active" key={`${resolvedFocusedDayPartBoard.phaseKey}-${lane.category}-${index}`}>
                        <div className="phase-task-group-head">
                          <div>
                            <div className="phase-task-group-title">{lane.category}</div>
                            <div className="phase-task-group-copy">{lane.loadLabel}</div>
                          </div>
                          {usingSavedPhaseBoard ? (
                            <button
                              type="button"
                              className="station-take-button"
                              onClick={() => toggleSavedPrepRowsDone(lane.rows, lane.category)}
                            >
                              {areSavedPrepRowsChecked(lane.rows) ? 'Undo all' : 'All done'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="station-take-button"
                              onClick={() => toggleLivePrepLaneDone(
                                lane.tasks,
                                lane.category
                              )}
                            >
                              {areLivePrepLaneRowsChecked(lane.tasks) ? 'Undo all' : 'All done'}
                            </button>
                          )}
                        </div>
                        <div className="phase-column-body filtered-phase-column-body">
                          <section className="phase-task-group">
                            <div className="phase-task-list">
                              {usingSavedPhaseBoard
                                ? lane.rows.map((row, rowIndex) => renderSavedPrepPlanCard(row, rowIndex, lane.category, {
                                    taskFirst: prepBoardGrouping === PREP_BOARD_GROUPINGS.TASK
                                  }))
                                : lane.tasks.map((task, taskIndex) => renderPrepRecipeCard(task, taskIndex, lane.category))}
                            </div>
                          </section>
                        </div>
                      </section>
                    ))}
                  </div>
                );
              }

              if (displayProductionCategoryLanes.length > 0) {
                return (
                  <div className="category-scroll-strip">
                    {displayProductionCategoryLanes.map((lane, index) => (
                      <section className="phase-column category-column filtered-phase-column" key={`${lane.category}-${index}`}>
                        <div className="phase-task-group-head">
                          <div>
                            <div className="phase-task-group-title">{lane.category}</div>
                            <div className="phase-task-group-copy">{lane.loadLabel}</div>
                          </div>
                          <button
                            type="button"
                            className="station-take-button"
                            onClick={() => toggleLivePrepLaneDone(
                              lane.tasks,
                              lane.category
                            )}
                          >
                            {areLivePrepLaneRowsChecked(lane.tasks) ? 'Undo all' : 'All done'}
                          </button>
                        </div>
                        <div className="phase-column-body filtered-phase-column-body">
                          <section className="phase-task-group">
                            <div className="phase-task-list">
                              {lane.tasks.map((task, taskIndex) => renderPrepRecipeCard(task, taskIndex, lane.category))}
                            </div>
                          </section>
                        </div>
                      </section>
                    ))}
                  </div>
                );
              }

              if (showPrepBoardRecipePreview) {
                return (
                  <div className="category-scroll-strip">
                    {prepBoardPreviewLanes.map((lane, index) => (
                      <section className="phase-column category-column filtered-phase-column" key={`preview-${lane.category}-${index}`}>
                        <div className="phase-task-group-head">
                          <div>
                            <div className="phase-task-group-title">{lane.category}</div>
                            <div className="phase-task-group-copy">{lane.loadLabel}</div>
                          </div>
                          <div className="badge gold">Preview</div>
                        </div>
                        <div className="phase-column-body filtered-phase-column-body">
                          <section className="phase-task-group">
                            <div className="phase-task-list">
                              {lane.tasks.map((task, taskIndex) => renderPrepRecipeCard(task, taskIndex, lane.category))}
                            </div>
                          </section>
                        </div>
                      </section>
                    ))}
                  </div>
                );
              }

              if (showSavedPlanBoardFallback) {
                return (
                  <div className="phase-columns-board prep-board-planned-only">
                    <section className="phase-column planned-phase-column active">
                      <div className="phase-column-head">
                        <div>
                          <div className="phase-column-title">Scheduled recipes</div>
                          <div className="phase-column-sub">{savedPrepScheduleRows.length} saved from the prep schedule</div>
                        </div>
                      </div>
                      <div className="phase-column-body planned-phase-column-body">
                        <div className="phase-column-empty">
                          Live prep rows are not visible right now, but the saved recipe plan is still active below this surface.
                        </div>
                        <div className="phase-task-list">
                          {savedPrepScheduleRows.map((row, index) => (
                            <button
                              type="button"
                              key={`${row.recipeKey || row.title}-${index}`}
                              className={`prep-schedule-row prep-surface-button prep-schedule-row--board ${row.recipeKey && row.recipeKey === activeRecipeKey ? 'active' : ''}`.trim()}
                              onClick={() => {
                                if (!row.recipeKey) return;
                                focusPrepRecipeFromBoard({
                                  recipeKey: row.recipeKey,
                                  recipeName: row.title,
                                  message: `${row.title} moved into Chef Focus from the prep schedule.`,
                                  tone: 'info',
                                  viewId: DASHBOARD_VIEWS.BOARD,
                                  detail: buildPrepBoardDetail({
                                    title: row.title,
                                    badge: row.badge || 'Prep saved',
                                    type: 'good',
                                    source: 'Prep schedule',
                                    summary: row.detail || row.meta,
                                    detail: `${row.title} is currently included in the saved prep schedule.`,
                                    chips: [row.quantityLabel || row.count || '', scheduleWindowLabel].filter(Boolean),
                                    notes: [
                                      'Saved prep plan is active for this recipe.',
                                      'Live prep rows are temporarily missing from the board.'
                                    ]
                                  })
                                });
                              }}
                              disabled={!row.recipeKey}
                            >
                              <div className="prep-schedule-row-main">
                                <div className="prep-schedule-row-title">{row.title}</div>
                                <div className="prep-schedule-row-meta">{row.meta}</div>
                              </div>
                              <div className="prep-schedule-row-count">{row.count}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                );
              }

              return (
                <section className="station-column station-column-empty">
                  <div className="prep-empty-grid">
                    <div className="prep-empty-guide">
                      {prepEmptyGuidance.map((item, index) => (
                        <div className="prep-empty-step" key={item.title}>
                          <div className="prep-empty-step-number">{index + 1}</div>
                          <div>
                            <div className="prep-empty-step-title">{item.title}</div>
                            <div className="prep-empty-step-copy">{item.copy}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="prep-empty-preview">
                      <div className="section-label">Ready from Recipe Truth</div>
                      <div className="prep-empty-preview-copy">
                        These recipes are already in the live library. Pick one in Recipe Truth or Prep Add, then return here once it is saved into the prep board.
                      </div>
                      <div className="phase-task-list">
                        {prepEmptyRecipePreviewRows.length > 0 ? prepEmptyRecipePreviewRows.map((row, index) => (
                          <button
                            type="button"
                            key={`${row.recipeKey || row.title}-${index}`}
                            className="prep-schedule-row prep-surface-button prep-schedule-row--board"
                            onClick={() => {
                              if (!row.recipeKey) return;
                              focusPrepRecipeFromBoard({
                                recipeKey: row.recipeKey,
                                recipeName: row.title,
                                message: `${row.title} is ready in Recipe Truth. Send it to Prep Add to start the board flow.`,
                                tone: 'info',
                                viewId: DASHBOARD_VIEWS.BOARD,
                                detail: buildPrepBoardDetail({
                                  title: row.title,
                                  badge: 'Recipe ready',
                                  type: 'warm',
                                  source: 'Recipe Truth',
                                  summary: row.meta,
                                  detail: `${row.title} exists in the recipe library but is not yet saved into the prep board plan.`,
                                  chips: [row.count || 'Plan'].filter(Boolean),
                                  notes: ['Open Recipe Truth or Prep Add to place this recipe into today’s prep board.']
                                })
                              });
                            }}
                          >
                            <div className="prep-schedule-row-main">
                              <div className="prep-schedule-row-title">{row.title}</div>
                              <div className="prep-schedule-row-meta">{row.meta}</div>
                            </div>
                            <div className="prep-schedule-row-count">{row.count}</div>
                          </button>
                        )) : (
                          <div className="phase-column-empty">
                            No recipes are ready in Recipe Truth yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}
          </div>
        </section>

        <aside className="prep-context" aria-label="Prep board context">
          <div className="block-head">
            <div>
              <div className="block-title">Chef Focus</div>
              <div className="block-sub">Keep one task in focus and continue the work from here.</div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                type="button" 
                className="context-close-button" 
                onClick={handleClosePrepContext}
                aria-label="Close panel"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="focus-list">
            {selectedPrepTaskCount > 0 && !showBeforeServiceFocusPanel ? (
              <div className="focus-card good focus-card--compact">
                <div className="row-top">
                  <div className="focus-title">Taken now</div>
                  <div className="badge good">{selectedPrepTaskLabel}</div>
                </div>
                <div className="focus-copy">
                  {`${selectedPrepTaskCount} task${selectedPrepTaskCount === 1 ? '' : 's'} selected${selectedPrepTaskMinutes > 0 ? ` / ${selectedPrepTaskMinutes} min` : ''}.`}
                </div>
                <div className="focus-task-list">
                  {selectedPrepTasks.slice(0, 3).map((task) => (
                    <div className="focus-task-row" key={`selected-${task.id || task.recipeKey}`}>
                      <div>
                        <div className="focus-task-title">{formatPrepDisplayName(task?.name || 'Task')}</div>
                        <div className="focus-task-meta">
                          {[task?.station || '', getPrepWindowLabel(task), Number(task?.prepTimeMinutes || 0) > 0 ? `${Number(task.prepTimeMinutes)} min` : ''].filter(Boolean).join(' / ')}
                        </div>
                      </div>
                      <div className="badge">{isDependencyBlocked(task) ? 'Blocked' : 'Taken'}</div>
                    </div>
                  ))}
                  {selectedPrepTasks.length > 3 ? (
                    <div className="focus-note">{`+${selectedPrepTasks.length - 3} more taken task${selectedPrepTasks.length - 3 === 1 ? '' : 's'}`}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {showBeforeServiceFocusPanel ? (
              <>
                <div className="focus-card warm">
                  <div className="row-top">
                    <div className="focus-title">Service readiness</div>
                    <div className="badge gold">Before service</div>
                  </div>
                  <div className="focus-metric-grid">
                    <div className="focus-metric-card">
                      <div className="focus-metric-label">Service start</div>
                      <input
                        className="focus-metric-input"
                        type="text"
                        value={serviceTimeLabel}
                        placeholder="N"
                        onChange={(event) => setServiceTimeLabel(event.target.value)}
                      />
                    </div>
                    <div className="focus-metric-card">
                      <div className="focus-metric-label">Covers</div>
                      <input
                        className="focus-metric-input"
                        type="number"
                        min="0"
                        value={serviceBookingCount}
                        placeholder="N"
                        onChange={(event) => setServiceBookingCount(event.target.value)}
                      />
                    </div>
                    <div className="focus-metric-card">
                      <div className="focus-metric-label">Ready now</div>
                      <div className="focus-metric-value">{String(beforeServiceSummary.readyRecipes || 0)}</div>
                      <div className="focus-metric-subvalue">Completed before-service dishes</div>
                    </div>
                    <div className="focus-metric-card">
                      <div className="focus-metric-label">Ready / total</div>
                      <div className="focus-metric-value">{`${String(beforeServiceSummary.readyRecipes || 0)}/${String(beforeServiceSummary.totalRecipes || 0)}`}</div>
                      <div className="focus-metric-subvalue">Progress across today&apos;s service dishes</div>
                    </div>
                  </div>
                  <div className="focus-note focus-note--soft">
                    {beforeServiceSummary.totalRecipes > 0
                      ? `${beforeServiceSummary.readyRecipes}/${beforeServiceSummary.totalRecipes} means how many before-service dishes are fully finished right now.`
                      : 'Before-service progress appears here once service dishes are on the board.'}
                  </div>
                  <div className="focus-section">
                    <div className="focus-section-title">Ready</div>
                    <div className="focus-ready-strip">
                      {beforeServiceSummary.readyRows.length > 0 ? beforeServiceSummary.readyRows.map((row) => (
                        <div className="focus-ready-pill" key={`ready-${row.station}`}>
                          <span className="focus-ready-dot" />
                          <span>{row.station}</span>
                        </div>
                      )) : (
                        <div className="focus-section-item focus-section-item--detail">N</div>
                      )}
                    </div>
                  </div>
                  <div className="focus-section">
                    <div className="focus-section-title">Station demand</div>
                    <div className="focus-section-list">
                      {beforeServiceDemandRows.length > 0 ? beforeServiceDemandRows.map((row) => (
                        <div className="focus-section-item focus-section-item--detail" key={`demand-${row.station}`}>
                          <div className="focus-demand-row">
                            <span className="focus-demand-station">{row.station}</span>
                            <span className={`badge ${row.readiness === 'ready' ? 'good' : (row.readiness === 'risk' ? 'gold' : 'red')}`.trim()}>
                              {row.readiness === 'ready' ? 'Ready' : (row.readiness === 'risk' ? 'Risk' : 'Not ready')}
                            </span>
                          </div>
                          <div className="focus-section-button-sub">
                            {`${row.demandPct}% / prep total: ${row.prepPortions || 0} portion${row.prepPortions === 1 ? '' : 's'}${Number(serviceBookingCount || 0) > 0 ? ` / ${Number(serviceBookingCount || 0)} people x ${row.demandPct}%` : ''}`}
                          </div>
                        </div>
                      )) : (
                        <div className="focus-section-item focus-section-item--detail">N</div>
                      )}
                    </div>
                  </div>
                  {(beforeServiceSummary.riskRows.length > 0 || beforeServiceSummary.notReadyRows.length > 0) ? (
                    <div className="focus-note-list">
                      <div className="focus-note">
                        {`${beforeServiceSummary.riskRows.length + beforeServiceSummary.notReadyRows.length} station${beforeServiceSummary.riskRows.length + beforeServiceSummary.notReadyRows.length === 1 ? '' : 's'} still open. Use the urgent board in the main page to finish service prep.`}
                      </div>
                    </div>
                  ) : null}
                  <div className="focus-section">
                    <div className="focus-section-title">FOH service brief</div>
                    <div className="focus-brief-grid">
                      {SERVICE_BRIEF_FIELDS.map((field) => (
                        <label className="focus-brief-field" key={field.key}>
                          <span className="focus-brief-label">{field.label}</span>
                          <input
                            className="focus-metric-input"
                            type="text"
                            value={serviceBrief[field.key]}
                            placeholder={field.placeholder}
                            onChange={(event) => setServiceBrief((current) => ({
                              ...current,
                              [field.key]: event.target.value
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="focus-section-item focus-section-item--detail">
                      {serviceBriefPreview.length > 0 ? (
                        <>
                          <div className="focus-brief-preview-title">Structured handoff</div>
                          <div className="focus-brief-preview-list">
                            {serviceBriefPreview.map((line) => (
                              <div key={line}>{line}</div>
                            ))}
                          </div>
                        </>
                      ) : (
                        'Front of house can leave structured shift context here: birthdays, guest mix, allergies, and what kitchen should push first.'
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : showSelectedPrepDaySummaryPanel ? (
              <div className="focus-card warm">
                <div className="row-top">
                  <div className="focus-title">
                    {selectedPrepDayCell ? `${selectedPrepDayCell.label} service summary` : 'Selected day summary'}
                  </div>
                  <div className="badge gold">Full board</div>
                </div>
                <div className="focus-kicker">
                  {selectedPrepDayCell
                    ? `${selectedPrepDayCell.dateLabel} / ${selectedPrepDayCell.loadLabel || 'Selected prep day'}`
                    : 'Selected prep day'}
                </div>
                {selectedPrepDayTasks.length > 0 ? (
                  <>
                    <div className="focus-metric-grid">
                      {selectedPrepDayPartRows.map((row) => (
                        <div className="focus-metric-card" key={`phase-summary-${row.key}`}>
                          <div className="focus-metric-label">{row.label}</div>
                          <div className="focus-metric-value">{String(row.totalCount || 0)}</div>
                          <div className="focus-metric-subvalue">{`${row.doneCount} done`}</div>
                        </div>
                      ))}
                    </div>
                    <div className="focus-section">
                      <div className="focus-section-title">Important today</div>
                      <div className="focus-section-list">
                        <div className="focus-section-item focus-section-item--detail">
                          {selectedPrepDayPriorityTask ? (
                            <>
                              <div className="focus-demand-row">
                                <span className="focus-demand-station">{selectedPrepDayPriorityTask.title}</span>
                                <span className="badge red">{selectedPrepDayPriorityTask.source}</span>
                              </div>
                              <div className="focus-section-button-sub">{`${selectedPrepDayPriorityTask.station || 'General Prep'} / ${selectedPrepDayPriorityTask.portions || 0} portions`}</div>
                              <div className="focus-section-button-sub">{`${selectedPrepDayPriorityTask.weight || 'Weight not saved'} total weight`}</div>
                            </>
                          ) : (
                            'No active prep is waiting right now.'
                          )}
                        </div>
                        {selectedPrepDayNotes.slice(0, 2).map((note, noteIndex) => (
                          <div className="focus-section-item focus-section-item--detail" key={`selected-day-service-note-${noteIndex}`}>{note}</div>
                        ))}
                      </div>
                    </div>
                    {selectedPrepDaySummaryStats.shortLifeCount > 0 ? (
                      <div className="focus-note-list">
                        <div className="focus-note">
                          {`${selectedPrepDaySummaryStats.shortLifeCount} completed prep item${selectedPrepDaySummaryStats.shortLifeCount === 1 ? '' : 's'} have 1-day or shorter storage. POS sell-through and leftover carry-over are not live yet, so the chef should manually watch same-day sell or waste risk.`}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="focus-note focus-note--soft">
                      No prep is currently planned for this selected day. Showing the saved day note instead.
                    </div>
                    <div className="focus-section">
                      <div className="focus-section-title">Day note</div>
                      <div className="focus-section-list">
                        {selectedPrepDayNotes.length > 0 ? selectedPrepDayNotes.map((note, noteIndex) => (
                          <div className="focus-section-item focus-section-item--detail" key={`selected-day-note-${noteIndex}`}>{note}</div>
                        )) : (
                          <div className="focus-section-item focus-section-item--detail">No event, booking, or service note is currently saved for this day.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : prepBoardDetail ? (
              <div className={`focus-card ${prepBoardDetail.type || 'warm'}`.trim()}>
                <div className="row-top">
                  <div className="focus-title">{prepBoardDetail.title}</div>
                  <div className={prepBoardDetail.type === 'alert' ? 'badge red' : prepBoardDetail.type === 'good' ? 'badge good' : 'badge gold'}>
                    {prepBoardDetail.badge || 'Detail'}
                  </div>
                </div>
                {prepBoardDetail.source ? (
                  <div className="focus-kicker">{prepBoardDetail.source}</div>
                ) : null}
                <ProfileReviewCard
                  reviewState={focusedPrepReviewState}
                  title="Generated prep review"
                  compact
                  restricted
                />
                {(prepBoardDetail.prepEstimate || prepBoardDetail.recipeCategory || prepBoardDetail.storageShelfLifeHours || prepBoardDetail.storageLabel) ? (
                  <div className="focus-metric-grid">
                    {prepBoardDetail.prepEstimate ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Estimate</div>
                        <div className="focus-metric-value">{prepBoardDetail.prepEstimate}</div>
                      </div>
                    ) : null}
                    {prepBoardDetail.recipeCategory ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Category</div>
                        <div className="focus-metric-value">{prepBoardDetail.recipeCategory}</div>
                      </div>
                    ) : null}
                    {prepBoardDetail.storageShelfLifeHours ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Shelf Life</div>
                        <div className="focus-metric-value">{prepBoardDetail.storageShelfLifeHours}</div>
                        <div className="focus-metric-subvalue">{prepBoardDetail.storageLabel || 'Not listed'}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {prepBoardDetail.skillLevels.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Skill Level</div>
                    <div className="focus-section-list">
                      <div className="focus-section-item focus-section-item--detail">{prepBoardDetail.skillLevels.join(' / ')}</div>
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.detail ? (
                  <div className="focus-detail">{prepBoardDetail.detail}</div>
                ) : null}
                {prepBoardDetail.chips.length > 0 ? (
                  <div className="prep-plan-chip-row">
                    {prepBoardDetail.chips.slice(0, 3).map((chip) => (
                      <div className="badge" key={`${prepBoardDetail.title}-${chip}`}>{chip}</div>
                    ))}
                  </div>
                ) : null}
                {prepBoardDetail.prepIntelligenceRows.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Prep guidance</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.prepIntelligenceRows.slice(0, 4).map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardDetail.title}-prep-guidance-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.taskRows.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Prep Task Rows</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.taskRows.map((row, rowIndex) => {
                        const sourceIndexes = Array.isArray(row?.sourceIndexes) && row.sourceIndexes.length > 0
                          ? row.sourceIndexes
                          : [];
                        const isBoundToStep = sourceIndexes.length > 0;
                        const isChecked = isBoundToStep ? arePrepStepIndexesChecked(prepBoardDetail.taskId, sourceIndexes) : false;
                        const rowMeta = buildPrepTaskRowContext(row, { includeHold: true, maxParts: 5 });
                        return (
                          <div className={`task-action-card ${!isBoundToStep ? 'unbound' : ''}`.trim()} key={`${prepBoardDetail.title}-row-${row.id || rowIndex}`}>
                            <button
                              type="button"
                              className={`task-bullet-checkbox ${isChecked ? 'checked' : ''}`.trim()}
                              aria-pressed={isChecked}
                              aria-label={`${isBoundToStep ? (isChecked ? 'Uncheck' : 'Check') : 'Review only'} ${row.taskName}`}
                              onClick={() => {
                                if (!isBoundToStep) return;
                                togglePrepStepGroupChecked(prepBoardDetail.taskId, sourceIndexes);
                              }}
                              disabled={!isBoundToStep}
                            />
                            <button
                              type="button"
                              className="task-action-main prep-card-button"
                              onClick={() => {
                                if (focusedPrepTask) {
                                  openPrepTaskInFocus(focusedPrepTask, {
                                    source: prepBoardDetail.badge,
                                    selectedStep: row.taskName
                                  });
                                }
                              }}
                            >
                              <span className="task-action-copy">
                                <span className="task-bullet-item">{row.taskName}</span>
                                {rowMeta ? <span className="task-action-context">{rowMeta}</span> : null}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : prepBoardDetail.executionSteps.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Prep Task Rows</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.executionSteps.slice(0, 8).map((step, stepIndex) => (
                        <div className="focus-section-item focus-section-item--strong" key={`${prepBoardDetail.title}-step-${stepIndex}`}>{step}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.criticalChecks.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Critical Checks</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.criticalChecks.slice(0, 5).map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardDetail.title}-critical-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {(prepBoardDetail.storageLabel || prepBoardDetail.storageShelfLifeHours) ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Storage</div>
                    <div className="focus-section-list">
                      <div className="focus-section-item focus-section-item--detail">
                        {[prepBoardDetail.storageLabel || 'Not listed', prepBoardDetail.storageShelfLifeHours || 'Shelf life not listed'].filter(Boolean).join(' / ')}
                      </div>
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.foodSafetyChecks.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Food Safety CCP</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.foodSafetyChecks.map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardDetail.title}-food-safety-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.equipment.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Equipment</div>
                    <div className="focus-section-list">
                      {prepBoardDetail.equipment.slice(0, 5).map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardDetail.title}-equipment-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardDetail.notes.length > 0 ? (
                  <div className="focus-note-list">
                    {prepBoardDetail.notes.slice(0, 2).map((note, noteIndex) => (
                      <div className="focus-note" key={`${prepBoardDetail.title}-${noteIndex}`}>{note}</div>
                    ))}
                  </div>
                ) : null}
                {prepBoardDetail.taskId ? (
                  <div className="prep-actions" style={{ padding: 0, marginTop: '12px' }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => handleFocusAdjacentPrepTask(-1)}
                      disabled={focusedPrepTaskIndex <= 0}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={handleCompletePrepTask}
                    >
                      {prepBoardDetail.isCompleted ? 'Mark not complete' : 'Mark complete'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => handleFocusAdjacentPrepTask(1)}
                      disabled={focusedPrepTaskIndex === -1 || focusedPrepTaskIndex >= displayVisiblePrepTasks.length - 1}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            ) : showPrepBoardRecipePreview && prepBoardPreviewFocusDetail ? (
              <div className={`focus-card ${prepBoardPreviewFocusDetail.type || 'warm'}`.trim()}>
                <div className="row-top">
                  <div className="focus-title">{prepBoardPreviewFocusDetail.title}</div>
                  <div className="badge gold">Recipe ready</div>
                </div>
                {prepBoardPreviewFocusDetail.source ? (
                  <div className="focus-kicker">{prepBoardPreviewFocusDetail.source}</div>
                ) : null}
                {(prepBoardPreviewFocusDetail.prepEstimate || prepBoardPreviewFocusDetail.recipeCategory || prepBoardPreviewFocusDetail.storageShelfLifeHours || prepBoardPreviewFocusDetail.storageLabel) ? (
                  <div className="focus-metric-grid">
                    {prepBoardPreviewFocusDetail.prepEstimate ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Estimate</div>
                        <div className="focus-metric-value">{prepBoardPreviewFocusDetail.prepEstimate}</div>
                      </div>
                    ) : null}
                    {prepBoardPreviewFocusDetail.recipeCategory ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Category</div>
                        <div className="focus-metric-value">{prepBoardPreviewFocusDetail.recipeCategory}</div>
                      </div>
                    ) : null}
                    {prepBoardPreviewFocusDetail.storageShelfLifeHours ? (
                      <div className="focus-metric-card">
                        <div className="focus-metric-label">Shelf Life</div>
                        <div className="focus-metric-value">{prepBoardPreviewFocusDetail.storageShelfLifeHours}</div>
                        <div className="focus-metric-subvalue">{prepBoardPreviewFocusDetail.storageLabel || 'Not listed'}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {prepBoardPreviewFocusDetail.taskRows.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Prep Task Rows</div>
                    <div className="focus-section-list">
                      {prepBoardPreviewFocusDetail.taskRows.slice(0, 4).map((row, rowIndex) => {
                        const isChecked = isPrepStepChecked(prepBoardPreviewFocusDetail.taskId, rowIndex);
                        const rowMeta = [
                          row?.estimatedMinutes ? `${row.estimatedMinutes} min` : '',
                          row?.category || '',
                          row?.skillLevel || ''
                        ].filter(Boolean).join(' / ');
                        return (
                          <div className="task-action-card" key={`${prepBoardPreviewFocusDetail.title}-preview-row-${row.id || rowIndex}`}>
                            <button
                              type="button"
                              className={`task-bullet-checkbox ${isChecked ? 'checked' : ''}`.trim()}
                              aria-pressed={isChecked}
                              aria-label={`${isChecked ? 'Uncheck' : 'Check'} ${row.taskName}`}
                              onClick={() => togglePrepStepChecked(prepBoardPreviewFocusDetail.taskId, rowIndex)}
                            />
                            <button
                              type="button"
                              className="task-action-main prep-card-button"
                              onClick={() => {
                                if (prepBoardPreviewFocusTask) {
                                  focusPrepRecipeFromBoard({
                                    recipeKey: prepBoardPreviewFocusTask.recipeKey,
                                    recipeName: prepBoardPreviewFocusTask.name,
                                    message: `${formatPrepDisplayName(prepBoardPreviewFocusTask.name)} moved into Chef Focus from Recipe Truth preview.`,
                                    tone: 'info',
                                    viewId: DASHBOARD_VIEWS.BOARD,
                                    detail: {
                                      ...prepBoardPreviewFocusDetail,
                                      detail: row.taskName
                                    }
                                  });
                                }
                              }}
                            >
                              <span className="task-action-copy">
                                <span className="task-bullet-item">{row.taskName}</span>
                                {rowMeta ? <span className="task-action-context">{rowMeta}</span> : null}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {prepBoardPreviewFocusDetail.criticalChecks.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Critical Checks</div>
                    <div className="focus-section-list">
                      {prepBoardPreviewFocusDetail.criticalChecks.map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardPreviewFocusDetail.title}-preview-critical-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardPreviewFocusDetail.foodSafetyChecks.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Food Safety CCP</div>
                    <div className="focus-section-list">
                      {prepBoardPreviewFocusDetail.foodSafetyChecks.map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardPreviewFocusDetail.title}-preview-food-safety-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {prepBoardPreviewFocusDetail.equipment.length > 0 ? (
                  <div className="focus-section">
                    <div className="focus-section-title">Equipment</div>
                    <div className="focus-section-list">
                      {prepBoardPreviewFocusDetail.equipment.slice(0, 5).map((item, itemIndex) => (
                        <div className="focus-section-item focus-section-item--detail" key={`${prepBoardPreviewFocusDetail.title}-preview-equipment-${itemIndex}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="focus-note-list">
                  <div className="focus-note">
                    This recipe is already linked to Workflow 2 prep content. Save it into the prep board plan to turn this preview into a live working task lane.
                  </div>
                </div>
              </div>
            ) : (
              <div className={`focus-card ${activePrepPlan ? 'good' : 'warm'}`.trim()}>
                <div className="row-top">
                  <div className="focus-title">{activePrepPlanSummary?.title || activeRecipe?.name || activeRecipe?.title || 'Chef Focus'}</div>
                  <div className={activePrepPlan ? 'badge good' : 'badge gold'}>
                    {activePrepPlan ? 'Planned' : 'No plan'}
                  </div>
                </div>
                <div className="focus-kicker">{activePrepPlanSummary?.modeLabel || 'Prep schedule'}</div>
                <div className="focus-detail">
                  {activePrepPlanSummary?.detail || 'Choose a phase and open a recipe or task to continue the work from here.'}
                </div>
                {activePrepPlanSummary?.badges?.length ? (
                  <div className="prep-plan-chip-row">
                    {activePrepPlanSummary.badges.slice(0, 3).map((chip) => (
                      <div className="badge" key={`prep-focus-default-${chip}`}>{chip}</div>
                    ))}
                  </div>
                ) : null}
                <div className="focus-note-list">
                  <div className="focus-note">
                    {activePrepPlan
                      ? 'Use Morning, Afternoon, or Before service, then switch between By station and By task to review the saved prep work.'
                      : 'Pick recipes in Recipe Truth or Prep Add, then return here to work the board by phase.'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {prepActionNotice?.message && (
            <div className={`queue-notice ${prepActionNotice?.tone || ''}`} style={{ margin: '0 12px 12px' }}>
              {prepActionNotice.message}
            </div>
          )}

        </aside>
      </section>
            )}

            {view === DASHBOARD_VIEWS.PRESENTATION && (
                <section
                    className={`training-view page-view ${trainingModeIsStaff ? 'staff-mode' : 'manager-mode'}`.trim()}
                    id={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.PRESENTATION]}
                    role="tabpanel"
                    aria-labelledby={`${DASHBOARD_VIEWS.PRESENTATION}-tab`}
                    tabIndex={-1}
                >
        <aside className="training-rail" aria-label="Prep board recipe list">
          <div className="panel-head">
            <div className="eyebrow">SOP Training</div>
            <div className="h1">Prep Board recipes</div>
            <div className="copy">Choose a recipe from the live Prep Board list.</div>
          </div>

          <div className="training-list">
            <div className="section-label">Category</div>
            <div className="mini-toggle-group training-category-filter" role="tablist" aria-label="Prep recipe category filter">
              <button
                type="button"
                className={`mini-toggle ${trainingRecipeCategoryFilter === 'all' ? 'active' : ''}`.trim()}
                onClick={() => setTrainingRecipeCategoryFilter('all')}
              >
                All
              </button>
              {trainingRecipeCategoryOptions.map((category) => (
                <button
                  key={`training-category-${category}`}
                  type="button"
                  className={`mini-toggle ${trainingRecipeCategoryFilter === category ? 'active' : ''}`.trim()}
                  onClick={() => setTrainingRecipeCategoryFilter(category)}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="section-label">Chosen prep recipes</div>
            {visibleTrainingPrepBoardRecipeRows.length > 0 ? visibleTrainingPrepBoardRecipeRows.map((row) => {
              const isActive = String(row.recipeKey || '') === String(activeRecipeKey || '');
              return (
                <button
                  key={`training-prep-recipe-${row.recipeKey}`}
                  type="button"
                  className={`training-recipe-row ${isActive ? 'active' : ''}`.trim()}
                  aria-pressed={isActive}
                  onClick={() => {
                    const selectedRecipeEntry = Array.isArray(visibleRecipes)
                      ? visibleRecipes.find((recipe, index) => getRecipeKey(recipe, `idx-${index}`) === row.recipeKey)
                      : null;
                    if (selectedRecipeEntry) {
                      recordRecipeActivity(selectedRecipeEntry, row.recipeKey);
                    }
                    setSelectedId(row.recipeKey);
                  }}
                >
                  <span className="training-recipe-row-title">{row.title}</span>
                </button>
              );
            }) : (
              <div className="source-card">
                <div className="row-top">
                  <div className="row-title">No prep board recipes yet</div>
                  <div className="badge gold">Empty</div>
                </div>
                <div className="row-meta">Add recipes to the Prep Board first, then this SOP rail will list only those chosen recipes.</div>
              </div>
            )}
          </div>

          <div className="library-foot">
            <div className="handoff-row">
              <div className="row-top">
                <div className="row-title">Workflow source</div>
                <div className="badge good">{workflow3ExtendedProfile ? 'WF2 + WF3' : 'WF2 linked'}</div>
              </div>
              <div className="row-meta">WF2 owns the SOP lesson. WF3 appears only when advanced chef guidance exists.</div>
            </div>
          </div>
        </aside>

        <section className="training-main" aria-label="Recipe training lesson">
          <div className="training-hero">
            <div className="training-hero-copy">
              <div className="eyebrow">Chef lesson / workflow-linked recipe</div>
              <div className="command-title">{recipeTitle}</div>
              <div className="hero-meta">
                <span className="badge gold">Category: {activeRecipe?.category || 'General'}</span>
                <span className="badge gold">Style / Station: {activeRecipe?.style || activeRecipe?.dishStyle || 'Kitchen Standard'}</span>
                <span className="badge">Allergen: {trainingSupport.allergenLabel}</span>
                <span className="badge">Lesson: {sopLessonTitle}</span>
                <span className="badge">Profile {trainingSupport.versionLabel}</span>
              </div>
              <div className="copy">{trainingSupport.heroCopy}</div>
              <div className="copy">This page is for chef learning. Prep Board stays short and task-focused, while SOP Training keeps the method, scale rule, eco-prep note, safety, and finish guidance together.</div>
            </div>
            <div className="training-note-card training-video-card">
              <div className="row-top">
                <div className="focus-title">Future prep video</div>
                <div className="badge">Future block</div>
              </div>
              <div className="focus-copy">Reserve this space for a future prep-video field such as `prep_video_url` or a linked training clip. The placement is sized for chef viewing, but this thread is not inventing a backend field.</div>
              <div className="training-video-placeholder">
                <div className="focus-copy" style={{ textAlign: 'center', maxWidth: '320px' }}>
                  Future chef prep video placement
                </div>
              </div>
            </div>
          </div>

          <div className="step-grid">
            <div className="training-steps" aria-label="Training steps">
              <div className="training-note-card">
                <div className="row-top">
                  <div className="focus-title">Instruction</div>
                  <div className={`badge ${trainingModeIsStaff ? (trainingExecutionSupport.completionState === 'completed' ? 'good' : 'gold') : trainingManagerSupport.reviewTone}`.trim()}>
                    {trainingModeIsStaff ? trainingExecutionSupport.readinessBadge : trainingManagerSupport.reviewBadge}
                  </div>
                </div>
                <div className="focus-copy">
                  {trainingModeIsStaff ? trainingExecutionSupport.readinessCopy : trainingManagerSupport.reviewCopy}
                </div>
              </div>
              {sopTrainingSections.map((section, index) => (
                <div className="training-step" key={section.id || `training-step-${index}`}>
                  <div className="step-number">{index + 1}</div>
                  <div>
                    <div className="step-title">{section.title || `Section ${index + 1}`}</div>
                    <div className="step-copy">{section.copy || 'Section detail not listed yet.'}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="training-notes" aria-label="Training reference">
              <div className="section-label">Key learning points</div>
              <div className="focus-section-list">
                {sopTrainingKeyPoints.length > 0 ? sopTrainingKeyPoints.map((point, index) => (
                  <div className="focus-section-item focus-section-item--strong" key={`training-key-${index}`}>{point}</div>
                )) : (
                  <div className="focus-section-item focus-section-item--detail">Training key points are not listed yet.</div>
                )}
              </div>

              <div className="section-label">Operational teaching</div>
              <div className="training-note-card">
                <div className="row-top">
                  <div className="focus-title">{sopEcoPrepRows.length > 0 ? 'Scale and eco-prep rule' : 'Scale rule'}</div>
                  <div className="badge gold">{sopEcoPrepRows.length > 0 ? 'WF2 + eco prep' : 'WF2'}</div>
                </div>
                <div className="focus-copy">
                  Scale rule explains when method changes. Eco prep is optional and should only appear when workflow data provides a faster or lower-cost prep rule without changing the intended outcome too far.
                </div>
                <div className="focus-section-list" style={{ marginTop: '12px' }}>
                  {sopOperationalRows.length > 0 ? sopOperationalRows.map((item, index) => (
                    <div className="focus-section-item focus-section-item--detail" key={`sop-operational-${index}`}>{item}</div>
                  )) : (
                    <div className="focus-section-item focus-section-item--detail">Operational teaching is not listed yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="training-proof" aria-label="Chef knowledge and operational panel">
          <div className="proof-list">
            <ProfileReviewCard
              reviewState={activeGeneratedProfileReviewState}
              title="Generated lesson review"
              compact
              restricted={trainingModeIsStaff}
            />
            <div className="proof-card">
              <div className="row-top">
                <div className="focus-title">Critical checks</div>
                <div className={`badge ${sopCriticalChecks.length > 0 ? 'gold' : ''}`.trim()}>{sopCriticalChecks.length > 0 ? `${sopCriticalChecks.length} checks` : 'Not listed'}</div>
              </div>
              <div className="proof-check">
                {sopCriticalChecks.length > 0 ? sopCriticalChecks.map((item, index) => (
                  <div className="check-row" key={`critical-${index}`}>{item}</div>
                )) : (
                  <div className="check-row">Critical checks are not listed yet.</div>
                )}
              </div>
            </div>

            <div className="proof-card">
              <div className="row-top">
                <div className="focus-title">Food safety CCP</div>
                <div className={`badge ${sopFoodSafetyCcp.length > 0 ? 'red' : 'gold'}`.trim()}>{sopFoodSafetyCcp.length > 0 ? `${sopFoodSafetyCcp.length} CCP` : 'Not listed'}</div>
              </div>
              <div className="proof-check">
                {sopFoodSafetyCcp.length > 0 ? sopFoodSafetyCcp.map((item, index) => (
                  <div className="check-row" key={`ccp-${index}`}>{item}</div>
                )) : (
                  <div className="check-row">Food safety CCP is not listed yet.</div>
                )}
              </div>
            </div>

            <div className="proof-card">
              <div className="row-top">
                <div className="focus-title">Storage life</div>
                <div className="badge good">{sopStorageShelfLifeHours ? `${sopStorageShelfLifeHours} hr` : 'Not listed'}</div>
              </div>
              <div className="focus-copy">{sopStorageLabel || 'Storage label is not listed yet.'}</div>
              <div className="proof-check">
                {sopStorageShelfLifeHours ? (
                  <div className="check-row">{`${sopStorageShelfLifeHours} hours shelf life`}</div>
                ) : (
                  <div className="check-row">Storage shelf life is not listed yet.</div>
                )}
              </div>
            </div>

            <div className="proof-card">
              <div className="row-top">
                <div className="focus-title">Prep intelligence</div>
                <div className="badge gold">{sopPrepIntelRows.length > 0 ? `${sopPrepIntelRows.length} linked` : 'Not listed'}</div>
              </div>
              <div className="proof-check">
                {sopPrepIntelRows.length > 0 ? sopPrepIntelRows.map((item, index) => (
                  <div className="check-row" key={`prep-intel-${index}`}>{item}</div>
                )) : (
                  <div className="check-row">Prep intelligence is not listed yet.</div>
                )}
              </div>
            </div>

            {sopHasAdvancedContent ? (
              <div className="proof-card">
                <div className="row-top">
                  <div className="focus-title">Advanced kitchen guidance</div>
                  <div className="badge gold">WF3</div>
                </div>
                <div className="proof-check">
                  {sopAdvancedRows.flatMap((section) => (
                    section.rows.map((row, index) => (
                      <div className="check-row" key={`${section.title}-${index}`}>{`${section.title}: ${row}`}</div>
                    ))
                  ))}
                </div>
              </div>
            ) : null}

            <div className="proof-card">
              <div className="row-top">
                <div className="focus-title">Lesson status</div>
                <div className={`badge ${trainingModeIsStaff ? (trainingExecutionSupport.completionState === 'completed' ? 'good' : 'gold') : trainingManagerSupport.reviewTone}`.trim()}>
                  {trainingModeIsStaff ? trainingExecutionSupport.readinessBadge : trainingManagerSupport.reviewBadge}
                </div>
              </div>
              <div className="focus-copy">{trainingModeIsStaff ? trainingExecutionSupport.readinessCopy : trainingManagerSupport.reviewCopy}</div>
            </div>
          </div>

          <div className="prep-actions">
            <button className="button" type="button" onClick={resetTrainingSession}>Reset lesson</button>
            <button className="button primary" type="button" onClick={markTrainingComplete} disabled={!trainingExecutionSupport.canComplete}>
              {trainingExecutionSupport.completionState === 'completed' ? 'Completed' : 'Mark complete'}
            </button>
          </div>
        </aside>
      </section>
            )}

            {view === DASHBOARD_VIEWS.ORDERING && (
                <section
                    className="bom-view page-view"
                    id={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.ORDERING]}
                    role="tabpanel"
                    aria-labelledby={`${DASHBOARD_VIEWS.ORDERING}-tab`}
                    tabIndex={-1}
                >
        <aside className="bom-source" aria-label="Cost sources">
          <div className="panel-head">
            <div className="eyebrow">BOM / Cost</div>
            <div className="h1">Track ingredient cost honestly</div>
            <div className="copy">Invoices update ingredient cost. Sales data can be connected later if you want a margin view.</div>
          </div>

          <div className="source-list">
            <div className="section-label">Cost sources</div>
            {costWorkspace.sourceCards.map((card) => (
              <div className={`source-card ${card.tone}`.trim()} key={card.title}>
                <div className="row-top">
                  <div className="row-title">{card.title}</div>
                  <div className={`badge ${card.tone === 'warn' ? 'gold' : card.tone}`.trim()}>{card.badge}</div>
                </div>
                <div className="row-meta">{card.meta}</div>
              </div>
            ))}

            <div className="section-label">Cost rules</div>
            {costWorkspace.costRules.map((rule) => (
              <div className="folder-row" key={rule.title}>
                <div>
                  <div className="row-title">{rule.title}</div>
                  <div className="row-meta">{rule.copy}</div>
                </div>
                <div className="count">{rule.badge}</div>
              </div>
            ))}

            <div className="section-label">Invoice Library</div>
            <div className="mini-toggle-group" role="tablist" aria-label="Invoice library grouping">
              <button className={`mini-toggle ${costLibraryGrouping === COST_LIBRARY_GROUPINGS.DISH ? 'active' : ''}`.trim()} type="button" onClick={() => setCostLibraryGrouping(COST_LIBRARY_GROUPINGS.DISH)}>Dish</button>
              <button className={`mini-toggle ${costLibraryGrouping === COST_LIBRARY_GROUPINGS.DAY ? 'active' : ''}`.trim()} type="button" onClick={() => setCostLibraryGrouping(COST_LIBRARY_GROUPINGS.DAY)}>Day</button>
              <button className={`mini-toggle ${costLibraryGrouping === COST_LIBRARY_GROUPINGS.WEEK ? 'active' : ''}`.trim()} type="button" onClick={() => setCostLibraryGrouping(COST_LIBRARY_GROUPINGS.WEEK)}>Week</button>
            </div>
            <div className="invoice-library-list">
              {activeInvoiceLibraryGroups.map((group) => (
                <div className="invoice-library-group" key={group.key}>
                  <div className="section-subhead">{group.label}</div>
                  {group.entries.map((entry) => (
                    <div className={`source-card ${entry.tone}`.trim()} key={`${group.key}-${entry.id}`}>
                      <div className="row-top">
                        <div className="row-title">{entry.supplierName}</div>
                        <div className={`badge ${entry.tone === 'warn' ? 'gold' : entry.tone}`.trim()}>{entry.badge}</div>
                      </div>
                      <div className="row-meta">{entry.meta}</div>
                      <div className="row-meta">{entry.dayLabel} / {entry.weekLabel}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="library-foot">
            <div className="handoff-row">
              <div className="row-top">
                <div className="row-title">Last cost refresh</div>
                <div className="badge gold">{costWorkspace.refreshBadge}</div>
              </div>
              <div className="row-meta">{costWorkspace.refreshMeta}</div>
            </div>
          </div>
        </aside>

        <section className="bom-main" aria-label="Recipe BOM cost workspace">
          <div className="cost-head">
            <div>
              <div className="eyebrow">{recipeTitle}</div>
              <div className="command-title">{costWorkspace.commandTitle}</div>
              <div className="command-sub">{costWorkspace.commandSub}</div>
            </div>
            <div className="cost-scoreboard">
              <div className="cost-score">
                <div className="metric-name">Cost / portion</div>
                <div className="cost-value mono">{costWorkspace.metrics.costPerPortionLabel}</div>
                <div className="metric-small">{costWorkspace.metrics.costPerPortionSub}</div>
              </div>
              <div className="cost-score">
                <div className="metric-name">Recipe cost</div>
                <div className="cost-value mono">{costWorkspace.metrics.recipeCostLabel}</div>
                <div className="metric-small">{costWorkspace.metrics.recipeCostSub}</div>
              </div>
              <div className="cost-score">
                <div className="metric-name">Cost confidence</div>
                <div className="cost-value mono">{costWorkspace.metrics.confidenceLabel}</div>
                <div className="metric-small">{costWorkspace.metrics.confidenceSub}</div>
              </div>
            </div>
          </div>

          <div className="bom-grid">
            <div className="cost-report-grid" aria-label="Expense summary">
              <div className="report-card report-card-primary">
                <div className="row-top">
                  <div className="row-title">Expense report</div>
                  <div className="badge gold">{costWorkspace.expenseSummary.trustedLabel}</div>
                </div>
                <div className="report-value mono">{costWorkspace.expenseSummary.headline}</div>
                <div className="focus-copy">{costWorkspace.expenseSummary.copy}</div>
                <div className="report-meta-grid">
                  <div className="report-meta-row">
                    <span>Review locked</span>
                    <strong>{costWorkspace.expenseSummary.lockedCostLabel}</strong>
                  </div>
                  <div className="report-meta-row">
                    <span>Review state</span>
                    <strong>{costWorkspace.expenseSummary.reviewLabel}</strong>
                  </div>
                  <div className="report-meta-row">
                    <span>Pending cost</span>
                    <strong>{costWorkspace.expenseSummary.pendingLabel}</strong>
                  </div>
                </div>
              </div>

              <div className="report-card">
                <div className="row-top">
                  <div className="row-title">Income check</div>
                  <div className={`badge ${costWorkspace.incomeSummary.value !== null ? (costWorkspace.incomeSummary.tone === 'warn' ? 'gold' : 'good') : ''}`.trim()}>
                    {costWorkspace.incomeSummary.value !== null ? 'Live' : 'Optional'}
                  </div>
                </div>
                <div className="focus-copy">{costWorkspace.incomeSummary.copy}</div>
                <div className="cost-income-row">
                  <input
                    className="cost-income-input mono"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Add sale income"
                    value={activeCostIncomeDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCostIncomeDrafts((current) => ({
                        ...current,
                        [activeRecipeKey || 'default']: nextValue
                      }));
                    }}
                  />
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      if (!activeRecipeKey) return;
                      setCostIncomeDrafts((current) => ({
                        ...current,
                        [activeRecipeKey]: ''
                      }));
                    }}
                  >
                    Clear
                  </button>
                </div>
                <div className="report-meta-grid">
                  <div className="report-meta-row">
                    <span>Income</span>
                    <strong>{costWorkspace.incomeSummary.incomeLabel}</strong>
                  </div>
                  <div className="report-meta-row">
                    <span>Profit</span>
                    <strong>{costWorkspace.incomeSummary.profitLabel}</strong>
                  </div>
                  <div className="report-meta-row">
                    <span>Food cost</span>
                    <strong>{costWorkspace.incomeSummary.foodCostLabel}</strong>
                  </div>
                </div>
              </div>
            </div>

            {costWorkspace.supplierChangeCards.length > 0 ? (
              <div className="cost-alert-strip" aria-label="Supplier price changes">
                {costWorkspace.supplierChangeCards.map((card) => (
                  <div className={`flow-card ${card.tone}`.trim()} key={`${card.title}-${card.meta}`}>
                    <div className="row-top">
                      <div className="metric-name">{card.title}</div>
                      <div className={`badge ${card.tone === 'warn' ? 'gold' : 'good'}`.trim()}>{card.badge}</div>
                    </div>
                    <div className="focus-copy">{card.copy}</div>
                    <div className="report-alert-foot">
                      <span>{card.meta}</span>
                      <strong>{card.changeLabel}</strong>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="cost-intelligence-strip" aria-label="Owner intelligence">
              {costWorkspace.intelligenceCards.map((card) => (
                <div className={`flow-card ${card.tone}`.trim()} key={`${card.title}-${card.meta}`}>
                  <div className="row-top">
                    <div className="metric-name">{card.title}</div>
                    <div className={`badge ${card.tone === 'warn' ? 'gold' : card.tone}`.trim()}>{card.badge}</div>
                  </div>
                  <div className="focus-copy">{card.copy}</div>
                  <div className="report-alert-foot">
                    <span>{card.meta}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="cost-table" aria-label="Ingredient cost table">
              <div className="cost-row head">
                <div>Ingredient</div>
                <div>Recipe qty</div>
                <div>Invoice match</div>
                <div>Unit cost</div>
                <div>Total</div>
              </div>
              {costWorkspace.costRows.length > 0 ? costWorkspace.costRows.map((row) => (
                <div className="cost-row" key={row.id}>
                  <div>
                    <div className="cost-item">{row.ingredientName}</div>
                    <div className="cost-sub">{row.detail}</div>
                  </div>
                <div className="cost-cell">{row.quantityLabel}</div>
                <div className="cost-cell"><strong>{row.matchLabel}</strong></div>
                <div className="cost-cell">{row.costLabel}</div>
                <div className="cost-cell">
                  <strong>{row.totalLabel}</strong>
                  {row.costDelta ? (
                    <div className="cost-delta-note">
                      {row.costDelta.state === 'review' ? 'Review change' : row.costDelta.referenceLabel}
                    </div>
                  ) : null}
                </div>
              </div>
            )) : (
                <div className="cost-row">
                  <div>
                    <div className="cost-item">No ingredients loaded</div>
                    <div className="cost-sub">Select a recipe to compare BOM ingredients against invoice cost.</div>
                  </div>
                  <div className="cost-cell">-</div>
                  <div className="cost-cell"><strong>Pending</strong></div>
                  <div className="cost-cell">-</div>
                  <div className="cost-cell"><strong>-</strong></div>
                </div>
              )}
            </div>

            <div className="cost-flow" aria-label="Cost workflow">
              {costWorkspace.flowCards.map((card) => (
                <div className={`flow-card ${card.tone}`.trim()} key={card.title}>
                  <div className="metric-name">{card.title}</div>
                  <div className="focus-title">{card.heading}</div>
                  <div className="focus-copy">{card.copy}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="bom-decision" aria-label="BOM decisions">
          <div className="block-head">
            <div>
              <div className="block-title">Cost decisions</div>
              <div className="block-sub">Review only the items that can change trusted cost or recipe confidence.</div>
            </div>
            <div className="badge gold">{costWorkspace.openDecisionCount} open</div>
          </div>

          <div className="proof-list">
            {costWorkspace.decisionCards.map((card) => (
              <div className={`proof-card ${card.tone === 'good' ? 'good' : (card.tone === 'warn' ? 'warn' : '')}`.trim()} key={card.title}>
                <div className="row-top">
                  <div className="focus-title">{card.title}</div>
                  <div className={`badge ${card.tone === 'warn' ? 'gold' : card.tone}`.trim()}>{card.badge}</div>
                </div>
                <div className="focus-copy">{card.copy}</div>
                {Array.isArray(card.checks) && card.checks.length > 0 ? (
                  <div className="proof-check">
                    {card.checks.map((check, index) => (
                      <div className={`check-row ${card.tone === 'good' && index === 0 ? 'done' : ''}`.trim()} key={`${card.title}-check-${index}`}>
                        {check}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="prep-actions">
            <button className="button">Upload invoice</button>
            <button className="button primary">Review cost</button>
          </div>
        </aside>
      </section>
            )}
            {view === DASHBOARD_VIEWS.SETTINGS && (
                <section
                    className="settings-view page-view"
                    id={WORKFLOW_PANEL_IDS[DASHBOARD_VIEWS.SETTINGS]}
                    role="tabpanel"
                    aria-labelledby={`${DASHBOARD_VIEWS.SETTINGS}-tab`}
                    tabIndex={-1}
                >
                    <div className="settings-shell">
                        <section className="settings-card settings-card--narrow">
                            <div className="section-label">Kitchen defaults</div>
                            <div className="settings-card-title">Prep portion rules</div>
                            <div className="settings-card-copy">These numbers affect Prep Board portion math only. Recipe Truth stays weight-first and does not change.</div>
                            <div className="settings-topbar">
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() => {
                                        setSettingsDraft({
                                            prepMainPortionSize,
                                            prepStarterPortionSize,
                                            prepComponentPortionSize,
                                            prepDipPortionSize,
                                            prepMarinadePortionSize
                                        });
                                        setSettingsNotice({ tone: 'info', message: 'Draft reset to the saved kitchen defaults.' });
                                    }}
                                >
                                    Reset draft
                                </button>
                                <button
                                    type="button"
                                    className="button primary"
                                    onClick={saveKitchenPortionSettings}
                                >
                                    {settingsDraftDirty ? 'Save updates' : 'Saved'}
                                </button>
                            </div>
                            {settingsNotice?.message ? (
                                <div className={`queue-notice ${settingsNotice.tone || 'info'}`}>
                                    {settingsNotice.message}
                                </div>
                            ) : null}
                            <div className="settings-form">
                                {prepPortionSettingEntries.map((entry) => {
                                    const fieldMeta = PREP_PORTION_RULE_FIELDS.find((field) => field.key === entry.key);
                                    const draftValue = settingsDraft?.[entry.key] ?? entry.value;
                                    return (
                                        <label className="settings-field" key={entry.key}>
                                            <span className="settings-field-head">
                                                <span className="settings-field-title">{entry.label}</span>
                                                <span className="settings-field-value">{`${draftValue} g`}</span>
                                            </span>
                                            <input
                                                className="settings-number-input"
                                                type="number"
                                                min="20"
                                                max="500"
                                                step="5"
                                                value={draftValue}
                                                onChange={(event) => {
                                                    const nextValue = Number(event.target.value || 0);
                                                    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
                                                    setSettingsDraft((current) => ({
                                                        ...current,
                                                        [entry.key]: Math.round(nextValue)
                                                    }));
                                                    setSettingsNotice(null);
                                                }}
                                            />
                                            <span className="settings-field-copy">{fieldMeta?.copy || 'Prep-only portion rule.'}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="settings-card settings-card--compact">
                            <div className="section-label">Scope</div>
                            <div className="settings-card-title">What changes here</div>
                            <div className="settings-info-list">
                                <div className="settings-info-item">Prep Board summaries and portion calculations use these settings.</div>
                                <div className="settings-info-item">Recipe Truth remains in kg/g and keeps its original yield data.</div>
                                <div className="settings-info-item">Staff can follow prep output, but only manager-authority workspaces can change this page.</div>
                            </div>
                        </section>
                    </div>
                </section>
            )}
                {view === DASHBOARD_VIEWS.SCALER && (
                    <aside className="panel side-edit">
                        <RecipeMetaPanel
                            activeRecipe={activeRecipe}
                            prepTaskSteps={getPrepTasksForRecipe(activeRecipe, activeRecipeKey).map((task) => String(task?.name || task?.title || '').trim()).filter(Boolean).slice(0, 4)}
                            workspaceType={roleWorkspaceConfig.workspaceType}
                            canApproveSync={canApproveSync}
                            editMode={ingredientEditMode}
                            activePrepPlan={activePrepPlan}
                            currentYieldValue={currentYieldValue}
                            trainingManagerSupport={trainingManagerSupport}
                            currentPortionCount={currentPortionCount}
                            portionsPerBatch={portionsPerBatch}
                            getPortionSize={(recipe) => getPortionSize(recipe, {
                                mainPortionSize,
                                sidePortionSize,
                                starterPortionSize,
                                portionsPerBatch
                            }, visibleRecipes)}
                            setDailyProduction={setDailyProduction}
                            dailyProduction={dailyProduction}
                            formatQuantity={formatQuantity}
                            portionMode={portionMode}
                            onPortionModeToggle={() => setPortionMode(!portionMode)}
                            onDefaultAll={() => {
                                setDailyProduction(buildDailyProduction(visibleRecipes));
                                clearAllPrepTaskOverrides();
                            }}
                            nextActionSummary={nextActionSummary}
                            bomInsight={activeBomInsight}
                            onOptimizeYield={() => {
                                if (activeRecipeKey) {
                                    const optimized = Number((Number(activeRecipe?.baseYield) || currentYieldValue || 0).toFixed(2));
                                    applyRecipeYieldTarget({
                                        recipe: activeRecipe,
                                        recipeKey: activeRecipeKey,
                                        nextYield: optimized,
                                        overrideReason: 'optimized_yield_target'
                                    });
                                }
                            }}
                            onResetActive={() => {
                                if (activeRecipeKey) {
                                    applyRecipeYieldTarget({
                                        recipe: activeRecipe,
                                        recipeKey: activeRecipeKey,
                                        nextYield: Number((Number(activeRecipe?.baseYield) || 0).toFixed(2)),
                                        clearOverride: true
                                    });
                                }
                            }}
                            authScopeState={authScopeState}
                            onSaveRecipePatch={saveRecipePatch}
                            onSavePrepPlan={savePrepPlanForRecipe}
                            onStartPrep={handleStartPrep}
                        />
                    </aside>
                )}

            </section>
        </main>
    );
};

export default Dashboard;
