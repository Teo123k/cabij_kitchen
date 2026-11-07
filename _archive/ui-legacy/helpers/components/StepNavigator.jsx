import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, Check, AlertCircle, Play } from 'lucide-react';
import { validateStepCompletion } from '../core/validator';

const StepNavigator = ({ steps, onComplete, onExit }) => {
    const [current, setCurrent] = useState(0);
    const [error, setError] = useState(null);

    const activeStep = steps[current] || { title: 'Unknown Step', copy: 'No data' };
    const progress = ((current + 1) / steps.length) * 100;

    const handleNext = () => {
        const result = validateStepCompletion(activeStep, {}); // Passing empty input for now
        if (!result.valid) {
            setError(result.message);
            return;
        }

        setError(null);
        if (current < steps.length - 1) {
            setCurrent(current + 1);
        } else {
            onComplete();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-app-bg/95 backdrop-blur-3xl p-6 flex flex-col animate-in slide-in-from-bottom duration-500">
            {/* Header: Progress */}
            <header className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-6">
                    <button 
                        onClick={onExit}
                        className="haptic-base p-4 rounded-2xl bg-white/5 border border-white/10 text-app-muted hover:text-white"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <div>
                        <div className="text-[10px] font-black text-app-accent uppercase tracking-[0.2em] mb-1">Guided Mission</div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tight">Active Operation</h2>
                    </div>
                </div>

                <div className="flex-1 max-w-md mx-12">
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                        <div 
                            className="h-full bg-app-accent transition-all duration-700 ease-out shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-2">
                         <span className="text-[10px] font-black text-app-muted uppercase">Step {current + 1} of {steps.length}</span>
                         <span className="text-[10px] font-black text-app-accent uppercase">{Math.round(progress)}% Complete</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-app-accent/20 border border-app-accent/30 flex items-center justify-center text-app-accent">
                        <Play size={20} fill="currentColor" />
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto w-full">
                <div className="space-y-6">
                    <Badge color="accent" className="mx-auto uppercase tracking-[0.3em] px-6 py-2">Instruction</Badge>
                    <h1 className="text-7xl font-black tracking-tight leading-[0.9] text-white">
                        {activeStep.title}
                    </h1>
                    <p className="text-2xl text-app-muted font-medium max-w-2xl mx-auto leading-relaxed">
                        {activeStep.copy}
                    </p>
                </div>

                {error && (
                    <div className="mt-12 flex items-center gap-3 px-6 py-4 bg-app-danger/10 border border-app-danger/20 rounded-2xl text-app-danger font-bold text-sm animate-in shake duration-500">
                        <AlertCircle size={20} />
                        {error}
                    </div>
                )}
            </main>

            {/* Footer Navigation */}
            <footer className="pt-12 flex items-center gap-6">
                <button 
                    disabled={current === 0}
                    onClick={() => setCurrent(current - 1)}
                    className="haptic-base h-24 px-12 rounded-3xl bg-white/5 border border-white/10 text-app-muted font-black uppercase tracking-widest disabled:opacity-20 hover:text-white"
                >
                    Previous
                </button>
                
                <button 
                    onClick={handleNext}
                    className="haptic-base flex-1 h-24 rounded-3xl bg-app-accent shadow-2xl shadow-app-accent/30 flex items-center justify-center gap-4 text-app-bg text-2xl font-black uppercase tracking-[0.1em] hover:scale-[1.01] transition-transform"
                >
                    {current === steps.length - 1 ? 'Finish Mission' : 'Next Step'}
                    <ChevronRight size={32} />
                </button>
            </footer>
        </div>
    );
};

const Badge = ({ children, color, className }) => (
    <div className={`w-fit px-3 py-1 rounded-full text-[10px] font-black border tracking-widest ${
        color === 'accent' ? 'bg-app-accent/10 border-app-accent/30 text-app-accent' : 'bg-white/10 border-white/20 text-white'
    } ${className}`}>
        {children}
    </div>
);

export default StepNavigator;
