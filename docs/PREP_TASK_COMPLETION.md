# Prep task completion

A kitchen member can mark tasks complete or reopen them on the current trusted approved package in the prep board. Completion is stored separately from the approved snapshot and appears in the board, printed prep sheets and the workbook's live-state section. Refresh completion to see updates made by another person; the timestamp and user ID identify the last change. Missing or unavailable completion data is not treated as pending.

The database enforces kitchen membership, package tenant and project, current revision, trusted calculation reference and membership of the task ID in the approved snapshot. It assigns the actor and timestamps. A new package does not inherit completion from an old package. Demo tasks are not persisted. Current state is retained, not a full change history; concurrent changes are last-write-wins.

The migration has not been applied to the hosted project. This is authenticated Supabase persistence, not a Slack interactive checkbox, notification, realtime subscription or offline queue. Slack delivery has not been changed. Authenticated staging testing, role review, delivery notification and operational verification remain necessary before client use.
