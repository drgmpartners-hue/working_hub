'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface RetirementDataPoint {
  age: number;
  amount: number;
}

interface RetirementGrowthChartProps {
  data: RetirementDataPoint[];
  retirementAge?: number;
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
  payload?: Array<{ value: number }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const amount = payload[0].value;
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
      <div style={{ color: '#6B7280', marginBottom: '4px' }}>{label}세</div>
      <div style={{ color: '#1E3A5F', fontWeight: 700 }}>
        {amount.toLocaleString('ko-KR')} 만원
      </div>
    </div>
  );
}

export default function RetirementGrowthChart({
  data,
  retirementAge,
}: RetirementGrowthChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="retirementNavyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.03} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke="#F0F0F0" strokeDasharray="0" />

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

        {/* 은퇴나이 세로 점선 */}
        {retirementAge != null && (
          <ReferenceLine
            x={retirementAge}
            stroke="#EF4444"
            strokeDasharray="6 4"
            strokeWidth={2}
            label={{
              value: `은퇴 ${retirementAge}세`,
              position: 'top',
              fontSize: 11,
              fill: '#EF4444',
            }}
          />
        )}

        <Area
          type="monotone"
          dataKey="amount"
          stroke="#1E3A5F"
          strokeWidth={2}
          fill="url(#retirementNavyGradient)"
          dot={false}
          activeDot={{ r: 5, fill: '#1E3A5F', stroke: '#ffffff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
