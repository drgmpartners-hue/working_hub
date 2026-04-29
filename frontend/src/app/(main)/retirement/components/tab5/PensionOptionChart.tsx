'use client';

import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface ChartPoint { age: number; balance: number; pension: number }

interface Props {
  data: ChartPoint[];
  type: 'lifetime' | 'fixed' | 'infinite';
  retireAge: number;
  showBalance?: boolean;
  isComposition?: boolean;
}

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return String(v);
}

function fmtTooltip(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

const COLORS = {
  lifetime: { balance: '#1E3A5F', pension: '#F59E0B', fill: 'rgba(30,58,95,0.15)' },
  fixed: { balance: '#3B82F6', pension: '#3B82F6', fill: 'rgba(59,130,246,0.15)' },
  infinite: { balance: '#16A34A', pension: '#D97706', fill: 'rgba(22,163,74,0.12)' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, isComposition }: any) {
  if (!active || !payload?.length) return null;
  const nameMap: Record<string, string> = isComposition
    ? { balance: '원금', pension: '이자' }
    : { balance: '잔액', pension: '연금(연)' };
  const total = isComposition ? payload.reduce((s: number, p: { value: number }) => s + p.value, 0) : 0;
  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
      <div style={{ fontWeight: 600, color: '#374151', marginBottom: '6px' }}>{label}세</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '2px' }}>
          <span style={{ color: p.color }}>{nameMap[p.name] ?? p.name}</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtTooltip(p.value)}</span>
        </div>
      ))}
      {isComposition && total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #E5E7EB', fontWeight: 700 }}>
          <span style={{ color: '#374151' }}>합계</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTooltip(total)}</span>
        </div>
      )}
    </div>
  );
}

export default function PensionOptionChart({ data, type, retireAge, showBalance, isComposition }: Props) {
  if (!data.length) return <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>데이터 없음</div>;

  const c = COLORS[type];
  // Y축: composition이면 합계 기준, showBalance면 잔액+연금 중 최대
  const maxPension = Math.max(...data.map(d => d.pension).filter(v => v > 0), 0);
  const maxBalance = showBalance || isComposition ? Math.max(...data.map(d => d.balance).filter(v => v > 0), 0) : 0;
  const maxTotal = isComposition ? Math.max(...data.map(d => d.pension + d.balance)) : 0;
  const yMax = isComposition
    ? maxTotal * 1.05  // composition: 연간연금에 딱 맞게 (5% 여유)
    : Math.max(maxPension, maxBalance) * 1.15 || 1;

  const markers: { age: number; label: string }[] = [];
  if (type === 'lifetime') {
    markers.push({ age: retireAge + 10, label: `${retireAge + 10}세` });
    if (retireAge + 40 <= 117) markers.push({ age: retireAge + 40, label: `${retireAge + 40}세` });
  } else if (type === 'fixed') {
    // 연금 수령이 끝나는 시점 찾기
    const lastPensionAge = data.filter(d => d.pension > 0).pop()?.age ?? retireAge;
    markers.push({ age: lastPensionAge, label: `${lastPensionAge}세 (수령종료)` });
  } else {
    markers.push({ age: 100, label: '100세' });
  }

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
          <XAxis dataKey="age" fontSize={11} tick={{ fill: '#9CA3AF' }} tickFormatter={(v) => `${v}세`}
            interval={type === 'lifetime' ? 9 : type === 'infinite' ? 4 : 'preserveStartEnd'} />
          <YAxis fontSize={10} tick={{ fill: '#9CA3AF' }} tickFormatter={fmtAxis} domain={[0, yMax]} />
          <Tooltip content={<CustomTooltip isComposition={isComposition} />} />
          {isComposition ? (<>
            {/* 스택 바: 아래=이자(감소), 위=원금(증가) → 총합 일정 */}
            <Bar dataKey="pension" name="pension" stackId="comp" fill="#F59E0B" opacity={0.75} barSize={8} />
            <Bar dataKey="balance" name="balance" stackId="comp" fill="#1E3A5F" opacity={0.85} barSize={8} />
          </>) : (<>
            {showBalance && <Area type="monotone" dataKey="balance" name="balance" fill={c.fill} stroke={c.balance} strokeWidth={2} />}
            {type === 'infinite'
              ? <Line type="monotone" dataKey="pension" name="pension" stroke={c.pension} strokeWidth={2} dot={false} />
              : <Bar dataKey="pension" name="pension" fill={c.pension} opacity={0.6} barSize={type === 'fixed' ? 12 : 6} />}
          </>)}
          {markers.filter(m => m.age >= (data[0]?.age ?? 0) && m.age <= (data[data.length - 1]?.age ?? 999)).map(m => (
            <ReferenceLine key={m.age} x={m.age} stroke="#9CA3AF" strokeDasharray="4 4"
              label={{ value: m.label, position: 'top', fontSize: 10, fill: '#6B7280' }} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
