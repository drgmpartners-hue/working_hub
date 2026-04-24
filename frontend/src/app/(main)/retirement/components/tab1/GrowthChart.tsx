'use client';

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';

interface DataPoint {
  age: number;
  original?: number;
  modified?: number;
  principal?: number;
}

interface Props {
  data: DataPoint[];
  retirementAge?: number;
  showModified?: boolean;
  savingsEndAge?: number; // 적립 종료 나이
}

function fmtY(v: number) {
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}억`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}천만`;
  return `${v}만`;
}

function Tip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>; label?: number }) {
  if (!active || !payload?.length) return null;
  const orig = payload.find(p => p.dataKey === 'original');
  const mod = payload.find(p => p.dataKey === 'modified');
  const princ = payload.find(p => p.dataKey === 'principal');
  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.10)', fontSize: 13 }}>
      <div style={{ color: '#6B7280', marginBottom: 4, fontWeight: 600 }}>{label}세</div>
      {orig && <div style={{ color: '#1E3A5F' }}>기존: {orig.value.toLocaleString('ko-KR')}만원</div>}
      {mod && <div style={{ color: '#E85D04' }}>수정: {mod.value.toLocaleString('ko-KR')}만원</div>}
      {princ && princ.value > 0 && <div style={{ color: '#9CA3AF', fontSize: 12 }}>원금: {princ.value.toLocaleString('ko-KR')}만원</div>}
    </div>
  );
}

export default function GrowthChart({ data, retirementAge, showModified, savingsEndAge }: Props) {
  if (!data.length) return null;
  const minAge = data[0].age;
  const maxAge = data[data.length - 1].age;
  const savEnd = savingsEndAge ?? minAge;
  const retStart = retirementAge ?? maxAge;

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        {/* 배경색 구간: 적립 */}
        {savEnd > minAge && (
          <ReferenceArea x1={minAge} x2={Math.min(savEnd, retStart)} fill="#1E3A5F" fillOpacity={0.04} />
        )}
        {/* 배경색 구간: 거치 */}
        {savEnd < retStart && (
          <ReferenceArea x1={savEnd} x2={retStart} fill="#D4A847" fillOpacity={0.06} />
        )}
        {/* 배경색 구간: 연금수령 */}
        {retStart < maxAge && (
          <ReferenceArea x1={retStart} x2={maxAge} fill="#16A34A" fillOpacity={0.04} />
        )}

        <CartesianGrid vertical={false} stroke="#F0F0F0" />
        <XAxis dataKey="age" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={v => `${v}세`} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={fmtY} width={56} />
        <Tooltip content={<Tip />} />

        <Line type="monotone" dataKey="principal" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls name="투자원금" />
        <Line type="monotone" dataKey="original" stroke="#1E3A5F" strokeWidth={2.5} dot={false} connectNulls name="기존 은퇴플랜" />
        {showModified && <Line type="monotone" dataKey="modified" stroke="#E85D04" strokeWidth={2.5} dot={false} connectNulls name="수정 은퇴플랜" />}

        {/* 적립→거치 경계선 */}
        {savEnd > minAge && savEnd < retStart && (
          <ReferenceLine x={savEnd} stroke="#D4A847" strokeDasharray="3 3" strokeWidth={1}
            label={{ value: `거치 ${savEnd}세`, position: 'insideTopRight', fill: '#D4A847', fontSize: 10 }} />
        )}

        {/* 은퇴 기준선 */}
        {retirementAge && (
          <ReferenceLine x={retirementAge} stroke="#EF4444" strokeDasharray="5 5" strokeWidth={1.5}
            label={{ value: `은퇴 ${retirementAge}세`, position: 'top', fill: '#EF4444', fontSize: 11, fontWeight: 600 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
