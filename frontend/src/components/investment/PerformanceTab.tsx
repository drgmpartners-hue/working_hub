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

interface CalibrationReport {
  sample_codes: number;
  pairs: number;
  horizon: number;
  r_momentum: number | null;
  momentum_factor: number;
  current_weights: Record<string, Record<string, number>>;
  proposed_weights: Record<string, Record<string, number>>;
  matured_snapshots?: number;
  snapshot_correlations?: Record<string, number>;
  data_source: string;
  note: string;
  applied: boolean;
}

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

  /* 가중치 보정 */
  const [calib, setCalib] = useState<CalibrationReport | null>(null);
  const [calibLoading, setCalibLoading] = useState(false);

  /* 리포트 이메일 설정 */
  const [reportEnabled, setReportEnabled] = useState(false);
  const [reportRecipient, setReportRecipient] = useState('');
  const [reportMsg, setReportMsg] = useState('');

  const fetchReportSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/settings`, { headers: { ...authLib.getAuthHeader() } });
      if (res.ok) {
        const d = await res.json();
        setReportEnabled(!!d.email_enabled);
        setReportRecipient(d.recipient || '');
      }
    } catch { /* silent */ }
  }, []);

  const saveReportSettings = useCallback(async (enabled: boolean) => {
    setReportMsg('');
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ email_enabled: enabled, recipient: reportRecipient || null }),
      });
      if (res.ok) { setReportEnabled(enabled); setReportMsg(enabled ? '자동 발송 ON' : '자동 발송 OFF'); }
    } catch { setReportMsg('저장 실패'); }
  }, [reportRecipient]);

  const previewReport = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/preview`, { headers: { ...authLib.getAuthHeader() } });
      const html = await res.text();
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); }
    } catch { setReportMsg('미리보기 실패'); }
  }, []);

  const sendReportNow = useCallback(async () => {
    setReportMsg('발송 중...');
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/send`, { method: 'POST', headers: { ...authLib.getAuthHeader() } });
      setReportMsg(res.ok ? '발송 요청 완료 (메일 미설정 시 서버 로그만)' : '발송 실패');
    } catch { setReportMsg('발송 실패'); }
  }, []);

  const runCalibration = useCallback(async (apply: boolean) => {
    setCalibLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/calibration/${apply ? 'apply' : 'report'}`, {
        method: apply ? 'POST' : 'GET',
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) setCalib(await res.json());
    } catch {
      /* silent */
    } finally {
      setCalibLoading(false);
    }
  }, []);

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

  useEffect(() => {
    fetchReportSettings();
  }, [fetchReportSettings]);

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

      {/* 사후검증 가중치 보정 */}
      <div
        style={{
          padding: '14px 16px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              사후검증 가중치 보정
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              과거 모멘텀 점수가 이후 수익을 예측했는지 검증 → 가중치를 데이터로 조정
            </p>
          </div>
          <button
            onClick={() => runCalibration(false)}
            disabled={calibLoading}
            style={{ height: 32, padding: '0 12px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: calibLoading ? 'default' : 'pointer' }}
          >
            {calibLoading ? '검증 중...' : '보정 리포트'}
          </button>
          {calib && calib.data_source === 'live' && (
            <button
              onClick={() => runCalibration(true)}
              disabled={calibLoading}
              style={{ height: 32, padding: '0 12px', borderRadius: 6, border: 'none', backgroundColor: '#2E8B8B', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: calibLoading ? 'default' : 'pointer' }}
            >
              {calib.applied ? '✓ 적용됨' : '적용'}
            </button>
          )}
        </div>

        {calib && (
          <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>표본</span>{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{calib.sample_codes}종목 · {calib.pairs}쌍</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>모멘텀 상관계수({calib.horizon}일)</span>{' '}
              <strong style={{ color: (calib.r_momentum ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                {calib.r_momentum != null ? calib.r_momentum.toFixed(3) : 'N/A'}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>모멘텀 가중치</span>{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {(calib.current_weights.neutral?.momentum ?? 0).toFixed(2)} → {(calib.proposed_weights.neutral?.momentum ?? 0).toFixed(2)}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>스냅샷 누적(다축 보정용)</span>{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{calib.matured_snapshots ?? 0}건</strong>
            </div>
            <div style={{ width: '100%', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{calib.note}</div>
          </div>
        )}
      </div>

      {/* 일일 리포트 이메일 */}
      <div style={{ padding: '14px 16px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              일일 분석 리포트 이메일
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              매일 배치 후 테마 랭킹·상승/하락 종목 리포트를 이메일로 발송
            </p>
          </div>
          {/* ON/OFF 토글 (승인) */}
          <button
            onClick={() => saveReportSettings(!reportEnabled)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 14px',
              borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 700,
              backgroundColor: reportEnabled ? 'rgba(5,150,105,0.15)' : 'var(--bg-surface)',
              color: reportEnabled ? '#059669' : 'var(--text-muted)',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: reportEnabled ? '#059669' : '#9CA3AF' }} />
            {reportEnabled ? '자동 발송 ON' : '자동 발송 OFF'}
          </button>
          <button onClick={previewReport} style={{ height: 32, padding: '0 12px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
            미리보기
          </button>
          <button onClick={sendReportNow} style={{ height: 32, padding: '0 12px', borderRadius: 6, border: 'none', backgroundColor: '#2E8B8B', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
            지금 보내기
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>받는 사람</span>
          <input
            type="email"
            value={reportRecipient}
            onChange={(e) => setReportRecipient(e.target.value)}
            onBlur={() => saveReportSettings(reportEnabled)}
            placeholder="email@example.com"
            style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.8125rem', minWidth: 220 }}
          />
          {reportMsg && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{reportMsg}</span>}
        </div>
      </div>

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
