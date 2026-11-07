import { classifyKitchenUnit, resolveWorkflow2PrepDetailRows } from '../config/constants.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const toWorkflow2TextList = (value, depth = 0) => {
  if (depth > 2 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => toWorkflow2TextList(item, depth + 1));
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value || '').trim();
    return text ? [text] : [];
  }
  if (typeof value === 'object') return Object.values(value).flatMap((item) => toWorkflow2TextList(item, depth + 1));
  return [];
};

const pickFirstWorkflow2TextList = (...candidates) => {
  for (const candidate of candidates) {
    const values = toWorkflow2TextList(candidate).filter(Boolean);
    if (values.length > 0) return [...new Set(values)];
  }
  return [];
};

const getRecipeWorkflow2PrepProfile = (recipe = {}) => recipe?.workflow2PrepProfile || recipe?.prepProfile || null;

const shouldUseWorkflow2LargeProfile = ({
  prepProfile = null,
  estimatedPortions = 0,
  methodVariant = 'normal'
} = {}) => {
  if (estimatedPortions > 50) return true;
  if (!prepProfile) return methodVariant === 'batch';
  const scaleRule = prepProfile?.scaleRule || prepProfile?.scale_rule || {};
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

  const largeThreshold = [
    scaleRule?.large_min_expected_portions,
    scaleRule?.largeMinExpectedPortions,
    scaleRule?.large_threshold_portions,
    scaleRule?.largeThresholdPortions,
    scaleRule?.large_min_portions,
    scaleRule?.largeMinPortions
  ].map((value) => Number(value)).find((value) => Number.isFinite(value));

  if (Number.isFinite(largeThreshold) && estimatedPortions > 0) return estimatedPortions >= largeThreshold;
  return methodVariant === 'batch';
};

const getWorkflow2MethodProfile = ({
  prepProfile = null,
  useLargeProfile = false
} = {}) => {
  if (!prepProfile) return null;
  if (useLargeProfile) {
    return prepProfile?.largeProfile || prepProfile?.large_profile || prepProfile?.regularProfile || prepProfile?.regular_profile || null;
  }
  return prepProfile?.regularProfile || prepProfile?.regular_profile || prepProfile?.largeProfile || prepProfile?.large_profile || null;
};

const getWorkflow2StorageLabel = ({
  prepProfile = null,
  useLargeProfile = false
} = {}) => {
  if (!prepProfile) return '';
  const storage = prepProfile?.storage || {};
  const methodKey = useLargeProfile ? 'large' : 'regular';
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
  return candidates.map((candidate) => String(candidate || '').trim()).find(Boolean) || '';
};

const getWorkflow2ExecutionSteps = ({
  prepProfile = null,
  useLargeProfile = false
} = {}) => {
  const methodProfile = getWorkflow2MethodProfile({ prepProfile, useLargeProfile });
  const fallbackProfile = methodProfile === (prepProfile?.largeProfile || prepProfile?.large_profile || null)
    ? (prepProfile?.regularProfile || prepProfile?.regular_profile || null)
    : (prepProfile?.largeProfile || prepProfile?.large_profile || null);
  const strictRows = resolveWorkflow2PrepDetailRows({
    prepProfile,
    methodProfile,
    fallbackProfile
  });
  if (strictRows.length > 0) {
    return strictRows
      .map((row) => String(row?.taskName || '').trim())
      .filter(Boolean)
      .slice(0, 4);
  }
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

const getWorkflow2CriticalChecks = (prepProfile = null) => (
  pickFirstWorkflow2TextList(
    prepProfile?.criticalChecks,
    prepProfile?.critical_checks
  ).slice(0, 5)
);

const getWorkflow2Equipment = ({
  prepProfile = null,
  useLargeProfile = false
} = {}) => {
  const methodProfile = getWorkflow2MethodProfile({ prepProfile, useLargeProfile });
  return pickFirstWorkflow2TextList(
    methodProfile?.equipment,
    methodProfile?.tools,
    methodProfile?.tools_equipment,
    methodProfile?.toolsEquipment,
    prepProfile?.uiOutput?.equipment,
    prepProfile?.uiOutput?.tools,
    prepProfile?.ui_output?.equipment,
    prepProfile?.ui_output?.tools
  ).slice(0, 5);
};

const getWorkflow2ServiceFinish = (prepProfile = null) => (
  pickFirstWorkflow2TextList(
    prepProfile?.serviceFinish,
    prepProfile?.service_finish
  ).slice(0, 3)
);

const getRecipePrepIntelligence = (recipe = {}) => {
  const source = recipe?.scalingTips?.prepIntelligence || recipe?.prepIntelligence || {};
  const prepTimeMinutes = toNumber(source?.prepTimeMinutes, 0);

  return {
    leadTime: String(source?.leadTime || '').trim(),
    makeAhead: String(source?.makeAhead || '').trim(),
    storageWindow: String(source?.storageWindow || '').trim(),
    handoffNote: String(source?.handoffNote || '').trim(),
    prepTimeMinutes: prepTimeMinutes > 0 ? prepTimeMinutes : 0
  };
};

const getPrepMakeAheadRank = (value = '') => {
  const makeAhead = normalizeText(value);
  if (makeAhead === 'same day only') return 0;
  if (makeAhead === 'day before ok') return 1;
  if (makeAhead === 'two days ahead ok') return 2;
  return 3;
};

const isNoStorageWindow = (value = '') => {
  const window = normalizeText(value);
  return window === 'same day' || window === 'same-day' || window === 'same day only' || window === 'use same day';
};

const buildPrepAheadState = ({
  makeAhead = '',
  storageWindow = '',
  handoffNote = ''
} = {}) => {
  const normalizedMakeAhead = normalizeText(makeAhead);
  const normalizedStorage = normalizeText(storageWindow);
  const normalizedHandoff = normalizeText(handoffNote);
  const canMoveTomorrow = getPrepMakeAheadRank(normalizedMakeAhead) > 0 && !isNoStorageWindow(normalizedStorage);
  const canBePartial = canMoveTomorrow && /\b(half|split|staged|stage|partial|finish|batch|marinade|soak|ferment|brine|tomorrow|next day)\b/i.test(handoffNote);

  return {
    canMoveTomorrow,
    canBePartial,
    state: canBePartial ? 'partial' : (canMoveTomorrow ? 'tomorrow' : 'same day'),
    rationale: canBePartial
      ? 'Mark this task for partial prep and staged handoff when recipe handoff is explicit.'
      : (canMoveTomorrow
          ? 'This task can move safely earlier than service-day as stored by recipe prep intelligence.'
          : 'Keep this task in the same-day flow unless chef marks it differently.')
  };
};

export const resolveProductionRecipeKey = (recipe = {}, fallback = '') => (
  recipe?.id ||
  recipe?.recipe_ref_id ||
  recipe?.canonical_id ||
  recipe?.clean_name ||
  recipe?.name ||
  fallback
);

export const buildPrepActionAvailability = ({
  recipe = null,
  recipeKey = '',
  scopedTasks = [],
  prepPlan = null,
  sessionSnapshot = null
} = {}) => {
  const hasRecipeSelection = Boolean(recipe && recipeKey);
  const taskCount = Array.isArray(scopedTasks) ? scopedTasks.length : 0;
  const hasSavedPlan = Boolean(prepPlan?.mode);
  const hasActiveSession = Boolean(sessionSnapshot?.startedAt);

  return {
    canOpenRecipeTruth: hasRecipeSelection,
    canSavePrepPlan: hasRecipeSelection,
    canRotatePrep: hasRecipeSelection,
    canPrintStationList: hasRecipeSelection && taskCount > 0,
    canStartPrep: hasRecipeSelection,
    taskCount,
    hasSavedPlan,
    hasActiveSession,
    openRecipeTruthHint: hasRecipeSelection
      ? 'Open the selected recipe in Recipe Truth.'
      : 'Select a recipe first to open Recipe Truth from prep.',
    prepThisWeekHint: hasRecipeSelection
      ? (hasSavedPlan ? 'Update the saved prep-this-week plan for the selected recipe.' : 'Save a prep-this-week plan for the selected recipe.')
      : 'Select a recipe first to save a prep-this-week plan.',
    rotatePrepHint: hasRecipeSelection
      ? (hasSavedPlan ? 'Update the saved rotate-prep plan for the selected recipe.' : 'Save a rotate-prep plan for the selected recipe.')
      : 'Select a recipe first to save a rotate-prep plan.',
    printStationListHint: !hasRecipeSelection
      ? 'Select a recipe first to print station tasks.'
      : (taskCount > 0
          ? `Print ${taskCount} current prep task${taskCount === 1 ? '' : 's'} for the selected recipe.`
          : 'No generated prep tasks exist yet for the selected recipe.'),
    startPrepHint: !hasRecipeSelection
      ? 'Select a recipe first to load prep context.'
      : (hasActiveSession
          ? 'Refresh the live prep session timing for the selected recipe.'
          : 'Start prep and load the selected recipe into the prep board context.'),
    printStationListLabel: taskCount > 0 ? `Print ${taskCount === 1 ? '1 task' : `${taskCount} tasks`}` : 'Print Station List',
    startPrepLabel: hasActiveSession ? 'Refresh Prep' : 'Start Prep'
  };
};

export const resolvePrepFocusTarget = (...sources) => {
  const sourceList = Array.isArray(sources) ? sources : [];
  const normalizedSources = sourceList
    .filter((source) => source && typeof source === 'object')
    .map((source) => ({
      recipeKey: String(source?.recipeKey || '').trim(),
      recipeName: String(source?.recipeName || '').trim()
    }))
    .filter((source) => source.recipeKey || source.recipeName);

  const keyedSource = normalizedSources.find((source) => source.recipeKey);
  if (keyedSource) return keyedSource;

  return normalizedSources[0] || { recipeKey: '', recipeName: '' };
};

export const resolvePrepPlanForTask = (prepPlans = {}, task = {}) => {
  const normalizedTaskKeys = new Set([
    task?.recipeKey,
    task?.id,
    task?.recipe_id,
    task?.recipe_ref_id,
    task?.canonical_id,
    task?.name,
    task?.clean_name
  ].map(normalizeText).filter(Boolean));

  const planEntries = Object.entries(prepPlans || {});
  for (const [planKey, plan] of planEntries) {
    if (normalizedTaskKeys.has(normalizeText(planKey))) {
      return plan || null;
    }
  }

  const matchingByPlanName = planEntries.find(([, plan]) => (
    plan?.recipeName
      && normalizedTaskKeys.has(normalizeText(plan.recipeName))
  ));

  return matchingByPlanName ? matchingByPlanName[1] : null;
};

const normalizePrepPlanDays = (plan = {}, fallbackDay = 0) => {
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const normalizedFallback = Number.isInteger(fallbackDay) && fallbackDay >= 0 && fallbackDay < 7
    ? fallbackDay
    : 0;
  const planDays = Array.isArray(plan?.days)
    ? [...new Set(plan.days
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < 7))]
    : [];

  if (Boolean(plan?.auto)) return allDays;
  if (Boolean(plan?.anyDay)) return [normalizedFallback];
  if (planDays.length) return planDays;
  return [normalizedFallback];
};

