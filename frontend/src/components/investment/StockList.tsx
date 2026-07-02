'use client';

import { useState, useEffect, useCallback } from 'react';
import { authLib } from '@/lib/auth';
import { StockDetailPanel } from './StockDetailPanel';
import { ScreeningFilter, DEFAULT_FILTER } from './ScreeningFilter';
import { SignalBadge } from './SignalBadge';
import type { StockItem } from './StockDetailPanel';
import type { ScreeningFilterValues } from './ScreeningFilter';
import { API_URL } from '@/lib/api-url';

// Re-export StockItem for backward compat
export type { StockItem };

interface StockListProps {
  recommendationId: number;
  /** 종목이 바스켓에 추가될 때 콜백 (Step3 비중 제안용) */
  onAddToAllocation?: (stock: StockItem) => void;
  allocationStocks?: StockItem[];
}

export function StockList({ recommendationId, onAddToAllocation, allocationStocks = [] }: StockListProps) {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<ScreeningFilterValues>(DEFAULT_FILTER);

  /* base fetch */
  useEffect(() => {
    if (!recommendationId) return;
    fetchStocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationId]);

  async function fetchStocks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/stocks/recommendations/${recommendationId}/stocks`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) throw new Error('추천 종목을 불러오는 데 실패했습니다.');
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.stocks ?? [];
      setStocks(list);
      setFilteredStocks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  /* screening filter fetch */
  const applyFilter = useCallback(async (values: ScreeningFilterValues) => {
    const hasFilter = values.pbr_max !== '' || values.ma_alignment !== '' || values.score_min !== '';
    if (!hasFilter) {
      setFilteredStocks(stocks);
      return;
    }
    setFilterLoading(true);
    try {
      const params = new URLSearchParams();
      if (values.pbr_max) params.set('pbr_max', values.pbr_max);
      if (values.ma_alignment) params.set('ma_alignment', values.ma_alignment);
      if (values.score_min) params.set('score_min', values.score_min);
      const res = await fetch(
        `${API_URL}/api/v1/stocks/screening?${params.toString()}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) throw new Error('스크리닝 실패');
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.stocks ?? [];
      setFilteredStocks(list);
    } catch {
      // fallback: client-side filter
      const fallback = stocks.filter((s) => {
        if (values.pbr_max && s.pbr != null && s.pbr > parseFloat(values.pbr_max)) return false;
        if (values.score_min && s.composite_score != null && s.composite_score < parseFloat(values.score_min)) return false;
        if (values.ma_alignment && s.ma_alignment && s.ma_alignment !== values.ma_alignment) return false;
        return true;
      });
      setFilteredStocks(fallback);
    } finally {
      setFilterLoading(false);
    }
  }, [stocks]);

  function handleFilterChange(values: ScreeningFilterValues) {
    setFilterValues(values);
    applyFilter(values);
  }

  function handleFilterReset() {
    setFilterValues(DEFAULT_FILTER);
    setFilteredStocks(stocks);
  }

  function openPanel(stock: StockItem) {
    setSelectedStock(stock);
    setPanelOpen(true);
  }

  const ReturnCell = ({ value }: { value: number }) => (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: value > 0 ? '#059669' : value < 0 ? '#DC2626' : 'var(--text-muted)',
      }}
    >
      {value > 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '2px solid #E1E5EB',
            borderTopColor: '#2E8B8B',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: '14px 16px',
          backgroundColor: 'var(--danger-bg, #FEF2F2)',
          border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: 8,
          color: 'var(--danger, #B91C1C)',
          fontSize: '0.875rem',
        }}
      >
        {error}
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        추천 종목이 없습니다.
      </div>
    );
  }

  return (
    <>
      {/* Screening filter */}
      <ScreeningFilter
        values={filterValues}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
        loading={filterLoading}
      />

      {/* Stock count / legend */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          총 <strong style={{ color: 'var(--text-primary)' }}>{filteredStocks.length}</strong>개
          {filteredStocks.length !== stocks.length && (
            <span style={{ color: '#2E8B8B', marginLeft: 4 }}>
              (전체 {stocks.length}개 중 필터)
            </span>
          )}
        </p>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', color: '#D97706' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#D97706">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          TOP 5
        </span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          * 행 클릭 → 근거 패널
        </span>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border, #E1E5EB)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-surface, #F5F7FA)' }}>
              {['순위', '종목명', '테마', '종합점수', '시그널', 'PBR', 'PER', '1개월', '3개월', '6개월', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 12px',
                    textAlign: h === '순위' || h === '' ? 'center' : 'left',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: 'var(--text-muted, var(--text-muted))',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid var(--border, #E1E5EB)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredStocks.map((stock) => {
              const inAllocation = allocationStocks.some((s) => s.id === stock.id);
              // Build signal from stock fields
              const signalFromStock = stock.ma_alignment
                ? { ma_alignment: stock.ma_alignment as 'bullish' | 'bearish' | 'neutral' }
                : {};

              return (
                <tr
                  key={stock.id}
                  onClick={() => openPanel(stock)}
                  style={{
                    borderBottom: '1px solid var(--border, #E1E5EB)',
                    cursor: 'pointer',
                    backgroundColor: stock.is_top5 ? 'rgba(217,119,6,0.03)' : 'transparent',
                    transition: 'background-color 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = stock.is_top5
                      ? 'rgba(217,119,6,0.07)'
                      : 'rgba(46,139,139,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = stock.is_top5
                      ? 'rgba(217,119,6,0.03)'
                      : 'transparent';
                  }}
                >
                  {/* rank */}
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {stock.is_top5 && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="#D97706">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      )}
                      <span style={{ fontWeight: stock.is_top5 ? 700 : 400, color: stock.is_top5 ? '#D97706' : 'var(--text-muted)' }}>
                        {stock.rank}
                      </span>
                    </div>
                  </td>

                  {/* name + code */}
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{stock.stock_name}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                      {stock.stock_code}
                    </div>
                  </td>

                  {/* theme */}
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 4,
                        fontSize: '0.75rem',
                        backgroundColor: 'rgba(46,139,139,0.10)',
                        color: '#2E8B8B',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stock.theme}
                    </span>
                  </td>

                  {/* composite score */}
                  <td style={{ padding: '10px 12px' }}>
                    {stock.composite_score != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div
                          style={{
                            width: 36,
                            height: 5,
                            borderRadius: 3,
                            backgroundColor: 'var(--bg-surface)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${stock.composite_score}%`,
                              backgroundColor:
                                stock.composite_score >= 70 ? '#059669' : stock.composite_score >= 50 ? '#D97706' : '#DC2626',
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            fontSize: '0.8125rem',
                            color:
                              stock.composite_score >= 70 ? '#059669' : stock.composite_score >= 50 ? '#D97706' : '#DC2626',
                          }}
                        >
                          {stock.composite_score}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>-</span>
                    )}
                  </td>

                  {/* signal tags */}
                  <td style={{ padding: '10px 12px', maxWidth: 160 }}>
                    {stock.signal_tags && stock.signal_tags.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {stock.signal_tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            style={{
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontSize: '0.6875rem',
                              backgroundColor: tag.includes('골든') || tag === '정배열'
                                ? 'rgba(5,150,105,0.10)'
                                : 'rgba(220,38,38,0.10)',
                              color: tag.includes('골든') || tag === '정배열' ? '#059669' : '#DC2626',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : stock.ma_alignment ? (
                      <SignalBadge signal={signalFromStock} compact />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>-</span>
                    )}
                  </td>

                  {/* PBR */}
                  <td style={{ padding: '10px 12px' }}>
                    {stock.pbr != null ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        {stock.pbr.toFixed(2)}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>

                  {/* PER */}
                  <td style={{ padding: '10px 12px' }}>
                    {stock.per != null ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        {stock.per.toFixed(1)}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>

                  {/* returns */}
                  <td style={{ padding: '10px 12px' }}><ReturnCell value={stock.return_1m} /></td>
                  <td style={{ padding: '10px 12px' }}><ReturnCell value={stock.return_3m} /></td>
                  <td style={{ padding: '10px 12px' }}><ReturnCell value={stock.return_6m} /></td>

                  {/* add to allocation + arrow */}
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      {onAddToAllocation && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToAllocation(stock);
                          }}
                          title={inAllocation ? '이미 추가됨' : '비중 제안에 추가'}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            border: `1px solid ${inAllocation ? '#2E8B8B' : 'var(--border)'}`,
                            backgroundColor: inAllocation ? 'rgba(46,139,139,0.15)' : 'transparent',
                            color: inAllocation ? '#2E8B8B' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: inAllocation ? 'default' : 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {inAllocation ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          )}
                        </button>
                      )}
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      <StockDetailPanel
        stock={selectedStock}
        open={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          setSelectedStock(null);
        }}
      />
    </>
  );
}

export default StockList;
