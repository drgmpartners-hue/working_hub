'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: '#1E3A5F',
    color: '#ffffff',
    border: '1px solid #1E3A5F',
  },
  secondary: {
    backgroundColor: 'transparent',
    color: '#1E3A5F',
    border: '1px solid #1E3A5F',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: '#6B7280',
    border: '1px solid transparent',
  },
  danger: {
    backgroundColor: '#EF4444',
    color: '#ffffff',
    border: '1px solid #EF4444',
  },
};

const variantHoverStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { backgroundColor: '#162d4a', borderColor: '#162d4a' },
  secondary: { backgroundColor: 'rgba(30,58,95,0.06)' },
  ghost: { backgroundColor: 'rgba(107,114,128,0.08)', color: '#1A1A2E' },
  danger: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { fontSize: '0.8125rem', padding: '5px 12px', height: 32 },
  md: { fontSize: '0.875rem', padding: '7px 16px', height: 40 },
  lg: { fontSize: '1rem',     padding: '9px 22px', height: 48 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      style,
      onMouseEnter,
      onMouseLeave,
      ...rest
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const baseStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      fontWeight: 500,
      borderRadius: 8,
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.55 : 1,
      transition: 'background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      width: fullWidth ? '100%' : undefined,
      ...variantStyles[variant],
      ...sizeStyles[size],
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        style={baseStyle}
        onMouseEnter={(e) => {
          if (!isDisabled) {
            Object.assign((e.currentTarget as HTMLButtonElement).style, variantHoverStyles[variant]);
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (!isDisabled) {
            Object.assign((e.currentTarget as HTMLButtonElement).style, variantStyles[variant]);
          }
          onMouseLeave?.(e);
        }}
        {...rest}
      >
        {loading && (
          <span
            style={{
              width: size === 'lg' ? 18 : 14,
              height: size === 'lg' ? 18 : 14,
              border: `2px solid currentColor`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.7s linear infinite',
              flexShrink: 0,
            }}
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
