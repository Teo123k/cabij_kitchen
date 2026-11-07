# Playwright Acceptance

## Purpose
This file defines the minimum browser-visible behavior that must be true before this phase is considered complete.

The goal is not just “the page loads.” The goal is that the main Cabij SOP workflow works with real Kabile recipe logic and the new chef-first layout.

## Primary Acceptance Flow
### 1. App Boot
- app loads without crashing
- login/session flow works if auth is enabled
- main recipe/scaler surface becomes visible
- no blocking runtime errors in the browser console
- cached recipe path still works when live fetch is unavailable

### 2. Recipe Library / Finder
- recipe list loads from real Kabile-backed app data
- user can locate a known recipe quickly through search
- user can browse through the library without confusing layout shifts
- selecting a recipe updates the center working area correctly

### 3. Working Recipe Area
- selected recipe title updates correctly
- base yield / scaling context is visible
- ingredient list renders with readable quantities and units
- method content renders without breaking layout
- no critical overlap, clipping, or unusable sections on standard desktop width

### 4. Scaling Behavior
- changing scale or target batch updates ingredient quantities
- sample recipes continue to use the real scaling path, not static mock numbers
- scaling does not crash when ingredients have mixed units or optional notes
- quick multiplier controls work if present

### 5. Right Panel Setup / Edit Behavior
- setup information appears in the right panel
- entering edit mode does not break layout
- metadata fields remain usable inside the visible panel area
- save/cancel or equivalent completion path is visible and reachable

## Kabile Logic Acceptance
The following must remain true:
- the app still uses the Kabile recipe data path described in [RECIPE_DATA_FLOW_AND_CALCULATIONS.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/RECIPE_DATA_FLOW_AND_CALCULATIONS.md)
- recipe enrichment from legacy strategy data is not accidentally removed
- chef-readable quantity formatting still works
- BOM-related behavior is not silently broken by UI changes
- any Tandoor- or Mealie-inspired structural change must preserve current Kabile recipe behavior for the tested recipes
- current offline cache behavior must not regress during phase 1 work

## UI Acceptance
- the layout clearly reads as:
  - left = recipe finder
  - center = working recipe
  - right = setup/edit
- title and scaler are easy to locate
- ingredients visually lead over method and metadata
- the page aligns with [scaler-redesign-design-brief.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/scaler-redesign-design-brief.md) and the two prototype references

## Minimum Test Scenarios
### Scenario A: Known Recipe Fast Find
- open app
- search a known recipe title
- open it
- confirm title, ingredients, and scaler appear correctly

### Scenario B: Browser-Style Find
- browse via category/style/cuisine or library grouping
- open a recipe without using exact-title search
- confirm the browser feels usable and low-noise

### Scenario C: Scaling Update
- open a recipe
- change scale or target batch
- confirm quantities update
- confirm no broken formatting or NaN-style errors appear

### Scenario D: Edit Surface
- open a recipe
- enter right-panel edit/setup mode
- verify fields remain accessible and the page does not shift into a broken state

### Scenario E: Responsive Sanity
- verify desktop layout first
- verify a narrower laptop/tablet width does not destroy the primary working flow

### Scenario F: Offline-First Baseline
- load recipe data once while online
- simulate or verify weak/offline state
- confirm cached recipe data and the main reading surface remain usable
- reject the phase if the app becomes blank or misleading during the cached/offline path

## Console / Error Rules
Reject the phase if any of these happen:
- uncaught runtime error
- repeated React crash loop
- scaling interaction causes broken state
- selecting a recipe leaves the center working area stale or empty unexpectedly

## Finish Criteria
This phase is acceptable only when:
- key scenarios above pass
- the UI review rules are satisfied
- no critical console/runtime errors are present
- the new layout still respects the real Kabile data and scaling logic
- any open-source-inspired structural improvement is additive and does not regress the live Kabile flow
