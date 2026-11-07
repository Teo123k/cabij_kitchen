import React, { useState, useEffect } from 'react';
import { Search, Command, FileText, ChevronRight } from 'lucide-react';
import Card from './ui/Card';

const QuickFinder = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');

    useEffect(() => {
        const down = (e) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setIsOpen((open) => !open);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('keydown', down);
        return () => document.removeEventListener('keydown', down);
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 backdrop-blur-md bg-black/60">
            <div className="w-full max-w-2xl animate-in fade-in zoom-in duration-200">
                <Card dark noBorder className="!p-0 border border-white/10 shadow-2xl overflow-hidden">
                    <div className="flex items-center gap-3 px-6 py-5 border-bottom border-white/5">
                        <Search className="text-app-accent" size={24} />
                        <input 
                            autoFocus
                            placeholder="Find recipe, ingredient, or station..."
                            className="bg-transparent border-none outline-none flex-1 text-2xl font-bold placeholder:text-app-muted text-app-text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <div className="h-6 w-10 flex items-center justify-center rounded bg-white/5 text-[10px] font-bold text-app-muted uppercase">
                            Esc
                        </div>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto p-2">
                        {/* Placeholder Results - Will be replaced by Dexie search in P4 */}
                        <div className="flex flex-col gap-1">
                            <div className="px-4 py-2 text-[10px] font-black text-app-muted uppercase tracking-widest">
                                Recent Recipes
                            </div>
                            <div className="haptic-base flex items-center justify-between p-4 rounded-xl hover:bg-white/5 cursor-pointer group">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded bg-app-accent/10 flex items-center justify-center text-app-accent">
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <div className="font-bold group-hover:text-app-accent transition-colors">Bulgogi Beef</div>
                                        <div className="text-xs text-app-muted uppercase font-bold">Main / Stir-Fry</div>
                                    </div>
                                </div>
                                <ChevronRight className="text-app-muted" size={16} />
                            </div>
                            
                            <div className="haptic-base flex items-center justify-between p-4 rounded-xl hover:bg-white/5 cursor-pointer group">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded bg-app-accent/10 flex items-center justify-center text-app-accent">
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <div className="font-bold group-hover:text-app-accent transition-colors">Magic Soy Sauce</div>
                                        <div className="text-xs text-app-muted uppercase font-bold">Sauce / Base</div>
                                    </div>
                                </div>
                                <ChevronRight className="text-app-muted" size={16} />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t border-white/5 flex items-center justify-between bg-black/20">
                        <div className="flex gap-4 text-[10px] font-bold text-app-muted uppercase italic tracking-tighter">
                            <span>↑↓ to navigate</span>
                            <span>↵ to open</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold text-app-muted">
                            <Command size={10} />
                            <span>Powered by G5.4 Intelligence</span>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default QuickFinder;
