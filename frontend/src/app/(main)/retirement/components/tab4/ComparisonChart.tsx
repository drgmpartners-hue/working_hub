'use client';

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface ChartDataPoint {
  age: number;
  plan?: number;
  actual?: number;
  projected?: number;
  gap?: number;
}

interface ComparisonChartProps {
  data: ChartDataPoint[];
  currentAge?: number;
}

function formatYAxis(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(0)}억`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}천`;
  return `${value}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const labelMap: Record<string, string> = {
    plan: '계획',
    actual: '실제',
    projected: '수정예측',
    gap: '괴리',
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        fontSize: '13px',
        minWidth: '140px',
      }}
    >
      <div style={{ color: '#6B7280', marginBottom: '6px', fontWeight: 600 }}>{label}세</div>
      {payload.map((entry) => {
        if (entry.value == null || entry.value === 0) return null;
        return (
          <div
            key={entry.dataKey}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              color: entry.color,
              marginBottom: '2px',
            }}
          >
            <span>{labelMap[entry.dataKey] ?? entry.name}</span>
            <span style={{ fontWeight: 700 }}>
              {entry.value.toLocaleString('ko-KR')} 만원
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CustomLegend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: '20px',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: '8px',
        fontSize: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#1E3A5F',
          }}
        />
        <span style={{ color: '#374151' }}>계획</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#2E8B8B',
          }}
        />
        <span style={{ color: '#374151' }}>실제</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#2E8B8B',
            backgroundImage:
              'repeating-linear-gradient(90deg, #2E8B8B 0, #2E8B8B 5px, transparent 5px, transparent 10px)',
            backgroundClip: 'content-box',
          }}
        />
        <span style={{ color: '#374151' }}>수정예측</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '16px',
            height: '12px',
            backgroundColor: 'rgba(245,158,11,0.35)',
            border: '1px solid rgba(245,158,11,0.6)',
            borderRadius: '2px',
          }}
        />
        <span style={{ color: '#374151' }}>괴리영역</span>
      </div>
    </div>
  );
}

export default function ComparisonChart({ data, currentAge }: ComparisonChartProps) {
  return (
    <div>
      <CustomLegend />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="planGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gapGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.15} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="#F0F0F0" />

          <XAxis
            dataKey="age"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#9CA3AF' }}
            tickFormatter={(v) => `${v}세`}
            interval="preserveStartEnd"
          />

          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#9CA3AF' }}
            tickFormatter={formatYAxis}
            width={52}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* 현재 나이 기준선 */}
          {currentAge != null && (
            <ReferenceLine
              x={currentAge}
              stroke="#6B7280"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: '현재',
                position: 'top',
                fontSize: 11,
                fill: '#6B7280',
              }}
            />
          )}

          {/* 괴리 영역 */}
          <Area
            type="monotone"
            dataKey="gap"
            stroke="transparent"
            fill="url(#gapGradient)"
            dot={false}
            activeDot={false}
            legendType="none"
          />

          {/* 계획 그래프 - Navy 실선 */}
          <Area
            type="monotone"
            dataKey="plan"
            stroke="#1E3A5F"
            strokeWidth={2}
            fill="url(#planGradient)"
            dot={false}
            activeDot={{ r: 4, fill: '#1E3A5F', stroke: '#ffffff', strokeWidth: 2 }}
            legendType="none"
          />

          {/* 실제 그래프 - Teal 실선 */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#2E8B8B"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: '#2E8B8B', stroke: '#ffffff', strokeWidth: 2 }}
            legendType="none"
          />

          {/* 수정 예측 - Teal 점선 */}
          <Line
            type="monotone"
            dataKey="projected"
            stroke="#2E8B8B"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 4, fill: '#2E8B8B', stroke: '#ffffff', strokeWidth: 2 }}
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
