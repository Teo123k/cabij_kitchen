# Cabij SOP App Phase Goal

## Phase Name
Phase 1: Chef-First Kabile Scaler Foundation

## Core Mission
Turn `cabij_sop_app` into a chef-first production working surface for Kabile recipes, starting with the real Kabile recipe logic already present in the app and reshaping the main scaler workflow so it becomes faster, clearer, and safer to use during prep and service.

This phase is not just a visual redesign. It must preserve and expose the existing production logic:
- Kabile recipe fetch and merge flow from `sop_recipes` and `consulting_sops`
- deterministic scaling and BOM logic
- chef-readable quantity formatting
- offline-first foundations as a first-class requirement, not an optional extra

## Strategic Source Documents
- [/Users/teo/Downloads/Cabij_ The Production Operating System - Master Strategic Roadmap.md](/Users/teo/Downloads/Cabij_%20The%20Production%20Operating%20System%20-%20Master%20Strategic%20Roadmap.md)
- [/Users/teo/Downloads/Cabij Project Open-Source Integration Plan.md](/Users/teo/Downloads/Cabij%20Project%20Open-Source%20Integration%20Plan.md)
- [RECIPE_DATA_FLOW_AND_CALCULATIONS.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/RECIPE_DATA_FLOW_AND_CALCULATIONS.md)
- [docs/SOP_APP_ARCHITECTURE.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/docs/SOP_APP_ARCHITECTURE.md)
- [VALIDATION_AND_TESTING_PLAN.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/VALIDATION_AND_TESTING_PLAN.md)

## UI Reference Pack
- [scaler-redesign-design-brief.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/scaler-redesign-design-brief.md)
- [recipe-page-hybrid-final-prototype.html](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/recipe-page-hybrid-final-prototype.html)
- [recipe-finder-chef-simple-prototype.html](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/recipe-finder-chef-simple-prototype.html)

## What This Phase Must Achieve
1. Make the main recipe/scaler experience match the chef-first prototype direction.
2. Keep real Kabile recipe logic and production calculations intact while changing the interface.
3. Establish the core offline-first foundation so the app remains usable in unstable kitchen connectivity.
4. Keep the ingredients and target yield/scaler as the primary reading surface.
5. Move editing and setup controls into a quieter secondary area.
6. Make the app feel like a production operating tool, not a generic dashboard.

## Open-Source Integration Intent
This phase should prepare Cabij to absorb the strongest structural ideas from open-source recipe systems without turning `cabij_sop_app` into a direct clone of any single repository.

The rule is:
- borrow proven logic patterns
- adapt them into Cabij
- keep Cabij's product workflow, naming, and chef-first UX
- do not paste in whole foreign architecture unless it is clearly necessary

### Priority Structural Inspirations
#### Tandoor-style structural engine
Bring in these ideas first where they improve Cabij:
- split ingredient structure: quantity, unit, ingredient identity
- stronger canonical ingredient handling and normalization
- food-specific conversion support instead of naive global conversion
- richer recipe/ingredient metadata that supports professional kitchen use

#### Mealie-style integration layer
Bring in these ideas where useful:
- API-first thinking for recipe data and metadata flow
- extensible recipe extras / metadata patterns
- cleaner integration boundaries for future automation and external systems

### Later-Phase Inspirations, Not First-Phase Build Targets
- Open Food Facts taxonomy integration
- Pint-style advanced quantity engine expansion
- OCR / invoice ingestion pipeline
- MQTT / OPC UA / kitchen equipment bridge
- multi-site logistics and transfer workflows

### Current Phase Boundary
For this phase, open-source integration should improve:
- recipe structure clarity
- scaling correctness
- metadata readiness
- canonical ingredient logic direction

It should not derail the immediate goal of:
- getting the Kabile recipe workflow working well
- delivering the chef-first scaler shell
- making the real app match the chosen prototype direction

## Priority Functional Scope
### A. Real Kabile Recipe Logic
- use the existing Kabile fetch/merge flow as the source of truth
- preserve legacy strategy enrichment from `consulting_sops`
- preserve recipe scaling, unit conversion, chef rounding, and BOM expansion behavior
- do not replace the real calculation path with mockup-only demo data

### A2. Structural Upgrade Direction
- identify where the current recipe model is too flat or string-heavy
- prefer Tandoor-style structured ingredient logic when improving data shape
- prefer Mealie-style metadata extensibility when adding recipe properties
- any structural upgrade in this phase must still preserve current Kabile behavior

### B. Recipe Finder / Library
- keep recipe finding good enough to support the phase 1 chef workflow
- preserve clear recipe title dominance and low-noise browsing
- avoid locking the app into a weak library structure that blocks phase 2
- full perfection of the recipe library belongs to phase 2

### B2. Offline-First Foundation
- preserve current offline read caching behavior
- audit and improve the app path so recipe reading and core working context remain usable when connection is weak
- make offline-first behavior part of the implementation direction, not a later afterthought
- prepare for true offline-first write/sync work in the next phase without breaking the live app now

### C. Working Recipe Area
- title, scale, target batch, and ingredient list must be central
- ingredient quantities must visually lead over notes and metadata
- method must stay available but quieter than the ingredients
- chef should be able to work from the screen while prepping without hunting for key information

### D. Right-Side Setup / Edit Area
- admin/setup controls belong in the right panel
- recipe setup fields include category, dish style, cuisine, and occasion
- view mode should be calm and readable
- edit mode should stay compact and on-screen
- avoid modal-heavy editing for routine setup changes

## Phase Order
1. Confirm current Kabile recipe data and scaling logic remain stable.
2. Confirm the current offline read/cache behavior and identify the most important offline-first gaps.
3. Reshape the page shell toward the hybrid prototype.
4. Re-center the working recipe area around title, scaler, ingredients, and short method.
5. Keep the recipe browser serviceable for phase 1 without over-investing in its final polish yet.
6. Move setup/edit controls into the right panel.
7. Introduce small structural improvements inspired by Tandoor/Mealie only where they directly strengthen the live Kabile workflow.
8. Add polish only after the functional and workflow structure is correct.

## Non-Negotiables
- the 3-second rule for recipe/task access
- offline-first direction is mandatory
- no feature clutter
- no silent failure
- no raw math shortcuts in UI components
- no large rewrite that breaks Kabile production behavior just to match the mockup
- no replacing real data structure with front-end-only shortcuts

## Out of Scope For This Phase
- full multi-site logistics flows
- full staffing heat-map system
- full IoT / Rational / Middleby integration
- full invoice OCR pipeline
- large architecture rewrites unrelated to the scaler, recipe finder, or Kabile recipe flow
- wholesale migration to an external repo structure
- replacing Cabij's UX with a raw Tandoor or Mealie clone

## Success Criteria
- the app uses real Kabile recipe data and still scales correctly
- the main page matches the prototype direction in layout and reading priority
- a chef can find, scale, and read a recipe with less friction than the current UI
- the app has a clear and reliable offline-first phase-1 foundation
- editing metadata no longer pollutes the main working surface
- Playwright and review checks say the page is visually coherent, functionally stable, and aligned with the rules in this state pack

## Phase-End Human Review
Human involvement should happen after the phase work is complete and after UI review plus Playwright checks are done.

Before moving to the next phase, review:
- visual match against the reference prototype direction
- recipe-finding adequacy for the current phase
- scaling correctness on sample Kabile recipes
- offline-first foundation and remaining gaps
- whether the app feels chef-first, low-noise, and production-safe
