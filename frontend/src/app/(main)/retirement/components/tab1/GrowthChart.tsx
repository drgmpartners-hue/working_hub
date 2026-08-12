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
  nominal?: number;   // 연금 모드: 실제 받을 금액(명목)
}

interface Props {
  data: DataPoint[];
  retirementAge?: number;
  showModified?: boolean;
  savingsEndAge?: number; // 적립 종료 나이
  /** 'fund' = 평가금액 추이(기본) · 'pension' = 월 연금액 (한 플랜의 명목 + 현재가치) */
  mode?: 'fund' | 'pension';
  /** 연금 모드에서 현재가치 선에 쓸 플랜 색 (현재플랜 파랑 / 추천플랜 주황) */
  planColor?: string;
}

function fmtY(v: number) {
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}억`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}천만`;
  return `${v}만`;
}
// 연금 모드는 값 범위가 수백~수천만원이라 '억' 환산 없이 만원 단위가 읽기 쉽다
function fmtYPen(v: number) { return `${v.toLocaleString('ko-KR')}만`; }

/** 최댓값 위에 여유를 둔다 — 물가반영을 켜면 선이 수평이라 그대로 두면 축 최상단에 붙어버린다.
 *  18% 여유를 준 뒤 눈금이 읽히는 값으로 올림. */
function penYMax(dataMax: number) {
  if (!(dataMax > 0)) return 'auto';
  const t = dataMax * 1.18;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(t)) - 1));
  return Math.ceil(t / mag) * mag;
}

function Tip({ active, payload, label, mode, planColor }: {
  active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: number; mode?: 'fund' | 'pension'; planColor?: string;
}) {
  if (!active || !payload?.length) return null;
  const orig = payload.find(p => p.dataKey === 'original');
  const mod = payload.find(p => p.dataKey === 'modified');
  const princ = payload.find(p => p.dataKey === 'principal');
  const nom = payload.find(p => p.dataKey === 'nominal');
  const box: React.CSSProperties = { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.10)', fontSize: 13 };
  if (mode === 'pension') {
    // 명목 대비 실질이 몇 %인지 함께 보여줘야 격차가 바로 읽힌다
    const ratio = nom && orig && nom.value > 0 ? Math.round((orig.value / nom.value) * 100) : null;
    return (
      <div style={box}>
        <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>{label}세</div>
        {nom && <div style={{ color: '#D1D5DB' }}>실제 받을 금액: {nom.value.toLocaleString('ko-KR')}만원/월</div>}
        {orig && <div style={{ color: planColor ?? '#60A5FA', fontWeight: 700 }}>현재가치: {orig.value.toLocaleString('ko-KR')}만원/월</div>}
        {ratio != null && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>구매력 {ratio}%</div>}
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>{label}세</div>
      {orig && <div style={{ color: '#60A5FA' }}>현재플랜: {orig.value.toLocaleString('ko-KR')}만원</div>}
      {mod && <div style={{ color: '#E85D04' }}>추천플랜: {mod.value.toLocaleString('ko-KR')}만원</div>}
      {princ && princ.value > 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>투자원금: {princ.value.toLocaleString('ko-KR')}만원</div>
      )}
    </div>
  );
}

export default function GrowthChart({ data, retirementAge, showModified, savingsEndAge, mode = 'fund', planColor = '#3B82F6' }: Props) {
  if (!data.length) return null;
  const isPen = mode === 'pension';
  const minAge = data[0].age;
  const maxAge = data[data.length - 1].age;
  const savEnd = savingsEndAge ?? minAge;
  const retStart = retirementAge ?? maxAge;

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        {/* 연금 모드는 전 구간이 연금수령 기간이라 단계 구분 배경을 쓰지 않는다 */}
        {!isPen && savEnd > minAge && (
          <ReferenceArea x1={minAge} x2={Math.min(savEnd, retStart)} fill="#3B82F6" fillOpacity={0.04} />
        )}
        {!isPen && savEnd < retStart && (
          <ReferenceArea x1={savEnd} x2={retStart} fill="#D4A847" fillOpacity={0.06} />
        )}
        {!isPen && retStart < maxAge && (
          <ReferenceArea x1={retStart} x2={maxAge} fill="#16A34A" fillOpacity={0.04} />
        )}
        {/* 연금 모드: 은퇴 후 구간만 음영 — 은퇴 전/후로 적용되는 토글이 다르다 */}
        {isPen && retStart < maxAge && <ReferenceArea x1={retStart} x2={maxAge} fill="#16A34A" fillOpacity={0.05} />}

        <CartesianGrid vertical={false} stroke="#243049" />
        <XAxis dataKey="age" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={v => `${v}세`} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickFormatter={isPen ? fmtYPen : fmtY} width={isPen ? 62 : 56}
          domain={isPen ? [0, penYMax] : undefined} allowDecimals={false} />
        <Tooltip content={<Tip mode={mode} planColor={planColor} />} />

        {!isPen && <Line type="monotone" dataKey="principal" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls name="투자원금" />}
        {/* 연금 모드: 명목(실제 받을 금액)은 회색 점선으로 배경에, 현재가치는 플랜 색 굵은 실선으로 강조 */}
        {isPen && <Line type="monotone" dataKey="nominal" stroke="#9CA3AF" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls name="실제 받을 금액" />}
        <Line type="monotone" dataKey="original" stroke={isPen ? planColor : '#3B82F6'} strokeWidth={isPen ? 3 : 2.5} dot={false} connectNulls name={isPen ? '현재가치' : '현재플랜'} />
        {!isPen && showModified && <Line type="monotone" dataKey="modified" stroke="#E85D04" strokeWidth={2.5} dot={false} connectNulls name="추천플랜" />}

        {/* 적립→거치 경계선 */}
        {!isPen && savEnd > minAge && savEnd < retStart && (
          <ReferenceLine x={savEnd} stroke="#D4A847" strokeDasharray="3 3" strokeWidth={1}
            label={{ value: `거치 ${savEnd}세`, position: 'insideTopRight', fill: '#D4A847', fontSize: 10 }} />
        )}

        {/* 은퇴 기준선 — 연금 모드에서는 두 토글의 적용 경계라 반드시 표시 */}
        {retirementAge && (
          <ReferenceLine x={retirementAge} stroke="#EF4444" strokeDasharray="5 5" strokeWidth={1.5}
            label={{ value: `은퇴 ${retirementAge}세`, position: 'top', fill: '#EF4444', fontSize: 11, fontWeight: 600 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
