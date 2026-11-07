import React from 'react';

/**
 * Status Badge / Ingredient Tag
 */
const Badge = ({ children, status = 'neutral', className = '', ...props }) => {
  const themes = {
    neutral: "bg-app-muted/20 text-app-muted border-app-muted/30",
    success: "bg-app-success/20 text-app-success border-app-success/30",
    danger: "bg-app-danger/20 text-app-danger border-app-danger/30",
    accent: "bg-app-accent/20 text-app-accent border-app-accent/30"
  };

  return (
    <span 
      className={`px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-tighter 
                 ${themes[status] || themes.neutral} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};

export default Badge;
