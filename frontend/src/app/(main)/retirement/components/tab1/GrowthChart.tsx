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

interface GrowthDataPoint {
  age: number;
  amount: number;
  phase: 'saving' | 'holding';
}

interface GrowthChartProps {
  data: GrowthDataPoint[];
  retirementAge?: number;
}

function formatYAxis(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(0)}억`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}천만`;
  if (value >= 100) return `${value}만`;
  return `${value}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const amount = payload.find((p) => p.value > 0)?.value ?? 0;
  const point = payload[0];
  const isSaving = point.dataKey === 'savingAmount';
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        fontSize: '13px',
      }}
    >
      <div style={{ color: '#6B7280', marginBottom: '4px' }}>
        {label}세 ({isSaving ? '적립기간' : '거치기간'})
      </div>
      <div style={{ color: '#1E3A5F', fontWeight: 700 }}>
        {amount.toLocaleString('ko-KR')} 만원
      </div>
    </div>
  );
}

export default function GrowthChart({ data, retirementAge }: GrowthChartProps) {
  // 적립/거치 구간을 분리된 dataKey로 변환
  const chartData = data.map((d) => ({
    age: d.age,
    savingAmount: d.phase === 'saving' ? d.amount : undefined,
    holdingAmount: d.phase === 'holding' ? d.amount : undefined,
    // 연결점: 적립 마지막 포인트를 거치에도 포함
    amount: d.amount,
  }));

  // 적립→거치 전환점에서 연결 (거치 첫 포인트에 적립 마지막 값 복사)
  for (let i = 1; i < chartData.length; i++) {
    if (chartData[i].holdingAmount !== undefined && chartData[i - 1].savingAmount !== undefined) {
      chartData[i - 1].holdingAmount = chartData[i - 1].savingAmount;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="savingGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="holdingGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#D4A847" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#D4A847" stopOpacity={0.03} />
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

        {/* 적립기간 */}
        <Area
          type="monotone"
          dataKey="savingAmount"
          stroke="#1E3A5F"
          strokeWidth={2}
          fill="url(#savingGradient)"
          dot={false}
          connectNulls={false}
          activeDot={{ r: 5, fill: '#1E3A5F', stroke: '#fff', strokeWidth: 2 }}
        />

        {/* 거치기간 */}
        <Area
          type="monotone"
          dataKey="holdingAmount"
          stroke="#D4A847"
          strokeWidth={2}
          fill="url(#holdingGradient)"
          dot={false}
          connectNulls={false}
          activeDot={{ r: 5, fill: '#D4A847', stroke: '#fff', strokeWidth: 2 }}
        />

        {/* 은퇴나이 기준선 */}
        {retirementAge && (
          <ReferenceLine
            x={retirementAge}
            stroke="#EF4444"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{
              value: `은퇴 ${retirementAge}세`,
              position: 'top',
              fill: '#EF4444',
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
