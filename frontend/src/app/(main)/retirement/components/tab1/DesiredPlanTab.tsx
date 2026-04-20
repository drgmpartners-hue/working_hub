'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

const GrowthChart = dynamic(() => import('./GrowthChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  ECOS                                                               */
/* ------------------------------------------------------------------ */
const ECOS_DEFAULT = 2.5;
async function fetchInflation(): Promise<number> {
  try {
    const r = await fetch(`${API_URL}/api/v1/retirement/inflation-rate`, { headers: authLib.getAuthHeader() });
    if (r.ok) { const d = await r.json(); return d.rate ?? ECOS_DEFAULT; }
  } catch { /* */ }
  return ECOS_DEFAULT;
}

/* ------------------------------------------------------------------ */
/*  유틸                                                               */
/* ------------------------------------------------------------------ */
function fmt(n: number) { return n.toLocaleString('ko-KR'); }
function fmtW(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (Math.abs(n) >= 1e4) return `${fmt(Math.round(n / 1e4))}만원`;
  return `${fmt(n)}원`;
}
function pn(s: string) { return parseInt(s.replace(/\D/g, ''), 10) || 0; }
function fi(s: string) { const n = pn(s); return n > 0 ? fmt(n) : ''; }

/* ------------------------------------------------------------------ */
/*  엑셀 FV (프론트 시뮬레이션용)                                       */
/* ------------------------------------------------------------------ */
function excelFV(rate: number, nper: number, pmt: number, pv: number) {
  if (rate === 0) return -(pv + pmt * nper);
  const f = (1 + rate) ** nper;
  return -pv * f - pmt * (f - 1) / rate;
}

/* ------------------------------------------------------------------ */
/*  타입                                                               */
/* ------------------------------------------------------------------ */
interface SimRow {
  year: number; age: number; monthly_payment: number; additional: number;
  evaluation: number; cumulative_principal: number; investment_return: number;
  phase: 'saving' | 'holding' | 'retirement';
  pension?: number; cumulative_pension?: number;
}
interface CalcResp {
  investment_years: number; holding_period: number; future_monthly_amount: number;
  target_fund_inflation: number; target_fund_no_inflation: number;
  target_fund: number; required_holding: number;
  required_holding_inflation: number; required_holding_no_inflation: number;
  simulation_table: SimRow[]; calculation_params: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  스타일                                                              */
/* ------------------------------------------------------------------ */
const IS: React.CSSProperties = {
  width: '100%', height: '34px', padding: '0 32px 0 10px', fontSize: '13px',
  color: '#1A1A2E', backgroundColor: '#fff', border: '1px solid #D1D5DB',
  borderRadius: '6px', outline: 'none', boxSizing: 'border-box', textAlign: 'right',
};
const LS: React.CSSProperties = { fontSize: '12px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' };
const US: React.CSSProperties = { position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#6B7280', pointerEvents: 'none' };

/* ------------------------------------------------------------------ */
/*  메인                                                               */
/* ------------------------------------------------------------------ */
export function DesiredPlanTab() {
  const { selectedCustomer, setCustomer } = useRetirementStore();
  const cid = selectedCustomer?.id ?? null;
  const curAge = selectedCustomer?.currentAge ?? 0;

  // 입력
  const [mIn, setMIn] = useState('');          // 현재가치 수령액 (만원)
  const [infIn, setInfIn] = useState('2.5');   // 물가상승률 %
  const [prIn, setPrIn] = useState('5.0');     // 은퇴연금수익률 %
  const [raIn, setRaIn] = useState('65');      // 은퇴나이
  const [rpIn, setRpIn] = useState('40');      // 수령기간
  const [spIn, setSpIn] = useState('5');       // 적립기간
  const [rrIn, setRrIn] = useState('7.0');     // 예상수익률 %
  const [asIn, setAsIn] = useState('');        // 연적립 (만원)
  const [planStartYear, setPlanStartYear] = useState(String(new Date().getFullYear())); // 플랜 시작연도

  // ★ 토글 2개 독립
  const [tog1, setTog1] = useState(false); // 입력용: 은퇴당시수령액에 물가 반영
  const [tog2, setTog2] = useState(false); // 계산용: 목표자금 계산시 물가 반영

  const [ecos, setEcos] = useState(ECOS_DEFAULT);
  const [calc, setCalc] = useState<CalcResp | null>(null);
  const [showTbl, setShowTbl] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calcing, setCalcing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ m: string; t: 'success' | 'error' } | null>(null);

  // 시뮬레이션 편집용 오버라이드: { [year]: { monthly?, additional? } }
  const [overrides, setOverrides] = useState<Record<number, { monthly?: number; additional?: number }>>({});

  const show = (m: string, t: 'success' | 'error') => { setToast({ m, t }); setTimeout(() => setToast(null), 3000); };

  // 파싱
  const monthly = pn(mIn);
  const retAge = parseInt(raIn, 10) || 65;
  const retPeriod = parseInt(rpIn, 10) || 40;
  const savYrs = parseInt(spIn, 10) || 0;
  const retRate = parseFloat(rrIn) || 7;
  const infRate = parseFloat(infIn) || ecos;
  const penRate = parseFloat(prIn) || 5;
  const annSav = pn(asIn);

  // 플랜 시작연도 기준 시작 나이
  const pStartYr = parseInt(planStartYear, 10) || new Date().getFullYear();
  const planStartAge = curAge - (new Date().getFullYear() - pStartYr);
  const invYrs = planStartAge > 0 && retAge > planStartAge ? retAge - planStartAge : (curAge > 0 && retAge > curAge ? retAge - curAge : 0);
  const holdYrs = invYrs > savYrs ? invYrs - savYrs : 0;

  // ★ tog1: 은퇴당시 수령액 계산 (현재→은퇴까지 물가 적용)
  const yearsToRetirement = curAge > 0 && retAge > curAge ? retAge - curAge : 0;
  const futureMonthly = monthly > 0 && yearsToRetirement > 0
    ? (tog1 ? Math.round(monthly * Math.pow(1 + infRate / 100, yearsToRetirement)) : monthly)
    : 0;

  useEffect(() => { fetchInflation().then(r => { setEcos(r); setInfIn(r.toFixed(1)); }); }, []);

  // 로드
  const load = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, { headers: authLib.getAuthHeader() });
      if (r.ok) {
        const d = await r.json(); const p = d.calculation_params || {};
        // 현재가치 수령액: current_value_monthly 우선, 없으면 monthly_desired_amount
        const cvm = d.current_value_monthly ?? d.monthly_desired_amount;
        if (cvm) setMIn(fmt(Math.round(cvm / 1e4)));
        if (p.retirement_period_years) setRpIn(String(p.retirement_period_years));
        if (p.retirement_age) setRaIn(String(p.retirement_age));
        if (p.savings_period) setSpIn(String(p.savings_period));
        if (p.expected_return_rate) setRrIn(((p.expected_return_rate * 100) as number).toFixed(1));
        if (p.inflation_rate) setInfIn(((p.inflation_rate * 100) as number).toFixed(1));
        if (p.pension_return_rate) setPrIn(((p.pension_return_rate * 100) as number).toFixed(1));
        if (p.annual_savings) setAsIn(fmt(Math.round(p.annual_savings / 1e4)));
        // 토글 복원
        if (d.use_inflation_input !== undefined) setTog1(!!d.use_inflation_input);
        else if (p.with_inflation !== undefined) setTog1(!!p.with_inflation);
        if (d.use_inflation_calc !== undefined) setTog2(!!d.use_inflation_calc);
        else if (p.with_inflation !== undefined) setTog2(!!p.with_inflation);
        // 플랜 시작연도 복원
        if (d.plan_start_year) setPlanStartYear(String(d.plan_start_year));
        // 시뮬레이션 테이블: simulation_data(수정된 값) 우선 사용
        const savedSimData = d.simulation_data ?? p.simulation_table ?? d.simulation_table;
        if (savedSimData?.length) {
          setCalc({
            investment_years: p.investment_years ?? 0, holding_period: p.holding_period ?? 0,
            future_monthly_amount: p.future_monthly_amount ?? 0,
            target_fund_inflation: p.target_fund_inflation ?? 0, target_fund_no_inflation: p.target_fund_no_inflation ?? 0,
            target_fund: p.target_fund ?? 0, required_holding: p.required_holding ?? 0,
            required_holding_inflation: p.required_holding_inflation ?? 0, required_holding_no_inflation: p.required_holding_no_inflation ?? 0,
            simulation_table: savedSimData, calculation_params: p,
          });
          setOverrides({});
        }
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [cid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (curAge > 0 && !raIn) setRaIn('65'); }, [curAge, raIn]);

  function buildBody() {
    // 시뮬레이션 테이블에서 월적립/거치금 집계
    const simRows = simTable.length > 0 ? simTable : (calc?.simulation_table ?? []);
    const simMonthly = simRows.length > 0 ? Math.round((simRows[0]?.monthly_payment ?? 0) / 1e4) : 0;
    let totalLumpSum = 0;
    let annualLumpSum = 0;
    let lumpCount = 0;
    for (const row of simRows) {
      const ad = row.additional ?? 0;
      if (ad > 0) {
        totalLumpSum += ad;
        annualLumpSum += ad;
        lumpCount++;
      }
    }
    if (lumpCount > 0) annualLumpSum = Math.round(annualLumpSum / lumpCount);
    // 희망 은퇴금액 = 투자기간 마지막 행(은퇴 직전)의 총평가
    const investRows = simRows.filter((r: any) => r.phase !== 'retirement');
    const lastInvestRow = investRows.length > 0 ? investRows[investRows.length - 1] : simRows[simRows.length - 1];
    const simTargetFund = lastInvestRow ? Math.round(lastInvestRow.evaluation / 1e4) : 0;

    return {
      monthly_desired_amount: (tog1 ? futureMonthly : monthly) * 1e4,
      retirement_age: retAge, current_age: curAge, retirement_period_years: retPeriod,
      savings_period: savYrs, annual_savings: annSav * 1e4,
      inflation_rate: infRate / 100, pension_return_rate: penRate / 100,
      expected_return_rate: retRate / 100, with_inflation: tog2,
      // 추가 저장 필드
      current_value_monthly: monthly * 1e4,
      future_monthly_amount: futureMonthly * 1e4,
      use_inflation_input: tog1,
      use_inflation_calc: tog2,
      desired_retirement_age: retAge,
      savings_period_years: savYrs,
      holding_period_years: holdYrs,
      annual_savings_amount: annSav * 1e4,
      // 시뮬레이션 데이터
      simulation_data: simRows,
      simulation_monthly_savings: simMonthly * 1e4,
      simulation_annual_lump_sum: annualLumpSum,
      simulation_total_lump_sum: totalLumpSum,
      simulation_target_fund: simTargetFund * 1e4,
      plan_start_year: parseInt(planStartYear, 10) || new Date().getFullYear(),
    };
  }

  const canCalc = curAge > 0 && monthly > 0;

  const handleCalc = async () => {
    if (!canCalc) { show('필수 입력값을 확인해주세요.', 'error'); return; }
    setCalcing(true);
    try {
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/calculate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(buildBody()),
      });
      if (r.ok) { setCalc(await r.json()); setOverrides({}); }
      else { const e = await r.json().catch(() => ({})); show(String((e as {detail?:unknown}).detail || '계산 실패'), 'error'); }
    } catch { show('네트워크 오류', 'error'); } finally { setCalcing(false); }
  };

  async function ensureProfile() {
    if (!cid) return false;
    try {
      const c = await fetch(`${API_URL}/api/v1/retirement/profiles/${cid}`, { headers: authLib.getAuthHeader() });
      if (c.ok || c.status === 403) return true; // 403 = exists but different owner, still OK
      if (c.status === 404) {
        const cr = await fetch(`${API_URL}/api/v1/retirement/profiles`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ customer_id: cid, current_age: curAge || 35, age_at_design: curAge || 35, desired_retirement_age: retAge }),
        });
        return cr.ok || cr.status === 409; // 409 = already exists
      }
    } catch { /* */ }
    return false;
  }

  const handleSave = async () => {
    if (!cid) { show('고객을 먼저 선택하세요.', 'error'); return; }
    if (!canCalc) { show('필수 입력값을 확인해주세요.', 'error'); return; }
    setSaving(true);
    try {
      if (!(await ensureProfile())) { show('프로필 생성 실패', 'error'); setSaving(false); return; }
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(buildBody()),
      });
      if (r.ok) {
        const d = await r.json(); const p = d.calculation_params || {};
        // 저장된 simulation_table에 overrides가 반영된 simTable 사용
        const savedSimTable = simTable.length > 0 ? simTable.map(row => ({
          year: row.year, age: row.age, monthly_payment: row.monthly_payment,
          additional: row.additional, evaluation: row.evaluation,
          cumulative_principal: row.cumulative_principal, investment_return: row.investment_return,
          phase: row.phase,
        })) : (p.simulation_table ?? d.simulation_table ?? []);
        setCalc({
          investment_years: p.investment_years ?? 0, holding_period: p.holding_period ?? 0,
          future_monthly_amount: p.future_monthly_amount ?? 0,
          target_fund_inflation: p.target_fund_inflation ?? 0, target_fund_no_inflation: p.target_fund_no_inflation ?? 0,
          target_fund: p.target_fund ?? 0, required_holding: p.required_holding ?? 0,
          required_holding_inflation: p.required_holding_inflation ?? 0, required_holding_no_inflation: p.required_holding_no_inflation ?? 0,
          simulation_table: savedSimTable, calculation_params: p,
        });
        // overrides를 초기화하지 않음 - 수정값 유지
        // 헤더의 희망은퇴나이 갱신
        if (selectedCustomer) {
          const savedTargetFund = d.simulation_target_fund ?? d.target_retirement_fund ?? p.target_fund ?? selectedCustomer.targetFund;
          // 만원 단위로 변환 (원 단위로 저장된 경우)
          const targetFundManwon = savedTargetFund >= 1e8 ? Math.round(savedTargetFund / 1e4) : savedTargetFund;
          setCustomer({ ...selectedCustomer, retirementAge: retAge, targetFund: targetFundManwon });
        }
        show('저장이 완료되었습니다.', 'success');
      } else { const e = await r.json().catch(() => ({})); show(String((e as {detail?:unknown}).detail || '저장 실패'), 'error'); }
    } catch { show('네트워크 오류', 'error'); } finally { setSaving(false); }
  };

  // ★ 시뮬레이션 테이블 재계산 (오버라이드 반영, 프론트 FV) - 100세까지
  const simTable = useMemo(() => {
    if (!calc?.simulation_table?.length) return [];
    const base = calc.simulation_table;
    const monthlyRate = retRate / 100 / 12;
    const pensionRate = penRate / 100;
    const inflRateDecimal = infRate / 100;
    const rows: SimRow[] = [];
    let cumPrincipal = 0;
    let prevEval = 0;
    let cumPension = 0;

    // 플랜 시작연도 기준 시작 나이 계산
    const pStartYear = parseInt(planStartYear, 10) || new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const startAge = curAge - (currentYear - pStartYear); // 플랜 시작 당시 나이

    // 투자기간 = 은퇴나이 - 플랜시작나이 (은퇴나이 전년도까지 투자)
    const totalInvYears = retAge - startAge;

    // 1단계: 투자기간 (적립 + 거치) - 은퇴나이 직전까지
    for (let i = 0; i < totalInvYears; i++) {
      const yearNum = i + 1;
      const ageForYear = startAge + i;
      const b = base[i]; // base에서 데이터 참조 (없으면 거치로 처리)
      const ov = overrides[yearNum];

      // 적립기간이면 월적립, 아니면 0
      const isSaving = i < savYrs;
      const defaultMp = isSaving && b ? b.monthly_payment : 0;
      const defaultAd = b ? b.additional : 0;

      const mp = ov?.monthly !== undefined ? ov.monthly * 1e4 : defaultMp;
      const ad = ov?.additional !== undefined ? ov.additional * 1e4 : defaultAd;

      const hasOverride = ov?.monthly !== undefined || ov?.additional !== undefined;
      let evaluation: number;
      if (hasOverride || i > 0 || !b) {
        evaluation = excelFV(monthlyRate, 12, -mp, -(prevEval + ad));
      } else {
        evaluation = b.evaluation;
      }

      cumPrincipal += mp * 12 + ad;
      const invReturn = evaluation - cumPrincipal;

      rows.push({
        year: yearNum, age: ageForYear, monthly_payment: mp, additional: ad,
        evaluation: Math.round(evaluation), cumulative_principal: Math.round(cumPrincipal),
        investment_return: Math.round(invReturn),
        phase: isSaving ? 'saving' : 'holding',
        pension: 0, cumulative_pension: 0,
      });
      prevEval = evaluation;
    }

    // 2단계: 은퇴 후 (은퇴나이부터 100세) - 연금 인출
    if (rows.length > 0 && retAge > 0) {
      const annualPension = futureMonthly * 1e4 * 12; // 연 연금액 (원)
      let retPrevEval = prevEval;
      const lastYearNum = rows[rows.length - 1].year;

      for (let age = retAge; age <= 100; age++) {
        const yearNum = lastYearNum + 1 + (age - retAge);
        const pensionYearIdx = age - retAge; // 0부터
        // tog2(계산결과 물가반영)가 ON이면 매년 물가상승률 반영, OFF면 고정금액
        const yearPension = tog2
          ? annualPension * Math.pow(1 + inflRateDecimal, pensionYearIdx)
          : annualPension;
        cumPension += yearPension;

        // 은퇴 후 평가: (전년 평가 - 연금인출) * (1 + 은퇴수익률)
        const evaluation = Math.max(0, (retPrevEval - yearPension) * (1 + pensionRate));

        rows.push({
          year: yearNum, age, monthly_payment: 0, additional: 0,
          evaluation: Math.round(evaluation), cumulative_principal: Math.round(cumPrincipal),
          investment_return: Math.round(evaluation - cumPrincipal),
          phase: 'retirement',
          pension: Math.round(yearPension), cumulative_pension: Math.round(cumPension),
        });
        retPrevEval = evaluation;

        if (evaluation <= 0) break; // 자금 소진 시 중단
      }
    }

    return rows;
  }, [calc, overrides, retRate, penRate, infRate, curAge, futureMonthly]);

  // 그래프 데이터 (누적원금 포함)
  const gData = simTable.map(r => ({
    age: r.age, amount: Math.round(r.evaluation / 1e4),
    principal: Math.round(r.cumulative_principal / 1e4),
    phase: r.phase as 'saving' | 'holding' | 'retirement',
  }));

  // 오버라이드 핸들러
  function setOv(year: number, field: 'monthly' | 'additional', val: string) {
    const n = pn(val);
    setOverrides(prev => ({ ...prev, [year]: { ...prev[year], [field]: n } }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ===== 입력 + 결과 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'stretch' }}>

        {/* 좌: 입력 */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1E3A5F', marginBottom: '14px', marginTop: 0 }}>
            희망 은퇴 조건 입력
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
            <F label="플랜 시작연도" unit="년" value={planStartYear} onChange={v => { setCalc(null); setPlanStartYear(v.replace(/\D/g, '')); }} disabled={loading} />
            <F label="연금수령기간" unit="년" value={rpIn} onChange={v => { setCalc(null); setRpIn(v.replace(/\D/g, '')); }} disabled={loading} />

            {/* 현재가치 수령액 + 토글1 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={LS}>현재가치 수령액</span>
                <Tog label="물가반영" checked={tog1} onChange={() => setTog1(!tog1)} />
              </div>
              <div style={{ position: 'relative' }}>
                <input type="text" inputMode="numeric" value={mIn}
                  onChange={e => { setCalc(null); setMIn(fi(e.target.value)); }} disabled={loading} style={IS} placeholder="0" />
                <span style={US}>만원</span>
              </div>
            </div>

            {/* 은퇴당시 수령액 */}
            <F label="은퇴당시 수령액" unit="만원" readOnly value={futureMonthly > 0 ? fmt(futureMonthly) : '-'} />

            {/* 물가상승률 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={LS}>물가상승률</span>
                <span style={{ fontSize: '10px', color: '#9CA3AF' }}>한국은행 기준 {ecos.toFixed(1)}%</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input type="text" value={infIn} onChange={e => { setCalc(null); setInfIn(e.target.value.replace(/[^\d.]/g, '')); }} disabled={loading} style={IS} />
                <span style={US}>%</span>
              </div>
            </div>

            <F label="은퇴연금 수익률" unit="%" value={prIn} onChange={v => { setCalc(null); setPrIn(v.replace(/[^\d.]/g, '')); }} disabled={loading} />

            <div>
              <span style={{ ...LS, display: 'block', marginBottom: '4px' }}>희망 은퇴나이</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input type="text" inputMode="numeric" value={raIn} onChange={e => { setCalc(null); setRaIn(e.target.value.replace(/\D/g, '')); }} disabled={loading} style={IS} placeholder="65" />
                  <span style={US}>세</span>
                </div>
                {invYrs > 0 && <span style={{ fontSize: '11px', color: '#1E3A5F', fontWeight: 600, backgroundColor: '#EFF6FF', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>{invYrs}년</span>}
              </div>
            </div>

            <div>
              <span style={{ ...LS, display: 'block', marginBottom: '4px' }}>적립기간</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input type="text" inputMode="numeric" value={spIn} onChange={e => { setCalc(null); setSpIn(e.target.value.replace(/\D/g, '')); }} disabled={loading} style={IS} placeholder="5" />
                  <span style={US}>년</span>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: holdYrs > 0 ? '#D4A847' : '#9CA3AF', backgroundColor: holdYrs > 0 ? '#FFFBEB' : '#F3F4F6', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>거치 {holdYrs}년</span>
              </div>
            </div>

            <F label="예상수익률" unit="%" value={rrIn} onChange={v => { setCalc(null); setRrIn(v.replace(/[^\d.]/g, '')); }} disabled={loading} />
            <F label="연적립 금액" unit="만원" value={asIn} isCurrency onChange={v => { setCalc(null); setAsIn(fi(v)); }} disabled={loading} />
          </div>

        </div>

        {/* 우: 결과 */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1E3A5F', margin: 0 }}>계산 결과</h3>
            <Tog label="물가반영" checked={tog2} onChange={() => setTog2(!tog2)} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', flex: 1 }}>
            <thead><tr><th style={TH}>항목</th><th style={{ ...TH, textAlign: 'right' }}>금액</th></tr></thead>
            <tbody>
              <R label="목표 은퇴자금" hl value={calc ? fmtW(tog2 ? calc.target_fund_inflation : calc.target_fund_no_inflation) : '-'} />
              <R label="필요 거치금액" hl value={calc ? fmtW(tog2 ? (calc.required_holding_inflation || calc.required_holding) : (calc.required_holding_no_inflation || calc.required_holding)) : '-'} />
              <R label="투자기간" value={calc ? `${calc.investment_years}년 (적립 ${savYrs} + 거치 ${calc.holding_period})` : invYrs > 0 ? `${invYrs}년` : '-'} />
              <R label="은퇴당시 수령액" value={futureMonthly > 0 ? `${fmt(futureMonthly)}만원` : '-'} />
              <R label="예상 수익률" value={`${retRate.toFixed(1)}%`} rate />
              <R label="물가상승률" value={`${infRate.toFixed(1)}%`} rate />
              <R label="은퇴연금 수익률" value={`${penRate.toFixed(1)}%`} rate />
            </tbody>
          </table>
          {!calc && <p style={{ marginTop: '14px', fontSize: '12px', color: '#9CA3AF', textAlign: 'center' }}>{curAge > 0 ? '입력값을 채우고 [계산] 버튼을 눌러주세요.' : '고객을 선택하면 나이를 기반으로 계산합니다.'}</p>}
        </div>
      </div>

      {/* 계산 버튼 (두 영역 아래 가운데) */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={handleCalc} disabled={!canCalc || calcing}
          style={{ padding: '10px 0', width: '25%', fontSize: '13px', fontWeight: 700, borderRadius: '8px', cursor: canCalc ? 'pointer' : 'not-allowed', backgroundColor: canCalc ? '#1E3A5F' : '#9CA3AF', color: '#fff', border: 'none', opacity: calcing ? 0.6 : 1, boxShadow: canCalc ? '0 2px 6px rgba(30,58,95,0.25)' : 'none' }}>
          {calcing ? '계산 중...' : '계산'}
        </button>
      </div>

      {/* ===== 시뮬레이션 ===== */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1E3A5F', marginBottom: '14px', marginTop: 0 }}>
          복리 성장 시뮬레이션
        </h3>

        {simTable.length > 0 ? (
          <>
            {/* 아코디언 + 초기화 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <button onClick={() => setShowTbl(!showTbl)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #E5E7EB', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: '#374151', fontWeight: 500 }}>
                <span style={{ transform: showTbl ? 'rotate(90deg)' : 'rotate(0deg)', transition: '0.2s', display: 'inline-block' }}>▶</span>
                연차별 상세 {showTbl ? '접기' : '펼치기'}
                <span style={{ fontSize: '10px', color: '#9CA3AF', marginLeft: '6px' }}>월적립·거치금 수정 가능</span>
              </button>
              {Object.keys(overrides).length > 0 && (
                <button onClick={() => setOverrides({})} style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, color: '#EF4444', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer' }}>
                  수정값 초기화
                </button>
              )}
            </div>

            {showTbl && (
              <div style={{ overflowX: 'auto', maxHeight: '500px', overflowY: 'auto', marginBottom: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                      {['연도','연차','나이','구분','월적립(만)','거치금(만)','누적원금','운용수익','연금인출','총평가'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB', textAlign: ['연도','연차','나이','구분'].includes(h) ? 'center' : 'right', fontWeight: 600, color: h === '연금인출' ? '#DC2626' : '#6B7280', whiteSpace: 'nowrap', backgroundColor: '#F9FAFB' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {simTable.map((r, i) => {
                      const ov = overrides[r.year];
                      const mpMan = Math.round(r.monthly_payment / 1e4);
                      const adMan = Math.round(r.additional / 1e4);
                      const isRetAge = r.age === retAge;
                      const phaseBg = r.phase === 'saving' ? '#EFF6FF' : r.phase === 'holding' ? '#FFFBEB' : '#F0FDF4';
                      const phaseColor = r.phase === 'saving' ? '#1E3A5F' : r.phase === 'holding' ? '#D4A847' : '#16A34A';
                      const phaseLabel = r.phase === 'saving' ? '적립' : r.phase === 'holding' ? '거치' : '은퇴후';
                      const rowBg = isRetAge ? 'rgba(30,58,95,0.08)' : phaseBg;
                      return (
                        <tr key={r.year} style={{ borderBottom: '1px solid #F3F4F6', backgroundColor: rowBg }}>
                          <td style={{ ...TC, fontSize: 11, color: '#9CA3AF' }}>{(parseInt(planStartYear, 10) || new Date().getFullYear()) + r.year - 1}</td>
                          <td style={TC}>{r.year}</td>
                          <td style={{ ...TC, fontWeight: isRetAge ? 700 : 400, color: isRetAge ? '#1E3A5F' : '#374151' }}>{r.age}세{isRetAge && <span style={{ fontSize: 10, marginLeft: 2 }}>★</span>}</td>
                          <td style={{ ...TC, color: phaseColor, fontWeight: 600 }}>{phaseLabel}</td>
                          <td style={TR}>
                            {r.phase !== 'retirement' ? (
                              <input type="text" inputMode="numeric" value={ov?.monthly !== undefined ? fi(String(ov.monthly)) : (mpMan > 0 ? fmt(mpMan) : '-')}
                                onChange={e => setOv(r.year, 'monthly', e.target.value)}
                                style={{ ...IS, width: '90px', height: '30px', fontSize: '13px', padding: '0 6px', border: ov?.monthly !== undefined ? '1.5px solid #3B82F6' : '1px solid #E5E7EB' }} />
                            ) : <span style={{ color: '#9CA3AF' }}>-</span>}
                          </td>
                          <td style={TR}>
                            {r.phase !== 'retirement' ? (
                              <input type="text" inputMode="numeric" value={ov?.additional !== undefined ? fi(String(ov.additional)) : (adMan > 0 ? fmt(adMan) : '')}
                                onChange={e => setOv(r.year, 'additional', e.target.value)}
                                placeholder={i === 0 ? '거치금' : ''}
                                style={{ ...IS, width: '100px', height: '30px', fontSize: '13px', padding: '0 6px', border: ov?.additional !== undefined ? '1.5px solid #3B82F6' : '1px solid #E5E7EB' }} />
                            ) : <span style={{ color: '#9CA3AF' }}>-</span>}
                          </td>
                          <td style={TR}>{fmt(Math.round(r.cumulative_principal / 1e4))}</td>
                          <td style={{ ...TR, color: r.investment_return >= 0 ? '#059669' : '#EF4444' }}>{fmt(Math.round(r.investment_return / 1e4))}</td>
                          <td style={{ ...TR, color: (r.pension ?? 0) > 0 ? '#DC2626' : '#9CA3AF' }}>{(r.pension ?? 0) > 0 ? fmt(Math.round((r.pension ?? 0) / 1e4)) : '-'}</td>
                          <td style={{ ...TR, fontWeight: 600, color: '#1E3A5F' }}>{fmt(Math.round(r.evaluation / 1e4))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: 'right', fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>(단위: 만원) 파란 테두리 = 수정된 값</div>
              </div>
            )}

            {/* 범례 */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 12, height: 12, backgroundColor: '#1E3A5F', borderRadius: 2, display: 'inline-block' }} />적립 ({savYrs}년)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 12, height: 12, backgroundColor: '#D4A847', borderRadius: 2, display: 'inline-block' }} />거치 ({holdYrs}년)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 12, height: 12, backgroundColor: '#16A34A', borderRadius: 2, display: 'inline-block' }} />은퇴후</span>
            </div>

            <GrowthChart data={gData} retirementAge={retAge} />

            {/* 저장 버튼 (그래프 우하단) */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
              <button onClick={handleSave} disabled={!cid || !canCalc || saving}
                style={{ padding: '10px 0', width: '25%', fontSize: '13px', fontWeight: 700, borderRadius: '8px', cursor: cid && canCalc && !saving ? 'pointer' : 'not-allowed', backgroundColor: cid && canCalc && !saving ? '#1E3A5F' : '#9CA3AF', color: '#fff', border: 'none', boxShadow: cid && canCalc && !saving ? '0 2px 6px rgba(30,58,95,0.25)' : 'none' }}>
                {saving ? '저장 중...' : '은퇴플랜 저장'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '13px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
            입력값을 입력하고 [계산] 버튼을 눌러주세요.
          </div>
        )}
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, padding: '12px 24px', borderRadius: 8, backgroundColor: toast.t === 'success' ? '#1E3A5F' : '#EF4444', color: '#fff', fontSize: 14, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', pointerEvents: 'none' }}>{toast.m}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  서브                                                               */
/* ------------------------------------------------------------------ */
const TH: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' };
const TC: React.CSSProperties = { padding: '8px 10px', textAlign: 'center', fontSize: '13px' };
const TR: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter, monospace', fontSize: '13px' };

function R({ label, value, hl, rate }: { label: string; value: string; hl?: boolean; rate?: boolean }) {
  return (<tr style={{ borderBottom: '1px solid #F3F4F6' }}>
    <td style={{ padding: '8px 10px', fontSize: '12px', color: '#374151', fontWeight: hl ? 600 : 400 }}>{label}</td>
    <td style={{ padding: '8px 10px', fontSize: '13px', textAlign: 'right', fontFamily: 'Inter, monospace', color: hl ? '#1E3A5F' : rate ? '#059669' : '#1A1A2E', fontWeight: hl ? 700 : 500 }}>{value}</td>
  </tr>);
}

function F({ label, unit, value, onChange, disabled, readOnly, isCurrency }: { label: string; unit: string; value: string; onChange?: (v: string) => void; disabled?: boolean; readOnly?: boolean; isCurrency?: boolean }) {
  return (<div><span style={{ ...LS, display: 'block', marginBottom: '4px' }}>{label}</span><div style={{ position: 'relative' }}>
    <input type="text" inputMode={isCurrency ? 'numeric' : undefined} value={value} readOnly={readOnly} onChange={onChange ? e => onChange(e.target.value) : undefined} disabled={disabled} style={{ ...IS, ...(readOnly ? { backgroundColor: '#F9FAFB', color: '#6B7280' } : {}) }} />
    <span style={US}>{unit}</span></div></div>);
}

function Tog({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (<label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#6B7280', cursor: 'pointer' }}>
    <span>{label}</span>
    <button type="button" onClick={onChange} style={{ width: 32, height: 18, borderRadius: 9, border: 'none', backgroundColor: checked ? '#1E3A5F' : '#D1D5DB', cursor: 'pointer', position: 'relative', transition: 'background-color 0.2s' }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
    </button>
  </label>);
}

export default DesiredPlanTab;
