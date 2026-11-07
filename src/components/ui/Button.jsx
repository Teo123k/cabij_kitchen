import React from 'react';

/**
 * Premium Kitchen Button
 * @param {Object} props
 * @param {boolean} props.primary - Use emerald accent color
 * @param {boolean} props.iconOnly - Adjust padding for icons
 * @param {boolean} props.danger - Use red danger color
 * @param {string} props.className - Extra classes
 */
const Button = ({ children, primary, iconOnly, danger, className = '', ...props }) => {
  const baseStyles = "haptic-base cabij-focus-ring inline-flex items-center justify-center rounded-xl font-bold";
  
  const variants = {
    primary: "bg-app-accent text-app-bg shadow-accent-glow hover:brightness-110",
    secondary: "border border-app-border bg-app-surface text-app-text hover:border-app-accent/30 hover:bg-app-border",
    danger: "bg-app-danger text-white shadow-lg hover:brightness-110",
    icon: "p-2 aspect-square",
    standard: "px-6 py-3"
  };

  const variant = danger ? variants.danger : primary ? variants.primary : variants.secondary;
  const padding = iconOnly ? variants.icon : variants.standard;

  return (
    <button 
      className={`${baseStyles} ${variant} ${padding} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
