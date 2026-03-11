'use client';

import { InputHTMLAttributes, forwardRef, useState } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, fullWidth = true, id, disabled, style, ...rest }, ref) => {
    const [focused, setFocused] = useState(false);

    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    const borderColor = error
      ? '#EF4444'
      : focused
      ? '#4A90D9'
      : '#E1E5EB';

    const boxShadow = error
      ? '0 0 0 3px rgba(239,68,68,0.15)'
      : focused
      ? '0 0 0 3px rgba(74,144,217,0.18)'
      : 'none';

    return (
      <div style={{ width: fullWidth ? '100%' : undefined, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: error ? '#EF4444' : '#1A1A2E',
              marginBottom: 2,
            }}
          >
            {label}
          </label>
        )}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={{
            width: '100%',
            height: 40,
            padding: '0 12px',
            fontSize: '0.875rem',
            color: disabled ? '#6B7280' : '#1A1A2E',
            backgroundColor: disabled ? '#F5F7FA' : '#FFFFFF',
            border: `1px solid ${borderColor}`,
            borderRadius: 8,
            outline: 'none',
            boxShadow,
            cursor: disabled ? 'not-allowed' : 'text',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            ...style,
          }}
          {...rest}
        />

        {error && (
          <span style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </span>
        )}

        {hint && !error && (
          <span style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 2 }}>
            {hint}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
