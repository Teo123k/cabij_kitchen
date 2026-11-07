import React from 'react';

/**
 * Glassmorphism Card Container
 * @param {Object} props
 * @param {boolean} props.dark - Use deep dark glass
 * @param {boolean} props.noBorder - Remove border
 */
const Card = ({ children, dark, noBorder, className = '', ...props }) => {
  const styleClass = dark ? 'glass-dark' : 'glass';
  const borderClass = noBorder ? '' : 'border border-white/5';

  return (
    <div 
      className={`rounded-2xl p-6 ${styleClass} ${borderClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
