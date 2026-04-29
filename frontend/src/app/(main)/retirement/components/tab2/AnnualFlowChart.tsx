'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnnualFlowRow {
  year: number;
  total_contribution: number;
  annual_evaluation: number;
  annual_return: number;
  annual_return_rate: number | null;
  deposit_in: number;
  cumulative_deposit_in: number;
  cumulative_withdrawal: number;
  total_evaluation: number; // 순자산
}

/* ---- 공통 유틸 ---- */

const formatAmount = (value: number) => {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억`;
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(0)}천만`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(0)}만`;
  return `${sign}${abs.toLocaleString()}`;
};

const tooltipFmt = (value: unknown, name: unknown) => {
  const v = Number(value);
  const n = String(name);
  if (n.includes('수익률') || n.includes('증가율')) return [`${v.toFixed(2)}%`, n];
  return [`${v.toLocaleString()}원`, n];
};

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' };

/* ---- 1. 투자흐름 그래프 ---- */

export interface FlowChartVisibility {
  contribution: boolean;
  annualReturn: boolean;
  depositIn: boolean;
  returnRate: boolean;
}

interface FlowChartProps {
  data: AnnualFlowRow[];
  visibility: FlowChartVisibility;
  noAnimation?: boolean;
}

export function AnnualFlowChart({ data, visibility, noAnimation }: FlowChartProps) {
  const chartData = data.map((row) => ({
    year: `${row.year}`,
    총납입금액: row.total_contribution,
    연간총수익: row.annual_return,
    입금액: row.deposit_in,
    연수익률: row.annual_return_rate != null ? Number(row.annual_return_rate) : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
        <XAxis dataKey="year" fontSize={12} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
        <YAxis yAxisId="left" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatAmount} width={60} />
        <YAxis yAxisId="right" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={50} />
        <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
        {visibility.depositIn && (
          <Bar yAxisId="left" dataKey="입금액" fill="#8B5CF6" opacity={0.6} barSize={24} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.contribution && (
          <Bar yAxisId="left" dataKey="총납입금액" fill="#4A90D9" opacity={0.7} barSize={24} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.annualReturn && (
          <Bar yAxisId="left" dataKey="연간총수익" fill="#10B981" opacity={0.75} barSize={24} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.returnRate && (
          <Line yAxisId="right" type="monotone" dataKey="연수익률" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 4, fill: '#F59E0B' }} activeDot={{ r: 6 }} isAnimationActive={!noAnimation} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---- 2. 순자산 그래프 ---- */

export interface NetAssetChartVisibility {
  netAsset: boolean;
  cumulativeDeposit: boolean;
  cumulativeProfit: boolean;
  netAssetReturnRate: boolean;
}

interface NetAssetChartProps {
  data: AnnualFlowRow[];
  visibility: NetAssetChartVisibility;
  noAnimation?: boolean;
}

export function NetAssetChart({ data, visibility, noAnimation }: NetAssetChartProps) {
  const chartData = data.map((row) => {
    const cumDep = row.cumulative_deposit_in;
    const cumWith = row.cumulative_withdrawal;
    const netInvestment = cumDep - cumWith;
    const netProfit = row.total_evaluation - netInvestment;
    const returnRate = netInvestment > 0 ? (netProfit / netInvestment * 100) : 0;
    return {
      year: `${row.year}`,
      순자산: row.total_evaluation,
      누적입금액: cumDep,
      순이익: netProfit,
      순자산수익률: returnRate,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
        <XAxis dataKey="year" fontSize={12} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
        <YAxis yAxisId="left" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatAmount} width={60} />
        <YAxis yAxisId="right" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={50} />
        <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
        {visibility.cumulativeDeposit && (
          <Bar yAxisId="left" dataKey="누적입금액" fill="#4A90D9" opacity={0.5} barSize={28} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.netAsset && (
          <Bar yAxisId="left" dataKey="순자산" fill="#1E3A5F" opacity={0.85} barSize={28} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.cumulativeProfit && (
          <Bar yAxisId="left" dataKey="순이익" fill="#10B981" opacity={0.7} barSize={28} radius={[3, 3, 0, 0]} isAnimationActive={!noAnimation} />
        )}
        {visibility.netAssetReturnRate && (
          <Line yAxisId="right" type="monotone" dataKey="순자산수익률" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 4, fill: '#F59E0B' }} activeDot={{ r: 6 }} isAnimationActive={!noAnimation} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
