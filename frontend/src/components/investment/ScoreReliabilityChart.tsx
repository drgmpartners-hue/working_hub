'use client';

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface PerformanceRecord {
  id: number;
  stock_code: string;
  stock_name: string;
  theme: string;
  recommended_date: string;
  recommended_price: number;
  current_price: number;
  return_since: number;
  benchmark_return: number;
  excess_return: number;
  holding_days: number;
  status: 'success' | 'failure' | 'holding';
  composite_score_at_rec: number;
}

interface ScoreReliabilityChartProps {
  records: PerformanceRecord[];
  loading?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  success: '#059669',
  failure: '#DC2626',
  holding: '#D97706',
};

const STATUS_LABEL: Record<string, string> = {
  success: '성공',
  failure: '실패',
  holding: '보유중',
};

export function ScoreReliabilityChart({ records, loading }: ScoreReliabilityChartProps) {
  if (loading) {
    return (
      <div
        style={{
          height: 220,
          borderRadius: 10,
          backgroundColor: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            border: '2px solid var(--border)',
            borderTopColor: '#2E8B8B',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div
        style={{
          height: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.8125rem',
        }}
      >
        성과 데이터가 없습니다.
      </div>
    );
  }

  // Group by status for multiple scatter series
  const grouped = records.reduce<Record<string, Array<{ x: number; y: number; name: string }>>>(
    (acc, r) => {
      const key = r.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push({ x: r.composite_score_at_rec, y: r.return_since, name: r.stock_name });
      return acc;
    },
    {}
  );

  return (
    <div
      style={{
        padding: '16px',
        borderRadius: 10,
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
          종합점수 신뢰도
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          추천 시 종합점수 vs 추천 이후 수익률 (높은 점수 → 높은 수익 상관 검증)
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: STATUS_COLOR[key],
              }}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
          <XAxis
            type="number"
            dataKey="x"
            name="종합점수"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={false}
            label={{ value: '종합점수', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: 'var(--text-muted)' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="수익률"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const d = payload[0]?.payload as { x: number; y: number; name: string };
              return (
                <div
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{d.name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>종합점수: {d.x}</div>
                  <div style={{ color: d.y >= 0 ? '#059669' : '#DC2626' }}>
                    수익률: {d.y > 0 ? '+' : ''}{d.y.toFixed(2)}%
                  </div>
                </div>
              );
            }}
          />
          {Object.entries(grouped).map(([status, data]) => (
            <Scatter
              key={status}
              name={STATUS_LABEL[status]}
              data={data}
              fill={STATUS_COLOR[status]}
              opacity={0.75}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ScoreReliabilityChart;
