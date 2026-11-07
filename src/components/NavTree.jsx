import React, { useMemo, useState } from 'react';
import { Folder, FileText, ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { OFFLINE_QUEUE_STATUS_LABELS, OFFLINE_STATE, OFFLINE_STATE_META } from '../config/constants';

const NavTree = ({ recipes = [], selectedId, onSelect, translateIngredient }) => {
  const styles = useMemo(() => {
    const s = {};
    (recipes || []).forEach(r => {
      if (!r) return;
      const style = r.dishStyle || r.style || 'Other';
      if (!s[style]) s[style] = [];
      s[style].push(r);
    });
    return s;
  }, [recipes]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-app-border shrink-0">
        <div className="text-[10px] font-black text-app-accent uppercase tracking-[0.2em] mb-2">Chef Library</div>
        <h2 className="text-2xl font-black tracking-tighter">Recipes</h2>
      </div>

      {/* Explorer Tree */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="space-y-6">
          
          {/* Group: All Recipes */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-black text-app-muted uppercase tracking-widest">
              <span>All Files</span>
              <span className="text-app-accent">{recipes?.length || 0}</span>
            </div>
            
            <div className="space-y-1">
               {(recipes || []).slice(0, 5).map(r => (
                  <TreeItem 
                    key={r.id}
                    label={translateIngredient ? translateIngredient(r.name || '') : (r.name || 'Unnamed')} 
                    badge={r.dishStyle} 
                    status={r.offline_sync_state}
                    active={selectedId === r.id}
                    onClick={() => onSelect(r.id)}
                  />
               ))}
            </div>
          </div>

          {/* Group: By Style */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-black text-app-muted uppercase tracking-widest">
              <span>By Style</span>
            </div>
            
            <div className="space-y-1">
               {Object.entries(styles).map(([style, items]) => (
                 <TreeFolder key={style} label={style} count={items.length}>
                    {items.map(r => (
                      <TreeItem 
                        key={r.id}
                        label={translateIngredient ? translateIngredient(r.name || '') : (r.name || 'Unnamed')} 
                        status={r.offline_sync_state}
                        active={selectedId === r.id}
                        onClick={() => onSelect(r.id)}
                        indent 
                      />
                    ))}
                 </TreeFolder>
               ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-app-border bg-app-surface/30">
        <button className="w-full primary px-4 py-3 rounded-xl bg-app-accent/10 border border-app-accent/20 text-app-accent font-bold hover:bg-app-accent/20 transition-all">
          Export Database
        </button>
      </div>
    </div>
  );
};

const TreeItem = ({ label, badge, status, active, indent, onClick }) => (
  <div 
    onClick={onClick}
    className={`haptic-base flex items-center justify-between p-3 rounded-xl cursor-pointer group transition-all
                  ${active ? 'bg-app-accent/10 border border-app-accent/20' : 'hover:bg-white/5 border border-transparent'}
                  ${indent ? 'ml-6 scale-95' : ''}`}>
    <div className="flex items-center gap-3 min-width-0">
      <FileText size={16} className={active ? 'text-app-accent' : 'text-app-muted group-hover:text-app-text'} />
      <span className={`text-sm font-bold truncate ${active ? 'text-app-text' : 'text-app-muted group-hover:text-app-text'}`}>
        {label}
      </span>
    </div>
    <div className="flex flex-col items-end gap-1">
      {badge && <span className="text-[10px] font-bold text-app-muted group-hover:text-app-accent">{badge}</span>}
      {status && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] ${
            status === OFFLINE_STATE.SYNCED
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : status === OFFLINE_STATE.CONFLICT
                ? 'border-orange-200 bg-orange-50 text-orange-800'
                : status === OFFLINE_STATE.BLOCKED
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
          title={OFFLINE_STATE_META[status]?.description || status}
        >
          {OFFLINE_QUEUE_STATUS_LABELS[status] || OFFLINE_STATE_META[status]?.label || status}
        </span>
      )}
    </div>
  </div>
);

const TreeFolder = ({ label, count, open, children }) => (
  <div className="space-y-1">
    <div className="haptic-base flex items-center justify-between p-3 rounded-xl cursor-pointer hover:bg-white/5 group">
      <div className="flex items-center gap-3">
        {open ? <ChevronDown size={16} className="text-app-accent" /> : <ChevronRight size={16} className="text-app-muted" />}
        <Folder size={16} className="text-app-muted group-hover:text-app-accent" />
        <span className="text-sm font-black text-app-muted group-hover:text-app-text">{label}</span>
      </div>
      <span className="text-[10px] font-black text-app-accent bg-app-accent/10 px-2 py-0.5 rounded-full">{count}</span>
    </div>
    {open && children}
  </div>
);

export default NavTree;
