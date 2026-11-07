import React, { useState } from 'react';
import { Menu, X, Search, Settings, ChevronRight } from 'lucide-react';
import QuickFinder from './QuickFinder';

const Layout = ({ children, leftPanel, rightPanel }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-outfit overflow-hidden">
      {/* Search Overlay Bridge */}
      <QuickFinder />

      <div className="flex h-screen p-4 gap-4">
        {/* LEFT PANEL: Finder / Library */}
        <aside 
          className={`panel flex flex-col transition-all duration-300 ease-in-out
                     ${isSidebarOpen ? 'w-[360px] opacity-100' : 'w-0 -ml-4 opacity-0 overflow-hidden'}`}
        >
          {leftPanel}
        </aside>

        {/* CENTER PANEL: Main Execution Stage */}
        <main className="flex-1 flex flex-col gap-4 overflow-hidden relative">
          <header className="flex items-center justify-between px-2 shrink-0">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="haptic-base p-2 rounded-xl bg-app-surface border border-app-border text-app-muted hover:text-app-accent"
              >
                {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
              <div className="flex items-center text-sm font-bold text-app-muted uppercase tracking-widest gap-2">
                <span>Cabij OS</span>
                <ChevronRight size={14} />
                <span className="text-app-accent">Live Stage</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
                <kbd className="hidden md:flex h-8 items-center gap-1 rounded border border-app-border bg-app-surface px-2 text-[10px] font-bold text-app-muted uppercase">
                    <span className="text-xs">⌘</span>K
                </kbd>
                <div className="w-10 h-10 rounded-full bg-app-surface border border-app-border flex items-center justify-center text-app-muted hover:text-app-accent cursor-pointer">
                    <Settings size={20} />
                </div>
            </div>
          </header>

          <div className="flex-1 panel overflow-y-auto p-8 relative">
            {children}
          </div>
        </main>

        {/* RIGHT PANEL: Setup / Admin */}
        <aside className="hidden lg:flex flex-col w-[300px] panel overflow-y-auto">
          {rightPanel}
        </aside>
      </div>
    </div>
  );
};

export default Layout;
