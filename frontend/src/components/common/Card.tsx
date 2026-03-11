'use client';

import { HTMLAttributes, forwardRef } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padding?: number | string;
  noBorder?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ hoverable = false, padding = 20, noBorder = false, children, style, onMouseEnter, onMouseLeave, ...rest }, ref) => {
    const baseStyle: React.CSSProperties = {
      backgroundColor: '#FFFFFF',
      border: noBorder ? 'none' : '1px solid #E1E5EB',
      borderRadius: 12,
      padding,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      transition: hoverable ? 'box-shadow 0.18s ease, transform 0.18s ease' : undefined,
      ...style,
    };

    return (
      <div
        ref={ref}
        style={baseStyle}
        onMouseEnter={(e) => {
          if (hoverable) {
            (e.currentTarget as HTMLDivElement).style.boxShadow =
              '0 8px 24px rgba(30,58,95,0.10), 0 2px 8px rgba(30,58,95,0.06)';
            (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (hoverable) {
            (e.currentTarget as HTMLDivElement).style.boxShadow =
              '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)';
            (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
          }
          onMouseLeave?.(e);
        }}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export default Card;