const isPrepTaskAttentionHeavy = (task = {}) => {
  const taskState = normalizeText(task?.taskState);
  const isTruthBlocked = taskState === 'truth blocked' || Boolean(task?.isTruthBlocked) || Number(task?.truthPriority || 0) >= 2;
  const isTruthReview = !isTruthBlocked && (taskState === 'truth review' || Number(task?.truthPriority || 0) === 1);
  const isWaitingApproval = taskState === 'waiting approval';
  const isDependencyBlocked = Boolean(task?.isDependencyBlocked) && !isTruthBlocked && !isWaitingApproval;
  const isOverdueRisk = Boolean(task?.isOverdueRisk);
  const hasChefOverride = Boolean(task?.hasChefOverride);
  const hasChangedDependency = Boolean(task?.hasChangedDependency);

  return {
    isAttentionHeavy: isTruthBlocked || isTruthReview || isWaitingApproval || isDependencyBlocked || isOverdueRisk || hasChefOverride || hasChangedDependency,
    isTruthBlocked,
    isTruthReview,
    isWaitingApproval,
    isDependencyBlocked,
    isOverdueRisk,
    hasChefOverride,
    hasChangedDependency
  };
};

export const buildPrepCalendarPressure = ({
  tasks = [],
  prepPlans = {},
  now = new Date(),
  monthHorizon = 14
} = {}) => {
  const normalizedNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const jsDay = normalizedNow.getDay();
  const todayIndex = (jsDay + 6) % 7;
  const weekdayPressure = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    count: 0,
    attentionCount: 0,
    blockedCount: 0,
    reviewCount: 0,
    overdueCount: 0,
    changedCount: 0
  }));

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    if (!task || typeof task !== 'object') return;
    const plan = resolvePrepPlanForTask(prepPlans, task);
    const planDays = normalizePrepPlanDays(plan || {}, todayIndex);
    const signal = isPrepTaskAttentionHeavy(task);

    planDays.forEach((dayIndex) => {
      const bucket = weekdayPressure[dayIndex];
      if (!bucket) return;
      bucket.count += 1;
      if (signal.isAttentionHeavy) bucket.attentionCount += 1;
      if (signal.isTruthBlocked || signal.isDependencyBlocked || signal.isWaitingApproval) bucket.blockedCount += 1;
      if (signal.isTruthReview) bucket.reviewCount += 1;
      if (signal.isOverdueRisk) bucket.overdueCount += 1;
      if (signal.hasChefOverride || signal.hasChangedDependency) bucket.changedCount += 1;
    });
  });

  const weekStart = new Date(normalizedNow);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(normalizedNow.getDate() - todayIndex);

  const weekCells = Array.from({ length: 7 }, (_, offset) => {
    const cellDate = new Date(weekStart);
    cellDate.setDate(weekStart.getDate() + offset);
    const pressure = weekdayPressure[offset] || weekdayPressure[0];
    return {
      key: `${offset}-${cellDate.toISOString()}`,
      label: cellDate.toLocaleDateString(undefined, { weekday: 'long' }),
      dateLabel: String(cellDate.getDate()),
      count: pressure.count,
      attentionCount: pressure.attentionCount,
      blockedCount: pressure.blockedCount,
      reviewCount: pressure.reviewCount,
      overdueCount: pressure.overdueCount,
      changedCount: pressure.changedCount,
      isToday: offset === todayIndex,
      hot: pressure.attentionCount > 0 || pressure.count >= 3
    };
  });

  const safeMonthHorizon = Math.max(1, Number(monthHorizon || 14));
  const monthDots = Array.from({ length: safeMonthHorizon }, (_, offset) => {
    const cellDate = new Date(normalizedNow);
    cellDate.setDate(normalizedNow.getDate() + offset);
    const dayIndex = (cellDate.getDay() + 6) % 7;
    const pressure = weekdayPressure[dayIndex] || weekdayPressure[0];
    return {
      key: `${offset}-${cellDate.toISOString()}`,
      label: String(cellDate.getDate()),
      count: pressure.count,
      attentionCount: pressure.attentionCount,
      blockedCount: pressure.blockedCount,
      reviewCount: pressure.reviewCount,
      overdueCount: pressure.overdueCount,
      changedCount: pressure.changedCount,
      hot: pressure.attentionCount > 0 || pressure.count >= 3
    };
  });

  const todayCell = weekCells.find((dayCell) => dayCell.isToday) || weekCells[0] || null;
  const todayCount = Number(todayCell?.count || 0);
  const todayAttentionCount = Number(todayCell?.attentionCount || 0);
  const weekCount = weekCells.reduce((sum, dayCell) => sum + Number(dayCell.count || 0), 0);
  const weekAttentionCount = weekCells.reduce((sum, dayCell) => sum + Number(dayCell.attentionCount || 0), 0);
  const monthCount = monthDots.reduce((sum, monthDot) => sum + Number(monthDot.count || 0), 0);
  const monthAttentionCount = monthDots.reduce((sum, monthDot) => sum + Number(monthDot.attentionCount || 0), 0);

  return {
    todayIndex,
    weekCells,
    monthDots,
    todayCount,
    todayAttentionCount,
    weekCount,
    weekAttentionCount,
    monthCount,
    monthAttentionCount
  };
};

const PREP_SCHEDULE_SLOT_SEQUENCE = [
  { key: 'morning', label: 'Morning', fallbackTime: 'Morning first' },
  { key: 'afternoon', label: 'Afternoon', fallbackTime: 'Afternoon' },
  { key: 'before_service', label: 'Before service', fallbackTime: 'Before service' }
];

const formatPrepMinutesLabel = (value = 0) => {
  const safeMinutes = Math.max(0, Math.round(Number(value || 0)));
  return safeMinutes > 0 ? `${safeMinutes} min` : '';
};

const getPrepScheduleSlotKey = (task = {}) => {
  const explicitLeadTime = normalizeText(task?.prepLeadTime);
  if (explicitLeadTime === 'morning first' || explicitLeadTime === 'morning') return 'morning';
  if (explicitLeadTime === 'afternoon') return 'afternoon';
  if (explicitLeadTime === 'before service') return 'before_service';

  const phasePriority = Number(task?.schedulePhasePriority ?? 2);
  if (phasePriority <= 0) return 'morning';
  if (phasePriority === 1) return 'afternoon';
  return 'before_service';
};

const getPrepScheduleLeadRank = (task = {}) => {
  const explicitLeadTime = normalizeText(task?.prepLeadTime);
  if (explicitLeadTime === 'morning first') return 0;
  if (explicitLeadTime === 'morning') return 1;
  if (explicitLeadTime === 'afternoon') return 2;
  if (explicitLeadTime === 'before service') return 3;
  return Number(task?.schedulePhasePriority ?? 2);
};

const comparePrepScheduleLaneTasks = (left = {}, right = {}) => (
  Number(left?.taskStatePriority || 0) - Number(right?.taskStatePriority || 0)
  || Number(right?.isOverdueRisk || 0) - Number(left?.isOverdueRisk || 0)
  || Number(right?.hasChangedDependency || 0) - Number(left?.hasChangedDependency || 0)
  || Number(left?.truthPriority || 0) - Number(right?.truthPriority || 0)
  || Number(left?.dependencyPriority || 0) - Number(right?.dependencyPriority || 0)
  || getPrepScheduleLeadRank(left) - getPrepScheduleLeadRank(right)
  || Number(right?.prepTimeMinutes || 0) - Number(left?.prepTimeMinutes || 0)
  || Number(right?.targetYield || 0) - Number(left?.targetYield || 0)
  || String(left?.name || '').localeCompare(String(right?.name || ''))
);

export const buildPrepScheduleLane = (tasks = [], { overflowLabel = 'Watch' } = {}) => {
  const groupedTasks = PREP_SCHEDULE_SLOT_SEQUENCE.reduce((acc, phase) => ({
    ...acc,
    [phase.key]: []
  }), {});

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const slotKey = getPrepScheduleSlotKey(task);
    if (!groupedTasks[slotKey]) groupedTasks[slotKey] = [];
    groupedTasks[slotKey].push(task);
  });

  Object.keys(groupedTasks).forEach((key) => {
    groupedTasks[key] = groupedTasks[key].slice().sort(comparePrepScheduleLaneTasks);
  });

  const primaryEntries = PREP_SCHEDULE_SLOT_SEQUENCE.map((phase) => {
    const nextTask = groupedTasks[phase.key]?.shift() || null;
    if (!nextTask) return null;
    return {
      ...nextTask,
      scheduleSlotKey: phase.key,
      scheduleSlotLabel: phase.label,
      scheduleSlotTime: String(nextTask?.prepLeadTime || '').trim() || phase.fallbackTime
    };
  }).filter(Boolean);

  const overflowTasks = PREP_SCHEDULE_SLOT_SEQUENCE.flatMap((phase) => groupedTasks[phase.key] || [])
    .sort(comparePrepScheduleLaneTasks)
    .map((task) => ({
      ...task,
      scheduleSlotKey: 'overflow',
      scheduleSlotLabel: overflowLabel,
      scheduleSlotTime: String(task?.prepLeadTime || '').trim() || 'Before service'
    }));

  return [...primaryEntries, ...overflowTasks];
};

