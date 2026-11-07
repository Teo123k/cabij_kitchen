import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Utensils, ChevronDown } from 'lucide-react';
import { OFFLINE_STATE, buildRecipeBrowseGroups, buildRecipeLookupAliases, buildRecipeQuickPickEntries, buildRecipeSearchIndexEntry, canonicalizeRecipeTaxonomy, getRecipeLookupKey, resolveRecipeBrowseGroup, scoreRecipeSearchIndex } from '../config/constants';
import { resolveRecipeId } from '../core/sku';

/**
 * RecipeSelector - The Navigation Control.
 * Supports standard dropdown and Vertical List mode for the 3-panel layout.
 */
const RecipeSelector = ({
    recipes = [],
    selectedId,
    onSelectedIdChange,
    translateIngredient,
    verticalLayout = false,
    recentActivity = {},
    onConfirmSync,
    onFileUpload
}) => {
    const recipeList = Array.isArray(recipes) ? recipes : [];
    const hasRecipes = recipeList.length > 0;
    const [query, setQuery] = useState('');
    const [activeChip, setActiveChip] = useState('title');
    const [activeStyleFilter, setActiveStyleFilter] = useState('');
    const [activeCuisineFilter, setActiveCuisineFilter] = useState('');
    const deferredQuery = useDeferredValue(query);
    const deferredStyleFilter = useDeferredValue(activeStyleFilter);
    const deferredCuisineFilter = useDeferredValue(activeCuisineFilter);

    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const toNumberOrZero = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const getRecipeId = (recipe, idx) => (
        getRecipeLookupKey(recipe, `idx-${idx}`)
    );

    const getRecipeName = (recipe) => recipe?.name || recipe?.title || 'Unnamed';
    const getRecipeCuisine = (recipe) => (
        canonicalizeRecipeTaxonomy('cuisine', recipe?.cuisine || recipe?.cuisineType || recipe?.dishCuisine || recipe?.dish_cuisine || 'General')
    );
    const getRecipeStyle = (recipe) => canonicalizeRecipeTaxonomy('style', recipe?.dishStyle || recipe?.style || 'Kitchen Standard');
    const getRecipeCategory = (recipe) => canonicalizeRecipeTaxonomy('category', recipe?.dishCategory || recipe?.category || 'General');
    const formatGroupName = (value) => {
        const cleaned = String(value || '').trim();
        if (!cleaned) return 'General';
        return cleaned
            .split(/\s+/)
            .map((token) => token ? `${token.charAt(0).toUpperCase()}${token.slice(1)}` : token)
            .join(' ');
    };

    const getRecipeTouchpoint = (recipe) => {
        const recentCandidates = [
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
        ].map((alias) => {
            const normalizedAlias = normalizeText(alias);
            if (!normalizedAlias) return 0;
            const recentValue = recentActivity?.[normalizedAlias];
            const parsedRecent = typeof recentValue === 'number' ? recentValue : Date.parse(recentValue);
            return Number.isFinite(parsedRecent) ? parsedRecent : 0;
        });
        const recentTouchpoint = recentCandidates.reduce((latest, value) => Math.max(latest, value || 0), 0);
        if (recentTouchpoint > 0) return recentTouchpoint;

        const candidates = [
            recipe?.updated_at,
            recipe?.updatedAt,
            recipe?.offline_queued_at,
            recipe?.updated_at_local,
            recipe?.created_at,
            recipe?.createdAt,
            recipe?.last_modified_at
        ];
        const newest = candidates.find((value) => value);
        const parsed = newest ? Date.parse(newest) : NaN;
        return Number.isNaN(parsed) ? 0 : parsed;
    };

    const getRecipeTrustPriority = (recipe) => {
        const syncState = normalizeText(recipe?.offline_sync_state);
        if (!syncState) return 0;
        if (syncState === OFFLINE_STATE.APPROVED || syncState === OFFLINE_STATE.SYNCED || syncState === OFFLINE_STATE.ONLINE) return 0;
        if (syncState === OFFLINE_STATE.PENDING || syncState === OFFLINE_STATE.LOCAL || syncState === OFFLINE_STATE.APPROVAL_REQUIRED) return 1;
        if (syncState === OFFLINE_STATE.CONFLICT || syncState === OFFLINE_STATE.FAILED) return 2;
        return 1;
    };

    const getCanonicalPriority = (recipe) => {
        const sourceTrust = normalizeText(recipe?.source_trust);
        if (sourceTrust === 'canonical') return 0;
        if (sourceTrust === 'canonical_with_local_changes') return 1;
        if (sourceTrust === 'synced_local') return 2;
        if (sourceTrust === 'local_fallback') return 3;
        if (sourceTrust === 'local_queue') return 4;
        return 5;
    };

    const getRecipeSourceWeight = (recipe) => toNumberOrZero(recipe?.recipe_truth_tier) || (recipe?.source_trust_penalty || 0);
    const getRecipeCode = (recipe) => (
        recipe?.code ||
        recipe?.recipeCode ||
        recipe?.recipe_code ||
        recipe?.sku ||
        recipe?.recipe_ref_id ||
        recipe?.canonical_id ||
        ''
    );
    const getRecipeIdentityKey = (recipe, idx) => {
        const identity = buildRecipeLookupAliases(recipe, `idx-${idx}`)
            .map((value) => normalizeText(value))
            .find(Boolean);
        return identity || `idx-${idx}`;
    };

    const indexedRecipeEntries = useMemo(() => (
        recipeList.map((recipe, idx) => ({
            recipe,
            idx,
            identityKey: getRecipeIdentityKey(recipe, idx),
            touchpoint: getRecipeTouchpoint(recipe),
            trust: getRecipeTrustPriority(recipe),
            sourceWeight: getRecipeSourceWeight(recipe),
            canonicalPriority: getCanonicalPriority(recipe),
            searchIndex: buildRecipeSearchIndexEntry(recipe, {
                getRecipeName,
                getRecipeStyle,
                getRecipeCuisine,
                getRecipeCategory,
                getRecipeCode
            })
        }))
    ), [recipeList, recentActivity]);

    const visibleRecipeEntries = useMemo(() => {
        const chipMode = activeChip;
        const needle = deferredQuery.trim().toLowerCase();

        const baseEntries = indexedRecipeEntries.map((entry) => {
            const { score, matched } = scoreRecipeSearchIndex(entry.searchIndex, needle, chipMode);
            return {
                ...entry,
                score,
                matched: needle ? matched : true,
                tieBreak: (
                    entry.canonicalPriority * 1500 +
                    entry.sourceWeight * 1000 +
                    entry.trust * 250 +
                    0
                )
            };
        });

        const entries = (needle ? baseEntries.filter((entry) => entry.matched) : baseEntries)
            .map((entry) => entry);

        if (!entries.length) return [];

        const sortByName = (left, right) => {
            const leftName = getRecipeName(left.recipe);
            const rightName = getRecipeName(right.recipe);
            return leftName.localeCompare(rightName);
        };

        if (chipMode === 'recent' && !needle) {
            const ordered = entries.sort((left, right) => {
                if (right.touchpoint !== left.touchpoint) return right.touchpoint - left.touchpoint;
                if (left.canonicalPriority !== right.canonicalPriority) return left.canonicalPriority - right.canonicalPriority;
                if (left.trust !== right.trust) return left.trust - right.trust;
                return sortByName(left, right);
            });
            const seen = new Set();
            return ordered.filter((entry) => {
                if (seen.has(entry.identityKey)) return false;
                seen.add(entry.identityKey);
                return true;
            });
        }

        const ordered = entries.sort((left, right) => {
            const leftScore = left.score + left.tieBreak;
            const rightScore = right.score + right.tieBreak;
            if (leftScore !== rightScore) return leftScore - rightScore;
            if (left.canonicalPriority !== right.canonicalPriority) return left.canonicalPriority - right.canonicalPriority;
            if (left.trust !== right.trust) return left.trust - right.trust;
            return sortByName(left, right);
        });
        const seen = new Set();
        return ordered.filter((entry) => {
            if (seen.has(entry.identityKey)) return false;
            seen.add(entry.identityKey);
            return true;
        });
    }, [activeChip, deferredQuery, indexedRecipeEntries]);

    const visibleRecipes = useMemo(() => visibleRecipeEntries.map((entry) => entry.recipe), [visibleRecipeEntries]);

    const browseRecipeEntries = useMemo(
        () => (deferredQuery.trim() ? [] : visibleRecipeEntries),
        [deferredQuery, visibleRecipeEntries]
    );

    const orderedStyleGroups = useMemo(
        () => buildRecipeBrowseGroups(browseRecipeEntries, (recipe) => getRecipeStyle(recipe) || 'Kitchen Standard'),
        [browseRecipeEntries]
    );

    const orderedCuisineGroups = useMemo(
        () => buildRecipeBrowseGroups(browseRecipeEntries, (recipe) => getRecipeCuisine(recipe) || 'General'),
        [browseRecipeEntries]
    );

    const getDisplayName = (recipe) => {
        const name = getRecipeName(recipe);
        return translateIngredient ? translateIngredient(name) : name;
    };

    const uniqueParts = (parts = []) => {
        const seen = new Set();
        return parts.filter((part) => {
            const normalized = normalizeText(part);
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    };

    const getRecipeSubline = (recipe, { groupMode = null, groupLabel = '' } = {}) => {
        const style = formatGroupName(getRecipeStyle(recipe));
        const cuisine = formatGroupName(getRecipeCuisine(recipe));
        const station = formatGroupName(recipe?.station || recipe?.workstation || getRecipeCategory(recipe) || '');
        const normalizedGroup = normalizeText(groupLabel);

        if (groupMode === 'style') {
            const parts = uniqueParts([cuisine, station]).filter((part) => normalizeText(part) !== normalizedGroup);
            return parts.length ? parts.join(' | ') : 'Recipe detail';
        }

        if (groupMode === 'cuisine') {
            const parts = uniqueParts([style, station]).filter((part) => normalizeText(part) !== normalizedGroup);
            return parts.length ? parts.join(' | ') : 'Recipe detail';
        }

        return uniqueParts([style, cuisine]).join(' | ');
    };

    const getRecipeTrustSignal = (recipe) => {
        const flags = Array.isArray(recipe?.recipe_truth_flags) ? recipe.recipe_truth_flags : [];
        const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
        const unresolvedSubRecipeCount = ingredients.filter((ingredient) => {
            const explicitLinkHint = Boolean(
                ingredient?.recipe_ref_id ||
                ingredient?.canonical_id ||
                ingredient?.subRecipeId ||
                ingredient?.sub_recipe_id ||
                ingredient?.recipeId ||
                ingredient?.recipe_code
            );
            if (!explicitLinkHint) return false;
            return !resolveRecipeId(ingredient, recipeList);
        }).length;

        const priorityMatchers = [
            /missing base yield/i,
            /unsupported yield unit/i,
            /portion-based yield needs conversion reference/i,
            /missing unit/i,
            /unrecognized/i
        ];

        const prioritizedFlag = priorityMatchers
            .map((pattern) => flags.find((flag) => pattern.test(String(flag))))
            .find(Boolean);

        if (prioritizedFlag) return prioritizedFlag;

        if (unresolvedSubRecipeCount > 0) {
            return `${unresolvedSubRecipeCount} linked ${unresolvedSubRecipeCount === 1 ? 'sub-recipe is' : 'sub-recipes are'} unresolved`;
        }

        const topFlag = flags.find((flag) => typeof flag === 'string' && flag.trim()) || '';
        return topFlag || '';
    };

    const summarizeRecipeTrustSignal = (signal) => {
        const text = String(signal || '').trim();
        if (!text) return '';
        if (/missing base yield/i.test(text)) return 'Base yield missing';
        if (/unsupported yield unit|missing yield unit|missing unit/i.test(text)) return 'Yield setup needed';
        if (/portion-based yield needs conversion reference/i.test(text)) return 'Yield conversion needed';
        if (/unrecognized/i.test(text)) return 'Ingredient units need review';
        if (/linked .* unresolved|recipe link unresolved|sub-recipe/i.test(text)) return 'Linked recipe missing';
        return text;
    };

    const getRecipeTrustBadge = (recipe) => {
        const truthStatus = normalizeText(recipe?.recipe_truth_status);
        const hasUnapprovedChanges = Boolean(recipe?.has_unapproved_changes);
        const topFlag = summarizeRecipeTrustSignal(getRecipeTrustSignal(recipe));

        if (truthStatus === 'blocked') {
            return {
                tone: 'red',
                label: 'Blocked',
                note: topFlag || 'Recipe truth needs correction before prep.'
            };
        }

        if (hasUnapprovedChanges) {
            return {
                tone: 'gold',
                label: 'Changed',
                note: 'Waiting for approval.'
            };
        }

        if (truthStatus === 'review' || truthStatus === 'warning') {
            return {
                tone: 'gold',
                label: 'Check',
                note: ''
            };
        }

        return {
            tone: 'good',
            label: 'Trusted',
            note: topFlag || 'Canonical recipe truth is ready.'
        };
    };

    const renderRecipeRows = (entries, groupConfig = {}, listClassName = 'recipe-group-rows') => (
        <div className={listClassName}>
            {entries.map(({ recipe, idx }) => {
                const recipeId = getRecipeId(recipe, idx);
                const active = selectedId === recipeId;
                const trustBadge = getRecipeTrustBadge(recipe);
                return (
                    <button
                        type="button"
                        key={`${recipeId}-${idx}`}
                        onClick={() => onSelectedIdChange && onSelectedIdChange(recipeId)}
                        aria-pressed={active}
                        aria-label={`Open recipe ${getDisplayName(recipe)}`}
                        className={`recipe-row ${active ? 'active' : ''}`}
                        title={getDisplayName(recipe)}
                    >
                        <div className="row-top">
                            <div className="row-title">{getDisplayName(recipe)}</div>
                            <div className={`badge ${trustBadge.tone}`}>{trustBadge.label}</div>
                        </div>
                        <div className="row-meta">{getRecipeSubline(recipe, groupConfig)}</div>
                        {trustBadge.note ? <div className="row-trust-note">{trustBadge.note}</div> : null}
                    </button>
                );
            })}
        </div>
    );

    const filteredRecipeEntries = useMemo(() => {
        if (deferredQuery.trim()) {
            return visibleRecipeEntries;
        }
        if (activeChip === 'style' && deferredStyleFilter) {
            return visibleRecipeEntries.filter(({ recipe }) => normalizeText(getRecipeStyle(recipe)) === deferredStyleFilter);
        }
        if (activeChip === 'cuisine' && deferredCuisineFilter) {
            return visibleRecipeEntries.filter(({ recipe }) => normalizeText(getRecipeCuisine(recipe)) === deferredCuisineFilter);
        }
        return visibleRecipeEntries;
    }, [activeChip, deferredCuisineFilter, deferredStyleFilter, visibleRecipeEntries]);

    const quickPickEntries = useMemo(() => {
        const baseEntries = (deferredQuery.trim() ? visibleRecipeEntries : filteredRecipeEntries).map((entry) => ({
            id: getRecipeId(entry.recipe, entry.idx),
            label: getDisplayName(entry.recipe),
            recipe: entry.recipe,
            idx: entry.idx,
            identityKey: entry.identityKey,
            touchpoint: entry.touchpoint,
            trust: entry.trust,
            canonicalPriority: entry.canonicalPriority,
            isSelected: selectedId === getRecipeId(entry.recipe, entry.idx)
        }));

        return buildRecipeQuickPickEntries(baseEntries, {
            selectedId,
            limit: deferredQuery.trim() ? 5 : 6
        });
    }, [deferredQuery, filteredRecipeEntries, getDisplayName, selectedId, visibleRecipeEntries]);

    const topSearchResultId = deferredQuery.trim() && visibleRecipeEntries[0]
        ? getRecipeId(visibleRecipeEntries[0].recipe, visibleRecipeEntries[0].idx)
        : '';

    const searchHint = query.trim() ? 'Search results' : (activeChip === 'recent' ? 'Recent recipes' : 'Recipes');

    const resolvedStyleBrowse = useMemo(
        () => resolveRecipeBrowseGroup(orderedStyleGroups, deferredStyleFilter),
        [deferredStyleFilter, orderedStyleGroups]
    );
    const resolvedCuisineBrowse = useMemo(
        () => resolveRecipeBrowseGroup(orderedCuisineGroups, deferredCuisineFilter),
        [deferredCuisineFilter, orderedCuisineGroups]
    );

    useEffect(() => {
        if (activeChip !== 'style') return;
        if (activeStyleFilter === resolvedStyleBrowse.activeKey) return;
        startTransition(() => setActiveStyleFilter(resolvedStyleBrowse.activeKey));
    }, [activeChip, activeStyleFilter, resolvedStyleBrowse.activeKey]);

    useEffect(() => {
        if (activeChip !== 'cuisine') return;
        if (activeCuisineFilter === resolvedCuisineBrowse.activeKey) return;
        startTransition(() => setActiveCuisineFilter(resolvedCuisineBrowse.activeKey));
    }, [activeChip, activeCuisineFilter, resolvedCuisineBrowse.activeKey]);
    const hasFilteredRecipeEntries = filteredRecipeEntries.length > 0;
    const recoveryRecipeEntries = useMemo(() => {
        if (!deferredQuery.trim() || hasFilteredRecipeEntries) return [];

        const seen = new Set();
        return indexedRecipeEntries
            .slice()
            .sort((left, right) => {
                if (right.touchpoint !== left.touchpoint) return right.touchpoint - left.touchpoint;
                if (left.canonicalPriority !== right.canonicalPriority) return left.canonicalPriority - right.canonicalPriority;
                if (left.trust !== right.trust) return left.trust - right.trust;
                return getRecipeName(left.recipe).localeCompare(getRecipeName(right.recipe));
            })
            .filter((entry) => {
                if (seen.has(entry.identityKey)) return false;
                seen.add(entry.identityKey);
                return true;
            })
            .slice(0, 6);
    }, [deferredQuery, getRecipeName, hasFilteredRecipeEntries, indexedRecipeEntries]);

    const selectedStyleGroup = resolvedStyleBrowse.selectedGroup;
    const selectedCuisineGroup = resolvedCuisineBrowse.selectedGroup;

    const handleChipSelect = (chipKey) => {
        startTransition(() => {
            setActiveChip(chipKey);
            if (chipKey !== 'style') setActiveStyleFilter('');
            if (chipKey !== 'cuisine') setActiveCuisineFilter('');
        });
    };

    const renderTaxonomyRows = (groups, mode) => {
        const activeFilter = mode === 'style' ? activeStyleFilter : activeCuisineFilter;
        const onSelect = mode === 'style' ? setActiveStyleFilter : setActiveCuisineFilter;
        const totalCount = groups.reduce((sum, group) => sum + group.entries.length, 0);

        if (!groups.length) {
            return <div className="text-app-muted">{`No ${mode} groups available`}</div>;
        }

        return (
            <div className="taxonomy-list">
                <button
                    type="button"
                    key={`${mode}-all`}
                    className={`taxonomy-row ${!activeFilter ? 'active' : ''}`}
                    aria-pressed={!activeFilter}
                    onClick={() => startTransition(() => onSelect(''))}
                >
                    <span className="taxonomy-name">All {mode === 'style' ? 'Styles' : 'Cuisines'}</span>
                    <span className="taxonomy-count">{totalCount}</span>
                </button>
                {groups.map((group) => {
                    const isActive = activeFilter === group.key;
                    return (
                        <button
                            type="button"
                            key={group.key}
                            className={`taxonomy-row ${isActive ? 'active' : ''}`}
                            aria-pressed={isActive}
                            onClick={() => startTransition(() => onSelect(isActive ? '' : group.key))}
                        >
                            <span className="taxonomy-name">{formatGroupName(group.label)}</span>
                            <span className="taxonomy-count">{group.entries.length}</span>
                        </button>
                    );
                })}
            </div>
        );
    };

    if (verticalLayout) {
        const chipButtons = [
            { key: 'title', label: 'Title-first' },
            { key: 'style', label: 'Style' },
            { key: 'cuisine', label: 'Cuisine' },
            { key: 'recent', label: 'Recent' }
        ];

        return (
            <>
                <div className="panel-head">
                    <div className="eyebrow">Chef Recipe Finder</div>
                    <div className="h1">Search by title first</div>
                    <div className="copy">
                        Recipe title stays dominant. Browse by chef setup only when the exact name is not known.
                    </div>
                </div>

                <div className="search-block">
                    <label className="search-box flex">
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                startTransition(() => setQuery(nextValue));
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    startTransition(() => setQuery(''));
                                } else if (event.key === 'Enter' && topSearchResultId) {
                                    event.preventDefault();
                                    onSelectedIdChange && onSelectedIdChange(topSearchResultId);
                                }
                            }}
                            placeholder="Find recipe by name or code"
                            aria-label="Find recipe by name, code, style, cuisine, or ingredient"
                            className="cabij-focus-ring w-full bg-transparent text-inherit"
                        />
                    </label>
                    <div className="filter-row mt-3 flex gap-2">
                        {chipButtons.map((chip) => (
                            <button
                                type="button"
                                key={chip.key}
                                className={`chip ${activeChip === chip.key ? 'active' : ''}`}
                                aria-pressed={activeChip === chip.key}
                                onClick={() => handleChipSelect(chip.key)}
                            >
                                {chip.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="library-list overflow-y-auto">
                    <div className="section-label">Browse Recipes</div>

                    {activeChip === 'recent' && quickPickEntries.length > 0 ? (
                        <>
                            <div className="section-label mt-2">
                                {deferredQuery.trim() ? 'Quick open' : 'Fast picks'}
                            </div>
                            <div className="taxonomy-list mb-3">
                                {quickPickEntries.map((entry) => (
                                    <button
                                        type="button"
                                        key={`quick-${entry.id}-${entry.idx}`}
                                        className={`taxonomy-row ${entry.isSelected ? 'active' : ''}`}
                                        aria-pressed={entry.isSelected}
                                        onClick={() => onSelectedIdChange && onSelectedIdChange(entry.id)}
                                    >
                                        <span className="taxonomy-name">{entry.label}</span>
                                        <span className="taxonomy-count">{entry.isSelected ? 'Live' : (entry.touchpoint > 0 ? 'Recent' : 'Trusted')}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : null}

                    {!hasRecipes ? (
                        <div className="text-app-muted">No Recipes Found</div>
                    ) : !hasFilteredRecipeEntries ? (
                        <>
                            <div className="text-app-muted">
                                No match found. Showing recent trusted recipes so selection can recover quickly.
                            </div>
                            {recoveryRecipeEntries.length > 0 ? (
                                <>
                                    <div className="section-label mt-3">Recovery Picks</div>
                                    {renderRecipeRows(recoveryRecipeEntries, {}, 'recipe-group-rows')}
                                </>
                            ) : null}
                        </>
                    ) : query.trim() ? (
                        <>
                            <div className="section-label">{searchHint}</div>
                            {renderRecipeRows(filteredRecipeEntries, activeChip === 'style'
                                ? { groupMode: 'style', groupLabel: selectedStyleGroup?.label || '' }
                                : (activeChip === 'cuisine'
                                    ? { groupMode: 'cuisine', groupLabel: selectedCuisineGroup?.label || '' }
                                    : {}), 'recipe-group-rows')}
                        </>
                    ) : (
                        <>
                            {activeChip === 'style' && (
                                <>
                                    <div className="section-label mt-2">Browse by Style</div>
                                    {renderTaxonomyRows(orderedStyleGroups, 'style')}
                                </>
                            )}

                            {activeChip === 'cuisine' && (
                                <>
                                    <div className="section-label mt-2">Browse by Cuisine</div>
                                    {renderTaxonomyRows(orderedCuisineGroups, 'cuisine')}
                                </>
                            )}

                            <div className="section-label mt-3">
                                {activeChip === 'style' && selectedStyleGroup
                                    ? `Recipes in ${formatGroupName(selectedStyleGroup.label)}`
                                    : activeChip === 'cuisine' && selectedCuisineGroup
                                        ? `Recipes in ${formatGroupName(selectedCuisineGroup.label)}`
                                        : searchHint}
                            </div>
                            {filteredRecipeEntries.length > 0 ? (
                                renderRecipeRows(filteredRecipeEntries, activeChip === 'style'
                                    ? { groupMode: 'style', groupLabel: selectedStyleGroup?.label || '' }
                                    : (activeChip === 'cuisine'
                                        ? { groupMode: 'cuisine', groupLabel: selectedCuisineGroup?.label || '' }
                                        : {}), 'recipe-group-rows')
                            ) : (
                                <div className="text-app-muted">No recipes in this group</div>
                            )}
                        </>
                    )}
                </div>
            </>
        );
    }

    // Default Dropdown Mode (Mobile / Compact)
    return (
        <div className="flex flex-1 items-center gap-3 rounded-lg border border-app-border bg-app-surface p-3 shadow-premium">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-app-accent/35 bg-app-accent/10">
                <Utensils size={18} className="text-app-accent" />
            </div>
            <div className="relative flex-1">
                <label className="mb-1 block text-[9px] font-black uppercase tracking-[0.12em] text-app-muted">
                    Active Recipe Truth
                </label>
                <select
                    disabled={!hasRecipes}
                    value={selectedId || ''}
                    onChange={(e) => onSelectedIdChange && onSelectedIdChange(e.target.value)}
                    className="cabij-focus-ring w-full appearance-none bg-transparent pr-7 text-base font-black tracking-tight text-app-text disabled:opacity-40"
                >
                    {!hasRecipes
                        ? <option>No Recipes Found</option>
                        : recipeList.filter((r) => !!r).map((r, idx) => (
                            <option key={getRecipeId(r, idx)} value={getRecipeId(r, idx)} className="bg-app-surface text-app-text">
                                {getDisplayName(r)}
                            </option>
                        ))
                    }
                </select>
                <ChevronDown className="pointer-events-none absolute bottom-1.5 right-0 text-app-muted" size={16} />
            </div>
        </div>
    );
};

export default RecipeSelector;
