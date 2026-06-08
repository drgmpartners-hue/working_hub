'use client';

import { ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Optional count badge */
  count?: number;
  disabled?: boolean;
}

interface TabProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Underline style (default) or pill style */
  variant?: 'underline' | 'pill';
}

export function Tab({ items, activeKey, onChange, variant = 'underline' }: TabProps) {
  if (variant === 'pill') {
    return (
      <div
        style={{
          display: 'inline-flex',
          gap: 4,
          backgroundColor: 'var(--bg-surface)',
          padding: 4,
          borderRadius: 10,
        }}
      >
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <button
              key={item.key}
              disabled={item.disabled}
              onClick={() => !item.disabled && onChange(item.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 14px',
                borderRadius: 7,
                border: 'none',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--blue-600)' : 'var(--text-muted)',
                backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
                opacity: item.disabled ? 0.45 : 1,
              }}
            >
              {item.label}
              {item.count !== undefined && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    backgroundColor: isActive ? 'var(--blue-600)' : 'var(--border-strong)',
                    color: isActive ? '#ffffff' : 'var(--text-muted)',
                  }}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  /* === Underline variant (default) === */
  return (
    <div
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        gap: 0,
      }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 16px',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--blue-400)' : '2px solid transparent',
              marginBottom: -1,
              backgroundColor: 'transparent',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--blue-400)' : 'var(--text-muted)',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              opacity: item.disabled ? 0.45 : 1,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
              }
            }}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 9,
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  backgroundColor: isActive ? 'var(--blue-600)' : 'var(--border-strong)',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tab;
