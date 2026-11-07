# UI / UX Review Rules

## Review Purpose
These rules define what the Cabij SOP App interface must feel like and what the agents should compare against during review. If the implementation misses the goal, the system should fix the smallest meaningful part first and then re-check.

## Primary Experience Standard
The app must feel:
- chef-first
- low-noise
- fast to scan
- visually calm
- accurate and trustworthy
- built for prep and service, not for office dashboards

It must not feel like:
- a direct copy of a generic open-source recipe manager
- a developer admin tool
- a metadata-heavy content management screen

## Source References
- [scaler-redesign-design-brief.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/scaler-redesign-design-brief.md)
- [recipe-page-hybrid-final-prototype.html](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/recipe-page-hybrid-final-prototype.html)
- [recipe-finder-chef-simple-prototype.html](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/prototypes/recipe-finder-chef-simple-prototype.html)
- [/Users/teo/Downloads/Cabij_ The Production Operating System - Master Strategic Roadmap.md](/Users/teo/Downloads/Cabij_%20The%20Production%20Operating%20System%20-%20Master%20Strategic%20Roadmap.md)
- [/Users/teo/Downloads/Cabij Project Open-Source Integration Plan.md](/Users/teo/Downloads/Cabij%20Project%20Open-Source%20Integration%20Plan.md)

## Layout Rules
### Overall
- the page must read clearly in three zones:
  - left = recipe finding / library
  - center = active working recipe
  - right = setup / edit / metadata
- each zone must have a clear job
- the chef working area must remain the most visually important

### Left Panel
- should behave like a stylish folder/file browser
- recipe name is the dominant text
- category/type is the second line
- avoid over-showing secondary metadata
- export belongs in the library side, not the chef reading side

### Center Panel
- recipe title must be large and immediately visible
- scaler / target batch controls must sit near the title
- ingredients are the primary content block
- method stays available but visually quieter
- quantities should visually lead over notes and labels

### Right Panel
- setup/edit content must stay secondary to the working recipe
- normal mode should show calm summaries and actions
- edit mode must stay compact and not require long scrolling
- editing should not hijack the whole screen

## Speed Rules
- known recipe should be findable in about 2 seconds
- not-exactly-known recipe should still be findable in about 3 seconds through browsing
- the app should not make the user search across multiple hidden panels for the active working context

## Screen-Fit Rules
- important actions should stay in the visible screen area
- avoid long vertical scrolling for core workflows
- right-side edit controls must stay accessible on screen
- primary scaler interactions should be visible without hunting

## Visual Hierarchy Rules
- recipe title > scaler/target batch > ingredient quantities > ingredient notes > method > metadata
- color should support focus, not become decoration noise
- dark mode is preferred for the scaler direction, but contrast must remain readable
- use bright or high-chroma accents sparingly and intentionally

## Chef-Facing Interaction Rules
- chef-facing screens should prioritize reading and doing, not configuring
- setup and metadata editing must stay out of the core working lane
- actions should be obvious and not duplicated in multiple places
- one clear export action is better than multiple competing print/export controls

## Edit Mode Rules
- fields such as category, dish style, cuisine, and occasion belong in the right panel
- default mode should show values clearly
- edit mode should allow:
  - add
  - remove
  - undo
  - save
- `Add New` should be available within dropdown flows, then convert into inline typing

## ISA-101 / Industrial UX Rules
- boring operation by default
- no decorative clutter that competes with production data
- important warnings should stand out sharply
- when nothing is wrong, the interface should feel calm and stable
- avoid dashboard vanity elements that do not help a chef decide or act

## Review Checklist
During UI review, check:
- is the left-center-right job split obvious
- is the recipe title immediate
- is the scaler easy to use
- are ingredients easier to read than method
- is the right panel clearly secondary
- is recipe finding fast and low-noise
- does the page feel calmer and more production-ready than the current version
- does anything look like office/admin software instead of a chef tool

## Failure Conditions
The UI fails review if:
- editing and setup dominate the chef working area
- ingredients are visually weaker than metadata
- the recipe browser feels noisy or slow
- the main actions require long scrolling
- the page looks generic, cluttered, or dashboard-like
- the implementation ignores the prototype direction without a better reason
- the page starts to resemble imported repo UI patterns more than Cabij's chef-first workflow

## Review Outcome Policy
- if only one area is weak, fix that area only
- if hierarchy is wrong, fix layout and typography first before polishing
- if the prototype and real workflow conflict, prefer real chef workflow while preserving the intended visual direction
