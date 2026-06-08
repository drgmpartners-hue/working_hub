'use client';

/**
 * StockDetailPanel — 우측 슬라이드 사이드패널
 * 기존 StockAnalysisPopup(Modal)을 진화.
 * 기존 표시(테마/섹터 뱃지, 수익률, 시총, AI 리포트, 담기) 유지 +
 * 신규: 가격차트+이평선, 밸류(PBR/PER/EPS/ROE/배당), 시그널 배지, 종합점수+breakdown, 백테스트
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/common/Button';
import { SignalBadge } from './SignalBadge';
import { BacktestChart } from './BacktestChart';
import type { BacktestData } from './BacktestChart';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface StockItem {
  id: number;
  stock_name: string;
  stock_code: string;
  theme: string;
  rank: number;
  return_1m: number;
  return_3m: number;
  return_6m: number;
  is_top5: boolean;
  analysis_report?: string;
  market_cap?: number;
  sector?: string;
  pbr?: number;
  per?: number;
  composite_score?: number;
  signal_tags?: string[];
  ma_alignment?: string;
  allocation_pct?: number;
}

interface SignalApiData {
  ma5?: number;
  ma20?: number;
  ma60?: number;
  ma120?: number;
  signals?: {
    golden_cross?: boolean;
    dead_cross?: boolean;
    ma_alignment?: boolean | 'bullish' | 'bearish' | 'neutral';
    disparity?: number;
  };
  composite_score?: number;
  score_breakdown?: Record<string, number>;
  roe?: number;
  per?: number;
  pbr?: number;
  eps?: number;
  dividend_yield?: number;
  price_history?: Array<{ date: string; close: number; volume?: number }>;
}

type BacktestPeriod = '1m' | '3m' | '6m' | '1y' | '3y';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.75rem',
        fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 3,
          height: 12,
          borderRadius: 2,
          backgroundColor: '#2E8B8B',
        }}
      />
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: 'var(--border)', margin: '14px 0' }} />;
}

function StatItem({
  label,
  value,
  suffix = '',
  highlight,
}: {
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
  highlight?: 'positive' | 'negative' | 'neutral';
}) {
  const color =
    highlight === 'positive'
      ? '#059669'
      : highlight === 'negative'
      ? '#DC2626'
      : 'var(--text-primary)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color, fontFamily: 'monospace' }}>
        {value != null ? `${value}${suffix}` : '-'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

interface StockDetailPanelProps {
  stock: StockItem | null;
  open: boolean;
  onClose: () => void;
}

export function StockDetailPanel({ stock, open, onClose }: StockDetailPanelProps) {
  const [signals, setSignals] = useState<SignalApiData | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);

  const [backtestData, setBacktestData] = useState<BacktestData | null>(null);
  const [backtestPeriod, setBacktestPeriod] = useState<BacktestPeriod>('1y');
  const [backtestLoading, setBacktestLoading] = useState(false);

  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const [addingPool, setAddingPool] = useState(false);
  const [portfolioSuccess, setPortfolioSuccess] = useState(false);
  const [poolSuccess, setPoolSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* fetch signals */
  const fetchSignals = useCallback(async (code: string) => {
    setSignalLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/market/stocks/${code}/signals`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const data = await res.json();
        setSignals(data);
      }
    } catch {
      // silent — signals section will show placeholder
    } finally {
      setSignalLoading(false);
    }
  }, []);

  /* fetch backtest */
  const fetchBacktest = useCallback(async (code: string, period: BacktestPeriod) => {
    setBacktestLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/market/stocks/${code}/backtest?period=${period}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (res.ok) {
        const data = await res.json();
        setBacktestData(data);
      }
    } catch {
      // silent
    } finally {
      setBacktestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !stock) return;
    setSignals(null);
    setBacktestData(null);
    fetchSignals(stock.stock_code);
    fetchBacktest(stock.stock_code, backtestPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stock?.stock_code]);

  useEffect(() => {
    if (!open || !stock) return;
    fetchBacktest(stock.stock_code, backtestPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestPeriod]);

  /* actions */
  async function addToPortfolio() {
    if (!stock) return;
    setAddingPortfolio(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ stock_code: stock.stock_code, stock_name: stock.stock_name, source: 'stock_recommend' }),
      });
      if (!res.ok) throw new Error('포트폴리오 추가에 실패했습니다.');
      setPortfolioSuccess(true);
      setTimeout(() => setPortfolioSuccess(false), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setAddingPortfolio(false);
    }
  }

  async function addToPool() {
    if (!stock) return;
    setAddingPool(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ stock_code: stock.stock_code, stock_name: stock.stock_name, theme: stock.theme }),
      });
      if (!res.ok) throw new Error('회사풀 추가에 실패했습니다.');
      setPoolSuccess(true);
      setTimeout(() => setPoolSuccess(false), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setAddingPool(false);
    }
  }

  /* derived values — prefer signals API, fallback to stock prop */
  const composite_score = signals?.composite_score ?? stock?.composite_score;
  const pbr = signals?.pbr ?? stock?.pbr;
  const per = signals?.per ?? stock?.per;
  const roe = signals?.roe;
  const eps = signals?.eps;
  const dividend_yield = signals?.dividend_yield;
  const score_breakdown = signals?.score_breakdown;
  const signalData = signals?.signals ?? {};
  const priceHistory = signals?.price_history ?? [];

  /* MA line data for chart — merge price_history with ma values (mock series) */
  const chartData = priceHistory.map((p) => ({ date: p.date, 종가: p.close }));

  /* esc key to close */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!stock) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          zIndex: 400,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: '95vw',
          zIndex: 401,
          backgroundColor: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: open ? '-4px 0 32px rgba(0,0,0,0.18)' : 'none',
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.0625rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.3px',
                }}
              >
                {stock.stock_name}
              </h2>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg-surface)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {stock.stock_code}
              </span>
              {stock.is_top5 && (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: '0.75rem',
                    color: '#D97706',
                    fontWeight: 700,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="#D97706">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  TOP5
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 5,
                  fontSize: '0.75rem',
                  backgroundColor: 'rgba(46,139,139,0.12)',
                  color: '#2E8B8B',
                  fontWeight: 600,
                }}
              >
                {stock.theme}
              </span>
              {stock.sector && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 5,
                    fontSize: '0.75rem',
                    backgroundColor: 'rgba(30,58,95,0.10)',
                    color: '#1E3A5F',
                    fontWeight: 500,
                  }}
                >
                  {stock.sector}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 7,
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-surface)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ---- Scrollable body ---- */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* 1. 수익률 */}
          <SectionTitle>수익률</SectionTitle>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[
              { label: '1개월', value: stock.return_1m },
              { label: '3개월', value: stock.return_3m },
              { label: '6개월', value: stock.return_6m },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  borderRadius: 8,
                  textAlign: 'center',
                  backgroundColor:
                    value > 0
                      ? 'rgba(5,150,105,0.08)'
                      : value < 0
                      ? 'rgba(220,38,38,0.08)'
                      : 'var(--bg-surface)',
                }}
              >
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
                <div
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: value > 0 ? '#059669' : value < 0 ? '#DC2626' : 'var(--text-muted)',
                  }}
                >
                  {value > 0 ? '+' : ''}{value.toFixed(2)}%
                </div>
              </div>
            ))}
          </div>

          {/* 2. 시가총액 */}
          {stock.market_cap != null && (
            <>
              <StatItem
                label="시가총액"
                value={`${(stock.market_cap / 1e8).toFixed(0)}억원`}
              />
              <Divider />
            </>
          )}

          {/* 3. 가격 차트 + 이평선 */}
          <SectionTitle>가격 차트 + 이동평균선</SectionTitle>
          {signalLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0', marginBottom: 14 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: '2px solid var(--border)',
                  borderTopColor: '#2E8B8B',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            </div>
          ) : chartData.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`}
                  />
                  <Tooltip
                    labelStyle={{ fontSize: 10 }}
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="종가" stroke="#2E8B8B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              {/* MA values */}
              {(signals?.ma5 || signals?.ma20 || signals?.ma60 || signals?.ma120) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {[
                    { label: 'MA5', value: signals?.ma5, color: '#EF4444' },
                    { label: 'MA20', value: signals?.ma20, color: '#F59E0B' },
                    { label: 'MA60', value: signals?.ma60, color: '#3B82F6' },
                    { label: 'MA120', value: signals?.ma120, color: '#8B5CF6' },
                  ].map(({ label, value, color }) =>
                    value != null ? (
                      <span
                        key={label}
                        style={{
                          fontSize: '0.6875rem',
                          color,
                          fontWeight: 600,
                          fontFamily: 'monospace',
                        }}
                      >
                        {label}: {value.toLocaleString()}
                      </span>
                    ) : null
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.8125rem',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 8,
                marginBottom: 14,
              }}
            >
              차트 데이터 준비 중
            </div>
          )}

          <Divider />

          {/* 4. 밸류에이션 */}
          <SectionTitle>밸류에이션</SectionTitle>
          <div style={{ marginBottom: 14 }}>
            <StatItem label="PBR" value={pbr?.toFixed(2)} suffix="배" />
            <StatItem label="PER" value={per?.toFixed(1)} suffix="배" />
            {eps != null && <StatItem label="EPS" value={eps.toLocaleString()} suffix="원" />}
            {roe != null && (
              <StatItem
                label="ROE"
                value={roe.toFixed(1)}
                suffix="%"
                highlight={roe > 10 ? 'positive' : roe < 0 ? 'negative' : 'neutral'}
              />
            )}
            {dividend_yield != null && (
              <StatItem label="배당수익률" value={dividend_yield.toFixed(2)} suffix="%" />
            )}
          </div>

          <Divider />

          {/* 5. 시그널 */}
          <SectionTitle>시그널 자동 해석</SectionTitle>
          <div style={{ marginBottom: 14 }}>
            {signalLoading ? (
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>로딩 중...</span>
            ) : (
              <SignalBadge signal={signalData} />
            )}
          </div>

          <Divider />

          {/* 6. 종합점수 */}
          <SectionTitle>종합점수</SectionTitle>
          <div style={{ marginBottom: 14 }}>
            {composite_score != null ? (
              <>
                {/* Score bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: 'var(--bg-surface)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${composite_score}%`,
                        borderRadius: 4,
                        backgroundColor:
                          composite_score >= 70
                            ? '#059669'
                            : composite_score >= 50
                            ? '#D97706'
                            : '#DC2626',
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      color:
                        composite_score >= 70
                          ? '#059669'
                          : composite_score >= 50
                          ? '#D97706'
                          : '#DC2626',
                      minWidth: 36,
                      textAlign: 'right',
                    }}
                  >
                    {composite_score}
                  </span>
                </div>

                {/* Score breakdown */}
                {score_breakdown && Object.keys(score_breakdown).length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                      gap: 6,
                    }}
                  >
                    {Object.entries(score_breakdown).map(([key, val]) => (
                      <div
                        key={key}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          backgroundColor: 'var(--bg-surface)',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                          {key}
                        </div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {typeof val === 'number' ? val.toFixed(1) : val}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-surface)',
                  fontSize: '0.8125rem',
                  color: 'var(--text-muted)',
                }}
              >
                {signalLoading ? '로딩 중...' : '종합점수 데이터 준비 중'}
              </div>
            )}
          </div>

          <Divider />

          {/* 7. AI 분석 리포트 */}
          {stock.analysis_report && (
            <>
              <SectionTitle>AI 분석 리포트</SectionTitle>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  marginBottom: 14,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    color: 'var(--text-primary)',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {stock.analysis_report}
                </p>
              </div>
              <Divider />
            </>
          )}

          {/* 8. 백테스트 */}
          <SectionTitle>백테스트 — "이 시점에 담았다면?"</SectionTitle>
          <div style={{ marginBottom: 14 }}>
            <BacktestChart
              data={backtestData}
              period={backtestPeriod}
              onPeriodChange={(p) => setBacktestPeriod(p)}
              loading={backtestLoading}
            />
          </div>
        </div>

        {/* ---- Footer actions ---- */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {actionError && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.25)',
                color: '#DC2626',
                fontSize: '0.8125rem',
              }}
            >
              {actionError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="md"
              loading={addingPortfolio}
              onClick={addToPortfolio}
              style={{ flex: 1, backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' }}
            >
              {portfolioSuccess ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  포트폴리오 추가됨
                </span>
              ) : '포트폴리오 담기'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={addingPool}
              onClick={addToPool}
              style={{ flex: 1, borderColor: '#2E8B8B', color: '#2E8B8B' }}
            >
              {poolSuccess ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  회사풀 추가됨
                </span>
              ) : '회사풀 담기'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default StockDetailPanel;
