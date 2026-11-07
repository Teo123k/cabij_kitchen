// Completion is an overlay, never a change to the approved plan snapshot.
export function withTaskCompletion(plan, records) {
  if (!Array.isArray(records) || !plan.exportProvenance?.packageId || plan.project.sample) return plan;
  return { ...plan, completionAvailable: true, taskCompletions: Object.fromEntries(records.filter(r => r.package_id === plan.exportProvenance.packageId).map(r => [r.task_id, r])) };
}
