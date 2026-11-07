import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("CABIJ_FATAL_ERROR", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 min-h-screen bg-[#0a0a0a] text-white p-10 flex flex-col items-center justify-center font-mono z-[99999] overflow-auto">
          <div className="text-app-accent text-4xl mb-8 font-black uppercase tracking-widest animate-pulse border-b-4 border-app-accent pb-2">
            Neural Link Termination
          </div>
          
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl w-full max-w-5xl shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-red-600"></div>
            
            <h2 className="text-xl font-black mb-6 uppercase text-white tracking-widest flex items-center gap-3">
              <span className="w-3 h-3 bg-red-600 rounded-full animate-ping"></span>
              CORE_DUMP_ANALYSIS_0xFC1
            </h2>
            
            <div className="space-y-6">
              <div className="p-6 bg-black/40 rounded-2xl border border-white/5 space-y-2">
                <div className="text-[10px] font-black text-app-accent uppercase tracking-widest opacity-50">Fault Reason</div>
                <div className="text-sm font-bold text-red-400 font-mono break-all">
                  {this.state.error?.name}: {this.state.error?.message}
                </div>
              </div>

              <div className="p-6 bg-black/40 rounded-2xl border border-white/5 space-y-2">
                <div className="text-[10px] font-black text-white/40 uppercase tracking-widest opacity-50">Stack Trace</div>
                <div className="text-[10px] font-mono leading-relaxed text-app-muted whitespace-pre-wrap max-h-[40vh] overflow-y-auto pr-4 scrollbar-thin">
                  {this.state.errorInfo?.componentStack || this.state.error?.stack}
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap gap-4 items-center justify-between border-t border-white/5 pt-8">
               <div className="text-[10px] font-black uppercase text-app-muted tracking-[0.2em] max-w-sm">
                 The Cabij Operational OS encountered a fatal render crash. This bypasses normal lifecycle guards. Please report this dump to technical command.
               </div>
               <button 
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-10 py-4 bg-red-600 text-white font-black uppercase text-xs rounded-xl shadow-lg shadow-red-900/40 hover:scale-105 active:scale-95 transition-all"
               >
                 Purge Cache & Restart
               </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;
