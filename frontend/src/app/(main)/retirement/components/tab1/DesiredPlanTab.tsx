'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

const GrowthChart = dynamic(() => import('./GrowthChart'), { ssr: false });

/* ================================================================
   ECOS
   ================================================================ */
const ECOS_DEFAULT = 2.5;
async function fetchInflation(): Promise<number> {
  try {
    const r = await fetch(`${API_URL}/api/v1/retirement/inflation-rate`, { headers: authLib.getAuthHeader() });
    if (r.ok) { const d = await r.json(); return d.rate ?? ECOS_DEFAULT; }
  } catch { /* */ }
  return ECOS_DEFAULT;
}

/* ================================================================
   금융 함수
   ================================================================ */
function excelPV(rate: number, nper: number, pmt: number, fv = 0, type = 0) {
  if (rate === 0) return -(fv + pmt * nper);
  const pvif = Math.pow(1 + rate, nper);
  return (-fv - pmt * (pvif - 1) / rate * (1 + rate * type)) / pvif;
}
function excelFV(rate: number, nper: number, pmt: number, pv = 0) {
  if (rate === 0) return -(pv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -pv * f - pmt * (f - 1) / rate;
}

function calcTargetFund(fmWon: number, penR: number, infR: number, period: number, withInfl: boolean) {
  if (fmWon <= 0 || period <= 0) return 0;
  const nper = period * 12;
  const mr = withInfl ? ((1 + penR) / (1 + infR) - 1) / 12 : penR / 12;
  if (mr <= 0) return fmWon * nper;
  return -excelPV(mr, nper, fmWon, 0, 1);
}

function calcRequiredHolding(target: number, annR: number, savP: number, holdP: number, annSav: number) {
  if (target <= 0 || annR <= 0 || savP <= 0) return 0;
  const r = annR / 12;
  const innerPV = excelPV(r, holdP * 12, 0, -target);
  return -excelPV(r, savP * 12, -annSav / 12, innerPV);
}

/* ================================================================
   포맷
   ================================================================ */
function fmt(n: number) { return n.toLocaleString('ko-KR'); }
function fmtW(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (Math.abs(n) >= 1e4) return `${fmt(Math.round(n / 1e4))}만원`;
  return `${fmt(Math.round(n))}원`;
}
function pn(s: string) { return parseInt(s.replace(/\D/g, ''), 10) || 0; }
function fi(s: string) { const n = pn(s); return n > 0 ? fmt(n) : ''; }

/* ================================================================
   시뮬레이션 빌더
   ================================================================ */
interface SimRow {
  year: number; age: number; phase: 'saving' | 'holding' | 'retirement';
  monthly_payment: number; additional: number;
  evaluation: number; cumulative_principal: number; investment_return: number;
  pension: number;
}

function buildSim(p: {
  startAge: number; retAge: number; savP: number;
  annSav: number; holding: number; investR: number;
  penR: number; fmWon: number; infR: number; withInfl: boolean;
  overrides?: Record<number, { monthly?: number; additional?: number }>;
}): SimRow[] {
  const invYrs = p.retAge - p.startAge;
  if (invYrs <= 0 || p.investR <= 0) return [];
  const mr = p.investR / 12;
  const rows: SimRow[] = [];
  let prev = 0, cumP = 0;

  for (let i = 0; i < invYrs; i++) {
    const yr = i + 1, age = p.startAge + i;
    const isSav = i < p.savP;
    const ov = p.overrides?.[yr];
    const mp = ov?.monthly !== undefined ? ov.monthly * 1e4 : (isSav ? p.annSav / 12 : 0);
    const ad = ov?.additional !== undefined ? ov.additional * 1e4 : (i === 0 ? p.holding : 0);
    const ev = excelFV(mr, 12, -mp, -(prev + ad));
    cumP += mp * 12 + ad;
    rows.push({ year: yr, age, phase: isSav ? 'saving' : 'holding', monthly_payment: mp, additional: ad,
      evaluation: Math.round(ev), cumulative_principal: Math.round(cumP), investment_return: Math.round(ev - cumP), pension: 0 });
    prev = ev;
  }

  const annPen = p.fmWon * 12;
  let depleted = false;
  for (let age = p.retAge; age <= 130; age++) {
    const yrs = age - p.retAge;
    if (depleted) {
      rows.push({ year: invYrs + yrs + 1, age, phase: 'retirement', monthly_payment: 0, additional: 0,
        evaluation: 0, cumulative_principal: Math.round(cumP), investment_return: Math.round(-cumP), pension: 0 });
    } else {
      const pen = annPen > 0 ? (p.withInfl ? annPen * Math.pow(1 + p.infR, yrs) : annPen) : 0;
      const ev = Math.max(0, (prev - pen) * (1 + p.penR));
      rows.push({ year: invYrs + yrs + 1, age, phase: 'retirement', monthly_payment: 0, additional: 0,
        evaluation: Math.round(ev), cumulative_principal: Math.round(cumP), investment_return: Math.round(ev - cumP), pension: Math.round(pen) });
      prev = ev;
      if (ev <= 0) depleted = true;
    }
  }
  return rows;
}

/* ================================================================
   스타일
   ================================================================ */
const SH: React.CSSProperties = {
  background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A8E 100%)',
  color: '#fff', padding: '14px 20px', borderRadius: '12px 12px 0 0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: '15px',
};
const SB: React.CSSProperties = {
  border: '1px solid #D1D5DB', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '20px', backgroundColor: '#FAFBFC',
};
const CARD: React.CSSProperties = { backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px' };
const CARD_G: React.CSSProperties = { background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '12px 14px' };
const CL: React.CSSProperties = { fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 500 };
const CV: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: '#1E3A5F', fontFamily: 'Inter, monospace' };
const IS: React.CSSProperties = {
  width: '100%', height: '32px', padding: '0 52px 0 10px', fontSize: '14px', color: '#1A1A2E',
  backgroundColor: '#fff', border: '1px solid #D1D5DB', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', textAlign: 'right',
};
const US: React.CSSProperties = { position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#9CA3AF', pointerEvents: 'none' };
const TC: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: '13px' };
const TRs: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontFamily: 'Inter, monospace', fontSize: '13px' };

