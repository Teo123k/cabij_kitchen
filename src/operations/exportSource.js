// Package snapshots are the only source for approved delivery artifacts.
export function exportSource({ draft, packageRecord, project, clientId, demo = false, dirty = false }) {
  if (!packageRecord) return { ...draft, status: 'draft', exportProvenance: { status: 'DRAFT — NOT APPROVED FOR DELIVERY', engineVersion: String(draft.engineVersion ?? 'unknown') } };
  const p = packageRecord, s = p.snapshot;
  if (!project || dirty || p.project_id !== project.id || p.project_revision !== project.revision) throw new Error('This package is stale. Save and approve the current project before exporting.');
  if ((!demo && p.client_id !== clientId) || s?.clientId !== clientId) throw new Error('This package is not accessible for this kitchen.');
  if (!s || s.status !== 'approved' || !s.ready || !s.engineVersion || (!demo && !p.calculation_run_id)) throw new Error('This package has no verifiable trusted calculation. Approve the current project again.');
  return { ...s, exportProvenance: { status: s.project.sample ? 'SYNTHETIC REHEARSAL — NOT FOR CLIENT DELIVERY' : 'APPROVED', packageId: p.id, projectRevision: p.project_revision, calculationRunId: p.calculation_run_id || 'demo only', engineVersion: String(s.engineVersion), approvedAt: p.approved_at || s.approvedAt } };
}
export function provenanceText(plan) {
  const p = plan.exportProvenance;
  if (!p) return plan.status === 'approved' ? 'Approved snapshot (provenance not provided)' : 'DRAFT — NOT APPROVED FOR DELIVERY';
  return [p.status, p.packageId && `Package ${p.packageId}`, p.projectRevision && `Revision ${p.projectRevision}`, p.calculationRunId && `Calculation run ${p.calculationRunId}`, `Engine ${p.engineVersion}`].filter(Boolean).join(' | ');
}