export const buildPrepTaskFocusList = (tasks = [], {
  mode = 'next',
  dayPartKey = '',
  pickedTaskIds = []
} = {}) => {
  const taskList = Array.isArray(tasks) ? tasks.slice() : [];
  const normalizedMode = normalizeText(mode);
  const normalizedDayPartKey = normalizeText(dayPartKey);
  const normalizedPickedIds = new Set(
    (Array.isArray(pickedTaskIds) ? pickedTaskIds : [])
      .map((taskId) => String(taskId || '').trim())
      .filter(Boolean)
  );

  if (normalizedMode === 'picked') {
    if (!normalizedPickedIds.size) return [];
    return taskList
      .filter((task) => normalizedPickedIds.has(String(task?.id || '').trim()))
      .sort(comparePrepScheduleLaneTasks);
  }

  if (normalizedMode === 'daypart') {
    if (!normalizedDayPartKey) return [];
    return taskList
      .filter((task) => getPrepScheduleSlotKey(task) === normalizedDayPartKey)
      .sort(comparePrepScheduleLaneTasks);
  }

  if (normalizedMode === 'next') {
    return buildPrepScheduleLane(taskList, { overflowLabel: 'Later' }).slice(0, 6);
  }

  return taskList.sort(comparePrepScheduleLaneTasks);
};

const PREP_TASK_CATEGORY_ORDER = [
  'Foundation Prep',
  'Component Prep',
  'Service Finish',
  'Pastry Prep',
  'General Prep'
];

const getPrepTaskCategorySortRank = (task = {}) => {
  const taskStatePriority = Number(task?.taskStatePriority || 0);
  const truthPriority = Number(task?.truthPriority || 0);
  const dependencyPriority = Number(task?.dependencyPriority || 0);
  const overduePenalty = Boolean(task?.isOverdueRisk) ? -2 : 0;
  const changedPenalty = Boolean(task?.hasChangedDependency) ? -1 : 0;

  return taskStatePriority + truthPriority + dependencyPriority + overduePenalty + changedPenalty;
};

const comparePrepTaskCategoryEntries = (left = {}, right = {}) => (
  getPrepTaskCategorySortRank(left) - getPrepTaskCategorySortRank(right)
  || Number(right?.isOverdueRisk || 0) - Number(left?.isOverdueRisk || 0)
  || Number(right?.hasChangedDependency || 0) - Number(left?.hasChangedDependency || 0)
  || Number(left?.schedulePhasePriority || 0) - Number(right?.schedulePhasePriority || 0)
  || Number(right?.targetYield || 0) - Number(left?.targetYield || 0)
  || String(left?.name || '').localeCompare(String(right?.name || ''))
);

export const buildPrepTaskCategoryLanes = (tasks = []) => {
  const grouped = (Array.isArray(tasks) ? tasks : []).reduce((acc, task) => {
    const category = String(
      task?.schedulePhase
      || task?.schedule_phase
      || task?.taskCategory
      || task?.task_category
      || task?.context_tags?.dish_style
      || task?.dishStyle
      || task?.style
      || task?.station_group
      || task?.station
      || 'Kitchen Standard'
    ).trim() || 'Kitchen Standard';
    if (!acc[category]) {
      acc[category] = {
        category,
        schedulePhasePriority: Number(task?.schedulePhasePriority ?? 99),
        tasks: [],
        blockedCount: 0,
        truthCount: 0,
        overdueCount: 0,
        changedCount: 0
      };
    }

    acc[category].tasks.push(task);
    acc[category].schedulePhasePriority = Math.min(acc[category].schedulePhasePriority, Number(task?.schedulePhasePriority ?? 99));
    if (Boolean(task?.isDependencyBlocked) || String(task?.taskState || '').trim() === 'waiting approval') acc[category].blockedCount += 1;
    if (Boolean(task?.isTruthBlocked) || Number(task?.truthPriority || 0) > 0) acc[category].truthCount += 1;
    if (Boolean(task?.isOverdueRisk)) acc[category].overdueCount += 1;
    if (Boolean(task?.hasChefOverride) || Boolean(task?.hasChangedDependency)) acc[category].changedCount += 1;
    return acc;
  }, {});

  return Object.values(grouped)
    .map((lane) => {
      const loadLabelParts = [`${lane.tasks.length} active`];
      if (lane.blockedCount > 0) loadLabelParts.push(`${lane.blockedCount} blocked`);
      if (lane.truthCount > 0) loadLabelParts.push(`${lane.truthCount} truth`);
      if (lane.overdueCount > 0) loadLabelParts.push(`${lane.overdueCount} overdue`);
      if (lane.changedCount > 0) loadLabelParts.push(`${lane.changedCount} changed`);

      return {
        ...lane,
        loadLabel: loadLabelParts.join(' / '),
        tasks: lane.tasks.slice().sort(comparePrepTaskCategoryEntries)
      };
    })
    .sort((left, right) => {
      return Number(right.tasks?.length || 0) - Number(left.tasks?.length || 0)
        || Number(left.schedulePhasePriority ?? 99) - Number(right.schedulePhasePriority ?? 99)
        || String(left.category || '').localeCompare(String(right.category || ''));
    });
};

export const buildPrepTaskTimePrediction = (task = {}) => {
  const prepTimeMinutes = Math.max(0, Number(task?.prepTimeMinutes || 0));
  const durationLabel = formatPrepMinutesLabel(prepTimeMinutes);
  const schedulePhasePriority = Number(task?.schedulePhasePriority ?? 2);
  const taskState = normalizeText(task?.taskState);
  const blockedDependencyCount = Number(task?.blockedDependencyCount || 0);
  const missingDependencyCount = Number(task?.missingDependencyCount || 0);
  const hasChangedDependency = Boolean(task?.hasChangedDependency);
  const isOverdueRisk = Boolean(task?.isOverdueRisk);

  const durationPriority = prepTimeMinutes >= 120 ? 4
    : prepTimeMinutes >= 90 ? 3
      : prepTimeMinutes >= 60 ? 2
        : prepTimeMinutes >= 30 ? 1
          : 0;

  const plannedWindowLabel = schedulePhasePriority <= 0
    ? 'Morning first'
    : (schedulePhasePriority === 1 ? 'Afternoon' : 'Before service');

  let timeLabel = plannedWindowLabel;
  let timeSummary = '';
  let priorityOffset = 0;

  if (!durationLabel) {
    return {
      timeLabel,
      durationLabel,
      timeSummary: 'Prep time estimate missing. Add recipe prep timing for sharper board guidance.',
      priorityOffset
    };
  }

  if (missingDependencyCount > 0 || blockedDependencyCount > 0 || taskState === 'ready after dependency') {
    const dependencyText = blockedDependencyCount > 0 || taskState === 'ready after dependency'
      ? 'upstream prep'
      : 'recipe links';
    return {
      timeLabel: 'After upstream prep',
      durationLabel,
      timeSummary: `Allow ${durationLabel} once ${dependencyText} clears for this task.`,
      priorityOffset
    };
  }

  if (taskState === 'truth blocked' || taskState === 'truth review' || taskState === 'waiting approval') {
    return {
      timeLabel: 'After review',
      durationLabel,
      timeSummary: `Allow ${durationLabel} after recipe-truth review or approval clears.`,
      priorityOffset
    };
  }

  if (hasChangedDependency) {
    return {
      timeLabel: 'Recheck timing',
      durationLabel,
      timeSummary: `Allow ${durationLabel} once the upstream change is confirmed.`,
      priorityOffset: Math.max(0, durationPriority - 1)
    };
  }

  if (isOverdueRisk || schedulePhasePriority <= 0) {
    return {
      timeLabel: 'Start now',
      durationLabel,
      timeSummary: `Allow ${durationLabel} now to stay ahead of service pressure.`,
      priorityOffset: durationPriority + (isOverdueRisk ? 2 : 1)
    };
  }

  if (schedulePhasePriority === 1) {
    return {
      timeLabel: 'This afternoon',
      durationLabel,
      timeSummary: `Hold a ${durationLabel} prep block this afternoon.`,
      priorityOffset: durationPriority
    };
  }

  return {
    timeLabel: 'Before service',
    durationLabel,
    timeSummary: `Reserve ${durationLabel} before service for the final handoff.`,
    priorityOffset: Math.max(0, durationPriority - 1)
  };
};

