'use client';

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface LifecycleDataPoint {
  age: number;
  accumulation?: number;
  distribution?: number;
  phase: 'accumulation' | 'distribution';
}

interface LifecycleChartProps {
  data: LifecycleDataPoint[];
  retirementAge: number;
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
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        fontSize: '13px',
      }}
    >
      <div style={{ color: '#6B7280', marginBottom: '6px', fontWeight: 600 }}>
        {label}세
      </div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ color: entry.color, fontWeight: 700 }}>
          {entry.name}: {entry.value.toLocaleString('ko-KR')} 만원
        </div>
      ))}
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
        fontSize: '12px',
        marginTop: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '16px',
            height: '12px',
            backgroundColor: 'rgba(30,58,95,0.5)',
            borderRadius: '2px',
          }}
        />
        <span style={{ color: '#374151' }}>모으기 (Navy)</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '16px',
            height: '12px',
            backgroundColor: 'rgba(212,168,71,0.5)',
            borderRadius: '2px',
          }}
        />
        <span style={{ color: '#374151' }}>쓰기 (Gold)</span>
      </div>
    </div>
  );
}

export default function LifecycleChart({ data, retirementAge }: LifecycleChartProps) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="accumulationGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="distributionGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#D4A847" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#D4A847" stopOpacity={0.05} />
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
            width={56}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* 은퇴나이 세로 점선 */}
          <ReferenceLine
            x={retirementAge}
            stroke="#1E3A5F"
            strokeDasharray="6 4"
            strokeWidth={2}
            label={{
              value: `은퇴 ${retirementAge}세`,
              position: 'top',
              fontSize: 11,
              fill: '#1E3A5F',
              fontWeight: 600,
            }}
          />

          {/* 모으기 구간: Navy */}
          <Area
            type="monotone"
            dataKey="accumulation"
            name="모으기"
            stroke="#1E3A5F"
            strokeWidth={2.5}
            fill="url(#accumulationGradient)"
            dot={false}
            activeDot={{ r: 5, fill: '#1E3A5F', stroke: '#ffffff', strokeWidth: 2 }}
            connectNulls={false}
          />

          {/* 쓰기 구간: Gold */}
          <Area
            type="monotone"
            dataKey="distribution"
            name="쓰기"
            stroke="#D4A847"
            strokeWidth={2.5}
            fill="url(#distributionGradient)"
            dot={false}
            activeDot={{ r: 5, fill: '#D4A847', stroke: '#ffffff', strokeWidth: 2 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <CustomLegend />
    </div>
  );
}
