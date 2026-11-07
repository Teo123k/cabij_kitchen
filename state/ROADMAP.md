# Cabij SOP App Roadmap

## Purpose
This roadmap defines the planned phase order for `cabij_sop_app` in the `SOP_SKELETON_MASTER` repo.

It is aligned to the Cabij company goal:
- chef-first
- offline-first
- zero-friction
- production-safe
- built as a real kitchen operating tool, not a generic recipe app

## Roadmap Rule
Each phase must strengthen the live Cabij workflow.

Do not:
- jump into later-phase systems before the current foundations are stable
- import large chunks of external repo architecture without clear Cabij adaptation
- optimize visuals while core workflow, offline reliability, or recipe logic is still weak

## Phase 1
### Chef-First Kabile Scaler Foundation

#### Goal
Make the live Kabile recipe workflow strong, readable, and production-safe while preserving real recipe/scaling logic.

#### Main Work
- preserve the real Kabile recipe fetch/merge path
- preserve deterministic scaling, BOM behavior, and chef-readable quantity formatting
- reshape the main scaler shell toward the selected prototype direction
- make the center working recipe area the dominant surface
- move setup/editing into a quieter secondary lane
- establish the offline-first foundation for the recipe working flow

#### Output
- a chef-first main recipe/scaler screen
- real Kabile logic still working
- phase-1 offline-first baseline confirmed and documented

#### Important Boundary
Phase 1 is not the phase for fully perfecting the recipe library or fully rebuilding the data model.

## Phase 2
### Recipe Library, Structural Engine Integration, and Offline Reliability

#### Goal
Turn the recipe library into a fast, low-noise, structurally stronger system by combining better Cabij UX with the right open-source logic ideas.

#### Main Work
- perfect the recipe library and recipe-finding flow
- implement the folder/file style browsing direction properly
- improve category, style, cuisine, and metadata organization
- integrate the most useful structural ideas from GitHub research:
  - Tandoor-style ingredient and recipe structure
  - stronger canonical ingredient handling
  - better conversion and metadata readiness
  - Mealie-style extensible recipe metadata and integration patterns
- deepen offline-first reliability beyond the phase-1 baseline
- prepare safe offline write/sync direction where appropriate

#### Output
- fast and trustworthy recipe search/browse
- stronger Cabij-native library structure
- offline behavior that feels resilient in real kitchen conditions

#### Important Boundary
Phase 2 should adapt the best logic from open-source systems into Cabij.
It should not turn Cabij into a clone of Tandoor, Mealie, or any other repo.

## Phase 3
### Integration and Cost-Control Layer

#### Goal
Expand the app from a strong recipe/scaler tool into an operational engine with stronger import, costing, and integration foundations.

#### Main Work
- cleaner API and metadata boundaries
- stronger canonical ingredient and costing logic
- preparation for POS and invoice-linked operational workflows
- support theoretical vs actual cost direction
- strengthen data structures needed for wider operational intelligence

#### Output
- Cabij becomes structurally ready for broader production control, not just recipe access and scaling

## Phase 4
### Autopilot Prep and Production Intelligence

#### Goal
Move Cabij toward the kitchen brain described in the company roadmap.

#### Main Work
- demand-based prep logic
- dynamic prep list generation
- stronger station-oriented execution support
- foundations for broader production intelligence and future Cabij operating-system behavior

#### Output
- Cabij moves from a smart recipe/scaler product toward a true production operating system

## Phase Summary
### Phase 1
Chef-first live working shell plus offline-first foundation

### Phase 2
Perfect recipe library plus GitHub structural integration plus deeper offline reliability

### Phase 3
Integration and cost-control expansion

### Phase 4
Autopilot prep and production intelligence

## Current Active Phase
Phase 1: Chef-First Kabile Scaler Foundation

## Next-Phase Trigger
Move from Phase 1 to Phase 2 only after:
- real Kabile logic remains stable
- the chef-first scaler shell is meaningfully improved
- the phase-1 offline-first baseline is clear
- review and Playwright acceptance for Phase 1 are satisfied