export const buildPrepTaskExecutionSignal = (task = {}) => {
  const taskState = normalizeText(task?.taskState);
  const missingDependencyCount = Number(task?.missingDependencyCount || 0);
  const blockedDependencyCount = Number(task?.blockedDependencyCount || 0);
  const truthPriority = Number(task?.truthPriority || 0);
  const schedulePhasePriority = Number(task?.schedulePhasePriority || 2);
  const prepTimeMinutes = Number(task?.prepTimeMinutes || 0);
  const shortagePriority = Number(task?.shortagePriority || 0);
  const hasChangedDependency = Boolean(task?.hasChangedDependency);
  const hasChefOverride = Boolean(task?.hasChefOverride);
  const isOverdueRisk = Boolean(task?.isOverdueRisk);
  const timePrediction = buildPrepTaskTimePrediction(task);

  const basePriorityMap = {
    'ready now': 0,
    'ready after dependency': 18,
    'changed': 24,
    'truth review': 28,
    'waiting approval': 34,
    'blocked': 40,
    'truth blocked': 46
  };

  let operationalPriority = Number(basePriorityMap[taskState] ?? 52);
  operationalPriority += Math.max(0, schedulePhasePriority) * 2;
  operationalPriority += blockedDependencyCount * 2;
  operationalPriority += missingDependencyCount * 5;
  operationalPriority += truthPriority * 2;
  operationalPriority += shortagePriority > 0 ? 3 : 0;
  operationalPriority += hasChangedDependency ? 2 : 0;
  operationalPriority += hasChefOverride ? 1 : 0;
  operationalPriority -= isOverdueRisk ? 4 : 0;
  operationalPriority -= prepTimeMinutes >= 60 ? 2 : (prepTimeMinutes >= 30 ? 1 : 0);
  operationalPriority -= Number(timePrediction?.priorityOffset || 0);

  let nextActionReason = String(task?.taskStateReason || '').trim();
  if (missingDependencyCount > 0 && blockedDependencyCount > 0) {
    nextActionReason = `Finish ${blockedDependencyCount} upstream prep item${blockedDependencyCount === 1 ? '' : 's'} and resolve ${missingDependencyCount} missing recipe link${missingDependencyCount === 1 ? '' : 's'}.`;
  } else if (missingDependencyCount > 0) {
    nextActionReason = `Resolve ${missingDependencyCount} missing recipe link${missingDependencyCount === 1 ? '' : 's'} before this prep starts.`;
  } else if (blockedDependencyCount > 0) {
    nextActionReason = `Finish ${blockedDependencyCount} upstream prep item${blockedDependencyCount === 1 ? '' : 's'} before this task runs.`;
  } else if (taskState === 'truth blocked') {
    nextActionReason = Array.isArray(task?.truthReasons) && task.truthReasons.length > 0
      ? String(task.truthReasons[0]).trim()
      : 'Fix recipe truth before this prep task can run.';
  } else if (taskState === 'truth review') {
    nextActionReason = Array.isArray(task?.truthReasons) && task.truthReasons.length > 0
      ? String(task.truthReasons[0]).trim()
      : 'Review recipe truth before handing this task downstream.';
  } else if (taskState === 'waiting approval') {
    nextActionReason = String(task?.taskStateReason || '').trim() || 'Wait for approval before this prep task runs.';
  } else if (hasChangedDependency) {
    nextActionReason = 'Check the upstream change before continuing this prep.';
  } else if (isOverdueRisk) {
    nextActionReason = String(task?.overdueReason || '').trim() || 'This prep should move now to protect service timing.';
  } else if (!nextActionReason) {
    nextActionReason = String(timePrediction?.timeSummary || '').trim() || 'This prep task is ready to run.';
  }

  return {
    operationalPriority,
    nextActionReason,
    timePrediction
  };
};

export const buildPrepTaskSessionDetail = ({
  task = {},
  sessionSnapshot = null,
  fallbackOwner = ''
} = {}) => {
  const taskId = String(task?.id || '').trim();
  const taskProgressMap = sessionSnapshot && typeof sessionSnapshot === 'object' && sessionSnapshot.taskProgress && typeof sessionSnapshot.taskProgress === 'object'
    ? sessionSnapshot.taskProgress
    : {};
  const taskProgress = taskId ? taskProgressMap[taskId] || null : null;
  const ownerLabel = String(taskProgress?.ownerLabel || fallbackOwner || '').trim();
  const completedAt = String(taskProgress?.completedAt || '').trim();
  const completedBy = String(taskProgress?.completedBy || '').trim();
  const claimedAt = String(taskProgress?.claimedAt || '').trim();
  const isCompleted = Boolean(completedAt);
  const isClaimed = Boolean(ownerLabel);

  let statusLabel = 'Open';
  if (isCompleted) {
    statusLabel = 'Completed';
  } else if (isClaimed) {
    statusLabel = 'Owned';
  }

  return {
    taskId,
    ownerLabel,
    claimedAt,
    completedAt,
    completedBy,
    isClaimed,
    isCompleted,
    statusLabel
  };
};

const buildRecipeAliasIndex = (recipes = []) => {
  const index = new Map();

  recipes.forEach((recipe, position) => {
    const key = resolveProductionRecipeKey(recipe, `idx-${position}`);
    const aliases = [
      recipe?.id,
      recipe?.recipe_id,
      recipe?.recipe_ref_id,
      recipe?.canonical_id,
      recipe?.clean_name,
      recipe?.canonical_name,
      recipe?.name,
      recipe?.sku,
      recipe?.code,
      recipe?.recipeCode,
      recipe?.recipe_code,
      key,
      ...(Array.isArray(recipe?.recipe_aliases) ? recipe.recipe_aliases : [])
    ];

    aliases.forEach((alias) => {
      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias && !index.has(normalizedAlias)) {
        index.set(normalizedAlias, { key, recipe });
      }
    });
  });

  return index;
};

const resolveIngredientRecipe = (ingredient = {}, aliasIndex) => {
  const aliases = [
    ingredient?.recipe_ref_id,
    ingredient?.canonical_id,
    ingredient?.subRecipeId,
    ingredient?.sub_recipe_id,
    ingredient?.recipeId,
    ingredient?.recipe_code,
    ingredient?.recipeCode,
    ingredient?.code,
    ingredient?.sku,
    ingredient?.clean_name,
    ingredient?.canonical_name,
    ingredient?.name
  ];

  if (Array.isArray(ingredient?.recipe_aliases)) {
    aliases.push(...ingredient.recipe_aliases);
  }

  for (const alias of aliases) {
    const found = aliasIndex.get(normalizeText(alias));
    if (found) return found;
  }

  return null;
};

const inferStation = (recipe = {}) => {
  const haystack = [
    recipe?.station,
    recipe?.workstation,
    recipe?.dishCategory,
    recipe?.dishStyle,
    recipe?.category,
    recipe?.style,
    recipe?.name
  ].map(normalizeText).join(' ');

  if (/(sauce|stock|broth|dressing|base|marinade|prep)/.test(haystack)) return 'Sauce Prep';
  if (/(grill|roast|protein|meat|chicken|beef|fish|katsu)/.test(haystack)) return 'Hot Line';
  if (/(salad|garnish|vegetable|veg|cold|pickle)/.test(haystack)) return 'Cold Prep';
  if (/(pastry|dessert|bakery|bread|cake)/.test(haystack)) return 'Pastry';
  return 'General Prep';
};

const inferSchedulePhase = (recipe = {}, station = '') => {
  const prepIntelligence = getRecipePrepIntelligence(recipe);
  const normalizedLeadTime = normalizeText(prepIntelligence.leadTime);
  const haystack = [
    station,
    recipe?.occasion,
    recipe?.serviceOccasion,
    recipe?.dishCategory,
    recipe?.dishStyle,
    recipe?.category,
    recipe?.style,
    recipe?.name
  ].map(normalizeText).join(' ');

  if (normalizedLeadTime === 'morning first') {
    return { label: 'Foundation Prep', priority: 0, leadTimeLabel: 'Morning first' };
  }

  if (normalizedLeadTime === 'morning') {
    return { label: 'Foundation Prep', priority: 0, leadTimeLabel: 'Morning' };
  }

  if (normalizedLeadTime === 'afternoon') {
    return { label: 'Component Prep', priority: 1, leadTimeLabel: 'Afternoon' };
  }

  if (normalizedLeadTime === 'before service') {
    return { label: 'Service Finish', priority: 2, leadTimeLabel: 'Before service' };
  }

  if (/(base|stock|broth|marinade|pickle|ferment|foundation|brine|dough)/.test(haystack)) {
    return { label: 'Foundation Prep', priority: 0, leadTimeLabel: 'Morning first' };
  }

  if (/(sauce|dressing|component|prep|garnish|oil|labneh|crumb|slaw|condiment)/.test(haystack)) {
    return { label: 'Component Prep', priority: 1, leadTimeLabel: 'Afternoon' };
  }

  if (/(grill|roast|protein|meat|chicken|beef|fish|katsu|service|finish|line|pass|main|fry|fried)/.test(haystack)) {
    return { label: 'Service Finish', priority: 2, leadTimeLabel: 'Before service' };
  }

  if (/(pastry|dessert|bakery|bread|cake)/.test(haystack)) {
    return { label: 'Pastry Prep', priority: 3, leadTimeLabel: 'Before service' };
  }

  return { label: 'General Prep', priority: 2, leadTimeLabel: 'Before service' };
};

