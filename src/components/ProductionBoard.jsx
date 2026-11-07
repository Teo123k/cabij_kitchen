import React from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Layers3 } from 'lucide-react';

const formatTarget = (task) => {
  const target = Number(task?.targetYield || 0);
  const label = Number.isInteger(target) ? String(target) : target.toFixed(1);
  return `${label}${task?.unit ? ` ${task.unit}` : ''}`;
};

const ProductionBoard = ({ productionPlan }) => {
  const grouped = productionPlan?.grouped || {};
  const stations = Object.keys(grouped);

  if (!stations.length) {
    return (
      <div className="preview-list text-app-muted">
        <div className="flex items-center gap-2 preview-list-title text-app-accent">
          <Layers3 size={14} />
          Production Board
        </div>
        <p className="mt-3 text-sm font-semibold leading-6">
          Set a recipe target in the scaler to generate prep tasks. Nothing is written upstream from this board.
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 gap-4">
      <div className="mini-strip">
        <div className="mini">
          <div className="mini-label">Stations</div>
          <div className="mini-value text-app-accent">{stations.length}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Prep Tasks</div>
          <div className="mini-value text-app-text">{productionPlan.totalTasks || 0}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Dependencies</div>
          <div className="mini-value text-app-blue">{productionPlan.dependencyCount || 0}</div>
        </div>
      </div>

      <div className="grid max-h-[46vh] gap-4 overflow-auto pr-1 xl:grid-cols-2">
        {stations.map((station) => (
          <section key={station} className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-app-border-soft bg-app-surface-dense px-4 py-3">
              <div>
                <div className="eyebrow">{station}</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-app-muted">
                  {grouped[station].length} derived task{grouped[station].length === 1 ? '' : 's'}
                </div>
              </div>
              <span className="rounded-md border border-app-accent/30 bg-app-accent/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-app-accent">
                Read only
              </span>
            </div>

            <div className="divide-y divide-app-border-soft">
              {grouped[station].map((task) => (
                <article key={task.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-black tracking-tight text-app-text">{task.name}</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="focus-pill rounded-md px-2 py-1 text-[9px]">
                          Target {formatTarget(task)}
                        </span>
                        <span className="rounded-md border border-app-accent/30 bg-app-accent/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-app-accent">
                          {task.scaleFactor}x
                        </span>
                      </div>
                    </div>
                    {task.offlineSyncState && (
                      <span className="shrink-0 rounded-md border border-app-accent/30 bg-app-accent/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-app-accent">
                        {task.offlineSyncState}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2">
                    {task.reasons.map((reason) => (
                      <div key={reason} className="flex items-center gap-2 text-[11px] font-semibold text-app-muted">
                        <CheckCircle2 size={12} className="text-app-success" />
                        {reason}
                      </div>
                    ))}
                  </div>

                  {task.dependencies.length > 0 && (
                    <div className="mt-4 rounded-lg border border-app-blue/30 bg-app-blue/10 p-3">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-app-blue">
                        <GitBranch size={12} />
                        Dependency Sequence
                      </div>
                      <div className="space-y-2">
                        {task.dependencies.map((dependency) => (
                          <div key={`${task.id}-${dependency.recipeKey}`} className="flex items-center justify-between gap-3 text-[11px] font-semibold text-app-text">
                            <span className="min-w-0 truncate">{dependency.name}</span>
                            <span className="shrink-0 text-app-muted">
                              {dependency.requiredQty} {dependency.unit} / {dependency.station}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {task.offlineSyncReason && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-app-accent/30 bg-app-accent/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-app-accent">
                      <AlertTriangle size={12} />
                      {task.offlineSyncReason}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default ProductionBoard;
