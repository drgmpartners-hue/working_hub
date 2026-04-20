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
  phase?: 'saving' | 'holding' | string;
  principal?: number;
}

interface RetirementGrowthChartProps {
  data: RetirementDataPoint[];
  retirementAge?: number;
}

function formatYAxis(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000000) return `${(value / 10000000).toFixed(0)}천만`;
  if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
  return `${value.toLocaleString()}`;
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
  const saving = payload.find(p => p.dataKey === 'saving');
  const holding = payload.find(p => p.dataKey === 'holding');
  const val = saving?.value || holding?.value || 0;
  const phase = saving?.value ? '적립' : '거치';
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
      <div style={{ color: '#6B7280', marginBottom: '4px' }}>{label}세 ({phase})</div>
      <div style={{ color: '#1E3A5F', fontWeight: 700 }}>
        {val >= 100000000
          ? `${(val / 100000000).toFixed(2)}억원`
          : `${Math.round(val / 10000).toLocaleString('ko-KR')}만원`}
      </div>
    </div>
  );
}

export default function RetirementGrowthChart({
  data,
  retirementAge,
}: RetirementGrowthChartProps) {
  // phase별로 saving/holding 데이터 분리
  const chartData = data.map((d) => ({
    age: d.age,
    saving: d.phase === 'saving' ? d.amount : undefined,
    holding: d.phase === 'holding' || d.phase !== 'saving' ? d.amount : undefined,
    amount: d.amount,
    principal: d.principal ?? 0,
  }));

  // 적립 마지막 인덱스 찾기
  const lastSavingIdx = data.reduce((acc, d, i) => d.phase === 'saving' ? i : acc, -1);
  if (lastSavingIdx >= 0 && lastSavingIdx < chartData.length - 1) {
    // 전환점: 적립 마지막 행에 holding 값도 넣어서 연결
    chartData[lastSavingIdx].holding = chartData[lastSavingIdx].amount;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="savingGradient3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1E3A5F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#1E3A5F" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="holdingGradient3" x1="0" y1="0" x2="0" y2="1">
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
          width={60}
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

        {/* 누적원금 - 회색 점선 */}
        <Area
          type="monotone"
          dataKey="principal"
          stroke="#9CA3AF"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="none"
          dot={false}
          activeDot={{ r: 3, fill: '#9CA3AF' }}
        />

        {/* 적립 구간 - Navy */}
        <Area
          type="monotone"
          dataKey="saving"
          stroke="#1E3A5F"
          strokeWidth={2}
          fill="url(#savingGradient3)"
          dot={false}
          activeDot={{ r: 5, fill: '#1E3A5F', stroke: '#fff', strokeWidth: 2 }}
          connectNulls={false}
        />

        {/* 거치 구간 - Gold */}
        <Area
          type="monotone"
          dataKey="holding"
          stroke="#D4A847"
          strokeWidth={2}
          fill="url(#holdingGradient3)"
          dot={false}
          activeDot={{ r: 5, fill: '#D4A847', stroke: '#fff', strokeWidth: 2 }}
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
