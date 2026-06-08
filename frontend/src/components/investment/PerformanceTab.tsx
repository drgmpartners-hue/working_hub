'use client';

import { useState, useEffect, useCallback } from 'react';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';
import { PerformanceSummary } from './PerformanceSummary';
import { ScoreReliabilityChart } from './ScoreReliabilityChart';
import { StockDetailPanel } from './StockDetailPanel';
import type { PerformanceSummaryData } from './PerformanceSummary';
import type { PerformanceRecord } from './ScoreReliabilityChart';
import type { StockItem } from './StockDetailPanel';

/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<string, string> = {
  success: '성공',
  failure: '실패',
  holding: '보유중',
};

const STATUS_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  success: { bg: 'rgba(5,150,105,0.10)', color: '#059669', border: 'rgba(5,150,105,0.25)' },
  failure: { bg: 'rgba(220,38,38,0.10)', color: '#DC2626', border: 'rgba(220,38,38,0.25)' },
  holding: { bg: 'rgba(217,119,6,0.10)', color: '#D97706', border: 'rgba(217,119,6,0.25)' },
};

function ReturnCell({ value }: { value: number }) {
  return (
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
}

/* ------------------------------------------------------------------ */

export function PerformanceTab() {
  const [summary, setSummary] = useState<PerformanceSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [records, setRecords] = useState<PerformanceRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  /* Filters */
  const [filterTheme, setFilterTheme] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');

  /* Detail panel */
  const [panelStock, setPanelStock] = useState<StockItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  /* fetch summary */
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/performance/summary`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch {
      // silent
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  /* fetch records */
  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTheme) params.set('theme', filterTheme);
      if (filterStatus) params.set('status', filterStatus);
      if (filterPeriod) params.set('period', filterPeriod);
      const res = await fetch(
        `${API_URL}/api/v1/stocks/performance?${params.toString()}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data) ? data : data.records ?? []);
      }
    } catch {
      // silent
    } finally {
      setRecordsLoading(false);
    }
  }, [filterTheme, filterStatus, filterPeriod]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  function openPanel(record: PerformanceRecord) {
    setPanelStock({
      id: record.id,
      stock_name: record.stock_name,
      stock_code: record.stock_code,
      theme: record.theme,
      rank: 0,
      return_1m: 0,
      return_3m: 0,
      return_6m: record.return_since,
      is_top5: false,
    });
    setPanelOpen(true);
  }

  /* unique themes for filter */
  const themes = Array.from(new Set(records.map((r) => r.theme))).filter(Boolean);

  return (
    <div>
      {/* Summary */}
      <PerformanceSummary data={summary} loading={summaryLoading} />

      {/* Filters */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2" strokeLinecap="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>필터</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>테마</label>
          <select
            value={filterTheme}
            onChange={(e) => setFilterTheme(e.target.value)}
            style={{
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">전체</option>
            {themes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>상태</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">전체</option>
            <option value="success">성공</option>
            <option value="failure">실패</option>
            <option value="holding">보유중</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>기간</label>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            style={{
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">전체</option>
            <option value="1m">1개월</option>
            <option value="3m">3개월</option>
            <option value="6m">6개월</option>
            <option value="1y">1년</option>
          </select>
        </div>

        {(filterTheme || filterStatus || filterPeriod) && (
          <button
            onClick={() => { setFilterTheme(''); setFilterStatus(''); setFilterPeriod(''); }}
            style={{
              padding: '5px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            초기화
          </button>
        )}
      </div>

      {/* Table */}
      {recordsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <div
            style={{
              width: 26,
              height: 26,
              border: '2px solid var(--border)',
              borderTopColor: '#2E8B8B',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        </div>
      ) : records.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          성과 데이터가 없습니다.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                {[
                  '종목명', '테마', '추천일', '추천가', '현재가',
                  '수익률', '초과수익', '보유일', '상태', '추천점수',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const sc = STATUS_COLOR[r.status] ?? STATUS_COLOR.holding;
                return (
                  <tr
                    key={r.id}
                    onClick={() => openPanel(r)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background-color 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        'rgba(46,139,139,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {r.stock_name}
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 400 }}>
                        {r.stock_code}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          backgroundColor: 'rgba(46,139,139,0.10)',
                          color: '#2E8B8B',
                          fontWeight: 500,
                        }}
                      >
                        {r.theme}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {r.recommended_date}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                      {r.recommended_price.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                      {r.current_price.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <ReturnCell value={r.return_since} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <ReturnCell value={r.excess_return} />
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {r.holding_days}일
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 5,
                          fontSize: '0.75rem',
                          backgroundColor: sc.bg,
                          color: sc.color,
                          border: `1px solid ${sc.border}`,
                          fontWeight: 600,
                        }}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color:
                            r.composite_score_at_rec >= 70
                              ? '#059669'
                              : r.composite_score_at_rec >= 50
                              ? '#D97706'
                              : '#DC2626',
                        }}
                      >
                        {r.composite_score_at_rec}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Score reliability chart */}
      {records.length > 0 && (
        <ScoreReliabilityChart records={records} loading={recordsLoading} />
      )}

      {/* Detail panel */}
      <StockDetailPanel
        stock={panelStock}
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setPanelStock(null); }}
      />
    </div>
  );
}

export default PerformanceTab;
