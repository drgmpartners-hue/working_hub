'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface BacktestData {
  return_rate: number;
  benchmark_return: number;
  max_drawdown: number;
  chart_data: Array<{ date: string; return: number; benchmark: number }>;
}

type BacktestPeriod = '1m' | '3m' | '6m' | '1y' | '3y';

const PERIOD_LABELS: Record<BacktestPeriod, string> = {
  '1m': '1개월',
  '3m': '3개월',
  '6m': '6개월',
  '1y': '1년',
  '3y': '3년',
};

interface BacktestChartProps {
  data: BacktestData | null;
  period: BacktestPeriod;
  onPeriodChange: (p: BacktestPeriod) => void;
  loading?: boolean;
}

export function BacktestChart({ data, period, onPeriodChange, loading }: BacktestChartProps) {
  return (
    <div>
      {/* Period tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(Object.keys(PERIOD_LABELS) as BacktestPeriod[]).map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid',
              borderColor: period === p ? '#2E8B8B' : 'var(--border)',
              backgroundColor: period === p ? 'rgba(46,139,139,0.12)' : 'transparent',
              color: period === p ? '#2E8B8B' : 'var(--text-muted)',
              fontSize: '0.75rem',
              fontWeight: period === p ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <div
            style={{
              width: 22,
              height: 22,
              border: '2px solid var(--border)',
              borderTopColor: '#2E8B8B',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        </div>
      ) : data ? (
        <>
          {/* Summary stats */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {[
              { label: '수익률', value: data.return_rate, pct: true },
              { label: '벤치마크', value: data.benchmark_return, pct: true },
              { label: '초과수익', value: data.return_rate - data.benchmark_return, pct: true },
              { label: '최대낙폭', value: data.max_drawdown, pct: true, negative: true },
            ].map(({ label, value, pct, negative }) => {
              const isPositive = negative ? false : value > 0;
              const isNegative = negative ? true : value < 0;
              return (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 8,
                    backgroundColor: isPositive
                      ? 'rgba(5,150,105,0.08)'
                      : isNegative
                      ? 'rgba(220,38,38,0.08)'
                      : 'var(--bg-surface)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: isPositive ? '#059669' : isNegative ? '#DC2626' : 'var(--text-primary)',
                    }}
                  >
                    {!negative && value > 0 ? '+' : ''}{pct ? `${value.toFixed(2)}%` : value}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chart */}
          {data.chart_data && data.chart_data.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={data.chart_data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v) => {
                    const n = typeof v === 'number' ? v : 0;
                    return [`${n > 0 ? '+' : ''}${n.toFixed(2)}%`];
                  }}
                  labelStyle={{ fontSize: 11 }}
                  contentStyle={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="return"
                  name="수익률"
                  stroke="#2E8B8B"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  name="벤치마크"
                  stroke="#D97706"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              차트 데이터 없음
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          백테스트 데이터를 불러올 수 없습니다.
        </div>
      )}
    </div>
  );
}

export default BacktestChart;