const getRecipeTextList = (...sources) => (
  sources
    .flatMap((source) => {
      if (Array.isArray(source)) return source;
      if (typeof source === 'string') return source.split(/\n+/g);
      return [];
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

const inferStationGroup = (recipe = {}, station = '') => {
  const explicitGroup = [
    recipe?.dishCategory,
    recipe?.category,
    recipe?.dishStyle,
    recipe?.style,
    recipe?.station,
    station
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && !/^(general|general prep|kitchen standard|component|service)$/i.test(value));

  if (explicitGroup) {
    const normalizedExplicitGroup = normalizeText(explicitGroup);
    if (/(roll|rolls|sushi|kimbap|gimbap|maki|temaki)/.test(normalizedExplicitGroup)) return 'Rolls';
    if (/(cold|pickle|pickles|kimchi|salad|starter|side|banchan)/.test(normalizedExplicitGroup)) return 'Cold Dish';
    if (/(hot|main|protein|beef|chicken|pork|fish|curry|grill|roast|fried|katsu|line)/.test(normalizedExplicitGroup)) return 'Hot Main';
    if (/(sauce|stock|broth|dressing|marinade)/.test(normalizedExplicitGroup)) return 'Sauce';
    if (/(pastry|dessert|bakery|bread|cake|sweet)/.test(normalizedExplicitGroup)) return 'Pastry';
    if (/(foundation|base|prep|brine|component)/.test(normalizedExplicitGroup)) return 'Prep / Base';
    return explicitGroup;
  }

  const haystack = [
    station,
    recipe?.station,
    recipe?.workstation,
    recipe?.dishCategory,
    recipe?.dishStyle,
    recipe?.category,
    recipe?.style,
    recipe?.name
  ].map(normalizeText).join(' ');

  if (/(sauce|stock|broth|dressing|base|marinade|prep)/.test(haystack)) return 'Sauce';
  if (/(roll|rolls|sushi|kimbap|gimbap|maki|temaki)/.test(haystack)) return 'Rolls';
  if (/(veg|vegetable|salad|cold|pickle|kimchi|garnish|herb|starter|banchan)/.test(haystack)) return 'Cold Dish';
  if (/(meat|protein|beef|chicken|pork|lamb|fish|seafood|slice|dice|trim|grill|roast|hot|line|service|fry|fried|katsu|main|curry)/.test(haystack)) return 'Hot Main';
  if (/(pastry|dessert|bakery|bread|cake|sweet)/.test(haystack)) return 'Pastry';
  if (/(base|foundation|brine|component)/.test(haystack)) return 'Prep / Base';
  return 'General Prep';
};

const inferDishGroup = (recipe = {}) => {
  const haystack = [
    recipe?.dishCategory,
    recipe?.dishStyle,
    recipe?.occasion,
    recipe?.serviceOccasion,
    recipe?.category,
    recipe?.style,
    recipe?.name
  ].map(normalizeText).join(' ');

  if (/(dessert|pastry|bakery|cake|sweet)/.test(haystack)) return 'Dessert / Pastry';
  if (/(cold|salad|starter|appetizer|pickle|canape)/.test(haystack)) return 'Cold Dishes';
  if (/(sauce|base|stock|component|marinade|foundation)/.test(haystack)) return 'Sauce / Base';
  if (/(main|protein|beef|chicken|fish|curry|grill|roast|fried|line)/.test(haystack)) return 'Main Dishes';
  return 'Other Menu';
};

const inferEquipmentList = (recipe = {}, stationGroup = '') => {
  const explicit = getRecipeTextList(
    recipe?.equipment,
    recipe?.tools,
    recipe?.tooling,
    recipe?.requiredEquipment,
    recipe?.requiredTools
  );
  if (explicit.length > 0) return [...new Set(explicit)].slice(0, 4);

  if (stationGroup === 'Meat Prep') return ['Chef knife', 'Cutting board', 'Scale'];
  if (stationGroup === 'Veg Prep') return ['Chef knife', 'Prep tubs', 'Scale'];
  if (stationGroup === 'Sauce') return ['Pot', 'Whisk', 'Scale'];
  if (stationGroup === 'Hot Prep') return ['Range', 'Saute pan', 'Hotel pans'];
  if (stationGroup === 'Pastry') return ['Mixer', 'Tray', 'Scale'];
  return ['Scale', 'Prep tray'];
};

const getEstimatedPortions = ({
  recipe = {},
  targetYield = 0,
  thresholdCount = 0,
  portionsPerBatch = 1
} = {}) => {
  const unitLabel = normalizeText(recipe?.unit);
  if (unitLabel.includes('portion')) return Math.max(0, Math.round(toNumber(targetYield, 0)));
  return Math.max(0, Math.round(Math.max(1, toNumber(thresholdCount, 0)) * Math.max(1, toNumber(portionsPerBatch, 1))));
};

const buildExecutionSteps = ({
  recipe = {},
  dependencies = [],
  targetYield = 0,
  unit = '',
  estimatedPortions = 0,
  methodVariant = 'normal'
} = {}) => {
  const methodSteps = getRecipeTextList(
    recipe?.instructions,
    recipe?.method,
    recipe?.steps,
    recipe?.directions
  );
  const targetYieldLabel = targetYield > 0
    ? `Confirm target yield${unit ? `: ${targetYield} ${unit}` : ''} before prep starts.`
    : 'Confirm target yield before prep starts.';
  const batchLead = methodVariant === 'batch'
    ? ['Review yield scale and container plan before prep starts.']
    : [targetYieldLabel];
  const fallbackSteps = Array.isArray(dependencies) && dependencies.length > 0
    ? [`Complete ${dependencies[0]?.name || 'upstream prep'} first.`]
    : ['Confirm target yield before prep starts.'];

  if (methodSteps.length > 0) {
    return [...new Set(methodSteps)].slice(0, 4);
  }

  return [...new Set([...(batchLead || []), ...fallbackSteps])].slice(0, 4);
};

const buildChecklistItems = ({
  dependencies = [],
  equipment = [],
  targetYield = 0,
  unit = '',
  methodVariant = 'normal'
} = {}) => (
  [
    targetYield > 0 ? `Target ${targetYield}${unit ? ` ${unit}` : ''} confirmed` : 'Target yield confirmed',
    dependencies.length > 0 ? 'Upstream prep ready' : 'No upstream dependency blocking',
    equipment[0] ? `${equipment[0]} ready` : 'Tools ready',
    methodVariant === 'batch' ? 'Batch handoff containers ready' : 'Normal handoff ready'
  ].filter(Boolean).slice(0, 4)
);

const buildCriticalChecks = ({
  truthReasons = [],
  dependencyReasons = [],
  prepHandoffNote = '',
  prepStorageWindow = ''
} = {}) => (
  [...new Set([
    ...getRecipeTextList(truthReasons),
    ...getRecipeTextList(dependencyReasons),
    prepHandoffNote ? `Handoff: ${prepHandoffNote}` : '',
    prepStorageWindow ? `Storage: ${prepStorageWindow}` : ''
  ].filter(Boolean))].slice(0, 4)
);

const resolveUrgencyLevel = (task = {}) => {
  if (task?.isTruthBlocked || task?.isDependencyBlocked || task?.taskState === 'waiting approval') return 'high';
  if (task?.isOverdueRisk || Number(task?.schedulePhasePriority || 0) >= 2 || task?.taskState === 'changed') return 'high';
  if (Number(task?.schedulePhasePriority || 0) === 1 || Number(task?.truthPriority || 0) > 0) return 'medium';
  return 'normal';
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const truthStateLabel = (value) => String(value || '').trim().toLowerCase();

const evaluateRecipeTruth = (recipe = {}) => {
  const truthReasons = [];
  const baseYield = toNumber(recipe?.baseYield || recipe?.yield, 0);
  const unitLabel = String(recipe?.unit || '').trim();
  const offlineState = truthStateLabel(recipe?.offline_sync_state);
  const truthTier = toNumber(recipe?.recipe_truth_tier, 0);
  const truthFlags = Array.isArray(recipe?.recipe_truth_flags) ? recipe.recipe_truth_flags : [];
  let truthPriority = 0;
  let truthState = 'trusted';

  if (baseYield <= 0) {
    truthPriority = 2;
    truthState = 'truth blocked';
    truthReasons.push(`${recipe?.name || 'Recipe'} is missing base yield and cannot be scaled safely.`);
  }

  if (!unitLabel) {
    truthPriority = Math.max(truthPriority, 1);
    if (truthState === 'trusted') truthState = 'truth review';
    truthReasons.push(`${recipe?.name || 'Recipe'} is missing a yield unit. Confirm output unit before prep.`);
  }

  if (['conflict', 'failed', 'blocked'].includes(offlineState)) {
    truthPriority = 2;
    truthState = 'truth blocked';
    truthReasons.push(`${recipe?.name || 'Recipe'} is ${offlineState.replace(/_/g, ' ')} and should not drive prep until resolved.`);
  } else if (['local', 'pending', 'approval_required'].includes(offlineState) || truthTier >= 6) {
    truthPriority = Math.max(truthPriority, 1);
    if (truthState === 'trusted') truthState = 'truth review';
    truthReasons.push(`${recipe?.name || 'Recipe'} needs recipe-truth review before prep handoff.`);
  }

  if (truthReasons.length === 0 && truthTier > 0 && truthState === 'trusted') {
    truthPriority = 1;
    truthState = 'truth review';
    truthReasons.push(`${recipe?.name || 'Recipe'} is not yet at highest recipe-truth confidence.`);
  }

  truthFlags.forEach((flag) => {
    if (typeof flag !== 'string' || !flag.trim()) return;
    if (/unsupported yield unit|conversion reference|missing unit|unrecognized/i.test(flag)) {
      truthPriority = Math.max(truthPriority, 1);
      if (truthState === 'trusted') truthState = 'truth review';
      if (!truthReasons.includes(flag)) truthReasons.push(flag);
    }
  });

  return {
    truthPriority,
    truthState,
    truthReasons,
    truthWarningCount: truthReasons.length,
    isTruthBlocked: truthPriority >= 2
  };
};

const evaluateTaskState = ({
  recipe = {},
  task = {},
  dependencyPriority = 0,
  isTruthBlocked = false,
  truthPriority = 0,
  truthReasons = []
} = {}) => {
  const offlineState = truthStateLabel(task?.offlineSyncState || recipe?.offline_sync_state);
  const offlineReason = String(task?.offlineSyncReason || recipe?.offline_sync_reason || '').trim();
  const dependencyCount = Number(task?.dependencyCount || task?.dependencies?.length || 0);
  const blockedDependencyCount = Number(task?.blockedDependencyCount || 0);
  const missingDependencyCount = Number(task?.missingDependencyCount || 0);

  if (isTruthBlocked) {
    return {
      taskState: 'truth blocked',
      taskStatePriority: 5,
      taskStateReason: Array.isArray(truthReasons) && truthReasons.length > 0
        ? truthReasons[0]
        : `${task?.name || recipe?.name || 'Task'} is blocked by recipe truth.`
    };
  }

  if (offlineState === 'approval_required') {
    return {
      taskState: 'waiting approval',
      taskStatePriority: 3,
      taskStateReason: offlineReason
        ? `${task?.name || recipe?.name || 'Task'} is waiting approval: ${offlineReason.replace(/_/g, ' ')}.`
        : `${task?.name || recipe?.name || 'Task'} is waiting manager approval before handoff.`
    };
  }

  if (truthPriority > 0) {
    return {
      taskState: 'truth review',
      taskStatePriority: 2,
      taskStateReason: Array.isArray(truthReasons) && truthReasons.length > 0
        ? truthReasons[0]
        : `${task?.name || recipe?.name || 'Task'} needs recipe-truth review before prep handoff.`
    };
  }

  if (dependencyPriority >= 2) {
    return {
      taskState: 'blocked',
      taskStatePriority: 4,
      taskStateReason: blockedDependencyCount > 0 || missingDependencyCount > 0
        ? buildBlockedDependencySummary({
          taskName: task?.name || recipe?.name || 'Task',
          blockedDependencyCount,
          missingDependencyCount
        })
        : `${task?.name || recipe?.name || 'Task'} is blocked by upstream prep dependencies.`
    };
  }

  if (dependencyPriority === 1 || dependencyCount > 0) {
    return {
      taskState: 'ready after dependency',
      taskStatePriority: 1,
      taskStateReason: `${task?.name || recipe?.name || 'Task'} becomes executable after upstream prep dependencies are completed.`
    };
  }

  return {
    taskState: 'ready now',
    taskStatePriority: 0,
    taskStateReason: `${task?.name || recipe?.name || 'Task'} is executable now from current recipe and dependency truth.`
  };
};

const getBOMNodeSignal = (node = null) => {
  const shortageWeight = toNumber(node?.shortageWeight, 0);
  const demandWeight = toNumber(node?.effectiveDemandWeight ?? node?.demandWeight, 0);
  const availableWeight = toNumber(node?.weight, 0);

  return {
    shortageWeight,
    demandWeight,
    availableWeight
  };
};

const buildBOMLookup = (nodes = {}) => {
  const map = new Map();
  Object.entries(nodes || {}).forEach(([nodeKey, node]) => {
    const normalizedNodeKey = normalizeText(nodeKey);
    if (normalizedNodeKey) {
      map.set(normalizedNodeKey, nodeKey);
    }

    if (node?.canonicalName) {
      const normalizedCanonical = normalizeText(node.canonicalName);
      if (normalizedCanonical) {
        map.set(normalizedCanonical, nodeKey);
      }
    }
  });

  return map;
};

const buildDependencyReason = ({
  node = null,
  fallbackName = '',
  requiredQty = 0,
  unit = '',
  station = ''
} = {}) => {
  const reasonName = fallbackName || 'dependency';
  const quantityValue = toNumber(requiredQty, 0);
  const quantityText = quantityValue > 0
    ? `${Number(quantityValue.toFixed(2))}${unit ? ` ${unit}` : ''}`
    : 'required quantity';
  const stationText = station ? ` at ${station}` : '';
  const fallback = `${reasonName}: prep ${quantityText}${stationText} before this task.`;
  if (!node) return fallback;

  const shortageWeight = toNumber(node?.shortageWeight, 0);
  const demandWeight = toNumber(node?.effectiveDemandWeight, node?.demandWeight);
  const availableWeight = toNumber(node?.weight, 0);

  if (shortageWeight > 0) {
    return `${reasonName}: BOM shortage ${Number(shortageWeight.toFixed(2))}g `
      + `(demand ${Number(demandWeight.toFixed(2))}g / available ${Number(availableWeight.toFixed(2))}g).`;
  }

  if (demandWeight > 0 || availableWeight > 0) {
    return `${reasonName}: BOM balanced at ${Number(demandWeight.toFixed(2))}g demand and `
      + `${Number(availableWeight.toFixed(2))}g available.`;
  }

  return `${reasonName}: BOM graph resolved but no current volume was reported.`;
};

const buildMissingDependencyReason = (ingredient = {}, fallbackName = '') => {
  const name = String(fallbackName || ingredient?.name || 'Sub-recipe').trim();
  const quantity = toNumber(ingredient?.qty ?? ingredient?.quantity, 0);
  const unit = String(ingredient?.unit || '').trim();
  const quantityText = quantity > 0 ? ` (${Number(quantity.toFixed(2))}${unit ? ` ${unit}` : ''})` : '';
  return `${name}: sub-recipe reference is unresolved in recipe truth${quantityText}. Confirm the linked recipe before this task starts.`;
};

const buildBlockedDependencySummary = ({
  taskName = 'Task',
  blockedDependencyCount = 0,
  missingDependencyCount = 0
} = {}) => {
  const blockedCount = Number(blockedDependencyCount || 0);
  const missingCount = Number(missingDependencyCount || 0);

  if (blockedCount > 0 && missingCount > 0) {
    return `${taskName} is blocked by ${blockedCount} upstream prep dependenc${blockedCount === 1 ? 'y' : 'ies'} and ${missingCount} unresolved sub-recipe reference${missingCount === 1 ? '' : 's'}.`;
  }

  if (missingCount > 0) {
    return `${taskName} is blocked by ${missingCount} unresolved sub-recipe reference${missingCount === 1 ? '' : 's'}. Confirm recipe truth before prep starts.`;
  }

  if (blockedCount > 0) {
    return `${taskName} is blocked by ${blockedCount} upstream prep dependenc${blockedCount === 1 ? 'y' : 'ies'}. Finish that prep before this task.`;
  }

  return `${taskName} is blocked by upstream prep dependencies.`;
};

const buildDependencyBlockReason = (dependency = {}, dependencyState = null) => {
  const dependencyName = dependency?.name || 'Dependency';
  const blockedCount = Number(dependencyState?.blockedDependencyCount || 0);
  const missingCount = Number(dependencyState?.missingDependencyCount || 0);

  if (missingCount > 0 && blockedCount > 0) {
    return `${dependencyName} is blocked upstream: ${blockedCount} prep dependenc${blockedCount === 1 ? 'y' : 'ies'} still blocked and ${missingCount} sub-recipe reference${missingCount === 1 ? '' : 's'} unresolved.`;
  }

  if (missingCount > 0) {
    return `${dependencyName} is blocked upstream because ${missingCount} sub-recipe reference${missingCount === 1 ? '' : 's'} remain unresolved.`;
  }

  if (blockedCount > 0) {
    return `${dependencyName} is blocked upstream by ${blockedCount} prep dependenc${blockedCount === 1 ? 'y' : 'ies'}.`;
  }

  return `${dependencyName} is not ready.`;
};

const buildDependencyResolver = (tasksByKey = new Map()) => {
  const memo = new Map();
  const missingValue = {
    isDependencyBlocked: true,
    dependencyPriority: 2,
    dependencyDepth: 1,
    missingDependencyCount: 1,
    blockedDependencyCount: 1
  };

  const resolve = (recipeKey, traversing = new Set()) => {
    const normalizedRecipeKey = normalizeText(recipeKey);
    if (!normalizedRecipeKey) return missingValue;

    if (memo.has(normalizedRecipeKey)) return memo.get(normalizedRecipeKey);

    const task = tasksByKey.get(normalizedRecipeKey);
    if (!task) return missingValue;

    if (traversing.has(normalizedRecipeKey)) {
      const circularState = {
        isDependencyBlocked: true,
        dependencyPriority: 2,
        dependencyDepth: 1,
        missingDependencyCount: 0,
        blockedDependencyCount: task.dependencies?.length || 0,
        isCircularDependency: true
      };
      memo.set(normalizedRecipeKey, circularState);
      return circularState;
    }

    traversing.add(normalizedRecipeKey);

    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
    if (dependencies.length === 0) {
      const readyState = {
        isDependencyBlocked: false,
        dependencyPriority: 0,
        dependencyDepth: 0,
        missingDependencyCount: 0,
        blockedDependencyCount: 0
      };
      memo.set(normalizedRecipeKey, readyState);
      traversing.delete(normalizedRecipeKey);
      return readyState;
    }

    let missingDependencyCount = 0;
    let blockedDependencyCount = 0;
    let dependencyDepth = 0;

    dependencies.forEach((dependency) => {
      const childKey = normalizeText(dependency?.recipeKey);
      if (!childKey || !tasksByKey.has(childKey)) {
        missingDependencyCount += 1;
        return;
      }

      const childState = resolve(childKey, traversing);
      dependencyDepth = Math.max(dependencyDepth, Number(childState.dependencyDepth || 0) + 1);

      if (childState.isDependencyBlocked || childState.dependencyPriority > 0) {
        blockedDependencyCount += 1;
      }
    });

    const isDependencyBlocked = missingDependencyCount > 0 || blockedDependencyCount > 0;
    const dependencyPriority = isDependencyBlocked ? 2 : 1;
    const taskState = {
      isDependencyBlocked,
      dependencyPriority,
      dependencyDepth,
      missingDependencyCount,
      blockedDependencyCount,
      isCircularDependency: false
    };

    memo.set(normalizedRecipeKey, taskState);
    traversing.delete(normalizedRecipeKey);
    return taskState;
  };

  return resolve;
};

export const generateProductionTasks = ({
  recipes = [],
  dailyProduction = {},
  prepPlans = {},
  taskOverrides = {},
  portionsPerBatch = 1,
  productionInputs = null
} = {}) => {
  const recipeList = Array.isArray(recipes) ? recipes : [];
  const bomNodes = productionInputs?.nodes || null;
  const bomDemand = productionInputs?.demand || null;
  const aliasIndex = buildRecipeAliasIndex(recipeList);
  const overrideIndex = new Map(
    Object.entries(taskOverrides || {}).map(([key, value]) => [normalizeText(key), value])
  );
  const tasksByKey = new Map();
  const bomLookup = buildBOMLookup(bomNodes);

  const hasBOMData = bomNodes && Object.keys(bomNodes).length > 0;

  const getRecipeIdFromAlias = (recipe = {}, fallback = '') => {
    const fallbackKey = resolveProductionRecipeKey(recipe, fallback);
    return normalizeText(fallbackKey);
  };

  const resolveBOMNode = (recipeKey) => {
    if (!hasBOMData || !recipeKey) return null;

    const directNode = bomNodes?.[recipeKey] || null;
    if (directNode) return directNode;

    const normalizedKey = normalizeText(recipeKey);
    const indexedNodeKey = normalizedKey ? bomLookup.get(normalizedKey) : null;
    if (indexedNodeKey) return bomNodes?.[indexedNodeKey] || null;

    const aliasRecipe = aliasIndex.get(normalizedKey)?.recipe;
    if (!aliasRecipe) return null;

    const aliasRecipeKey = resolveProductionRecipeKey(aliasRecipe, recipeKey);
    if (bomNodes?.[aliasRecipeKey]) return bomNodes[aliasRecipeKey];
    const normalizedAliasKey = normalizeText(aliasRecipeKey);
    return normalizedAliasKey ? bomNodes?.[normalizedAliasKey] : null;
  };

  const getBOMScale = (recipeKey) => {
    const node = resolveBOMNode(recipeKey);
    return toNumber(node?.scale, 0);
  };

  const getBOMDemandWeight = (recipeKey) => {
    if (!hasBOMData || !bomDemand) return 0;

    const directDemandWeight = toNumber(bomDemand?.[recipeKey], 0);
    if (directDemandWeight > 0) return directDemandWeight;

    const normalizedKey = normalizeText(recipeKey);
    if (normalizedKey && Object.prototype.hasOwnProperty.call(bomDemand, normalizedKey)) {
      return toNumber(bomDemand[normalizedKey], 0);
    }

    const aliasedKey = getRecipeIdFromAlias(aliasIndex.get(normalizedKey)?.recipe, recipeKey);
    if (aliasedKey && Object.prototype.hasOwnProperty.call(bomDemand, aliasedKey)) {
      return toNumber(bomDemand[aliasedKey], 0);
    }

    const resolvedNode = resolveBOMNode(recipeKey);
    return toNumber(resolvedNode?.effectiveDemandWeight ?? resolvedNode?.demandWeight, 0);
  };

  recipeList.forEach((recipe, position) => {
    const recipeKey = resolveProductionRecipeKey(recipe, `idx-${position}`);
    const recipePlan = resolvePrepPlanForTask(prepPlans, { recipeKey, ...recipe });
    const targetYield = toNumber(dailyProduction?.[recipeKey], 0);
    const plannedYield = toNumber(recipePlan?.quantity, 0);
    const bomScale = hasBOMData ? getBOMScale(recipeKey) : 0;
    const bomDemandWeight = hasBOMData ? getBOMDemandWeight(recipeKey) : 0;
    const bomDerivedYield = bomScale > 0 ? null : (bomDemandWeight > 0 ? bomDemandWeight : 0);
    const resolvedTargetYield = targetYield > 0
      ? targetYield
      : (plannedYield > 0 ? plannedYield : bomDerivedYield);

    if (!recipe || (resolvedTargetYield <= 0 && bomScale <= 0)) return;

    const truthSignal = evaluateRecipeTruth(recipe);
    const rawBaseYield = toNumber(recipe?.baseYield || recipe?.yield, 0);
    const baseYield = rawBaseYield > 0 ? rawBaseYield : 0;
    const safeBaseYield = rawBaseYield > 0 ? rawBaseYield : 1;
    const scaleFactor = truthSignal.isTruthBlocked && rawBaseYield <= 0 && bomScale <= 0
      ? 0
      : (bomScale > 0 ? bomScale : resolvedTargetYield / safeBaseYield);
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const dependencies = [];
    const conversionWarnings = [];
    const station = inferStation(recipe);
    const schedulePhase = inferSchedulePhase(recipe, station);
    const prepIntelligence = getRecipePrepIntelligence(recipe);
    const taskNode = resolveBOMNode(recipeKey);
    const taskBOMSignal = getBOMNodeSignal(taskNode);
    const taskOverride = overrideIndex.get(normalizeText(recipeKey)) || null;
    const stationGroup = inferStationGroup(recipe, station);
    const dishGroup = inferDishGroup(recipe);

    const computedTargetYield = Number(
      (resolvedTargetYield > 0 ? resolvedTargetYield : (scaleFactor * safeBaseYield)).toFixed(2)
    );

    ingredients.forEach((ingredient) => {
      const child = resolveIngredientRecipe(ingredient, aliasIndex);
      const childName = child?.recipe?.name || child?.recipe?.clean_name || ingredient?.name || 'Sub-recipe';
      const dependencyKey = child?.key || normalizeText(
        ingredient?.recipe_ref_id
        || ingredient?.canonical_id
        || ingredient?.subRecipeId
        || ingredient?.sub_recipe_id
        || ingredient?.recipeId
        || ingredient?.recipe_code
        || ingredient?.recipeCode
        || ingredient?.code
        || ingredient?.sku
        || ingredient?.clean_name
        || ingredient?.canonical_name
        || ingredient?.name
      );
      const dependencyHint = Boolean(
        ingredient?.recipe_ref_id ||
        ingredient?.recipe_code ||
        ingredient?.recipeCode ||
        ingredient?.code ||
        ingredient?.canonical_id ||
        ingredient?.subRecipeId ||
        ingredient?.sub_recipe_id ||
        ingredient?.recipeId ||
        ingredient?.sku ||
        ingredient?.clean_name ||
        ingredient?.canonical_name ||
        (Array.isArray(ingredient?.recipe_aliases) && ingredient.recipe_aliases.length > 0)
      );

      if (!child || child.key === recipeKey) {
        if (!dependencyHint) return;
        dependencies.push({
          recipeKey: dependencyKey || `missing-${normalizeText(ingredient?.name || recipeKey)}`,
          name: childName,
          requiredQty: Number((toNumber(ingredient?.qty ?? ingredient?.quantity, 0)).toFixed(2)),
          unit: ingredient?.unit || child?.recipe?.unit || '',
          station: inferStation(child?.recipe || ingredient),
          reason: buildMissingDependencyReason(ingredient, childName),
          isMissingDependency: true
        });
        return;
      }

      if (child.key === recipeKey) return;

      const requiredQty = toNumber(ingredient?.qty ?? ingredient?.quantity, 0) * scaleFactor;
      const childNode = resolveBOMNode(child.key);
      const dependencyUnit = ingredient?.unit || child.recipe?.unit || '';
      const dependencyUnitDomain = classifyKitchenUnit(dependencyUnit);
      const childYieldUnitDomain = classifyKitchenUnit(child.recipe?.unit || '');
      if (
        dependencyUnit
        && child.recipe?.unit
        && dependencyUnitDomain
        && childYieldUnitDomain
        && dependencyUnitDomain !== 'unknown'
        && childYieldUnitDomain !== 'unknown'
        && dependencyUnitDomain !== childYieldUnitDomain
      ) {
        conversionWarnings.push(
          `Conversion review: ${child.recipe?.name || child.recipe?.clean_name || ingredient?.name || 'Sub-recipe'} is referenced in ${dependencyUnit} but yields ${child.recipe?.unit}.`
        );
      }
      dependencies.push({
        recipeKey: child.key,
        name: child.recipe?.name || child.recipe?.clean_name || ingredient?.name || 'Sub-recipe',
        requiredQty: Number(requiredQty.toFixed(2)),
        unit: dependencyUnit,
        station: inferStation(child.recipe),
        reason: buildDependencyReason({
          node: childNode,
          fallbackName: child.recipe?.name || child.recipe?.clean_name || ingredient?.name || 'Sub-recipe',
          requiredQty,
          unit: dependencyUnit,
          station: inferStation(child.recipe)
        })
      });
    });

    const batchCount = rawBaseYield > 0 ? Math.max(1, Math.ceil(scaleFactor)) : 0;
    const thresholdCount = Math.max(1, Math.ceil(computedTargetYield / Math.max(toNumber(portionsPerBatch, 1), 1)));
    const estimatedPortions = getEstimatedPortions({
      recipe,
      targetYield: computedTargetYield,
      thresholdCount,
      portionsPerBatch
    });
    const methodVariant = estimatedPortions > 50 ? 'batch' : 'normal';
    const workflow2PrepProfile = getRecipeWorkflow2PrepProfile(recipe);
    const useWorkflow2LargeProfile = shouldUseWorkflow2LargeProfile({
      prepProfile: workflow2PrepProfile,
      estimatedPortions,
      methodVariant
    });
    const fallbackEquipment = inferEquipmentList(recipe, stationGroup);
    const fallbackExecutionSteps = buildExecutionSteps({
      recipe,
      dependencies,
      targetYield: computedTargetYield,
      unit: recipe?.unit || '',
      estimatedPortions,
      methodVariant
    });
    const workflow2ExecutionSteps = getWorkflow2ExecutionSteps({
      prepProfile: workflow2PrepProfile,
      useLargeProfile: useWorkflow2LargeProfile
    });
    const executionSteps = workflow2ExecutionSteps.length > 0 ? workflow2ExecutionSteps : fallbackExecutionSteps;
    const workflow2Equipment = getWorkflow2Equipment({
      prepProfile: workflow2PrepProfile,
      useLargeProfile: useWorkflow2LargeProfile
    });
    const equipment = workflow2Equipment.length > 0 ? workflow2Equipment : fallbackEquipment;
    const scaleReason = rawBaseYield > 0
      ? (hasBOMData ? `BOM truth: ${Number(scaleFactor.toFixed(2))}x recipe scale` : `${Number(scaleFactor.toFixed(2))}x recipe scale`)
      : 'Recipe scale pending recipe truth correction';
    const batchReason = rawBaseYield > 0
      ? `${batchCount} batch${batchCount === 1 ? '' : 'es'} to prep`
      : 'Batch count pending recipe truth correction';
    const combinedTruthReasons = [...new Set([
      ...(Array.isArray(truthSignal.truthReasons) ? truthSignal.truthReasons : []),
      ...conversionWarnings
    ])];
    const combinedTruthPriority = conversionWarnings.length > 0
      ? Math.max(Number(truthSignal.truthPriority || 0), 1)
      : Number(truthSignal.truthPriority || 0);
    const combinedTruthState = combinedTruthPriority >= 2
      ? 'truth blocked'
      : (combinedTruthPriority > 0 ? 'truth review' : 'trusted');

    const prepAheadState = buildPrepAheadState({
      makeAhead: prepIntelligence.makeAhead,
      storageWindow: prepIntelligence.storageWindow,
      handoffNote: prepIntelligence.handoffNote
    });
    const workflow2StorageLabel = getWorkflow2StorageLabel({
      prepProfile: workflow2PrepProfile,
      useLargeProfile: useWorkflow2LargeProfile
    });
    const workflow2CriticalChecks = getWorkflow2CriticalChecks(workflow2PrepProfile);
    const workflow2ServiceFinish = getWorkflow2ServiceFinish(workflow2PrepProfile);

    tasksByKey.set(recipeKey, {
      id: `task-${recipeKey}`,
      recipeKey,
      name: recipe?.name || recipe?.clean_name || 'Unnamed Recipe',
      station,
      schedulePhase: schedulePhase.label,
      schedulePhasePriority: schedulePhase.priority,
      prepLeadTime: schedulePhase.leadTimeLabel || '',
      prepMakeAhead: prepIntelligence.makeAhead,
      prepAheadState: prepAheadState.state,
      prepAheadCanMoveTomorrow: prepAheadState.canMoveTomorrow,
      prepAheadCanBePartial: prepAheadState.canBePartial,
      prepAheadRationale: prepAheadState.rationale,
      prepStorageWindow: workflow2StorageLabel || prepIntelligence.storageWindow,
      prepTimeMinutes: prepIntelligence.prepTimeMinutes,
      prepHandoffNote: prepIntelligence.handoffNote,
      time_block: schedulePhase.priority <= 0 ? 'morning' : (schedulePhase.priority === 1 ? 'afternoon' : 'before_service'),
      station_group: stationGroup,
      dish_group: dishGroup,
      execution_steps: executionSteps,
      checklist: buildChecklistItems({
        dependencies,
        equipment,
        targetYield: computedTargetYield,
        unit: recipe?.unit || '',
        methodVariant
      }),
      critical_checks: workflow2CriticalChecks.length > 0 ? workflow2CriticalChecks : buildCriticalChecks({
        truthReasons: combinedTruthReasons,
        dependencyReasons: dependencies.map((dependency) => dependency?.reason || ''),
        prepHandoffNote: prepIntelligence.handoffNote,
        prepStorageWindow: prepIntelligence.storageWindow
      }),
      equipment,
      targetYield: computedTargetYield,
      unit: recipe?.unit || '',
      baseYield,
      scaleFactor: Number(scaleFactor.toFixed(2)),
      batchCount,
      thresholdCount,
      estimatedPortions,
      methodVariant,
      dependencies,
      shortageWeight: Number(taskBOMSignal.shortageWeight.toFixed(2)),
      shortagePriority: Number(taskBOMSignal.shortageWeight.toFixed(2)),
      demandWeight: taskBOMSignal.demandWeight,
      availableWeight: taskBOMSignal.availableWeight,
      basic_output: {
        recipe_name: recipe?.name || recipe?.clean_name || 'Unnamed Recipe',
        ingredients: ingredients.map((ingredient) => ingredient?.name).filter(Boolean),
        method: getRecipeTextList(recipe?.instructions, recipe?.method, recipe?.steps, recipe?.directions)
      },
      smart_data: {
        estimated_prep_time: prepIntelligence.prepTimeMinutes,
        station,
        tools_equipment: equipment,
        yield_portions: estimatedPortions
      },
      context_tags: {
        cuisine: String(recipe?.cuisine || '').trim(),
        dish_style: String(recipe?.dishStyle || recipe?.style || '').trim(),
        occasion: String(recipe?.occasion || recipe?.serviceOccasion || '').trim(),
        event_location: String(recipe?.event || recipe?.location || recipe?.serviceLocation || recipe?.eventLocation || '').trim()
      },
      scaling_logic: {
        under_50_portions: 'normal method',
        over_50_portions: 'batch method',
        active_method: methodVariant
      },
      workflow2PrepProfile,
      prepProfile: workflow2PrepProfile,
      service_finish: workflow2ServiceFinish,
      reasons: [
        scaleReason,
        batchReason,
        prepIntelligence.prepTimeMinutes > 0 ? `${prepIntelligence.prepTimeMinutes} min prep window` : null,
        ...(combinedTruthReasons.length > 0 ? [combinedTruthReasons[0]] : []),
        dependencies.length > 0
          ? `${dependencies.length} sub-recipe dependenc${dependencies.length === 1 ? 'y' : 'ies'}`
          : 'No sub-recipe dependency detected'
      ].filter(Boolean),
      truthPriority: combinedTruthPriority,
      truthState: combinedTruthState,
      truthReasons: combinedTruthReasons,
      truthWarningCount: combinedTruthReasons.length,
      isTruthBlocked: combinedTruthPriority >= 2,
      hasChefOverride: Boolean(taskOverride),
      taskChangeState: taskOverride ? 'chef adjusted' : '',
      taskChangeReason: taskOverride
        ? (taskOverride?.reasonText
          || `${recipe?.name || 'Task'} target was adjusted locally for prep execution.`)
        : '',
      taskOverrideUpdatedAt: taskOverride?.updatedAt || null,
      offlineSyncState: recipe?.offline_sync_state || null,
      offlineSyncReason: recipe?.offline_sync_reason || null
    });
  });

  const taskEntries = Array.from(tasksByKey.values());
  const resolveDependencyState = buildDependencyResolver(tasksByKey);

  taskEntries.forEach((task) => {
    const dependencyCount = Number(task?.dependencies?.length || 0);
    const dependencyState = resolveDependencyState(task?.recipeKey);
    const dependencyPriority = Number(dependencyState?.dependencyPriority || 0);
    const isDependencyBlocked = Boolean(dependencyState?.isDependencyBlocked);
    task.dependencyPriority = dependencyPriority;
    task.dependencyCount = dependencyCount;
    task.isDependencyBlocked = Boolean(isDependencyBlocked);
    task.dependencyDepth = Number(dependencyState?.dependencyDepth || 0);
    task.blockedDependencyCount = Number(dependencyState?.blockedDependencyCount || 0);
    task.missingDependencyCount = Number(dependencyState?.missingDependencyCount || 0);
    task.dependencyReasons = Array.isArray(task?.dependencies) ? task.dependencies
      .map((dependency) => {
        if (dependency?.isMissingDependency || !dependency?.recipeKey) {
          return dependency?.reason || `Missing dependency for ${task?.name || 'this task'}.`;
        }

        const dependencyState = resolveDependencyState(dependency.recipeKey);
        if (!dependencyState) return dependency?.reason || `${dependency?.name || 'Dependency'} is not ready.`;
        if (dependencyState.isCircularDependency) return `Circular dependency detected for ${dependency?.name || 'dependency'} "${dependency.recipeKey}".`;

        if (dependencyState.isDependencyBlocked || Number(dependencyState.dependencyPriority || 0) >= 2) {
          return buildDependencyBlockReason(dependency, dependencyState);
        }

        return dependency?.reason || `${dependency?.name || 'Dependency'} is currently dependent.`;
      })
      .filter(Boolean) : [];
    task.dependencyState = task.dependencyState || (dependencyPriority === 0
      ? 'ready'
      : (dependencyPriority === 1 ? 'dependent' : 'blocked'));
    const taskStateSignal = evaluateTaskState({
      recipe: aliasIndex.get(normalizeText(task?.recipeKey))?.recipe || {},
      task,
      dependencyPriority,
      isTruthBlocked: Boolean(task.isTruthBlocked),
      truthPriority: Number(task.truthPriority || 0),
      truthReasons: Array.isArray(task.truthReasons) ? task.truthReasons : []
    });
    task.taskState = taskStateSignal.taskState;
    task.taskStatePriority = Number(taskStateSignal.taskStatePriority || 0);
    task.taskStateReason = taskStateSignal.taskStateReason;

    const changedDependencyCount = Array.isArray(task?.dependencies)
      ? task.dependencies.reduce((count, dependency) => {
        const dependencyTask = tasksByKey.get(normalizeText(dependency?.recipeKey));
        return dependencyTask?.hasChefOverride ? count + 1 : count;
      }, 0)
      : 0;
    task.changedDependencyCount = changedDependencyCount;
    task.hasChangedDependency = changedDependencyCount > 0;

    if (
      !task.hasChefOverride
      && task.hasChangedDependency
      && !['truth blocked', 'waiting approval'].includes(task.taskState)
    ) {
      task.taskState = 'changed';
      task.taskStatePriority = Math.max(Number(task.taskStatePriority || 0), 2);
      task.taskStateReason = `Upstream prep changed for ${changedDependencyCount} dependenc${changedDependencyCount === 1 ? 'y' : 'ies'}. Confirm target and sequencing before handoff.`;
    }

    const isOverdueRisk = (
      Number(task?.schedulePhasePriority || 0) === 0
      && ['ready after dependency', 'truth review', 'waiting approval', 'blocked', 'truth blocked', 'changed'].includes(task.taskState)
    ) || (
      Number(task?.schedulePhasePriority || 0) === 1
      && ['waiting approval', 'blocked', 'truth blocked'].includes(task.taskState)
    );
    task.isOverdueRisk = Boolean(isOverdueRisk);
    task.overdueReason = task.isOverdueRisk
      ? `${task?.name || 'Task'} is unresolved in ${task?.schedulePhase || 'prep'} and needs escalation before downstream service pressure grows.`
      : '';

    const executionSignal = buildPrepTaskExecutionSignal(task);
    task.operationalPriority = Number(executionSignal.operationalPriority || task.taskStatePriority || 0);
    task.nextActionReason = executionSignal.nextActionReason;
    task.timePredictionLabel = String(executionSignal?.timePrediction?.timeLabel || '').trim();
    task.timePredictionSummary = String(executionSignal?.timePrediction?.timeSummary || '').trim();
    task.timePredictionDuration = String(executionSignal?.timePrediction?.durationLabel || '').trim();
    task.timePredictionPriorityOffset = Number(executionSignal?.timePrediction?.priorityOffset || 0);
    task.readinessState = task.taskState;
    task.urgency_level = resolveUrgencyLevel(task);
  });

  const grouped = taskEntries.reduce((acc, task) => {
    if (!acc[task.station]) acc[task.station] = [];
    acc[task.station].push(task);
    return acc;
  }, {});

  Object.keys(grouped).forEach((station) => {
    grouped[station].sort((a, b) => (
      (Number(a.operationalPriority || 0) - Number(b.operationalPriority || 0))
      || (Number(a.schedulePhasePriority || 0) - Number(b.schedulePhasePriority || 0))
      || (Number(a.truthPriority || 0) - Number(b.truthPriority || 0))
      || (Number(a.dependencyPriority || 0) - Number(b.dependencyPriority || 0))
      || (Number(a.dependencyCount || 0) - Number(b.dependencyCount || 0))
      || a.name.localeCompare(b.name)
    ));
  });

  return {
    tasks: taskEntries,
    grouped,
    totalTasks: tasksByKey.size,
    dependencyCount: Array.from(tasksByKey.values()).reduce((sum, task) => sum + task.dependencies.length, 0)
  };
};
