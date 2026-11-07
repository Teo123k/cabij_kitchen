import React from 'react';
import { Activity, Clock, AlertTriangle, ChevronRight, CheckCircle2 } from 'lucide-react';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

const ExecutionOS = ({ tasks = [] }) => {
    // Mock data if none provided (for UI validation)
    const activeTasks = tasks.length > 0 ? tasks : [
        { id: 1, name: 'Bulgogi Beef', qty: '5000g', station: 'Grill', status: 'IN_PROGRESS', priority: 'HIGH', due: '12:30' },
        { id: 2, name: 'Magic Soy', qty: '2000ml', station: 'Prep', status: 'PENDING', priority: 'CRITICAL', due: '11:45' },
        { id: 3, name: 'Chicken Katsu', qty: '15 portions', station: 'Fry', status: 'BLOCKED', priority: 'LOW', due: '14:00' }
    ];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header / Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatusCard 
                    icon={<Activity className="text-app-accent" />} 
                    label="Active Preps" 
                    value="12" 
                    sub="4 closing in 30m"
                />
                <StatusCard 
                    icon={<Clock className="text-yellow-500" />} 
                    label="Units Outstanding" 
                    value="42" 
                    sub="8.5kg total weight"
                />
                <StatusCard 
                    icon={<AlertTriangle className="text-app-danger" />} 
                    label="Station Alerts" 
                    value="2" 
                    sub="Scale #4 offline"
                />
            </div>

            {/* Main Action Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Column 1: Live Production */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-black uppercase tracking-tighter">Live Production</h3>
                            <Badge color="emerald">8 Running</Badge>
                        </div>
                        <button className="text-[10px] font-black text-app-accent uppercase tracking-widest hover:underline">View All</button>
                    </div>

                    <div className="space-y-3">
                        {activeTasks.filter(t => t.status !== 'BLOCKED').map(task => (
                            <ExecutionTaskRow key={task.id} task={task} />
                        ))}
                    </div>
                </div>

                {/* Column 2: System Integrity / Alerts */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-2">
                        <h3 className="text-lg font-black uppercase tracking-tighter">Station Alerts</h3>
                        <Badge color="danger">2 Critical</Badge>
                    </div>

                    <div className="space-y-3">
                        <AlertRow 
                            title="Scale Calibration Required" 
                            station="Station 4" 
                            severity="CRITICAL"
                            desc="Unit detected drift > 2g. Recalibrate before next batch."
                        />
                        <AlertRow 
                            title="Inventory Shortfall" 
                            station="Cold Prep" 
                            severity="WARN"
                            desc="Magic Soy running low (1.2L left). Par is 4L."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatusCard = ({ icon, label, value, sub }) => (
    <Card className="flex items-center gap-6 p-6 group hover:border-app-accent/30 transition-all duration-300">
        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 group-hover:bg-app-accent/10 transition-colors">
            {icon}
        </div>
        <div>
            <div className="text-[10px] font-black text-app-muted uppercase tracking-widest leading-none mb-1">{label}</div>
            <div className="text-3xl font-black tracking-tighter text-white">{value}</div>
            <div className="text-[10px] font-bold text-app-muted uppercase mt-1 italic">{sub}</div>
        </div>
    </Card>
);

const ExecutionTaskRow = ({ task }) => (
    <div className="haptic-base flex items-center justify-between p-4 rounded-2xl bg-app-surface/40 border border-app-border hover:border-app-accent/20 transition-all group cursor-pointer overflow-hidden relative">
        {/* Progress Background Placeholder */}
        <div className="absolute inset-0 bg-app-accent/5 w-[65%] group-hover:bg-app-accent/10 transition-all" />
        
        <div className="flex items-center gap-4 relative z-10">
            <div className="w-12 h-12 rounded-xl bg-black/20 border border-white/5 flex items-center justify-center text-xl font-black text-app-accent">
                {task.due.split(':')[0]}
            </div>
            <div>
                <div className="font-bold text-white tracking-tight">{task.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-black text-app-muted uppercase tracking-widest">{task.station}</span>
                    <span className="w-1 h-1 rounded-full bg-app-muted opacity-30" />
                    <span className="text-[10px] font-black text-app-accent uppercase">{task.qty}</span>
                </div>
            </div>
        </div>

        <div className="flex items-center gap-4 relative z-10">
            <div className="text-right hidden sm:block">
                <div className="text-[10px] font-black text-white uppercase tracking-widest">Due at {task.due}</div>
                <div className="text-[10px] font-bold text-app-muted uppercase">65% Processed</div>
            </div>
            <ChevronRight className="text-app-muted group-hover:text-app-accent transition-colors" size={20} />
        </div>
    </div>
);

const AlertRow = ({ title, station, severity, desc }) => (
    <Card className={`!p-4 border-l-4 ${severity === 'CRITICAL' ? 'border-l-app-danger' : 'border-l-yellow-500'}`}>
        <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${severity === 'CRITICAL' ? 'text-app-danger' : 'text-yellow-500'}`}>
                        {station}
                    </span>
                    <span className="text-[10px] font-bold text-app-muted opacity-30">•</span>
                    <span className="text-[11px] font-black text-white">{title}</span>
                </div>
                <p className="text-[11px] text-app-muted leading-relaxed uppercase font-bold">{desc}</p>
            </div>
            <button className="haptic-base shrink-0 p-2 rounded-lg bg-white/5 border border-white/5 text-app-muted hover:text-white">
                <CheckCircle2 size={16} />
            </button>
        </div>
    </Card>
);

export default ExecutionOS;
