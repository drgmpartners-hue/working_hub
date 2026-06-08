'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';
import type { StockItem } from './StockDetailPanel';

interface AllocationItem extends StockItem {
  custom_pct: number;
}

interface AllocationPanelProps {
  stocks: StockItem[];
  onBack: () => void;
}

function distributeEqually(items: StockItem[]): AllocationItem[] {
  if (items.length === 0) return [];
  const pct = Math.floor(100 / items.length);
  const remainder = 100 - pct * items.length;
  return items.map((s, i) => ({
    ...s,
    custom_pct: i === 0 ? pct + remainder : pct,
  }));
}

export function AllocationPanel({ stocks, onBack }: AllocationPanelProps) {
  const [items, setItems] = useState<AllocationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = stocks.map((s) => ({
      ...s,
      custom_pct: s.allocation_pct ?? Math.floor(100 / Math.max(stocks.length, 1)),
    }));
    // Use score-weighted distribution if allocation_pct not provided
    const hasAllocation = stocks.some((s) => s.allocation_pct != null);
    if (hasAllocation) {
      setItems(initial);
    } else {
      setItems(distributeEqually(stocks));
    }
  }, [stocks]);

  const total = items.reduce((sum, it) => sum + it.custom_pct, 0);
  const isValid = total === 100;

  function updatePct(id: number, pct: number) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, custom_pct: Math.max(0, Math.min(100, pct)) } : it))
    );
  }

  function equalDistribute() {
    setItems(distributeEqually(stocks));
  }

  async function savePool() {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          stocks: items.map((it) => ({
            stock_code: it.stock_code,
            stock_name: it.stock_name,
            theme: it.theme,
            allocation_pct: it.custom_pct,
          })),
        }),
      });
      if (!res.ok) throw new Error('종목풀 저장에 실패했습니다.');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (stocks.length === 0) {
    return (
      <div
        style={{
          padding: '48px 0',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.875rem',
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </div>
        <p style={{ margin: '0 0 16px' }}>비중 제안 대상 종목이 없습니다.</p>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Step 2에서 종목 행의 <strong>+</strong> 버튼을 눌러 종목을 담아주세요.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            비중 제안
          </h2>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            종목별 비중(%)을 조정하고 종목풀에 저장합니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={equalDistribute}>
            균등 분배
          </Button>
          <Button size="sm" variant="secondary" onClick={onBack}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            종목으로
          </Button>
        </div>
      </div>

      {/* Total indicator */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          backgroundColor: isValid
            ? 'rgba(5,150,105,0.08)'
            : total > 100
            ? 'rgba(220,38,38,0.08)'
            : 'rgba(217,119,6,0.08)',
          border: `1px solid ${isValid ? 'rgba(5,150,105,0.25)' : total > 100 ? 'rgba(220,38,38,0.25)' : 'rgba(217,119,6,0.25)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          합계
        </span>
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 800,
            fontFamily: 'monospace',
            color: isValid ? '#059669' : total > 100 ? '#DC2626' : '#D97706',
          }}
        >
          {total}%
          {!isValid && (
            <span style={{ fontSize: '0.75rem', marginLeft: 8 }}>
              {total > 100 ? `(${total - 100}% 초과)` : `(${100 - total}% 부족)`}
            </span>
          )}
        </span>
      </div>

      {/* Allocation rows */}
      <div
        style={{
          borderRadius: 10,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {items.map((it, idx) => (
          <div
            key={it.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none',
              backgroundColor: it.is_top5 ? 'rgba(217,119,6,0.03)' : 'var(--bg-card)',
            }}
          >
            {/* Rank & name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {it.is_top5 && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#D97706">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.stock_name}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {it.stock_code}
                  </span>
                  {it.composite_score != null && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        color: '#2E8B8B',
                        fontWeight: 600,
                      }}
                    >
                      점수 {it.composite_score}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Bar visualization */}
            <div
              style={{
                flex: '0 0 80px',
                height: 6,
                borderRadius: 3,
                backgroundColor: 'var(--bg-surface)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${it.custom_pct}%`,
                  backgroundColor: '#2E8B8B',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                min="0"
                max="100"
                value={it.custom_pct}
                onChange={(e) => updatePct(it.id, parseInt(e.target.value) || 0)}
                style={{
                  width: 56,
                  padding: '5px 7px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 7,
            backgroundColor: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            color: '#DC2626',
            fontSize: '0.8125rem',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Save button */}
      <Button
        variant="primary"
        size="md"
        fullWidth
        disabled={!isValid}
        loading={saving}
        onClick={savePool}
        style={{ backgroundColor: '#2E8B8B', borderColor: '#2E8B8B' }}
      >
        {saved ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            종목풀 저장 완료
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            종목풀에 저장 ({items.length}종목)
          </span>
        )}
      </Button>
      {!isValid && (
        <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          합계가 정확히 100%여야 저장할 수 있습니다.
        </p>
      )}
    </div>
  );
}

export default AllocationPanel;
