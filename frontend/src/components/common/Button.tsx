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
    backgroundColor: 'var(--blue-600)',
    color: '#ffffff',
    border: '1px solid var(--blue-500)',
  },
  secondary: {
    backgroundColor: 'transparent',
    color: 'var(--blue-400)',
    border: '1px solid var(--blue-500)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid transparent',
  },
  danger: {
    backgroundColor: 'var(--danger)',
    color: '#ffffff',
    border: '1px solid var(--danger)',
  },
};

const variantHoverStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { backgroundColor: '#162d4a', borderColor: '#162d4a' },
  secondary: { backgroundColor: 'rgba(30,58,95,0.06)' },
  ghost: { backgroundColor: 'rgba(107,114,128,0.08)', color: 'var(--text-primary)' },
  danger: { backgroundColor: 'var(--danger)', borderColor: 'var(--danger)' },
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
