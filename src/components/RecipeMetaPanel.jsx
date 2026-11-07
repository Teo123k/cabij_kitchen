import React, { useEffect, useMemo, useState } from 'react';
import { OFFLINE_QUEUE_STATUS_LABELS, buildGeneratedProfileReviewState, buildOperationalStateCopy, buildRecipeTrainingSupport } from '../config/constants';
import ProfileReviewCard from './ProfileReviewCard';

const WEEKDAY_OPTIONS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CATEGORY_OPTIONS = ['General', 'Vegetable', 'Meat', 'Sauce', 'Dry', 'Grain', 'Wet', 'Spice', 'Aromatic', 'Fat', 'Other'];
const CUISINE_OPTIONS = ['Kitchen', 'Pan-Asian', 'Mediterranean', 'French', 'Italian', 'Mexican', 'American', 'Middle Eastern', 'Japanese', 'Korean', 'Thai', 'Indian', 'Other'];
const OCCASION_OPTIONS = ['Service', 'Lunch', 'Dinner', 'Breakfast', 'Brunch', 'Banquet', 'Prep', 'Seasonal', 'Other'];
const STYLE_OPTIONS = ['Kitchen Standard', 'Classic', 'Rustic', 'Modern', 'Fine Dining', 'Family Style', 'Other'];
const YIELD_MODE_OPTIONS = ['batch_only', 'component_usage', 'portioned'];
const SERVING_KIND_OPTIONS = ['portion', 'component_batch', 'batch'];
const PORTION_CLASS_OPTIONS = ['main', 'side', 'starter', 'component', 'sauce'];
const PRODUCTION_STRATEGY_OPTIONS = ['dynamic_daily', 'fixed_batch', 'foundational'];
const PREP_LEAD_TIME_OPTIONS = ['Morning first', 'Morning', 'Afternoon', 'Before service'];
const PREP_MAKE_AHEAD_OPTIONS = ['Same day only', 'Day before ok', 'Two days ahead ok'];
const PREP_STORAGE_OPTIONS = ['Use same day', '24 hours', '48 hours', '72 hours'];

const toText = (value, fallback = '') => String(value ?? fallback ?? '').trim();
const toDelimitedList = (value) => (
    Array.isArray(value)
        ? value.map((item) => toText(item)).filter(Boolean).join(', ')
        : toText(value)
);
const toSentence = (value) => {
    const text = toText(value);
    if (!text) return '';
    return /[.!?]$/.test(text) ? text : `${text}.`;
};
const sameNumberArray = (left = [], right = []) => (
    left.length === right.length && left.every((value, index) => value === right[index])
);

