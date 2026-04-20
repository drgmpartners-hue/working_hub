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

interface GrowthDataPoint {
  age: number;
  amount: number;
  principal?: number;
  phase: 'saving' | 'holding' | 'retirement';
}

interface GrowthChartProps {
  data: GrowthDataPoint[];
  retirementAge?: number;
}

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(0)}억`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}천만`;
  if (Math.abs(value) >= 100) return `${value}만`;
  return `${value}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const evalVal = payload.find(p => ['savingAmount', 'holdingAmount', 'retirementAmount'].includes(p.dataKey))?.value ?? 0;
  const principalVal = payload.find(p => p.dataKey === 'principal')?.value ?? 0;
  const phase = payload.find(p => p.dataKey === 'savingAmount')
    ? '적립기간'
    : payload.find(p => p.dataKey === 'holdingAmount')
    ? '거치기간'
    : '은퇴후';
  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.10)', fontSize: 13 }}>
      <div style={{ color: '#6B7280', marginBottom: 4 }}>{label}세 ({phase})</div>
      <div style={{ color: '#1E3A5F', fontWeight: 700 }}>총평가: {evalVal.toLocaleString('ko-KR')}만원</div>
      {principalVal > 0 && (
        <div style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>누적원금: {principalVal.toLocaleString('ko-KR')}만원</div>
      )}
    </div>
  );
}

export default function GrowthChart({ data, retirementAge }: GrowthChartProps) {
  const chartData = data.map((d) => ({
    age: d.age,
    savingAmount: d.phase === 'saving' ? d.amount : undefined,
    holdingAmount: d.phase === 'holding' ? d.amount : undefined,
    retirementAmount: d.phase === 'retirement' ? d.amount : undefined,
    principal: d.principal ?? 0,
    amount: d.amount,
  }));

  // 구간 전환점 연결
  for (let i = 1; i < chartData.length; i++) {
    if (chartData[i].holdingAmount !== undefined && chartData[i - 1].savingAmount !== undefined) {
      chartData[i - 1].holdingAmount = chartData[i - 1].savingAmount;
    }
    if (chartData[i].retirementAmount !== undefined && chartData[i - 1].holdingAmount !== undefined) {
      chartData[i - 1].retirementAmount = chartData[i - 1].holdingAmount;
    }
    if (chartData[i].retirementAmount !== undefined && chartData[i - 1].savingAmount !== undefined && chartData[i - 1].holdingAmount === undefined) {
      chartData[i - 1].retirementAmount = chartData[i - 1].savingAmount;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
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
          <linearGradient id="retirementGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#16A34A" stopOpacity={0.20} />
            <stop offset="95%" stopColor="#16A34A" stopOpacity={0.03} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke="#F0F0F0" />

        <XAxis
          dataKey="age"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickFormatter={(v) => `${v}세`}
          interval="preserveStartEnd"
        />

        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickFormatter={formatYAxis}
          width={56}
        />

        <Tooltip content={<CustomTooltip />} />

        {/* 누적원금 라인 */}
        <Line
          type="monotone"
          dataKey="principal"
          stroke="#9CA3AF"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          connectNulls
          name="누적원금"
        />

        {/* 적립기간 */}
        <Area
          type="monotone"
          dataKey="savingAmount"
          stroke="#1E3A5F"
          strokeWidth={2}
          fill="url(#savingGradient)"
          dot={false}
          connectNulls={false}
          activeDot={{ r: 4, fill: '#1E3A5F', stroke: '#fff', strokeWidth: 2 }}
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
          activeDot={{ r: 4, fill: '#D4A847', stroke: '#fff', strokeWidth: 2 }}
        />

        {/* 은퇴후 */}
        <Area
          type="monotone"
          dataKey="retirementAmount"
          stroke="#16A34A"
          strokeWidth={2}
          fill="url(#retirementGradient)"
          dot={false}
          connectNulls={false}
          activeDot={{ r: 4, fill: '#16A34A', stroke: '#fff', strokeWidth: 2 }}
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
