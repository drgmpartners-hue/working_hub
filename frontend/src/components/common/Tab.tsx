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
          backgroundColor: '#F5F7FA',
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
                color: isActive ? '#1E3A5F' : '#6B7280',
                backgroundColor: isActive ? '#FFFFFF' : 'transparent',
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
                    backgroundColor: isActive ? '#1E3A5F' : '#E1E5EB',
                    color: isActive ? '#ffffff' : '#6B7280',
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
        borderBottom: '1px solid #E1E5EB',
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
              borderBottom: isActive ? '2px solid #1E3A5F' : '2px solid transparent',
              marginBottom: -1,
              backgroundColor: 'transparent',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#1E3A5F' : '#6B7280',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              opacity: item.disabled ? 0.45 : 1,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E';
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = '#6B7280';
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
                  backgroundColor: isActive ? '#1E3A5F' : '#E1E5EB',
                  color: isActive ? '#ffffff' : '#6B7280',
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