const RecipeMetaPanel = ({
    activeRecipe,
    selectedQueueEntry,
    prepTaskSteps = [],
    className = '',
    workspaceType = 'manager',
    canApproveSync = false,
    authScopeState = null,
    editMode = false,
    activePrepPlan = null,
    currentYieldValue = 0,
    trainingManagerSupport = null,
    onSaveRecipePatch = null,
    onSavePrepPlan = null,
    onStartPrep = null
}) => {
    const isStaffWorkspace = workspaceType === 'staff';
    const category = activeRecipe?.dishCategory || activeRecipe?.category || 'General';
    const style = activeRecipe?.dishStyle || activeRecipe?.style || 'Kitchen Standard';
    const cuisine = activeRecipe?.cuisine || activeRecipe?.cuisineType || activeRecipe?.dishCuisine || activeRecipe?.dishCategory || activeRecipe?.category || 'Kitchen';
    const occasion = activeRecipe?.occasion || activeRecipe?.serviceOccasion || activeRecipe?.course || 'Service';
    const recipeTruthStatus = activeRecipe?.recipe_truth_status || 'trusted';
    const recipeTruthFlags = Array.isArray(activeRecipe?.recipe_truth_flags) ? activeRecipe.recipe_truth_flags : [];
    const recipeCode = activeRecipe?.code || activeRecipe?.recipeCode || activeRecipe?.sku || activeRecipe?.recipe_ref_id || activeRecipe?.canonical_id || 'Not linked';
    const hasWorkflow2PrepProfile = Boolean(activeRecipe?.workflow2PrepProfile || activeRecipe?.prepProfile);
    const savedPrepIntelligence = useMemo(() => ({
        leadTime: toText(
            hasWorkflow2PrepProfile
                ? (activeRecipe?.prepIntelligence?.leadTime ?? activeRecipe?.scalingTips?.prepIntelligence?.leadTime)
                : (activeRecipe?.scalingTips?.prepIntelligence?.leadTime ?? activeRecipe?.prepIntelligence?.leadTime),
            'Morning'
        ),
        makeAhead: toText(
            hasWorkflow2PrepProfile
                ? (activeRecipe?.prepIntelligence?.makeAhead ?? activeRecipe?.scalingTips?.prepIntelligence?.makeAhead)
                : (activeRecipe?.scalingTips?.prepIntelligence?.makeAhead ?? activeRecipe?.prepIntelligence?.makeAhead),
            'Same day only'
        ),
        storageWindow: toText(
            hasWorkflow2PrepProfile
                ? (activeRecipe?.prepIntelligence?.storageWindow ?? activeRecipe?.scalingTips?.prepIntelligence?.storageWindow)
                : (activeRecipe?.scalingTips?.prepIntelligence?.storageWindow ?? activeRecipe?.prepIntelligence?.storageWindow),
            '24 hours'
        ),
        prepTimeMinutes: toText(
            hasWorkflow2PrepProfile
                ? (activeRecipe?.prepIntelligence?.prepTimeMinutes ?? activeRecipe?.scalingTips?.prepIntelligence?.prepTimeMinutes)
                : (activeRecipe?.scalingTips?.prepIntelligence?.prepTimeMinutes ?? activeRecipe?.prepIntelligence?.prepTimeMinutes),
            ''
        ),
        handoffNote: toText(
            hasWorkflow2PrepProfile
                ? (activeRecipe?.prepIntelligence?.handoffNote ?? activeRecipe?.scalingTips?.prepIntelligence?.handoffNote)
                : (activeRecipe?.scalingTips?.prepIntelligence?.handoffNote ?? activeRecipe?.prepIntelligence?.handoffNote),
            ''
        )
    }), [
        hasWorkflow2PrepProfile,
        activeRecipe?.scalingTips?.prepIntelligence?.leadTime,
        activeRecipe?.scalingTips?.prepIntelligence?.makeAhead,
        activeRecipe?.scalingTips?.prepIntelligence?.storageWindow,
        activeRecipe?.scalingTips?.prepIntelligence?.prepTimeMinutes,
        activeRecipe?.scalingTips?.prepIntelligence?.handoffNote,
        activeRecipe?.prepIntelligence?.leadTime,
        activeRecipe?.prepIntelligence?.makeAhead,
        activeRecipe?.prepIntelligence?.storageWindow,
        activeRecipe?.prepIntelligence?.prepTimeMinutes,
        activeRecipe?.prepIntelligence?.handoffNote
    ]);
    const normalizedPrepPlan = useMemo(() => ({
        days: Array.isArray(activePrepPlan?.days) ? activePrepPlan.days : [],
        urgent: Boolean(activePrepPlan?.urgent),
        anyDay: Boolean(activePrepPlan?.anyDay),
        auto: Boolean(activePrepPlan?.auto),
        rotateMode: activePrepPlan?.rotateMode || 'week',
        rotateCount: String(activePrepPlan?.rotateCount || 1),
        mode: activePrepPlan?.mode || 'none'
    }), [
        activePrepPlan?.days,
        activePrepPlan?.urgent,
        activePrepPlan?.anyDay,
        activePrepPlan?.auto,
        activePrepPlan?.rotateMode,
        activePrepPlan?.rotateCount,
        activePrepPlan?.mode
    ]);

    const isQueueReviewMode = Boolean(selectedQueueEntry);
    const queueStatus = selectedQueueEntry?.status || 'Pending';
    const queueReason = selectedQueueEntry?.reason || 'Review required';
    const queueStatusLabel = OFFLINE_QUEUE_STATUS_LABELS[queueStatus] || queueStatus;
    const queueUpdatedAt = selectedQueueEntry?.updatedAt
        ? new Date(selectedQueueEntry.updatedAt).toLocaleString()
        : 'Unavailable';
    const queueActor = selectedQueueEntry?.approvedBy || selectedQueueEntry?.actor || 'System';
    const queueSyncState = activeRecipe?.offline_sync_state || 'pending';
    const queueSyncReason = activeRecipe?.offline_sync_reason || 'Awaiting manager review';
    const savedTruthSetup = useMemo(() => ({
        title: toText(activeRecipe?.title ?? activeRecipe?.name, ''),
        recipeCode: toText(activeRecipe?.recipe_code ?? activeRecipe?.recipeCode ?? activeRecipe?.code, ''),
        allergens: toDelimitedList(activeRecipe?.allergens),
        baseYield: toText(activeRecipe?.baseYield ?? activeRecipe?.base_yield, ''),
        unit: toText(activeRecipe?.unit, ''),
        yieldMode: toText(activeRecipe?.yieldMode ?? activeRecipe?.yield_mode, ''),
        batchYield: toText(activeRecipe?.batchYield ?? activeRecipe?.batch_yield, ''),
        servingSize: toText(activeRecipe?.servingSize ?? activeRecipe?.serving_size, ''),
        servingKind: toText(activeRecipe?.servingKind ?? activeRecipe?.serving_kind, ''),
        portionClass: toText(activeRecipe?.portionClass ?? activeRecipe?.portion_class, ''),
        recordedServingWeight: toText(activeRecipe?.recordedServingWeight ?? activeRecipe?.recorded_serving_weight, ''),
        recordedServingUnit: toText(activeRecipe?.recordedServingUnit ?? activeRecipe?.recorded_serving_unit, ''),
        productionStrategy: toText(activeRecipe?.productionStrategy ?? activeRecipe?.production_strategy, ''),
        productionBatchSize: toText(activeRecipe?.productionBatchSize ?? activeRecipe?.production_batch_size, '')
    }), [
        activeRecipe?.title,
        activeRecipe?.name,
        activeRecipe?.recipe_code,
        activeRecipe?.recipeCode,
        activeRecipe?.code,
        activeRecipe?.allergens,
        activeRecipe?.baseYield,
        activeRecipe?.base_yield,
        activeRecipe?.unit,
        activeRecipe?.yieldMode,
        activeRecipe?.yield_mode,
        activeRecipe?.batchYield,
        activeRecipe?.batch_yield,
        activeRecipe?.servingSize,
        activeRecipe?.serving_size,
        activeRecipe?.servingKind,
        activeRecipe?.serving_kind,
        activeRecipe?.portionClass,
        activeRecipe?.portion_class,
        activeRecipe?.recordedServingWeight,
        activeRecipe?.recorded_serving_weight,
        activeRecipe?.recordedServingUnit,
        activeRecipe?.recorded_serving_unit,
        activeRecipe?.productionStrategy,
        activeRecipe?.production_strategy,
        activeRecipe?.productionBatchSize,
        activeRecipe?.production_batch_size
    ]);

    const savedNotes = useMemo(() => {
        const notes = activeRecipe?.scalingTips?.notes;
        return Array.isArray(notes) ? notes.slice(0, 3) : [];
    }, [activeRecipe?.scalingTips?.notes]);
    const trainingSupport = useMemo(
        () => buildRecipeTrainingSupport(activeRecipe, { currentYieldValue }),
        [activeRecipe, currentYieldValue]
    );
    const generatedProfileReviewState = useMemo(
        () => buildGeneratedProfileReviewState(activeRecipe),
        [activeRecipe]
    );
    const authScopeLabel = toText(authScopeState?.label, 'Trusted client scope');
    const authScopeReason = toText(authScopeState?.reason, '');
    const emptyRecipeCopy = useMemo(
        () => buildOperationalStateCopy({
            kind: 'recipe-selection-empty',
            authScopeState,
            hasRecipes: true,
            hasActiveRecipe: Boolean(activeRecipe)
        }),
        [authScopeState, activeRecipe]
    );

    const recipeTruthRows = useMemo(() => ([
        { key: 'Recipe code', value: recipeCode },
        { key: 'Allergens', value: savedTruthSetup.allergens || 'None listed' },
        {
            key: 'Prep time',
            value: savedPrepIntelligence?.prepTimeMinutes
                ? `${savedPrepIntelligence.prepTimeMinutes} min`
                : 'Not set'
        },
        { key: 'Storage life', value: toText(savedPrepIntelligence?.storageWindow, '24 hours') }
    ]), [
        recipeCode,
        savedTruthSetup.allergens,
        savedPrepIntelligence?.prepTimeMinutes,
        savedPrepIntelligence?.storageWindow
    ]);
    const serviceOutputRows = useMemo(() => {
        const totalOutput = [savedTruthSetup.baseYield, savedTruthSetup.unit].filter(Boolean).join(' ').trim() || 'Not set';
        const portionSetup = [
            savedTruthSetup.batchYield ? `${savedTruthSetup.batchYield} portions` : '',
            savedTruthSetup.servingSize ? `${savedTruthSetup.servingSize} each` : '',
            savedTruthSetup.recordedServingWeight
                ? `${savedTruthSetup.recordedServingWeight}${savedTruthSetup.recordedServingUnit ? ` ${savedTruthSetup.recordedServingUnit}` : ''} recorded`
                : ''
        ].filter(Boolean).join(' / ') || 'Set in Settings';
        const batchNote = [
            savedTruthSetup.productionStrategy,
            savedTruthSetup.productionBatchSize ? `batch ${savedTruthSetup.productionBatchSize}` : ''
        ].filter(Boolean).join(' / ') || 'No special batch note';

        return [
            { key: 'Total output', value: totalOutput },
            { key: 'Portion setup', value: portionSetup },
            { key: 'Batch note', value: batchNote }
        ];
    }, [
        savedTruthSetup.baseYield,
        savedTruthSetup.unit,
        savedTruthSetup.batchYield,
        savedTruthSetup.servingSize,
        savedTruthSetup.recordedServingWeight,
        savedTruthSetup.recordedServingUnit,
        savedTruthSetup.productionStrategy,
        savedTruthSetup.productionBatchSize
    ]);
    const chefSupportSteps = useMemo(() => {
        const normalizedPrepTaskSteps = (Array.isArray(prepTaskSteps) ? prepTaskSteps : [])
            .map((item) => toText(item))
            .filter(Boolean)
            .slice(0, 4);
        if (normalizedPrepTaskSteps.length > 0) return normalizedPrepTaskSteps;
        return [];
    }, [
        prepTaskSteps
    ]);

    const [noteEditorOpen, setNoteEditorOpen] = useState(false);
    const [expandedNoteIndex, setExpandedNoteIndex] = useState(null);
    const [noteDrafts, setNoteDrafts] = useState(savedNotes);
    const [showPrepDescription, setShowPrepDescription] = useState(false);
    const [prepMode, setPrepMode] = useState('none');
    const [prepDays, setPrepDays] = useState([]);
    const [prepUrgent, setPrepUrgent] = useState(false);
    const [prepAnyDay, setPrepAnyDay] = useState(false);
    const [prepAuto, setPrepAuto] = useState(false);
    const [rotateMode, setRotateMode] = useState('week');
    const [rotateCount, setRotateCount] = useState('1');
    const isPrepWeekMode = prepMode === 'prepThisWeek';
    const isRotatePrepMode = prepMode === 'rotatePrep';
    const isPrepModeActive = isPrepWeekMode || isRotatePrepMode;
    const [metaDraft, setMetaDraft] = useState({
        category,
        cuisine,
        occasion,
        style
    });
    const [truthDraft, setTruthDraft] = useState(savedTruthSetup);
    const [prepIntelligenceDraft, setPrepIntelligenceDraft] = useState({
        leadTime: savedPrepIntelligence.leadTime,
        makeAhead: savedPrepIntelligence.makeAhead,
        storageWindow: savedPrepIntelligence.storageWindow,
        prepTimeMinutes: savedPrepIntelligence.prepTimeMinutes,
        handoffNote: savedPrepIntelligence.handoffNote
    });

    useEffect(() => {
        setNoteDrafts(savedNotes);
    }, [savedNotes]);

    useEffect(() => {
        setMetaDraft({
            category,
            cuisine,
            occasion,
            style
        });
    }, [category, cuisine, occasion, style, activeRecipe?.id, activeRecipe?.recipe_ref_id, activeRecipe?.canonical_id, activeRecipe?.name]);

    useEffect(() => {
        setTruthDraft((prev) => {
            const keys = Object.keys(savedTruthSetup);
            const isSame = keys.every((key) => prev?.[key] === savedTruthSetup[key]);
            return isSame ? prev : { ...savedTruthSetup };
        });
    }, [savedTruthSetup]);

    useEffect(() => {
        setPrepDays((prev) => (sameNumberArray(prev, normalizedPrepPlan.days) ? prev : normalizedPrepPlan.days));
        setPrepUrgent((prev) => (prev === normalizedPrepPlan.urgent ? prev : normalizedPrepPlan.urgent));
        setPrepAnyDay((prev) => (prev === normalizedPrepPlan.anyDay ? prev : normalizedPrepPlan.anyDay));
        setPrepAuto((prev) => (prev === normalizedPrepPlan.auto ? prev : normalizedPrepPlan.auto));
        setRotateMode((prev) => (prev === normalizedPrepPlan.rotateMode ? prev : normalizedPrepPlan.rotateMode));
        setRotateCount((prev) => (prev === normalizedPrepPlan.rotateCount ? prev : normalizedPrepPlan.rotateCount));
        setPrepMode((prev) => (prev === normalizedPrepPlan.mode ? prev : normalizedPrepPlan.mode));
    }, [normalizedPrepPlan]);

    useEffect(() => {
        setPrepIntelligenceDraft((prev) => {
            if (
                prev.leadTime === savedPrepIntelligence.leadTime &&
                prev.makeAhead === savedPrepIntelligence.makeAhead &&
                prev.storageWindow === savedPrepIntelligence.storageWindow &&
                prev.prepTimeMinutes === savedPrepIntelligence.prepTimeMinutes &&
                prev.handoffNote === savedPrepIntelligence.handoffNote
            ) {
                return prev;
            }
            return { ...savedPrepIntelligence };
        });
    }, [savedPrepIntelligence]);

    const saveNotes = () => {
        if (!onSaveRecipePatch) return;
        const cleanedNotes = noteDrafts
            .map((note, index) => ({
                title: toText(note?.title, `Note ${index + 1}`),
                body: toText(note?.body, '')
            }))
            .filter((note) => note.body);
        onSaveRecipePatch({
            scalingTips: {
                ...(activeRecipe?.scalingTips || {}),
                notes: cleanedNotes
            }
        }, { source: 'recipe-manager-notes' });
        setExpandedNoteIndex(null);
        setNoteEditorOpen(false);
    };

    const resetNotes = () => {
        setNoteDrafts(savedNotes);
        setExpandedNoteIndex(null);
        setNoteEditorOpen(false);
    };

    const addNoteDraft = () => {
        setNoteDrafts((prev) => {
            if (prev.length >= 3) return prev;
            return [...prev, { title: '', body: '' }];
        });
        setNoteEditorOpen(true);
        setExpandedNoteIndex(noteDrafts.length);
    };

    const removeNoteDraft = (index) => {
        setNoteDrafts((prev) => prev.filter((_, noteIndex) => noteIndex !== index));
        setExpandedNoteIndex((prev) => (prev === index ? null : prev));
    };

    const saveMetaField = (field, value) => {
        if (!onSaveRecipePatch) return;
        const nextValue = toText(value);
        if (!nextValue) return;

        const currentValue = field === 'style'
            ? style
            : field === 'cuisine'
                ? cuisine
                : field === 'occasion'
                    ? occasion
                    : category;
        if (nextValue === toText(currentValue)) return;

        if (field === 'category') {
            onSaveRecipePatch({
                dishCategory: nextValue,
                category: nextValue
            }, { source: 'recipe-meta-category-edit' });
            return;
        }

        if (field === 'cuisine') {
            onSaveRecipePatch({
                cuisine: nextValue,
                cuisineType: nextValue,
                dishCuisine: nextValue
            }, { source: 'recipe-meta-cuisine-edit' });
            return;
        }

        if (field === 'occasion') {
            onSaveRecipePatch({
                occasion: nextValue,
                serviceOccasion: nextValue
            }, { source: 'recipe-meta-occasion-edit' });
            return;
        }

        onSaveRecipePatch({
            dishStyle: nextValue,
            style: nextValue
        }, { source: 'recipe-meta-style-edit' });
    };

    const metaFieldOptions = {
        category: CATEGORY_OPTIONS,
        cuisine: CUISINE_OPTIONS,
        occasion: OCCASION_OPTIONS,
        style: STYLE_OPTIONS
    };

    const truthFieldOptions = {
        yieldMode: YIELD_MODE_OPTIONS,
        servingKind: SERVING_KIND_OPTIONS,
        portionClass: PORTION_CLASS_OPTIONS,
        productionStrategy: PRODUCTION_STRATEGY_OPTIONS
    };

    const saveTruthField = (field, value) => {
        if (!onSaveRecipePatch) return;

        const nextValue = toText(value);
        if (nextValue === savedTruthSetup[field]) return;

        if (field === 'allergens') {
            const cleanedAllergens = nextValue
                .split(/[,|\n]+/)
                .map((item) => toText(item))
                .filter(Boolean);
            onSaveRecipePatch({
                allergens: cleanedAllergens
            }, { source: 'recipe-truth-allergens-edit' });
            return;
        }

        if (field === 'title') {
            onSaveRecipePatch({
                title: nextValue
            }, { source: 'recipe-truth-title-edit' });
            return;
        }

        if (field === 'recipeCode') {
            onSaveRecipePatch({
                code: nextValue,
                recipeCode: nextValue,
                recipe_code: nextValue
            }, { source: 'recipe-truth-code-edit' });
            return;
        }

        const numericValue = nextValue === '' ? null : Number(nextValue);
        const isNumericField = [
            'baseYield',
            'batchYield',
            'servingSize',
            'recordedServingWeight',
            'productionBatchSize'
        ].includes(field);

        if (isNumericField && nextValue !== '' && !Number.isFinite(numericValue)) return;

        if (field === 'baseYield') {
            onSaveRecipePatch({
                baseYield: numericValue,
                base_yield: numericValue
            }, { source: 'recipe-truth-base-yield-edit' });
            return;
        }

        if (field === 'unit') {
            onSaveRecipePatch({
                unit: nextValue
            }, { source: 'recipe-truth-unit-edit' });
            return;
        }

        if (field === 'yieldMode') {
            onSaveRecipePatch({
                yieldMode: nextValue,
                yield_mode: nextValue
            }, { source: 'recipe-truth-yield-mode-edit' });
            return;
        }

        if (field === 'batchYield') {
            onSaveRecipePatch({
                batchYield: numericValue,
                batch_yield: numericValue
            }, { source: 'recipe-truth-batch-yield-edit' });
            return;
        }

        if (field === 'servingSize') {
            onSaveRecipePatch({
                servingSize: numericValue,
                serving_size: numericValue
            }, { source: 'recipe-truth-serving-size-edit' });
            return;
        }

        if (field === 'servingKind') {
            onSaveRecipePatch({
                servingKind: nextValue,
                serving_kind: nextValue
            }, { source: 'recipe-truth-serving-kind-edit' });
            return;
        }

        if (field === 'portionClass') {
            onSaveRecipePatch({
                portionClass: nextValue,
                portion_class: nextValue
            }, { source: 'recipe-truth-portion-class-edit' });
            return;
        }

        if (field === 'recordedServingWeight') {
            onSaveRecipePatch({
                recordedServingWeight: numericValue,
                recorded_serving_weight: numericValue
            }, { source: 'recipe-truth-recorded-weight-edit' });
            return;
        }

        if (field === 'recordedServingUnit') {
            onSaveRecipePatch({
                recordedServingUnit: nextValue,
                recorded_serving_unit: nextValue
            }, { source: 'recipe-truth-recorded-unit-edit' });
            return;
        }

        if (field === 'productionStrategy') {
            onSaveRecipePatch({
                productionStrategy: nextValue,
                production_strategy: nextValue
            }, { source: 'recipe-truth-production-strategy-edit' });
            return;
        }

        if (field === 'productionBatchSize') {
            onSaveRecipePatch({
                productionBatchSize: numericValue,
                production_batch_size: numericValue
            }, { source: 'recipe-truth-production-batch-size-edit' });
        }
    };

    const savePrepIntelligenceField = (field, value) => {
        if (!onSaveRecipePatch) return;
        if (hasWorkflow2PrepProfile) {
            setPrepIntelligenceDraft({ ...savedPrepIntelligence });
            return;
        }
        const nextValue = toText(value);
        const currentValue = toText(savedPrepIntelligence?.[field], field === 'leadTime'
            ? 'Morning'
            : field === 'makeAhead'
                ? 'Same day only'
                : field === 'storageWindow'
                    ? '24 hours'
                    : '');
        if (nextValue === currentValue) return;

        onSaveRecipePatch({
            scalingTips: {
                ...(activeRecipe?.scalingTips || {}),
                prepIntelligence: {
                    ...savedPrepIntelligence,
                    [field]: nextValue
                }
            }
        }, { source: `recipe-prep-intelligence-${field}` });
    };

    const togglePrepDay = (dayIndex) => {
        setPrepDays((prev) => (
            prev.includes(dayIndex)
                ? prev.filter((value) => value !== dayIndex)
                : [...prev, dayIndex].sort((left, right) => left - right)
        ));
    };

    const selectPrepMode = (nextMode) => {
        if (!['prepThisWeek', 'rotatePrep', 'none'].includes(nextMode)) return;

        setPrepMode((currentMode) => {
            const resolved = currentMode === nextMode ? 'none' : nextMode;
            const modeChanged = currentMode !== resolved;

            if (modeChanged) {
                setPrepDays([]);
                setPrepAnyDay(false);
                setPrepAuto(false);
            }

            if (resolved === 'rotatePrep') {
                return resolved;
            }

            if (resolved === 'prepThisWeek') {
                return resolved;
            }

            if (resolved === 'none') {
                return 'none';
            }

            return 'none';
        });
    };

    const submitPrepPlan = () => {
        if (prepMode === 'none') return;

        const isRotate = prepMode === 'rotatePrep';
        const selectedDays = Array.isArray(prepDays) ? prepDays : [];
        const hasValidDaySelection = isRotate ? selectedDays.length > 0 : (prepAnyDay || selectedDays.length > 0);

        if (!isRotate && !hasValidDaySelection) {
            window.alert('Select at least one day or choose Any day before saving prep this week.');
            return;
        }

        if (isRotate && selectedDays.length === 0) {
            window.alert('Select at least one weekday for rotate prep before saving.');
            return;
        }

        const dayLabel = prepAnyDay
            ? 'any day'
            : (selectedDays.length ? selectedDays.map((index) => WEEKDAY_OPTIONS[index]).join(', ') : 'no day selected');
        const modeLabel = prepMode === 'prepThisWeek'
            ? 'prep this week'
            : 'rotate prep';
        const confirmed = window.confirm(`Add ${activeRecipe?.name || 'this recipe'} to ${modeLabel} at ${Number(currentYieldValue || 0).toFixed(0)} units for ${dayLabel}?`);
        if (!confirmed) return;
        if (typeof onSavePrepPlan === 'function') {
            onSavePrepPlan({
                mode: prepMode,
                recipe: activeRecipe,
                days: selectedDays,
                urgent: prepUrgent,
                anyDay: isRotate ? false : prepAnyDay,
                auto: isRotate ? false : prepAuto,
                rotateMode: prepMode === 'rotatePrep' ? rotateMode : 'week',
                rotateCount: prepMode === 'rotatePrep' ? Number(rotateCount || 1) : 1
            });
        }
        if (typeof onStartPrep === 'function') onStartPrep();
    };

    const queueRows = [
        { key: 'Queue status', value: queueStatusLabel },
        { key: 'Reason', value: queueReason },
        { key: 'Updated by', value: queueActor },
        { key: 'Offline sync', value: queueSyncState },
        { key: 'Sync reason', value: queueSyncReason },
        { key: 'Updated', value: queueUpdatedAt },
    ];

    const renderReadonlyRows = (rows) => (
        <div className="side-list">
            {rows.map(({ key, value }) => (
                <div className="side-row" key={key}>
                    <span className="side-key">{key}</span>
                    <div className="dropdown-box">
                        <span className="text-ellipsis" title={value}>
                            {value}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );

    const staffWorkspaceRows = [
        { key: 'Recipe code', value: recipeCode },
        { key: 'Yield', value: `${Number(activeRecipe?.baseYield || 0).toFixed(2)} ${toText(activeRecipe?.unit, 'Not set')}`.trim() },
        { key: 'Allergens', value: trainingSupport.allergenLabel },
        { key: 'Recipe truth', value: trainingSupport.truthLabel }
    ];

    const staffPrepRows = [
        { key: 'Lead time', value: toText(savedPrepIntelligence?.leadTime, 'Morning') },
        { key: 'Make ahead', value: toText(savedPrepIntelligence?.makeAhead, 'Same day only') },
        { key: 'Storage life', value: toText(savedPrepIntelligence?.storageWindow, '24 hours') },
        { key: 'Prep mins', value: toText(savedPrepIntelligence?.prepTimeMinutes, 'Not set') },
        { key: 'Handoff', value: toText(savedPrepIntelligence?.handoffNote, 'No handoff note') }
    ];

    if (isQueueReviewMode) {
        return (
            <div className={`recipe-meta-panel ${className}`}>
                <section className="side-card">
                    <div className="edit-head">
                        <div className="side-title">Manager Queue Review</div>
                        <div className="edit-toggle">{queueStatusLabel}</div>
                    </div>
                    {renderReadonlyRows(queueRows)}
                </section>

                <section className="side-card">
                    <div className="side-title">Manager Decision Guardrail</div>
                    <div className="side-copy">
                        {recipeTruthFlags.length > 0
                            ? recipeTruthFlags.join(' / ')
                            : 'Confirm recipe truth impact before approving this queue entry. Check ingredients, allergens, and station sequencing impacts.'}
                    </div>
                </section>
            </div>
        );
    }

    if (!activeRecipe) {
        return (
            <div className={`recipe-meta-panel ${className}`}>
                <section className="side-card">
                    <div className="edit-head">
                        <div className="side-title">{emptyRecipeCopy.title}</div>
                    </div>
                    <div className="side-copy">{emptyRecipeCopy.body}</div>
                </section>
                {authScopeState?.isDegraded ? (
                    <section className="side-card">
                        <div className="edit-head">
                            <div className="side-title">Access Status</div>
                            <div className="edit-toggle">{authScopeLabel}</div>
                        </div>
                        <div className="side-copy">{authScopeReason}</div>
                    </section>
                ) : null}
            </div>
        );
    }

    if (isStaffWorkspace) {
        return (
            <div className={`recipe-meta-panel ${className}`}>
                <section className="side-card">
                    <div className="edit-head">
                        <div>
                            <div className="side-title">Recipe Handoff</div>
                            <div className="side-copy">Read-only recipe view for staff execution.</div>
                        </div>
                        <div className="edit-toggle">Staff</div>
                    </div>
                    <div className="side-chip-row">
                        <span className="meta-chip">{category}</span>
                        <span className="meta-chip">{style}</span>
                        <span className="meta-chip">{cuisine}</span>
                    </div>
                    {renderReadonlyRows(staffWorkspaceRows)}
                </section>

                <ProfileReviewCard
                    reviewState={generatedProfileReviewState}
                    title="Generated profile review"
                    restricted
                />

                {authScopeState?.isDegraded ? (
                    <section className="side-card">
                        <div className="edit-head">
                            <div className="side-title">Access Status</div>
                            <div className="edit-toggle">{authScopeLabel}</div>
                        </div>
                        <div className="side-copy">{authScopeReason}</div>
                    </section>
                ) : null}

                <section className="side-card">
                    <div className="edit-head">
                        <div>
                            <div className="side-title">Training Link</div>
                            <div className="side-copy">Use the linked lesson when you need the exact teaching flow.</div>
                        </div>
                        <div className="edit-toggle">{trainingSupport.truthLabel}</div>
                    </div>
                    {renderReadonlyRows([
                        { key: 'Version', value: trainingSupport.versionLabel },
                        { key: 'Steps', value: String(trainingSupport.stepCards.length) },
                        { key: 'Readiness', value: trainingSupport.readinessLabel }
                    ])}
                    <div className="side-copy">{trainingSupport.readinessCopy}</div>
                </section>

                <section className="side-card">
                    <div className="side-title">Kitchen Notes</div>
                    {renderReadonlyRows(staffPrepRows)}
                </section>
            </div>
        );
    }

    return (
        <div className={`recipe-meta-panel ${className}`}>
            <section className="side-card">
                <div className="edit-head">
                    <div>
                        <div className="side-title">Recipe Truth</div>
                        <div className="side-copy">Current access: {editMode ? 'edit' : (canApproveSync ? 'manager' : 'staff')}</div>
                    </div>
                    <div className="edit-toggle">{recipeTruthStatus}</div>
                </div>

                <div className="side-chip-row">
                    <span className="meta-chip">{category}</span>
                    <span className="meta-chip">{style}</span>
                    <span className="meta-chip">{cuisine}</span>
                    <span className="meta-chip">{occasion}</span>
                </div>
                {renderReadonlyRows(recipeTruthRows)}
            </section>

            <ProfileReviewCard
                reviewState={generatedProfileReviewState}
                title="Generated profile review"
            />

            {authScopeState?.isDegraded ? (
                <section className="side-card">
                    <div className="edit-head">
                        <div className="side-title">Access Status</div>
                        <div className="edit-toggle">{authScopeLabel}</div>
                    </div>
                    <div className="side-copy">{authScopeReason}</div>
                </section>
            ) : null}

            {editMode ? (
                <section className="side-card">
                        <div className="edit-head">
                            <div className="side-title">Recipe Setup</div>
                            <div className="edit-toggle">Edit mode</div>
                        </div>
                        <div className="side-list">
                            {[
                                { key: 'Recipe title', field: 'title' },
                                { key: 'Recipe code', field: 'recipeCode' },
                                { key: 'Allergens', field: 'allergens', placeholder: 'soy, sesame, dairy' }
                            ].map((item) => (
                                <div className="side-row" key={item.field}>
                                    <span className="side-key">{item.key}</span>
                                    <div className="side-edit-stack">
                                        <input
                                            className="side-input"
                                            placeholder={item.placeholder || `Enter ${item.key.toLowerCase()}`}
                                            value={truthDraft[item.field] || ''}
                                            onChange={(event) => {
                                                const nextValue = event.target.value;
                                                setTruthDraft((prev) => ({ ...prev, [item.field]: nextValue }));
                                            }}
                                            onBlur={(event) => saveTruthField(item.field, event.target.value)}
                                        />
                                    </div>
                                </div>
                            ))}
                            {[
                                { key: 'Category', field: 'category' },
                                { key: 'Cuisine', field: 'cuisine' },
                                { key: 'Occasion', field: 'occasion' },
                                { key: 'Dish style', field: 'style' }
                        ].map((item) => (
                            <div className="side-row" key={item.field}>
                                <span className="side-key">{item.key}</span>
                                <div className="side-edit-stack">
                                    <input
                                        className="side-input"
                                        list={`recipe-${item.field}-options`}
                                        placeholder={`Select or type ${item.key.toLowerCase()}`}
                                        value={metaDraft[item.field] || ''}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setMetaDraft((prev) => ({ ...prev, [item.field]: nextValue }));
                                        }}
                                        onBlur={(event) => saveMetaField(item.field, event.target.value)}
                                    />
                                    <datalist id={`recipe-${item.field}-options`}>
                                        {(metaFieldOptions[item.field] || []).map((option) => (
                                            <option key={option} value={option} />
                                        ))}
                                    </datalist>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}

            {editMode ? (
                <section className="side-card">
                    <div className="edit-head">
                        <div className="side-title">Service Output</div>
                        <div className="edit-toggle">Live fields</div>
                    </div>
                    <div className="side-list">
                        {[
                            { key: 'Base yield', field: 'baseYield', inputMode: 'decimal' },
                            { key: 'Yield unit', field: 'unit' },
                            { key: 'Yield mode', field: 'yieldMode', options: truthFieldOptions.yieldMode },
                            { key: 'Batch yield', field: 'batchYield', inputMode: 'decimal' },
                            { key: 'Serving size', field: 'servingSize', inputMode: 'decimal' },
                            { key: 'Serving kind', field: 'servingKind', options: truthFieldOptions.servingKind },
                            { key: 'Portion class', field: 'portionClass', options: truthFieldOptions.portionClass },
                            { key: 'Recorded serving weight', field: 'recordedServingWeight', inputMode: 'decimal' },
                            { key: 'Recorded serving unit', field: 'recordedServingUnit' },
                            { key: 'Production strategy', field: 'productionStrategy', options: truthFieldOptions.productionStrategy },
                            { key: 'Production batch size', field: 'productionBatchSize', inputMode: 'decimal' }
                        ].map((item) => (
                            <div className="side-row" key={item.field}>
                                <span className="side-key">{item.key}</span>
                                <div className="side-edit-stack">
                                    <input
                                        className="side-input"
                                        inputMode={item.inputMode}
                                        list={item.options ? `recipe-truth-${item.field}-options` : undefined}
                                        value={truthDraft[item.field] || ''}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setTruthDraft((prev) => ({ ...prev, [item.field]: nextValue }));
                                        }}
                                        onBlur={(event) => saveTruthField(item.field, event.target.value)}
                                    />
                                    {item.options ? (
                                        <datalist id={`recipe-truth-${item.field}-options`}>
                                            {item.options.map((option) => (
                                                <option key={option} value={option} />
                                            ))}
                                        </datalist>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}

            <section className="side-card">
                <div className="edit-head">
                    <div>
                        <div className="side-title">Chef Support</div>
                        <div className="side-copy">
                            {hasWorkflow2PrepProfile
                                ? 'Short kitchen summary from the active prep profile.'
                                : 'Short kitchen summary for the current recipe.'}
                        </div>
                    </div>
                    <div className="edit-toggle">{chefSupportSteps.length > 0 ? `${chefSupportSteps.length} steps` : 'Summary'}</div>
                </div>
                {editMode && !hasWorkflow2PrepProfile ? (
                    <div className="side-list" style={{ marginTop: '0.85rem' }}>
                        <div className="side-row">
                            <span className="side-key">Lead time</span>
                            <div className="side-edit-stack">
                                <input
                                    className="side-input"
                                    list="recipe-prep-lead-time-options"
                                    value={prepIntelligenceDraft.leadTime}
                                    onChange={(event) => setPrepIntelligenceDraft((prev) => ({ ...prev, leadTime: event.target.value }))}
                                    onBlur={(event) => savePrepIntelligenceField('leadTime', event.target.value)}
                                />
                                <datalist id="recipe-prep-lead-time-options">
                                    {PREP_LEAD_TIME_OPTIONS.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                        <div className="side-row">
                            <span className="side-key">Make ahead</span>
                            <div className="side-edit-stack">
                                <input
                                    className="side-input"
                                    list="recipe-prep-make-ahead-options"
                                    value={prepIntelligenceDraft.makeAhead}
                                    onChange={(event) => setPrepIntelligenceDraft((prev) => ({ ...prev, makeAhead: event.target.value }))}
                                    onBlur={(event) => savePrepIntelligenceField('makeAhead', event.target.value)}
                                />
                                <datalist id="recipe-prep-make-ahead-options">
                                    {PREP_MAKE_AHEAD_OPTIONS.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                        <div className="side-row">
                            <span className="side-key">Storage life</span>
                            <div className="side-edit-stack">
                                <input
                                    className="side-input"
                                    list="recipe-prep-storage-options"
                                    value={prepIntelligenceDraft.storageWindow}
                                    onChange={(event) => setPrepIntelligenceDraft((prev) => ({ ...prev, storageWindow: event.target.value }))}
                                    onBlur={(event) => savePrepIntelligenceField('storageWindow', event.target.value)}
                                />
                                <datalist id="recipe-prep-storage-options">
                                    {PREP_STORAGE_OPTIONS.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                        <div className="side-row">
                            <span className="side-key">Prep mins</span>
                            <div className="side-edit-stack">
                                <input
                                    className="side-input"
                                    inputMode="numeric"
                                    value={prepIntelligenceDraft.prepTimeMinutes}
                                    onChange={(event) => setPrepIntelligenceDraft((prev) => ({ ...prev, prepTimeMinutes: event.target.value }))}
                                    onBlur={(event) => savePrepIntelligenceField('prepTimeMinutes', event.target.value)}
                                />
                            </div>
                        </div>
                        <div className="side-row">
                            <span className="side-key">Handoff</span>
                            <textarea
                                className="side-textarea"
                                value={prepIntelligenceDraft.handoffNote}
                                onChange={(event) => setPrepIntelligenceDraft((prev) => ({ ...prev, handoffNote: event.target.value }))}
                                onBlur={(event) => savePrepIntelligenceField('handoffNote', event.target.value)}
                                placeholder="Short note for half-done or next-shift prep..."
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="side-copy" style={{ marginTop: '0.85rem' }}>
                            {hasWorkflow2PrepProfile
                                ? 'Use these steps as the quick prep guide for this recipe.'
                                : 'Use these steps as the quick prep guide while this recipe is in progress.'}
                        </div>
                        <div className="side-list">
                            {(chefSupportSteps.length > 0 ? chefSupportSteps : ['Not listed']).map((item, index) => (
                                <div className="side-row" key={`${item}-${index}`}>
                                    <span className="side-key">Step {index + 1}</span>
                                    <div className="dropdown-box">
                                        <span className="text-ellipsis" title={item}>
                                            {item}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default RecipeMetaPanel;
