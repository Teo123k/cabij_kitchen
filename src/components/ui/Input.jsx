import React from 'react';

/**
 * High-Visibility Kitchen Input
 */
const Input = ({ label, className = '', ...props }) => {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label className="pl-1 text-sm font-bold uppercase tracking-widest text-app-muted">
          {label}
        </label>
      )}
      <input 
        className="cabij-input-base three-meter-text rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xl text-app-text placeholder:text-app-muted/50
                   focus-visible:border-app-accent/70 focus-visible:bg-app-surface-soft focus-visible:ring-1 focus-visible:ring-app-accent/30"
        {...props}
      />
    </div>
  );
};

export default Input;