/* ================================================================
   메인 컴포넌트
   ================================================================ */
export function DesiredPlanTab() {
  const { selectedCustomer, setCustomer } = useRetirementStore();
  const cid = selectedCustomer?.id ?? null;
  const curAge = selectedCustomer?.currentAge ?? 0;

  // 목표 은퇴자금
  const [planStartYear, setPSY] = useState(String(new Date().getFullYear()));
  const [raIn, setRaIn] = useState('60');
  const [mIn, setMIn] = useState('1,000');
  const [infIn, setInfIn] = useState('2.5');
  const [penRIn, setPenRIn] = useState('2.0');
  const [rpIn, setRpIn] = useState('40');
  const [tog1, setTog1] = useState(false);
  const [tog2, setTog2] = useState(false);

  // 투자조건
  const [spIn, setSpIn] = useState('');
  const [exRIn, setExRIn] = useState('');
  const [asIn, setAsIn] = useState('');
  const [recPIn, setRecPIn] = useState('');
  const [recRIn, setRecRIn] = useState('');
  const [holdIn, setHoldIn] = useState('');

  const [applyReqHold, setApplyReqHold] = useState(false); // 필요 거치금액 적용 체크박스

  // 시스템
  const [ecos, setEcos] = useState(ECOS_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTbl, setShowTbl] = useState(false);
  const [tblData, setTblData] = useState<SimRow[]>([]);
  const [overrides, setOv] = useState<Record<number, { monthly?: number; additional?: number }>>({});
  const [toast, setToast] = useState<{ m: string; t: 'success' | 'error' } | null>(null);
  const show = (m: string, t: 'success' | 'error') => { setToast({ m, t }); setTimeout(() => setToast(null), 3000); };

  // 파싱
  const monthly = pn(mIn);
  const retAge = parseInt(raIn) || 60;
  const retPeriod = parseInt(rpIn) || 40;
  const savYrs = parseInt(spIn) || 0;
  const infRate = parseFloat(infIn) || ecos;
  const penRate = parseFloat(penRIn) || 2;
  const exRate = parseFloat(exRIn) || 0;
  const annSav = pn(asIn);
  const recPenR = parseFloat(recPIn) || 0;
  const recRetR = parseFloat(recRIn) || 0;
  const holdAmt = pn(holdIn);

  const pSY = parseInt(planStartYear) || new Date().getFullYear();
  const startAge = curAge > 0 ? curAge - (new Date().getFullYear() - pSY) : 0;
  const invYrs = startAge > 0 && retAge > startAge ? retAge - startAge : 0;
  const holdYrs = invYrs > savYrs ? invYrs - savYrs : 0;

  const yrsToRet = curAge > 0 && retAge > curAge ? retAge - curAge : 0;
  const futureM = monthly > 0 && yrsToRet > 0
    ? (tog1 ? Math.round(monthly * Math.pow(1 + infRate / 100, yrsToRet)) : monthly) : monthly;
  const fmWon = futureM * 1e4;

  // 실시간 계산
  const targetFund = useMemo(() =>
    calcTargetFund(fmWon, penRate / 100, infRate / 100, retPeriod, tog2),
    [fmWon, penRate, infRate, retPeriod, tog2]);

  const reqHold = useMemo(() => {
    if (targetFund <= 0 || exRate <= 0 || invYrs <= 0 || savYrs <= 0) return 0;
    return Math.max(0, calcRequiredHolding(targetFund, exRate / 100, savYrs, holdYrs, annSav * 1e4));
  }, [targetFund, exRate, savYrs, holdYrs, annSav, invYrs]);

  // 기존 플랜
  const simOrig = useMemo(() => {
    if (exRate <= 0 || invYrs <= 0 || startAge <= 0) return [];
    return buildSim({ startAge, retAge, savP: savYrs, annSav: annSav * 1e4, holding: reqHold,
      investR: exRate / 100, penR: penRate / 100, fmWon, infR: infRate / 100, withInfl: tog2 });
  }, [startAge, retAge, savYrs, annSav, reqHold, exRate, penRate, fmWon, infRate, tog2, invYrs]);

  // 수정 플랜
  const modIR = recRetR > 0 ? recRetR : exRate;
  const modPR = recPenR > 0 ? recPenR : penRate;
  const hasMod = recPenR > 0 || recRetR > 0 || holdAmt > 0 || applyReqHold;

  // Step 1: 수정 기본 목표 = 추천 연금수익률 기반 영구연금 공식
  const modBaseTarget = useMemo(() => {
    if (recPenR <= 0) return targetFund;
    const rp = recPenR / 100, ir = infRate / 100;
    if (rp > ir && fmWon > 0) {
      const annPen = fmWon * 12;
      return annPen * (1 + rp) / (rp - ir); // 영구연금 공식
    }
    return calcTargetFund(fmWon, rp, ir, retPeriod, tog2); // fallback: PV 40년
  }, [recPenR, infRate, fmWon, retPeriod, tog2, targetFund]);

  // Step 2: 수정 플랜 필요 거치금액 = 추천 투자수익률로 수정 기본 목표 도달
  const modReqHold = useMemo(() => {
    if (recRetR <= 0 || modBaseTarget <= 0 || invYrs <= 0 || savYrs <= 0) return reqHold;
    return Math.max(0, calcRequiredHolding(modBaseTarget, recRetR / 100, savYrs, holdYrs, annSav * 1e4));
  }, [recRetR, modBaseTarget, savYrs, holdYrs, annSav, invYrs, reqHold]);

  // 거치 가능금액 실제값
  const effectiveHoldWon = applyReqHold ? modReqHold : holdAmt * 1e4;

  // 수정 플랜 holding 결정:
  // 기본: modReqHold (추천 수익률로 수정 목표 도달)
  // 거치 가능금액 입력 시: Case 1(부족) / Case 2(초과) 적용
  const modHolding = useMemo(() => {
    if (!hasMod || effectiveHoldWon <= 0) return modReqHold;
    return modReqHold >= effectiveHoldWon ? modReqHold : effectiveHoldWon;
  }, [hasMod, effectiveHoldWon, modReqHold]);

  const extraHolding = useMemo(() => {
    if (!hasMod || effectiveHoldWon <= 0) return 0;
    return modReqHold > effectiveHoldWon ? modReqHold - effectiveHoldWon : 0;
  }, [hasMod, effectiveHoldWon, modReqHold]);

  const simMod = useMemo(() => {
    if (!hasMod || modIR <= 0 || invYrs <= 0 || startAge <= 0) return [];
    return buildSim({ startAge, retAge, savP: savYrs, annSav: annSav * 1e4, holding: modHolding,
      investR: modIR / 100, penR: modPR / 100, fmWon, infR: infRate / 100, withInfl: tog2 });
  }, [hasMod, startAge, retAge, savYrs, annSav, modHolding, modIR, modPR, fmWon, infRate, tog2, invYrs]);

  // 수정 플랜의 은퇴 시점 실제 평가금액 (시뮬레이션 결과)
  const modRetireFund = useMemo(() => {
    if (!simMod.length) return 0;
    const lastInv = simMod.filter(r => r.phase !== 'retirement').pop();
    return lastInv?.evaluation ?? 0;
  }, [simMod]);

  // Step 3: 최종 수정 목표 = 시뮬 축적액이 기본 목표 초과 시 축적액으로 업데이트
  // (거치 가능금액 초과 or 적립 가능금액 초과로 기본 목표 이상 축적된 경우)
  const modTargetFund = useMemo(() => {
    if (modRetireFund > modBaseTarget) return modRetireFund; // 초과 축적 → 실제 축적액
    return modBaseTarget; // 기본 목표 유지
  }, [modRetireFund, modBaseTarget]);

  // 수정 목표가 기본 목표보다 큰지 (초과 축적 여부)
  const isTargetOvershot = modRetireFund > modBaseTarget && modRetireFund > 0;

  const inheritance = useMemo(() => {
    const rows = hasMod ? simMod : simOrig;
    return rows.find(r => r.age === 100)?.evaluation ?? 0;
  }, [simOrig, simMod, hasMod]);

  // 그래프 데이터: 소진 후 선 끊김, 가로축은 둘 중 긴 쪽 (최대 130세)
  const gData = useMemo(() => {
    // 소진 시점 찾기 (evaluation이 0이 된 첫 age)
    const findEnd = (rows: SimRow[]) => {
      for (const r of rows) {
        if (r.phase === 'retirement' && r.evaluation <= 0) return r.age;
      }
      return 999; // 소진 안 됨
    };
    const origEnd = findEnd(simOrig);
    const modEnd = findEnd(simMod);
    const maxAge = 100;

    const m: Record<number, { original?: number; modified?: number; principal?: number }> = {};
    // 기존: 소진 시점까지만 값, 100세 이하
    for (const r of simOrig) {
      if (r.age > maxAge || r.age > origEnd) break;
      m[r.age] = { original: Math.round(r.evaluation / 1e4) };
    }
    // 수정: 소진 시점까지만 값, 100세 이하
    if (hasMod) {
      for (const r of simMod) {
        if (r.age > maxAge || r.age > modEnd) break;
        if (!m[r.age]) m[r.age] = {};
        m[r.age].modified = Math.round(r.evaluation / 1e4);
      }
    }
    // 원금: 100세 이하
    const pSrc = hasMod ? simMod : simOrig;
    for (const r of pSrc) {
      if (r.age > maxAge) break;
      if (!m[r.age]) m[r.age] = {};
      m[r.age].principal = Math.round(r.cumulative_principal / 1e4);
    }
    // 가로축을 maxAge까지 채우기 (빈 age도 포함)
    const startAge = simOrig.length ? simOrig[0].age : 0;
    for (let age = startAge; age <= maxAge; age++) {
      if (!m[age]) m[age] = {};
    }
    return Object.entries(m).map(([a, d]) => ({ age: parseInt(a), ...d })).sort((a, b) => a.age - b.age);
  }, [simOrig, simMod, hasMod]);

  // ECOS & Load
  useEffect(() => { fetchInflation().then(r => { setEcos(r); setInfIn(r.toFixed(1)); }); }, []);

  const load = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, { headers: authLib.getAuthHeader() });
      if (r.ok) {
        const d = await r.json(); const p = d.calculation_params || {};
        const cvm = d.current_value_monthly ?? d.monthly_desired_amount;
        if (cvm) setMIn(fmt(Math.round(cvm / 1e4)));
        if (p.retirement_period_years) setRpIn(String(p.retirement_period_years));
        if (p.retirement_age) setRaIn(String(p.retirement_age));
        if (p.inflation_rate) setInfIn(((p.inflation_rate * 100) as number).toFixed(1));
        if (p.pension_return_rate) setPenRIn(((p.pension_return_rate * 100) as number).toFixed(1));
        else if (p.base_pension_rate) setPenRIn(((p.base_pension_rate * 100) as number).toFixed(1));
        if (p.savings_period) setSpIn(String(p.savings_period));
        if (p.existing_return_rate) setExRIn(((p.existing_return_rate * 100) as number).toFixed(1));
        else if (p.expected_return_rate) setExRIn(((p.expected_return_rate * 100) as number).toFixed(1));
        if (p.annual_savings) setAsIn(fmt(Math.round(p.annual_savings / 1e4)));
        if (p.recommended_pension_rate) setRecPIn(((p.recommended_pension_rate * 100) as number).toFixed(1));
        if (p.recommended_return_rate) setRecRIn(((p.recommended_return_rate * 100) as number).toFixed(1));
        if (p.available_holding) setHoldIn(fmt(Math.round(p.available_holding / 1e4)));
        if (d.use_inflation_input !== undefined) setTog1(!!d.use_inflation_input);
        if (d.use_inflation_calc !== undefined) setTog2(!!d.use_inflation_calc);
        if (d.plan_start_year) setPSY(String(d.plan_start_year));
        const saved = d.simulation_data ?? p.modified_plan;
        if (saved?.length) { setTblData(saved); setShowTbl(true); }
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  // 테이블 생성 (계산 버튼)
  function handleCalc() {
    const sim = buildSim({ startAge, retAge, savP: savYrs, annSav: annSav * 1e4, holding: modHolding,
      investR: modIR / 100, penR: modPR / 100, fmWon, infR: infRate / 100, withInfl: tog2, overrides });
    setTblData(sim); setShowTbl(true); setOv({});
  }

  // overrides 반영 테이블
  const dispTbl = useMemo(() => {
    if (!tblData.length) return [];
    if (!Object.keys(overrides).length) return tblData;
    return buildSim({ startAge, retAge, savP: savYrs, annSav: annSav * 1e4, holding: modHolding,
      investR: modIR / 100, penR: modPR / 100, fmWon, infR: infRate / 100, withInfl: tog2, overrides });
  }, [tblData, overrides, startAge, retAge, savYrs, annSav, modHolding, modIR, modPR, fmWon, infRate, tog2]);

  // 프로필 확보
  async function ensureProfile() {
    if (!cid) return false;
    try {
      const c = await fetch(`${API_URL}/api/v1/retirement/profiles/${cid}`, { headers: authLib.getAuthHeader() });
      if (c.ok || c.status === 403) return true;
      if (c.status === 404) {
        const cr = await fetch(`${API_URL}/api/v1/retirement/profiles`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ customer_id: cid, current_age: curAge || 35, age_at_design: curAge || 35, desired_retirement_age: retAge }),
        });
        return cr.ok || cr.status === 409;
      }
    } catch { /* */ }
    return false;
  }

  async function handleSave() {
    if (!cid) { show('고객을 먼저 선택하세요.', 'error'); return; }
    if (monthly <= 0) { show('현재가치 연금액을 입력해주세요.', 'error'); return; }
    setSaving(true);
    try {
      if (!(await ensureProfile())) { show('프로필 생성 실패', 'error'); setSaving(false); return; }
      const simRows = dispTbl.length > 0 ? dispTbl : (hasMod ? simMod : simOrig);
      const body = {
        monthly_desired_amount: fmWon, retirement_age: retAge, current_age: curAge,
        retirement_period_years: retPeriod, savings_period: savYrs, annual_savings: annSav * 1e4,
        plan_start_age: startAge > 0 ? startAge : curAge,
        inflation_rate: infRate / 100, pension_return_rate: penRate / 100,
        expected_return_rate: exRate > 0 ? exRate / 100 : modIR / 100,
        with_inflation: tog2,
        current_value_monthly: monthly * 1e4, future_monthly_amount: fmWon,
        use_inflation_input: tog1, use_inflation_calc: tog2,
        desired_retirement_age: retAge, savings_period_years: savYrs, holding_period_years: holdYrs,
        annual_savings_amount: annSav * 1e4, plan_start_year: pSY,
        simulation_data: simRows, simulation_target_fund: Math.round(modTargetFund),
        target_fund_pv: Math.round(targetFund),
        existing_return_rate: exRate / 100,
        recommended_return_rate: recRetR > 0 ? recRetR / 100 : undefined,
        recommended_pension_rate: recPenR > 0 ? recPenR / 100 : undefined,
        available_holding: holdAmt * 1e4,
        base_pension_rate: penRate / 100,
        original_plan: simOrig, modified_plan: hasMod ? simMod : undefined,
      };
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        if (selectedCustomer) setCustomer({ ...selectedCustomer, retirementAge: retAge, targetFund: Math.round(modTargetFund / 1e4) });
        show('저장이 완료되었습니다.', 'success');
      } else { const e = await r.json().catch(() => ({})); show(String((e as Record<string, unknown>).detail || '저장 실패'), 'error'); }
    } catch { show('네트워크 오류', 'error'); } finally { setSaving(false); }
  }

  function setOvF(yr: number, field: 'monthly' | 'additional', val: string) {
    setOv(prev => ({ ...prev, [yr]: { ...prev[yr], [field]: pn(val) } }));
  }

  const canCalc = monthly > 0 && (exRate > 0 || modIR > 0) && invYrs > 0;

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* ==================== 목표 은퇴자금 ==================== */}
      <div>
        <div style={SH}>
          <span>목표 은퇴자금</span>
          <div style={{ display: 'flex', gap: '16px' }}>
            <Tog label="연금액 물가반영" c={tog1} f={() => setTog1(!tog1)} />
            <Tog label="목표 물가반영" c={tog2} f={() => setTog2(!tog2)} />
          </div>
        </div>
        <div style={SB}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <InC label="플랜 시작연도" u="년" v={planStartYear} f={v => setPSY(v.replace(/\D/g, ''))} />
            <InC label="희망 은퇴나이" u="세" v={raIn} f={v => setRaIn(v.replace(/\D/g, ''))}
              sub={invYrs > 0 ? `총 투자기간: ${invYrs}년` : ''} />
            <InC label="현재가치 연금액(월)" u="만원/월" v={mIn} f={v => setMIn(fi(v))} cur />
            <IfC label="은퇴당시 연금액(월)" v={futureM > 0 ? `${fmt(futureM)}만원/월` : '-'}
              sub={tog1 ? `물가 ${infRate}% × ${yrsToRet}년 반영` : '물가 미반영'} g />

            <InC label="물가상승률" u="%" v={infIn} f={v => setInfIn(v.replace(/[^\d.]/g, ''))}
              sub={`한국은행 기준 ${ecos.toFixed(1)}%`} />
            <InC label="연금 수익률" u="%" v={penRIn} f={v => setPenRIn(v.replace(/[^\d.]/g, ''))} />
            <InC label="연금 수령기간" u="년" v={rpIn} f={v => setRpIn(v.replace(/\D/g, ''))} />
            <IfC label="목표 은퇴자금" v={targetFund > 0 ? fmtW(targetFund) : '-'}
              sub={tog2 ? '물가반영 계산' : '물가 미반영'} g hl />
          </div>
        </div>
      </div>

      {/* ==================== 투자조건 ==================== */}
      <div>
        <div style={SH}><span>투자조건</span></div>
        <div style={SB}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <InC label="적립기간" u="년" v={spIn} f={v => setSpIn(v.replace(/\D/g, ''))}
              sub={holdYrs > 0 ? `거치기간: ${holdYrs}년` : ''} subC="#D4A847" />
            <InC label="기존 투자수익률" u="%" v={exRIn} f={v => setExRIn(v.replace(/[^\d.]/g, ''))} />
            <InC label="적립 가능금액(연)" u="만원/연" v={asIn} f={v => setAsIn(fi(v))} cur />
            <div style={recRetR > 0 ? { ...CARD_G, background: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)', border: '1px solid #FDBA74' } : CARD_G}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={CL}>필요 거치금액</div>
                {(recRetR > 0 ? modReqHold : reqHold) > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: recRetR > 0 ? '#EA580C' : '#059669', fontWeight: 600 }}>
                    <input type="checkbox" checked={applyReqHold}
                      onChange={e => {
                        setApplyReqHold(e.target.checked);
                        if (e.target.checked) setHoldIn(fmt(Math.round(modReqHold / 1e4)));
                      }}
                      style={{ width: 14, height: 14, accentColor: recRetR > 0 ? '#EA580C' : '#059669', cursor: 'pointer' }} />
                    거치적용
                  </label>
                )}
              </div>
              <div style={CV}>{recRetR > 0
                ? (modReqHold > 0 ? `${fmt(Math.round(modReqHold / 1e4))}만원` : '0원 (적립만 충분)')
                : (reqHold > 0 ? `${fmt(Math.round(reqHold / 1e4))}만원` : '0원')
              }</div>
              <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>
                {recRetR > 0 ? `추천수익률 ${recRetR}% → 수정목표 기준` : '기존수익률 기준 계산'}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <InC label="추천 연금수익률" u="%" v={recPIn} f={v => setRecPIn(v.replace(/[^\d.]/g, ''))} ph="미입력시 기존" />
            <InC label="추천 투자수익률" u="%" v={recRIn} f={v => setRecRIn(v.replace(/[^\d.]/g, ''))} ph="미입력시 기존" />
            <InC label="거치 가능금액" u="만원" v={holdIn} f={v => { setHoldIn(fi(v)); setApplyReqHold(false); }} cur />
            {extraHolding > 0 ? (
              <IfC label="추가 거치금액" v={fmtW(extraHolding)} sub="필요 거치금액 - 거치 가능금액" g />
            ) : recPenR > 0 ? (
              <div style={isTargetOvershot
                ? { background: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)', border: '2px solid #F97316', borderRadius: '8px', padding: '12px 14px' }
                : CARD_G}>
                <div style={CL}>수정 목표 은퇴자금</div>
                <div style={{ ...CV, color: isTargetOvershot ? '#EA580C' : '#059669' }}>
                  {modTargetFund > 0 ? fmtW(modTargetFund) : '-'}
                </div>
                <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>
                  {isTargetOvershot
                    ? `투자초과 (기본목표: ${fmtW(modBaseTarget)})`
                    : modPR / 100 > infRate / 100 ? '영구연금 기준' : 'PV 40년 기준'}
                </div>
              </div>
            ) : <div />}
          </div>
        </div>
      </div>

      {/* ==================== 시뮬레이션 그래프 ==================== */}
      {gData.length > 0 && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E3A5F', margin: '0 0 12px' }}>시뮬레이션 그래프</h3>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '12px' }}>
            <LG color="#1E3A5F" label="기존 은퇴플랜" />
            {hasMod && <LG color="#E85D04" label="수정 은퇴플랜" />}
            <LG color="#9CA3AF" label="투자원금" dash />
          </div>
          <GrowthChart data={gData} retirementAge={retAge} showModified={hasMod} savingsEndAge={startAge + savYrs} />
        </div>
      )}

      {/* ==================== 목표 은퇴플랜 ==================== */}
      <div>
        <div style={SH}><span>목표 은퇴플랜</span></div>
        <div style={SB}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <IfC label="목표 은퇴자금" v={modTargetFund > 0 ? fmtW(modTargetFund) : '-'}
              sub={modTargetFund !== targetFund ? '거치 가능금액 기준' : ''} />
            <IfC label="은퇴당시 연금액(월)" v={futureM > 0 ? `${fmt(futureM)}만원/월` : '-'} />
            <IfC label="기대 투자수익률" v={modIR > 0 ? `${modIR.toFixed(1)}%` : '-'} hl />
            <IfC label="기대 연금수익률" v={modPR > 0 ? `${modPR.toFixed(1)}%` : '-'} hl />
            <IfC label="투자기간" v={invYrs > 0 ? `${invYrs}년 (적립 ${savYrs} + 거치 ${holdYrs})` : '-'} />
            <IfC label="적립금액(연)" v={annSav > 0 ? `${fmt(annSav)}만원/연` : '-'} />
            {/* 연거치 금액: 실제 시뮬에 적용된 modHolding 기준 */}
            <div style={holdAmt > 0 && extraHolding > 0 ? CARD_G : holdAmt > 0 && holdAmt * 1e4 > modReqHold ? { ...CARD, background: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)', border: '1px solid #FDBA74' } : { ...CARD, backgroundColor: '#F8FAFC' }}>
              <div style={CL}>연거치 금액</div>
              {holdAmt > 0 && extraHolding > 0 ? (<>
                {/* Case1: 필요거치 > 거치가능 (부족) */}
                <div style={CV}>{fmtW(modReqHold)}</div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px', lineHeight: 1.5 }}>
                  거치 가능: {fmtW(holdAmt * 1e4)}<br/>
                  <span style={{ color: '#EF4444', fontWeight: 600 }}>추가 필요: {fmtW(extraHolding)}</span>
                </div>
              </>) : holdAmt > 0 && holdAmt * 1e4 > modReqHold ? (<>
                {/* Case2: 거치가능 > 필요거치 (초과) */}
                <div style={{ ...CV, color: '#EA580C' }}>{fmtW(holdAmt * 1e4)}</div>
                <div style={{ fontSize: '10px', color: '#EA580C', marginTop: '4px' }}>거치 가능금액 적용 (초과투자)</div>
              </>) : (
                <div style={CV}>{modHolding > 0 ? fmtW(modHolding) : '-'}</div>
              )}
            </div>
            <IfC label="상속금액" v={inheritance > 0 ? fmtW(inheritance) : '0원'} sub="100세 평가금액" hl />
          </div>
        </div>
      </div>

      {/* ==================== 계산 버튼 ==================== */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={handleCalc} disabled={!canCalc}
          style={{ padding: '12px 0', width: '30%', fontSize: '14px', fontWeight: 700, borderRadius: '8px',
            cursor: canCalc ? 'pointer' : 'not-allowed', backgroundColor: canCalc ? '#1E3A5F' : '#9CA3AF',
            color: '#fff', border: 'none', boxShadow: canCalc ? '0 2px 8px rgba(30,58,95,0.3)' : 'none' }}>
          계산
        </button>
      </div>

      {/* ==================== 은퇴플랜 시뮬레이션 ==================== */}
      {showTbl && dispTbl.length > 0 && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E3A5F', margin: 0 }}>은퇴플랜 시뮬레이션</h3>
            <button onClick={() => setOv({})}
              style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, color: '#EF4444', backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer' }}>수정 초기화</button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '500px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['연도','연차','나이','구분','월적립(만)','거치(만)','연금인출','누적원금','평가금액'].map(h => (
                    <th key={h} style={{ padding: '8px', borderBottom: '2px solid #E5E7EB',
                      textAlign: ['연도','연차','나이','구분'].includes(h) ? 'center' : 'right',
                      fontWeight: 600, color: h === '연금인출' ? '#DC2626' : '#6B7280', whiteSpace: 'nowrap',
                      backgroundColor: '#F9FAFB', fontSize: '12px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispTbl.map(r => {
                  const ov = overrides[r.year];
                  const mpM = Math.round(r.monthly_payment / 1e4);
                  const adM = Math.round(r.additional / 1e4);
                  const isRA = r.age === retAge;
                  const is100 = r.age === 100;
                  const isHL = isRA || is100;
                  const pc = r.phase === 'saving' ? '#1E3A5F' : r.phase === 'holding' ? '#D4A847' : '#16A34A';
                  const pl = r.phase === 'saving' ? '적립' : r.phase === 'holding' ? '거치' : '은퇴후';
                  const bg = isRA ? 'rgba(30,58,95,0.12)' : is100 ? 'rgba(220,38,38,0.08)' : r.phase === 'saving' ? '#EFF6FF' : r.phase === 'holding' ? '#FFFBEB' : '#F0FDF4';
                  return (
                    <tr key={r.year} style={{ borderBottom: isHL ? '2px solid' : '1px solid #F3F4F6', borderBottomColor: isRA ? '#1E3A5F' : is100 ? '#DC2626' : undefined, backgroundColor: bg }}>
                      <td style={{ ...TC, fontSize: 11, color: '#9CA3AF' }}>{pSY + r.year - 1}</td>
                      <td style={TC}>{r.year}</td>
                      <td style={{ ...TC, fontWeight: isHL ? 700 : 400, color: isRA ? '#1E3A5F' : is100 ? '#DC2626' : '#374151' }}>{r.age}세{isRA && ' ★'}{is100 && ' ★'}</td>
                      <td style={{ ...TC, color: pc, fontWeight: 600 }}>{pl}</td>
                      <td style={TRs}>
                        {r.phase !== 'retirement' ? (
                          <input type="text" inputMode="numeric"
                            value={ov?.monthly !== undefined ? fi(String(ov.monthly)) : (mpM > 0 ? fmt(mpM) : '-')}
                            onChange={e => setOvF(r.year, 'monthly', e.target.value)}
                            style={{ ...IS, width: '90px', height: '28px', fontSize: '12px', padding: '0 6px',
                              border: ov?.monthly !== undefined ? '2px solid #3B82F6' : '1px solid #E5E7EB' }} />
                        ) : '-'}
                      </td>
                      <td style={TRs}>
                        {r.phase !== 'retirement' ? (
                          <input type="text" inputMode="numeric"
                            value={ov?.additional !== undefined ? fi(String(ov.additional)) : (adM > 0 ? fmt(adM) : '')}
                            onChange={e => setOvF(r.year, 'additional', e.target.value)}
                            style={{ ...IS, width: '90px', height: '28px', fontSize: '12px', padding: '0 6px',
                              border: ov?.additional !== undefined ? '2px solid #3B82F6' : '1px solid #E5E7EB' }} />
                        ) : '-'}
                      </td>
                      <td style={{ ...TRs, color: r.pension > 0 ? '#DC2626' : '#9CA3AF' }}>
                        {r.pension > 0 ? fmt(Math.round(r.pension / 1e4)) : '-'}
                      </td>
                      <td style={TRs}>{fmt(Math.round(r.cumulative_principal / 1e4))}</td>
                      <td style={{ ...TRs, fontWeight: 700, color: isRA ? '#1E3A5F' : is100 ? '#DC2626' : '#1E3A5F', fontSize: isHL ? '14px' : '13px' }}>{fmt(Math.round(r.evaluation / 1e4))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>(단위: 만원) 파란 테두리 = 수정된 값</div>
          </div>
        </div>
      )}

      {/* ==================== 저장 버튼 ==================== */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={handleSave} disabled={!cid || monthly <= 0 || saving}
          style={{ padding: '12px 0', width: '30%', fontSize: '14px', fontWeight: 700, borderRadius: '8px',
            cursor: cid && !saving ? 'pointer' : 'not-allowed',
            backgroundColor: cid && !saving ? '#059669' : '#9CA3AF', color: '#fff', border: 'none',
            boxShadow: cid && !saving ? '0 2px 8px rgba(5,150,105,0.3)' : 'none' }}>
          {saving ? '저장 중...' : '은퇴플랜 저장'}
        </button>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        padding: '12px 24px', borderRadius: 8, backgroundColor: toast.t === 'success' ? '#1E3A5F' : '#EF4444',
        color: '#fff', fontSize: 14, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>{toast.m}</div>}
    </div>
  );
}

/* ================================================================
   서브 컴포넌트
   ================================================================ */
function InC({ label, u, v, f, cur, sub, subC, ph }: {
  label: string; u: string; v: string; f: (v: string) => void;
  cur?: boolean; sub?: string; subC?: string; ph?: string;
}) {
  return (
    <div style={CARD}>
      <div style={CL}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input type="text" inputMode={cur ? 'numeric' : undefined} value={v} onChange={e => f(e.target.value)}
          placeholder={ph} style={IS} />
        <span style={US}>{u}</span>
      </div>
      {sub && <div style={{ fontSize: '10px', color: subC || '#9CA3AF', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function IfC({ label, v, sub, g, hl }: {
  label: string; v: string; sub?: string; g?: boolean; hl?: boolean;
}) {
  return (
    <div style={g ? CARD_G : { ...CARD, backgroundColor: '#F8FAFC' }}>
      <div style={CL}>{label}</div>
      <div style={{ ...CV, ...(hl ? { color: '#059669' } : {}), fontSize: v.length > 12 ? '14px' : v.length > 8 ? '16px' : '18px' }}>{v}</div>
      {sub && <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function Tog({ label, c, f }: { label: string; c: boolean; f: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
      <span>{label}</span>
      <button type="button" onClick={f} style={{ width: 36, height: 20, borderRadius: 10, border: 'none',
        backgroundColor: c ? '#10B981' : 'rgba(255,255,255,0.3)', cursor: 'pointer', position: 'relative', transition: 'background-color 0.2s' }}>
        <span style={{ position: 'absolute', top: 2, left: c ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
          backgroundColor: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
      </button>
    </label>
  );
}

function LG({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: 20, height: dash ? 0 : 3, borderTop: dash ? `2px dashed ${color}` : 'none', backgroundColor: dash ? 'transparent' : color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

export default DesiredPlanTab;
