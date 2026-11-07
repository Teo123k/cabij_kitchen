# Auto Repair Policy

## Purpose
This file tells the automation how to respond when the implementation does not yet meet the goal, the UI review rules, or Playwright acceptance.

The system should behave the way a careful senior product builder would work manually:
- compare the result against the goal
- identify the exact mismatch
- fix the smallest logical part first
- re-check
- only escalate to broader rewrites when smaller fixes are clearly insufficient

## Core Rule
Prefer the smallest meaningful correction that moves the product closer to the stated goal without breaking stable Kabile logic.

## Repair Order
When something fails, fix in this order:
1. runtime or data correctness issue
2. layout break that blocks use
3. hierarchy issue that hides the chef workflow
4. interaction friction in search / scale / edit flow
5. polish and visual refinement

## Smallest-Part Repair Strategy
### Good automatic repair examples
- adjust panel width or spacing if the hierarchy is wrong
- move one control to the correct panel rather than rewriting the whole page
- fix one broken scaling interaction instead of replacing the whole scaler
- tune typography and emphasis before rewriting component architecture
- patch one edit-mode section if the rest of the UI is sound

### Bad automatic repair examples
- broad rewrite because one panel feels off
- replacing real Kabile logic with local mock data just to make UI easier
- deleting working metadata flows instead of relocating them
- rewriting multiple app sections without proving the smaller change was insufficient
- importing large chunks of external repo structure when a smaller Cabij-native adaptation would solve the problem

## Allowed Automatic Corrections
- spacing, hierarchy, alignment, and grouping fixes
- moving actions between left / center / right panels
- tightening noisy metadata presentation
- compacting edit flows to keep them on screen
- fixing broken state updates and UI logic related to the current phase
- restoring real Kabile fetch/merge/scaling behavior if a UI change damaged it
- introducing small structured-model improvements inspired by Tandoor or Mealie if they clearly strengthen the current workflow without broad regression risk

## Escalate Instead Of Auto-Fixing When
- a change touches auth, security, or destructive data flows
- database schema changes become necessary
- recipe calculation logic in `src/core/` or `src/utils/BOMEngine.js` would need risky rewrites
- a proposed fix would alter production assumptions without clear evidence
- the prototypes conflict with the real product mission in a way that needs product judgment
- an open-source integration would require broad architecture import instead of a focused Cabij-native adaptation

## Comparison Standard
When deciding whether to repair further, compare the current result against:
- [PHASE_GOAL.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/state/PHASE_GOAL.md)
- [UI_UX_REVIEW_RULES.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/state/UI_UX_REVIEW_RULES.md)
- [PLAYWRIGHT_ACCEPTANCE.md](/Users/teo/Documents/N8N_VSCODE/cabij_sop_app/state/PLAYWRIGHT_ACCEPTANCE.md)

## Automatic Repair Loop
1. identify the exact mismatch
2. name the smallest likely fix
3. apply only that fix
4. re-run the relevant check
5. stop if the issue is solved
6. only widen the scope if the smaller fix failed

## Priority Bias
If forced to choose, prefer:
- real Kabile correctness over cosmetic prettiness
- offline-first resilience over shallow UI polish
- chef speed over admin flexibility
- calm clarity over visual novelty
- one clear action over multiple duplicated controls

## Completion Standard
Stop automatic repair for the current phase when:
- the main phase goal is met
- Playwright acceptance passes for the core scenarios
- the UI review rules are satisfied well enough for phase-end review
- remaining issues are minor polish, not workflow blockers
